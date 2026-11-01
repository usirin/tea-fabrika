import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {make} from "../../entity.ts";
import {LaneId} from "../../ids.ts";
import type {Outcome} from "../../tickets/ticket.ts";
import {nameOf} from "../outcome.ts";
import type {STEPS} from "./machine.ts";
import {
	askPerson,
	after as afterStep,
	claimLane,
	EMPTY,
	Lane,
	type LaneCmd,
	lane,
	readFiled,
	releaseLane,
	runStep,
	type StepEnd,
} from "./machine.ts";

// The lane's laws, on tea's own property tests, on the real reducer from its real `init`. Each
// folds a random list of Msgs through the machine and checks a law after every step. Each law is
// seen to fail on a planted mistake below.

type Machine = typeof lane;
type Msg = MsgOf<Machine>;
type LaneStep = Step<Lane, Msg, LaneCmd>;

const ID = make(LaneId)("L1");
const STEP = runStep({
	number: 7,
	count: 1,
	step: "triage",
	round: 1,
	carry: EMPTY,
	intent: "lane/7/1/triage",
});
const ASK = askPerson({number: 7, ask: "a", what: "w", picks: ["x"], intent: "i"});
const READ = readFiled({number: 7});
const CLAIM = claimLane({number: 7, lane: ID, intent: "c"});
const RELEASE = releaseLane({number: 7, lane: ID, intent: "r"});

const OUTCOMES: readonly Outcome[] = [
	{kind: "done", part: false},
	{kind: "skip", why: "no_rules_change"},
	{kind: "skip", why: "no_properties"},
	{kind: "skip", why: "no_lines"},
	{kind: "ask", who: "owner", for: "questions"},
	{kind: "ask", who: "owner", for: "check_change"},
	{kind: "send", to: "plan", why: "yes"},
	{kind: "send", to: "builder", why: "review_failed"},
	{kind: "send", to: "test_writer", why: "mutant_survived"},
	{kind: "stuck", why: "push_failed"},
];
const stepEnds: fc.Arbitrary<StepEnd> = fc.record({
	outcome: fc.constantFrom(...OUTCOMES),
	carry: fc.constant({}),
});

const arbs: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {number: fc.constant(7), lane: fc.constant(ID)}),
	resume: arbConstantMsg("resume"),
	lane_answered: arbRecordMsg("lane_answered", {
		ask: fc.string(),
		pick: fc.constantFrom("approve", "merge", "no", "again", "go_on", "stop"),
	}),
	lane_read_ok: fc
		.record({state: fc.constantFrom("open" as const, "closed" as const), mine: fc.boolean()})
		.map((v) => readFiled.ok(READ, v, 0)),
	lane_read_err: fc.constant(readFiled.err(READ, {_tag: "unknown"}, 0)),
	lane_claim_ok: fc.constantFrom(ID, make(LaneId)("L2")).map((v) => claimLane.ok(CLAIM, v, 0)),
	lane_claim_err: fc.constant(claimLane.err(CLAIM, {_tag: "unknown"}, 0)),
	lane_step_ok: stepEnds.map((v) => runStep.ok(STEP, v, 0)),
	lane_step_err: fc.constant(runStep.err(STEP, {_tag: "unknown"}, 0)),
	lane_ask_ok: fc.constant(askPerson.ok(ASK, null, 0)),
	lane_ask_err: fc.constant(askPerson.err(ASK, {_tag: "unknown"}, 0)),
	lane_release_ok: fc.constant(releaseLane.ok(RELEASE, "released", 0)),
	lane_release_err: fc.constant(releaseLane.err(RELEASE, {_tag: "unknown"}, 0)),
};

/**
 * Lists that reach far: most Msgs answer what the machine is on, so a list gets through the lane.
 * The asked question's id cannot be known ahead, so `withAnswers` below fills it in.
 */
const opening: readonly Msg[] = [
	{type: "start", number: 7, lane: ID},
	readFiled.ok(READ, {state: "open", mine: true}, 0),
	claimLane.ok(CLAIM, ID, 0),
];
const lists = fc
	.tuple(fc.boolean(), fc.array(arbMsg(arbs), {minLength: 1, maxLength: 80}))
	.map(([open, rest]) => (open ? [...opening, ...rest] : rest));

