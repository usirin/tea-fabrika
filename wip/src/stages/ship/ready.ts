import {Schema} from "effect";
import {Stated, Verdict} from "../../criteria/book.ts";
import type {CriterionId} from "../../ids.ts";

// "Ready to merge" as a value that can only exist with its proof.
//
// The ship gate used to read a summary word (`reviews: "passed"`) and trust
// it: a reader that said "passed" while one kind of review failed got a merge
// (experiment 90). Here the only way to hold a `ReadyToMerge` is to hand
// `ReadyToMerge.of` the criteria the ledger holds now and the verdict rows it
// kept, and have it find, for every criterion, a passing row on its current
// version at the head, and the checks green at that same head. The enqueue
// and merge Cmds take nothing else (./machine.ts), and neither does the code
// host's write (`CodeHostWrites`).
//
//   a new head        voids every row: they were judged at another commit
//   a reworded one    voids its row: it judged the old words (`old_version`)
//   a later fail      undoes an earlier pass at the same head
//
// It is plain data, as everything in a tea state and Cmd is: it can be kept,
// read back, hashed and replayed like the rest. What makes it more than its
// shape is a brand only this file can put on: a type, with no value behind it.

/** A criterion as the ledger holds it now: its id, its current version, and that version's words. */
export const Criterion = Stated;
export type Criterion = Stated;

/** One verdict, as the ledger keeps it: its own id, the criterion's, the version judged, the head, pass or fail, where the proof is. */
export const Row = Verdict;
export type Row = Verdict;

/** A row that says pass. Only these go into a `ReadyToMerge`. */
export type Met = Row & {readonly grade: "pass"};

/** The checks, as read at one commit. */
export const Checks = Schema.Struct({
	head: Schema.String,
	state: Schema.Literals(["green", "pending", "red", "stuck"]),
});
export type Checks = typeof Checks.Type;

/** What `ReadyToMerge.of` needs. */
export const Proof = Schema.Struct({
	pr: Schema.String,
	/** The head the merge would land. */
	head: Schema.String,
	/** The main commit the head was built and tested on: where it left the base branch. */
	tested: Schema.String,
	/** Every criterion the ledger holds now. Never empty: a ticket with none has nothing to prove. */
	criteria: Schema.NonEmptyArray(Criterion),
	/** The verdict rows the ledger kept, oldest first, any head, any version. */
	verdicts: Schema.Array(Row),
	checks: Checks,
});
export type Proof = typeof Proof.Type;

/** Why not, one per thing missing, each naming its criterion by id. */
export type Refusal =
	/** No row for it at all. */
	| {readonly why: "no_verdict"; readonly id: CriterionId}
	/** Its latest row on its current version at the head is a fail. */
	| {readonly why: "not_met"; readonly id: CriterionId}
	/** Rows for it, none at this head: the head moved since. */
	| {readonly why: "other_head"; readonly id: CriterionId; readonly head: string}
	/** Rows for it at this head, none on its current version: it was said again since. */
	| {readonly why: "old_version"; readonly id: CriterionId; readonly version: number}
	| {readonly why: "checks"; readonly state: Checks["state"]; readonly head: string};

export type Readiness =
	| {readonly ready: ReadyToMerge}
	| {readonly refused: readonly [Refusal, ...Refusal[]]};

/** The passing row for one criterion at the head, or why there is none. */
function rowFor(c: Criterion, p: Proof): Met | Refusal {
	const mine = p.verdicts.filter((v) => v.criterion === c.id);
	const here = mine.filter((v) => v.head === p.head);
	const last = here.findLast((v) => v.version === c.version);
	if (last === undefined) {
		const older = here.at(-1);
		if (older !== undefined) return {why: "old_version", id: c.id, version: older.version};
		const other = mine.at(-1);
		return other === undefined
			? {why: "no_verdict", id: c.id}
			: {why: "other_head", id: c.id, head: other.head};
	}
	return last.grade === "pass" ? {...last, grade: "pass"} : {why: "not_met", id: c.id};
}

const isRefusal = (r: Met | Refusal): r is Refusal => "why" in r;
const isMet = (r: Met | Refusal): r is Met => !isRefusal(r);

/** The brand. Declared, never made: no value outside this file can carry it. */
declare const proven: unique symbol;

