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
	MAX_ROUNDS,
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
	{kind: "send", to: "builder", why: "tests_red"},
	{kind: "send", to: "test_writer", why: "mutant_survived"},
	{kind: "stuck", why: "push_failed"},
];
/** A head, and green checks code ran there: what a build leaves for the steps after it (self-fix PR 4). */
const BUILT_HEAD = "4".repeat(40);
const GREEN_CARRY = {
	head: BUILT_HEAD,
	checked: {head: BUILT_HEAD, commands: ["vitest run"], result: "green", failed: []},
} as const;
const stepEnds: fc.Arbitrary<StepEnd> = fc.record({
	outcome: fc.constantFrom(...OUTCOMES),
	carry: fc.constantFrom({}, GREEN_CARRY),
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

// A law over a whole run, not over one Msg: what a person is asked, across every question of a lane.
describe("the questions a lane asks, over any run", () => {
	const DONE: Outcome = {kind: "done", part: false};
	const SEND: Outcome = {kind: "send", to: "plan", why: "yes"};
	const UNSEEN: Outcome = {kind: "ask", who: "owner", for: "unseen"};
	const MARKED: Outcome = {kind: "ask", who: "owner", for: "decision"};
	const NOTHING_CHANGED: Outcome = {kind: "ask", who: "owner", for: "no_change"};
	const ANSWERS: readonly Outcome[] = [
		DONE,
		UNSEEN,
		{kind: "ask", who: "owner", for: "check_change"},
		{kind: "send", to: "builder", why: "review_failed"},
		{kind: "send", to: "test_writer", why: "mutant_survived"},
		{kind: "skip", why: "no_properties"},
	];
	const anyEnd: fc.Arbitrary<StepEnd> = fc.oneof(
		fc.constantFrom(...ANSWERS).map((outcome) => ({outcome, carry: {}})),
		// A question a person's `go_on` answers with how the step ends, which may be another question.
		fc
			.tuple(fc.constantFrom(MARKED, NOTHING_CHANGED), fc.constantFrom(...ANSWERS))
			.map(([outcome, past]) => ({outcome, after: past, carry: {}})),
	);
	const runs = fc.record({
		ends: fc.array(anyEnd, {maxLength: 40}),
		picks: fc.array(fc.nat(2), {maxLength: 40}),
	});

	/** Every question `machine` asks on one run, walked from its start, each pick one it offers. */
	const asksIn = (
		machine: Machine,
		{ends, picks}: {readonly ends: readonly StepEnd[]; readonly picks: readonly number[]},
	) => {
		const asks: string[] = [];
		const leftEnds = [...ends];
		const leftPicks = [...picks];
		const next = (s: Lane): readonly [Lane, readonly LaneCmd[]] => {
			switch (s.phase) {
				case "idle":
					return machine.update.start(s, {type: "start", number: 7, lane: ID});
				case "reading":
					return machine.update.lane_read_ok(s, readFiled.ok(READ, {state: "open", mine: true}, 0));
				case "claiming":
					return machine.update.lane_claim_ok(s, claimLane.ok(CLAIM, ID, 0));
				case "running": {
					const end: StepEnd =
						s.step === "triage"
							? {outcome: SEND, carry: {}}
							: (leftEnds.shift() ?? {outcome: DONE, carry: {}});
					// A build leaves green checks at its head, so the run reaches the steps after it.
					const built = s.step === "build" ? {...end, carry: {...end.carry, ...GREEN_CARRY}} : end;
					return machine.update.lane_step_ok(s, runStep.ok(STEP, built, 0));
				}
				case "asking": {
					const {ask, picks: offered} = s.question;
					const pick = offered[(leftPicks.shift() ?? 0) % offered.length] ?? "";
					return machine.update.lane_answered(s, {type: "lane_answered", ask, pick});
				}
				case "releasing":
					return machine.update.lane_release_ok(s, releaseLane.ok(RELEASE, "released", 0));
				case "over":
					return [s, []];
			}
		};
		let s: Lane = {phase: "idle"};
		for (let i = 0; i < 200; i++) {
			const [moved, cmds] = next(s);
			s = moved;
			for (const cmd of cmds) if (cmd.type === "lane_ask") asks.push(cmd.ask);
		}
		return asks;
	};

	const eachOwnId = (machine: Machine) =>
		fc.assert(
			fc.property(runs, (run) => {
				const asks = asksIn(machine, run);
				expect(asks.filter((ask, at) => asks.indexOf(ask) !== at)).toEqual([]);
			}),
			{numRuns: 500, seed: 7},
		);

	it("no two questions share an id, on any path", () => {
		eachOwnId(lane);
	});

	it("that law catches its plant: a machine that names every question alike", () => {
		const alike = (cmds: readonly LaneCmd[]) =>
			cmds.map((cmd) => (cmd.type === "lane_ask" ? {...cmd, ask: "a-step-1"} : cmd));
		const planted = plant({
			lane_step_ok: (s: Lane, m: Extract<Msg, {type: "lane_step_ok"}>) => {
				const [next, cmds] = lane.update.lane_step_ok(s, m);
				return [next, alike(cmds)];
			},
		});
		expect(() => eachOwnId(planted)).toThrow();
	});
});

describe("the whole lane, step by step", () => {
	const DONE: Outcome = {kind: "done", part: false};
	const IDLE: Lane = {phase: "idle"};
	const stepped = (s: Lane, m: Msg): Lane =>
		(lane.update[m.type] as (s: Lane, m: Msg) => readonly [Lane, unknown])(s, m)[0];
	/** Walk the machine, answering each step with `answers[step]`, and each question with `picks[for]` or its first pick. */
	const walk = (
		answers: Partial<Record<(typeof STEPS)[number], Outcome>> = {},
		picks: Readonly<Record<string, string>> = {},
	) => {
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
				const carry = s.step === "build" ? GREEN_CARRY : {};
				go(runStep.ok(STEP, {outcome: answers[s.step] ?? DONE, carry}, 0));
			} else if (s.phase === "asking") {
				seen.push(s.question.for);
				go({
					type: "lane_answered",
					ask: s.question.ask,
					pick: picks[s.question.for] ?? s.question.picks[0] ?? "",
				});
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

	it("a review's finding goes to the writer first, then the build, and once rounds run out a person is asked", () => {
		const {s, seen} = walk(
			{
				triage: {kind: "send", to: "plan", why: "yes"},
				review: {kind: "send", to: "builder", why: "review_failed"},
			},
			{rounds_spent: "stop"},
		);
		expect(seen.filter((x) => x === "test_writer")).toHaveLength(3);
		expect(seen.at(-1)).toBe("rounds_spent");
		expect(s.phase === "over" && nameOf(s.outcome)).toBe("stuck:rounds_spent");
	});

	it("a head whose tests fail goes back to the build each round, and once rounds run out a person is asked", () => {
		const {s, seen} = walk(
			{
				triage: {kind: "send", to: "plan", why: "yes"},
				exam: {kind: "skip", why: "no_rules_change"},
				mutation: {kind: "send", to: "builder", why: "tests_red"},
			},
			{rounds_spent: "stop"},
		);
		expect(seen.slice(seen.indexOf("build"))).toEqual([
			"build",
			"mutation",
			"build",
			"mutation",
			"build",
			"mutation",
			"rounds_spent",
		]);
		expect(s.phase === "over" && nameOf(s.outcome)).toBe("stuck:rounds_spent");
	});

	// Self-fix PR 4: red comes from code's checks after the build, and goes back to the build itself.
	it("red checks at the build go back to the build each round, and once rounds run out a person is asked", () => {
		const {s, seen} = walk(
			{
				triage: {kind: "send", to: "plan", why: "yes"},
				exam: {kind: "skip", why: "no_rules_change"},
				build: {kind: "send", to: "builder", why: "checks_red"},
			},
			{rounds_spent: "stop"},
		);
		expect(seen.slice(seen.indexOf("build"))).toEqual(["build", "build", "build", "rounds_spent"]);
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

// Self-fix PR 3's law, over a whole run: a red head goes back to the builder a round at a time, the
// builds never pass the cap but on a person's `again`, and a green head always moves on.
describe("red and green heads, over any run", () => {
	const RED: Outcome = {kind: "send", to: "builder", why: "tests_red"};
	const REVIEW_BACK: Outcome = {kind: "send", to: "builder", why: "review_failed"};
	const DONE: Outcome = {kind: "done", part: false};
	const runs = fc.record({
		/** Each mutation step's head, in turn: `true` is red. Past the last, green. */
		heads: fc.array(fc.boolean(), {maxLength: 30}),
		/** Each review, in turn: `true` sends it back. Past the last, it passes. */
		reviews: fc.array(fc.boolean(), {maxLength: 10}),
		/** Each answer to `rounds_spent`, in turn. Past the last, `stop`. */
		answers: fc.array(fc.constantFrom("again", "stop"), {maxLength: 10}),
	});
	type Run = typeof runs extends fc.Arbitrary<infer R> ? R : never;

	const where = (s: Lane): string =>
		s.phase === "running"
			? `${s.step} round ${s.round}`
			: s.phase === "asking"
				? `asking ${s.question.for}`
				: s.phase;

	/** Walk `machine` from its start on one run. What broke the law, a line each: none, it holds. */
	const broken = (machine: Machine, run: Run): readonly string[] => {
		const heads = [...run.heads];
		const reviews = [...run.reviews];
		const answers = [...run.answers];
		const problems: string[] = [];
		let builds = 0;
		let agains = 0;
		const stepped = (s: Lane, m: Msg): Lane =>
			(machine.update[m.type] as (s: Lane, m: Msg) => readonly [Lane, unknown])(s, m)[0];
		const answerTo = (s: Extract<Lane, {phase: "running"}>): Outcome => {
			switch (s.step) {
				case "triage":
					return {kind: "send", to: "plan", why: "yes"};
				case "exam":
					return {kind: "skip", why: "no_rules_change"};
				case "mutation":
					return heads.shift() === true ? RED : DONE;
				case "review":
					return reviews.shift() === true ? REVIEW_BACK : DONE;
				default:
					return DONE;
			}
		};
		const msgFor = (s: Lane): Msg | null => {
			switch (s.phase) {
				case "idle":
					return {type: "start", number: 7, lane: ID};
				case "reading":
					return readFiled.ok(READ, {state: "open", mine: true}, 0);
				case "claiming":
					return claimLane.ok(CLAIM, ID, 0);
				case "running":
					if (s.step === "build") builds++;
					return runStep.ok(
						STEP,
						{outcome: answerTo(s), carry: s.step === "build" ? GREEN_CARRY : {}},
						0,
					);
				case "asking": {
					const spent = s.question.for === "rounds_spent";
					const pick = spent ? (answers.shift() ?? "stop") : (s.question.picks[0] ?? "");
					if (spent && pick === "again") agains++;
					return {type: "lane_answered", ask: s.question.ask, pick};
				}
				case "releasing":
					return releaseLane.ok(RELEASE, "released", 0);
				case "over":
					return null;
			}
		};
		let s: Lane = {phase: "idle"};
		for (let i = 0; i < 400; i++) {
			const msg = msgFor(s);
			if (msg === null) break;
			const next = stepped(s, msg);
			if (s.phase === "running" && s.step === "mutation" && msg.type === "lane_step_ok") {
				const red = msg.value.outcome.kind === "send";
				const toBuild = next.phase === "running" && next.step === "build";
				if (!red && !(next.phase === "running" && next.step === "review"))
					problems.push(`a green head went to ${where(next)}`);
				if (red && s.round < MAX_ROUNDS && !(toBuild && next.round === s.round + 1))
					problems.push(`a red head in round ${s.round} went to ${where(next)}`);
				if (
					red &&
					s.round >= MAX_ROUNDS &&
					!(next.phase === "asking" && next.question.for === "rounds_spent")
				)
					problems.push(`a red head with the rounds spent went to ${where(next)}`);
			}
			if (next.phase === "running" && next.step === "build" && next.round > MAX_ROUNDS + agains)
				problems.push(`build round ${next.round} on ${agains} agains`);
			const name = next.phase === "releasing" ? nameOf(next.outcome) : "";
			if (name.startsWith("stuck:") && name !== "stuck:rounds_spent")
				problems.push(`ended ${name}`);
			s = next;
		}
		if (builds > MAX_ROUNDS + agains) problems.push(`${builds} builds on ${agains} agains`);
		return problems;
	};

	const holds = (machine: Machine) =>
		fc.assert(
			fc.property(runs, (run) => {
				expect(broken(machine, run)).toEqual([]);
			}),
			{numRuns: 300, seed: 119120},
		);

	it("builds run at most MAX_ROUNDS times plus one per `again`, red goes back, and green moves on", () => {
		holds(lane);
	});

	it("that law catches its plant: a lane that forgets its rounds on a red head", () => {
		const uncapped = plant({
			lane_step_ok: (s: Lane, m: Extract<Msg, {type: "lane_step_ok"}>) =>
				lane.update.lane_step_ok(
					s.phase === "running" && s.step === "mutation" ? {...s, round: 1} : s,
					m,
				),
		});
		expect(() => holds(uncapped)).toThrow();
	});
});

// Self-fix PR 4's law, over a whole run: no step after build runs on a head without green checks
// that code ran at that very head. A build ends on green, red or checks that could not run, or says
// `done` on checks that do not hold for its head. A later commit, the mutants job's, comes with checks
// of its own or none. A person's answers are any the question offers.
describe("code's checks after the build, over any run", () => {
	const AFTER_BUILD: ReadonlySet<string> = new Set([
		"mutation",
		"mutants",
		"review",
		"push",
		"merge",
	]);
	const COMMANDS = ["vitest run --reporter=json --outputFile={out}"];
	const NAME = "src/red.test.ts > a planted red > stays red";
	/** Each commit the run makes gets a head of its own. */
	const headOf = (n: number) => n.toString(16).padStart(40, "a");
	const ELSEWHERE = headOf(0xfff);
	type Checks = "green" | "elsewhere" | "red" | "not_run" | "none";
	/** What a step leaves at `head`: the checks code ran there, at another head, or none. */
	const at = (head: string, checks: Checks) => {
		const ran = (on: string, result: "green" | "red" | "not_run") =>
			({head: on, commands: COMMANDS, result, failed: result === "red" ? [NAME] : []}) as const;
		switch (checks) {
			case "green":
				return {head, checked: ran(head, "green")};
			case "elsewhere":
				return {head, checked: ran(ELSEWHERE, "green")};
			case "red":
				return {head, checked: ran(head, "red")};
			case "not_run":
				return {head, checked: ran(head, "not_run")};
			case "none":
				return {head};
		}
	};
	type BuildEnd = readonly ["done" | "checks_red" | "checks_not_run", Checks];
	const BUILD_ENDS: readonly BuildEnd[] = [
		["done", "green"],
		["done", "elsewhere"],
		["done", "red"],
		["done", "not_run"],
		["done", "none"],
		["checks_red", "red"],
		["checks_not_run", "not_run"],
	];
	const runs = fc.record({
		/** Each build, in turn. Past the last, done on green checks at its head. */
		builds: fc.array(fc.constantFrom(...BUILD_ENDS), {maxLength: 12}),
		/** Each mutation step, in turn. Past the last, done. */
		mutations: fc.array(fc.constantFrom("done", "survived", "tests_red"), {maxLength: 8}),
		/** The checks on each mutants job's commit, in turn. Past the last, green. */
		mutants: fc.array(fc.constantFrom<Checks>("green", "elsewhere", "red", "none"), {maxLength: 8}),
		/** Each review, in turn: `true` sends it back. Past the last, it passes. */
		reviews: fc.array(fc.boolean(), {maxLength: 6}),
		/** Each answer, in turn: one the question does not offer falls to its first pick. */
		picks: fc.array(fc.constantFrom("again", "go_on", "stop"), {maxLength: 12}),
	});
	type Run = typeof runs extends fc.Arbitrary<infer R> ? R : never;

	const stepsIn = (cmds: readonly LaneCmd[]) =>
		cmds.flatMap((c) => (c.type === "lane_step" ? [c] : []));

	/** Walk `machine` from its start on one run, checking every step it starts. What broke, a line each. */
	const broken = (machine: Machine, run: Run): readonly string[] => {
		const builds = [...run.builds];
		const mutations = [...run.mutations];
		const mutants = [...run.mutants];
		const reviews = [...run.reviews];
		const picks = [...run.picks];
		const problems: string[] = [];
		let commits = 0;
		const endOf = (s: Extract<Lane, {phase: "running"}>): StepEnd => {
			const DONE = {kind: "done", part: false} as const;
			switch (s.step) {
				case "triage":
					return {outcome: {kind: "send", to: "plan", why: "yes"}, carry: {}};
				case "exam":
					return {outcome: {kind: "skip", why: "no_rules_change"}, carry: {}};
				case "test_writer":
					return {outcome: DONE, carry: {head: headOf(++commits)}};
				case "build": {
					const [how, checks] = builds.shift() ?? ["done", "green"];
					const outcome =
						how === "done"
							? DONE
							: how === "checks_red"
								? ({kind: "send", to: "builder", why: "checks_red"} as const)
								: ({kind: "stuck", why: "checks_not_run"} as const);
					return {outcome, carry: at(headOf(++commits), checks)};
				}
				case "mutation": {
					const how = mutations.shift() ?? "done";
					const outcome =
						how === "done"
							? DONE
							: how === "survived"
								? ({kind: "send", to: "test_writer", why: "mutant_survived"} as const)
								: ({kind: "send", to: "builder", why: "tests_red"} as const);
					return {outcome, carry: {}};
				}
				case "mutants":
					return {outcome: DONE, carry: at(headOf(++commits), mutants.shift() ?? "green")};
				case "review":
					return {
						outcome:
							reviews.shift() === true ? {kind: "send", to: "builder", why: "review_failed"} : DONE,
						carry: {},
					};
				default:
					return {outcome: DONE, carry: {}};
			}
		};
		const msgFor = (s: Lane): Msg | null => {
			switch (s.phase) {
				case "idle":
					return {type: "start", number: 7, lane: ID};
				case "reading":
					return readFiled.ok(READ, {state: "open", mine: true}, 0);
				case "claiming":
					return claimLane.ok(CLAIM, ID, 0);
				case "running":
					return runStep.ok(STEP, endOf(s), 0);
				case "asking": {
					const {ask, picks: offered} = s.question;
					const wanted = picks.shift() ?? "";
					return {
						type: "lane_answered",
						ask,
						pick: offered.includes(wanted) ? wanted : (offered[0] ?? ""),
					};
				}
				case "releasing":
					return releaseLane.ok(RELEASE, "released", 0);
				case "over":
					return null;
			}
		};
		let s: Lane = {phase: "idle"};
		for (let i = 0; i < 300; i++) {
			const msg = msgFor(s);
			if (msg === null) break;
			const [next, cmds] = (
				machine.update[msg.type] as (s: Lane, m: Msg) => readonly [Lane, readonly LaneCmd[]]
			)(s, msg);
			for (const cmd of stepsIn(cmds)) {
				if (!AFTER_BUILD.has(cmd.step)) continue;
				const {head, checked} = cmd.carry as {
					readonly head: string | null;
					readonly checked?: {readonly head: string; readonly result: string};
				};
				if (checked?.result !== "green" || checked.head !== head)
					problems.push(
						`${cmd.step} ran on ${head} with checks ${JSON.stringify(checked ?? null)}`,
					);
			}
			s = next;
		}
		return problems;
	};

	const holds = (machine: Machine) =>
		fc.assert(
			fc.property(runs, (run) => {
				expect(broken(machine, run)).toEqual([]);
			}),
			{numRuns: 300, seed: 119120},
		);

	it("no step after build runs on a head without green checks code ran at that very head", () => {
		holds(lane);
	});

	it("that law catches its plant: a lane that hands on a step without the checks it holds", () => {
		const unchecked = plant({
			lane_step_ok: (s: Lane, m: Extract<Msg, {type: "lane_step_ok"}>) => {
				const [next, cmds] = lane.update.lane_step_ok(s, m);
				return [
					next,
					cmds.map((c: LaneCmd) =>
						c.type === "lane_step" ? {...c, carry: {...c.carry, checked: undefined}} : c,
					),
				] as never;
			},
		});
		expect(() => holds(unchecked)).toThrow();
	});
});
