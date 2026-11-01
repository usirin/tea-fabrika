import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {make} from "../../entity.ts";
import {LaneId} from "../../ids.ts";
import {Title} from "../../tickets/ticket.ts";
import {
	answerSub,
	askPerson,
	claimLane,
	EMPTY,
	Lane,
	type LaneCmd,
	lane,
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

/** The lane as it runs its test writer, a person's yes on the plan behind it. */
const atWriter = () => {
	const [opened] = lane.update.start({phase: "idle"}, {type: "start", number: 7, lane: ID});
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
});
