// S10 spike, next/, never merged. Route W: the referee on Alchemy's own Effect wrapper of a Durable
// Object's storage: `state.storage.sql.exec` for a statement, `state.storage.transaction` for the turn.
// The slice only: append, read and the turn. A SQL error is a defect there (`exec`'s error type is
// `never`), so the turn catches defects to keep the ledger's typed `storage` failure.
import type {DurableObjectStorage, SqlStorageValue} from "@alchemy.run/cloudflare";
import {Clock, Effect, Option, Result, Schema} from "effect";
import {
	check,
	decide,
	ERROR,
	errorCode,
	Head,
	Lag,
	Last,
	Placing,
	Ring,
	TABLES,
	tag,
} from "../ledger-store.ts";
import {type Doorbell, LedgerError} from "../ledger.ts";

import {Appended, type Entry, type Line, PAGE, type Rev, Row} from "../log.ts";
import {errorClass} from "../trace.ts";

/** Alchemy colors every storage call with its `RuntimeContext`; read here off the wrapper itself. */
export type RuntimeContext = Effect.Services<ReturnType<DurableObjectStorage["sync"]>>;

export interface LedgerTurnW {
	readonly read: (
		stream: string,
		after: Rev,
	) => Effect.Effect<ReadonlyArray<Entry>, LedgerError, RuntimeContext>;
	readonly append: (
		stream: string,
		id: string,
		line: Line,
	) => Effect.Effect<{readonly rev: Rev; readonly pos: Rev}, LedgerError, RuntimeContext>;
}

const rowOf = Schema.decodeUnknownEffect(Row);
const headOf = Schema.decodeUnknownEffect(Head);
const lastOf = Schema.decodeUnknownEffect(Last);
const lagOf = Schema.decodeUnknownEffect(Lag);
const ringOf = Schema.decodeUnknownEffect(Ring);

