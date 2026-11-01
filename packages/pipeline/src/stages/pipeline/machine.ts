import {defineMachine, type Sub} from "@demlik/tea";
import {Schema, Struct} from "effect";
import {LaneId} from "../../ids.ts";
import {act, gather, intentOf, keptAct, keptCmd, listen} from "../../primitives.ts";
import {Outcome, titleOf} from "../../tickets/ticket.ts";
import {Item} from "../build/ticket.ts";
import {Survived} from "../mutation/mutant.ts";
import {Post} from "../operate/machine.ts";
import {nameOf} from "../outcome.ts";
import {HeldDraft} from "../plan/plan.ts";
import {LaneOutcome} from "./outcome.ts";

// The lane: one tracker ticket through every step, in order. Plain tea. Each step is a machine of
// its own, and the lane starts each as one Act and reads its outcome, as `operate` does; it never
// reads a step's state, and no step knows the lane.
//
//   reading    read the ticket: filed by the person running this, or an agent of theirs?
//   claiming   this lane takes the ticket on the ledger: one lane works a ticket
//   running    one step, by its Act, whose intent names the lane's count of steps. The program
//              keeps the step's machine under that intent, so the same Act sent again after a kill
//              finds it where it stood, and writes each fact once
//   asking     one question on the ticket, and a Listen for the person's answer
//   releasing  the lane has its outcome, and lets the ticket go
//   over       the outcome, and the step outcome that ended it
//
// `ticket -> triage -> plan -> yes -> exam -> (yes -> exam_merge) -> test_writer -> build ->
//  mutation -> review -> push -> yes -> merge`.
//
// `after` is the whole order, as data the laws read. A step's own `skip` moves on where the lane
// can go on without it, and the fact that says so is written by the Act all the same.

const Unknown = ["unknown"] as const;

/** Every step that runs a machine, in the order a ticket meets them. */
export const STEPS = [
	"triage",
	"plan",
	"exam",
	"exam_merge",
	"test_writer",
	"build",
	"mutation",
	"mutants",
	"review",
	"push",
	"merge",
] as const;
export const LaneStep = Schema.Literals(STEPS);
export type LaneStep = typeof LaneStep.Type;

/** What the questions are about. `step`: a step that ended on `ask`, and may be run again. */
const ASKS = ["approve", "exam_merge", "merge", "step"] as const;
const AskFor = Schema.Literals(ASKS);

/** The most builds a ticket gets: the first, and each one review sent it back for. */
export const MAX_ROUNDS = 3;

/** What one step leaves for the steps after it. */
const carried = {
	/** The plan as data, once it is written. Every later step reads it. */
	plan: Schema.NullOr(HeldDraft),
	/** The plan's version, once it is written. */
	version: Schema.NullOr(Schema.Finite),
	/** The rule files the exam step changes. */
	rules: Schema.Array(Schema.String),
	/** The exam's own pull request. `null`: none. */
	examPr: Schema.NullOr(Schema.String),
	/** The exact files the test writer's commits touched: the builder may not change them. */
	exam: Schema.Array(Schema.String),
	/** The commit the lane started from: what the mutation step and the review diff against. */
	base: Schema.NullOr(Schema.String),
	/** The commit the build stands on: the test writer's, then each build's. */
	head: Schema.NullOr(Schema.String),
	/** What the last review left open. */
	open: Schema.Array(Item),
	/** What the builder declared it did other than asked. */
	deviations: Schema.Array(Schema.String),
	/** What the builder says it could not do. Optional: a lane saved before this key still reads. */
	left: Schema.optionalKey(Schema.Array(Schema.String)),
	/** The mutants the mutation step saw live: the test writer's second job. */
	survived: Schema.Array(Survived),
	/** The review's verdicts: the push step posts them on the pull request. */
	posts: Schema.Array(Post),
	/** The lane's pull request. `null`: none yet. */
	pr: Schema.NullOr(Schema.String),
};
export const Carry = Schema.Struct(carried);
export type Carry = typeof Carry.Type;

export const EMPTY: Carry = {
	plan: null,
	version: null,
	rules: [],
	examPr: null,
	exam: [],
	base: null,
	head: null,
	open: [],
	deviations: [],
	survived: [],
	posts: [],
	pr: null,
};

/** One step's end: its outcome, and what it leaves. */
export const StepEnd = Schema.Struct({
	outcome: Outcome,
	carry: Schema.Struct(Struct.map(carried, Schema.optionalKey)),
});
export type StepEnd = typeof StepEnd.Type;

