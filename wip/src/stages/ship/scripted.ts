import {apply, type Book, type CriteriaMsg, criterionId, EMPTY} from "../../criteria/book.ts";
import {memoryRecord, ticketKey} from "../../criteria/record.ts";
import type {ShipFacts} from "./facts.ts";
import {ReadyToMerge} from "./ready.ts";

// A ticket's criteria and verdict rows, made up, for a test or a scripted run
// to stand in where the criteria record would answer: two criteria, the
// second said again once, and the rows that prove both at a head.

/** The ticket, as a pull request names it. */
export const TICKET = "example/repo#1";

type Criteria = NonNullable<ShipFacts["criteria"]>;
type Row = ShipFacts["verdicts"][number];

export const C1: Criteria[number] = {id: criterionId("c1"), version: 1, text: "every window opens"};
/** Said again once since the plan: only a row on its version 2 counts. */
export const C2: Criteria[number] = {
	id: criterionId("c2"),
	version: 2,
	text: "the door locks, from inside too",
};
export const CRITERIA: Criteria = [C1, C2];

/** One row on `c` at `head`: a pass on its current version unless told otherwise. */
export const rowOn = (
	c: Criteria[number],
	head: string,
	grade: Row["grade"] = "pass",
	version: number = c.version,
): Row => ({id: c.id, version, head, grade, proof: `the review at ${head}`});

/** A passing row per criterion, at `head`. */
export const metAt = (head: string): readonly Row[] => CRITERIA.map((c) => rowOn(c, head));

/** The facts a ticket that is proven at `head` adds to a pull request's. */
export const provenAt = (head: string) => ({criteria: CRITERIA, verdicts: metAt(head)});

/** The proof the gate makes for `pr` at `head` from `provenAt(head)`, with green checks there. */
export function readyAt(pr: string, head: string): ReadyToMerge {
	const r = ReadyToMerge.of({pr, head, ...provenAt(head), checks: {head, state: "green"}});
	if (!("ready" in r)) throw new Error(`the scripted rows do not prove ${pr} at ${head}`);
	return r.ready;
}

/** The book that holds `CRITERIA`, made the way a plan and an owner make it: c2 said, then said again. */
export const BOOK: Book = (
	[
		{type: "added", task: 1, text: C1.text, by: "plan"},
		{type: "added", task: 1, text: "the door locks", by: "plan"},
		{type: "reworded", id: C2.id, text: C2.text, by: "owner"},
	] satisfies readonly CriteriaMsg[]
).reduce(apply, EMPTY);

/**
 * A criteria record that holds `ticket` with `CRITERIA`, proven at each of
 * `heads`. No heads: it holds the criteria and no rows.
 */
export function recordOf(ticket: string, ...heads: readonly string[]) {
	const key = ticketKey(ticket);
	if (key === null) throw new Error(`${ticket} is not a ticket`);
	const book = heads
		.flatMap(metAt)
		.reduce((b, verdict) => apply(b, {type: "judged", verdict}), BOOK);
	return memoryRecord(new Map([[key, book]]));
}
