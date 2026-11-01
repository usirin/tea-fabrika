import {Cause, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {make} from "../../entity.ts";
import {QuestionId} from "../../ids.ts";
import {BREAK} from "../build/body.ts";
import {planProblems} from "../plan/check.ts";
import {HeldDraft, PlanDraft, PlanQuestion} from "../plan/plan.ts";
import type {Finding} from "../review/sheet.ts";
import {PropertyId} from "../test-writer/brief.ts";
import {
	againstWords,
	brokeWords,
	decidedWords,
	foundWords,
	mutantWords,
	ruleChangeLines,
	untestedWords,
} from "./found.ts";
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

/** An agent's words with a person's name and a closing word in them. */
const LOUD = "Thanks @someone and @org/team, this fixes #2.";
const mentions = (text: string) => text.match(/(?<!\w)@[a-z0-9][\w/-]*/gi) ?? [];
const references = (text: string) => text.match(/#\d+|\bgh-\d+|\/(?:issues|pull)\/\d+/gi) ?? [];
const P1 = make(PropertyId)("p1");
const Q1 = make(QuestionId)("q1");
const FOUND: Finding = {
	id: "f1",
	state: "open",
	kind: "review-code",
	from: {source: "decision", id: Q1},
	fault: LOUD,
	at: null,
	proof: LOUD,
	wants: LOUD,
};

describe("agent words a person or a pull request reads", () => {
	it.each<[string, readonly string[]]>([
		[
			"a rule change's change and why",
			ruleChangeLines([{path: ".oxlintrc.json", change: LOUD, why: LOUD}]),
		],
		["a property nobody tested", untestedWords([{when: LOUD, why: LOUD}])],
		["a mutant let live", mutantWords([{mutant: "m1", answer: "cannot", why: LOUD}])],
		[
			"what the test writer found",
			foundWords(
				[{id: "p1", when: LOUD}],
				[{property: P1, for: "cannot_test"}],
				[{property: P1, kind: "cannot", why: LOUD}],
			),
		],
		[
			"a finding against a decision, both sides",
			againstWords(
				{decided: {questions: [{...QUESTION, id: Q1, ask: LOUD, lean: LOUD}], said: [LOUD]}},
				[FOUND],
			),
		],
	])("%s ping nobody and close nothing", (_name, lines) => {
		const text = lines.join("\n");
		expect(text.replaceAll(BREAK, "")).toContain(LOUD);
		expect(mentions(text)).toEqual([]);
		expect(references(text)).toEqual([]);
	});

	describe("a rule change's path that holds a backtick", () => {
		/** The line with every code span taken out: what GitHub reads as words. */
		const outsideSpans = (line: string) => line.replace(/(?<!`)(`+)(?!`)(.*?)(?<!`)\1(?!`)/g, "");
		const PATH = "rules`.json fixes #2 @someone `more";
		const refused = (path = PATH) =>
			planProblems(
				Schema.decodeUnknownSync(PlanDraft)({
					summary: "One form.",
					stories: [{id: "reader", who: "a reader", want: "one form", why: "names match"}],
					tasks: [],
					pointers: [],
					questions: [],
					exam: [{path, change: "add a rule", why: "it needs one"}],
				}),
				null,
			).filter((problem) => /backtick/i.test(problem));

		it("is refused by the plan's Check in words, or stays inside one code span", () => {
			const [line = ""] = ruleChangeLines([
				{path: PATH, change: "add a rule", why: "it needs one"},
			]);
			const outside = outsideSpans(line);
			const held = !outside.includes(".json") && !outside.includes("more");
			expect({refused: refused().length > 0 || held}).toEqual({refused: true});
		});

		it("reaches a pull request with no reference or mention outside a code span, if it is let through", () => {
			if (refused().length > 0) return;
			const [line = ""] = ruleChangeLines([
				{path: PATH, change: "add a rule", why: "it needs one"},
			]);
			expect(mentions(outsideSpans(line))).toEqual([]);
			expect(references(outsideSpans(line))).toEqual([]);
		});

		it("an ordinary path stays as it was, one code span with no change to it", () => {
			const [line = ""] = ruleChangeLines([
				{path: ".oxlintrc.json", change: "add a rule", why: "it needs one"},
			]);
			expect(line).toContain("`.oxlintrc.json`");
			expect(refused(".oxlintrc.json")).toEqual([]);
		});
	});
});
