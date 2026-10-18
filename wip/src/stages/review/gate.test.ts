import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {nameOf} from "../outcome";
import {reviewGate} from "./gate";
import {isReviewName, REVIEW_NAMES, ReviewOutcome} from "./outcome";
import type {Pack} from "./pack";
import {WHOLE} from "./scripted";

// The Check before the reviewer, as a table: one pack that is whole
// (`WHOLE`, in `scripted.ts`), and one thing wrong with it per row.

const RED: Pack["checks"] = {state: "red", required: [{name: "build", state: "red"}]};
const PENDING: Pack["checks"] = {state: "pending", required: [{name: "build", state: "pending"}]};

/** What the gate answers, as one word: an outcome's name, `go`, or `wait`. */
const answer = (pack: Pack) => {
	const gate = reviewGate(pack);
	return gate.answer === "stop" ? nameOf(gate.outcome) : gate.answer === "go" ? "go" : "wait";
};

describe("the check before the reviewer", () => {
	it("lets a whole pack through, and hands on a brief with nothing left to ask", () => {
		const gate = reviewGate(WHOLE);
		if (gate.answer !== "go") throw new Error("it did not go");
		expect(gate.brief).toEqual({
			pr: WHOLE.pr,
			head: WHOLE.head,
			ticket: WHOLE.ticket,
			criteria: WHOLE.criteria,
			files: WHOLE.files,
			diff: WHOLE.diff,
			deviations: WHOLE.deviations,
			checks: WHOLE.checks,
			kinds: ["review-code", "review-doc"],
			left: [],
			rubrics: WHOLE.rubrics,
		});
	});

	it.each<[string, Partial<Pack>, string]>([
		["it is merged", {state: "merged"}, "skip:merged"],
		["it is closed", {state: "closed"}, "skip:closed"],
		["it is a draft", {state: "draft"}, "skip:draft"],
		["a required check is red", {checks: RED}, "send:builder:checks_red"],
		["its text names no ticket", {ticket: "none", criteria: null}, "send:builder:no_ticket"],
		["the files could not be read", {files: null}, "stuck:diff_unknown"],
		["the diff could not be read", {diff: null}, "stuck:diff_unknown"],
		["the kinds owed could not be worked out", {kinds: null}, "stuck:kinds_unknown"],
		["the ticket could not be read", {criteria: null}, "stuck:ticket_unknown"],
		["the ticket has no acceptance criteria", {criteria: []}, "stuck:no_criteria"],
		[
			"a rubric is not in the folder",
			{rubrics: [WHOLE.rubrics[0] as Pack["rubrics"][number], {kind: "review-doc", text: null}]},
			"stuck:rubric_unknown",
		],
		[
			"a rubric was never read",
			{rubrics: [WHOLE.rubrics[0] as Pack["rubrics"][number]]},
			"stuck:rubric_unknown",
		],
		[
			"the checks could not be read whole",
			{checks: {state: "unknown", required: []}},
			"stuck:checks_unknown",
		],
		["a required check is still running", {checks: PENDING}, "wait"],
	])("stops when %s", (_name, wrong, expected) => {
		expect(answer({...WHOLE, ...wrong})).toBe(expected);
	});

	it("does not read the state on a replay: a merged pull request is what a replay is for", () => {
		expect(answer({...WHOLE, replay: true, state: "merged"})).toBe("go");
		expect(answer({...WHOLE, replay: true, state: "closed", checks: RED})).toBe(
			"send:builder:checks_red",
		);
	});

	it("puts red before everything a reviewer needs, so a red head goes back whatever else is missing", () => {
		const nothing: Partial<Pack> = {
			ticket: "none",
			criteria: null,
			files: null,
			diff: null,
			kinds: null,
			rubrics: [],
		};
		expect(answer({...WHOLE, ...nothing, checks: RED})).toBe("send:builder:checks_red");
		// And a missing part before a wait: there is no use waiting for checks on a pack that cannot be reviewed.
		expect(answer({...WHOLE, criteria: null, checks: PENDING})).toBe("stuck:ticket_unknown");
		expect(answer({...WHOLE, state: "draft", checks: RED})).toBe("skip:draft");
	});

	it("keeps a kind this stage does not do apart, and asks no rubric for it", () => {
		const gate = reviewGate({
			...WHOLE,
			kinds: ["review-code", "review-doc", "governance", "review-ui"],
		});
		if (gate.answer !== "go") throw new Error("it did not go");
		expect(gate.brief.kinds).toEqual(["review-code", "review-doc"]);
		expect(gate.brief.left).toEqual(["governance", "review-ui"]);
	});
});

describe("the review stage's outcomes", () => {
	it("can print these names and no other", () => {
		expect(REVIEW_NAMES).toEqual([
			"done",
			"done:part",
			"send:builder:review_failed",
			"send:builder:checks_red",
			"send:builder:no_ticket",
			"skip:merged",
			"skip:closed",
			"skip:draft",
			"stuck:read_failed",
			"stuck:ticket_unknown",
			"stuck:no_criteria",
			"stuck:diff_unknown",
			"stuck:kinds_unknown",
			"stuck:rubric_unknown",
			"stuck:checks_unknown",
			"stuck:draft_failed",
			"stuck:over_budget",
			"stuck:unseen",
			"stuck:checks_stuck",
		]);
		expect(isReviewName("send:builder:checks_red")).toBe(true);
		// Words of another stage are not this one's.
		expect(isReviewName("send:reviewer:no_review")).toBe(false);
		expect(isReviewName("ask:owner:approval")).toBe(false);
	});

	it("refuses an outcome that is not made of its own words", () => {
		const fits = Schema.is(ReviewOutcome);
		expect(fits({kind: "done", part: false, head: "abc"})).toBe(true);
		expect(fits({kind: "done", part: false})).toBe(false);
		expect(fits({kind: "send", to: "builder", why: "checks_red"})).toBe(true);
		expect(fits({kind: "send", to: "builder", why: "conflicts"})).toBe(false);
		expect(fits({kind: "send", to: "shipper", why: "review_failed"})).toBe(false);
		expect(fits({kind: "ask", who: "owner", for: "approval"})).toBe(false);
		expect(fits({kind: "stuck", why: "unseen"})).toBe(true);
	});
});
