import {describe, expect, it} from "vitest";
import {atTheDoor, atTheMergeDoor} from "./door.ts";
import type {ShipFacts} from "./facts.ts";
import {shipGate} from "./gate.ts";
import {type OnMain, ReadyToMerge} from "./ready.ts";
import {C1, C2, CRITERIA, filed, metAt, ON_TIP, rowOn, rowsAt, TICKET} from "./scripted.ts";

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
	main: ON_TIP,
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

	it("a straight merge: only a head tested on the main tip goes through; three mains, three answers", () => {
		const one = asked();
		const at = (tested: string, tip: string) => atTheMergeDoor(one, facts({main: {tested, tip}}));
		expect(at("main0", "main0")).toEqual({write: expect.objectContaining({tested: "main0"})});
		// Main moved on since the head left it: never merged, whatever the queue would have done.
		expect(at("main0", "main1")).toEqual({behind: {tested: "main0", tip: "main1"}});
		// The head took main in since the proof was made: the fresh proof names the main it was tested on.
		expect(at("main1", "main1")).toEqual({write: expect.objectContaining({tested: "main1"})});
		// A stale read is stale before it is behind.
		expect(
			atTheMergeDoor(one, facts({checks: "red", main: {tested: "main0", tip: "main1"}})),
		).toEqual({stale: expect.any(String)});
	});

	it("the proof a merge takes is made only on the tip: no other value is one", () => {
		const one = asked();
		expect(ReadyToMerge.onMain(one, one.tested)).toBe(one);
		expect(ReadyToMerge.onMain(one, "elsewhere")).toBeNull();
		// @ts-expect-error a proof that was not checked against the tip is not one a merge takes
		const notChecked: OnMain = one;
		expect(notChecked).toBe(one);
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
