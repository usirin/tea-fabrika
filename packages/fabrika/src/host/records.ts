import {Clock, Effect, Semaphore} from "effect";
import type {StepLog, StorageBroken} from "../program/storage.ts";
import {jobTraceId} from "../program/trace.ts";
import type {JobsOnHost, JobTable} from "./host-jobs.ts";
import {type Job, type JobsMsg, traceIdOf} from "./jobs.ts";
import type {SpanRow} from "./otlp.ts";
import {type Changes, type JobEnd, jobWrites, layerTraces, type RecordCalls} from "./traces.ts";

// Where a host keeps its jobs' records, and how it fills them as its jobs go
// (docs/direction/a-job-record-holds-its-trace.md). One record per job, keyed by the job's trace
// id. Three writers fill it, each by the same key:
//
//   the job      `keepJobs`: the host's table, as tsh tells it, writes when a job began and how it ended
//   the steps    `stepsInto`: the runs' storage writes one step per Msg each kept machine folds
//   the spans    `recordTracing` (@kampus/fabrika/otel): each span, once it ends
//
//   const records = yield* sqliteRecords({dir: "<home>/records", by: "user:owner"});   // the laptop's
//   const jobs = keepJobs(yield* openJobs(fileStorage(dir, stepsInto(records))), records, "laptop");
//   tsh> seq --to 3 | tally            job %1 began; three steps of tally's count; four spans
//   yield* Traces.read(runTraceId(seq's run id))    // job, spans and steps, as the trace tile draws them
//
// A step and a span find their record the same way: by the trace they run in (`jobTraceId`). A
// run in a tsh line runs in its line's trace, which is its job's, so its steps and its spans
// always sit in one record. A machine run in no trace at all (the host's own table) writes no
// step anywhere.
//
// The records live where the host says: on the laptop, one SQLite file per job in its home
// (`sqliteRecords`, @kampus/fabrika/records), the same tables and SQL as the Durable Object
// (./job-rules.ts). Every write sends a change for the job, so a reader that follows the job
// (`Traces.watch`) reads it again at once.

/** A host's jobs' records: one per job, by its trace id. */
export interface Records {
	/** One call to one record (`JobCall`), as the door would hand it on. */
	readonly calls: RecordCalls;
	/** Keep ended spans of one trace in its record. A span kept again is the same span. */
	readonly keep: (trace: string, spans: readonly SpanRow[]) => Effect.Effect<void, StorageBroken>;
	/** A change at once, then one after each write to that trace's record. */
	readonly changes: Changes;
}

/** `Traces` over a host's own records: a followed record is read again on each write to it. */
export const layerRecordTraces = (records: Records) => layerTraces(records.calls, records.changes);

/**
 * Where a storage's steps go: into the record of the job the step's run is in. A step written in
 * no trace (a machine the host runs for itself) goes nowhere.
 */
export const stepsInto =
	(records: Records): StepLog =>
	(run, machine, id, step) =>
		Effect.flatMap(jobTraceId, (trace) =>
			trace === null
				? Effect.void
				: records.calls(trace, {op: "step", run, machine, id, ...step}).pipe(Effect.asVoid),
		);

/** The worse of two ends: a job with one failed run failed, and one with a stopped run stopped. */
const worse = (a: JobEnd, b: JobEnd): JobEnd => {
	const rank = {done: 0, stopped: 1, failed: 2} as const;
	return rank[b] > rank[a] ? b : a;
};

/** The job holding run `run`, in a table. */
const holding = (jobs: readonly Job[], run: string) =>
	jobs.find((job) => job.stages.some((st) => st.run === run));

/**
 * The host's jobs, with each job's record written as the table moves: `began` when tsh notes a
 * job, before its runs start, and `ended` when it leaves the table, with the worst way one of its
 * runs ended, or `stopped` when it was dropped. `host`: the name the record keeps for this host.
 * A write that fails is logged and let go: the table, and the job, go on without it.
 */
export const keepJobs = (jobs: JobsOnHost, records: Records, host: string): JobsOnHost => {
	const {table} = jobs;
	/** How each running job's runs have ended so far, by its trace. */
	const ends = new Map<string, JobEnd>();
	const write = (what: string, trace: string, writing: Effect.Effect<void, StorageBroken>) =>
		writing.pipe(
			Effect.catch((e) =>
				Effect.logWarning(`the record of ${trace} did not keep ${what}: ${e.message}`),
			),
		);
	const after = (msg: JobsMsg, before: readonly Job[]) =>
		Effect.gen(function* () {
			const now = table.getState().jobs;
			const at = yield* Clock.currentTimeMillis;
			if (msg.type === "began") {
				const job = holding(now, msg.stages[0].run);
				if (job === undefined) return;
				const trace = traceIdOf(job);
				yield* write(
					"its start",
					trace,
					jobWrites(records.calls, trace).began({n: job.n, text: job.text, host, at}),
				);
				return;
			}
			const job =
				msg.type === "stage_ended"
					? holding(before, msg.run)
					: msg.type === "dropped"
						? before.find((j) => j.n === msg.n && j.state === "detached")
						: undefined;
			if (job === undefined) return;
			const trace = traceIdOf(job);
			const how =
				msg.type === "stage_ended" ? worse(ends.get(trace) ?? "done", msg.how) : "stopped";
			if (now.some((j) => j.n === job.n)) {
				ends.set(trace, how);
				return;
			}
			ends.delete(trace);
			yield* write("its end", trace, jobWrites(records.calls, trace).ended(how, at));
		});
	// One Msg and its record write at a time, so each sees the table as its own Msg left it.
	const one = Semaphore.makeUnsafe(1).withPermits(1);
	const kept: JobTable = {
		getState: () => table.getState(),
		subscribe: (listener) => table.subscribe(listener),
		dispatch: (msg) =>
			Effect.gen(function* () {
				const before = table.getState().jobs;
				yield* table.dispatch(msg);
				yield* after(msg, before);
			}).pipe(one),
	};
	return {...jobs, table: kept};
};
