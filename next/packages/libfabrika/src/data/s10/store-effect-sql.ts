// S10 spike, next/, never merged. Route E: the referee on `effect/sql`'s `SqlClient`.
// The same logic as `../ledger-store.ts` (its pure `check` and `decide` are imported), with every
// statement an Effect and the turn `sql.withTransaction`. One driver per platform supplies
// `SqlClient`: `@effect/sql-sqlite-node` on Node, `@effect/sql-sqlite-do` in a Durable Object.
import {Cause, Clock, Context, Effect, Exit, Layer, Option, Result, Schema, Stream} from "effect";
import {SqlClient, SqlError, SqlSchema} from "effect/sql";
import {
	check,
	decide,
	ERROR,
	errorCode,
	Head,
	ID,
	Lag,
	Last,
	OPERATION,
	Placing,
	Ring,
	STREAM,
	TABLES,
	tag,
	type Why,
} from "../ledger-store.ts";
import {Doorbell, Ledger, LedgerError} from "../ledger.ts";
import {Appended, Entry, type Line, PAGE, Rev, Row, Waited} from "../log.ts";
import {errorClass, short} from "../trace.ts";

/** One turn's handle. Every call is an Effect, and a refusal fails the whole turn. */
export interface LedgerTurnE {
	readonly read: (stream: string, after: Rev) => Effect.Effect<ReadonlyArray<Entry>, LedgerError>;
	readonly append: (
		stream: string,
		id: string,
		line: Line,
	) => Effect.Effect<{readonly rev: Rev; readonly pos: Rev}, LedgerError>;
}

export interface RefereeE {
	readonly append: (
		stream: string,
		id: string,
		line: unknown,
	) => Effect.Effect<Appended, LedgerError>;
	readonly read: (
		stream: string,
		after: Rev,
		reader: string,
	) => Effect.Effect<ReadonlyArray<Entry>, LedgerError>;
	readonly wait: (stream: string, after: Rev, reader: string) => Effect.Effect<Waited, LedgerError>;
	readonly transact: <A, E, R>(
		step: (turn: LedgerTurnE) => Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | LedgerError, R>;
}

const Key = Schema.Struct({stream: Schema.String, id: Schema.String});
const Past = Schema.Struct({stream: Schema.String, after: Rev});
const Page = Schema.Struct({stream: Schema.String, after: Rev, limit: Schema.Int});

export const refereeOnSqlClient = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	const doorbell = yield* Doorbell;
	let ready = false;

	const firstOf = SqlSchema.findOneOption({
		Request: Key,
		Result: Row,
		execute: ({stream, id}) => sql`SELECT * FROM entries WHERE stream = ${stream} AND id = ${id}`,
	});
	const headOf = SqlSchema.findOneOption({
		Request: Schema.Void,
		Result: Head,
		execute: () => sql`SELECT rev, "arrivedAt" FROM entries ORDER BY rev DESC LIMIT 1`,
	});
	const lastOf = SqlSchema.findOne({
		Request: Schema.String,
		Result: Last,
		execute: (stream) =>
			sql`SELECT coalesce(max(pos), 0) AS pos FROM entries WHERE stream = ${stream}`,
	});
	const lagOf = SqlSchema.findOne({
		Request: Past,
		Result: Lag,
		execute: ({stream, after}) =>
			sql`SELECT coalesce(max(rev), 0) AS head, coalesce(sum(rev > ${after}), 0) AS lag
				FROM entries WHERE stream = ${stream}`,
	});
	const takeRings = SqlSchema.findAll({
		Request: Schema.Struct({stream: Schema.String, rev: Rev}),
		Result: Ring,
		execute: ({stream, rev}) =>
			sql`DELETE FROM rings WHERE stream = ${stream} AND after < ${rev} RETURNING "to", after`,
	});
	const pageOf = SqlSchema.findAll({
		Request: Page,
		Result: Row,
		execute: ({stream, after, limit}) =>
			sql`SELECT * FROM entries WHERE stream = ${stream} AND rev > ${after} ORDER BY rev LIMIT ${limit}`,
	});
	const allOf = SqlSchema.findAll({
		Request: Past,
		Result: Row,
		execute: ({stream, after}) =>
			sql`SELECT * FROM entries WHERE stream = ${stream} AND rev > ${after} ORDER BY rev`,
	});

	/** A SQL failure or a row that did not decode, as the ledger's own error, with its span tags. */
	const typed = (
		error: SqlError.SqlError | Schema.SchemaError | Cause.NoSuchElementError | LedgerError,
	): Effect.Effect<never, LedgerError> => {
		if (error instanceof LedgerError) {
			return Effect.fail(error);
		}

		const thrown = SqlError.isSqlError(error) ? error.reason.cause : error;
		const why = SqlError.isSqlError(error) ? "storage" : "bad_row";
		const failure = new LedgerError({
			why,
			...(thrown instanceof Error ? {message: thrown.message} : {}),
		});
		return Effect.annotateCurrentSpan({
			[tag("why")]: why,
			[ERROR]: errorClass(thrown),
			...(SqlError.isSqlError(error) ? {[tag("reason")]: error.reason._tag} : {}),
			...Option.match(errorCode(thrown), {
				onNone: () => ({}),
				onSome: (code) => ({[tag("code")]: code}),
			}),
		}).pipe(Effect.andThen(Effect.fail(failure)));
	};

