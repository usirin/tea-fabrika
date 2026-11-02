import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {make} from "../../entity.ts";
import {LaneId} from "../../ids.ts";
import {Title} from "../../tickets/ticket.ts";
import type {Item} from "../build/ticket.ts";
import {nameOf} from "../outcome.ts";
import {
	after,
	answerSub,
	askPerson,
	claimLane,
	EMPTY,
	Lane,
	type LaneCmd,
	lane,
	MAX_ROUNDS,
	readFiled,
	runStep,
	type StepEnd,
} from "./machine.ts";

// Today's version. The question a lane puts on a ticket, on the real reducer. A question that does not
// fit a `Title` cannot be written, and the lane ends `step_failed`.

const ID = make(LaneId)("L1");
const READ = readFiled({number: 7});
const CLAIM = claimLane({number: 7, lane: ID, intent: "c"});
const RUN = runStep({
	number: 7,
	count: 1,
	step: "triage",
	round: 1,
	carry: EMPTY,
	intent: "lane/7/1/triage",
});

/** What the lane asks of the person once the exam step has put up a pull request for these rule files. */
const questionFor = (rules: readonly string[]) => {
	const ended = (s: Lane, end: StepEnd) => lane.update.lane_step_ok(s, runStep.ok(RUN, end, 0));
	const [read] = lane.update.start({phase: "idle"}, {type: "start", number: 7, lane: ID});
	const [claiming] = lane.update.lane_read_ok(
		read,
		readFiled.ok(READ, {state: "open", mine: true}, 0),
	);
	const [triaged] = lane.update.lane_claim_ok(claiming, claimLane.ok(CLAIM, ID, 0));
	const [planning] = ended(triaged, {outcome: {kind: "send", to: "plan", why: "yes"}, carry: {}});
	const [approving, approveCmds] = ended(planning, {
		outcome: {kind: "done", part: false},
		carry: {rules},
	});
	const approve = approveCmds.find((cmd: LaneCmd) => cmd.type === "lane_ask");
	if (approve?.type !== "lane_ask") throw new Error("the plan's yes was not asked");
	const [examining] = lane.update.lane_answered(approving, {
		type: "lane_answered",
		ask: approve.ask,
		pick: "approve",
	});
	const [, cmds] = ended(examining, {
		outcome: {kind: "ask", who: "owner", for: "check_change"},
		carry: {},
	});
	const asked = cmds.find((cmd: LaneCmd) => cmd.type === "lane_ask");
	if (asked?.type !== "lane_ask") throw new Error("the rule change's merge was not asked");
	return asked;
};

describe("the question a lane asks", () => {
	it("is a Title when a rule file's name holds a line break", () => {
		expect(Schema.is(Title)(questionFor([".oxlintrc.json\nand more"]).what)).toBe(true);
	});

	it("is a Title when its cut falls on a space", () => {
		// "merge the rule changes: " is 24 letters: the 200th letter of the question is this space.
		const name = `${"a".repeat(175)} and more`;
		expect(Schema.is(Title)(questionFor([name]).what)).toBe(true);
	});
});

const DONE: StepEnd = {outcome: {kind: "done", part: false}, carry: {}};
const UNSEEN = {kind: "ask", who: "owner", for: "unseen"} as const;
const MARKED = {kind: "ask", who: "owner", for: "decision"} as const;
const ended = (s: Lane, end: StepEnd) => lane.update.lane_step_ok(s, runStep.ok(RUN, end, 0));

const asking = (s: Lane) => {
	if (s.phase !== "asking") throw new Error(`the lane is ${s.phase}, and asks nothing`);
	return s;
};

/** The lane as it runs its test writer, a person's yes on the plan behind it. `more`: more on its start. */
const atWriter = (more: {readonly sendBack?: boolean} = {}) => {
	const [opened] = lane.update.start(
		{phase: "idle"},
		{type: "start", number: 7, lane: ID, ...more},
	);
	const [claiming] = lane.update.lane_read_ok(
		opened,
		readFiled.ok(READ, {state: "open", mine: true}, 0),
	);
	const [triaged] = lane.update.lane_claim_ok(claiming, claimLane.ok(CLAIM, ID, 0));
	const [planning] = ended(triaged, {outcome: {kind: "send", to: "plan", why: "yes"}, carry: {}});
	const [approving] = ended(planning, DONE);
	const [exam] = lane.update.lane_answered(asking(approving), {
		type: "lane_answered",
		ask: asking(approving).question.ask,
		pick: "approve",
	});
	const [writer] = ended(exam, {outcome: {kind: "skip", why: "no_rules_change"}, carry: {}});
	return writer;
};

