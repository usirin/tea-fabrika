import {describe, expect, it} from "vitest";
import {atTheDoor} from "./door.ts";
import type {ShipFacts} from "./facts.ts";
import {shipGate} from "./gate.ts";
import type {ReadyToMerge} from "./ready.ts";
import {C1, C2, CRITERIA, filed, metAt, rowOn, rowsAt, TICKET} from "./scripted.ts";

// The door of a write on its own: the proof the Cmd carried, the facts read
// again, and what goes through.

const PR = "https://github.com/example/repo/pull/7";
const clear: ShipFacts = {
	head: "abc1234",
	state: "open",
	ours: true,
	ticket: {id: TICKET, link: "closes_it"},
	approval: "not_needed",
	reviews: [{kind: "review-code", verdict: "passed"}],
	checks: "green",
	mergeable: "clean",
	comments: [],
	criteria: CRITERIA,
	verdicts: metAt("abc1234"),
};
const facts = (patch: Partial<ShipFacts> = {}): ShipFacts => ({...clear, ...patch});

/** The proof the machine's read made, as the Cmd carries it. */
const asked = (): ReadyToMerge => {
	const gate = shipGate(PR, clear);
	if (gate.answer !== "go") throw new Error("the clear facts go");
	return gate.ready;
};

describe("the door of a write: the facts read again decide, never the Cmd's", () => {
	it("nothing changed: the write goes through with a proof made from the fresh read", () => {
		const door = atTheDoor(asked(), facts());
		expect("write" in door && door.write.head).toBe("abc1234");
	});

	it("a later passing row at the head: the proof written carries it, not the rows the Cmd had", () => {
		const later = filed([...rowsAt("abc1234"), rowOn(C1, "abc1234", "pass")]);
		const door = atTheDoor(asked(), facts({verdicts: later}));
		if (!("write" in door)) throw new Error("it goes through");
		expect(door.write.rows).not.toEqual(asked().rows);
	});

	// Each way the world can change between the read and the write, and that the write is refused for it.
	const CHANGED: readonly {readonly name: string; readonly patch: Partial<ShipFacts>}[] = [
		{
			name: "a failing row filed after the read, on the same head",
			patch: {verdicts: filed([...rowsAt("abc1234"), rowOn(C2, "abc1234", "fail")])},
		},
		{name: "a failed review", patch: {reviews: [{kind: "review-code", verdict: "failed"}]}},
		{name: "the checks went red", patch: {checks: "red"}},
		{name: "the checks run again", patch: {checks: "pending"}},
		{name: "a new head", patch: {head: "def5678", verdicts: metAt("def5678")}},
		{name: "a new open comment", patch: {comments: [{id: "c1", by: "person"}]}},
		{name: "closed", patch: {state: "closed"}},
	];
	for (const {name, patch} of CHANGED)
		it(`${name}: nothing is written, and the machine is told the read is stale`, () => {
			expect(atTheDoor(asked(), facts(patch))).toEqual({stale: expect.any(String)});
		});

	it("asked three times over the same proof as the rows grow: only the reads that still prove it go through", () => {
		const one = asked();
		const fail = rowOn(C2, "abc1234", "fail");
		const pass = rowOn(C2, "abc1234", "pass");
		const reads = [
			facts(),
			facts({verdicts: filed([...rowsAt("abc1234"), fail])}),
			// A pass filed after the fail is the latest row again: it proves the head once more.
			facts({verdicts: filed([...rowsAt("abc1234"), fail, pass])}),
		];
		expect(reads.map((f) => ("write" in atTheDoor(one, f) ? "write" : "stale"))).toEqual([
			"write",
			"stale",
			"write",
		]);
	});
});
