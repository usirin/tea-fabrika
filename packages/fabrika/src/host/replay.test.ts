import {defineMachine} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {defineProgram, kind} from "../program/program.ts";
import {SMALL, tally} from "../shell/small.ts";
import {layerReplayer, Replayed, Replayer, replayOf} from "./replay.ts";
import type {Start, Step} from "./traces.ts";

// One machine run's rows, replayed through today's code (docs/plan/replay-through-current-code.md,
// section 2). Today's version. The adapter turns a machine run's starts and steps into a tea
// `Trace` from its first start's state, and `replayTrace` folds the recorded Msgs through the
// program's machine as the code is now. Each row of the plan's table is a case here; the rows are
// written by hand as the record keeps them, states as the kind's schema encodes them.
//
//   replayOf([tally], {starts, steps})    {_tag: "matches", steps: 3}
//   with add adding n + 1                  {_tag: "parts", n: 1, path: "state.total", recorded: 1, replayed: 2}
//   with no add                            {_tag: "refused", n: 1, msg: {type: "add", n: 1}, ...}
//   with no start                          {_tag: "cannot", why: "no_start", n: null, ...}

const RUN = "tally-5d02c7a1";
const BY = "user:owner";

/** A start of tally's count total, as the record reads it back. */
const startOf = (state: unknown, more: Partial<Start> = {}): Start => ({
	run: RUN,
	program: "tally",
	machine: "count",
	id: "total",
	n: 1,
	after: 0,
	at: 1,
	state,
	by: BY,
	...more,
});

/** Step `n` of tally's count total: `add` folded into `total`. */
const stepOf = (n: number, add: number, total: unknown, cmds: readonly unknown[] = []): Step => ({
	run: RUN,
	machine: "count",
	id: "total",
	n,
	at: 1 + n,
	msg: {type: "add", n: add},
	state: {total},
	cmds,
	by: BY,
});

/** `seq --to 3 | tally`, as its record keeps count total. */
const STARTS = [startOf({total: 0})];
const STEPS = [stepOf(1, 1, 1), stepOf(2, 2, 3), stepOf(3, 3, 6)];

const count = tally.machines.count;

type Add = (
	s: {readonly total: number},
	m: {readonly type: "add"; readonly n: number},
) => readonly [{readonly total: number}, readonly never[]];

/** Today's code with tally's count changed: its `add` cell is `add`, or gone with `null`. */
const tallyWith = (add: Add | null) => {
	const {add: _, ...rest} = count.machine.update;
	return [
		{
			name: "tally",
			machines: {
				count: {
					...count,
					machine: {...count.machine, update: add === null ? rest : {...rest, add}},
				},
			},
		},
	];
};

/** An answer, checked to fit `Replayed`: what the trace tile's Cmd takes back. */
const fits = (answer: unknown) => {
	expect(Schema.is(Replayed)(answer)).toBe(true);
	return answer;
};