/** The lane as it runs its review. */
const atReview = () => {
	const [build] = ended(atWriter(), DONE);
	const [mutation] = ended(build, DONE);
	const [review] = ended(mutation, DONE);
	return review;
};

/** A review that marked a finding against a decision, beside a row it could not see. */
const markedBesideUnseen = () => {
	const [first, firstCmds] = ended(atReview(), {
		outcome: MARKED,
		after: UNSEEN,
		carry: {},
	});
	const one = asking(first);
	const [second, secondCmds] = lane.update.lane_answered(one, {
		type: "lane_answered",
		ask: one.question.ask,
		pick: "go_on",
	});
	return {one, firstCmds, two: asking(second), secondCmds};
};

const read = Schema.decodeUnknownSync(Lane);
const WHAT = "The review says a decision you made on the plan is wrong. Does your decision stand?";

/** A lane as code from before this change saved it, asking about a marked finding: every key as it was. */
const savedAsking = (question: {
	readonly ask: string;
	readonly picks: readonly string[];
	readonly step: string;
	readonly call?: unknown;
}) =>
	asking(
		read({
			phase: "asking",
			number: 7,
			lane: ID,
			count: 5,
			round: 1,
			carry: EMPTY,
			// A question of the same run, answered before this one.
			trail: [{step: "a-step-1", said: "again"}],
			question: {what: WHAT, for: "step", ...question},
			asked: askPerson({
				number: 7,
				ask: question.ask,
				what: WHAT,
				picks: question.picks,
				intent: `lane/7/${question.ask}`,
			}),
		}),
	);

describe("every question has its own id", () => {
	it("a marked finding's go_on, then an unseen review: two questions, two ids", () => {
		const {one, two} = markedBesideUnseen();
		expect(two.question.ask).not.toBe(one.question.ask);
	});

	it("the second question is sent to the ticket under its own id, for its own intent", () => {
		const {firstCmds, secondCmds} = markedBesideUnseen();
		const asksIn = (cmds: readonly LaneCmd[]) => cmds.filter((c) => c.type === "lane_ask");
		const [first] = asksIn(firstCmds);
		const [second] = asksIn(secondCmds);
		expect(second?.ask).not.toBe(first?.ask);
		expect(second?.intent).not.toBe(first?.intent);
	});

	it("the answer to the first question does not answer the second", () => {
		const {one, two} = markedBesideUnseen();
		const [still, cmds] = lane.update.lane_answered(two, {
			type: "lane_answered",
			ask: one.question.ask,
			pick: "stop",
		});
		expect(still).toEqual(two);
		expect(cmds).toEqual([]);
	});

	it("the Listen hears for the second question's id", () => {
		const {one, two} = markedBesideUnseen();
		// By the id alone: the two questions' picks differ, so the whole deps would differ with one id.
		expect(answerSub.deps(two)).toMatchObject({ask: two.question.ask});
		expect(two.question.ask).not.toBe(one.question.ask);
	});

	it("a kept lane's count of steps still says each step's run once", () => {
		const {two} = markedBesideUnseen();
		const [again, cmds] = lane.update.lane_answered(two, {
			type: "lane_answered",
			ask: two.question.ask,
			pick: "again",
		});
		if (again.phase !== "running") throw new Error(again.phase);
		const [step] = cmds.filter((c: LaneCmd) => c.type === "lane_step");
		expect(step?.count).toBe(again.count);
		expect(step?.intent).toBe(`lane/7/${again.count}/review`);
	});
});

