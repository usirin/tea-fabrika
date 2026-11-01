import {Cause, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {HeldDraft, PlanQuestion} from "../plan/plan.ts";
import {brokeWords, decidedWords} from "./found.ts";
import {Carry, EMPTY} from "./machine.ts";

// Today's version. What a brief says a person decided, on a lane saved before `decided` was kept and
// on one saved after.

const QUESTION = {
	ask: "Which ledger do we read?",
	options: [],
	lean: "The app's own.",
	why: "One.",
};
const PLAN = Schema.decodeUnknownSync(HeldDraft)({
	summary: "One form.",
	stories: [{id: "reader", who: "a reader", want: "one form", why: "names match"}],
	tasks: [],
	pointers: [],
	questions: [QUESTION],
});

describe("a lane's program that broke", () => {
	it("says so in a line, and any other end says nothing here", () => {
		const unread = {};
		const failed = {kind: "failed", cause: Cause.die(new Error("the disk broke")), unread} as const;
		expect(brokeWords(7, failed).join("\n")).toMatch(/^#7 broke: .*the disk broke/);
		expect(brokeWords(7, {kind: "ended", unread})).toEqual([]);
		expect(brokeWords(7, {kind: "stopped", unread})).toEqual([]);
	});
});

describe("what a brief says a person decided", () => {
	it("a lane saved before `decided` was kept still says its plan's leans, with no ids", () => {
		const saved = Schema.decodeUnknownSync(Carry)({...EMPTY, plan: PLAN});
		const words = decidedWords(saved);
		expect(words).toContain(QUESTION.ask);
		expect(words).toContain(QUESTION.lean);
		expect(words).not.toMatch(/`q\d+`/);
	});

	it("a lane with no plan yet and no answers says none", () => {
		expect(decidedWords(EMPTY)).toBe("None.");
	});

	it("a question under its id, and what the person wrote, in their words", () => {
		const words = decidedWords({
			plan: PLAN,
			decided: {
				questions: [Schema.decodeUnknownSync(PlanQuestion)({...QUESTION, id: "q1"})],
				said: ["Keep the old name too."],
			},
		});
		expect(words).toContain("`q1`");
		expect(words).toContain(QUESTION.lean);
		expect(words).toContain("Keep the old name too.");
	});
});
