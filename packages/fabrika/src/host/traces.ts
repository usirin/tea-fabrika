import {Context, Duration, Effect, Layer, Schema, Stream, Tracer} from "effect";
import {KeyValueStore} from "effect/persistence";
import {RunRecord, type Storage, StorageBroken, storageOf} from "../program/storage.ts";

// A job's record, read: what `Traces.read(traceId)` answers. One host job (a tsh line, a lane,
// `hello world`) leaves one record, a Durable Object keyed by the job's trace id, the
// `runTraceId` of its first run (docs/direction/a-job-record-holds-its-trace.md).
//
//   const trace = yield* Traces.read(runTraceId("seq-3f9a1c02"));
//   trace.job      {n: 1, text: "seq --to 3 | tally", by: "user:owner", host: "laptop", started, ended: {how: "done", at}}
//   trace.runs     [{run: "seq-3f9a1c02", status: "ended", ...}, {run: "tally-5d02c7a1", machines: [{machine: "count", id: "total"}], ...}]
//   trace.spans    [{name: "seq --to 3 | tally", service: "tsh", ...}, {name: "run", service: "tally", events: [{name: "told add"}, ...]}, ...]
//   trace.steps    [{run: "tally-5d02c7a1", machine: "count", id: "total", n: 1, msg: {type: "add", n: 1}, state: {total: 1}, cmds: []}, ...]
//   trace.opened   [{run: "lane:700", span: "9f2c...", at, by}, ...]   spans still open, that others nest under
//
// The schemas are the record's read shape: the trace tile (#74) is built on them. The record
// itself is in ./job-record.ts (workerd) and ./job-rules.ts (its SQL); a program's runs write it
// through `jobStorage`, the same `Storage` every program takes.
//
// Spans keep names, tags and ids, never values (../program/trace.ts). Steps keep values: they are
// written by the run's own storage into this record, behind the door, never sent to a viewer
// elsewhere. A step's state never holds a secret: storage refuses one (../program/secrets.ts).

/** A trace's id: 32 lowercase hex characters, as OpenTelemetry writes it. */
export const TraceId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/));

/** A span's id: 16 lowercase hex characters. */
export const SpanId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/));

/** How a job ended. */
export const JobEnd = Schema.Literals(["done", "failed", "stopped"]);
export type JobEnd = typeof JobEnd.Type;

/** What was started and how it ended. Written by the host (#72): `null` in a record until it does. */
export const Job = Schema.Struct({
	/** The host's number for it: `%1`. */
	n: Schema.Int,
	/** What was started: the line as typed, or what the app started. */
	text: Schema.String,
	/** Who started it, as the door stamped the host's write (`user:<id>`, `agent:<id> for:<id>`). */
	by: Schema.String,
	/** Which host ran it. */
	host: Schema.String,
	/** Unix ms. */
	started: Schema.Number,
	/** `null`: still running. */
	ended: Schema.NullOr(Schema.Struct({how: JobEnd, at: Schema.Number})),
});
export type Job = typeof Job.Type;

/** A tag's value on a span or an event: OpenTelemetry's plain kinds. */
export const SpanTag = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
/** A span's or an event's tags, by name. */
export const SpanTags = Schema.Record(Schema.String, SpanTag);

/** A moment inside a span: `told add`, `sent n`, `msg add`. */
export const SpanEvent = Schema.Struct({
	name: Schema.String,
	/** Unix ms. */
	at: Schema.Number,
	tags: SpanTags,
});
export type SpanEvent = typeof SpanEvent.Type;

/** One span of the job's trace, from any host. */
export const Span = Schema.Struct({
	span: SpanId,
	/** `null`: a root span. One whose parent is not in the record hangs off a span nobody exported. */
	parent: Schema.NullOr(SpanId),
	name: Schema.String,
	/** Whose span it is (`service.name`): one colour per service in the tile. */
	service: Schema.String,
	/** Unix ms, to the microsecond. */
	start: Schema.Number,
	end: Schema.Number,
	status: Schema.Literals(["unset", "ok", "error"]),
	tags: SpanTags,
	events: Schema.Array(SpanEvent),
	/** Who sent it, as the door stamped the exporter. */
	by: Schema.String,
});
export type Span = typeof Span.Type;

