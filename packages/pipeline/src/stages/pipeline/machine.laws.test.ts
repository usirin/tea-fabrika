import {foldUpdates} from "@demlik/tea";
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
import {HeldDraft} from "../plan/plan.ts";
import {SHIP_NAMES} from "../ship/outcome.ts";
import type {Carried} from "./carry.ts";
import {ruleChangeLines} from "./found.ts";
import {
	AskFor,
	askedFor,
	askPerson,
	after as afterStep,
	claimLane,
	EMPTY,
	type Filed,
	Fresh,
	freshMain,
	Held,
	Lane,
	type LaneCmd,
	type LaneStep as StepName,
	lane,
	MAX_ROUNDS,
	PICKS,
	type Question,
	type Resume,
	readFiled,
	releaseLane,
	resumeOf,
	runStep,
	STEPS,
	type StepEnd,
} from "./machine.ts";
import {LANE_NAMES, type LaneOutcome} from "./outcome.ts";
import {FINAL} from "./restart.ts";

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

const FRESH = freshMain({
	number: 7,
	from: {_tag: "run", step: "mutation"},
	carry: EMPTY,
	intent: "f",
});

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
	// Self-fix PR 5: a build that changed the test writer's files asks the person which was wrong.
	{kind: "stuck", why: "exam_touched"},
];

/** A head, and green checks code ran there: what a build leaves for the steps after it (self-fix PR 4). */
const BUILT_HEAD = "4".repeat(40);

const GREEN_CARRY = {
	head: BUILT_HEAD,
	checked: {
		head: BUILT_HEAD,
		commands: [{command: "vitest run", code: 0, ms: 4_210}],
		result: "green",
		failed: [],
	},
} as const;

/** The exam's pull request at its first head, and at a later one (self-fix PR 10). */
const EXAM_A = "3".repeat(40);
const EXAM_B = "6".repeat(40);

/** What a yes or a review read at `head`: what `carry` needs (self-fix PR 10, Part 4). */
const givenAt = (head: string) => ({
	head,
	onto: "main",
	base: "9".repeat(40),
	diff: "d".repeat(40),
});

/** What the exam review read at `head`, and what it met. */
const reviewedAt = (head: string) => ({...givenAt(head), met: 1, of: 1});

/** The exam's pull request as a step may leave it: landed, reviewed, said yes to, at the head or behind it. */
const EXAM_PULLS = [
	{examPull: {head: EXAM_A}},
	{examPull: {head: EXAM_A, reviewed: reviewedAt(EXAM_A)}},
	{examPull: {head: EXAM_A, reviewed: reviewedAt(EXAM_A), yes: givenAt(EXAM_A)}},
	{examPull: {head: EXAM_B, reviewed: reviewedAt(EXAM_B), yes: givenAt(EXAM_A)}},
	{examPull: {head: EXAM_B, reviewed: reviewedAt(EXAM_A)}},
] as const;

const stepEnds: fc.Arbitrary<StepEnd> = fc.record({
	outcome: fc.constantFrom(...OUTCOMES),
	// Self-fix PR 10: the exam's pull request in the carry, so every law here reads it too.
	carry: fc.constantFrom<StepEnd["carry"]>({}, GREEN_CARRY, ...EXAM_PULLS),
});

/** What a restart's fresh read of main may find (self-fix PR 5). */
const freshes: fc.Arbitrary<Fresh> = fc.oneof(
	fc.constantFrom({}, GREEN_CARRY).map((carry) => ({_tag: "fresh" as const, carry})),
	fc.constant({_tag: "exam_conflict" as const, files: ["src/lower.test.ts"]}),
	fc.constant({_tag: "conflicts" as const, files: ["src/lower.ts"]}),
	fc.constant({_tag: "closed" as const}),
);

/** Every pick any question offers, and a call's `go_on`. */
const ANY_PICK = [...new Set<string>([...Object.values(PICKS).flat(), "go_on"])];