describe("replayOf: one machine run through today's code", () => {
	it("matches at every step when today's code folds the same states from the same Msgs", () => {
		expect(fits(replayOf([tally], {starts: STARTS, steps: STEPS}))).toEqual({
			_tag: "matches",
			steps: 3,
		});
	});

	it("matches a machine run that started and folded nothing", () => {
		expect(fits(replayOf([tally], {starts: STARTS, steps: []}))).toEqual({
			_tag: "matches",
			steps: 0,
		});
	});

	it("parts at the first step whose state today's code makes otherwise: the record's step number, the path and both values", () => {
		const plusOne = tallyWith((s, m) => [{total: s.total + m.n + 1}, []]);
		expect(fits(replayOf(plusOne, {starts: STARTS, steps: STEPS}))).toEqual({
			_tag: "parts",
			n: 1,
			msg: {type: "add", n: 1},
			path: "state.total",
			recorded: 1,
			replayed: 2,
		});
	});

	it("names a later step by its number in the record, from 1", () => {
		const offAtTwo = tallyWith((s, m) => [{total: s.total + (m.n === 2 ? 3 : m.n)}, []]);
		expect(fits(replayOf(offAtTwo, {starts: STARTS, steps: STEPS}))).toEqual({
			_tag: "parts",
			n: 2,
			msg: {type: "add", n: 2},
			path: "state.total",
			recorded: 3,
			replayed: 4,
		});
	});

	it("is refused where today's code has no cell for a recorded Msg", () => {
		expect(fits(replayOf(tallyWith(null), {starts: STARTS, steps: STEPS}))).toEqual({
			_tag: "refused",
			n: 1,
			msg: {type: "add", n: 1},
			state: "(untagged state)",
			accepts: [],
		});
	});

	it("cannot replay a machine run whose start was never kept", () => {
		expect(fits(replayOf([tally], {starts: [], steps: STEPS}))).toMatchObject({
			_tag: "cannot",
			why: "no_start",
			n: null,
		});
	});

	it("cannot replay from a first start kept after some of its steps: the boot before them is lost", () => {
		const late = [startOf({total: 1}, {after: 1})];
		expect(fits(replayOf([tally], {starts: late, steps: STEPS}))).toMatchObject({
			_tag: "cannot",
			why: "no_start",
			n: null,
		});
	});

	it("cannot replay a program today's code does not list, and says which", () => {
		const answer = replayOf([], {starts: STARTS, steps: STEPS});
		expect(fits(answer)).toMatchObject({_tag: "cannot", why: "no_code", n: null});
		expect((answer as {detail: string}).detail).toContain("tally");
	});

	it("cannot replay a machine its program no longer has, and says which", () => {
		const answer = replayOf([{name: "tally", machines: {}}], {starts: STARTS, steps: STEPS});
		expect(fits(answer)).toMatchObject({_tag: "cannot", why: "no_code", n: null});
		expect((answer as {detail: string}).detail).toContain("count");
	});

	it("cannot replay from a kept start its state schema now refuses: step 0", () => {
		const answer = replayOf([tally], {starts: [startOf({total: "zero"})], steps: STEPS});
		expect(fits(answer)).toMatchObject({_tag: "cannot", why: "state_refused", n: 0});
	});

	it("cannot replay past a step whose kept state its schema now refuses, and names the step", () => {
		const steps = [stepOf(1, 1, 1), stepOf(2, 2, 3.5), stepOf(3, 3, 6)];
		const answer = replayOf([tally], {starts: STARTS, steps});
		expect(fits(answer)).toMatchObject({_tag: "cannot", why: "state_refused", n: 2});
	});

	// A restart is a new life (the plan, changed 2026-11-08): each life is replayed from its own
	// start. Here start 2 booted from 10, which step 2 never left: a crash between a step's write and
	// its save, never a verdict on the code.
	const crashed = {
		starts: [startOf({total: 0}), startOf({total: 10}, {n: 2, after: 2, at: 50})],
		steps: [stepOf(1, 1, 1), stepOf(2, 2, 3), stepOf(3, 3, 13)],
	};

	it("replays each life from its own start: a restart from a state the step before it did not leave still matches", () => {
		expect(fits(replayOf([tally], crashed))).toEqual({_tag: "matches", steps: 3});
	});

	it("parts in a later life at the record's own step number, folded from that life's start", () => {
		const offAtThree = tallyWith((s, m) => [{total: s.total + (m.n === 3 ? 4 : m.n)}, []]);
		expect(fits(replayOf(offAtThree, crashed))).toEqual({
			_tag: "parts",
			n: 3,
			msg: {type: "add", n: 3},
			path: "state.total",
			recorded: 13,
			replayed: 14,
		});
	});

	it("answers for the first life that parts, though a later one parts too", () => {
		const plusOne = tallyWith((s, m) => [{total: s.total + m.n + 1}, []]);
		expect(fits(replayOf(plusOne, crashed))).toMatchObject({_tag: "parts", n: 1});
	});

	it("is refused in a later life at the record's own step number", () => {
		// Life 2's Msg is one today's code has no cell for: a Msg renamed since it was recorded.
		const renamed = {
			starts: crashed.starts,
			steps: [...crashed.steps.slice(0, 2), {...stepOf(3, 3, 13), msg: {type: "sub", n: 3}}],
		};
		expect(fits(replayOf([tally], renamed))).toEqual({
			_tag: "refused",
			n: 3,
			msg: {type: "sub", n: 3},
			state: "(untagged state)",
			accepts: ["add"],
		});
	});

	it("cannot replay from a later start its state schema refuses: step 0", () => {
		const starts = [startOf({total: 0}), startOf({total: "ten"}, {n: 2, after: 2, at: 50})];
		expect(fits(replayOf([tally], {starts, steps: crashed.steps}))).toMatchObject({
			_tag: "cannot",
			why: "state_refused",
			n: 0,
		});
	});

	it("has no answer that blames a restart", () => {
		expect(Schema.is(Replayed)({_tag: "cannot", why: "restarted", n: 2, detail: "a restart"})).toBe(
			false,
		);
	});

	it("replays across a restart that booted from the state its step before it left", () => {
		const starts = [startOf({total: 0}), startOf({total: 3}, {n: 2, after: 2, at: 50})];
		expect(fits(replayOf([tally], {starts, steps: STEPS}))).toEqual({_tag: "matches", steps: 3});
	});

	it("cannot replay when today's update throws, and says what it threw", () => {
		const throws = tallyWith(() => {
			throw new Error("add broke");
		});
		const answer = replayOf(throws, {starts: STARTS, steps: STEPS});
		expect(fits(answer)).toMatchObject({_tag: "cannot", why: "threw"});
		expect((answer as {detail: string}).detail).toContain("add broke");
	});
});

