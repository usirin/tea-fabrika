import {defineMachine, type Sub} from "@demlik/tea";
import {Schema, Struct} from "effect";
import {LaneId} from "../../ids.ts";
import {act, gather, intentOf, keptAct, keptCmd, listen} from "../../primitives.ts";
import {Checked, Outcome, titleOf} from "../../tickets/ticket.ts";
import {Item} from "../build/ticket.ts";
import {Survived} from "../mutation/mutant.ts";
import {Post} from "../operate/machine.ts";
import {nameOf} from "../outcome.ts";
import {HeldDraft, PlanQuestion} from "../plan/plan.ts";
import {openWords, throughWords} from "./found.ts";
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
//
// After every build, code runs `[build] checks` at its head (./checks.ts), and the builder's word
// decides nothing. Red goes back to the build, a round up, with each failing test open: so does a
// head the mutation step finds red. Checks that could not run end the lane `stuck:checks_not_run`.
// No step after build runs on a head without green checks code ran at that very head: the carry's
// `checked` says which head they were at, and `running` is the one place a step starts. Red there,
// as at the mutants job's commit, ends the lane `stuck:checks_red`; none, or not run, `checks_not_run`.
//
// A review's finding goes to the test writer, a round up. Both count in the same rounds, and once
// `MAX_ROUNDS` are spent a person is asked `rounds_spent`: `again` runs one more round, `stop` ends
// the lane `stuck:rounds_spent`. With `[build] send_back = false` the first red asks at once.

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

/** The steps after build: each runs only on a head with green checks code ran there. */
const AFTER_BUILD: ReadonlySet<LaneStep> = new Set(STEPS.slice(STEPS.indexOf("build") + 1));

/**
 * What the questions are about. `step`: a step that ended on `ask`, and may be run again.
 * `rounds_spent`: the work went back as often as it may, and a person says whether once more.
 */
const ASKS = ["approve", "exam_merge", "merge", "step", "rounds_spent"] as const;
const AskFor = Schema.Literals(ASKS);

/**
 * The most builds a ticket gets on its own: the first, and each one a red head or a review sent it
 * back for. Past it, only a person's `again`. 3 is a guess (docs/direction/jidoka-and-andon.md#bounds).
 */
export const MAX_ROUNDS = 3;

/** A Property of the plan with no test, in its own words, and why the test writer wrote none. */
export const Untested = Schema.Struct({when: Schema.String, why: Schema.String});
export type Untested = typeof Untested.Type;

/**
 * What no test or review will hold a change to, on a person's word alone: a finding against their
 * decision, and a mutant no test can see. A row keeps the agent's words, so the pull request can say them.
 */
const ThroughRows = Schema.Struct({
	findings: Schema.Array(Schema.Struct({id: Schema.String, fault: Schema.String})),
	mutants: Schema.Array(Schema.Struct({mutant: Schema.String, why: Schema.String})),
});
export type Through = typeof ThroughRows.Type;

/** What a person decided: every step after the plan that judges or writes is told it. */
const Decided = Schema.Struct({
	/** The plan's open questions, under their ids. A person's yes takes the lean on each. */
	questions: Schema.Array(PlanQuestion),
	/** What the person wrote beside their answers, in their words. */
	said: Schema.Array(Schema.String),
});

/** What the review judged last, for the question of whether it lands. */
const Reviewed = Schema.Struct({title: Schema.String, met: Schema.Finite, of: Schema.Finite});

