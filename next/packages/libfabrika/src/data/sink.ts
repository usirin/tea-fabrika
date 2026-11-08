// The span sink: every object installs one Tracer, and a span that ends is in the object's own SQLite
// before `end` returns. `flush` ships it to its record later, when the runner says. Tier 1, P37
// (laws p96, p97 and p99).
//
// The queue is a table, `unsent`, not memory: an object sleeps and loses memory, and a timer fiber
// is what "a wait is data" forbids. Nothing is dropped. A write that cannot land (`SQLITE_FULL`) is
// held in memory and tried again at each later `end`, and the next `flush` fails the step with
// `storage`: let it crash. The sink's own calls end no span.
import {
	Cause,
	Context,
	Effect,
	Exit,
	Layer,
	Option,
	Redacted,
	Result,
	Schema,
	Tracer,
} from "effect";
import type {Archive} from "./archive.ts";
import {
	archiveDays,
	HEALTH_TABLES,
	hourStart,
	readSummaries,
	rollup,
	writeHealth,
	writeSize,
} from "./health.ts";
import {RecordManager} from "./records.ts";
import type {Sql} from "./referee.ts";
import {
	Chain,
	chainName,
	errorClass,
	type Health,
	PROCESS,
	SinkError,
	SpanRow,
	type Summary,
	short,
	sinkError,
	type Tag,
} from "./trace.ts";

export {SinkError} from "./trace.ts";

const ERROR = "error.type";
const DROPPED = "fab.sink.dropped";
/** The most characters of a failure's text kept as content: half a Durable Object row. */
const MOST_CONTENT = 1_000_000;
/** How many spans one record call carries. */
const BATCH = 100;

const SINK_TABLES = [
	`CREATE TABLE IF NOT EXISTS unsent (
		"spanId" TEXT PRIMARY KEY, chain TEXT NOT NULL, row TEXT NOT NULL, content TEXT)`,
	`CREATE TABLE IF NOT EXISTS parts (chain TEXT PRIMARY KEY, part INTEGER NOT NULL)`,
];

const Unsent = Schema.Struct({
	spanId: Schema.String,
	chain: Schema.fromJsonString(Chain),
	row: Schema.fromJsonString(SpanRow),
	content: Schema.NullOr(Schema.String),
});
const decodeUnsent = Schema.decodeUnknownSync(Unsent);
const encodeChain = Schema.encodeSync(Schema.fromJsonString(Chain));
const encodeRow = Schema.encodeSync(Schema.fromJsonString(SpanRow));
const decodePart = Schema.decodeUnknownSync(Schema.Struct({part: Schema.Int}));

/** What one ended span writes: its health row and its unsent row, worked out before any write. */
type Ended = {
	readonly health: Health;
	readonly chain: Chain;
	readonly row: SpanRow;
	readonly content: string | null;
};

/** Tags as a row keeps them: strings (cut at 128), finite numbers, booleans, and `Redacted` as
 *  `"<redacted>"`. Anything else is dropped, and counted. */
const keep = (attributes: Iterable<readonly [string, unknown]>) => {
	const tags: Record<string, Tag> = {};
	let dropped = 0;
	for (const [key, value] of attributes) {
		if (Redacted.isRedacted(value)) tags[key] = "<redacted>";
		else if (typeof value === "string") Object.assign(tags, short({[key]: value}));
		else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))
			tags[key] = value;
		else dropped += 1;
	}
	return {tags, dropped};
};

/** The span's own `fab.process`, else its nearest ancestor's, else none. */
const findProcess = (span: Tracer.AnySpan): Option.Option<string> => {
	if (span._tag === "ExternalSpan") return Option.none();
	const own = span.attributes.get(PROCESS);
	if (typeof own === "string" && own !== "") return Option.some(own);
	return Option.flatMap(span.parent, findProcess);
};

/** The largest numeric tag whose key ends in `.lag`, such as P6's `fab.ledger.lag`. */
const largestLag = (tags: Readonly<Record<string, Tag>>): number | null => {
	const lags = Object.entries(tags).flatMap(([key, value]) =>
		key.endsWith(".lag") && typeof value === "number" ? [value] : [],
	);
	return lags.length === 0 ? null : Math.max(...lags);
};

const cutContent = (text: string): string =>
	text.length <= MOST_CONTENT
		? text
		: `${text.slice(0, MOST_CONTENT)}\n[cut: ${text.length} characters]`;