export const refereeOnAlchemy = (
	storage: DurableObjectStorage,
	doorbell: (typeof Doorbell)["Service"],
) => {
	let ready = false;
	const all = (query: string, ...params: ReadonlyArray<SqlStorageValue>) =>
		Effect.flatMap(storage.sql.exec(query, ...params), (cursor) => cursor.toArray());
	const one = (query: string, ...params: ReadonlyArray<SqlStorageValue>) =>
		Effect.map(all(query, ...params), (rows) => Option.fromUndefinedOr(rows[0]));

	/** What went wrong in a turn, as the ledger's own error. A thrown SQL error arrives as a defect. */
	const typed = (error: unknown): Effect.Effect<never, LedgerError> => {
		if (error instanceof LedgerError) {
			return Effect.fail(error);
		}

		const thrown =
			typeof error === "object" && error !== null && "cause" in error && error.cause !== undefined
				? error.cause
				: error;
		const why = Schema.isSchemaError(error) ? "bad_row" : "storage";
		return Effect.annotateCurrentSpan({
			[tag("why")]: why,
			[ERROR]: errorClass(thrown),
			...Option.match(errorCode(thrown), {
				onNone: () => ({}),
				onSome: (code) => ({[tag("code")]: code}),
			}),
		}).pipe(
			Effect.andThen(
				Effect.fail(
					new LedgerError({why, ...(thrown instanceof Error ? {message: thrown.message} : {})}),
				),
			),
		);
	};

	const tables = Effect.suspend(() =>
		ready
			? Effect.void
			: storage
					.transaction(Effect.forEach(TABLES, (query) => storage.sql.exec(query), {discard: true}))
					.pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								ready = true;
							}),
						),
					),
	);

	/** Runs `work` as one turn in the platform's transaction; a failure or a defect rolls it back. */
	const atomic = <A, E>(work: Effect.Effect<A, E, RuntimeContext>) =>
		tables.pipe(
			Effect.andThen(storage.transaction(work)),
			Effect.catchDefect(typed),
			Effect.catch((error) => typed(error)),
		);

	const place = Effect.fnUntraced(function* (stream: string, id: string, line: Line) {
		const first = yield* Effect.flatMap(
			one(`SELECT * FROM entries WHERE stream = ? AND id = ?`, stream, id),
			(row) => Effect.transposeOption(Option.map(row, (found) => rowOf(found))),
		);
		const last = yield* Effect.flatMap(
			one(`SELECT rev, "arrivedAt" FROM entries ORDER BY rev DESC LIMIT 1`),
			(row) => Effect.transposeOption(Option.map(row, (found) => headOf(found))),
		);
		const head = Option.match(last, {onNone: () => 0, onSome: (row) => row.rev});
		const answered = decide(line, first, head);

		if (Option.isSome(answered)) {
			return answered.value;
		}

		const rev = head + 1;
		const pos =
			(yield* lastOf(
				(yield* all(
					`SELECT coalesce(max(pos), 0) AS pos FROM entries WHERE stream = ?`,
					stream,
				))[0],
			)).pos + 1;
		const arrivedAt = Math.max(
			yield* Clock.currentTimeMillis,
			Option.match(last, {onNone: () => 0, onSome: (row) => row.arrivedAt}),
		);
		// The cursor a write gives back is itself an Effect (a Stream); Effect's check flags it if dropped.
		yield* Effect.asVoid(
			storage.sql.exec(
				`INSERT INTO entries (rev, stream, pos, id, "arrivedAt", "by", "for", "sentAt", seen, parent,
				"traceId", build, "_tag", body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				rev,
				stream,
				pos,
				id,
				arrivedAt,
				line.by,
				line.for,
				line.sentAt,
				line.seen,
				line.parent,
				line.traceId,
				line.build,
				line._tag,
				JSON.stringify(line.body),
			),
		);
		const rings = yield* Effect.forEach(
			yield* all(
				`DELETE FROM rings WHERE stream = ? AND after < ? RETURNING "to", after`,
				stream,
				rev,
			),
			(row) => ringOf(row),
		);
		return Placing.cases.placed.make({rev, pos, rings});
	});

	const rung = (stream: string, rev: Rev, rings: ReadonlyArray<Ring>) =>
		Effect.forEach(
			rings,
			({to}) =>
				Effect.suspend(() => doorbell.ring(to, stream, rev)).pipe(
					Effect.catchCause(() => Effect.void),
				),
			{discard: true},
		);

	const append = Effect.fn("ledger.append")(function* (stream: string, id: string, input: unknown) {
		const checked = check(stream, id, input);

		if (Result.isFailure(checked)) {
			return Appended.cases.refused.make({why: checked.failure});
		}

		const placing = yield* atomic(place(stream, id, checked.success));
		return yield* Placing.match(placing, {
			refused: ({why}) => Effect.succeed(Appended.cases.refused.make({why})),
			resent: ({rev, pos}) => Effect.succeed(Appended.cases.placed.make({rev, pos})),
			placed: ({rev, pos, rings}) =>
				Effect.as(rung(stream, rev, rings), Appended.cases.placed.make({rev, pos})),
		});
	});

	const read = Effect.fn("ledger.read")(function* (stream: string, after: Rev, _reader: string) {
		return yield* atomic(
			Effect.gen(function* () {
				yield* lagOf(
					(yield* all(
						`SELECT coalesce(max(rev), 0) AS head, coalesce(sum(rev > ?), 0) AS lag
						FROM entries WHERE stream = ?`,
						after,
						stream,
					))[0],
				);
				return yield* Effect.forEach(
					yield* all(
						`SELECT * FROM entries WHERE stream = ? AND rev > ? ORDER BY rev LIMIT ?`,
						stream,
						after,
						PAGE,
					),
					(row) => rowOf(row),
				);
			}),
		);
	});

	const transact = Effect.fn("ledger.transaction")(function* <A, E>(
		step: (turn: LedgerTurnW) => Effect.Effect<A, E, RuntimeContext>,
	) {
		const rings: Array<{stream: string; rev: Rev; waiter: Ring}> = [];
		const turn: LedgerTurnW = {
			read: (stream, after) =>
				Effect.flatMap(
					all(`SELECT * FROM entries WHERE stream = ? AND rev > ? ORDER BY rev`, stream, after),
					Effect.forEach((row) => rowOf(row)),
				).pipe(Effect.catchDefect(typed), Effect.catch(typed)),
			append: (stream, id, input) =>
				Effect.gen(function* () {
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
				}).pipe(Effect.catchDefect(typed), Effect.catch(typed)),
		};
		const value = yield* atomic(Effect.suspend(() => step(turn)));
		yield* Effect.forEach(rings, ({stream, rev, waiter}) => rung(stream, rev, [waiter]), {
			discard: true,
		});
		return value;
	});

	return {append, read, transact};
};