// A machine run whose steps start Cmds. Replay compares a step's Cmds after its state, so a change
// that keeps every state and starts other Cmds parts at `cmds`. No Cmd is ever run: the kind's
// options, the only place a Cmd handler can come from, throw if anything asks for them.

const note = Cmd.make("note", {input: Schema.Struct({k: Schema.Int}), ok: Schema.Null, err: []});
const Total = Schema.Struct({total: Schema.Int});

/** A total that notes each add, with `k` the add's number plus `shift`. */
const notingOf = (shift: number) =>
	defineMachine({
		types: {
			model: {} as {readonly total: number},
			msg: {} as {readonly type: "add"; readonly n: number},
			ctx: undefined,
		},
		cmds: [note],
		init: (loaded) => [loaded ?? {total: 0}, []],
		update: {
			add: (s, m) => [{total: s.total + m.n}, [note({k: m.n + shift})]],
			note_ok: (s) => [s, []],
			note_err: (s) => [s, []],
		},
	});

/** A program running the noting total, whose options fail the test if asked for. */
const notedOf = (shift: number, asked: {n: number}) =>
	defineProgram({
		name: "noted",
		description: "A total that notes each add.",
		inputs: {},
		outputs: {},
		machines: {
			total: kind({
				machine: notingOf(shift),
				state: Total,
				parent: "main",
				options: () => {
					asked.n += 1;
					throw new Error("a replay asked for the run's options, where its Cmd handlers are");
				},
				drawing: () => ({name: "total", steps: {note: "note"}}),
				status: (s) => `total ${s.total}`,
			}),
		},
		main: () => Effect.void,
	});

const NOTED_START: Start = {...startOf({total: 0}), program: "noted", machine: "total"};
const notedStep = (n: number, add: number, total: number, k: number): Step => ({
	...stepOf(n, add, total, [{type: "note", k}]),
	machine: "total",
});
const NOTED_STEPS = [notedStep(1, 1, 1, 1), notedStep(2, 2, 3, 2)];

describe("replayOf: a machine run's Cmds", () => {
	it("matches when today's code starts the same Cmds, and never asks for a Cmd handler", () => {
		const asked = {n: 0};
		const answer = replayOf([notedOf(0, asked)], {starts: [NOTED_START], steps: NOTED_STEPS});
		expect(fits(answer)).toEqual({_tag: "matches", steps: 2});
		expect(asked.n).toBe(0);
	});

	it("parts at a step whose states all match but whose Cmds differ: the path starts at cmds", () => {
		const asked = {n: 0};
		const answer = replayOf([notedOf(1, asked)], {starts: [NOTED_START], steps: NOTED_STEPS});
		expect(fits(answer)).toEqual({
			_tag: "parts",
			n: 1,
			msg: {type: "add", n: 1},
			path: "cmds[0].k",
			recorded: 1,
			replayed: 2,
		});
		expect(asked.n).toBe(0);
	});
});

describe("Replayer: replays over the programs a host lists", () => {
	it("answers from the entries it was built on, the same as replayOf", async () => {
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* Replayer).replay({starts: STARTS, steps: STEPS});
			}).pipe(Effect.provide(layerReplayer(SMALL))),
		);
		expect(answer).toEqual({_tag: "matches", steps: 3});
	});

	it("cannot replay a program its entries do not hold", async () => {
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* Replayer).replay({starts: STARTS, steps: STEPS});
			}).pipe(Effect.provide(layerReplayer([]))),
		);
		expect(answer).toMatchObject({_tag: "cannot", why: "no_code"});
	});
});