/**
 * Proof that the pull request may merge at `head`: the criteria the ledger
 * held, and for each, in the same order, the passing row on its current
 * version at `head`. The checks were green there.
 *
 * No object literal is one, and no value shaped like one: it lacks the brand,
 * which only `isReady` gives, and only to a value whose rows prove every
 * criterion. `ReadyToMerge.of` is the way in; `revive` checks a kept one again.
 */
export type ReadyToMerge = {
	readonly pr: string;
	readonly head: string;
	/** The main commit `head` was built and tested on. */
	readonly tested: string;
	readonly criteria: readonly [Criterion, ...Criterion[]];
	readonly rows: readonly [Met, ...Met[]];
	readonly [proven]: true;
};

/** The second brand. Declared, never made, like the first. */
declare const onTip: unique symbol;

/**
 * A proof whose head was tested on main as main is now: `tested` is the tip.
 * The only thing a straight merge, with no merge queue to test the head on
 * top of main, takes (`CodeHostWrites.merge`). Only `ReadyToMerge.onMain`
 * puts the brand on, and only when the two commits are the same.
 */
export type OnMain = ReadyToMerge & {readonly [onTip]: true};

const Shape = Schema.Struct({
	pr: Schema.String,
	head: Schema.String,
	tested: Schema.String,
	criteria: Schema.NonEmptyArray(Criterion),
	rows: Schema.NonEmptyArray(Row),
});
const isShaped = Schema.is(Shape);

/**
 * Whether `u` is ready to merge: a pull request, a head, the criteria, and one
 * passing row per criterion, in order, on its version, at the head. What it
 * cannot see is the rows it was not given: whether a later fail stood beside
 * a pass is `of`'s to judge, from every row the ledger kept.
 */
function isReady(u: unknown): u is ReadyToMerge {
	if (!isShaped(u) || u.rows.length !== u.criteria.length) return false;
	return u.criteria.every((c, i) => {
		const r = u.rows[i];
		return (
			r !== undefined &&
			r.criterion === c.id &&
			r.version === c.version &&
			r.head === u.head &&
			r.grade === "pass"
		);
	});
}

export const ReadyToMerge = {
	/** Ready, or every reason it is not. Pure. */
	of(p: Proof): Readiness {
		const [c, ...cs] = p.criteria;
		const first = rowFor(c, p);
		const rest = cs.map((k) => rowFor(k, p));
		const refused: Refusal[] = [first, ...rest].filter(isRefusal);
		if (p.checks.head !== p.head || p.checks.state !== "green")
			refused.push({why: "checks", state: p.checks.state, head: p.checks.head});
		const [why, ...more] = refused;
		if (why !== undefined) return {refused: [why, ...more]};
		if (!isMet(first)) return {refused: [first]};
		const made = {
			pr: p.pr,
			head: p.head,
			tested: p.tested,
			criteria: p.criteria,
			rows: [first, ...rest.filter(isMet)],
		};
		// Every row was found met above, so the check holds: this is how the brand goes on, with no cast.
		if (!isReady(made)) throw new Error("ReadyToMerge.of made a value its own check refuses");
		return {ready: made};
	},

	/** One read back from a kept state: itself when it still proves every criterion, else `null`. */
	revive(kept: unknown): ReadyToMerge | null {
		return isReady(kept) ? kept : null;
	},

	/** The proof, when its head was tested on `tip`, the main commit as it is now; else `null`: main moved on since. */
	onMain(ready: ReadyToMerge, tip: string): OnMain | null {
		return isOnMain(ready, tip) ? ready : null;
	},
};

/** How the second brand goes on, with no cast: a proof whose tested main is the tip. */
function isOnMain(ready: ReadyToMerge, tip: string): ready is OnMain {
	return ready.tested === tip;
}

export const readyToMerge = (p: Proof): Readiness => ReadyToMerge.of(p);

/**
 * A `ReadyToMerge` as a schema, for a Cmd's input: it takes a value that
 * proves every criterion, checked when decoded, and nothing else. Its two
 * sides are the same type, as a Cmd's must be.
 */
export const Ready = Schema.declare(isReady, {
	description: "a ReadyToMerge, made by ReadyToMerge.of",
});