/** Turns an ended span into its rows. Pure: no write, no clock but the span's own times. */
const ended = (
	span: Tracer.Span,
	endTime: bigint,
	exit: Exit.Exit<unknown, unknown>,
	events: ReadonlyArray<readonly [string, bigint, Record<string, unknown>]>,
): Ended => {
	const own = keep(span.attributes);
	const kept = events.map(([name, time, attributes]) => ({
		name,
		time,
		...keep(Object.entries(attributes)),
	}));
	const dropped = own.dropped + kept.reduce((n, event) => n + event.dropped, 0);
	const failure = Exit.isFailure(exit) ? Option.some(exit.cause) : Option.none();
	const error = Option.map(failure, (cause) => {
		const named = own.tags[ERROR];
		return typeof named === "string" ? named : errorClass(Cause.squash(cause));
	});
	const tags: Record<string, Tag> = {
		...own.tags,
		...Option.match(error, {onNone: () => ({}), onSome: (type) => ({[ERROR]: type})}),
		...(dropped > 0 ? {[DROPPED]: dropped} : {}),
	};
	const startTime = span.status.startTime;
	const row = SpanRow.make({
		traceId: span.traceId,
		spanId: span.spanId,
		parentSpanId: Option.match(span.parent, {
			onNone: () => null,
			onSome: (parent) => parent.spanId,
		}),
		name: span.name,
		kind: span.kind,
		startTimeUnixNano: String(startTime),
		endTimeUnixNano: String(endTime),
		attributes: tags,
		events: kept.map(({name, time, tags: attributes}) => ({
			name,
			timeUnixNano: String(time),
			attributes,
		})),
		ok: Exit.isSuccess(exit),
	});
	return {
		health: {
			piece: span.name,
			at: Number(endTime / 1_000_000n),
			ms: Number(endTime - startTime) / 1_000_000,
			ok: row.ok,
			error: Option.getOrNull(error),
			lag: largestLag(tags),
		},
		chain: Option.match(findProcess(span), {
			onNone: () => Chain.cases.spans.make({}),
			onSome: (process) => Chain.cases.job.make({process}),
		}),
		row,
		content: Option.getOrNull(Option.map(failure, (cause) => cutContent(Cause.pretty(cause)))),
	};
};

/** A span that tells the sink when it ends. Effect calls `end` once, synchronously. */
class SinkSpan extends Tracer.NativeSpan {
	constructor(
		options: ConstructorParameters<typeof Tracer.NativeSpan>[0],
		private readonly onEnd: (
			span: SinkSpan,
			endTime: bigint,
			exit: Exit.Exit<unknown, unknown>,
		) => void,
	) {
		super(options);
	}

	override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
		if (this.status._tag === "Ended") return;
		super.end(endTime, exit);
		this.onEnd(this, endTime, exit);
	}
}

export class SpanSink extends Context.Service<
	SpanSink,
	{
		/** Sends `unsent` to each chain's current part, deleting each row only after a good answer and
		 *  following `rolled`; then archives each due day of raw health rows. Fails with `storage`,
		 *  before it sends anything, when an `end` met a write it could not land since the last flush. */
		readonly flush: Effect.Effect<{readonly sent: number}, SinkError, RecordManager | Archive>;
		/** The summaries whose hour is in `[from, to)`, after rolling up every closed hour. */
		readonly summaries: (
			from: number,
			to: number,
		) => Effect.Effect<ReadonlyArray<Summary>, SinkError>;
	}
>()("@kampus/libfabrika/SpanSink") {
	/** Provides `Tracer.Tracer` and `SpanSink` over this object's `Sql`. Building it touches nothing:
	 *  the tables come with the first span. */
	static readonly layer = (sql: Sql, who: {readonly object: string}): Layer.Layer<SpanSink> =>
		Layer.unwrap(
			Effect.sync(() => {
				const {tracer, sink} = make(sql, who);
				return Layer.merge(Layer.succeed(SpanSink, sink), Layer.succeed(Tracer.Tracer, tracer));
			}),
		);
}