const RUNS = {numRuns: 300, seed: 7};
const each =
	(law: (t: LaneStep) => void) =>
	(step: LaneStep): boolean => {
		law(step);
		return true;
	};

/** An answer that names the question the lane asks now, whatever the list said. */
const withAnswers = <M extends Machine>(machine: M): M =>
	({
		...machine,
		update: {
			...machine.update,
			lane_answered: (s: Lane, m: Extract<Msg, {type: "lane_answered"}>) =>
				machine.update.lane_answered(s, s.phase === "asking" ? {...m, ask: s.question.ask} : m),
		},
	}) as M;

const check = (machine: Machine, law: (t: LaneStep) => void) =>
	propertyInvariant(withAnswers(machine), undefined, lists, each(law), RUNS);

const plant = (update: Partial<Machine["update"]>): Machine =>
	({...lane, update: {...lane.update, ...update}}) as Machine;

const stepsIn = (cmds: readonly LaneCmd[]) =>
	cmds.flatMap((c) => (c.type === "lane_step" ? [c] : []));

// ---------------------------------------------------------------- the laws

/** A step starts only as `after` says, or as a person's answer says. */
const inOrder = ({prev, msg, cmds}: LaneStep) => {
	if (msg.type === "resume") return;
	/** The step this Msg should start. A person's answer may start the one its question names. */
	const wanted = (started: string): string => {
		if (msg.type === "lane_claim_ok") return "triage";
		if (msg.type === "lane_answered") {
			if (prev.phase !== "asking") throw new Error("a step started on no question");
			return started;
		}
		if (msg.type !== "lane_step_ok" || prev.phase !== "running")
			throw new Error(`a step started on ${msg.type} in ${prev.phase}`);
		const want = afterStep(prev.step, msg.value.outcome, prev.round);
		if (!("to" in want)) throw new Error(`${started} started where the order says stop`);
		return want.to;
	};
	for (const cmd of stepsIn(cmds)) expect(cmd.step).toBe(wanted(cmd.step));
};

/** No merge, of the change or of the rules, but on the person's own answer to the right question. */
const noMergeUnasked = ({prev, msg, cmds}: LaneStep) => {
	// A restart sends again only what was already started: `resumeRepeats` holds it to that.
	if (msg.type === "resume") return;
	for (const cmd of stepsIn(cmds)) {
		if (cmd.step !== "merge" && cmd.step !== "exam_merge") continue;
		if (msg.type !== "lane_answered" || prev.phase !== "asking")
			throw new Error(`${cmd.step} started on ${msg.type}`);
		// "again" on a step already asked about comes back to it; it was a person's answer as well.
		expect(["merge", "again"]).toContain(msg.pick);
		if (msg.pick === "merge") expect(["merge", "exam_merge"]).toContain(prev.question.for);
	}
};

/** A restart re-sends what was in flight, with its own intent, and starts no step of its own. */
const resumeRepeats = ({prev, msg, next, cmds}: LaneStep) => {
	if (msg.type !== "resume") return;
	expect(next).toEqual(prev);
	if (prev.phase === "idle" || prev.phase === "over") expect(cmds).toEqual([]);
	else expect(cmds).toEqual([prev.asked]);
};

/** The lane never runs a step under a count it used: each Act's intent is new. */
const eachStepOnce = ({prev, msg, next, cmds}: LaneStep) => {
	if (msg.type === "resume") return;
	const was = "count" in prev ? prev.count : 0;
	for (const cmd of stepsIn(cmds)) {
		expect(cmd.count).toBe(was + 1);
		expect(cmd.intent).toBe(`lane/${cmd.number}/${cmd.count}/${cmd.step}`);
	}
	if ("count" in next) expect(next.count).toBeGreaterThanOrEqual(was);
};

