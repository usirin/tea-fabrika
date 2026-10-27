import {
	arbMsg,
	arbMsgSequence,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	propertyInvariant,
	propertyTrace,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import type {MsgOf} from "../program/program.ts";
import {memoryStorage} from "../program/storage.ts";
import {tally} from "./small.ts";

// The laws of tally's running total, the one machine of the small programs, on tea's pbt: after
// every step of any list of numbers, from the real init. The machine, `count`, is reached through
// the program, as a host reaches it.

const count = tally.machines.count.machine;
type Count = typeof count;
type Msg = MsgOf<Count>;

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	add: arbRecordMsg("add", {n: fc.integer({min: -50, max: 50})}),
};
const lists = arbMsgSequence(arbMsg(table), {maxLength: 40});
const OPTS = {numRuns: 300, seed: 1};
const ctx = stubCtxThrowingProxy<undefined>();
const sum = (steps: readonly {readonly msg: Msg}[]) => steps.reduce((t, s) => t + s.msg.n, 0);

/** A total kept by an earlier run of tally, under the same run id. */
const KEPT = {total: 7};

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: Count) => void;
}

const addsIt: Law = {
	name: "each number told moves the total by exactly that number, and asks for no work",
	check: (machine) =>
		propertyInvariant(
			machine,
			ctx,
			lists,
			({prev, msg, next, cmds}) => next.total === prev.total + msg.n && cmds.length === 0,
			OPTS,
		),
};

const sumsAll: Law = {
	name: "from a fresh start, the total is the sum of every number told",
	check: (machine) =>
		propertyTrace(machine, ctx, lists, (steps, last) => last.total === sum(steps), OPTS),
};

const goesOn: Law = {
	name: "started again on a kept total, it goes on from that total",
	check: (machine) =>
		propertyTrace(machine, ctx, lists, (steps, last) => last.total === KEPT.total + sum(steps), {
			...OPTS,
			loaded: KEPT,
		}),
};

/** Any number tally's input takes: a safe whole number, the whole range. */
const anyNumber: MsgArbitraryTable<Msg> = {add: arbRecordMsg("add", {n: fc.maxSafeInteger()})};
const anyAdd = arbMsgSequence(arbMsg(anyNumber), {maxLength: 5});

const staysSafe: Law = {
	name: "for any number the input takes, an add past the safe whole numbers leaves the total as it was, and any other moves it by that number",
	check: (machine) =>
		propertyInvariant(
			machine,
			ctx,
			anyAdd,
			({prev, msg, next, cmds}) =>
				cmds.length === 0 &&
				next.total === (Number.isSafeInteger(prev.total + msg.n) ? prev.total + msg.n : prev.total),
			OPTS,
		),
};

const LAWS = [addsIt, sumsAll, goesOn, staysSafe];

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
const addsTwice: Count = {...count, update: {add: (s, m) => [{total: s.total + 2 * m.n}, []]}};
const startsAtOne: Count = {...count, init: (loaded) => [loaded ?? {total: 1}, []]};
const forgetsTheKept: Count = {...count, init: () => [{total: 0}, []]};
/** tally's add before it had a rule: the sum, whatever it is. */
const noRule: Count = {...count, update: {add: (s, m) => [{total: s.total + m.n}, []]}};

describe("tally's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(count);
	});

	it("each law is seen to fail on a planted mistake", () => {
		expect(broken(addsTwice)).toEqual([addsIt.name, sumsAll.name, goesOn.name, staysSafe.name]);
		expect(broken(startsAtOne)).toEqual([sumsAll.name]);
		expect(broken(forgetsTheKept)).toEqual([goesOn.name]);
		expect(broken(noRule)).toEqual([staysSafe.name]);
	});
});

// ---------------------------------------------------------------- law: every reachable total is kept

/** The schema the program keeps the total through, as the program declares it. */
const State = tally.machines.count.state;

/** Every total `machine` reaches from its init, saved through the program's schema and loaded back. */
const keepsEvery = (machine: Count, msgs: fc.Arbitrary<readonly Msg[]>, runs = 150) =>
	fc.assert(
		fc.asyncProperty(msgs, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("tally:r1", null));
			const store = handle.store("count", "total", State);
			for (const total of foldEvents(machine, ctx, null, list).states) {
				await store.save(total);
				expect(store.migrate(await store.load())).toEqual(total);
			}
		}),
		{numRuns: runs, seed: 1},
	);

describe("tally's total is kept", () => {
	it("every total it reaches from its init saves and loads back equal, for the numbers above", async () => {
		await keepsEvery(count, lists);
	});

	// A known bug until tally's add kept to the safe whole numbers: two numbers the input takes added
	// up to one that is not, the total left its own schema, and the save killed the run.
	it("every total it reaches from its init saves and loads back equal, for any number the input takes", async () => {
		await keepsEvery(count, anyAdd, 100);
	});

	it("the law is seen to fail on a planted mistake: a total that adds half of each number dies at its first save that is not whole", async () => {
		const addsHalf: Count = {...count, update: {add: (s, m) => [{total: s.total + m.n / 2}, []]}};
		await expect(keepsEvery(addsHalf, lists, 20)).rejects.toThrow(/Counterexample/);
	});

	it("the law for any number is seen to fail on a planted mistake: an add with no rule carries two large numbers past the safe range, and its save is refused", async () => {
		const first = -4220048110695276;
		const second = -4787151144045716;
		await expect(keepsEvery(noRule, anyAdd, 100)).rejects.toThrow(
			`Counterexample: [[{"type":"add","n":${first}},{"type":"add","n":${second}}]]`,
		);
		// Why: each number is one the input takes, and their sum is not a safe whole number.
		expect([first, second].every(Number.isSafeInteger)).toBe(true);
		const handle = await Effect.runPromise(memoryStorage().open("tally:r1", null));
		await expect(
			handle.store("count", "total", State).save({total: first + second}),
		).rejects.toThrow("does not fit its own schema");
	});
});
