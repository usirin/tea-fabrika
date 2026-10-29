import {defineMachine} from "@demlik/tea";
import {Schema, SchemaTransformation} from "effect";
import {runTraceId} from "../program/trace-id.ts";

// A host's job table (./host-jobs.ts opens it; tsh shows it). It holds what a
// job is (its line, and for each program in it the program's name, its flags,
// its run id and how it is wired to the next), never a handle to a running
// program. Handles live only in the process that started them; the table is
// kept in storage, so a host started again finds every job the last one had,
// under the same run ids, and a tsh can start each again on the same storage.
//
//   began       a line became a job: every stage started and running
//   stage_ended one program of a job ended; when the last has, the job leaves the table
//   detached    its starter left (or the host came back after a crash): no job of it runs now
//   attached    a detached job was started again under its run ids
//   foreground  a job running in the background was brought to the foreground, as bash's `fg`
//   dropped    a detached job was stopped for good: it leaves the table
//
// A job that ended is gone from the table, as a finished job is gone from a
// shell's `jobs`. What it said was printed while it ran.

/** One program of a job. `flags` as the program took them. */
export const StageRecord = Schema.Struct({
	program: Schema.String,
	flags: Schema.Record(Schema.String, Schema.Unknown),
	/** The run's id: its run in storage, the same at every start of the job. */
	run: Schema.String,
	/** Into the next stage of the job. `null` for the last. */
	wire: Schema.NullOr(Schema.Struct({output: Schema.String, input: Schema.String})),
	ended: Schema.Boolean,
});
export type StageRecord = typeof StageRecord.Type;

/** `running`: started by this tsh. `detached`: started by an earlier one, and not again yet. */
export const JobState = Schema.Literals(["running", "detached"]);
export type JobState = typeof JobState.Type;

export const Job = Schema.Struct({
	/** The job's number, `%n` on a line: the table's `next` when it began, so never one another job had. */
	n: Schema.Int,
	text: Schema.String,
	stages: Schema.NonEmptyArray(StageRecord),
	state: JobState,
	/** Started with `&`: the prompt came back while it ran. */
	background: Schema.Boolean,
});
export type Job = typeof Job.Type;

/** The number after every number in `jobs`: 1 for none. */
const after = (jobs: readonly Job[]): number => Math.max(0, ...jobs.map((job) => job.n)) + 1;

const Table = Schema.Struct({
	jobs: Schema.Array(Job),
	/**
	 * The number the next job gets. It only grows, so a number is never given twice, as WezTerm's
	 * and tmux's ids are not: a `%2` a person read an hour ago names the same job or none.
	 */
	next: Schema.Int,
});

/**
 * The table: its state's schema, which it is kept and read back through. A table kept before
 * `next` was has none, and reads back with `next` after every number in it. The numbers of jobs
 * that had ended before then are not known, so one of those may come again, once.
 */
export const Jobs = Schema.Struct({
	jobs: Schema.Array(Job),
	next: Schema.optionalKey(Schema.Int),
}).pipe(
	Schema.decodeTo(
		Table,
		SchemaTransformation.transform({
			decode: ({jobs, next}) => ({jobs, next: next ?? after(jobs)}),
			encode: (table) => table,
		}),
	),
);
export type Jobs = typeof Jobs.Type;

export type JobsMsg =
	| {
			readonly type: "began";
			readonly text: string;
			readonly stages: readonly [StageRecord, ...StageRecord[]];
			readonly background: boolean;
	  }
	| {readonly type: "stage_ended"; readonly run: string}
	/** `n`: one job, whose start again did not go; `null`: every job. */
	| {readonly type: "detached"; readonly n: number | null}
	| {readonly type: "attached"; readonly n: number; readonly background: boolean}
	/** A running job tsh now waits for, as bash's `fg`: the prompt waits for its end. */
	| {readonly type: "foreground"; readonly n: number}
	/** A detached job its owner stopped: it will not be started again. */
	| {readonly type: "dropped"; readonly n: number};

export const EMPTY: Jobs = {jobs: [], next: 1};

const step = (s: Jobs): [Jobs, []] => [s, []];

/** Each stage changed, and still at least one. */
const eachStage = (
	stages: Job["stages"],
	change: (stage: StageRecord) => StageRecord,
): Job["stages"] => {
	const [first, ...rest] = stages;
	return [change(first), ...rest.map(change)];
};

export const jobsMachine = defineMachine({
	types: {model: {} as Jobs, msg: {} as JobsMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? EMPTY, []],
	update: {
		began: (s, m) =>
			step({
				jobs: [
					...s.jobs,
					{
						n: s.next,
						text: m.text,
						stages: m.stages,
						state: "running",
						background: m.background,
					},
				],
				next: s.next + 1,
			}),
		stage_ended: (s, m) =>
			step({
				...s,
				jobs: s.jobs.flatMap((job) => {
					// A detached job's runs ended with the tsh that started them: it stays, to be started again.
					if (job.state !== "running" || !job.stages.some((st) => st.run === m.run)) return [job];
					const stages = eachStage(job.stages, (st) =>
						st.run === m.run ? {...st, ended: true} : st,
					);
					return stages.every((st) => st.ended) ? [] : [{...job, stages}];
				}),
			}),
		detached: (s, m) =>
			step({
				...s,
				jobs: s.jobs.map((job) =>
					m.n === null || job.n === m.n ? {...job, state: "detached" as const} : job,
				),
			}),
		attached: (s, m) =>
			step({
				...s,
				jobs: s.jobs.map((job) =>
					job.n === m.n && job.state === "detached"
						? {
								...job,
								state: "running" as const,
								background: m.background,
								stages: eachStage(job.stages, (st) => ({...st, ended: false})),
							}
						: job,
				),
			}),
		foreground: (s, m) =>
			step({
				...s,
				jobs: s.jobs.map((job) =>
					job.n === m.n && job.state === "running" ? {...job, background: false} : job,
				),
			}),
		dropped: (s, m) =>
			step({...s, jobs: s.jobs.filter((job) => job.n !== m.n || job.state !== "detached")}),
	},
});

/** The table's status line: `2 jobs: 1 running, 1 detached`. */
export const tableLine = (s: Jobs): string => {
	if (s.jobs.length === 0) return "no jobs";
	const running = s.jobs.filter((job) => job.state === "running").length;
	const detached = s.jobs.length - running;
	return `${s.jobs.length} job${s.jobs.length === 1 ? "" : "s"}: ${running} running, ${detached} detached`;
};

/** The job a word names: `%n`, `n`, or the run id of any of its programs. */
export function jobNamed(jobs: Jobs, word: string): Job | undefined {
	const n = /^%?(\d+)$/.exec(word)?.[1];
	if (n !== undefined) return jobs.jobs.find((job) => job.n === Number(n));
	return jobs.jobs.find((job) => job.stages.some((st) => st.run === word));
}

/** A job's trace id: its first run's (`runTraceId`). Its `JobRecord` is kept under it. */
export const traceIdOf = (job: Job): string => runTraceId(job.stages[0].run);