describe("a lane saved while asking", () => {
	const SAVED = {
		ask: "a-step-5",
		picks: ["go_on", "stop"],
		step: "review",
		call: {about: "decision", after: UNSEEN},
	};

	it("still reads, with every key it was saved with and no other", () => {
		expect(savedAsking(SAVED).question.ask).toBe("a-step-5");
	});

	it("goes on hearing the question it holds, by the id it holds", () => {
		const s = savedAsking(SAVED);
		const [same, cmds] = lane.update.resume(s, {type: "resume"});
		expect(same).toEqual(s);
		expect(cmds).toEqual([s.asked]);
		expect(answerSub.deps(s)).toEqual({number: 7, ask: "a-step-5", picks: ["go_on", "stop"]});
	});

	it("takes an answer to that id", () => {
		const [next] = lane.update.lane_answered(savedAsking(SAVED), {
			type: "lane_answered",
			ask: "a-step-5",
			pick: "stop",
		});
		expect(next.phase).toBe("releasing");
	});

	it("its next question has an id none of its earlier questions had", () => {
		const s = savedAsking(SAVED);
		const [next] = lane.update.lane_answered(s, {
			type: "lane_answered",
			ask: "a-step-5",
			pick: "go_on",
		});
		const {ask} = asking(next).question;
		expect(ask).not.toBe("a-step-5");
		expect(s.trail.map((row) => row.step)).not.toContain(ask);
	});

	// P27: the pick is gone from a new question, and a lane already holding it ends the way it did.
	it("offering go_on on an unseen review goes to the push with no verdict to post, as it did", () => {
		const [next] = lane.update.lane_answered(
			savedAsking({ask: "a-step-5", picks: ["again", "go_on", "stop"], step: "review"}),
			{type: "lane_answered", ask: "a-step-5", pick: "go_on"},
		);
		if (next.phase !== "running") throw new Error(next.phase);
		expect(next.step).toBe("push");
		expect(next.carry.posts).toEqual([]);
	});

	// P28: the same, for a builder that changed nothing.
	it("offering go_on after a builder that changed nothing goes on to the mutation step, as it did", () => {
		const [next] = lane.update.lane_answered(
			savedAsking({
				ask: "a-step-5",
				picks: ["go_on", "stop"],
				step: "build",
				call: {about: "no_change", after: {kind: "done", part: false}},
			}),
			{type: "lane_answered", ask: "a-step-5", pick: "go_on"},
		);
		if (next.phase !== "running") throw new Error(next.phase);
		expect(next.step).toBe("mutation");
	});
});

describe("a review that could not see", () => {
	const unseenAsked = () => {
		const [next, cmds] = ended(atReview(), {outcome: UNSEEN, carry: {}});
		const [asked] = cmds.filter((c: LaneCmd) => c.type === "lane_ask");
		if (asked === undefined) throw new Error("nothing was asked");
		return {question: asking(next).question, asked};
	};

	it("offers `again` and `stop`, and no `go_on`", () => {
		expect(unseenAsked().question.picks).toEqual(["again", "stop"]);
	});

	it("says what each of them does, and only them", () => {
		const {does = []} = unseenAsked().asked;
		expect(does).toHaveLength(2);
		expect(does[0]).toMatch(/^`again`: .*review.*once more/);
		expect(does[1]).toMatch(/^`stop`: .*does not land/);
	});

	it("is asked the same way when a marked finding's go_on leads to it", () => {
		expect(markedBesideUnseen().two.question.picks).toEqual(["again", "stop"]);
	});

	it("a go_on it no longer offers is not heard", () => {
		const {question} = unseenAsked();
		const [next] = ended(atReview(), {outcome: UNSEEN, carry: {}});
		const [still] = lane.update.lane_answered(asking(next), {
			type: "lane_answered",
			ask: question.ask,
			pick: "go_on",
		});
		expect(still.phase).toBe("asking");
	});

	it("any other step that asks may still be let through", () => {
		const [writer] = ended(atWriter(), {
			outcome: {kind: "ask", who: "owner", for: "cannot_test"},
			carry: {},
		});
		expect(asking(writer).question.picks).toEqual(["again", "go_on", "stop"]);
	});

	it("its `stop` is the person's no, and never the rounds' stuck", () => {
		const [next] = ended(atReview(), {outcome: UNSEEN, carry: {}});
		const [over] = lane.update.lane_answered(asking(next), {
			type: "lane_answered",
			ask: unseenAsked().question.ask,
			pick: "stop",
		});
		expect(over.phase === "releasing" && nameOf(over.outcome)).toBe("skip:owner_no");
	});
});

