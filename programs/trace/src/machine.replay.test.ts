import {applyCell} from "@demlik/tea";
import {foldEvents, stubCtxThrowingProxy} from "@demlik/tea/pbt";
import type {JobTrace} from "@kampus/fabrika-old";
import {describe, expect, it} from "vitest";
import {type Model, type TraceMsg, trace} from "./machine.ts";
import {TALLY_ID, TALLY_STARTED} from "./tally.ts";
import {nodesOf, treeOf} from "./tree.ts";

// The trace's replay (docs/plan/replay-through-current-code.md, section 3). Today's version. A
// person asks to replay one machine run of the record shown through today's code: the machine
// holds the replay asked last, asks for it by one Cmd that carries that machine run's rows, and
// takes back the answer.
//
//   replay      {row}                  a machine run's row: held as {row, steps, answer: null}, and a
//                                      `replay` Cmd with its starts and steps. Any other row: nothing
//   replay_ok   {cmd, value}           tea's answer to that Cmd: it lands on the replay that asked
//   look        a newer id clears it; got keeps it while that machine run's step count is the same

const ctx = stubCtxThrowingProxy<undefined>();

/** The key of the row named `name` in a record's tree. */
const keyOf = (record: JobTrace, name: string): string => {
	const found = nodesOf(treeOf(record)).find((n) => n.name === name);
	if (found === undefined) throw new Error(`no row ${name}`);
	return found.key;
};

const COUNT = keyOf(TALLY_STARTED, "count total");
const OTHER_ID = "f".repeat(32);

const FIRST_STEP = TALLY_STARTED.steps[0] as JobTrace["steps"][number];
const FIRST_START = TALLY_STARTED.starts[0] as JobTrace["starts"][number];

/** tally's record with a second machine run of count beside count total, started and stepped. */
const TWO: JobTrace = {
	...TALLY_STARTED,
	steps: [...TALLY_STARTED.steps, {...FIRST_STEP, id: "other", at: FIRST_STEP.at + 1}],
	starts: [...TALLY_STARTED.starts, {...FIRST_START, id: "other"}],
};

/** The job view with `record` read, then these Msgs. */
const shown = (record: JobTrace = TALLY_STARTED, more: readonly TraceMsg[] = []): Model =>
	foldEvents(trace, ctx, null, [
		{type: "look", id: TALLY_ID},
		{type: "got", trace: record},
		...more,
	]).finalState;

const MATCHES = {_tag: "matches", steps: 3} as const;

/** `s` with `row` replayed: the state after, and the Cmd it asked by. */
const replayed = (s: Model, row: string) => {
	const [next, cmds] = applyCell<Model, TraceMsg, never>(trace, s, {type: "replay", row});
	return {next, cmds: cmds as readonly unknown[]};
};

/** tea's answer to a replay Cmd: the Cmd it answers, and the replay's answer. */
type ReplayOk = Extract<TraceMsg, {readonly type: "replay_ok"}>;
const okOf = (cmd: unknown, value: unknown): TraceMsg => ({
	type: "replay_ok",
	cmd: cmd as ReplayOk["cmd"],
	value: value as ReplayOk["value"],
	at: 0,
});

/** `s` with `row` replayed and answered with `value`. */
const answered = (s: Model, row: string, value: unknown): Model => {
	const {next, cmds} = replayed(s, row);
	const [after] = applyCell<Model, TraceMsg, never>(trace, next, okOf(cmds[0], value));
	return after;
};

