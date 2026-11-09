// A record part's logic: the one code `job/<process>/<part>` and `spans/<part>` both run. Each part
// is its own object with its own SQLite; a part that reaches its cap writes `rolled` and takes no new
// span, and the next part does. Tier 1, P37 (laws p100 and p102).
//
// A write, in one step: (1) drop the rows whose span id this part holds; (2) when none are left,
// answer `written`; (3) when the part has rolled, or its size is at or past the cap, write `rolled`
// if it is missing and answer it, with `had` naming the batch's span ids this part holds; (4) else
// write the rows and answer `written`. The size is checked before the write, so a resend after a
// lost answer never lands in two parts. Nothing but content is ever deleted, and content only by
// `deleteContent`.
import {Context, Effect, Layer, Option, Schema, Stream} from "effect";
import type {Sql} from "./referee.ts";
import {type Chain, Content, partName, Rolled, SinkError, SpanRow, sinkError} from "./trace.ts";

/** A part's answer to a write. `had`: the batch's span ids this part already holds. */
export const Written = Schema.TaggedUnion({
	written: {},
	rolled: {next: Schema.String, had: Schema.Array(Schema.String)},
});
export type Written = typeof Written.Type;

/** One span as the sink sends it, with its failure's message when it failed. */
const Sent = Schema.Struct({span: SpanRow, content: Schema.NullOr(Schema.String)});
type Sent = typeof Sent.Type;

/** One page of a part's spans, oldest first; `after` is where the next page starts. */
const Page = Schema.Struct({
	spans: Schema.Array(SpanRow),
	after: Schema.Int,
	rolled: Schema.Boolean,
});
type Page = typeof Page.Type;

/** Where a span's content is: in this part (with none when it never failed), or not here. */
const Lookup = Schema.TaggedUnion({
	found: {content: Schema.NullOr(Content)},
	absent: {rolled: Schema.Boolean},
});
type Lookup = typeof Lookup.Type;

/** Who deleted a content row, when on the caller's clock, and why. */
const Deletion = Schema.Struct({by: Schema.String, at: Schema.Int, reason: Schema.String});
type Deletion = typeof Deletion.Type;

/** How many spans one page holds. */
const PAGE = 500;

/** What a record part's object answers across an object call. Its answers are decoded here. */
export type RecordCalls = {
	write(chain: Chain, part: number, rows: ReadonlyArray<Sent>): Promise<unknown>;
	read(chain: Chain, part: number, after: number): Promise<unknown>;
	content(chain: Chain, part: number, spanId: string): Promise<unknown>;
	deleteContent(chain: Chain, part: number, spanId: string, by: Deletion): Promise<unknown>;
};

/** What one part keeps, synchronously: SQLite in a part object, a Map in tests. */
interface Store {
	readonly atomic: <A>(step: () => A) => A;
	/** Which of `ids` this part holds. */
	readonly holds: (ids: ReadonlyArray<string>) => ReadonlySet<string>;
	readonly rolled: () => Option.Option<Rolled>;
	readonly roll: (rolled: Rolled) => void;
	readonly size: () => number;
	readonly insert: (rows: ReadonlyArray<Sent>) => void;
	readonly page: (after: number) => {
		readonly spans: ReadonlyArray<SpanRow>;
		readonly after: number;
	};
	readonly content: (spanId: string) => Option.Option<Content>;
	/** Turns `kept` into `deleted`; a row already deleted stays as it is. */
	readonly erase: (spanId: string, by: Deletion) => void;
}

/** A part's four calls over its store: the write's steps, a page, a lookup and a delete. */
const part = (store: Store, chain: Chain, at: number, cap: number) => {
	const isRolled = () => Option.isSome(store.rolled());
	const lookup = (spanId: string): Lookup =>
		store.holds([spanId]).has(spanId)
			? Lookup.cases.found.make({content: Option.getOrNull(store.content(spanId))})
			: Lookup.cases.absent.make({rolled: isRolled()});
	return {
		write: (rows: ReadonlyArray<Sent>): Written =>
			store.atomic(() => {
				const held = store.holds(rows.map((row) => row.span.spanId));
				const seen = new Set(held);
				const left = rows.filter((row) => {
					if (seen.has(row.span.spanId)) return false;
					seen.add(row.span.spanId);
					return true;
				});
				if (left.length === 0) return Written.cases.written.make({});
				const had = rows.map((row) => row.span.spanId).filter((id) => held.has(id));
				const rolled = Option.getOrElse(store.rolled(), () => {
					const bytes = store.size();
					if (bytes < cap) return undefined;
					const made = Rolled.make({part: at, next: partName(chain, at + 1), bytes});
					store.roll(made);
					return made;
				});
				if (rolled !== undefined) return Written.cases.rolled.make({next: rolled.next, had});
				store.insert(left);
				return Written.cases.written.make({});
			}),
		page: (after: number): Page => store.atomic(() => ({...store.page(after), rolled: isRolled()})),
		lookup: (spanId: string): Lookup => store.atomic(() => lookup(spanId)),
		erase: (spanId: string, by: Deletion): Lookup =>
			store.atomic(() => {
				if (store.holds([spanId]).has(spanId)) store.erase(spanId, by);
				return lookup(spanId);
			}),
	};
};

