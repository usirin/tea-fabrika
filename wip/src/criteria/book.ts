import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";

// A plan's criteria, each under an id it keeps for life, with every wording
// it ever had and every verdict a review gave it. A plain fold over events,
// as tea's update is: the ledger (../asks/rules.ts) folds its facts through
// it, and the laws check (../laws/criteria.ts) walks it as a machine.
//
//   added      a criterion is created: by the plan, by the owner, or by a
//              review that found a problem no criterion covers. It gets the
//              next id, `c<n>`, and its first wording.
//   reworded   the same id says something else: a new version. It is open
//              again until a review judges the new version.
//   removed    the id is retired. Never given again.
//   judged     a review's verdict on one criterion: the version it read, the
//              commit it saw, pass or fail, and where the proof is.
//
//   let b = EMPTY;
//   b = apply(b, {type: "added", task: 1, text: "When ..., ...", by: "plan"});  // c1
//   b = apply(b, {type: "judged", verdict: {id: c1, version: 1, head: "A", grade: "pass", proof: "..."}});
//   standingAt(b, "A");   // [{id: "c1", version: 1, state: "met", ...}]
//
// Why a counter and not a hash of the words: an id must outlive a reword, so
// it cannot come from the words, and a counter in the book is the same on
// every replay of the same events. A place in the plan is never an id: a
// line put in before another moves no id here.

/** A criterion's id: `c1`, `c2`, ... Only the book gives one (`added`); a place in a list never is one. */
export const CriterionId = Schema.String.check(Schema.isPattern(/^c[1-9][0-9]*$/)).pipe(
	Schema.brand("CriterionId"),
);
export type CriterionId = typeof CriterionId.Type;

/** An id from its text, as a person or a log wrote it. Throws on anything the book could not have given. */
export const criterionId: (text: string) => CriterionId = Schema.decodeSync(CriterionId);

/** Which wording of a criterion: 1 when it was added, one more at each reword. */
export const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/** Who made or changed a criterion. */
export const BY = ["plan", "owner", "review"] as const;
export const By = Schema.Literals(BY);
export type By = typeof By.Type;

/** One wording of a criterion. */
export const Wording = Schema.Struct({version: Version, text: Schema.String, by: By});
export type Wording = typeof Wording.Type;

/** One criterion in the book. Its last wording is the one that holds now. */
export const Entry = Schema.Struct({
	id: CriterionId,
	/** The task it belongs to, by its place in the plan, from 1. */
	task: Schema.Int,
	wordings: Schema.NonEmptyArray(Wording),
});
export type Entry = typeof Entry.Type;

/** A review's verdict on one criterion, at one commit, for one of its wordings. */
export const Verdict = Schema.Struct({
	id: CriterionId,
	/** The wording the review judged. */
	version: Version,
	/** The commit the review saw. */
	head: Schema.String,
	grade: Schema.Literals(["pass", "fail"]),
	/** Where the proof is: the review that judged it, in words a person can follow. */
	proof: Schema.String,
});
export type Verdict = typeof Verdict.Type;

export const Book = Schema.Struct({
	/** The next id is `c<next>`. It only goes up, so no id is given twice. */
	next: Schema.Int,
	/** The criteria that hold now, in the order they were added. */
	live: Schema.Array(Entry),
	/** Removed ones, kept for their history. */
	retired: Schema.Array(Entry),
	/** Every verdict, oldest first. */
	verdicts: Schema.Array(Verdict),
});
export type Book = typeof Book.Type;

export const EMPTY: Book = {next: 1, live: [], retired: [], verdicts: []};

export type CriteriaMsg =
	| {readonly type: "added"; readonly task: number; readonly text: string; readonly by: By}
	| {readonly type: "reworded"; readonly id: CriterionId; readonly text: string; readonly by: By}
	| {readonly type: "removed"; readonly id: CriterionId}
	| {readonly type: "judged"; readonly verdict: Verdict};

const lastOf = (e: Entry): Wording => e.wordings[e.wordings.length - 1] ?? e.wordings[0];