/** A step's own answer, a skip included, is written on the trail as it was said. */
const everyEndWritten = ({prev, msg, next}: LaneStep) => {
	if (msg.type !== "lane_step_ok" || prev.phase !== "running") return;
	if (!("trail" in next)) throw new Error("the trail was lost");
	expect(next.trail.at(-1)).toEqual({step: prev.step, said: nameOf(msg.value.outcome)});
};

/** A stuck child ends the lane in a named state: never silent, never another step. */
const stuckEnds = ({prev, msg, next, cmds}: LaneStep) => {
	const stuck =
		(msg.type === "lane_step_ok" && msg.value.outcome.kind === "stuck") ||
		msg.type === "lane_step_err";
	if (!stuck || prev.phase !== "running") return;
	expect(next.phase).toBe("releasing");
	if (next.phase !== "releasing") return;
	expect(next.outcome.kind).toBe("stuck");
	expect(next.said).not.toBe("");
	expect(stepsIn(cmds)).toEqual([]);
};

/** Its state is kept through its schema, as the program does. */
const decode = Schema.decodeUnknownSync(Lane);
const encode = Schema.encodeSync(Lane);
const kept = ({next}: LaneStep) => expect(decode(encode(next))).toEqual(next);

/** The ticket is not touched for a ticket not yours. */
const refusesOthers = ({prev, msg, next, cmds}: LaneStep) => {
	if (msg.type !== "lane_read_ok" || prev.phase !== "reading" || msg.value.mine) return;
	expect(next.phase).toBe("over");
	expect(cmds).toEqual([]);
};

const LAWS = {
	inOrder,
	noMergeUnasked,
	resumeRepeats,
	eachStepOnce,
	everyEndWritten,
	stuckEnds,
	kept,
	refusesOthers,
};

describe("the lane's laws", () => {
	for (const [name, law] of Object.entries(LAWS))
		it(`${name} holds on the real reducer`, () => check(lane, law));
});

describe("each law fails on its planted break", () => {
	const startMerge = (s: Lane) => {
		if (s.phase !== "running") return [s, []] as const;
		const cmd = runStep({
			number: s.number,
			count: s.count + 1,
			step: "merge",
			round: s.round,
			carry: s.carry,
			intent: `lane/${s.number}/${s.count + 1}/merge`,
		});
		return [{...s, count: s.count + 1, step: "merge" as const, asked: cmd}, [cmd]] as const;
	};
	const breaks: Record<keyof typeof LAWS, Partial<Machine["update"]>> = {
		inOrder: {lane_step_ok: (s: Lane) => startMerge(s)},
		noMergeUnasked: {lane_step_ok: (s: Lane) => startMerge(s)},
		resumeRepeats: {
			resume: (s: Lane) => (s.phase === "running" ? [{...s, count: s.count + 1}, []] : [s, []]),
		},
		eachStepOnce: {
			lane_step_ok: (s: Lane, m: Extract<Msg, {type: "lane_step_ok"}>) => {
				const [n, cmds] = lane.update.lane_step_ok(s, m);
				return [
					n,
					cmds.map((c: LaneCmd) => (c.type === "lane_step" ? {...c, count: c.count + 5} : c)),
				];
			},
		},
		everyEndWritten: {
			lane_step_ok: (s: Lane, m: Extract<Msg, {type: "lane_step_ok"}>) => {
				if (s.phase !== "running") return [s, []];
				const [n, cmds] = lane.update.lane_step_ok(s, m);
				return ["trail" in n ? {...n, trail: s.trail} : n, cmds] as never;
			},
		},
		stuckEnds: {
			lane_step_err: (s: Lane) => [s, []],
		},
		kept: {
			start: (s: Lane) => [{...s, phase: "reading", number: "seven"} as never, []],
		},
		refusesOthers: {
			lane_read_ok: (s: Lane, m: Extract<Msg, {type: "lane_read_ok"}>) =>
				lane.update.lane_read_ok(s, {...m, value: {...m.value, mine: true}}),
		},
	};
	for (const [name, law] of Object.entries(LAWS))
		it(`${name} catches its plant`, () => {
			expect(() => check(plant(breaks[name as keyof typeof LAWS]), law)).toThrow();
		});
});

