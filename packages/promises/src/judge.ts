import type {Entry, Piece, Verdict} from "./record.ts";
import {piecesOf} from "./record.ts";

// What the gate and the list make of one promise, from facts already read
// (experiment 117). Pure: the reading is in `node.ts`.
//
//   judge({id, entry, before, now, check, plant})
//   // => {id, green: false, problems: [{why: "stale", pieces: ["...#createShip"]}], exam: []}
//
// A promise is green when three things hold at the head:
// - in step: every piece it names prints what its record says;
// - the check held;
// - the planted break, run through the same command, was caught.
// Anything else is a problem, and a problem fails the gate. A change to the
// exam (the check, its plant, the record's own words) is not a problem: it is
// marked for the owner.

/** How one run of a check command went. */
export type Ran =
	| {readonly kind: "verdict"; readonly verdict: Verdict; readonly ms: number}
	| {readonly kind: "none"; readonly why: string; readonly ms: number};

export interface Facts {
	readonly id: string;
	readonly entry: Entry;
	/** The record at the base. `null`: new in this change. `"unknown"`: no base was given. */
	readonly before: Entry | null | "unknown";
	/** Each piece's print at the head. `null`: the file or the block is not there. */
	readonly now: Readonly<Record<Piece, string | null>>;
	readonly check: Ran;
	readonly plant: Ran;
}

export type Problem =
	/** A piece the record names is not in the code: renamed, moved or deleted. */
	| {readonly why: "gone"; readonly pieces: readonly Piece[]}
	/** The code a piece names changed since the record was confirmed. */
	| {readonly why: "stale"; readonly pieces: readonly Piece[]; readonly commit: string}
	/** The check ran and the promise broke at the head. */
	| {readonly why: "red"; readonly verdict: Verdict}
	/** The planted break ran and the check did not catch it: the check cannot fail. */
	| {readonly why: "not_caught"; readonly verdict: Verdict}
	/** A command gave no verdict, or one for something else. */
	| {
			readonly why: "no_verdict";
			readonly which: "check" | "plant";
			readonly detail: string;
	  };

/** What changed in the exam, against the base, in words. */
export type ExamChange = string;

export interface Judged {
	readonly id: string;
	readonly entry: Entry;
	readonly green: boolean;
	readonly problems: readonly Problem[];
	/** Changes to the exam the owner must say yes to. Empty: none, or no base to compare. */
	readonly exam: readonly ExamChange[];
	/** The record was confirmed again in this change. */
	readonly moved: boolean;
	readonly check: Ran;
	readonly plant: Ran;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What a change did to the exam: everything in a record except `confirmed`, and every exam piece's print. */
export function examChanges(entry: Entry, before: Entry | null): readonly ExamChange[] {
	if (before === null) return ["a new promise"];
	const out: string[] = [];
	for (const key of ["promise", "harm", "tool", "check", "plant", "covers", "exam"] as const)
		if (!same(entry[key], before[key])) out.push(`its ${key} was changed`);
	for (const piece of entry.exam)
		if (
			before.confirmed.prints[piece] !== undefined &&
			entry.confirmed.prints[piece] !== before.confirmed.prints[piece]
		)
			out.push(`${piece} was changed`);
	return out;
}

export function judge(f: Facts): Judged {
	const problems: Problem[] = [];
	const pieces = piecesOf(f.entry);
	const gone = pieces.filter((p) => f.now[p] === null || f.now[p] === undefined);
	if (gone.length > 0) problems.push({why: "gone", pieces: gone});
	const stale = pieces.filter((p) => !gone.includes(p) && f.now[p] !== f.entry.confirmed.prints[p]);
	if (stale.length > 0)
		problems.push({why: "stale", pieces: stale, commit: f.entry.confirmed.commit});

	const checked = f.entry.check;
	if (f.check.kind === "none")
		problems.push({why: "no_verdict", which: "check", detail: f.check.why});
	else if (f.check.verdict.plant !== null)
		problems.push({
			why: "no_verdict",
			which: "check",
			detail: `it ran the plant ${f.check.verdict.plant}, not the real code`,
		});
	else if (!f.check.verdict.held) problems.push({why: "red", verdict: f.check.verdict});

	const asked = f.entry.plant.name;
	if (f.plant.kind === "none")
		problems.push({why: "no_verdict", which: "plant", detail: f.plant.why});
	else if (f.plant.verdict.plant !== asked)
		problems.push({
			why: "no_verdict",
			which: "plant",
			detail: `asked for the plant ${asked}, it ran ${f.plant.verdict.plant ?? "the real code"}`,
		});
	else if (f.check.kind === "verdict" && f.plant.verdict.checked !== f.check.verdict.checked)
		problems.push({
			why: "no_verdict",
			which: "plant",
			detail: `the plant checked "${f.plant.verdict.checked}", the check "${f.check.verdict.checked}" (${checked})`,
		});
	else if (f.plant.verdict.held) problems.push({why: "not_caught", verdict: f.plant.verdict});

	const before = f.before === "unknown" ? undefined : f.before;
	return {
		id: f.id,
		entry: f.entry,
		green: problems.length === 0,
		problems,
		exam: before === undefined ? [] : examChanges(f.entry, before),
		moved: before !== undefined && (before === null || !same(before.confirmed, f.entry.confirmed)),
		check: f.check,
		plant: f.plant,
	};
}

/** A promise that was in the base and is not at the head: a change to the exam too. */
export interface Removed {
	readonly id: string;
	readonly promise: string;
}
