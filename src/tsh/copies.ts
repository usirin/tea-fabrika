import type {Copy, InputQueue} from "../program/program.ts";
import type {Job} from "./jobs.ts";
import type {AnyRunning} from "./programs.ts";

// The rows `jobs` prints under a job: each copy of each machine its programs
// run, with the status line the program declared for it. Read from the run's
// handle, so only a job this tsh runs has them; a detached job shows its row
// alone.
//
//   [1] running   review-scripted &
//         #597: waiting on checks
//         #596: stuck: read_failed
//         #675: skipped (draft)
//
// Every copy that still runs has its row. A copy that ended keeps its row
// while the job is in the table, so a stuck one stays where its owner looks;
// past the newest `ENDED` of them, the older ended rows fold into one count.
// When a job runs more than one program, or a program more than one machine,
// each row is tagged with which.

/** How many ended copies of one machine keep their own row. */
export const ENDED = 5;
/** The widest row: tsh's one-line width. */
const WIDTH = 100;
const INDENT = "      ";

/** One machine's copies, in the order each was first shown: every live one, and the newest ended ones. */
export function shownCopies(copies: readonly Copy[]): {
	readonly rows: readonly Copy[];
	readonly folded: number;
} {
	const ended = copies.filter((c) => !c.live);
	const kept = new Set(ended.slice(-ENDED));
	const rows = copies.filter((c) => c.live || kept.has(c));
	return {rows, folded: copies.length - rows.length};
}

const cut = (row: string) => (row.length > WIDTH ? `${row.slice(0, WIDTH - 1)}…` : row);

/**
 * The rows under one job for a full line (experiment 79): a stage whose
 * input is full with a writer waiting on it, and the stage before it, whose
 * pipe is that writer. Like a full Unix pipe, neither is an error: the
 * reader is slow or stopped, and the writer sleeps until it makes room. They
 * go once room comes.
 *
 *   [1] running   seq --to 3000 | lazy
 *         seq   waiting for room: lazy's input n is full
 *         lazy  input n full: 1000 unread, 1 waiting
 *
 * A waiting writer on the first stage is tsh itself, offering a script's or
 * stdin's lines: only the full line shows.
 */
export function fullRows(job: Job, live: ReadonlyMap<string, AnyRunning>): readonly string[] {
	if (job.state === "detached") return [];
	const rows = job.stages.flatMap((stage, i) => {
		const queues: Readonly<Record<string, InputQueue>> = live.get(stage.run)?.run.queues() ?? {};
		const full = Object.entries(queues).filter(([, queue]) => queue.waiting > 0);
		const before = i === 0 ? undefined : job.stages[i - 1];
		const fed = full.find(([input]) => before?.wire?.input === input);
		return [
			...(before === undefined || fed === undefined
				? []
				: [
						{
							tag: before.program,
							text: `waiting for room: ${stage.program}'s input ${fed[0]} is full`,
						},
					]),
			...full.map(([input, queue]) => ({
				tag: stage.program,
				text: `input ${input} full: ${queue.length} unread, ${queue.waiting} waiting`,
			})),
		];
	});
	const width = Math.max(0, ...rows.map((r) => r.tag.length));
	return rows.map((r) => cut(`${INDENT}${r.tag.padEnd(width)}  ${r.text}`));
}

/** The rows under one job, from the handles of its runs this tsh holds. */
export function copyRows(job: Job, live: ReadonlyMap<string, AnyRunning>): readonly string[] {
	if (job.state === "detached") return [];
	const many = job.stages.length > 1;
	const machines = job.stages.flatMap((stage) => {
		const running = live.get(stage.run);
		if (running === undefined) return [];
		const names = Object.keys(running.run.program.machines);
		return names.flatMap((name) => {
			const view = running.run.machines[name];
			if (view === undefined) return [];
			const tag = [many ? stage.program : null, names.length > 1 ? name : null]
				.filter((t) => t !== null)
				.join(" ");
			return [{tag, copies: view.copies()}];
		});
	});
	const width = Math.max(0, ...machines.map((m) => m.tag.length));
	return machines.flatMap(({tag, copies}) => {
		const head = width === 0 ? INDENT : `${INDENT}${tag.padEnd(width)}  `;
		const {rows, folded} = shownCopies(copies);
		return [
			...(folded === 0 ? [] : [`${head}… ${folded} more ended`]),
			...rows.map((c) => cut(`${head}${c.line}`)),
		];
	});
}