describe("the whole lane, step by step", () => {
	const DONE: Outcome = {kind: "done", part: false};
	const IDLE: Lane = {phase: "idle"};
	const stepped = (s: Lane, m: Msg): Lane =>
		(lane.update[m.type] as (s: Lane, m: Msg) => readonly [Lane, unknown])(s, m)[0];
	/** Walk the machine, answering each step with `answers[step]`, and each question with its first pick. */
	const walk = (answers: Partial<Record<(typeof STEPS)[number], Outcome>> = {}) => {
		let s: Lane = stepped(IDLE, {type: "start", number: 7, lane: ID});
		const seen: string[] = [];
		const go = (m: Msg) => {
			s = stepped(s, m);
		};
		go(readFiled.ok(READ, {state: "open", mine: true}, 0));
		go(claimLane.ok(CLAIM, ID, 0));
		for (let i = 0; i < 40 && s.phase !== "over"; i++) {
			if (s.phase === "running") {
				seen.push(s.step);
				go(runStep.ok(STEP, {outcome: answers[s.step] ?? DONE, carry: {}}, 0));
			} else if (s.phase === "asking") {
				seen.push(s.question.for);
				go({type: "lane_answered", ask: s.question.ask, pick: s.question.picks[0] ?? ""});
			} else if (s.phase === "releasing") go(releaseLane.ok(RELEASE, "released", 0));
		}
		return {s, seen};
	};

	it("a ticket with no rule change goes through every step and ends merged", () => {
		const {s, seen} = walk({
			triage: {kind: "send", to: "plan", why: "yes"},
			exam: {kind: "skip", why: "no_rules_change"},
		});
		expect(seen).toEqual([
			"triage",
			"plan",
			"approve",
			"exam",
			"test_writer",
			"build",
			"mutation",
			"review",
			"push",
			"merge",
			"merge",
		]);
		expect(s.phase === "over" && s.outcome.kind).toBe("done");
	});

	it("a plan that changes rules lands them first, on a person's yes", () => {
		const {seen} = walk({
			triage: {kind: "send", to: "plan", why: "yes"},
			exam: {kind: "ask", who: "owner", for: "check_change"},
		});
		expect(seen.slice(2, 7)).toEqual([
			"approve",
			"exam",
			"exam_merge",
			"exam_merge",
			"test_writer",
		]);
	});

	it("a survived mutant goes to the writer's second job, and on to review", () => {
		const {seen} = walk({
			triage: {kind: "send", to: "plan", why: "yes"},
			mutation: {kind: "send", to: "test_writer", why: "mutant_survived"},
		});
		expect(seen).toContain("mutants");
		expect(seen.indexOf("review")).toBe(seen.indexOf("mutants") + 1);
	});

	it("a review's finding goes to the writer first, then the build, and rounds run out", () => {
		const {s, seen} = walk({
			triage: {kind: "send", to: "plan", why: "yes"},
			review: {kind: "send", to: "builder", why: "review_failed"},
		});
		expect(seen.filter((x) => x === "test_writer")).toHaveLength(3);
		expect(s.phase === "over" && nameOf(s.outcome)).toBe("stuck:rounds_spent");
	});

	it("a person's no ends the lane, and nothing merges", () => {
		const asked = [
			{type: "start", number: 7, lane: ID},
			readFiled.ok(READ, {state: "open", mine: true}, 0),
			claimLane.ok(CLAIM, ID, 0),
			runStep.ok(STEP, {outcome: {kind: "send", to: "plan", why: "yes"}, carry: {}}, 0),
			runStep.ok(STEP, {outcome: DONE, carry: {}}, 0),
		].reduce<Lane>((s, m) => stepped(s, m as Msg), IDLE);
		if (asked.phase !== "asking") throw new Error(asked.phase);
		const end = stepped(asked, {type: "lane_answered", ask: asked.question.ask, pick: "no"});
		expect(end.phase === "releasing" && nameOf(end.outcome)).toBe("skip:owner_no");
	});
});