/** What one step leaves for the steps after it. */
const carried = {
	/** The plan as data, once it is written. Every later step reads it. */
	plan: Schema.NullOr(HeldDraft),
	/** What a person decided. Optional: a lane saved before this key still reads, by its plan's leans. */
	decided: Schema.optionalKey(Decided),
	/** Optional, as `decided` is: the question falls back on the pull request's name. */
	reviewed: Schema.optionalKey(Reviewed),
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
	/**
	 * Code's own checks at the last head a build or the mutants job left: a step after build runs only
	 * when they are green at `head`. Optional: a lane saved before this key still reads.
	 */
	checked: Schema.optionalKey(Checked),
	/** What the last review left open. */
	open: Schema.Array(Item),
	/** What the builder declared it did other than asked. */
	deviations: Schema.Array(Schema.String),
	/** What the builder says it could not do. Optional: a lane saved before this key still reads. */
	left: Schema.optionalKey(Schema.Array(Schema.String)),
	/** What the test writer's last run says no test can check. Optional, as `left` is. */
	cannot: Schema.optionalKey(Schema.Array(Untested)),
	/** What a person let through with no test: the ticket and the pull request say so. Optional, as `left` is. */
	untested: Schema.optionalKey(Schema.Array(Untested)),
	/** What the question on the ticket would let through on a `go_on`. Optional, as `left` is. */
	waiting: Schema.optionalKey(ThroughRows),
	/** What a person let through: the merge's question and the pull request say so. Optional, as `left` is. */
	through: Schema.optionalKey(ThroughRows),
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

/**
 * One step's end: its outcome, and what it leaves. `after`, on an `ask`: how the step ends if the
 * person lets it through. Having one makes the question a call on what is there, with nothing to run
 * again. (Not `then`: an object with `then` reads as a Promise.)
 */
export const StepEnd = Schema.Struct({
	outcome: Outcome,
	carry: Schema.Struct(Struct.map(carried, Schema.optionalKey)),
	after: Schema.optionalKey(Outcome),
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
	/** What each pick does, a line for each. Left out: a lane saved before this key still reads. */
	does: Schema.optionalKey(Schema.Array(Schema.String)),
	/** What a person reads before they answer, a line for each. Left out: nothing more to read. */
	also: Schema.optionalKey(Schema.Array(Schema.String)),
	/** The rounds' question: what the runs on the ticket cost is added from its facts, which the lane does not hold. */
	spent: Schema.optionalKey(Schema.Literal(true)),
});
/** How the lane ended, for what it takes with it. Left out: a lane saved before this key still reads. */
const ReleaseIn = Schema.Struct({...LaneIn.fields, outcome: Schema.optionalKey(LaneOutcome)});

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
	input: ReleaseIn,
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

/** A person's call on a step's end: what the step asked about, and how it ends if they let it through. */
const Call = Schema.Struct({about: Schema.String, after: Outcome});
type Call = typeof Call.Type;

/** A question on the ticket. `step`: the step it comes back to. Left out, `call`: any other question. */
const Question = Schema.Struct({
	ask: Schema.String,
	what: Schema.String,
	picks: Schema.Array(Schema.String),
	for: AskFor,
	step: LaneStep,
	call: Schema.optionalKey(Call),
});
type Question = typeof Question.Type;

/** One step as it ended, or one person's answer: what a lane leaves behind it, in order. */
const Row = Schema.Struct({step: Schema.String, said: Schema.String});

/** Whether a red head goes back to the builder on its own: `[build] send_back`. Left out: it does. */
const SendBack = {sendBack: Schema.optionalKey(Schema.Boolean)};

const Held = Schema.Struct({
	number: Schema.Finite,
	lane: LaneId,
	...SendBack,
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
		...SendBack,
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
		asked: keptAct(releaseLane, ReleaseIn),
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
	/** `sendBack`: `[build] send_back`, read once as the lane starts. Left out: true. */
	| {
			readonly type: "start";
			readonly number: number;
			readonly lane: LaneId;
			readonly sendBack?: boolean;
	  }
	/** Sent once after booting from saved state: re-issue whatever was in flight. */
	| {readonly type: "resume"}
	/** A person answered `ask` on the ticket: the Listen below heard it. */
	| {
			readonly type: "lane_answered";
			readonly ask: string;
			readonly pick: string;
			/** What they wrote beside it. */
			readonly note?: string;
	  };

type Step_ = readonly [Lane, readonly LaneCmd[]];

/** What a state moves to, after a step's outcome. */
export type Move =
	| {readonly to: LaneStep; readonly round?: number}
	| {readonly ask: (typeof ASKS)[number]}
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

/** Another round, if the rounds allow it: else a person is asked. */
const back = (to: LaneStep, round: number): Move =>
	round >= MAX_ROUNDS ? {ask: "rounds_spent"} : {to, round: round + 1};

/**
 * The whole order, as one pure function: where a lane goes when `step` ends with `outcome` in
 * `round`. `lane.sendBack`: `[build] send_back`; left out, a red head goes back.
 */
export const after = (
	step: LaneStep,
	outcome: Outcome,
	round: number,
	lane: {readonly sendBack?: boolean} = {},
): Move => {
	switch (outcome.kind) {
		case "stuck":
			// A builder that changed nothing in a round at the cap: the same question as any spent round.
			if (step === "build" && outcome.why === "rounds_spent") return {ask: "rounds_spent"};
			// Code's checks after the build could not run, after one more try: never guessed green.
			if (step === "build" && outcome.why === "checks_not_run") return stuck("checks_not_run");
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
			// The head's own tests fail, by code's checks after the build or by the mutation step's run:
			// the builder gets them by name, unless the repository says ask.
			if ((step === "build" || step === "mutation") && outcome.to === "builder")
				return lane.sendBack === false ? {ask: "rounds_spent"} : back("build", round);
			// A finding needs a test, and the builder cannot add one: the writer goes first.
			if (step === "review" && outcome.to === "builder") return back("test_writer", round);
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
	rounds_spent: ["again", "stop"],
} as const;

/** Where a spent round's `again` goes: the writer first after a review, as a review's send-back does. */
const againTo = (step: LaneStep): LaneStep => (step === "review" ? "test_writer" : "build");

/** A person's call: what is there stands or stops. Nothing would change by running the step again. */
const CALL_PICKS = ["go_on", "stop"] as const;

/** What a person may answer: a step that ended on `ask` may also be let through, unless it can't be. */
const picksFor = (kind: (typeof ASKS)[number], step: LaneStep): readonly string[] =>
	kind === "step" && !NO_GO_ON.has(step) ? ["again", "go_on", "stop"] : PICKS[kind];

/**
 * The steps whose plain question offers no `go_on`, since it could only lead to nothing landing:
 * one that merges or pushes has to have run, a review no one could judge is what ship's guard refuses,
 * and a build asks plainly only of a head whose tests fail, which the mutation step sends back.
 * A person's call on what is there (`Call`) is its own question, with its own picks.
 */
const NO_GO_ON: ReadonlySet<LaneStep> = new Set(["push", "merge", "exam_merge", "review", "build"]);

/** A step, as a person says it. */
const STEP_WORDS: Readonly<Record<LaneStep, string>> = {
	triage: "triage",
	plan: "plan",
	exam: "rule change",
	exam_merge: "rule change's merge",
	test_writer: "test writer",
	build: "build",
	mutation: "mutation test",
	mutants: "test writer",
	review: "review",
	push: "push",
	merge: "merge",
};

/** Why a step asks, by the word its outcome holds. Each is a sentence for a person. */
const ASK_WORDS: Readonly<Record<string, string>> = {
	cannot_test: "The test writer says no test can check a property of the plan.",
	already_passes: "A new test already passes before the build, so it shows nothing yet.",
	fails_on_base: "A test of what works today fails on the code as it is.",
	disable: "A mutant lived, and the test writer says no test can see the change.",
	unseen: "The review could not see all it needed.",
	check_change: "This step's change touches the checks, and those are a person's call.",
	ruling: "Triage needs a ruling on this ticket.",
	approval: "This pull request needs a person's yes.",
	comment: "This pull request has a comment that needs an answer.",
	decision: "The review says a decision you made on the plan is wrong. Does your decision stand?",
	no_change:
		"The builder changed nothing this round, and the checks pass at this head. Should the lane go on with the work as it is?",
	still_red:
		"The builder changed nothing this round, and the new test is still failing at this head. Should the builder try once more?",
};

/** What a `go_on` means, by what the step asked about. Each is a sentence for a person. */
const CALL_WORDS: Readonly<Record<string, string>> = {
	decision: "Your decision stands, which lets that finding through, and no test comes of it.",
	no_change: "The work stays as it is, and code's own checks still have to pass before it lands.",
};

/** The question of a step that ended on `ask`, in words: the outcome's own name is code. Pure. */
const askWords = (step: LaneStep, outcome: Outcome): string =>
	(outcome.kind === "ask" ? ASK_WORDS[outcome.for] : undefined) ??
	`The ${STEP_WORDS[step]} step stopped and needs your call.`;

/** How many findings a person let through, for the merge's question. None: nothing is said. Pure. */
const throughCount = ({through}: Carry): string => {
	const count = through?.findings.length ?? 0;
	if (count === 0) return "";
	return `, ${count} ${count === 1 ? "finding" : "findings"} let through`;
};

/** The merge's question: the review's count and the checks first, so a long title cuts only itself. A review reaches a reviewer only with the checks green. Pure. */
const mergeWords = (carry: Carry): string => {
	const {reviewed, pr} = carry;
	return reviewed === undefined
		? `Do you want to merge ${pr ?? "the change"}?`
		: `The review met ${reviewed.met} of ${reviewed.of}${throughCount(carry)}, and the repository's checks passed at its head. Do you want to merge "${reviewed.title}"?`;
};

/** The rounds' question, by the step that sent the work back and whether the rounds ran out. Pure. */
const spentQuestion = (s: Held, step: LaneStep): string => {
	const still =
		step === "review"
			? "the review still sends the work back"
			: "the repository's own tests still fail at this head";
	return s.round >= MAX_ROUNDS
		? `Round ${s.round} of ${MAX_ROUNDS} is spent, and ${still}. Should the work go round once more?`
		: `[build] send_back is false in this repository, and ${still}. Should the work go round once more?`;
};

const questionFor = (
	s: Held,
	kind: (typeof ASKS)[number],
	step: LaneStep,
	asks: string,
	call?: Call,
): Question => {
	const what = {
		approve: `Do you approve plan version ${s.carry.version ?? 1}?`,
		exam_merge: titleOf(`Do you want to merge these rule changes: ${s.carry.rules.join(", ")}?`),
		merge: titleOf(mergeWords(s.carry)),
		step: titleOf(asks),
		rounds_spent: titleOf(spentQuestion(s, step)),
	}[kind];
	// The trail gains a row with every answer, so no two questions share a number. A lane saved under
	// the old count is safe too: that count was never more than the trail, and its answer added a row.
	const ask = `a-${kind}-${s.trail.length}`;
	// The rounds' question comes back to where its `again` goes.
	const to = kind === "rounds_spent" ? againTo(step) : step;
	return call === undefined
		? {ask, what, picks: picksFor(kind, to), for: kind, step: to}
		: {ask, what, picks: CALL_PICKS, for: kind, step: to, call};
};

/** Where the lane goes on a `go_on`, in words. Pure. */
const goOnWords = (next: Move): string => {
	if ("to" in next) return `The lane moves on to the ${STEP_WORDS[next.to]} step.`;
	return "ask" in next ? "The lane moves on, and asks you what comes next." : "The lane ends here.";
};

/** The line for one pick of a question: what picking it does, in words. Pure. */
const pickLine = (s: Held, question: Question, pick: string): string => {
	const words = STEP_WORDS[question.step];
	const lean =
		(s.carry.plan?.questions ?? []).length === 0
			? ""
			: ", and a yes takes the lean on each open question";
	const next = NEXT[question.step];
	const {call} = question;
	const spent = question.for === "rounds_spent";
	const says: Readonly<Record<string, string>> = {
		approve: `The plan stands as written${lean}. The lane goes on with it.`,
		merge: "The change lands on main.",
		again: spent
			? `The ${words} step runs once more${question.step === "build" ? "" : ", then the build"}, as round ${s.round + 1}, past the ${MAX_ROUNDS} rounds a ticket gets on its own. A note you write beside this answer goes to the builder.`
			: question.step === "build"
				? `The build step runs once more, and a note you write beside this answer goes to the builder. It counts as round ${s.round + 1} of ${MAX_ROUNDS}.`
				: `The ${words} step runs once more, from the start.`,
		go_on:
			call === undefined
				? [
						`The lane moves on${"to" in next ? ` to the ${STEP_WORDS[next.to]} step` : ""} as things stand.`,
						...((s.carry.cannot ?? []).length === 0
							? []
							: ["The ticket and the pull request say which property has no test."]),
					].join(" ")
				: [
						...(CALL_WORDS[call.about] === undefined ? [] : [CALL_WORDS[call.about]]),
						goOnWords(after(question.step, call.after, s.round, s)),
					].join(" "),
		stop: spent
			? "The lane ends here, stuck on its rounds, and this change does not land. Its working copy stays."
			: "The lane ends here, and this change does not land.",
		no: "The lane ends here, and this change does not land.",
	};
	return `\`${pick}\`: ${says[pick] ?? "The lane takes this answer as it stands."}`;
};

const asking = (s: Held, question: Question): Step_ => {
	const cmd = askPerson({
		number: s.number,
		ask: question.ask,
		what: question.what,
		picks: question.picks,
		does: question.picks.map((pick) => pickLine(s, question, pick)),
		...(question.for === "merge" ? {also: throughWords(s.carry.through)} : {}),
		...(question.for === "rounds_spent" ? {also: openWords(s.carry.open), spent: true} : {}),
		intent: intentOf("lane", s.number, question.ask),
	});
	return [{...s, phase: "asking", question, asked: cmd}, [cmd]];
};

/**
 * Why a step after build may not run on the carry's head. `null`: code's checks there are green, what
 * every step after build needs. Red ones there are red; any other, or none, did not run. Pure.
 */
const uncheckedAt = ({head, checked}: Carry): "checks_red" | "checks_not_run" | null => {
	if (checked === undefined || checked.head !== head) return "checks_not_run";
	if (checked.result === "green") return null;
	return checked.result === "red" ? "checks_red" : "checks_not_run";
};

/** Why a step after build does not run, in words. Pure. */
const uncheckedWords = (step: LaneStep, {head, checked}: Carry): string => {
	const at = head ?? "no head";
	const why =
		checked === undefined || checked.head !== head
			? `no checks code ran at ${at}`
			: `the checks code ran at ${at} are ${checked.result === "red" ? "red" : "not run"}`;
	return `${why}, so the ${STEP_WORDS[step]} step does not run`;
};

/** The one place a step starts: one after build only on a head with green checks there. */
const running = (s: Held, step: LaneStep, round = s.round): Step_ => {
	const unchecked = AFTER_BUILD.has(step) ? uncheckedAt(s.carry) : null;
	if (unchecked !== null)
		return releasing(s, {
			outcome: {kind: "stuck", why: unchecked},
			said: uncheckedWords(step, s.carry),
		});
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
		outcome: ended.outcome,
		intent: intentOf("lane", s.number, "release"),
	});
	return [{...s, ...ended, phase: "releasing", asked: cmd}, [cmd]];
};

/** `said`: what the trail and the end say. `asks`: the question, if this move asks one. `call`: if that question is a call. */
const move = (s: Held, step: LaneStep, m: Move, said: string, asks = said, call?: Call): Step_ => {
	if ("to" in m) return running(s, m.to, m.round);
	if ("ask" in m) return asking(s, questionFor(s, m.ask, step, asks, call));
	return releasing(s, {outcome: m.end, said});
};

/** A person wrote something beside their answer: every step after this one is told it. Pure. */
const withNote = (carry: Carry, note: string): Carry =>
	note.trim() === ""
		? carry
		: {
				...carry,
				decided: {
					questions: carry.decided?.questions ?? [],
					said: [...(carry.decided?.said ?? []), note],
				},
			};

/** `had`, and each row of `more` it does not hold yet: a person may be asked again in a later round. Pure. */
const joined = <A>(had: readonly A[], more: readonly A[], same: (a: A, b: A) => boolean) => [
	...had,
	...more.filter((row, at) => ![...had, ...more.slice(0, at)].some((seen) => same(seen, row))),
];

/**
 * A person let a step through: what its writer could not test is now what nobody tested, and what
 * the question would let through now is. Pure.
 */
const letThrough = (carry: Carry): Carry => {
	const {waiting, ...rest} = carry;
	const cannot = carry.cannot ?? [];
	return {
		...rest,
		...(cannot.length === 0 ? {} : {cannot: [], untested: [...(carry.untested ?? []), ...cannot]}),
		...(waiting === undefined
			? {}
			: {
					through: {
						findings: joined(
							carry.through?.findings ?? [],
							waiting.findings,
							(a, b) => a.fault === b.fault,
						),
						mutants: joined(
							carry.through?.mutants ?? [],
							waiting.mutants,
							(a, b) => a.mutant === b.mutant,
						),
					},
				}),
	};
};

/** A state's held part, and only that: a kept state holds its own phase's keys and no other's. */
const heldOf = (s: Held): Held => ({
	number: s.number,
	lane: s.lane,
	...(s.sendBack === undefined ? {} : {sendBack: s.sendBack}),
	count: s.count,
	round: s.round,
	carry: s.carry,
	trail: s.trail,
});

const answered = (s: Extract<Lane, {phase: "asking"}>, pick: string, note: string): Step_ => {
	const {question} = s;
	const held: Held = {
		...heldOf(s),
		carry: withNote(s.carry, note),
		trail: [...s.trail, {step: question.ask, said: pick}],
	};
	if (pick === "go_on") {
		const on: Held = {...held, carry: letThrough(held.carry)};
		const {call} = question;
		// A call says how the step ends. Any other let-through just moves on.
		return call === undefined
			? move(on, question.step, NEXT[question.step], pick)
			: move(
					on,
					question.step,
					after(question.step, call.after, s.round, s),
					nameOf(call.after),
					askWords(question.step, call.after),
				);
	}
	// A stop on the rounds is no person's no to the change: the lane is stuck on its rounds.
	if (question.for === "rounds_spent" && pick === "stop")
		return releasing(held, {
			outcome: {kind: "stuck", why: "rounds_spent"},
			said: `${question.ask}: ${pick}`,
		});
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
			// A build run again is a round: the builder gets another try, and the tries are counted.
			return running(held, question.step, question.step === "build" ? s.round + 1 : s.round);
		case "rounds_spent":
			return running(held, question.step, s.round + 1);
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
			const sendBack = m.sendBack === undefined ? {} : {sendBack: m.sendBack};
			return [{phase: "reading", number: m.number, lane: m.lane, ...sendBack, asked}, [asked]];
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
				...(s.sendBack === undefined ? {} : {sendBack: s.sendBack}),
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
			const {outcome, after: past} = m.value;
			return move(
				held,
				s.step,
				after(s.step, outcome, s.round, s),
				said,
				askWords(s.step, outcome),
				outcome.kind === "ask" && past !== undefined
					? {about: outcome.for, after: past}
					: undefined,
			);
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
				? answered(s, m.pick, m.note ?? "")
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