/** One Msg one machine run folded: the Msg, the state after it, and the Cmds it started. */
export const Step = Schema.Struct({
	run: Schema.String,
	machine: Schema.String,
	id: Schema.String,
	/** 1, 2, 3 ... per machine run, across its restarts. */
	n: Schema.Int,
	/** Unix ms. */
	at: Schema.Number,
	msg: Schema.Unknown,
	/** As the machine's state schema encodes it. */
	state: Schema.Unknown,
	cmds: Schema.Array(Schema.Unknown),
	by: Schema.String,
});
export type Step = typeof Step.Type;

/**
 * A span a run's work hangs under, kept as it opens. A span reaches `spans` only once it ends,
 * so while a lane runs, its stages' spans name a parent that only this says: run `lane:700`, still
 * open. A child run started meanwhile nests under it the same way (`jobWrites`' `spanOf`).
 */
export const Opened = Schema.Struct({
	/** The run, or the hosted name, whose span it is. */
	run: Schema.String,
	span: SpanId,
	/** Unix ms. */
	at: Schema.Number,
	by: Schema.String,
});
export type Opened = typeof Opened.Type;

/** A job's whole record, read: what the trace tile draws. */
export const JobTrace = Schema.Struct({
	trace: TraceId,
	job: Schema.NullOr(Job),
	/** Each run's storage record: its status, flags and machine runs. */
	runs: Schema.Array(RunRecord),
	/** By start. */
	spans: Schema.Array(Span),
	/** By run, machine run and number. */
	steps: Schema.Array(Step),
	/** By when they opened. A run taken over has one per host that ran it, the newest last. */
	opened: Schema.Array(Opened),
});
export type JobTrace = typeof JobTrace.Type;

// ---------------------------------------------------------------- the wire

/**
 * One call to a job's record, as it crosses the door: `POST /<ledger>/job/<trace>` with one of
 * these as its body. The first six are its `Storage` (a `KeyValueStore` and its steps); the
 * door adds who sent it, never the body.
 */
export const JobCall = Schema.Union([
	Schema.Struct({op: Schema.Literal("get"), key: Schema.String}),
	Schema.Struct({op: Schema.Literal("set"), key: Schema.String, value: Schema.String}),
	Schema.Struct({op: Schema.Literal("remove"), key: Schema.String}),
	Schema.Struct({op: Schema.Literal("size")}),
	Schema.Struct({op: Schema.Literal("keys")}),
	Schema.Struct({
		op: Schema.Literal("step"),
		run: Schema.String,
		machine: Schema.String,
		id: Schema.String,
		at: Schema.Number,
		msg: Schema.Unknown,
		state: Schema.Unknown,
		cmds: Schema.Array(Schema.Unknown),
	}),
	Schema.Struct({
		op: Schema.Literal("began"),
		n: Schema.Int,
		text: Schema.String,
		host: Schema.String,
		at: Schema.Number,
	}),
	Schema.Struct({op: Schema.Literal("ended"), how: JobEnd, at: Schema.Number}),
	Schema.Struct({
		op: Schema.Literal("opened"),
		run: Schema.String,
		span: SpanId,
		at: Schema.Number,
	}),
	Schema.Struct({op: Schema.Literal("spanOf"), run: Schema.String}),
	Schema.Struct({op: Schema.Literal("read")}),
]);
export type JobCall = typeof JobCall.Type;

/** What the record answers a `read`: the runs by name only, read through `Storage` here. */
export const RecordRead = Schema.Struct({
	job: Schema.NullOr(Job),
	runs: Schema.Array(Schema.String),
	spans: Schema.Array(Span),
	steps: Schema.Array(Step),
	opened: Schema.Array(Opened),
});
export type RecordRead = typeof RecordRead.Type;