describe("the trace machine's replay", () => {
	it("starts with no replay", () => {
		expect(foldEvents(trace, ctx, null, []).finalState.replay).toBeNull();
		expect(shown().replay).toBeNull();
	});

	it("holds a machine run's replay with its step count and no answer yet, and asks for it by one Cmd carrying that run's rows", () => {
		const {next, cmds} = replayed(shown(TWO), COUNT);
		expect(next.replay).toEqual({row: COUNT, steps: 3, answer: null});
		expect(cmds).toEqual([
			{
				type: "replay",
				row: COUNT,
				starts: TALLY_STARTED.starts,
				steps: TALLY_STARTED.steps,
			},
		]);
	});

	it("changes nothing, and asks nothing, for a row that is no machine run in the record", () => {
		const s = shown();
		const rows = nodesOf(treeOf(TALLY_STARTED))
			.filter((n) => n.kind !== "machine")
			.map((n) => n.key);
		for (const row of [...rows, "span:ffffffffffffffff", "machine:[]", ""]) {
			const {next, cmds} = replayed(s, row);
			expect(next, row).toBe(s);
			expect(cmds, row).toEqual([]);
		}
	});

	it("changes nothing before a record is read", () => {
		const s = foldEvents(trace, ctx, null, [{type: "look", id: TALLY_ID}]).finalState;
		const {next, cmds} = replayed(s, COUNT);
		expect(next).toBe(s);
		expect(cmds).toEqual([]);
	});

	it("takes the answer to the replay it holds", () => {
		expect(answered(shown(), COUNT, MATCHES).replay).toEqual({
			row: COUNT,
			steps: 3,
			answer: MATCHES,
		});
	});

	it("drops an answer for another row, or for a step count it no longer holds", () => {
		const {next, cmds} = replayed(shown(TWO), COUNT);
		const cmd = cmds[0] as {readonly row: string; readonly steps: readonly unknown[]};
		const otherRow = keyOf(TWO, "count other");
		const [forOther] = applyCell<Model, TraceMsg, never>(
			trace,
			next,
			okOf({...cmd, row: otherRow}, MATCHES),
		);
		expect(forOther).toBe(next);
		const [forFewer] = applyCell<Model, TraceMsg, never>(
			trace,
			next,
			okOf({...cmd, steps: cmd.steps.slice(0, 1)}, MATCHES),
		);
		expect(forFewer).toBe(next);
	});

	it("drops an answer when no replay is held", () => {
		const s = shown();
		const {cmds} = replayed(s, COUNT);
		const [after] = applyCell<Model, TraceMsg, never>(trace, s, okOf(cmds[0], MATCHES));
		expect(after).toBe(s);
	});

	it("asks again for a replay asked again, its old answer gone", () => {
		const done = answered(shown(), COUNT, MATCHES);
		const {next, cmds} = replayed(done, COUNT);
		expect(next.replay).toEqual({row: COUNT, steps: 3, answer: null});
		expect(cmds).toHaveLength(1);
	});

	it("clears the replay on a look at another record, and keeps it on a look at the same one", () => {
		const done = answered(shown(), COUNT, MATCHES);
		const [other] = applyCell<Model, TraceMsg, never>(trace, done, {type: "look", id: OTHER_ID});
		expect(other.replay).toBeNull();
		const [same] = applyCell<Model, TraceMsg, never>(trace, done, {type: "look", id: TALLY_ID});
		expect(same).toBe(done);
	});

	it("keeps the replay through a newer read while its machine run's step count is the same", () => {
		const done = answered(shown(), COUNT, MATCHES);
		const [again] = applyCell<Model, TraceMsg, never>(trace, done, {
			type: "got",
			trace: {...TALLY_STARTED, steps: [...TALLY_STARTED.steps]},
		});
		expect(again.replay).toEqual(done.replay);
	});

	it("clears the replay on a newer read whose machine run has another step count, or none", () => {
		const done = answered(shown(), COUNT, MATCHES);
		const more: JobTrace = {
			...TALLY_STARTED,
			steps: [...TALLY_STARTED.steps, {...FIRST_STEP, n: 4, at: FIRST_STEP.at + 10}],
		};
		const [grown] = applyCell<Model, TraceMsg, never>(trace, done, {type: "got", trace: more});
		expect(grown.replay).toBeNull();
		const [gone] = applyCell<Model, TraceMsg, never>(trace, done, {
			type: "got",
			trace: {...TALLY_STARTED, steps: []},
		});
		expect(gone.replay).toBeNull();
	});

	it("clears the replay when the tile turns to a ticket", () => {
		const done = answered(shown(), COUNT, MATCHES);
		const [ticket] = applyCell<Model, TraceMsg, never>(trace, done, {type: "ticket", number: 117});
		expect(ticket.replay).toBeNull();
	});
});

// The programs this app has code for, told once by `main` from its `Replayer` (review round, section
// 3): the window offers a replay only for a machine run of one of them.
describe("the code the trace is told of", () => {
	it("holds none until it is told, so no machine run can be replayed", () => {
		expect(foldEvents(trace, ctx, null, []).finalState.code).toEqual([]);
	});

	it("holds the programs it is told of, the last telling replacing the one before, and nothing else moves", () => {
		const s = foldEvents(trace, ctx, null, [
			{type: "look", id: TALLY_ID},
			{type: "got", trace: TALLY_STARTED},
		]).finalState;
		const [told, cmds] = applyCell<Model, TraceMsg, never>(trace, s, {
			type: "code",
			programs: ["seq", "tally"],
		});
		expect(cmds).toEqual([]);
		expect(told).toEqual({...s, code: ["seq", "tally"]});
		const [again] = applyCell<Model, TraceMsg, never>(trace, told, {type: "code", programs: []});
		expect(again.code).toEqual([]);
	});

	it("keeps what it was told through a look at another record", () => {
		const s = foldEvents(trace, ctx, null, [{type: "code", programs: ["tally"]}]).finalState;
		const [looked] = applyCell<Model, TraceMsg, never>(trace, s, {type: "look", id: OTHER_ID});
		expect(looked.code).toEqual(["tally"]);
	});
});