/** The id the book gives next. */
export const nextId = (b: Book): CriterionId => criterionId(`c${b.next}`);

const added = (b: Book, m: Extract<CriteriaMsg, {type: "added"}>): Book => ({
	...b,
	next: b.next + 1,
	live: [
		...b.live,
		{id: nextId(b), task: m.task, wordings: [{version: 1, text: m.text, by: m.by}]},
	],
});

const reworded = (b: Book, m: Extract<CriteriaMsg, {type: "reworded"}>): Book => ({
	...b,
	live: b.live.map((e) => {
		const now = lastOf(e);
		if (e.id !== m.id || now.text === m.text) return e;
		return {...e, wordings: [...e.wordings, {version: now.version + 1, text: m.text, by: m.by}]};
	}),
});

const removed = (b: Book, m: Extract<CriteriaMsg, {type: "removed"}>): Book => {
	const gone = b.live.find((e) => e.id === m.id);
	return gone === undefined
		? b
		: {...b, live: b.live.filter((e) => e !== gone), retired: [...b.retired, gone]};
};

/** A verdict is kept only for an id the book gave, at a wording it had. */
const judged = (b: Book, m: Extract<CriteriaMsg, {type: "judged"}>): Book => {
	const {id, version} = m.verdict;
	const entry = [...b.live, ...b.retired].find((e) => e.id === id);
	if (entry === undefined || version > lastOf(entry).version) return b;
	return {...b, verdicts: [...b.verdicts, m.verdict]};
};

/** One event, folded in. Pure. */
export function apply(b: Book, m: CriteriaMsg): Book {
	switch (m.type) {
		case "added":
			return added(b, m);
		case "reworded":
			return reworded(b, m);
		case "removed":
			return removed(b, m);
		case "judged":
			return judged(b, m);
	}
}

/** The book as a tea machine: no Cmds, the events as Msgs. The ledger folds through `apply`, the same code. */
export const criteria = defineMachine({
	types: {model: {} as Book, msg: {} as CriteriaMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? EMPTY, []],
	update: {
		added: (s, m) => [added(s, m), []],
		reworded: (s, m) => [reworded(s, m), []],
		removed: (s, m) => [removed(s, m), []],
		judged: (s, m) => [judged(s, m), []],
	},
});

// ---------------------------------------------------------------- views

/** A criterion as it holds now: its id, its current version and that version's words. */
export interface Current {
	readonly id: CriterionId;
	readonly version: number;
	readonly text: string;
	readonly task: number;
}

/** Every criterion that holds now, in the order added. */
export const currentOf = (b: Book): readonly Current[] =>
	b.live.map((e) => {
		const {version, text} = lastOf(e);
		return {id: e.id, version, text, task: e.task};
	});

/** One criterion now: met or open at a head, and the verdict that says so. */
export interface Standing extends Current {
	readonly state: "met" | "open";
	/** The latest verdict at this head for this version. `null`: none. */
	readonly verdict: Verdict | null;
}

/**
 * Every criterion that holds now, met or open at `head`. Met only when the
 * latest verdict at `head` for its current version is a pass: a verdict for
 * an older wording or another commit says nothing about it.
 */
export const standingAt = (b: Book, head: string): readonly Standing[] =>
	currentOf(b).map((c) => {
		const verdict =
			b.verdicts.findLast((v) => v.id === c.id && v.version === c.version && v.head === head) ??
			null;
		return {...c, state: verdict?.grade === "pass" ? "met" : "open", verdict};
	});

/** Every wording a criterion had and every verdict it got, live or retired. `null`: the book never gave this id. */
export function historyOf(
	b: Book,
	id: CriterionId,
): {readonly wordings: readonly Wording[]; readonly verdicts: readonly Verdict[]} | null {
	const entry = [...b.live, ...b.retired].find((e) => e.id === id);
	return entry === undefined
		? null
		: {wordings: entry.wordings, verdicts: b.verdicts.filter((v) => v.id === id)};
}
