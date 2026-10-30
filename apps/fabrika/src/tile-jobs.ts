import type {Ended, Shell} from "@kampus/fabrika";
import {Schema} from "effect";

// A tile's jobs, as its tsh tells the desk: each job of the host's table that this tile's tsh
// started and that still runs, with when it began, and the last of them to end, with how. The
// host's table says which jobs there are (their `%n`, their line, and whether tsh waits for one);
// it keeps no times and forgets a job once it ends, so the two things it does not hold are noted
// here, as tsh sees them: when a job began running in this tile, and how its runs ended.
//
//   const watch = watchJobs(() => clock.currentTimeMillisUnsafe(), (jobs) => tell(jobs));
//   // tsh runs `counter`, and the table says [{n: 1, text: "counter", state: "running", ...}]
//   watch.table(table, mine)    tell {running: [{n: 1, text: "counter", since: 1000, foreground: true}], ended: null}
//   // the person closes the counter's view: its run ends, and the job leaves the table
//   watch.ran("counter-1a2b", {kind: "ended", unread: {}})
//   watch.table(table, mine)    tell {running: [], ended: {n: 1, text: "counter", how: "done", ...}}
//
// The run's end and the table's change come from two fibers, in either order: a job is said to
// have ended once it has left the table and each of its runs has said how it ended.

/** One job running in a tile: its `%n`, its line as typed, when it began, and whether tsh waits for it. */
export const JobNow = Schema.Struct({
	n: Schema.Int,
	text: Schema.String,
	/** Unix ms, by the host's clock: when this tile's tsh first saw it run. */
	since: Schema.Number,
	/** tsh waits for it, as a shell waits for its foreground job. Started with `&`, it is `false`. */
	foreground: Schema.Boolean,
});
export type JobNow = typeof JobNow.Type;

/** How a job ended, in the words a job's record uses: on its own, with a failure, or stopped. */
export const JobEnd = Schema.Literals(["done", "failed", "stopped"]);
export type JobEnd = typeof JobEnd.Type;

/** The last job of a tile to end: what it was, how it ended, and when. */
export const JobEnded = Schema.Struct({
	n: Schema.Int,
	text: Schema.String,
	how: JobEnd,
	/** Unix ms, by the host's clock. */
	since: Schema.Number,
	at: Schema.Number,
	foreground: Schema.Boolean,
});
export type JobEnded = typeof JobEnded.Type;

/** A tile's jobs: the ones running, oldest first, and the last one to end. */
export const TileJobs = Schema.Struct({
	running: Schema.Array(JobNow),
	ended: Schema.NullOr(JobEnded),
});
export type TileJobs = typeof TileJobs.Type;

export const NO_JOBS: TileJobs = {running: [], ended: null};

/** How a job ended, from how each of its runs did: one failure fails it, one stop stops it. */
export const endOf = (runs: readonly Ended<unknown>["kind"][]): JobEnd =>
	runs.includes("failed") ? "failed" : runs.includes("stopped") ? "stopped" : "done";

/** A job this tile's tsh saw run, kept until it has ended and been said. */
interface Seen {
	readonly n: number;
	readonly text: string;
	readonly runs: readonly string[];
	readonly since: number;
	foreground: boolean;
	/** It left the table: it ends once each run has said how. */
	left: boolean;
}

export interface JobWatch {
	/** The host's table changed, or a run of this tile's tsh was seen: `mine` has every run it started. */
	readonly table: (now: Shell.Jobs | null, mine: {readonly has: (run: string) => boolean}) => void;
	/** One run of this tile's tsh ended, this way. */
	readonly ran: (run: string, ended: Ended<unknown>) => void;
}

/** Watch one tile's jobs: `tell` hears them each time they change, by `clock`'s time. */
export const watchJobs = (clock: () => number, tell: (jobs: TileJobs) => void): JobWatch => {
	const seen = new Map<number, Seen>();
	const ends = new Map<string, Ended<unknown>["kind"]>();
	let ended: JobEnded | null = null;
	let said = "";
	const say = () => {
		const running = [...seen.values()]
			.filter((job) => !job.left)
			.sort((a, b) => a.n - b.n)
			.map((job) => ({n: job.n, text: job.text, since: job.since, foreground: job.foreground}));
		const jobs: TileJobs = {running, ended};
		const word = JSON.stringify(jobs);
		if (word === said) return;
		said = word;
		tell(jobs);
	};
	/** A job that left the table, once each of its runs said how it ended: it is the tile's last to end. */
	const settle = () => {
		for (const job of seen.values()) {
			if (!job.left) continue;
			const how = job.runs.flatMap((run) => {
				const end = ends.get(run);
				return end === undefined ? [] : [end];
			});
			if (how.length < job.runs.length) continue;
			seen.delete(job.n);
			for (const run of job.runs) ends.delete(run);
			ended = {
				n: job.n,
				text: job.text,
				how: endOf(how),
				since: job.since,
				at: clock(),
				foreground: job.foreground,
			};
		}
	};
	return {
		table: (now, mine) => {
			const own = (now?.jobs ?? []).filter((job) => job.stages.some((st) => mine.has(st.run)));
			for (const job of own) {
				if (job.state !== "running") continue;
				const known = seen.get(job.n);
				if (known === undefined || known.left) {
					seen.set(job.n, {
						n: job.n,
						text: job.text,
						runs: job.stages.map((st) => st.run),
						since: clock(),
						foreground: !job.background,
						left: false,
					});
					for (const st of job.stages) ends.delete(st.run);
				} else known.foreground = !job.background;
			}
			// A job of this tile no longer running in the table has ended, or was detached as tsh
			// stopped: only one that left the table ended.
			for (const job of seen.values()) {
				if (job.left) continue;
				const row = now?.jobs.find((j) => j.n === job.n);
				if (row === undefined) job.left = true;
				else if (row.state !== "running") seen.delete(job.n);
			}
			settle();
			say();
		},
		ran: (run, end) => {
			// A run of no job seen here: one whose job was detached, or never ran.
			if (![...seen.values()].some((job) => job.runs.includes(run))) return;
			ends.set(run, end.kind);
			settle();
			say();
		},
	};
};