/** A part's calls as Effects, however the part is reached. */
type Calls = {
	readonly write: (rows: ReadonlyArray<Sent>) => Effect.Effect<Written, SinkError>;
	readonly page: (after: number) => Effect.Effect<Page, SinkError>;
	readonly lookup: (spanId: string) => Effect.Effect<Lookup, SinkError>;
	readonly erase: (spanId: string, by: Deletion) => Effect.Effect<Lookup, SinkError>;
};

/** A part reached in this process: each call one synchronous step, a throw typed. */
const local = (made: ReturnType<typeof part>): Calls => {
	const attempt = Effect.fnUntraced(function* <A>(step: () => A) {
		return yield* Effect.try({try: step, catch: sinkError});
	});
	return {
		write: (rows) => attempt(() => made.write(rows)),
		page: (after) => attempt(() => made.page(after)),
		lookup: (spanId) => attempt(() => made.lookup(spanId)),
		erase: (spanId, by) => attempt(() => made.erase(spanId, by)),
	};
};

/** Walks a chain's parts from 0 until `found` ends it or a part that never rolled has it absent. */
const walk = Effect.fnUntraced(function* (
	calls: (chain: Chain, part: number) => Calls,
	chain: Chain,
	ask: (part: Calls) => Effect.Effect<Lookup, SinkError>,
): Effect.fn.Return<Option.Option<Content>, SinkError> {
	const from = Effect.fnUntraced(function* (
		at: number,
	): Effect.fn.Return<Option.Option<Content>, SinkError> {
		return yield* Effect.flatMap(ask(calls(chain, at)), (answer) =>
			Lookup.match(answer, {
				found: ({content}) => Effect.succeed(Option.fromNullOr(content)),
				absent: ({rolled}) => (rolled ? from(at + 1) : Effect.succeed(Option.none())),
			}),
		);
	});
	return yield* from(0);
});

const manager = (
	calls: (chain: Chain, part: number) => Calls,
): (typeof RecordManager)["Service"] => ({
	write: (chain, at, rows) => calls(chain, at).write(rows),
	read: (chain) =>
		Stream.paginate(
			{at: 0, after: 0},
			({
				at,
				after,
			}): Effect.Effect<
				readonly [ReadonlyArray<SpanRow>, Option.Option<{at: number; after: number}>],
				SinkError
			> =>
				Effect.map(calls(chain, at).page(after), (page) => [
					page.spans,
					page.spans.length === PAGE
						? Option.some({at, after: page.after})
						: page.rolled
							? Option.some({at: at + 1, after: 0})
							: Option.none(),
				]),
		),
	content: (chain, spanId) => walk(calls, chain, (one) => one.lookup(spanId)),
	deleteContent: (chain, spanId, {by, reason}) =>
		Effect.clockWith((clock) => {
			const deletion = {by, reason, at: clock.currentTimeMillisUnsafe()};
			return walk(calls, chain, (one) => one.erase(spanId, deletion));
		}).pipe(Effect.asVoid),
});

const PART_TABLES = [
	`CREATE TABLE IF NOT EXISTS spans (
		"spanId" TEXT PRIMARY KEY, "traceId" TEXT NOT NULL, "parentSpanId" TEXT, name TEXT NOT NULL,
		kind TEXT NOT NULL, "startTimeUnixNano" TEXT NOT NULL, "endTimeUnixNano" TEXT NOT NULL,
		attributes TEXT NOT NULL, events TEXT NOT NULL, links TEXT NOT NULL, resource TEXT NOT NULL,
		ok INTEGER NOT NULL)`,
	`CREATE TABLE IF NOT EXISTS content (
	"spanId" TEXT PRIMARY KEY, state TEXT NOT NULL, message TEXT, "by" TEXT, at INTEGER, reason TEXT)`,
	`CREATE TABLE IF NOT EXISTS rolled (
		one INTEGER PRIMARY KEY CHECK (one = 1), part INTEGER NOT NULL, next TEXT NOT NULL,
		bytes INTEGER NOT NULL)`,
];