const arbs: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {number: fc.constant(7), lane: fc.constant(ID)}),
	resume: arbConstantMsg("resume"),
	restart: arbConstantMsg("restart"),
	lane_answered: arbRecordMsg("lane_answered", {
		ask: fc.string(),
		pick: fc.constantFrom(...ANY_PICK),
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
	lane_fresh_ok: freshes.map((v) => freshMain.ok(FRESH, v, 0)),
	lane_fresh_err: fc.constant(freshMain.err(FRESH, {_tag: "unknown"}, 0)),
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

type FreshCmd = ReturnType<typeof freshMain>;
const isFresh = (cmd: {readonly type: string}): cmd is FreshCmd => cmd.type === "lane_fresh";

/** Where the restart `s` waits on goes on: the `from` of its fresh read of main. `null`: it waits on none. */
const freshFrom = (s: Lane): Resume | null => {
	if (!("asked" in s)) {
		return null;
	}

	const asked: {readonly type: string} = s.asked;
	return isFresh(asked) ? asked.from : null;
};

/** The ends a lane never goes on from: done, a stop in `FINAL`, and a ticket a person closed. */
const ends = (outcome: LaneOutcome): boolean =>
	outcome.kind === "done" ||
	(outcome.kind === "skip" && outcome.why === "closed") ||
	(outcome.kind === "stuck" && FINAL.has(outcome.why));

// ---------------------------------------------------------------- the laws

/** A step starts only as `after` says, or as a person's answer says. */
const inOrder = ({prev, msg, cmds}: LaneStep) => {
	if (msg.type === "resume") {
		return;
	}

	/** The step this Msg should start. A person's answer may start the one its question names. */
	const wanted = (started: string): string => {
		if (msg.type === "lane_claim_ok") {
			return "triage";
		}

		if (msg.type === "lane_answered") {
			if (prev.phase !== "asking") {
				throw new Error("a step started on no question");
			}

			return started;
		}

		// A step that could not run is run once more, as it was (self-fix PR 5, P8).
		if (msg.type === "lane_step_err") {
			if (prev.phase !== "running") {
				throw new Error(`a step started on a failed step in ${prev.phase}`);
			}

			return prev.step;
		}

		// A restart's fresh read: the step the lane stopped at, or the build for the builder's conflicts.
		if (msg.type === "lane_fresh_ok") {
			const from = freshFrom(prev);

			if (from === null) {
				throw new Error(`a step started on a fresh read nobody asked, in ${prev.phase}`);
			}

			if (msg.value._tag === "conflicts") {
				return "build";
			}

			if (from._tag === "run") {
				return from.step;
			}

			throw new Error(`${started} started where the lane goes on by asking ${from.for}`);
		}

		if (msg.type !== "lane_step_ok" || prev.phase !== "running") {
			throw new Error(`a step started on ${msg.type} in ${prev.phase}`);
		}

		// Self-fix PR 10: a passing exam review goes on by what its carry holds, which `after` does not
		// read. A yes that carries to the head runs the merge with no second question; a review or a
		// yes at another head goes back to the review (`running`'s guard). The laws of the exam's pull
		// request below pin which.
		if (
			prev.step === "exam_review" &&
			msg.value.outcome.kind === "done" &&
			(started === "exam_merge" || started === "exam_review")
		) {
			return started;
		}

		const want = afterStep(prev.step, msg.value.outcome, prev.round);

		if (!("to" in want)) {
			throw new Error(`${started} started where the order says stop`);
		}

		return want.to;
	};

	for (const cmd of stepsIn(cmds)) {
		expect(cmd.step).toBe(wanted(cmd.step));
	}

	// The step run once more is the same Act, under the same intent.
	if (msg.type === "lane_step_err" && prev.phase === "running") {
		for (const cmd of stepsIn(cmds)) {
			expect(cmd).toEqual(prev.asked);
		}
	}
};

/** No merge, of the change or of the rules, but on the person's own answer to the right question. */
const noMergeUnasked = ({prev, msg, cmds}: LaneStep) => {
	// A restart sends again only what was already started: `resumeRepeats` holds it to that.
	if (msg.type === "resume") {
		return;
	}

	for (const cmd of stepsIn(cmds)) {
		if (cmd.step !== "merge" && cmd.step !== "exam_merge") {
			continue;
		}

		// The same merge, run once more after it could not run: `inOrder` holds it to the same Act.
		if (msg.type === "lane_step_err") {
			continue;
		}

		// A restart goes on at a merge only where the lane stopped in it, after the person's yes.
		if (msg.type === "lane_fresh_ok") {
			expect(freshFrom(prev)).toEqual({_tag: "run", step: cmd.step});
			continue;
		}

		// Self-fix PR 10: the person's `merge` carries to a new exam head when `carry` keeps it, so the
		// exam's merge runs with no second question: the yes is in the carry it starts with, at its
		// head. Ship's `ejected` runs the same merge once more, on the same yes.
		if (
			cmd.step === "exam_merge" &&
			msg.type === "lane_step_ok" &&
			prev.phase === "running" &&
			(prev.step === "exam_review" || prev.step === "exam_merge")
		) {
			const pull = (
				cmd.carry as {
					readonly examPull?: {readonly head: string; readonly yes?: {readonly head: string}};
				}
			).examPull;
			expect(pull?.head, "the exam's merge ran on no exam head").toEqual(expect.any(String));
			expect(pull?.yes?.head, "the exam's merge ran with no yes at its head").toBe(pull?.head);
			continue;
		}

		if (msg.type !== "lane_answered" || prev.phase !== "asking") {
			throw new Error(`${cmd.step} started on ${msg.type}`);
		}

		// "again" on a step already asked about comes back to it; it was a person's answer as well.
		expect(["merge", "again"]).toContain(msg.pick);

		if (msg.pick === "merge") {
			expect(["merge", "exam_merge"]).toContain(prev.question.for);
		}
	}
};

/** A restart re-sends what was in flight, with its own intent, and starts no step of its own. */
const resumeRepeats = ({prev, msg, next, cmds}: LaneStep) => {
	if (msg.type !== "resume") {
		return;
	}

	expect(next).toEqual(prev);

	if (prev.phase === "idle" || prev.phase === "over") {
		expect(cmds).toEqual([]);
	} else {
		expect(cmds).toEqual([prev.asked]);
	}
};

/** The lane never runs a step under a count it used: each Act's intent is new. */
const eachStepOnce = ({prev, msg, next, cmds}: LaneStep) => {
	if (msg.type === "resume") {
		return;
	}

	const was = "count" in prev ? prev.count : 0;

	// A step that could not run is run once more under its own intent: the only Act sent twice (P8).
	if (msg.type === "lane_step_err") {
		for (const cmd of stepsIn(cmds)) {
			expect(cmd.count).toBe(was);
		}

		return;
	}

	for (const cmd of stepsIn(cmds)) {
		expect(cmd.count).toBe(was + 1);
		expect(cmd.intent).toBe(`lane/${cmd.number}/${cmd.count}/${cmd.step}`);
	}

	if ("count" in next) {
		expect(next.count).toBeGreaterThanOrEqual(was);
	}
};

/** A step's own answer, a skip included, is written on the trail as it was said. */
const everyEndWritten = ({prev, msg, next}: LaneStep) => {
	if (msg.type !== "lane_step_ok" || prev.phase !== "running") {
		return;
	}

	if (!("trail" in next)) {
		throw new Error("the trail was lost");
	}

	expect(next.trail.at(-1)).toEqual({step: prev.step, said: nameOf(msg.value.outcome)});
};

/**
 * A stuck child ends the lane in a named state: never silent, never another step. A step that could
 * not run is run once more first, as it was (self-fix PR 5, P8), and a build that changed the test
 * writer's files asks the person which was wrong.
 */
const stuckEnds = ({prev, msg, next, cmds}: LaneStep) => {
	if (prev.phase !== "running") {
		return;
	}

	if (msg.type === "lane_step_err" && next.phase === "running") {
		expect(cmds).toEqual([prev.asked]);
		return;
	}

	const stuck =
		(msg.type === "lane_step_ok" && msg.value.outcome.kind === "stuck") ||
		msg.type === "lane_step_err";

	if (!stuck) {
		return;
	}

	if (
		msg.type === "lane_step_ok" &&
		prev.step === "build" &&
		nameOf(msg.value.outcome) === "stuck:exam_touched"
	) {
		expect(next.phase === "asking" && next.question.for).toBe("exam_touched");
		return;
	}

	expect(next.phase).toBe("releasing");

	if (next.phase !== "releasing") {
		return;
	}

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
	if (msg.type !== "lane_read_ok" || prev.phase !== "reading" || msg.value.mine) {
		return;
	}

	expect(next.phase).toBe("over");
	expect(cmds).toEqual([]);
};

const decodeHeld = Schema.decodeUnknownSync(Held);

/**
 * A stop saves what a restart needs (self-fix PR 5, P6): a stop that may go on keeps the lane's `Held`,
 * as it was, and where it goes on. An end, done or a closed ticket, keeps neither.
 */
const stopsSave = ({prev, next}: LaneStep) => {
	if (next.phase !== "over" || prev.phase === "over") {
		return;
	}

	const {outcome} = next;
	const name = nameOf(outcome);
	const kept = "held" in next || "at" in next;

	if ((outcome.kind === "done" || name === "skip:closed") && kept) {
		throw new Error(`${name} kept a Held or a place to go on`);
	}

	const mayGoOn = outcome.kind === "stuck" && !ends(outcome);

	if (mayGoOn && (!("held" in next) || !("at" in next))) {
		throw new Error(`${name} from ${prev.phase} kept no Held or no place to go on`);
	}

	const saved =
		mayGoOn && "held" in next && "count" in prev ? {kept: next.held, had: decodeHeld(prev)} : null;
	expect(saved?.kept, `${name} from ${prev.phase} changed its Held`).toEqual(saved?.had);
};

/**
 * The same line typed again on a stop that may go on reads the ticket and main before any step runs.
 * On anything else it does nothing.
 */
const restartReadsFirst = ({prev, msg, next, cmds}: LaneStep) => {
	if (msg.type !== "restart") {
		return;
	}

	expect(stepsIn(cmds), "a step started on the restart itself").toEqual([]);
	const stopped = prev.phase === "over" && "held" in prev && !ends(prev.outcome);

	if (!stopped) {
		expect(next).toEqual(prev);
		expect(cmds).toEqual([]);
		return;
	}

	expect(next.phase).not.toBe("over");
	expect(cmds).not.toEqual([]);
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
	stopsSave,
	restartReadsFirst,
};

describe("the lane's laws", () => {
	for (const [name, law] of Object.entries(LAWS)) {
		it(`${name} holds on the real reducer`, () => check(lane, law));
	}
});

describe("each law fails on its planted break", () => {
	const startMerge = (s: Lane) => {
		if (s.phase !== "running") {
			return [s, []] as const;
		}

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
				if (s.phase !== "running") {
					return [s, []];
				}

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
		stopsSave: {
			lane_release_ok: (s: Lane) =>
				s.phase === "releasing"
					? [
							{
								phase: "over",
								number: s.number,
								trail: s.trail,
								outcome: s.outcome,
								said: s.said,
							},
							[],
						]
					: [s, []],
		},
		restartReadsFirst: {
			restart: (s: Lane) => (s.phase === "over" ? [s, [STEP]] : [s, []]),
		},
	};

	for (const [name, law] of Object.entries(LAWS)) {
		it(`${name} catches its plant`, () => {
			expect(() => check(plant(breaks[name as keyof typeof LAWS]), law)).toThrow();
		});
	}
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
				// A phase a restart waits in (self-fix PR 5): this walk never restarts.
				default:
					return [s, []];
			}
		};
		let s: Lane = {phase: "idle"};

		for (let i = 0; i < 200; i++) {
			const [moved, cmds] = next(s);
			s = moved;

			for (const cmd of cmds) {
				if (cmd.type === "lane_ask") {
					asks.push(cmd.ask);
				}
			}
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
				const carry =
					s.step === "build"
						? GREEN_CARRY
						: s.step === "exam"
							? {examPull: {head: EXAM_A}}
							: s.step === "exam_review"
								? {examPull: {head: EXAM_A, reviewed: reviewedAt(EXAM_A)}}
								: {};
				go(runStep.ok(STEP, {outcome: answers[s.step] ?? DONE, carry}, 0));
			} else if (s.phase === "asking") {
				seen.push(s.question.for);
				go({
					type: "lane_answered",
					ask: s.question.ask,
					pick: picks[s.question.for] ?? s.question.picks[0] ?? "",
				});
			} else if (s.phase === "releasing") {
				go(releaseLane.ok(RELEASE, "released", 0));
			}
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
		// Self-fix PR 10: the exam's pull request gets the lane's own review before the person's yes.
		expect(seen.slice(2, 8)).toEqual([
			"approve",
			"exam",
			"exam_review",
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

	// Self-fix PR 5: a person's no is a saved pause, not an end. It goes on at the plan.
	it("a person's no on the plan pauses the lane at the plan, and nothing merges", () => {
		const asked = [
			{type: "start", number: 7, lane: ID},
			readFiled.ok(READ, {state: "open", mine: true}, 0),
			claimLane.ok(CLAIM, ID, 0),
			runStep.ok(STEP, {outcome: {kind: "send", to: "plan", why: "yes"}, carry: {}}, 0),
			runStep.ok(STEP, {outcome: DONE, carry: {}}, 0),
		].reduce<Lane>((s, m) => stepped(s, m as Msg), IDLE);

		if (asked.phase !== "asking") {
			throw new Error(asked.phase);
		}

		const end = stepped(asked, {type: "lane_answered", ask: asked.question.ask, pick: "no"});
		expect(end.phase).toBe("releasing");
		const over = stepped(end, releaseLane.ok(RELEASE, "released", 0));
		expect(over.phase === "over" && nameOf(over.outcome)).not.toBe("done");
		expect(over).toMatchObject({phase: "over", at: {_tag: "run", step: "plan"}});
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
					if (s.step === "build") {
						builds++;
					}

					return runStep.ok(
						STEP,
						{outcome: answerTo(s), carry: s.step === "build" ? GREEN_CARRY : {}},
						0,
					);
				case "asking": {
					const spent = s.question.for === "rounds_spent";
					const pick = spent ? (answers.shift() ?? "stop") : (s.question.picks[0] ?? "");

					if (spent && pick === "again") {
						agains++;
					}

					return {type: "lane_answered", ask: s.question.ask, pick};
				}
				case "releasing":
					return releaseLane.ok(RELEASE, "released", 0);
				// A phase a restart waits in (self-fix PR 5): this walk never restarts.
				default:
					return null;
			}
		};
		let s: Lane = {phase: "idle"};

		for (let i = 0; i < 400; i++) {
			const msg = msgFor(s);

			if (msg === null) {
				break;
			}

			const next = stepped(s, msg);

			if (s.phase === "running" && s.step === "mutation" && msg.type === "lane_step_ok") {
				const red = msg.value.outcome.kind === "send";
				const toBuild = next.phase === "running" && next.step === "build";

				if (!red && !(next.phase === "running" && next.step === "review")) {
					problems.push(`a green head went to ${where(next)}`);
				}

				if (red && s.round < MAX_ROUNDS && !(toBuild && next.round === s.round + 1)) {
					problems.push(`a red head in round ${s.round} went to ${where(next)}`);
				}

				if (
					red &&
					s.round >= MAX_ROUNDS &&
					!(next.phase === "asking" && next.question.for === "rounds_spent")
				) {
					problems.push(`a red head with the rounds spent went to ${where(next)}`);
				}
			}

			if (next.phase === "running" && next.step === "build" && next.round > MAX_ROUNDS + agains) {
				problems.push(`build round ${next.round} on ${agains} agains`);
			}

			const name = next.phase === "releasing" ? nameOf(next.outcome) : "";

			if (name.startsWith("stuck:") && name !== "stuck:rounds_spent") {
				problems.push(`ended ${name}`);
			}

			s = next;
		}

		if (builds > MAX_ROUNDS + agains) {
			problems.push(`${builds} builds on ${agains} agains`);
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
	const COMMANDS = [{command: "vitest run --reporter=json --outputFile={out}", code: 0, ms: 4_210}];
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
		/**
		 * Each push, in turn: a new head, with these checks at it, so the merge after it may start on a
		 * head nobody checked. Past the last, the head stays as it was.
		 */
		pushes: fc.array(fc.constantFrom<Checks>("green", "elsewhere", "red", "none"), {maxLength: 3}),
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
		const pushes = [...run.pushes];
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
				case "push": {
					const checks = pushes.shift();
					return {outcome: DONE, carry: checks === undefined ? {} : at(headOf(++commits), checks)};
				}
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
				// A phase a restart waits in (self-fix PR 5): this walk never restarts.
				default:
					return null;
			}
		};
		let s: Lane = {phase: "idle"};

		for (let i = 0; i < 300; i++) {
			const msg = msgFor(s);

			if (msg === null) {
				break;
			}

			const [next, cmds] = (
				machine.update[msg.type] as (s: Lane, m: Msg) => readonly [Lane, readonly LaneCmd[]]
			)(s, msg);

			for (const cmd of stepsIn(cmds)) {
				if (!AFTER_BUILD.has(cmd.step)) {
					continue;
				}

				const {head, checked} = cmd.carry as {
					readonly head: string | null;
					readonly checked?: {readonly head: string; readonly result: string};
				};

				if (checked?.result !== "green" || checked.head !== head) {
					problems.push(
						`${cmd.step} ran on ${head} with checks ${JSON.stringify(checked ?? null)}`,
					);
				}
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

// ---------------------------------------------------------------- a stopped lane goes on (self-fix PR 5)
//
// Laws over whole runs: a lane walked from its start in a world that answers each Act it sends, stopped,
// then sent the same line again. Each law iterates the unions it names (the steps, the stuck reasons,
// the asks and their picks), so a new member joins it by being in the union.

type Running = Extract<Lane, {phase: "running"}>;
type Asking = Extract<Lane, {phase: "asking"}>;
type StepCmd = ReturnType<typeof runStep>;

/** What the lane's Acts meet: how each step ends, what a person picks, the ticket, and main. */
interface World {
	/** How a step ends. `err`: it could not run at all. */
	readonly end: (s: Running, cmd: StepCmd) => StepEnd | "err";
	readonly pick: (question: Question) => string;
	/** The ticket, read. Left out: open, and yours. */
	readonly filed?: Filed;
	/** What a restart's fresh read of main finds. Left out: nothing moved, and nothing changed. */
	readonly fresh?: Fresh;
}

interface Moved {
	readonly prev: Lane;
	readonly msg: Msg;
	readonly next: Lane;
	readonly cmds: readonly LaneCmd[];
}

/** The answers to one Act, as the world gives them. */
const repliesTo = (cmd: LaneCmd, s: Lane, world: World): readonly Msg[] => {
	switch (cmd.type) {
		case "lane_read":
			return [readFiled.ok(cmd, world.filed ?? {state: "open", mine: true}, 0)];
		case "lane_claim":
			return [claimLane.ok(cmd, cmd.lane, 0)];
		case "lane_fresh":
			return [freshMain.ok(cmd, world.fresh ?? {_tag: "fresh", carry: {}}, 0)];
		case "lane_step": {
			if (s.phase !== "running") {
				return [];
			}

			const end = world.end(s, cmd);
			return [end === "err" ? runStep.err(cmd, {_tag: "unknown"}, 0) : runStep.ok(cmd, end, 0)];
		}
		case "lane_ask":
			if (s.phase !== "asking") {
				return [];
			}

			return [
				askPerson.ok(cmd, null, 0),
				{type: "lane_answered", ask: cmd.ask, pick: world.pick(s.question)},
			];
		case "lane_release":
			return [releaseLane.ok(cmd, "released", 0)];
	}
};

/** Walk `machine` from `from` on `first`, answering each Act as `world` does, until nothing is in flight or `until`. */
const drive = (
	from: Lane,
	first: Msg,
	world: World,
	until: (s: Lane) => boolean = () => false,
	machine: Machine = lane,
) => {
	const moves: Moved[] = [];
	const queue: Msg[] = [first];
	let s = from;

	for (let i = 0; i < 400 && !until(s); i++) {
		const msg = queue.shift();

		if (msg === undefined) {
			break;
		}

		const {state, cmds} = foldUpdates<Lane, Msg, LaneCmd>(machine, s, [msg]);
		moves.push({prev: s, msg, next: state, cmds});
		s = state;

		for (const cmd of cmds) {
			queue.push(...repliesTo(cmd, s, world));
		}
	}

	return {s, moves};
};

const cmdsOf = (moves: readonly Moved[]) => moves.flatMap((m) => m.cmds);

const IDLE: Lane = {phase: "idle"};
const START: Msg = {type: "start", number: 7, lane: ID};
const RESTART: Msg = {type: "restart"};
const DONE_END: StepEnd = {outcome: {kind: "done", part: false}, carry: {}};
const STUCK_END: StepEnd = {outcome: {kind: "stuck", why: "tests_red"}, carry: {}};

/** A lane through every step: the exam asks for its rule change, a mutant survives, the rest is done. */
const ROUTE: Readonly<Record<StepName, StepEnd>> = {
	triage: {outcome: {kind: "send", to: "plan", why: "yes"}, carry: {}},
	plan: {outcome: {kind: "done", part: false}, carry: {version: 1}},
	exam: {
		outcome: {kind: "ask", who: "owner", for: "check_change"},
		carry: {rules: [".oxlintrc.json"], examPull: {head: EXAM_A}},
	},
	// Self-fix PR 10: the review passes at the exam's head, and the person's yes is asked after it.
	exam_review: {
		outcome: {kind: "done", part: false},
		carry: {examPull: {head: EXAM_A, reviewed: reviewedAt(EXAM_A)}},
	},
	exam_merge: DONE_END,
	test_writer: {outcome: {kind: "done", part: false}, carry: {exam: ["src/lower.test.ts"]}},
	build: {outcome: {kind: "done", part: false}, carry: GREEN_CARRY},
	mutation: {outcome: {kind: "send", to: "test_writer", why: "mutant_survived"}, carry: {}},
	mutants: DONE_END,
	review: DONE_END,
	push: DONE_END,
	merge: DONE_END,
};

/** Every step ends as the route says, and a person takes each question's first pick. */
const ROUTED: World = {end: (s) => ROUTE[s.step], pick: (q) => q.picks[0] ?? ""};

/** The route, with `step` ending as `how` every time it runs. */
const stoppingAt = (step: StepName, how: StepEnd | "err", world: World = ROUTED): World => ({
	...world,
	end: (s, cmd) => (s.step === step ? how : world.end(s, cmd)),
});

/** A lane walked from its start until it stops at `step`, ending as `how`. */
const stoppedAt = (step: StepName, how: StepEnd | "err") => {
	const walked = drive(IDLE, START, stoppingAt(step, how));

	if (walked.s.phase !== "over") {
		throw new Error(`the lane did not stop at ${step}`);
	}

	const ran = stepsIn(cmdsOf(walked.moves)).filter((c) => c.step === step);
	const last = ran.at(-1);

	if (last === undefined) {
		throw new Error(`${step} never ran`);
	}

	return {over: walked.s, ran: last, moves: walked.moves};
};

/** The answer that picks `pick` on the question `s` asks. */
const answer = (s: Asking, pick: string, note?: string): Msg => ({
	type: "lane_answered",
	ask: s.question.ask,
	pick,
	...(note === undefined ? {} : {note}),
});

/** The first Act after `moves` that runs a step or asks a person. */
const firstStart = (moves: readonly Moved[]) =>
	cmdsOf(moves).find((c) => c.type === "lane_step" || c.type === "lane_ask");

const approveAsks = (moves: readonly Moved[]) =>
	moves.filter(
		(m) => m.next.phase === "asking" && m.next.question.for === "approve" && m.cmds.length > 0,
	);

describe("a lane stopped at any step goes on there, with the carry it had", () => {
	const WAYS: readonly {readonly name: string; readonly how: StepEnd | "err"}[] = [
		{name: "ended stuck", how: STUCK_END},
		{name: "could not run, twice", how: "err"},
	];

	for (const step of STEPS) {
		for (const {name, how} of WAYS) {
			it(`${step}, which ${name}: the restart reads main, then runs ${step}, and no step before it`, () => {
				const {over, ran} = stoppedAt(step, how);
				expect(over, "the stop saved where it goes on").toMatchObject({at: {_tag: "run", step}});
				const again = drive(over, RESTART, ROUTED);
				const cmds = cmdsOf(again.moves);
				const started = stepsIn(cmds)[0];
				expect(started?.step, "the first step the restart runs").toBe(step);
				expect(started?.carry).toEqual(ran.carry);
				expect(started?.count ?? 0).toBeGreaterThan(ran.count);
				const at = started === undefined ? -1 : cmds.indexOf(started);
				expect(cmds.slice(0, at).map((c) => c.type)).toEqual(
					expect.arrayContaining(["lane_claim", "lane_fresh"]),
				);
				expect(cmds.slice(0, at).filter((c) => c.type === "lane_ask")).toEqual([]);

				// A restart never asks the plan's yes again while the plan's version is the same.
				if (STEPS.indexOf(step) > STEPS.indexOf("plan")) {
					expect(approveAsks(again.moves)).toEqual([]);
				}

				expect(again.s.phase === "over" && nameOf(again.s.outcome)).toBe("done");
			});
		}
	}
});

describe("every stop, at every step, for every reason", () => {
	const decodeLane = Schema.decodeUnknownSync(Lane);
	const HELD = {
		number: 7,
		lane: "L1",
		count: 9,
		round: 2,
		carry: {...EMPTY, version: 1, exam: ["src/lower.test.ts"], ...GREEN_CARRY},
		trail: [{step: "triage", said: "send:plan:yes"}],
	};
	/** A stop as a lane saved it: its reason, its `Held`, and the step it goes on at. */
	const stop = (
		outcome: unknown,
		step: StepName,
		held: {readonly trail: typeof HELD.trail} = HELD,
	) =>
		decodeLane({
			phase: "over",
			number: 7,
			trail: held.trail,
			outcome,
			said: "stopped",
			held,
			at: {_tag: "run", step},
		});
	const STUCK = LANE_NAMES.flatMap((name) =>
		name.startsWith("stuck:") ? [name.slice("stuck:".length)] : [],
	);

	/** Code's checks at the built head, as `result` says. */
	const checkedAs = (result: "red" | "not_run") => ({...GREEN_CARRY.checked, result});
	/** The reasons a lane stops for when its head has no green checks: only after the build. */
	const CHECKS: ReadonlySet<string> = new Set(["checks_not_run", "checks_red"]);
	/**
	 * What a lane holds as it stops for `why`, in round `round`: a checks reason holds checks at its head
	 * that are not green, as a real lane does. Pure.
	 */
	const heldFor = (why: string, round = HELD.round) => ({
		...HELD,
		round,
		carry:
			why === "checks_not_run"
				? {...HELD.carry, checked: checkedAs("not_run")}
				: why === "checks_red"
					? {...HELD.carry, checked: checkedAs("red")}
					: HELD.carry,
	});
	/** Whether a lane stops at `step` for `why`: a checks reason only at a step after the build. */
	const stopsAt = (why: string, step: StepName) =>
		!CHECKS.has(why) || STEPS.indexOf(step) > STEPS.indexOf("build");
	/** The restart's fresh read as code makes it: main where it was, and code's checks at the head, as `checked`. */
	const freshChecks = (checked: unknown): World => ({
		...ROUTED,
		fresh: Schema.decodeUnknownSync(Fresh)({_tag: "fresh", carry: {checked}}),
	});

	it("FINAL is the closed list: not_yours, and no reason that is not a lane's", () => {
		expect(FINAL.has("not_yours")).toBe(true);

		for (const why of FINAL) {
			expect(STUCK).toContain(why);
		}
	});

	// Round 4 of the tests for self-fix PR 5: this law held every reason on a carry with green checks,
	// which no lane stopped for its checks holds. Now each reason stops where and as a real lane does, and
	// the fresh read gives the checks code ran at the head, green: the step runs on them.
	it("a reason in FINAL never restarts; every other one runs the step it stopped at, with the carry it held and the checks the fresh read ran", () => {
		const world = freshChecks(GREEN_CARRY.checked);

		for (const step of STEPS) {
			for (const why of STUCK.filter((reason) => stopsAt(reason, step))) {
				const over = stop({kind: "stuck", why}, step, heldFor(why));

				if (over.phase !== "over" || !("held" in over)) {
					throw new Error("a stop did not read back");
				}

				const {moves} = drive(over, RESTART, world);

				if (ends(over.outcome)) {
					expect(moves[0]?.cmds, `${why} restarted`).toEqual([]);
					expect(moves[0]?.next).toEqual(over);
					continue;
				}

				const cmds = cmdsOf(moves);
				const started = stepsIn(cmds)[0];
				expect(started?.step, `${why} at ${step}`).toBe(step);
				expect(started?.carry, `${why} at ${step}`).toEqual({
					...over.held.carry,
					checked: GREEN_CARRY.checked,
				});
				const at = started === undefined ? -1 : cmds.indexOf(started);
				expect(cmds.slice(0, at).some(isFresh), `${why} at ${step}: main read first`).toBe(true);

				if (STEPS.indexOf(step) > STEPS.indexOf("plan")) {
					expect(approveAsks(moves)).toEqual([]);
				}
			}
		}
	});

	it("done, and a ticket a person closed, never restart", () => {
		for (const outcome of [
			{kind: "done", part: false},
			{kind: "skip", why: "closed"},
		]) {
			const over = decodeLane({phase: "over", number: 7, trail: [], outcome, said: "ended"});
			const {moves} = drive(over, RESTART, ROUTED);
			expect(moves[0]?.cmds).toEqual([]);
			expect(moves[0]?.next).toEqual(over);
		}
	});

	// Round 4 of the tests for self-fix PR 5, from the review.

	it("a stop for its checks whose fresh read finds them red goes back to the build as the next round, and past the bound asks", () => {
		const world = freshChecks(checkedAs("red"));

		for (const step of STEPS) {
			for (const why of [...CHECKS].filter((reason) => stopsAt(reason, step))) {
				const under = stop({kind: "stuck", why}, step, heldFor(why, MAX_ROUNDS - 1));
				const ran = stepsIn(cmdsOf(drive(under, RESTART, world).moves));
				expect(ran[0], `${why} at ${step}`).toMatchObject({step: "build", round: MAX_ROUNDS});
				const spent = stop({kind: "stuck", why}, step, heldFor(why, MAX_ROUNDS));
				const asked = drive(spent, RESTART, world, (at) => at.phase === "asking").s;
				expect(asked.phase === "asking" && asked.question.for, `${why} at ${step}, spent`).toBe(
					"rounds_spent",
				);
			}
		}
	});

	it("a build whose checks could not run goes on at the checks, never the builder again", () => {
		const {over} = stoppedAt("build", {
			outcome: {kind: "stuck", why: "checks_not_run"},
			carry: {head: BUILT_HEAD, checked: checkedAs("not_run")},
		});
		// The fresh read ran them, green: the step after the build runs.
		const green = stepsIn(cmdsOf(drive(over, RESTART, freshChecks(GREEN_CARRY.checked)).moves));
		expect(green.map((c) => c.step).slice(0, 1)).toEqual(["mutation"]);
		// They could not run again: the lane stops as it was, and no builder ran.
		const again = drive(over, RESTART, ROUTED);
		expect(stepsIn(cmdsOf(again.moves))).toEqual([]);
		expect(again.s.phase === "over" && nameOf(again.s.outcome)).toBe("stuck:checks_not_run");
	});

	it("a pull request merged by someone else ends the lane `stuck:merged_elsewhere`, which never restarts", () => {
		const walked = drive(
			IDLE,
			START,
			stoppingAt("merge", {outcome: {kind: "stuck", why: "merged_elsewhere"}, carry: {}}),
		);
		expect(walked.s.phase === "over" && nameOf(walked.s.outcome)).toBe("stuck:merged_elsewhere");
		expect([...FINAL].map(String)).toContain("merged_elsewhere");
		const {moves} = drive(walked.s, RESTART, ROUTED);
		expect(moves[0]?.cmds).toEqual([]);
	});

	it("two restarts that each stop before any step runs claim and read main under new names", () => {
		const FRESH_CMD = freshMain({
			number: 7,
			from: {_tag: "run", step: "mutation"},
			carry: EMPTY,
			intent: "f",
		});
		let s: Lane = stoppedAt("mutation", STUCK_END).over;
		const names: string[] = [];

		for (let i = 0; i < 2; i++) {
			const {s: reading, moves} = drive(s, RESTART, ROUTED, (at) => at.phase === "refreshing");

			for (const cmd of cmdsOf(moves)) {
				if (cmd.type === "lane_claim" || cmd.type === "lane_fresh") {
					names.push(cmd.intent);
				}
			}

			// Main could not be read: the lane stops before any step, and lets the ticket go.
			s = drive(reading, freshMain.err(FRESH_CMD, {_tag: "unknown"}, 0), ROUTED).s;
			expect(s.phase, `restart ${i + 1}`).toBe("over");
		}

		expect(names).toHaveLength(4);
		expect(names.filter((name, at) => names.indexOf(name) !== at)).toEqual([]);
	});
});

describe("a step that could not run is run once more, on the same intent (`once`, P8)", () => {
	for (const step of STEPS) {
		it(`${step}: run once more at once, and the lane goes on`, () => {
			let failed = false;
			const world: World = {
				...ROUTED,
				end: (s, cmd) => {
					if (s.step !== step || failed) {
						return ROUTED.end(s, cmd);
					}

					failed = true;
					return "err";
				},
			};
			const {s, moves} = drive(IDLE, START, world);
			const runs = stepsIn(cmdsOf(moves)).filter((c) => c.step === step);
			expect(runs.length).toBeGreaterThanOrEqual(2);
			expect(runs[1]?.intent).toBe(runs[0]?.intent);
			expect(s.phase === "over" && nameOf(s.outcome)).toBe("done");
		});
	}

	it("on any run, an intent starts at most twice, and a second time only at once after it could not run", () => {
		fc.assert(
			fc.property(fc.array(fc.boolean(), {maxLength: 40}), (errs) => {
				const left = [...errs];
				const world: World = {
					...ROUTED,
					end: (s, cmd) => (left.shift() === true ? "err" : ROUTED.end(s, cmd)),
				};
				const {s, moves} = drive(IDLE, START, world);
				const starts = new Map<string, number>();

				for (const cmd of stepsIn(cmdsOf(moves))) {
					starts.set(cmd.intent, (starts.get(cmd.intent) ?? 0) + 1);
				}

				for (const [intent, n] of starts) {
					expect(n, intent).toBeLessThanOrEqual(2);
				}

				for (const [at, m] of moves.entries()) {
					if (m.msg.type !== "lane_step_err" || m.prev.phase !== "running") {
						continue;
					}

					const intent = m.prev.asked.intent;
					const before = stepsIn(cmdsOf(moves.slice(0, at))).filter((c) => c.intent === intent);

					// Its first failure: run again now. Its second: the lane stops there, to go on there.
					if (before.length === 1) {
						expect(m.cmds).toEqual([m.prev.asked]);
					} else {
						expect(stepsIn(m.cmds)).toEqual([]);
					}
				}

				if (s.phase === "over" && s.outcome.kind === "stuck") {
					expect(s).toMatchObject({at: {_tag: "run"}});
				}
			}),
			{numRuns: 200, seed: 119120},
		);
	});
});

describe("every pick of every question goes on at the step its definition names (P10)", () => {
	interface Reached {
		readonly s: Asking;
		/** The world the lane goes on in, after the pick. */
		readonly world: World;
	}
	const asksFor =
		(kind: AskFor) =>
		(s: Lane): boolean =>
			s.phase === "asking" && s.question.for === kind;
	const reach = (kind: AskFor, world: World, from: Lane = IDLE, first: Msg = START): Reached => {
		const {s} = drive(from, first, world, asksFor(kind));

		if (s.phase !== "asking" || s.question.for !== kind) {
			throw new Error(`the lane never asked ${kind}; it is ${s.phase}`);
		}

		return {s, world: ROUTED};
	};
	const CONFLICT: Fresh = {_tag: "exam_conflict", files: ["src/lower.test.ts"]};
	/** How a lane comes to ask each kind of question. A new kind does not compile until it is here. */
	const REACH: Readonly<Record<AskFor, () => Reached>> = {
		approve: () => reach("approve", ROUTED),
		exam_merge: () => reach("exam_merge", ROUTED),
		merge: () => reach("merge", ROUTED),
		step: () =>
			reach(
				"step",
				stoppingAt("review", {outcome: {kind: "ask", who: "owner", for: "questions"}, carry: {}}),
			),
		rounds_spent: () =>
			reach(
				"rounds_spent",
				stoppingAt("build", {outcome: {kind: "stuck", why: "rounds_spent"}, carry: {}}),
			),
		exam_touched: () =>
			reach(
				"exam_touched",
				stoppingAt("build", {outcome: {kind: "stuck", why: "exam_touched"}, carry: {}}),
			),
		exam_conflict: () => {
			const {over} = stoppedAt("mutation", STUCK_END);
			const world: World = {...ROUTED, fresh: CONFLICT};
			return {...reach("exam_conflict", world, over, RESTART), world};
		},
		// Self-fix PR 11, rows 18, 23, 40 and 57: a step over its budget asks `spend`.
		spend: () =>
			reach(
				"spend",
				stoppingAt("build", {outcome: {kind: "stuck", why: "over_budget"}, carry: {}}),
			),
	};

	for (const kind of AskFor.literals) {
		it(`${kind}: each pick goes on at its own step, and no step before it; no pick ends the lane`, () => {
			const {s, world} = REACH[kind]();

			for (const pick of s.question.picks) {
				const to = resumeOf(s.question, pick);
				const after = drive(s, answer(s, pick), world).moves;
				const turn = after.findIndex(
					(m) =>
						m.next.phase === "over" ||
						m.cmds.some((c) => c.type === "lane_step" || c.type === "lane_ask"),
				);
				const turned = after[turn];

				if (turned === undefined) {
					throw new Error(`${kind}: ${pick} went nowhere`);
				}

				// A pause, not an end: it keeps its Held and where it goes on, and the same line goes on there.
				const paused = turned.next.phase === "over";
				expect(paused ? turned.next : {held: "running", at: to}, `${kind}: ${pick}`).toMatchObject({
					held: expect.anything(),
					at: to,
				});
				const moves = paused ? drive(turned.next, RESTART, world).moves : after.slice(turn);
				const start = firstStart(moves);
				const asked = moves.find((m) => m.cmds.some((c) => c === start))?.next;
				const went =
					start?.type === "lane_step"
						? {run: start.step}
						: asked?.phase === "asking"
							? {ask: asked.question.for}
							: start?.type;
				expect(went, `${kind}: ${pick}`).toEqual(
					to._tag === "run" ? {run: to.step} : {ask: to.for},
				);
			}
		});
	}

	// Round 3 of the tests for self-fix PR 5: what the mutation step found no test held.

	/** Each kind as `REACH` reaches it, and the cases a kind's own words or resume differ by. */
	const CASES: readonly (readonly [string, () => Reached])[] = [
		...AskFor.literals.map((kind) => [kind, REACH[kind]] as const),
		// The review sent the work back past the rounds: its `again` goes to the writer, not the build.
		[
			"rounds_spent, after the review",
			() =>
				reach(
					"rounds_spent",
					stoppingAt("review", {
						outcome: {kind: "send", to: "builder", why: "review_failed"},
						carry: {},
					}),
				),
		],
		// A build's own question: a build run again is the next round. Self-fix PR 11: `still_red` now
		// goes back to build (row 46), so build's own question comes from row 41, `no_change` twice in a row.
		[
			"step, at the build",
			() =>
				reach("step", stoppingAt("build", {outcome: {kind: "stuck", why: "no_change"}, carry: {}})),
		],
	];

	/** A question as a person meets it: everything but its id, which counts the trail. */
	const shown = (q: Question) => ({
		for: q.for,
		step: q.step,
		what: q.what,
		picks: q.picks,
		call: q.call,
	});

	for (const [name, reached] of CASES) {
		it(`${name}: a question that could not be asked is asked again as it was; a step's own runs the step`, () => {
			const {s} = reached();
			const failed = drive(s, askPerson.err(ASK, {_tag: "unknown"}, 0), ROUTED).s;
			expect(failed.phase, name).toBe("over");
			const {moves} = drive(failed, RESTART, ROUTED, (at) => at.phase === "asking");
			const start = firstStart(moves);
			const again = moves.at(-1)?.next;
			const went =
				start?.type === "lane_step"
					? {run: start.step}
					: again?.phase === "asking"
						? {ask: shown(again.question)}
						: start?.type;
			const runs = s.question.for === "step" || s.question.call !== undefined;
			expect(went, name).toEqual(runs ? {run: s.question.step} : {ask: shown(s.question)});
		});
	}

	for (const [name, reached] of CASES) {
		it(`${name}: each pick's line names the round the lane runs next, and no other round`, () => {
			const {s, world} = reached();
			const ask = s.asked;
			expect(ask.type, name).toBe("lane_ask");
			const lines = ask.type === "lane_ask" ? (ask.does ?? []) : [];

			for (const [i, pick] of s.question.picks.entries()) {
				const after = drive(s, answer(s, pick), world).moves;
				// The pick's own turn: a pause, a step it runs, or a question it asks.
				const turned = after.find(
					(m) =>
						m.next.phase === "over" ||
						m.cmds.some((c) => c.type === "lane_step" || c.type === "lane_ask"),
				)?.next;
				const moves = turned?.phase === "over" ? drive(turned, RESTART, world).moves : after;
				const start = firstStart(moves);
				const round = start?.type === "lane_step" ? start.round : s.round;
				const named = [...(lines[i] ?? "").matchAll(/\bround (\d+)/g)].map((m) => Number(m[1]));
				// A line may say a round once or twice; each time, the one the lane runs.
				expect(
					[...new Set(named)],
					`${name}: \`${pick}\` runs round ${round}: ${lines[i]}`,
				).toEqual(round > s.round ? [round] : []);
			}
		});
	}
});

describe("a stopped lane goes on, case by case", () => {
	const ONTO = "9".repeat(40);

	it("a lane stuck at mutation, sent `restart`: main is read fresh and checked, then mutation runs", () => {
		const {over} = stoppedAt("mutation", STUCK_END);
		const moved = {
			base: ONTO,
			head: "7".repeat(40),
			checked: {...GREEN_CARRY.checked, head: "7".repeat(40)},
		};
		const {moves} = drive(over, RESTART, {...ROUTED, fresh: {_tag: "fresh", carry: moved}});
		expect(moves[0]?.cmds, "the restart did nothing").not.toEqual([]);
		const cmds = cmdsOf(moves);
		const fresh = cmds.findIndex(isFresh);
		const first = stepsIn(cmds)[0];
		expect(fresh).toBeGreaterThanOrEqual(0);
		expect(first === undefined ? -1 : cmds.indexOf(first)).toBeGreaterThan(fresh);
		expect(first?.step).toBe("mutation");
		expect(first?.carry).toMatchObject(moved);
	});

	// Self-fix PR 10, Part 4 (docs/direction/a-yes-binds-to-the-diff.md). A pushed branch takes main in
	// by a merge, so its head moves. The fresh read runs `carry` from what the review judged to the
	// merged head, and says so in `review`. Only a review that does not stand there sends the lane back
	// to review. One that stands goes to the push, so the pull request shows the merged head, then on.
	// A glance stands no more than a stale one: nobody answered its question here.
	describe("a pushed branch with main merged in, by what `carry` says of its review", () => {
		const MERGED = "6".repeat(40);
		const moved = {base: ONTO, head: MERGED, checked: {...GREEN_CARRY.checked, head: MERGED}};
		const SAYS: readonly {readonly review: Carried; readonly first: StepName}[] = [
			{review: {_tag: "kept", why: "same_head"}, first: "push"},
			{review: {_tag: "kept", why: "replayed"}, first: "push"},
			{review: {_tag: "kept", why: "formatted"}, first: "push"},
			{review: {_tag: "glance", range: "1:  abc = 1:  abc"}, first: "review"},
			{review: {_tag: "stale"}, first: "review"},
		];
		/** The first step the restart runs, after the lane stopped at `stopped` and main was merged in. */
		const restartedAt = (stopped: StepName, review: Carried) => {
			const {over} = stoppedAt(stopped, STUCK_END);
			const {moves} = drive(over, RESTART, {
				...ROUTED,
				fresh: {_tag: "merged", carry: moved, review},
			});
			return stepsIn(cmdsOf(moves))[0];
		};

		for (const stopped of ["push", "merge"] as const) {
			for (const {review, first} of SAYS) {
				it(`stopped at ${stopped}, the review ${review._tag === "kept" ? `kept, ${review.why}` : review._tag}: the restart runs ${first} first`, () => {
					const start = restartedAt(stopped, review);
					expect(start?.step).toBe(first);
					expect(start?.carry).toMatchObject(moved);
				});
			}
		}

		it("a review that stands runs no review before the merge: push, then merge", () => {
			const {over} = stoppedAt("merge", STUCK_END);
			const {moves} = drive(over, RESTART, {
				...ROUTED,
				fresh: {_tag: "merged", carry: moved, review: {_tag: "kept", why: "replayed"}},
			});
			expect(stepsIn(cmdsOf(moves)).map((c) => c.step)).toEqual(["push", "merge"]);
		});

		it("a review that stands is no excuse for red checks at the merged head: the builder gets them", () => {
			const {over} = stoppedAt("merge", STUCK_END);
			const red = {...moved, checked: {...moved.checked, result: "red" as const}};
			const {moves} = drive(over, RESTART, {
				...ROUTED,
				fresh: {_tag: "merged", carry: red, review: {_tag: "kept", why: "replayed"}},
			});
			expect(stepsIn(cmdsOf(moves))[0]?.step).toBe("build");
		});
	});

	it("a build that changed the test writer's files asks which was wrong; each pick is a next round", () => {
		const {s} = drive(
			IDLE,
			START,
			stoppingAt("build", {outcome: {kind: "stuck", why: "exam_touched"}, carry: {}}),
			(at) => at.phase === "asking" && at.question.for === "exam_touched",
		);

		if (s.phase !== "asking") {
			throw new Error(`the lane is ${s.phase}, not asking`);
		}

		expect(s.question.for).toBe("exam_touched");
		expect(s.question.picks).toEqual(PICKS.exam_touched);
		// The builder was wrong: the files go back, and the build runs again as the next round.
		const builder = stepsIn(cmdsOf(drive(s, answer(s, "builder_wrong"), ROUTED).moves));
		expect(builder[0]).toMatchObject({step: "build", round: s.round + 1});
		// The test was wrong: the test writer redoes the touched files, then the build, as the next round.
		const test = stepsIn(cmdsOf(drive(s, answer(s, "test_wrong"), ROUTED).moves));
		expect(test.slice(0, 2)).toMatchObject([
			{step: "test_writer"},
			{step: "build", round: s.round + 1},
		]);
	});

	// Self-fix PR 5: "Either pick adds one round to the bound, like `again`." A touched exam in round 1
	// and red heads after it: the builder still gets its MAX_ROUNDS tries past the round the pick
	// started, so the rounds' question comes one round later than with no touch.
	it("either exam_touched pick adds one round to the bound, like a spent round's `again`", () => {
		const RED: StepEnd = {outcome: {kind: "send", to: "builder", why: "checks_red"}, carry: {}};
		const {s} = drive(
			IDLE,
			START,
			stoppingAt("build", {outcome: {kind: "stuck", why: "exam_touched"}, carry: {}}),
			(at) => at.phase === "asking" && at.question.for === "exam_touched",
		);

		if (s.phase !== "asking") {
			throw new Error(`the lane is ${s.phase}, not asking`);
		}

		expect(s.round).toBe(1);

		for (const pick of PICKS.exam_touched) {
			const {s: spent, moves} = drive(
				s,
				answer(s, pick),
				stoppingAt("build", RED),
				(at) => at.phase === "asking" && at.question.for === "rounds_spent",
			);
			const rounds = stepsIn(cmdsOf(moves))
				.filter((c) => c.step === "build")
				.map((c) => c.round);
			expect(rounds, pick).toEqual(Array.from({length: MAX_ROUNDS}, (_, i) => i + 2));
			expect(spent.phase === "asking" && spent.round, pick).toBe(MAX_ROUNDS + 1);
		}
	});

	it("main changed an exam file: the restart asks, with the files; `again` reruns the test writer, then build", () => {
		const {over} = stoppedAt("mutation", STUCK_END);
		const conflict: World = {
			...ROUTED,
			fresh: {_tag: "exam_conflict", files: ["src/lower.test.ts"]},
		};
		const {s} = drive(over, RESTART, conflict, (at) => at.phase === "asking");

		if (s.phase !== "asking") {
			throw new Error(`the lane is ${s.phase}, not asking`);
		}

		expect(s.question.for).toBe("exam_conflict");
		expect(s.question.what).toContain("src/lower.test.ts");
		expect(s.question.picks).toEqual(PICKS.exam_conflict);
		expect(
			stepsIn(cmdsOf(drive(over, RESTART, conflict, (at) => at.phase === "asking").moves)),
		).toEqual([]);
		const again = stepsIn(cmdsOf(drive(s, answer(s, "again"), ROUTED).moves));
		expect(again.slice(0, 2)).toMatchObject([
			{step: "test_writer"},
			{step: "build", round: s.round + 1},
		]);
		// `stop`: saved at the rebase, so the same line reads main again.
		const stopped = drive(s, answer(s, "stop"), conflict).s;
		expect(stopped).toMatchObject({phase: "over", held: expect.anything(), at: expect.anything()});
		const later = cmdsOf(drive(stopped, RESTART, conflict).moves);
		expect(later.some(isFresh)).toBe(true);
	});

	it("main conflicts with the builder's files: the build runs again", () => {
		const {over} = stoppedAt("mutation", STUCK_END);
		const {moves} = drive(over, RESTART, {
			...ROUTED,
			fresh: {_tag: "conflicts", files: ["src/lower.ts"]},
		});
		expect(stepsIn(cmdsOf(moves))[0]?.step).toBe("build");
	});

	it("a ticket closed while the lane was stopped: the restart ends `skip:closed` and runs no step", () => {
		const {over} = stoppedAt("mutation", STUCK_END);
		const {s, moves} = drive(over, RESTART, {
			...ROUTED,
			filed: {state: "closed", mine: true},
			fresh: {_tag: "closed"},
		});
		expect(moves[0]?.cmds, "the restart did nothing").not.toEqual([]);
		expect(stepsIn(cmdsOf(moves))).toEqual([]);
		expect(s.phase === "over" && nameOf(s.outcome)).toBe("skip:closed");
	});

	it("a `no` on the plan's yes pauses at the plan; the same line runs the plan with the note, and not triage", () => {
		const {s} = drive(IDLE, START, ROUTED, (at) => at.phase === "asking");

		if (s.phase !== "asking") {
			throw new Error(`the lane is ${s.phase}, not asking`);
		}

		expect(s.question.for).toBe("approve");
		const NOTE = "Keep it to ASCII.";
		const paused = drive(s, answer(s, "no", NOTE), ROUTED).s;
		expect(paused).toMatchObject({phase: "over", at: {_tag: "run", step: "plan"}});
		const ran = stepsIn(cmdsOf(drive(paused, RESTART, ROUTED).moves));
		expect(ran[0]?.step).toBe("plan");
		expect(ran[0]?.carry.decided?.said).toContain(NOTE);
		expect(ran.map((c) => c.step)).not.toContain("triage");
	});

	it("a `no` on the merge pauses; the same line asks the merge again, and runs no step first", () => {
		const {s} = drive(
			IDLE,
			START,
			ROUTED,
			(at) => at.phase === "asking" && at.question.for === "merge",
		);

		if (s.phase !== "asking") {
			throw new Error(`the lane is ${s.phase}, not asking`);
		}

		const paused = drive(s, answer(s, "no"), ROUTED).s;
		expect(paused).toMatchObject({phase: "over", at: {_tag: "ask", for: "merge"}});
		const {moves} = drive(paused, RESTART, ROUTED, (at) => at.phase === "asking");
		const start = firstStart(moves);
		expect(start?.type).toBe("lane_ask");
		expect(moves.at(-1)?.next.phase === "asking" && moves.at(-1)?.next).toMatchObject({
			question: {for: "merge"},
		});
	});

	it("a `stop` on the spent rounds pauses; the same line runs the build, round + 1", () => {
		const RED: StepEnd = {outcome: {kind: "send", to: "builder", why: "checks_red"}, carry: {}};
		const {s} = drive(
			IDLE,
			START,
			stoppingAt("build", RED),
			(at) => at.phase === "asking" && at.question.for === "rounds_spent",
		);

		if (s.phase !== "asking") {
			throw new Error(`the lane is ${s.phase}, not asking`);
		}

		const paused = drive(s, answer(s, "stop"), ROUTED).s;
		expect(paused).toMatchObject({phase: "over", at: {_tag: "run", step: "build"}});
		const ran = stepsIn(cmdsOf(drive(paused, RESTART, ROUTED).moves));
		expect(ran[0]).toMatchObject({step: "build", round: MAX_ROUNDS + 1});
	});

	// Round 3 of the tests for self-fix PR 5: what the mutation step found no test held.

	it("a stop before any step keeps `[build] send_back` as the line read it, and says why it stopped", () => {
		const OFF: Msg = {type: "start", number: 7, lane: ID, sendBack: false};
		const reading = drive(IDLE, OFF, ROUTED, (at) => at.phase === "reading").s;
		const claiming = drive(IDLE, OFF, ROUTED, (at) => at.phase === "claiming").s;
		const stops = {
			read: foldUpdates<Lane, Msg, LaneCmd>(lane, reading, [
				readFiled.err(READ, {_tag: "unknown"}, 0),
			]).state,
			claim: foldUpdates<Lane, Msg, LaneCmd>(lane, claiming, [
				claimLane.err(CLAIM, {_tag: "unknown"}, 0),
			]).state,
		};

		for (const [how, over] of Object.entries(stops)) {
			expect(over, `the ${how} failed`).toMatchObject({
				phase: "over",
				said: expect.stringMatching(/\S/),
				held: {sendBack: false},
			});
		}
	});

	it("a build that changed the test writer's files asks which was wrong, naming the files", () => {
		const TOUCHED = ["src/lower.test.ts", "src/upper.test.ts"];
		const {s} = drive(
			IDLE,
			START,
			stoppingAt("build", {
				outcome: {kind: "stuck", why: "exam_touched"},
				carry: {touched: TOUCHED},
			}),
			(at) => at.phase === "asking" && at.question.for === "exam_touched",
		);

		if (s.phase !== "asking") {
			throw new Error(`the lane is ${s.phase}, not asking`);
		}

		for (const file of TOUCHED) {
			expect(s.question.what).toContain(file);
		}
	});
});

// ---------------------------------------------------------------- the exam's pull request (self-fix PR 10)
//
// exam -> exam_review -> (yes) -> exam_merge -> test_writer. The exam's `check_change` runs code and one
// fresh review of its pull request first. A review or checks that fail send the exam writer a redo. A ship
// refusal at `exam_merge` goes to the step that can fix it (./routes.ts), never `stuck:sent_back`. A
// person's yes that carries to a new head (`carry`, Part 4) is not asked again; anything the exam
// writer rewrote is. Walked from the lane's start in a world that answers each Act as a script says.

const RULE = ".oxlintrc.json";
const EXAM_PR = "local:example/lane/pull/1";
/** A head the exam's pull request had before: a yes or a review bound to it does not hold now. */
const EXAM_OLD = `${"0".repeat(39)}1`;
/** Each head the exam's pull request gets, in turn. */
const examHead = (n: number) => n.toString(16).padStart(40, "e");

/** How one exam review ends. `moved`: it read a new head on the host, as a person's push or code's format commit. */
interface ReviewEnd {
	readonly how: "pass" | "review_failed" | "checks_red";
	/** The head its verdicts are at: the pull request's, or an older one. */
	readonly reviewed: "head" | "old";
	/** A person's yes the review's Gather found still holds (`carry` kept), and at which head. */
	readonly yes: "none" | "head" | "old";
	readonly moved: boolean;
}

const PASS: ReviewEnd = {how: "pass", reviewed: "head", yes: "none", moved: false};

interface ExamScript {
	/** Each exam review, in turn. Past the last: `PASS`. */
	readonly reviews?: readonly ReviewEnd[];
	/** Each exam merge, in turn: ship's name for how it ended, or `done`. Past the last: done. */
	readonly merges?: readonly string[];
	/** Each answer, in turn. One the question does not offer falls to its first pick. */
	readonly picks?: readonly string[];
}

/** Ship's end, from its name: `send:reviewer:no_review`, `stuck:checks_stuck`, `done`. */
const shipEnd = (name: string): Outcome => {
	const [verb, a = "", b = ""] = name.split(":");

	if (verb === "send") {
		return {kind: "send", to: a, why: b};
	}

	if (verb === "stuck") {
		return {kind: "stuck", why: a};
	}

	return {kind: "done", part: false};
};

/** The exam's pull request as the lane holds it now. */
const pullOf = (carry: unknown) =>
	(
		carry as {
			readonly examPull?: {
				readonly head: string;
				readonly reviewed?: {readonly head: string};
				readonly yes?: {readonly head: string};
			};
		}
	).examPull;

/** The world of one script: the exam lands a new head each time, and the rest goes as `ROUTE` says. */
const examWorld = (script: ExamScript): World => {
	const reviews = [...(script.reviews ?? [])];
	const merges = [...(script.merges ?? [])];
	const picks = [...(script.picks ?? [])];
	let heads = 0;
	return {
		end: (s) => {
			switch (s.step) {
				case "exam":
					return {
						outcome: {kind: "ask", who: "owner", for: "check_change"},
						carry: {rules: [RULE], examPr: EXAM_PR, examPull: {head: examHead(++heads)}},
					} as StepEnd;
				case "exam_review": {
					const r = reviews.shift() ?? PASS;
					const head = r.moved ? examHead(++heads) : (pullOf(s.carry)?.head ?? EXAM_OLD);

					if (r.how !== "pass") {
						return {
							outcome: {kind: "send", to: "builder", why: r.how},
							carry: {examPull: {head}},
						} as StepEnd;
					}

					const at = (which: "head" | "old") => (which === "head" ? head : EXAM_OLD);
					return {
						outcome: {kind: "done", part: false},
						carry: {
							examPull: {
								head,
								reviewed: reviewedAt(at(r.reviewed)),
								...(r.yes === "none" ? {} : {yes: givenAt(at(r.yes))}),
							},
						},
					} as StepEnd;
				}
				case "exam_merge":
					return {outcome: shipEnd(merges.shift() ?? "done"), carry: {}};
				default:
					return ROUTE[s.step];
			}
		},
		pick: (q) => {
			const want = picks.shift() ?? "";
			return q.picks.includes(want) ? want : (q.picks[0] ?? "");
		},
	};
};

/** Walk the lane from its start on one script, until the test writer or the build starts, or it stops. */
const examRun = (script: ExamScript, machine: Machine = lane) =>
	drive(
		IDLE,
		START,
		examWorld(script),
		(s) => s.phase === "running" && (s.step === "test_writer" || s.step === "build"),
		machine,
	);

/** What the lane did, in order: each step it started, and each question it asked as `ask:<kind>`. */
const doneInOrder = (moves: readonly Moved[]): readonly string[] =>
	cmdsOf(moves).flatMap((c) =>
		c.type === "lane_step"
			? [c.step]
			: c.type === "lane_ask"
				? [`ask:${askedFor(c.ask) ?? c.ask}`]
				: [],
	);

const examsIn = (moves: readonly Moved[]) =>
	stepsIn(cmdsOf(moves)).filter((c) => c.step === "exam");

const countOf = (seen: readonly string[], what: string) => seen.filter((x) => x === what).length;

describe("the exam's pull request, step by step", () => {
	it("the exam's ask runs exam_review, then the person's yes, then exam_merge, then the test writer", () => {
		expect(doneInOrder(examRun({}).moves)).toEqual([
			"triage",
			"plan",
			"ask:approve",
			"exam",
			"exam_review",
			"ask:exam_merge",
			"exam_merge",
			"test_writer",
		]);
	});

	it("the person's `merge` runs exam_merge with their yes at the head they were asked about", () => {
		const {moves} = examRun({});
		const merge = stepsIn(cmdsOf(moves)).find((c) => c.step === "exam_merge");
		expect(pullOf(merge?.carry)).toMatchObject({
			head: examHead(1),
			reviewed: {head: examHead(1)},
			yes: {head: examHead(1)},
		});
	});

	for (const why of ["review_failed", "checks_red"] as const) {
		it(`a review that ends ${why} runs the exam step again, from the exam head, and the build never starts first`, () => {
			const {moves} = examRun({reviews: [{...PASS, how: why}]});
			expect(doneInOrder(moves).slice(3)).toEqual([
				"exam",
				"exam_review",
				"exam",
				"exam_review",
				"ask:exam_merge",
				"exam_merge",
				"test_writer",
			]);
			// The redo starts in a copy of the exam head, and lands on the same pull request.
			expect(pullOf(examsIn(moves)[1]?.carry)?.head).toBe(examHead(1));
			expect(examsIn(moves)[1]?.carry.examPr).toBe(EXAM_PR);
		});
	}

	it("a review that keeps failing runs the exam step at most the bound, then asks `rounds_spent`", () => {
		const failing = Array.from({length: 8}, () => ({...PASS, how: "review_failed" as const}));
		const {s, moves} = examRun({reviews: failing, picks: ["approve", "stop"]});
		expect(examsIn(moves)).toHaveLength(MAX_ROUNDS);
		expect(doneInOrder(moves).at(-1)).toBe("ask:rounds_spent");
		expect(doneInOrder(moves)).not.toContain("test_writer");
		expect(s.phase).toBe("over");
	});

	/** The `what` of each spent-rounds question the lane put, in turn. */
	const spentWhats = (moves: readonly Moved[]) =>
		cmdsOf(moves).flatMap((c) =>
			c.type === "lane_ask" && askedFor(c.ask) === "rounds_spent" ? [c.what] : [],
		);

	it("`again` past the exam's bound runs the exam writer once more in the lane's own round", () => {
		const failing = Array.from({length: 8}, () => ({...PASS, how: "review_failed" as const}));
		const {moves} = examRun({reviews: failing, picks: ["approve", "again", "stop"]});
		const exams = examsIn(moves);
		// The bound, then the one `again` gave: never a lane round, which the test writer reads.
		expect(exams).toHaveLength(MAX_ROUNDS + 1);
		expect(exams.map((c) => c.round)).toEqual(exams.map(() => 1));
	});

	it("the spent rounds' question names the review or the checks after a review, the merge after a merge", () => {
		const failing = Array.from({length: 8}, () => ({...PASS, how: "review_failed" as const}));
		const reviewed = spentWhats(examRun({reviews: failing, picks: ["approve", "stop"]}).moves);
		expect(reviewed).toHaveLength(1);
		expect(reviewed[0]).toContain("the review or the checks still send them back");
		const merges = Array.from({length: 8}, () => "send:builder:review_failed");
		const picks = ["approve", ...Array.from({length: 8}, () => "stop")];
		const merged = spentWhats(examRun({merges, picks}).moves);
		expect(merged).toHaveLength(1);
		expect(merged[0]).toContain("the merge still send them back");
	});

	/** The step ship's `send` at exam_merge runs next (./routes.ts). */
	const NEXT_AFTER_SHIP: Readonly<Record<string, StepName>> = {
		"send:reviewer:no_review": "exam_review",
		"send:builder:checks_red": "exam_review",
		"send:builder:behind": "exam_review",
		"send:builder:review_failed": "exam",
		"send:builder:conflicts": "exam",
		"send:builder:bot_comment": "exam",
		"send:builder:ejected": "exam_merge",
	};

	it("names a next step for every send ship can end with", () => {
		expect(Object.keys(NEXT_AFTER_SHIP).sort()).toEqual(
			SHIP_NAMES.filter((name) => name.startsWith("send:")).sort(),
		);
	});

	for (const [send, next] of Object.entries(NEXT_AFTER_SHIP)) {
		it(`ship's ${send} at exam_merge runs ${next} next, and never ends stuck:sent_back`, () => {
			const {moves} = examRun({merges: [send]});
			const steps = doneInOrder(moves).filter((x) => !x.startsWith("ask:"));
			expect(steps[steps.indexOf("exam_merge") + 1]).toBe(next);

			for (const m of moves) {
				expect(JSON.stringify(m.next)).not.toContain('"sent_back"');
			}
		});
	}

	it("ship's no_review: the lane runs exam_review, then exam_merge, and asks the person no second time", () => {
		const {moves} = examRun({
			merges: ["send:reviewer:no_review"],
			reviews: [PASS, {...PASS, yes: "head"}],
		});
		expect(doneInOrder(moves).slice(3)).toEqual([
			"exam",
			"exam_review",
			"ask:exam_merge",
			"exam_merge",
			"exam_review",
			"exam_merge",
			"test_writer",
		]);
	});

	// Ticket 117's shape, in the machine: the yes was said at the first head, a commit that only formats
	// moved it, and the review's Gather found the yes carries there.
	it("a new head the yes carries to: the checks and the review run there, then exam_merge with no new ask", () => {
		const {moves} = examRun({
			merges: ["send:builder:checks_red"],
			reviews: [PASS, {...PASS, yes: "head", moved: true}],
		});
		const seen = doneInOrder(moves);
		expect(countOf(seen, "ask:exam_merge")).toBe(1);
		expect(countOf(seen, "exam_merge")).toBe(2);
		expect(seen.at(-1)).toBe("test_writer");
		const merges = stepsIn(cmdsOf(moves)).filter((c) => c.step === "exam_merge");
		expect(pullOf(merges[1]?.carry)?.head).toBe(examHead(2));
	});

	it("the exam writer's redo changes a rule's text: the lane asks exam_merge again", () => {
		const {moves} = examRun({merges: ["send:builder:review_failed"]});
		const seen = doneInOrder(moves);
		expect(seen.slice(3)).toEqual([
			"exam",
			"exam_review",
			"ask:exam_merge",
			"exam_merge",
			"exam",
			"exam_review",
			"ask:exam_merge",
			"exam_merge",
			"test_writer",
		]);
	});

	it("a yes the review found at another head is no yes: the person is asked", () => {
		const seen = doneInOrder(examRun({reviews: [{...PASS, yes: "old"}]}).moves);
		expect(seen.indexOf("ask:exam_merge")).toBeGreaterThan(-1);
		expect(seen.indexOf("ask:exam_merge")).toBeLessThan(seen.indexOf("exam_merge"));
	});

	it("verdicts at another head never start exam_merge, even on a person's merge", () => {
		const {moves} = examRun({reviews: [{...PASS, reviewed: "old"}, PASS]});

		for (const cmd of stepsIn(cmdsOf(moves)).filter((c) => c.step === "exam_merge")) {
			const pull = pullOf(cmd.carry);
			expect(pull?.reviewed?.head).toBe(pull?.head);
		}

		expect(doneInOrder(moves).at(-1)).toBe("test_writer");
	});

	it("ship's ejected twice: exam_merge runs once more, then the lane stops, with ship's why", () => {
		const {s, moves} = examRun({merges: ["send:builder:ejected", "send:builder:ejected"]});
		const seen = doneInOrder(moves);
		expect(countOf(seen, "exam_merge")).toBe(2);
		expect(seen).not.toContain("test_writer");
		expect(s.phase).toBe("over");
		expect(JSON.stringify(s)).toContain("ejected");
		expect(JSON.stringify(s)).not.toContain('"sent_back"');
	});

	it("the exam's merge question has beside it that the rule changes stand alone, then each change", () => {
		const changes = [
			{path: RULE, change: "turn on no-floating-promises", why: "the plan needs it"},
		];
		const plan = Schema.decodeUnknownSync(HeldDraft)({
			summary: "One form.",
			stories: [{id: "reader", who: "a reader", want: "one form", why: "names match"}],
			tasks: [],
			pointers: [],
			questions: [],
			exam: changes,
		});
		const planned: StepEnd = {...ROUTE.plan, carry: {version: 1, plan}};
		const {moves} = drive(
			IDLE,
			START,
			stoppingAt("plan", planned, examWorld({})),
			(s) => s.phase === "running" && s.step === "test_writer",
		);
		const asked = cmdsOf(moves).find(
			(c) => c.type === "lane_ask" && askedFor(c.ask) === "exam_merge",
		);
		expect(asked?.type === "lane_ask" ? asked.also : undefined).toEqual([
			"These rule changes are in a pull request of their own:",
			...ruleChangeLines(changes),
		]);
	});
});

// ---------------------------------------------------------------- its laws, over any script

describe("the exam's pull request, over any script", () => {
	const reviewEnds: fc.Arbitrary<ReviewEnd> = fc.record({
		how: fc.constantFrom("pass", "pass", "review_failed", "checks_red"),
		reviewed: fc.constantFrom("head", "head", "old"),
		yes: fc.constantFrom("none", "head", "old"),
		moved: fc.boolean(),
	});
	const scripts: fc.Arbitrary<ExamScript> = fc.record({
		reviews: fc.array(reviewEnds, {maxLength: 8}),
		merges: fc.array(
			fc.constantFrom(
				"done",
				...SHIP_NAMES.filter((n) => n.startsWith("send:")),
				"stuck:checks_stuck",
			),
			{maxLength: 8},
		),
		picks: fc.array(fc.constantFrom("approve", "merge", "no", "again", "stop"), {maxLength: 12}),
	});
	/** Scripts each planted break below fails on, run first on every law. */
	const EXAMPLES: readonly [ExamScript][] = [
		[{merges: Array.from({length: 6}, () => "send:builder:review_failed")}],
		[{reviews: [{...PASS, yes: "old"}], merges: ["send:reviewer:no_review"]}],
		[{merges: ["send:builder:bot_comment"]}],
	];

	/** What broke on one script, a line each. */
	type Law = (moves: readonly Moved[]) => readonly string[];

	/** Every ship send at exam_merge routes somewhere other than `stuck:sent_back`. */
	const routed: Law = (moves) =>
		moves.flatMap((m) =>
			m.prev.phase === "running" &&
			m.prev.step === "exam_merge" &&
			m.msg.type === "lane_step_ok" &&
			m.msg.value.outcome.kind === "send" &&
			JSON.stringify(m.next).includes('"sent_back"')
				? [`${nameOf(m.msg.value.outcome)} at exam_merge ended stuck:sent_back`]
				: [],
		);

	/**
	 * exam_merge never starts on a head where the exam review and a person's yes do not both carry, and
	 * never without green checks there. Read off what the world said, not what the lane holds.
	 */
	const guarded: Law = (moves) => {
		const green = new Set<string>();
		const yes = new Set<string>();
		const problems: string[] = [];

		for (const {prev, msg, cmds} of moves) {
			if (msg.type === "lane_step_ok" && prev.phase === "running" && prev.step === "exam_review") {
				const pull = pullOf(msg.value.carry);

				if (msg.value.outcome.kind !== "done") {
					if (pull !== undefined) {
						green.delete(pull.head);
					}
				} else if (pull !== undefined) {
					if (pull.reviewed?.head === pull.head) {
						green.add(pull.head);
					}

					if (pull.yes !== undefined) {
						yes.add(pull.yes.head);
					}
				}
			}

			if (
				msg.type === "lane_answered" &&
				prev.phase === "asking" &&
				prev.question.for === "exam_merge" &&
				msg.pick === "merge"
			) {
				const head = pullOf(prev.carry)?.head;

				if (head !== undefined) {
					yes.add(head);
				}
			}

			for (const cmd of stepsIn(cmds)) {
				if (cmd.step !== "exam_merge") {
					continue;
				}

				const head = pullOf(cmd.carry)?.head ?? "(none)";

				if (!green.has(head)) {
					problems.push(`exam_merge started at ${head} with no green review there`);
				}

				if (!yes.has(head)) {
					problems.push(`exam_merge started at ${head} with no yes there`);
				}
			}
		}

		return problems;
	};

	/** The exam step runs at most the bound, plus one per person's `again`. */
	const bounded: Law = (moves) => {
		const exams = examsIn(moves).length;
		const agains = moves.filter(
			(m) =>
				m.msg.type === "lane_answered" &&
				m.prev.phase === "asking" &&
				m.prev.question.for === "rounds_spent" &&
				m.msg.pick === "again",
		).length;
		return exams > MAX_ROUNDS + agains
			? [`the exam step ran ${exams} times, with ${agains} again`]
			: [];
	};

	/** The builder, and the test writer before it, never start before exam_merge ends done or the exam skips. */
	const examFirst: Law = (moves) => {
		let cleared = false;
		const problems: string[] = [];

		for (const {prev, msg, cmds} of moves) {
			if (msg.type === "lane_step_ok" && prev.phase === "running") {
				const {outcome} = msg.value;

				if (prev.step === "exam_merge" && outcome.kind === "done") {
					cleared = true;
				}

				if (prev.step === "exam" && outcome.kind === "skip") {
					cleared = true;
				}
			}

			for (const cmd of stepsIn(cmds)) {
				if (!cleared && (cmd.step === "test_writer" || cmd.step === "build")) {
					problems.push(`${cmd.step} started before the rule changes merged`);
				}
			}
		}

		return problems;
	};

	const holds = (machine: Machine, law: Law) =>
		fc.assert(
			fc.property(scripts, (script) => {
				expect(law(examRun(script, machine).moves)).toEqual([]);
			}),
			{numRuns: 300, seed: 119120, examples: [...EXAMPLES]},
		);

	const LAWS_10 = {routed, guarded, bounded, examFirst};

	for (const [name, law] of Object.entries(LAWS_10)) {
		it(`${name} holds on the real reducer`, () => holds(lane, law));
	}

	/** The lane, with each `lane_step_ok` it is sent rewritten first. */
	const rewriting = (to: (s: Lane, end: StepEnd) => StepEnd): Machine =>
		plant({
			lane_step_ok: (s: Lane, m: Extract<Msg, {type: "lane_step_ok"}>) =>
				lane.update.lane_step_ok(s, {...m, value: to(s, m.value)}),
		});

	it("routed catches its plant: a ship send with no row ends stuck:sent_back", () => {
		const planted = rewriting((s, end) =>
			s.phase === "running" &&
			s.step === "exam_merge" &&
			nameOf(end.outcome) === "send:builder:bot_comment"
				? {...end, outcome: {kind: "send", to: "nobody", why: "bot_comment"}}
				: end,
		);
		expect(() => holds(planted, routed)).toThrow();
	});

	it("guarded catches its plant: the guard reads examPull.head for the yes's head", () => {
		/** Any yes reads as at the head: what a guard that compares the head with itself lets through. */
		const yesAtHead = (carry: unknown): unknown => {
			const pull = pullOf(carry);
			return pull?.yes === undefined
				? carry
				: {...(carry as object), examPull: {...pull, yes: {...pull.yes, head: pull.head}}};
		};
		const planted = rewriting((s, end) =>
			s.phase === "running" && s.step === "exam_review"
				? ({...end, carry: yesAtHead(end.carry)} as StepEnd)
				: end,
		);
		expect(() => holds(planted, guarded)).toThrow();
	});

	it("bounded catches its plant: `back` forgets to count a route from exam_merge", () => {
		const planted = plant({
			lane_step_ok: (s: Lane, m: Extract<Msg, {type: "lane_step_ok"}>) => {
				const [next, cmds] = lane.update.lane_step_ok(s, m);

				if (s.phase !== "running" || s.step !== "exam" || !("trail" in next)) {
					return [next, cmds];
				}

				if (!next.trail.some((row) => row.step === "exam_merge")) {
					return [next, cmds];
				}

				// The exam's own row, after a route from exam_merge, is not on the trail the bound reads.
				const at = next.trail.findLastIndex((row) => row.step === "exam");
				return [{...next, trail: next.trail.filter((_, i) => i !== at)}, cmds] as never;
			},
		});
		expect(() => holds(planted, bounded)).toThrow();
	});

	it("examFirst catches its plant: the exam's ask goes straight to the test writer", () => {
		const planted = rewriting((s, end) =>
			s.phase === "running" && s.step === "exam" && end.outcome.kind === "ask"
				? {...end, outcome: {kind: "skip", why: "no_rules_change"}}
				: end,
		);
		expect(() => holds(planted, examFirst)).toThrow();
	});
});
