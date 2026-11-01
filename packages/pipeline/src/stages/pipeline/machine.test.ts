import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {make} from "../../entity.ts";
import {LaneId} from "../../ids.ts";
import {Title} from "../../tickets/ticket.ts";
import {
	claimLane,
	EMPTY,
	type Lane,
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