const SpanColumns = Schema.Struct({
	...SpanRow.fields,
	attributes: Schema.fromJsonString(SpanRow.fields.attributes),
	events: Schema.fromJsonString(SpanRow.fields.events),
	links: Schema.fromJsonString(SpanRow.fields.links),
	resource: Schema.fromJsonString(SpanRow.fields.resource),
	ok: Schema.Literals([0, 1]),
});
const decodeSpan = Schema.decodeUnknownSync(SpanColumns);
const decodeSeq = Schema.decodeUnknownSync(Schema.Struct({seq: Schema.Int}));
/** A content row: `state` says which case its other columns hold. */
const decodeState = Schema.decodeUnknownSync(
	Schema.Struct({state: Schema.Literals(["kept", "deleted"])}),
);
const decodeKept = Schema.decodeUnknownSync(
	Schema.Struct({spanId: Schema.String, message: Schema.String}),
);
const decodeDeleted = Schema.decodeUnknownSync(
	Schema.Struct({spanId: Schema.String, by: Schema.String, at: Schema.Int, reason: Schema.String}),
);
const decodeRolled = Schema.decodeUnknownSync(
	Schema.Struct({part: Schema.Int, next: Schema.String, bytes: Schema.Int}),
);

/** A part on its own SQLite. Building it touches nothing: the tables come with the first call. */
const sqlStore = (sql: Sql): Store => {
	let ready = false;
	const one = (query: string, ...params: ReadonlyArray<string | number>) =>
		Option.fromUndefinedOr(sql.exec(query, ...params)[0]);
	return {
		atomic: (step) =>
			sql.transaction(() => {
				if (!ready) for (const query of PART_TABLES) sql.exec(query);
				ready = true;
				return step();
			}),
		holds: (ids) => {
			const found = new Set<string>();
			for (const id of new Set(ids))
				if (Option.isSome(one(`SELECT 1 FROM spans WHERE "spanId" = ?`, id))) found.add(id);
			return found;
		},
		rolled: () =>
			Option.map(one(`SELECT part, next, bytes FROM rolled`), (row) =>
				Rolled.make(decodeRolled(row)),
			),
		roll: ({part: at, next, bytes}) =>
			void sql.exec(
				`INSERT INTO rolled (one, part, next, bytes) VALUES (1, ?, ?, ?)`,
				at,
				next,
				bytes,
			),
		size: () => sql.size(),
		insert: (rows) => {
			for (const {span, content} of rows) {
				sql.exec(
					`INSERT INTO spans ("spanId", "traceId", "parentSpanId", name, kind, "startTimeUnixNano",
						"endTimeUnixNano", attributes, events, links, resource, ok)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					span.spanId,
					span.traceId,
					span.parentSpanId,
					span.name,
					span.kind,
					span.startTimeUnixNano,
					span.endTimeUnixNano,
					JSON.stringify(span.attributes),
					JSON.stringify(span.events),
					JSON.stringify(span.links),
					JSON.stringify(span.resource),
					span.ok ? 1 : 0,
				);
				if (content !== null)
					sql.exec(
						`INSERT INTO content ("spanId", state, message) VALUES (?, 'kept', ?)`,
						span.spanId,
						content,
					);
			}
		},
		page: (after) => {
			const rows = sql.exec(
				`SELECT rowid AS seq, * FROM spans WHERE rowid > ? ORDER BY rowid LIMIT ?`,
				after,
				PAGE,
			);
			const last = rows.at(-1);
			return {
				spans: rows.map((row) => {
					const {ok, ...span} = decodeSpan(row);
					return {...span, ok: ok === 1};
				}),
				after: last === undefined ? after : decodeSeq(last).seq,
			};
		},
		content: (spanId) =>
			Option.map(one(`SELECT * FROM content WHERE "spanId" = ?`, spanId), (row) => {
				return decodeState(row).state === "kept"
					? Content.cases.kept.make(decodeKept(row))
					: Content.cases.deleted.make(decodeDeleted(row));
			}),
		erase: (spanId, {by, at, reason}) =>
			void sql.exec(
				`UPDATE content SET state = 'deleted', message = NULL, "by" = ?, at = ?, reason = ?
				WHERE "spanId" = ? AND state = 'kept'`,
				by,
				at,
				reason,
				spanId,
			),
	};
};

export const recordPart = (sql: Sql, chain: Chain, at: number, cap: number) => {
	const calls = local(part(sqlStore(sql), chain, at, cap));
	return {
		write: Effect.fnUntraced(function* (rows: ReadonlyArray<Sent>) {
			return yield* calls.write(rows);
		}),
		read: Effect.fnUntraced(function* (after: number) {
			return yield* calls.page(after);
		}),
		content: Effect.fnUntraced(function* (id: string) {
			return yield* calls.lookup(id);
		}),
		deleteContent: Effect.fnUntraced(function* (id: string, by: Deletion) {
			return yield* calls.erase(id, by);
		}),
	};
};

const encoder = new TextEncoder();

/** A part in memory, for tests. Its size is the bytes of its rows as JSON. */
const memoryStore = (): Store => {
	const spans = new Map<string, SpanRow>();
	const order: Array<SpanRow> = [];
	const contents = new Map<string, Content>();
	let rolled = Option.none<Rolled>();
	let bytes = 0;
	return {
		atomic: (step) => step(),
		holds: (ids) => new Set(ids.filter((id) => spans.has(id))),
		rolled: () => rolled,
		roll: (made) => {
			rolled = Option.some(made);
		},
		size: () => bytes,
		insert: (rows) => {
			for (const {span, content} of rows) {
				spans.set(span.spanId, span);
				order.push(span);
				bytes += encoder.encode(JSON.stringify(span)).length;
				if (content !== null) {
					contents.set(
						span.spanId,
						Content.cases.kept.make({spanId: span.spanId, message: content}),
					);
					bytes += encoder.encode(content).length;
				}
			}
		},
		page: (after) => {
			const page = order.slice(after, after + PAGE);
			return {spans: page, after: after + page.length};
		},
		content: (spanId) => Option.fromUndefinedOr(contents.get(spanId)),
		erase: (spanId, by) => {
			const known = contents.get(spanId);
			if (known?._tag === "kept") contents.set(spanId, Content.cases.deleted.make({spanId, ...by}));
		},
	};
};

/** One part, by name, built the first time it is asked for. */
const parts = (make: (name: string) => Store, cap: number) => {
	const known = new Map<string, Calls>();
	return (chain: Chain, at: number): Calls => {
		const name = partName(chain, at);
		const found = known.get(name);
		if (found !== undefined) return found;
		const made = local(part(make(name), chain, at, cap));
		known.set(name, made);
		return made;
	};
};

export class RecordManager extends Context.Service<
	RecordManager,
	{
		/** Writes a batch to one part, by the steps above. */
		readonly write: (
			chain: Chain,
			part: number,
			rows: ReadonlyArray<{readonly span: SpanRow; readonly content: string | null}>,
		) => Effect.Effect<Written, SinkError>;
		/** Every span of the chain, part 0 first and on through each `rolled`, in write order. */
		readonly read: (chain: Chain) => Stream.Stream<SpanRow, SinkError>;
		readonly content: (
			chain: Chain,
			spanId: string,
		) => Effect.Effect<Option.Option<Content>, SinkError>;
		/** Turns a span's `kept` content into `deleted {by, at, reason}`, in whichever part holds it. */
		readonly deleteContent: (
			chain: Chain,
			spanId: string,
			by: {readonly by: string; readonly reason: string},
		) => Effect.Effect<void, SinkError>;
	}
>()("@kampus/libfabrika/RecordManager") {
	/** Each part on the `Sql` that `open` gives for its name, rolled at `cap` bytes. */
	static readonly sql = (open: (name: string) => Sql, cap: number): Layer.Layer<RecordManager> =>
		Layer.sync(RecordManager)(() => manager(parts((name) => sqlStore(open(name)), cap)));

	/** Every part in memory, rolled at `cap` bytes of JSON: for tests. */
	static readonly memory = (cap: number): Layer.Layer<RecordManager> =>
		Layer.sync(RecordManager)(() => manager(parts(() => memoryStore(), cap)));

	/** Each part is its own object, reached by `stub(name)`. A rejected call is `unreachable`; an
	 *  answer that does not decode, `bad_row`. */
	static readonly remote = (stub: (name: string) => RecordCalls): Layer.Layer<RecordManager> => {
		const ask = Effect.fnUntraced(function* <A, M extends keyof RecordCalls>(
			answer: Schema.Decoder<A>,
			name: string,
			method: M,
			...args: Parameters<RecordCalls[M]>
		): Effect.fn.Return<A, SinkError> {
			const fail = () => new SinkError({reason: "unreachable", held: 0});
			const rpc = yield* Effect.try({try: () => stub(name), catch: fail});
			// oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
			const io = Effect.tryPromise({try: () => Reflect.apply(rpc[method], rpc, args), catch: fail});
			return yield* io.pipe(
				Effect.flatMap((raw) =>
					Schema.decodeUnknownEffect(answer)(raw).pipe(
						Effect.mapError(() => new SinkError({reason: "bad_row", held: 0})),
					),
				),
			);
		});
		return Layer.succeed(
			RecordManager,
			manager((chain, at) => {
				const name = partName(chain, at);
				return {
					write: (rows) => ask(Written, name, "write", chain, at, rows),
					page: (after) => ask(Page, name, "read", chain, at, after),
					lookup: (spanId) => ask(Lookup, name, "content", chain, at, spanId),
					erase: (spanId, by) => ask(Lookup, name, "deleteContent", chain, at, spanId, by),
				};
			}),
		);
	};
}