const LaneIn = Schema.Struct({number: Schema.Finite, lane: LaneId});
const StepIn = Schema.Struct({
	number: Schema.Finite,
	/** The lane's count of steps run: run ids and intents are named by it, so none is used twice. */
	count: Schema.Finite,
	step: LaneStep,
	round: Schema.Finite,
	carry: Carry,
});
const AskIn = Schema.Struct({
	number: Schema.Finite,
	ask: Schema.String,
	what: Schema.String,
	picks: Schema.Array(Schema.String),
});

/** Who filed it, as the lane reads it. */
export const Filed = Schema.Struct({
	state: Schema.Literals(["open", "closed"]),
	/** Filed by the person running this, or by an agent of theirs. */
	mine: Schema.Boolean,
});
export type Filed = typeof Filed.Type;

const ReadIn = Schema.Struct({number: Schema.Finite});

export const readFiled = gather("lane_read", {input: ReadIn, ok: Filed, err: Unknown});
export const claimLane = act("lane_claim", {input: LaneIn, ok: LaneId, err: Unknown});
export const releaseLane = act("lane_release", {
	input: LaneIn,
	ok: Schema.Literal("released"),
	err: Unknown,
});
export const runStep = act("lane_step", {input: StepIn, ok: StepEnd, err: Unknown});
export const askPerson = act("lane_ask", {input: AskIn, ok: Schema.Null, err: Unknown});

export type LaneCmd =
	| ReturnType<typeof readFiled>
	| ReturnType<typeof claimLane>
	| ReturnType<typeof releaseLane>
	| ReturnType<typeof runStep>
	| ReturnType<typeof askPerson>;

/** A question on the ticket. `then`: the step it comes back to. */
const Question = Schema.Struct({
	ask: Schema.String,
	what: Schema.String,
	picks: Schema.Array(Schema.String),
	for: AskFor,
	step: LaneStep,
});
type Question = typeof Question.Type;

/** One step as it ended, or one person's answer: what a lane leaves behind it, in order. */
const Row = Schema.Struct({step: Schema.String, said: Schema.String});

const Held = Schema.Struct({
	number: Schema.Finite,
	lane: LaneId,
	count: Schema.Finite,
	round: Schema.Finite,
	carry: Carry,
	trail: Schema.Array(Row),
});
type Held = typeof Held.Type;

const Ended = Schema.Struct({outcome: LaneOutcome, said: Schema.String});
type Ended = typeof Ended.Type;

export const Lane = Schema.Union([
	Schema.Struct({phase: Schema.Literal("idle")}),
	Schema.Struct({
		phase: Schema.Literal("reading"),
		number: Schema.Finite,
		lane: LaneId,
		asked: keptCmd(readFiled, ReadIn),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("claiming"),
		asked: keptAct(claimLane, LaneIn),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("running"),
		step: LaneStep,
		asked: keptAct(runStep, StepIn),
	}),
	Schema.Struct({
		...Held.fields,
		phase: Schema.Literal("asking"),
		question: Question,
		asked: keptAct(askPerson, AskIn),
	}),
	Schema.Struct({
		...Held.fields,
		...Ended.fields,
		phase: Schema.Literal("releasing"),
		asked: keptAct(releaseLane, LaneIn),
	}),
	Schema.Struct({
		...Ended.fields,
		phase: Schema.Literal("over"),
		number: Schema.Finite,
		trail: Schema.Array(Row),
	}),
]);
export type Lane = typeof Lane.Type;

export type LaneMsg =
	| {readonly type: "start"; readonly number: number; readonly lane: LaneId}
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"}
	/** A person answered `ask` on the ticket: the Listen below heard it. */
	| {readonly type: "lane_answered"; readonly ask: string; readonly pick: string};

type Step_ = readonly [Lane, readonly LaneCmd[]];

/** What a state moves to, after a step's outcome. */
export type Move =
	| {readonly to: LaneStep; readonly round?: number}
	| {readonly ask: "approve" | "exam_merge" | "merge" | "step"}
	| {readonly end: LaneOutcome};

const stuck = (why: Extract<LaneOutcome, {kind: "stuck"}>["why"]): Move => ({
	end: {kind: "stuck", why},
});
const merged: Move = {end: {kind: "done", part: false}};

/** The step after each step, when it ended well or on its own `skip`. */
const NEXT: Readonly<Record<LaneStep, Move>> = {
	triage: {to: "plan"},
	plan: {ask: "approve"},
	exam: {to: "test_writer"},
	exam_merge: {to: "test_writer"},
	test_writer: {to: "build"},
	build: {to: "mutation"},
	mutation: {to: "review"},
	mutants: {to: "review"},
	review: {to: "push"},
	push: {ask: "merge"},
	merge: merged,
};