// Self-fix PR 3: a head whose own tests fail goes back to the builder with the failing tests' names,
// a round at a time, and a person is asked once the rounds are spent. Never the lane's end on its own.
describe("a head whose tests fail goes back to the builder", () => {
	const RED = {kind: "send", to: "builder", why: "tests_red"} as const;
	const REVIEW_BACK = {kind: "send", to: "builder", why: "review_failed"} as const;
	const NAME = "src/lower.test.ts > lower > lowers capitals";
	/** One failing test, as the mutation step leaves it for the next build: an open item with no criterion. */
	const FAILED: Item = {
		criterion: null,
		text: NAME,
		says: "This test fails at the build's head.",
		where: ["src/lower.test.ts"],
		wants: [],
	};
	const RED_END: StepEnd = {outcome: RED, carry: {open: [FAILED]}};

	const running = (s: Lane) => {
		if (s.phase !== "running") throw new Error(`the lane is ${s.phase}, and runs nothing`);
		return s;
	};
	const stepsIn = (cmds: readonly LaneCmd[]) =>
		cmds.flatMap((c) => (c.type === "lane_step" ? [c] : []));

	/** From the first mutation step: the head is red `times` times, and each build between ends well. */
	const redRounds = (times: number, more: {readonly sendBack?: boolean} = {}) => {
		const [build] = ended(atWriter(more), DONE);
		let [s, cmds] = ended(build, DONE);
		for (let i = 1; i <= times; i++) {
			[s, cmds] = ended(s, RED_END);
			if (i < times && s.phase === "running" && s.step === "build") [s, cmds] = ended(s, DONE);
		}
		return {s, cmds};
	};

	/** From the first review: it sends the work back each round, and every step between ends well. */
	const reviewRounds = () => {
		let [s, cmds] = ended(atReview(), {outcome: REVIEW_BACK, carry: {}});
		// Bounded, so a lane that never asks fails the test and does not hang it.
		for (let i = 0; i < 4 * MAX_ROUNDS && s.phase === "running"; i++)
			[s, cmds] = ended(s, s.step === "review" ? {outcome: REVIEW_BACK, carry: {}} : DONE);
		return {s, cmds};
	};

	/** The `what` of the one question in `cmds`. */
	const whatIn = (cmds: readonly LaneCmd[]) => {
		const asked = cmds.find((c: LaneCmd) => c.type === "lane_ask");
		if (asked?.type !== "lane_ask") throw new Error("nothing was asked");
		return asked.what;
	};

	it("start reads the ticket first, and keeps `send_back` as it was given", () => {
		const [s, cmds] = lane.update.start(
			{phase: "idle"},
			{type: "start", number: 7, lane: ID, sendBack: false},
		);
		expect(cmds).toEqual([READ]);
		expect(s).toEqual({phase: "reading", number: 7, lane: ID, sendBack: false, asked: READ});
	});

	it("after: build, a round up, until the rounds are spent, then a question", () => {
		expect(after("mutation", RED, 1)).toEqual({to: "build", round: 2});
		expect(after("mutation", RED, MAX_ROUNDS - 1)).toEqual({to: "build", round: MAX_ROUNDS});
		expect(after("mutation", RED, MAX_ROUNDS)).toEqual({ask: "rounds_spent"});
	});

	it("after: a review's send-back counts in the same rounds, and asks too once they are spent", () => {
		expect(after("review", REVIEW_BACK, 1)).toEqual({to: "test_writer", round: 2});
		expect(after("review", REVIEW_BACK, MAX_ROUNDS)).toEqual({ask: "rounds_spent"});
	});

	it("after: with `[build] send_back = false`, the first red asks at once; left out, it goes back", () => {
		expect(after("mutation", RED, 1, {sendBack: false})).toEqual({ask: "rounds_spent"});
		expect(after("mutation", RED, 1, {sendBack: true})).toEqual({to: "build", round: 2});
		expect(after("mutation", RED, 1)).toEqual({to: "build", round: 2});
	});

	it("a red mutation step runs the build next, as round 2, with each failing test open", () => {
		const {s, cmds} = redRounds(1);
		expect(running(s).step).toBe("build");
		expect(running(s).round).toBe(2);
		const [step] = stepsIn(cmds);
		expect(step?.step).toBe("build");
		expect(step?.round).toBe(2);
		expect(step?.carry.open).toEqual([FAILED]);
		expect(running(s).trail.at(-1)).toEqual({step: "mutation", said: "send:builder:tests_red"});
	});

	it("once the rounds are spent, asks `rounds_spent` with again or stop, and names what is still red", () => {
		const {s, cmds} = redRounds(MAX_ROUNDS);
		const {question} = asking(s);
		expect(question.for).toBe("rounds_spent");
		expect(question.picks).toEqual(["again", "stop"]);
		expect(asking(s).round).toBe(MAX_ROUNDS);
		const asked = cmds.find((c: LaneCmd) => c.type === "lane_ask");
		if (asked?.type !== "lane_ask") throw new Error("nothing was asked");
		const words = [asked.what, ...(asked.also ?? []), ...(asked.does ?? [])].join("\n");
		expect(words).toContain(NAME);
		expect(asked.does ?? []).toHaveLength(2);
	});

	it("`again` runs the build once more, a round past the cap, and nothing before it", () => {
		const {s} = redRounds(MAX_ROUNDS);
		const [next, cmds] = lane.update.lane_answered(asking(s), {
			type: "lane_answered",
			ask: asking(s).question.ask,
			pick: "again",
		});
		expect(running(next).step).toBe("build");
		expect(running(next).round).toBe(MAX_ROUNDS + 1);
		expect(stepsIn(cmds).map((c) => c.step)).toEqual(["build"]);
		expect(stepsIn(cmds)[0]?.carry.open).toEqual([FAILED]);
	});

	it("`again` once more, then red again: asked again, never a build unasked", () => {
		const {s} = redRounds(MAX_ROUNDS);
		const [build] = lane.update.lane_answered(asking(s), {
			type: "lane_answered",
			ask: asking(s).question.ask,
			pick: "again",
		});
		const [mutation] = ended(build, DONE);
		const [again] = ended(mutation, RED_END);
		expect(asking(again).question.for).toBe("rounds_spent");
	});

	it("`stop` ends the lane `stuck:rounds_spent`, a pause a restart picks up, not a person's no", () => {
		const {s} = redRounds(MAX_ROUNDS);
		const [next] = lane.update.lane_answered(asking(s), {
			type: "lane_answered",
			ask: asking(s).question.ask,
			pick: "stop",
		});
		expect(next.phase === "releasing" && nameOf(next.outcome)).toBe("stuck:rounds_spent");
	});

	it("a lane started with `send_back` off asks at the first red", () => {
		const {s} = redRounds(1, {sendBack: false});
		expect(asking(s).question.for).toBe("rounds_spent");
	});

	it("a lane asking `rounds_spent` saves and reads back as it was", () => {
		const {s} = redRounds(MAX_ROUNDS);
		expect(read(Schema.encodeSync(Lane)(asking(s)))).toEqual(s);
	});

	it("a green mutation step after a red round goes on to review", () => {
		const {s} = redRounds(1);
		const [mutation] = ended(s, DONE);
		const [review] = ended(mutation, DONE);
		expect(running(review).step).toBe("review");
	});

	it("`again` after a review's spent rounds runs the test writer, as the review sent the work there", () => {
		const {s} = reviewRounds();
		expect(asking(s).question.for).toBe("rounds_spent");
		const [next, cmds] = lane.update.lane_answered(asking(s), {
			type: "lane_answered",
			ask: asking(s).question.ask,
			pick: "again",
		});
		expect(running(next).step).toBe("test_writer");
		expect(running(next).round).toBe(MAX_ROUNDS + 1);
		expect(stepsIn(cmds).map((c) => c.step)).toEqual(["test_writer"]);
	});

	it("the question says why the rounds ran out: the review, red tests, or `send_back` off", () => {
		const review = whatIn(reviewRounds().cmds);
		expect(review).toContain(`Round ${MAX_ROUNDS} of ${MAX_ROUNDS} is spent`);
		expect(review).toContain("the review still sends the work back");
		const red = whatIn(redRounds(MAX_ROUNDS).cmds);
		expect(red).toContain(`Round ${MAX_ROUNDS} of ${MAX_ROUNDS} is spent`);
		expect(red).toContain("tests still fail");
		const off = whatIn(redRounds(1, {sendBack: false}).cmds);
		expect(off).toContain("send_back is false");
		expect(off).toContain("tests still fail");
	});
});
