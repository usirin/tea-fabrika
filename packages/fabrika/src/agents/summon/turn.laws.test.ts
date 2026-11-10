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
import type {MsgOf} from "../../program/program.ts";
import {memoryStorage} from "../../program/storage.ts";
import {turnProgram} from "./turn.ts";

// The laws of the turn program's one machine, `turnState`, on tea's pbt. Today's version, the
// summon tryout (ticket 237). The machine keeps the turn in flight, so a restarted `turn` job
// picks the same turn up again instead of telling the agent a second time:
//
//   told {active: {name: "scout", run: "r1", turn: 3, began: 1000}}   active: that turn
//   ended                                                             active: null
//
// The machine is reached through the program, as a host reaches it. The prose the program hands
// the agent has its own law in turn.prose.laws.test.ts.

const turnState = turnProgram.machines.turn.machine;
type TurnMachine = typeof turnState;
type Msg = MsgOf<TurnMachine>;
type Turn = ReturnType<TurnMachine["init"]>[0];
type Active = NonNullable<Turn["active"]>;

const active: fc.Arbitrary<Active> = fc.record({
	name: fc.constantFrom("scout", "lead", "a-b"),
	run: fc.string({minLength: 1, maxLength: 6}),
	turn: fc.nat({max: 1000}),
	began: fc.integer({min: 0, max: 2_000_000_000_000}),
});

/** One entry per Msg type: leaving one out does not compile. */
const table: MsgArbitraryTable<Msg> = {
	told: arbRecordMsg("told", {active}),
	ended: fc.constant({type: "ended"} as const),
};

const lists = arbMsgSequence(arbMsg(table), {maxLength: 30});
/** Seed 119120: the shared one (AGENTS.md). */
const OPTS = {numRuns: 300, seed: 119120};
const ctx = stubCtxThrowingProxy<undefined>();

/** The turn in flight after `msgs`, read from the Msgs alone: the last told, unless it ended. */
const expected = (start: Active | null, msgs: readonly Msg[]): Active | null =>
	msgs.reduce<Active | null>((_now, m) => (m.type === "told" ? m.active : null), start);

/** A turn kept by an earlier process of the same job. */
const KEPT: Turn = {active: {name: "scout", run: "r1", turn: 3, began: 1000}};

interface Law {
	readonly name: string;
	/** Throws when `machine` breaks the law, with the shortest list that does. */
	readonly check: (machine: TurnMachine) => void;
}

const eachStep: Law = {
	name: "told makes the told turn the one in flight, ended leaves none, and neither asks for work",
	check: (machine) =>
		propertyInvariant(
			machine,
			ctx,
			lists,
			({msg, next, cmds}) =>
				cmds.length === 0 &&
				(msg.type === "told" ? next.active === msg.active : next.active === null),
			OPTS,
		),
};

const fromFresh: Law = {
	name: "from a fresh start, the turn in flight is the last one told, unless an ended came after it",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(steps, last) =>
				JSON.stringify(last.active) ===
				JSON.stringify(
					expected(
						null,
						steps.map((s) => s.msg),
					),
				),
			{...OPTS, failOnNeverActed: true},
		),
};

const goesOn: Law = {
	name: "started again on a kept turn, it holds that turn until a Msg moves it",
	check: (machine) =>
		propertyTrace(
			machine,
			ctx,
			lists,
			(steps, last) =>
				JSON.stringify(last.active) ===
				JSON.stringify(
					expected(
						KEPT.active,
						steps.map((s) => s.msg),
					),
				),
			{...OPTS, loaded: KEPT},
		),
};

const LAWS = [eachStep, fromFresh, goesOn];

/** The names of the laws `machine` breaks. */
const broken = (machine: TurnMachine): readonly string[] =>
	LAWS.filter((law) => {
		try {
			law.check(machine);
			return false;
		} catch {
			return true;
		}
	}).map((law) => law.name);

// Planted mistakes: the real machine with one part changed.
const keepsTheFirst: TurnMachine = {
	...turnState,
	update: {...turnState.update, told: (s, m) => [{active: s.active ?? m.active}, []]},
};

const neverEnds: TurnMachine = {...turnState, update: {...turnState.update, ended: (s) => [s, []]}};
const startsBusy: TurnMachine = {...turnState, init: (loaded) => [loaded ?? KEPT, []]};
const forgetsTheKept: TurnMachine = {...turnState, init: () => [{active: null}, []]};

describe("turnState's laws", () => {
	it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
		law.check(turnState);
	});

	it("each law is seen to fail on a planted mistake", () => {
		expect(broken(keepsTheFirst)).toEqual([eachStep.name, fromFresh.name, goesOn.name]);
		expect(broken(neverEnds)).toEqual([eachStep.name, fromFresh.name, goesOn.name]);
		expect(broken(startsBusy)).toEqual([fromFresh.name]);
		expect(broken(forgetsTheKept)).toEqual([goesOn.name]);
	});
});

// ---------------------------------------------------------------- law: every reachable turn is kept

/** The schema the program keeps the turn through, as the program declares it. */
const State = turnProgram.machines.turn.state;

/** Every state `machine` reaches from its init, saved through the program's schema and loaded back. */
const keepsEvery = (machine: TurnMachine, runs = 150) =>
	fc.assert(
		fc.asyncProperty(lists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("turn:r1", null));
			const store = handle.store("turn", "turn", State);

			for (const state of foldEvents(machine, ctx, null, list).states) {
				await store.save(state);
				expect(store.migrate(await store.load())).toEqual(state);
			}
		}),
		{numRuns: runs, seed: 119120},
	);

describe("turnState's turn is kept", () => {
	it("every state it reaches from its init saves and loads back equal", async () => {
		await keepsEvery(turnState);
	});

	it("the law is seen to fail on a planted mistake: a told that keeps half a turn number is refused at its save", async () => {
		const halfTurn: TurnMachine = {
			...turnState,
			update: {
				...turnState.update,
				told: (_s, m) => [{active: {...m.active, turn: m.active.turn + 0.5}}, []],
			},
		};
		await expect(keepsEvery(halfTurn, 20)).rejects.toThrow(/Counterexample/);
	});
});
