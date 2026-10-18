import {Option, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {jsonSchema, reader} from "../../schema.ts";
import {claimProblems, identifiersIn, planProblems} from "./check.ts";
import {type Criterion, Plan, sizeOf, textOf} from "./plan.ts";
import {planMarkdown} from "./render.ts";

// The plan's data and its Check: what a plan may hold, and every problem the
// Check sends back to the planner. Pure: no agent, no engine.

const crit = (when: string, result: string): Criterion => ({
	when,
	result,
	check: {how: "test", what: "a test that does it and looks"},
});

const good: Plan = {
	summary:
		"A small clock value is read as a time since the process started, so spans start at the wrong time.",
	tasks: [
		{
			title: "Read every clock value as epoch milliseconds",
			ends: "pr",
			criteria: [
				crit(
					"a run's clock starts at a value smaller than the time since the process started",
					"the root span starts at exactly that clock value",
				),
			],
		},
	],
	pointers: [{at: "packages/tea/src/otel/index.ts", why: "every span start and end is set here"}],
	questions: [],
};

describe("identifiersIn: what a criterion must not name", () => {
	it("finds paths, file names and code names, each with what it looks like", () => {
		expect(identifiersIn("the doc comment in src/propose/refine.ts says so")).toEqual([
			"src/propose/refine.ts (a path)",
			"refine.ts (a file name)",
		]);
		expect(identifiersIn("readAllowance accepts it")).toEqual(["readAllowance (a camelCase name)"]);
		expect(identifiersIn("the SplitCandidate comment")).toEqual([
			"SplitCandidate (a PascalCase name)",
		]);
		expect(identifiersIn("max_files is kept")).toEqual(["max_files (a snake_case name)"]);
		expect(identifiersIn("TYPESAFE_API_KEY is unset")).toEqual([
			"TYPESAFE_API_KEY (a CONSTANT name)",
		]);
		expect(identifiersIn("a host calls stop() on it")).toEqual(["stop( (a call)"]);
		expect(identifiersIn("run.stop leaves it")).toEqual(["run.stop (a member access)"]);
		expect(identifiersIn("it prints `unparsed`")).toEqual(["`unparsed` (code in backticks)"]);
	});

	it("leaves a user's words alone: flags, package names, product names, plurals", () => {
		expect(identifiersIn("someone runs the check with --env-keys")).toEqual([]);
		expect(identifiersIn("a consumer of @demlik/code-graph reads it")).toEqual([]);
		expect(identifiersIn("the TypeScript compiler on GitHub accepts it")).toEqual([]);
		expect(identifiersIn("the read/write split lists the file(s) it found, e.g. two")).toEqual([]);
	});
});

describe("claimProblems: one criterion is one claim", () => {
	it("passes one trigger and one result", () => {
		expect(claimProblems(crit("someone runs the check", "it reports the import"))).toEqual([]);
	});

	it("sends back two sentences, a ';', and two results joined", () => {
		expect(claimProblems(crit("someone runs it", "it reports the import. It exits 1"))).toContain(
			"it is more than one sentence: one criterion is one claim",
		);
		expect(claimProblems(crit("someone runs it", "it reports it; it exits 1"))).toContain(
			"its `result` joins two results with ';': split it in two",
		);
		expect(claimProblems(crit("someone runs it", "it reports it, and it exits 1"))).toContain(
			"its `result` joins two results: split it into two criteria",
		);
	});

	it("sends back a step to take, an empty part, and a doubled When", () => {
		expect(claimProblems(crit("the fix lands", "add a rule for it"))).toEqual([
			"its `result` reads as a step to take, not a result someone sees: say what is true after",
		]);
		expect(claimProblems(crit("", "it reports it"))).toEqual([
			"its `when` is empty: say what someone does, or what happens",
		]);
		expect(claimProblems(crit("When someone runs it", "it reports it"))).toEqual([
			"its `when` starts with the word When; the sentence adds it, so leave it out",
		]);
	});

	it("allows a list joined by a plain and", () => {
		expect(
			claimProblems(crit("someone runs it", "it names the first and the second file")),
		).toEqual([]);
	});
});

describe("planProblems: the whole plan", () => {
	it("passes a plan that holds to every rule", () => {
		expect(planProblems(good, null)).toEqual([]);
	});

	it("sends back a plan with no task, and a task with no criterion", () => {
		expect(planProblems({...good, tasks: []}, null)).toEqual([
			"The plan has no task. Every ticket has at least one.",
		]);
		expect(
			planProblems({...good, tasks: [{title: "Look", ends: "answer", criteria: []}]}, null),
		).toEqual(['Task 1 ("Look") has no criterion. Every task has at least one.']);
	});

	it("names the criterion that names code, and says where the name goes", () => {
		const coded = crit("a host calls readAllowance with no library", "it is accepted");
		const [problem] = planProblems(
			{...good, tasks: [{...good.tasks[0]!, criteria: [coded]}]} as Plan,
			null,
		);
		expect(problem).toBe(
			`Task 1 ("Read every clock value as epoch milliseconds"), criterion 1 ("${textOf(coded)}") names code: readAllowance (a camelCase name). Say it in the words a user of the package meets it in, and put the file or name in pointers.`,
		);
	});

	it("sends back an open question with no lean, or one that dodges", () => {
		const q = {
			ask: "Is a new export in scope?",
			options: ["yes", "no"],
			why: "it widens the surface",
		};
		expect(planProblems({...good, questions: [{...q, lean: ""}]}, null)).toEqual([
			'Open question 1 ("Is a new export in scope?") has no lean. Say which way you lean, and why.',
		]);
		expect(planProblems({...good, questions: [{...q, lean: "Unsure."}]}, null)).toHaveLength(1);
		expect(
			planProblems({...good, questions: [{...q, lean: "no: keep the surface"}]}, null),
		).toEqual([]);
	});

	it("sends back a check that says nothing", () => {
		const blank = {...good.tasks[0]!.criteria[0]!, check: {how: "read" as const, what: " "}};
		expect(
			planProblems({...good, tasks: [{...good.tasks[0]!, criteria: [blank]}]} as Plan, null),
		).toEqual([
			`Task 1 ("Read every clock value as epoch milliseconds"), criterion 1 ("${textOf(blank)}"): its check does not say what it does.`,
		]);
	});
});

describe("the schema", () => {
	const read = reader(Plan);

	it("takes a whole plan, and refuses an ending or a check it does not know", () => {
		expect(Option.isSome(read(good))).toBe(true);
		const merge = {...good, tasks: [{...good.tasks[0]!, ends: "merge"}]};
		expect(Option.isNone(read(merge))).toBe(true);
		const eyeball = {
			...good,
			tasks: [
				{
					...good.tasks[0]!,
					criteria: [{...good.tasks[0]!.criteria[0]!, check: {how: "eyeball", what: "x"}}],
				},
			],
		};
		expect(Option.isNone(read(eyeball))).toBe(true);
	});

	it("refuses a question with no lean field at all", () => {
		const q = {ask: "Is it in scope?", options: [], why: "it widens the surface"};
		expect(Option.isNone(read({...good, questions: [q]}))).toBe(true);
	});

	it("hands the agent a closed JSON Schema: every field required, nothing else allowed", () => {
		const schema = jsonSchema(Plan) as {
			required: readonly string[];
			additionalProperties: boolean;
		};
		expect([...schema.required].sort()).toEqual(["pointers", "questions", "summary", "tasks"]);
		expect(schema.additionalProperties).toBe(false);
		expect(Schema.decodeUnknownSync(Plan)(good)).toEqual(good);
	});
});

describe("the view", () => {
	it("counts a plan's size: summary 20 words, title 7, criterion 25, check 7, pointer 9", () => {
		expect(sizeOf(good)).toEqual({tasks: 1, criteria: 1, words: 68});
	});

	it("shows each task, each criterion as a box with its check, the questions and the pointers", () => {
		const view = planMarkdown(
			{
				...good,
				questions: [{ask: "A new export?", options: ["yes", "no"], lean: "no", why: "smaller"}],
			},
			"otel span timing (#367)",
		);
		expect(view).toContain("# Plan: otel span timing (#367)");
		expect(view).toContain("## Task 1: Read every clock value as epoch milliseconds");
		expect(view).toContain("It ends in a pull request.");
		expect(view).toContain(
			"- [ ] When a run's clock starts at a value smaller than the time since the process started, the root span starts at exactly that clock value.",
		);
		expect(view).toContain("_Check (test): a test that does it and looks_");
		expect(view).toContain("   - Lean: no");
		expect(view).toContain(
			"- `packages/tea/src/otel/index.ts`: every span start and end is set here",
		);
		expect(planMarkdown(good, "x")).toContain("## Open questions\n\nNone.");
		const ticked = {...good, pointers: [{at: "the `pnpm test` gate", why: "it fails"}]};
		expect(planMarkdown(ticked, "x")).toContain("- `` the `pnpm test` gate ``: it fails");
	});
});
