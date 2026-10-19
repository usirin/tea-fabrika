// "Ready to merge" as a value that can only exist with its proof.
//
// Today the ship gate reads a summary word (`reviews: "passed"`) and trusts
// it. A reader that says "passed" while one kind of review failed gets a
// merge (see experiment 90). Here the word is gone: the only way to hold a
// `ReadyToMerge` is to hand `readyToMerge` one verdict row per criterion,
// each pinned to the commit it judged, and checks green at that same commit.
// A sketch: nothing in the ship machine takes it yet (the wiring is listed in
// the experiment's write-up).

/** A criterion as the ticket states it, from the ledger. */
export interface Criterion {
	readonly n: number;
	readonly text: string;
}

/** One criterion's verdict, as the review recorded it, at one commit. */
export type Verdict = Criterion & {
	/** The commit the reviewer judged. */
	readonly head: string;
	readonly state: "met" | "open" | "unseen";
};

/** A verdict that says met. Only these go into a `ReadyToMerge`. */
export type Met = Criterion & {readonly head: string; readonly state: "met"};

/** The checks, as read at one commit. */
export interface Checks {
	readonly head: string;
	readonly state: "green" | "pending" | "red" | "stuck";
}

/** What `readyToMerge` needs. */
export interface Proof {
	readonly pr: string;
	/** The head the merge would land. */
	readonly head: string;
	/** Every criterion the ticket has now. Never empty: a ticket with none has nothing to prove. */
	readonly criteria: readonly [Criterion, ...Criterion[]];
	/** The verdict rows found, any order, any head. */
	readonly verdicts: readonly Verdict[];
	readonly checks: Checks;
}

/** Why not, one per thing missing. */
export type Refusal =
	| {readonly why: "no_verdict"; readonly n: number}
	| {readonly why: "not_met"; readonly n: number; readonly state: "open" | "unseen"}
	| {readonly why: "other_head"; readonly n: number; readonly head: string}
	| {readonly why: "other_words"; readonly n: number}
	| {readonly why: "checks"; readonly state: Checks["state"]; readonly head: string};

export type Readiness =
	| {readonly ready: ReadyToMerge}
	| {readonly refused: readonly [Refusal, ...Refusal[]]};

/** The verdict for one criterion at the head, or why there is none. */
function rowFor(c: Criterion, p: Proof): Met | Refusal {
	const mine = p.verdicts.filter((v) => v.n === c.n);
	const here = mine.filter((v) => v.head === p.head);
	const last = here.at(-1);
	if (last === undefined) {
		const other = mine.at(-1);
		return other === undefined
			? {why: "no_verdict", n: c.n}
			: {why: "other_head", n: c.n, head: other.head};
	}
	if (last.text !== c.text) return {why: "other_words", n: c.n};
	if (last.state !== "met") return {why: "not_met", n: c.n, state: last.state};
	return {n: c.n, text: c.text, head: last.head, state: "met"};
}

const isMet = (r: Met | Refusal): r is Met => !("why" in r);
const isRefusal = (r: Met | Refusal): r is Refusal => "why" in r;

/**
 * Proof that the pull request may merge at `head`. The constructor is
 * private and the rows sit in a `#` field, so TypeScript treats the class by
 * name, not by shape: no object literal, cast-free value or other class is
 * one. `ReadyToMerge.of` is the one way in.
 */
export class ReadyToMerge {
	readonly pr: string;
	readonly head: string;
	readonly #rows: readonly [Met, ...Met[]];

	private constructor(pr: string, head: string, rows: readonly [Met, ...Met[]]) {
		this.pr = pr;
		this.head = head;
		this.#rows = rows;
	}

	/** One met row per criterion, each at `head`, in the ticket's order. */
	get rows(): readonly [Met, ...Met[]] {
		return this.#rows;
	}

	/** Ready, or every reason it is not. Pure. */
	static of(p: Proof): Readiness {
		const [c, ...cs] = p.criteria;
		const first = rowFor(c, p);
		const rest = cs.map((k) => rowFor(k, p));
		const refused: Refusal[] = [first, ...rest].filter(isRefusal);
		if (p.checks.head !== p.head || p.checks.state !== "green")
			refused.push({why: "checks", state: p.checks.state, head: p.checks.head});
		const [why, ...more] = refused;
		if (why !== undefined) return {refused: [why, ...more]};
		if (!isMet(first)) return {refused: [first]};
		return {ready: new ReadyToMerge(p.pr, p.head, [first, ...rest.filter(isMet)])};
	}
}

export const readyToMerge = (p: Proof): Readiness => ReadyToMerge.of(p);

/** What the queue step takes: the proof, never a bare pull request and head. */
export const enqueueOf = (ready: ReadyToMerge): {readonly pr: string; readonly head: string} => ({
	pr: ready.pr,
	head: ready.head,
});