/** The whole order, as one pure function: where a lane goes when `step` ends with `outcome`. */
export const after = (step: LaneStep, outcome: Outcome, round: number): Move => {
	switch (outcome.kind) {
		case "stuck":
			return stuck("step_stuck");
		case "ask":
			// A plan with open questions goes to the same yes: the person reads them there.
			if (step === "plan") return {ask: "approve"};
			// The exam's `check_change`: its pull request is open, and the rules are the person's.
			if (step === "exam") return {ask: "exam_merge"};
			return {ask: "step"};
		case "skip":
			if (step === "triage" || step === "plan")
				return {end: {kind: "skip", why: outcome.why === "closed" ? "closed" : "owner_no"}};
			// Build's `not_ready` and `closed`, and ship's `closed`, `draft` and `not_ours`, stop the lane:
			// only these steps may pass with nothing done.
			if (step === "exam" || step === "test_writer" || step === "mutation") return NEXT[step];
			return stuck("step_stuck");
		case "send":
			if (step === "triage")
				return outcome.to === "research" ? {end: {kind: "skip", why: "research"}} : NEXT.triage;
			if (step === "mutation" && outcome.to === "test_writer") return {to: "mutants"};
			// A finding needs a test, and the builder cannot add one: the writer goes first.
			if (step === "review" && outcome.to === "builder")
				return round >= MAX_ROUNDS ? stuck("rounds_spent") : {to: "test_writer", round: round + 1};
			return stuck("sent_back");
		case "done":
			// Triage closed it, as a no or a duplicate. Done, and nobody is next.
			if (step === "triage") return merged;
			return NEXT[step];
	}
};

/** The picks of a question: the first is the one that goes on. */
export const PICKS = {
	approve: ["approve", "no"],
	exam_merge: ["merge", "no"],
	merge: ["merge", "no"],
	step: ["again", "stop"],
} as const;

/** What a person may answer: a step that ended on `ask` may also be let through, unless it merges or pushes. */
const picksFor = (kind: (typeof ASKS)[number], step: LaneStep): readonly string[] =>
	kind === "step" && !LANDS.has(step) ? ["again", "go_on", "stop"] : PICKS[kind];

/** The steps a person's "go on" could only skip over: nothing lands without them having run. */
const LANDS: ReadonlySet<LaneStep> = new Set(["push", "merge", "exam_merge"]);

const questionFor = (
	s: Held,
	kind: (typeof ASKS)[number],
	step: LaneStep,
	said: string,
): Question => {
	const what = {
		approve: `approve plan v${s.carry.version ?? 1}`,
		exam_merge: titleOf(`merge the rule changes: ${s.carry.rules.join(", ")}`),
		merge: `merge ${s.carry.pr ?? "the change"}`,
		step: titleOf(`${step} asks: ${said}`),
	}[kind];
	return {ask: `a-${kind}-${s.count}`, what, picks: picksFor(kind, step), for: kind, step};
};

const asking = (s: Held, question: Question): Step_ => {
	const cmd = askPerson({
		number: s.number,
		ask: question.ask,
		what: question.what,
		picks: question.picks,
		intent: intentOf("lane", s.number, question.ask),
	});
	return [{...s, phase: "asking", question, asked: cmd}, [cmd]];
};

const running = (s: Held, step: LaneStep, round = s.round): Step_ => {
	const at: Held = {...s, count: s.count + 1, round};
	const cmd = runStep({
		number: s.number,
		count: at.count,
		step,
		round,
		carry: at.carry,
		intent: intentOf("lane", s.number, at.count, step),
	});
	return [{...at, phase: "running", step, asked: cmd}, [cmd]];
};

const releasing = (s: Held, ended: Ended): Step_ => {
	const cmd = releaseLane({
		number: s.number,
		lane: s.lane,
		intent: intentOf("lane", s.number, "release"),
	});
	return [{...s, ...ended, phase: "releasing", asked: cmd}, [cmd]];
};

const move = (s: Held, step: LaneStep, m: Move, said: string): Step_ => {
	if ("to" in m) return running(s, m.to, m.round);
	if ("ask" in m) return asking(s, questionFor(s, m.ask, step, said));
	return releasing(s, {outcome: m.end, said});
};

/** A state's held part, and only that: a kept state holds its own phase's keys and no other's. */
const heldOf = (s: Held): Held => ({
	number: s.number,
	lane: s.lane,
	count: s.count,
	round: s.round,
	carry: s.carry,
	trail: s.trail,
});

const answered = (s: Extract<Lane, {phase: "asking"}>, pick: string): Step_ => {
	const {question} = s;
	const held: Held = {...heldOf(s), trail: [...s.trail, {step: question.ask, said: pick}]};
	if (pick === "go_on") return move(held, question.step, NEXT[question.step], pick);
	// The first pick goes on. Any other is the person's no.
	if (pick !== question.picks[0])
		return releasing(held, {
			outcome: {kind: "skip", why: "owner_no"},
			said: `${question.ask}: ${pick}`,
		});
	switch (question.for) {
		case "approve":
			return running(held, "exam");
		case "exam_merge":
			return running(held, "exam_merge");
		case "merge":
			return running(held, "merge");
		case "step":
			return running(held, question.step);
	}
};