/** How one call reaches one job's record: over HTTP through the door, or past it in a test. */
export type RecordCalls = (trace: string, call: JobCall) => Effect.Effect<unknown, StorageBroken>;

const decodeAs =
	<A>(schema: Schema.Codec<A, unknown>, what: string) =>
	(answer: unknown) =>
		Schema.decodeUnknownEffect(schema)(answer).pipe(
			Effect.mapError((cause) => new StorageBroken({message: `the record's ${what}`, cause})),
		);

const Value = Schema.Struct({value: Schema.NullOr(Schema.String)});
const Size = Schema.Struct({size: Schema.Int});
const Keys = Schema.Struct({keys: Schema.Array(Schema.String)});

const kvError = (method: string, key?: string) => (e: StorageBroken) =>
	new KeyValueStore.KeyValueStoreError({
		method,
		message: e.message,
		...(key === undefined ? {} : {key}),
		cause: e,
	});

/** The record's `state` table as a `KeyValueStore`: what `Storage` sits on. */
const recordKv = (calls: RecordCalls, trace: string) =>
	KeyValueStore.makeStringOnly({
		get: (key) =>
			calls(trace, {op: "get", key}).pipe(
				Effect.flatMap(decodeAs(Value, "answer to get")),
				Effect.map((a) => a.value ?? undefined),
				Effect.mapError(kvError("get", key)),
			),
		set: (key, value) =>
			calls(trace, {op: "set", key, value}).pipe(
				Effect.asVoid,
				Effect.mapError(kvError("set", key)),
			),
		remove: (key) =>
			calls(trace, {op: "remove", key}).pipe(
				Effect.asVoid,
				Effect.mapError(kvError("remove", key)),
			),
		// Nothing in a record is ever deleted.
		clear: Effect.fail(
			new KeyValueStore.KeyValueStoreError({
				method: "clear",
				message: "a job's record is never cleared",
			}),
		),
		size: calls(trace, {op: "size"}).pipe(
			Effect.flatMap(decodeAs(Size, "answer to size")),
			Effect.map((a) => a.size),
			Effect.mapError(kvError("size")),
		),
		keys: calls(trace, {op: "keys"}).pipe(
			Effect.flatMap(decodeAs(Keys, "answer to keys")),
			Effect.map((a) => a.keys),
			Effect.mapError(kvError("keys")),
		),
	});

/**
 * The `Storage` of one job's runs, in its record: the same interface a program takes from
 * memory or a folder, and one step row per Msg each machine folds besides. Every run of the
 * job is handed this one, as tsh hands its storage to every run of a line today.
 */
export const jobStorage = (calls: RecordCalls, trace: string): Storage =>
	storageOf(
		Layer.succeed(KeyValueStore.KeyValueStore, recordKv(calls, trace)),
		(run, machine, id, step) =>
			calls(trace, {op: "step", run, machine, id, ...step}).pipe(Effect.asVoid),
	);

const SpanOf = Schema.Struct({span: Schema.NullOr(SpanId)});

/**
 * The host's writes to a job's record: when it started and how it ended, and the span each of
 * its runs' work hangs under, so a child run nests under its parent's. A span reaches the record
 * only once it ends; a lane's span is still open while its stages start.
 *
 *   const lane = yield* Effect.makeSpan("lane:700", {parent: traceOf("lane:700")});
 *   yield* job.opened("lane:700", lane.spanId, now);          // before any child can start
 *   const up = yield* job.spanOf("lane:700");                 // in the child's host
 *   start(build, {}).pipe(Effect.withParentSpan(up ?? traceOf("lane:700")));
 */