	const tables = Effect.suspend(() =>
		ready
			? Effect.void
			: sql
					.withTransaction(Effect.forEach(TABLES, (query) => sql.unsafe(query), {discard: true}))
					.pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								ready = true;
							}),
						),
					),
	);

	/** Runs `work` as one turn: begin, the work, commit; any failure rolls it back. */
	const atomic = <A, E, R>(work: Effect.Effect<A, E | LedgerError, R>) =>
		tables.pipe(
			Effect.andThen(sql.withTransaction(work)),
			Effect.catchIf(
				(error): error is SqlError.SqlError => SqlError.isSqlError(error),
				(error) => typed(error),
			),
		);

	const place = Effect.fnUntraced(function* (stream: string, id: string, line: Line) {
		const first = yield* firstOf({stream, id});
		const last = yield* headOf();
		const head = Option.match(last, {onNone: () => 0, onSome: (row) => row.rev});
		const answered = decide(line, first, head);

		if (Option.isSome(answered)) {
			return answered.value;
		}

		const rev = head + 1;
		const pos = (yield* lastOf(stream)).pos + 1;
		const arrivedAt = Math.max(
			yield* Clock.currentTimeMillis,
			Option.match(last, {onNone: () => 0, onSome: (row) => row.arrivedAt}),
		);
		yield* sql`INSERT INTO entries ${sql.insert({
			rev,
			stream,
			pos,
			id,
			arrivedAt,
			by: line.by,
			for: line.for,
			sentAt: line.sentAt,
			seen: line.seen,
			parent: line.parent,
			traceId: line.traceId,
			build: line.build,
			_tag: line._tag,
			body: JSON.stringify(line.body),
		})}`;
		const rings = yield* takeRings({stream, rev});
		return Placing.cases.placed.make({rev, pos, rings});
	}, Effect.catch(typed));

	const ring = Effect.fn("ledger.ring")(function* (stream: string, rev: Rev, {to, after}: Ring) {
		yield* Effect.annotateCurrentSpan({
			...short({[STREAM]: stream, [tag("to")]: to}),
			[tag("after")]: after,
			[tag("rev")]: rev,
		});
		return yield* Effect.suspend(() => doorbell.ring(to, stream, rev)).pipe(
			Effect.onExit((exit) =>
				Effect.annotateCurrentSpan(
					Exit.match(exit, {
						onSuccess: () => ({[tag("ok")]: true}),
						onFailure: (cause) => ({[tag("ok")]: false, [ERROR]: errorClass(Cause.squash(cause))}),
					}),
				),
			),
		);
	});

	const refused = Effect.fnUntraced(function* (why: Why) {
		return yield* Effect.as(
			Effect.annotateCurrentSpan({[tag("answer")]: "refused", [tag("why")]: why}),
			Appended.cases.refused.make({why}),
		);
	});

	const append = Effect.fn("ledger.append")(function* (stream: string, id: string, input: unknown) {
		yield* Effect.annotateCurrentSpan({
			...short({[STREAM]: stream, [ID]: id}),
			[OPERATION]: "send",
		});
		const checked = check(stream, id, input);

		if (Result.isFailure(checked)) {
			return yield* refused(checked.failure);
		}

		const line = checked.success;
		yield* Effect.annotateCurrentSpan(short({[tag("tag")]: line._tag, [tag("by")]: line.by}));
		const placing = yield* atomic(place(stream, id, line));
		return yield* Placing.match(placing, {
			refused: ({why}) => refused(why),
			resent: ({rev, pos}) =>
				Effect.as(
					Effect.annotateCurrentSpan({
						[tag("answer")]: "resent",
						[tag("rev")]: rev,
						[tag("pos")]: pos,
					}),
					Appended.cases.placed.make({rev, pos}),
				),
			placed: ({rev, pos, rings}) =>
				Effect.forEach(
					rings,
					(waiter) => ring(stream, rev, waiter).pipe(Effect.catchCause(() => Effect.void)),
					{concurrency: "unbounded", discard: true},
				).pipe(
					Effect.andThen(
						Effect.annotateCurrentSpan({
							[tag("answer")]: "placed",
							[tag("rev")]: rev,
							[tag("pos")]: pos,
							[tag("rings")]: rings.length,
						}),
					),
					Effect.as(Appended.cases.placed.make({rev, pos})),
				),
		});
	});

	const read = Effect.fn("ledger.read")(function* (stream: string, after: Rev, reader: string) {
		yield* Effect.annotateCurrentSpan({
			...short({[STREAM]: stream, [tag("reader")]: reader}),
			[OPERATION]: "receive",
			[tag("after")]: after,
		});
		const {head, lag, entries, at} = yield* atomic(
			Effect.gen(function* () {
				const {head, lag} = yield* lagOf({stream, after});
				const entries = yield* pageOf({stream, after, limit: PAGE});
				return {head, lag, entries, at: yield* Clock.currentTimeMillis};
			}).pipe(Effect.catch(typed)),
		);
		yield* Effect.annotateCurrentSpan({
			[tag("head")]: head,
			[tag("lag")]: lag,
			[tag("rows")]: entries.length,
			...(entries[0] === undefined ? {} : {[tag("visible_ms")]: at - entries[0].arrivedAt}),
		});
		return entries;
	});

	const wait = Effect.fn("ledger.wait")(function* (stream: string, after: Rev, reader: string) {
		yield* Effect.annotateCurrentSpan({
			...short({[STREAM]: stream, [tag("reader")]: reader}),
			[tag("after")]: after,
		});
		const {head, lag, waited} = yield* atomic(
			Effect.gen(function* () {
				const {head, lag} = yield* lagOf({stream, after});

				if (head > after) {
					return {head, lag, waited: Waited.cases.ready.make({rev: head})};
				}

				yield* sql`INSERT INTO rings ${sql.insert({to: reader, stream, after})}
					ON CONFLICT ("to", stream) DO UPDATE SET after = min(after, excluded.after)`;
				return {head, lag, waited: Waited.cases.parked.make({})};
			}).pipe(Effect.catch(typed)),
		);
		yield* Effect.annotateCurrentSpan({
			[tag("head")]: head,
			[tag("lag")]: lag,
			[tag("answer")]: waited._tag,
		});
		return waited;
	});

	const transact = Effect.fn("ledger.transaction")(function* <A, E, R>(
		step: (turn: LedgerTurnE) => Effect.Effect<A, E, R>,
	) {
		const rings: Array<{stream: string; rev: Rev; waiter: Ring}> = [];
		let open = true;
		const ended = Effect.suspend(() =>
			open
				? Effect.void
				: Effect.fail(new LedgerError({why: "storage", message: "ledger turn has ended"})),
		);
		const turn: LedgerTurnE = {
			read: (stream, after) =>
				ended.pipe(Effect.andThen(allOf({stream, after})), Effect.catch(typed)),
			append: Effect.fnUntraced(function* (stream, id, input) {
				yield* ended;
				const checked = check(stream, id, input);

				if (Result.isFailure(checked)) {
					return yield* new LedgerError({why: "refused"});
				}

				const placing = yield* place(stream, id, checked.success);

				if (placing._tag === "refused") {
					return yield* new LedgerError({why: "refused"});
				}

				if (placing._tag === "placed") {
					for (const waiter of placing.rings) {
						rings.push({stream, rev: placing.rev, waiter});
					}
				}

				return {rev: placing.rev, pos: placing.pos};
			}),
		};
		const value = yield* atomic(
			Effect.suspend(() => step(turn)).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						open = false;
					}),
				),
			),
		);
		yield* Effect.forEach(
			rings,
			({stream, rev, waiter}) =>
				ring(stream, rev, waiter).pipe(Effect.catchCause(() => Effect.void)),
			{discard: true, concurrency: 1},
		);
		return value;
	});

	const referee: RefereeE = {append, read, wait, transact};
	return referee;
});

/** The turn as a service, as `LedgerTransaction` is on main, with an Effect step. */
export class LedgerTransactionE extends Context.Service<
	LedgerTransactionE,
	{readonly transact: RefereeE["transact"]}
>()("@kampus/libfabrika/s10/LedgerTransactionE") {}

/** `Ledger` and the turn on one `SqlClient`, sharing one referee. */
export const ledgerOnSqlClient = (who: {
	readonly reader: string;
}): Layer.Layer<Ledger | LedgerTransactionE, never, SqlClient.SqlClient | Doorbell> =>
	Layer.effectContext(
		Effect.gen(function* () {
			const referee = yield* refereeOnSqlClient;
			const pages = (stream: string, after: Rev) =>
				Stream.paginate(after, (from: Rev) =>
					Effect.map(
						referee.read(stream, from, who.reader),
						(entries) =>
							[
								entries,
								entries.length < PAGE ? Option.none() : Option.fromUndefinedOr(entries.at(-1)?.rev),
							] as const,
					),
				);
			return Context.make(Ledger, {
				append: referee.append,
				read: pages,
				wait: (stream, after) => referee.wait(stream, after, who.reader),
			}).pipe(Context.add(LedgerTransactionE, {transact: referee.transact}));
		}),
	);