/** The Listen on a person's answer: on for as long as the lane is asking. */
export const answerSub = listen<
	Lane,
	"lane_answer",
	{readonly number: number; readonly ask: string; readonly picks: readonly string[]}
>("lane_answer", (s) =>
	s.phase === "asking" ? {number: s.number, ask: s.question.ask, picks: s.question.picks} : null,
);

export const lane = defineMachine({
	types: {
		model: {} as Lane,
		msg: {} as LaneMsg,
		sub: {} as Sub<
			"lane_answer",
			{readonly number: number; readonly ask: string; readonly picks: readonly string[]}
		>,
		ctx: undefined,
	},
	cmds: [readFiled, claimLane, releaseLane, runStep, askPerson],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	update: {
		start: (s, m): Step_ => {
			if (s.phase !== "idle") return [s, []];
			const asked = readFiled({number: m.number});
			return [{phase: "reading", number: m.number, lane: m.lane, asked}, [asked]];
		},
		resume: (s): Step_ => {
			if (s.phase === "idle" || s.phase === "over") return [s, []];
			return [s, [s.asked as LaneCmd]];
		},
		lane_read_ok: (s, m): Step_ => {
			if (s.phase !== "reading") return [s, []];
			const held: Held = {
				number: s.number,
				lane: s.lane,
				count: 0,
				round: 1,
				carry: EMPTY,
				trail: [],
			};
			if (!m.value.mine)
				return [
					{
						phase: "over",
						number: s.number,
						trail: [],
						outcome: {kind: "stuck", why: "not_yours"},
						said: `#${s.number} was not filed by you or an agent of yours`,
					},
					[],
				];
			if (m.value.state === "closed")
				return [
					{
						phase: "over",
						number: s.number,
						trail: [],
						outcome: {kind: "skip", why: "closed"},
						said: `#${s.number} is closed`,
					},
					[],
				];
			const asked = claimLane({
				number: s.number,
				lane: s.lane,
				intent: intentOf("lane", s.number, "claim"),
			});
			return [{...held, phase: "claiming", asked}, [asked]];
		},
		lane_read_err: (s): Step_ =>
			s.phase === "reading"
				? [
						{
							phase: "over",
							number: s.number,
							trail: [],
							outcome: {kind: "stuck", why: "no_ticket"},
							said: `#${s.number} could not be read`,
						},
						[],
					]
				: [s, []],
		lane_claim_ok: (s, m): Step_ => {
			if (s.phase !== "claiming") return [s, []];
			if (m.value !== s.lane)
				return [
					{
						phase: "over",
						number: s.number,
						trail: s.trail,
						outcome: {kind: "stuck", why: "claim_held"},
						said: `lane ${m.value} holds it`,
					},
					[],
				];
			return running(heldOf(s), "triage");
		},
		lane_claim_err: (s): Step_ =>
			s.phase === "claiming"
				? [
						{
							phase: "over",
							number: s.number,
							trail: s.trail,
							outcome: {kind: "stuck", why: "step_failed"},
							said: "the claim could not be made",
						},
						[],
					]
				: [s, []],
		lane_step_ok: (s, m): Step_ => {
			if (s.phase !== "running") return [s, []];
			const said = nameOf(m.value.outcome);
			const held: Held = {
				...heldOf(s),
				carry: {...s.carry, ...m.value.carry},
				trail: [...s.trail, {step: s.step, said}],
			};
			return move(held, s.step, after(s.step, m.value.outcome, s.round), said);
		},
		lane_step_err: (s): Step_ => {
			if (s.phase !== "running") return [s, []];
			const said = `${s.step}: could not run`;
			return releasing(
				{...heldOf(s), trail: [...s.trail, {step: s.step, said}]},
				{outcome: {kind: "stuck", why: "step_failed"}, said},
			);
		},
		// The question is on the ticket. The Listen goes on hearing for the answer.
		lane_ask_ok: (s): Step_ => [s, []],
		lane_ask_err: (s): Step_ =>
			s.phase === "asking"
				? releasing(heldOf(s), {
						outcome: {kind: "stuck", why: "step_failed"},
						said: `${s.question.ask}: could not be asked`,
					})
				: [s, []],
		lane_answered: (s, m): Step_ =>
			s.phase === "asking" && m.ask === s.question.ask && s.question.picks.includes(m.pick)
				? answered(s, m.pick)
				: [s, []],
		lane_release_ok: (s): Step_ =>
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
		// The ticket's lease runs out by itself: the lane has ended all the same.
		lane_release_err: (s): Step_ =>
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
	subs: [answerSub],
});