export const jobWrites = (calls: RecordCalls, trace: string) => ({
	began: (job: {
		readonly n: number;
		readonly text: string;
		readonly host: string;
		readonly at: number;
	}) => calls(trace, {op: "began", ...job}).pipe(Effect.asVoid),
	ended: (how: JobEnd, at: number) => calls(trace, {op: "ended", how, at}).pipe(Effect.asVoid),
	/** Keep the span `run`'s work hangs under. Kept before it returns. */
	opened: (run: string, span: string, at: number) =>
		calls(trace, {op: "opened", run, span, at}).pipe(Effect.asVoid),
	/** The newest span `run` opened, as a parent in this job's trace. `null`: it opened none. */
	spanOf: (run: string): Effect.Effect<Tracer.ExternalSpan | null, StorageBroken> =>
		calls(trace, {op: "spanOf", run}).pipe(
			Effect.flatMap(decodeAs(SpanOf, "answer to spanOf")),
			Effect.map((a) =>
				a.span === null
					? null
					: Tracer.externalSpan({traceId: trace, spanId: a.span, sampled: true}),
			),
		),
});

/** Reading a job's record failed: it could not be reached, or it answered what no record says. */
export class TraceUnread extends Schema.TaggedError<TraceUnread>()("TraceUnread", {
	trace: Schema.String,
	message: Schema.String,
}) {}

/** One job's record, read: the service the trace tile asks, so where the records live can change. */
export class Traces extends Context.Service<
	Traces,
	{
		readonly read: (trace: string) => Effect.Effect<JobTrace, TraceUnread>;
		/**
		 * The record now, then again after each write to it, for a reader that follows a job as it
		 * goes. Writes that come while a read is out are read together, once. It ends only on a read
		 * that fails.
		 */
		readonly watch: (trace: string) => Stream.Stream<JobTrace, TraceUnread>;
	}
>()("@kampus/fabrika-old/Traces") {}

/** How often a record that says nothing of its writes is read again while it is followed. */
export const POLL = Duration.seconds(1);

/**
 * A record's change notifications, as a watch in etcd or Kubernetes, or Postgres's LISTEN/NOTIFY:
 * one at once, then one after each write to it. Each is empty: it says only "read again". A
 * changes stream listens before its first one, so no write between the first read and the next
 * is missed.
 */
export type Changes = (trace: string) => Stream.Stream<void>;

/** Changes for records that say nothing of their writes: at once, then every `POLL`. */
export const polled: Changes = () => Stream.tick(POLL);

/**
 * A followed record: read at each change, the changes that came while a read was out folded into
 * one, so a burst of writes costs one read, not one each.
 */
export const watchOn = <E>(
	read: Effect.Effect<JobTrace, E>,
	changes: Stream.Stream<void>,
): Stream.Stream<JobTrace, E> =>
	changes.pipe(
		Stream.buffer({capacity: 1, strategy: "sliding"}),
		Stream.mapEffect(() => read),
	);

/**
 * `Traces` over the records `calls` reaches. A trace nobody wrote reads as an empty record.
 * `changes`: when a followed record is read again. A host's own records send one on each write
 * (`Records`, ./records.ts); records behind the door are polled.
 */
export const layerTraces = (calls: RecordCalls, changes: Changes = polled) =>
	Layer.succeed(Traces, tracesOn(calls, changes));

const tracesOn = (calls: RecordCalls, changes: Changes): Traces["Service"] => {
	const read = (trace: string) =>
		Effect.gen(function* () {
			const id = yield* Schema.decodeUnknownEffect(TraceId)(trace);
			const raw = yield* calls(id, {op: "read"}).pipe(Effect.flatMap(decodeAs(RecordRead, "read")));
			const storage = jobStorage(calls, id);
			const runs: RunRecord[] = [];
			for (const run of raw.runs) {
				const record = yield* storage.record(run);
				if (record !== null) runs.push(record);
			}
			return {
				trace: id,
				job: raw.job,
				runs,
				spans: raw.spans,
				steps: raw.steps,
				opened: raw.opened,
			};
		}).pipe(
			Effect.mapError(
				(e) =>
					new TraceUnread({
						trace,
						message: "message" in e ? String(e.message) : String(e),
					}),
			),
		);
	return Traces.of({read, watch: (trace) => watchOn(read(trace), changes(trace))});
};