const make = (sql: Sql, who: {readonly object: string}) => {
	let ready = false;
	/** Spans whose write met a full disk, oldest first, tried again at each later `end`. */
	let held: ReadonlyArray<Ended> = [];
	/** Whether a write failed since the last flush. */
	let met = false;
	/** The newest hour this process has rolled up and sized. Memory only: a wake checks once more. */
	let checked = Number.NEGATIVE_INFINITY;

	/** Runs `step` as one atomic step, with the tables made first on first use. */
	const atomic = <A>(step: () => A): A =>
		sql.transaction(() => {
			if (!ready) for (const query of [...HEALTH_TABLES, ...SINK_TABLES]) sql.exec(query);
			ready = true;
			return step();
		});

	const land = ({health, chain, row, content}: Ended) => {
		writeHealth(sql, health);
		sql.exec(
			`INSERT INTO unsent ("spanId", chain, row, content) VALUES (?, ?, ?, ?)`,
			row.spanId,
			encodeChain(chain),
			encodeRow(row),
			content,
		);
	};

	/** Lands the held spans and `more` in one step, then rolls up closed hours before `now`. A span's
	 *  `end` also writes this hour's size row. A throw keeps every span held. */
	const commit = (
		more: ReadonlyArray<Ended>,
		now: number,
		sized: boolean,
	): Result.Result<void, unknown> => {
		const batch = [...held, ...more];
		const hour = hourStart(now);
		const done = Result.try({
			try: () =>
				atomic(() => {
					for (const one of batch) land(one);
					if (hour > checked) {
						rollup(sql, now);
						if (sized) writeSize(sql, now);
					}
				}),
			catch: (error) => error,
		});
		if (Result.isFailure(done)) {
			held = batch;
			met = true;
		} else {
			held = [];
			if (sized && hour > checked) checked = hour;
		}
		return done;
	};

	const tracer = Tracer.make({
		span: (options) =>
			new SinkSpan(options, (span, endTime, exit) => {
				commit([ended(span, endTime, exit, span.events)], Number(endTime / 1_000_000n), true);
			}),
	});

	const attempt = <A>(step: () => A): Effect.Effect<A, SinkError> =>
		Effect.try({try: () => atomic(step), catch: sinkError});

	/** Sends one chain's rows to its part, on through each `rolled`. Deletes only what landed. */
	const send = (
		records: (typeof RecordManager)["Service"],
		chain: Chain,
		rows: ReadonlyArray<{readonly span: SpanRow; readonly content: string | null}>,
	): Effect.Effect<number, SinkError> =>
		Effect.gen(function* () {
			const name = chainName(chain);
			let at = yield* attempt(() =>
				Option.match(
					Option.fromUndefinedOr(sql.exec(`SELECT part FROM parts WHERE chain = ?`, name)[0]),
					{
						onNone: () => 0,
						onSome: (row) => decodePart(row).part,
					},
				),
			);
			let left = rows;
			let sent = 0;
			while (left.length > 0) {
				const answer = yield* records.write(chain, at, left);
				const landed = answer._tag === "written" ? left.map((row) => row.span.spanId) : answer.had;
				const next = at + 1;
				yield* attempt(() => {
					for (const spanId of landed) sql.exec(`DELETE FROM unsent WHERE "spanId" = ?`, spanId);
					if (answer._tag === "rolled")
						sql.exec(
							`INSERT INTO parts (chain, part) VALUES (?, ?)
							ON CONFLICT (chain) DO UPDATE SET part = excluded.part`,
							name,
							next,
						);
				});
				sent += landed.length;
				if (answer._tag === "written") return sent;
				const had = new Set(answer.had);
				left = left.filter((row) => !had.has(row.span.spanId));
				at = next;
			}
			return sent;
		});

	const flush = Effect.gen(function* () {
		if (met || held.length > 0) {
			met = false;
			return yield* Effect.fail(new SinkError({why: "storage", held: held.length}));
		}
		const records = yield* RecordManager;
		const unsent = yield* attempt(() =>
			sql.exec(`SELECT * FROM unsent ORDER BY rowid`).map((row) => decodeUnsent(row)),
		);
		const chains = new Map<
			string,
			{chain: Chain; rows: Array<{span: SpanRow; content: string | null}>}
		>();
		for (const {chain, row, content} of unsent) {
			const name = chainName(chain);
			const group = chains.get(name) ?? {chain, rows: []};
			group.rows.push({span: row, content});
			chains.set(name, group);
		}
		let sent = 0;
		for (const {chain, rows} of chains.values()) {
			for (let from = 0; from < rows.length; from += BATCH)
				sent += yield* send(records, chain, rows.slice(from, from + BATCH));
		}
		const now = yield* Effect.clockWith((clock) => Effect.succeed(clock.currentTimeMillisUnsafe()));
		yield* archiveDays(sql, who.object, now);
		return {sent};
	});

	const summaries = (from: number, to: number) =>
		Effect.clockWith((clock) => {
			const now = clock.currentTimeMillisUnsafe();
			const done = commit([], now, false);
			return Result.isFailure(done)
				? Effect.fail(new SinkError({why: "storage", held: held.length}))
				: attempt(() => readSummaries(sql, from, to));
		});

	return {tracer, sink: {flush, summaries}};
};
