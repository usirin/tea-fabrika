import {
	arbConstantMsg,
	arbMsg,
	arbMsgSequence,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
import {describe, expect, it} from "vitest";
import {counter} from "./index.ts";

// The counter's laws, on tea's pbt: after every step of any list of presses, from the real init.
// Its one machine, `count`, is reached through the program, as a host reaches it.

const count = counter.machines.count.machine;
type Count = typeof count;
type Msg = MsgOf<Count>;

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {plus: arbConstantMsg("plus")};
const lists = arbMsgSequence(arbMsg(table), {maxLength: 40});
const OPTS = {numRuns: 300, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Count) => void;
}

const addsOne: Law = {
	name: "each press of +1 adds exactly one to the count, and asks for no work",
	check: (machine) =>
		propertyInvariant(
			machine,
			ctx,
			lists,
			({prev, next, cmds}) => next.n === prev.n + 1 && cmds.length === 0,
			OPTS,
		),
};

const countsEvery: Law = {
	name: "from the start, the count is how many presses of +1 came",
	check: (machine) =>
		propertyTrace(machine, ctx, lists, (steps, last) => last.n === steps.length, OPTS),
};

const LAWS = [addsOne, countsEvery];

/** The names of the laws `machine` breaks. */
const broken = (machine: Count): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// Planted mistakes: the real machine with one part changed.
const addsTwo: Count = {...count, update: {plus: (s) => [{n: s.n + 2}, []]}};
const startsAtOne: Count = {...count, init: (loaded) => [loaded ?? {n: 1}, []]};

describe("the counter's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(count);
	});

	it("each law is seen to fail on a planted mistake", () => {
		expect(broken(addsTwo)).toEqual([addsOne.name, countsEvery.name]);
		expect(broken(startsAtOne)).toEqual([countsEvery.name]);
	});
});
