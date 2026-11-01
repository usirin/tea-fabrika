import {jsonSchema, reader} from "@kampus/fabrika-old/agents/claude";
import {Option, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {claimProblems, identifiersIn, jobProblems, planProblems} from "./check.ts";
import {numbered as numberedRevision} from "./ids.ts";
import {userNames} from "./names.ts";
import {
	type Criterion,
	type Job,
	PlanDraft as Plan,
	revisionOfDraft,
	sizeOf,
	type DraftTask as Task,
	textOf,
} from "./plan.ts";
import {namesBrief} from "./planner.ts";
import {planMarkdown} from "./render.ts";

/** A draft the Check passes, numbered as the plan's first version. */
const numbered = (draft: Plan) => {
	const revision = revisionOfDraft(draft);
	if (revision === null) throw new Error("a story's name is not a story id");
	return numberedRevision(revision);
};

// The plan's data and its Check: what a plan may hold, and every problem the
// Check sends back to the planner. Pure: no agent, no engine.

const crit = (
	when: string,
	result: string,
	serves: readonly [string, ...string[]] = ["s1"],
): Criterion => ({
	when,
	result,
	check: {how: "test", what: "a test that does it and looks"},
	serves,
});

const job: Job = {
	when: "a host runs three programs, twice, on a clock it starts at 1",
	result: "every span of every run starts and ends at the clock values it was given",
	fixture: "three programs, each run twice, on a fake clock starting at 1",
	check: {how: "test", what: "a test runs them and reads every span"},
	serves: ["s1"],
};

const task: Task = {
	title: "Read every clock value as epoch milliseconds",
	ends: "pr",
	job,
	criteria: [
		crit(
			"a run's clock starts at a value smaller than the time since the process started",
			"the root span starts at exactly that clock value",
		),
	],
};

const good: Plan = {
	summary:
		"A small clock value is read as a time since the process started, so spans start at the wrong time.",
	stories: [
		{
			id: "s1",
			who: "a host that traces runs",
			want: "spans to start at the clock it gave",
			why: "a trace lines up with the rest of its system",
		},
	],
	tasks: [task],
	pointers: [{at: "packages/tea/src/otel/index.ts", why: "every span start and end is set here"}],
	questions: [],
};

const withCriteria = (criteria: readonly Criterion[]): Plan => ({
	...good,
	tasks: [{...task, criteria}],
});

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
		expect(identifiersIn("cohesion comes out at 2/6, as on 10/18")).toEqual([]);
	});

	it("leaves what a user types alone, in backticks or not: a flag, a glob, a published subpath", () => {
		expect(identifiersIn("someone runs `code-graph . --boundaries --ci`")).toEqual([]);
		expect(identifiersIn("a layer `**/*-plumbing.ts` claims `a/b/c/d/e-plumbing.ts`")).toEqual([
			"a/b/c/d/e-plumbing.ts (a path)",
			"e-plumbing.ts (a file name)",
		]);
		expect(identifiersIn("`apps/**/y` claims both")).toEqual([]);
		expect(identifiersIn("a host imports `@demlik/tea/otel`")).toEqual([]);
		expect(identifiersIn("the run's `README.md` and package.json say so")).toEqual([]);
	});

	it("leaves the names the published packages show their users alone, and nothing else", () => {
		const names = new Set(["decidedBy", "agentSpans", "TYPESAFE_API_KEY", "rules.json", "at"]);
		expect(identifiersIn("a rules file with no `decidedBy` key", names)).toEqual([]);
		expect(identifiersIn("a host passes agentSpans() a parent", names)).toEqual([]);
		expect(identifiersIn("TYPESAFE_API_KEY is unset and rules.json is empty", names)).toEqual([]);
		expect(identifiersIn("the span's `at` is in milliseconds", names)).toEqual([]);
		const folder = new Set(["adapters/driving"]);
		expect(identifiersIn("a scope lists `adapters/driving/` as driving", folder)).toEqual([]);
		expect(
			identifiersIn("a host passes agentSpans a parent, and compileMatchers sorts", names),
		).toEqual(["compileMatchers (a camelCase name)"]);
		expect(identifiersIn("the doc comment in src/otel/index.ts", names)).toEqual([
			"src/otel/index.ts (a path)",
			"index.ts (a file name)",
		]);
	});
});

describe("userNames: the names a user of the published packages meets", () => {
	const gate = {
		manifest: {
			name: "@acme/gate",
			bin: {gate: "./cli.js"},
			exports: {".": "./index.js", "./rules": "./rules.js"},
		},
		docs: [
			[
				"# gate",
				"",
				"Run `gate --strict` with a `rules.json` that sets `decidedBy`.",
				"",
				"```ts",
				'import {layerGate} from "@acme/gate";',
				"```",
			].join("\n"),
		],
	};

	it("reads the package, its subpaths, its commands and every name in code in its docs", () => {
		const names = userNames([gate]);
		for (const name of [
			"@acme/gate",
			"@acme/gate/rules",
			"gate",
			"--strict",
			"rules.json",
			"decidedBy",
			"layerGate",
		])
			expect(names).toContain(name);
		expect(names).not.toContain("Run");
	});

	it("reads nothing from a private package, or from a manifest it cannot read", () => {
		expect(userNames([{...gate, manifest: {...gate.manifest, private: true}}])).toEqual([]);
		expect(userNames([{manifest: "not a manifest", docs: ["`secretHelper`"]}])).toEqual([]);
	});

	it("names a package's one command after the package, when bin is a single file", () => {
		expect(userNames([{manifest: {name: "@acme/tool", bin: "./cli.js"}, docs: []}])).toEqual([
			"@acme/tool",
			"tool",
		]);
	});

	it("shows the planner only the code-shaped names the ticket uses; the Check knows the rest", () => {
		const names = ["decidedBy", "gate", "layerGate", "rules.json"];
		const ticket = "A `rules.json` with no `decidedBy`. gate refuses it.";
		expect(namesBrief(names, ticket)).toContain(
			"so a criterion may use them: decidedBy rules.json\n",
		);
		expect(namesBrief(names, ticket)).not.toContain("layerGate");
		expect(namesBrief(names, "nothing in code")).not.toContain("so a criterion may use them");
		expect(namesBrief([], ticket)).toContain("None were gathered");
	});
});

describe("claimProblems: one criterion is one claim", () => {
	const JOINED =
		'its `result` joins two results: split it into two criteria. A last part that only narrows the result is one claim when it opens with "only", "no other" or "nothing else" and names nothing new: "runs once, and only once", "installs the package, and no other package"';

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
			JOINED,
		);
	});

	it("sends back a second result after ', and', even one that opens like a narrowing", () => {
		for (const result of [
			"it creates the file, and prints its path",
			"the list has 3 rows, and each row has a date",
			"the first run exits 1, and the second run exits 0",
			"it installs the package, and no other package is installed",
			"it reports the import, and only then exits 1",
			"it runs once, and only once exits 0",
			"it reports the import, and nothing else changes",
			"it installs the package, and the lockfile, and no other package",
			"it runs once, and only once and then exits",
			"it runs once, and also exits 0",
		])
			expect(claimProblems(crit("someone runs it", result)), result).toContain(JOINED);
	});

	it("passes a last part that only narrows the result: one claim", () => {
		for (const result of [
			"the command installs the package as published, @demlik/tea, and no other package",
			"it runs once, and only once",
			"it reports the import, and nothing else",
			"it lists the three files, and no other file",
			"it writes to the first run's folder, and only the first run's folder",
			"the page names the maintainer, and nobody else",
		])
			expect(claimProblems(crit("someone runs it", result)), result).toEqual([]);
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

describe("jobProblems: the user's whole job, on a realistic fixture", () => {
	it("lets the job say several things: it is not held to one claim", () => {
		const whole = {
			...job,
			result:
				"the first run exits 1 and reports the import at its line, and the second run exits 0. Nothing else is reported",
		};
		expect(jobProblems(whole)).toEqual([]);
		expect(claimProblems(whole)).not.toEqual([]);
	});

	it("sends back a job with no fixture, or one on the smallest case", () => {
		expect(jobProblems({...job, fixture: " "})).toEqual([
			"its `fixture` is empty: say the realistic case the whole job runs on: more than two items, a second run, or a large input",
		]);
		expect(
			jobProblems({...job, when: "a host runs a program", fixture: "one program with two spans"}),
		).toEqual([
			"its fixture is the smallest case: make it realistic, with more than two items, a second run, or a large input",
		]);
	});

	it("takes more than two items, a second run, or a large input as realistic", () => {
		const on = (fixture: string) => jobProblems({...job, when: "a host runs it", fixture});
		expect(on("five role files across three folders")).toEqual([]);
		expect(on("a gate run, then run again once the import is allowed")).toEqual([]);
		expect(on("a large real repo")).toEqual([]);
	});

	it("still sends back a step to take", () => {
		expect(jobProblems({...job, result: "add a test for three runs"})).toEqual([
			"its `result` reads as a step to take, not a result someone sees: say what is true after",
		]);
	});
});

describe("planProblems: the whole plan", () => {
	it("passes a plan that holds to every rule", () => {
		expect(planProblems(good, null)).toEqual([]);
	});

	it("sends back a plan of two tasks with no goal, and holds a goal's criteria to the same rules as a task's", () => {
		const two = {...good, tasks: [task, {...task, title: "second"}]};
		expect(planProblems(two, null)).toEqual([
			"The plan has more than one task but no `goal`: say what a user sees only when every task is in, as a job and criteria of the whole plan. All the tasks land in one pull request, and the last review judges the goal there.",
		]);
		expect(planProblems({...two, goal: {job, criteria: []}}, null)).toEqual([]);
		const bad = crit("a run ends", "add a flag; print it");
		expect(planProblems({...two, goal: {job, criteria: [bad]}}, null)).toContain(
			`The plan's goal, criterion 1 ("When a run ends, add a flag; print it"): its \`result\` reads as a step to take, not a result someone sees: say what is true after.`,
		);
	});

	it("sends back a plan with no task", () => {
		expect(planProblems({...good, tasks: []}, null)).toEqual([
			"The plan has no task. Every ticket has at least one.",
			'Story 1 ("s1") has no criterion: write one that serves it, or drop the story if nobody needs it.',
		]);
	});

	it("sends back a story no criterion serves: a user the plan forgot", () => {
		const reader = {
			id: "s2",
			who: "someone reading the docs",
			want: "to know the unit",
			why: "they pass the right one",
		};
		expect(planProblems({...good, stories: [...good.stories, reader]}, null)).toEqual([
			'Story 2 ("s2") has no criterion: write one that serves it, or drop the story if nobody needs it.',
		]);
	});

	it("sends back a criterion that serves a story the plan does not have", () => {
		const stray = crit("someone runs it", "it reports the import", ["s9"]);
		expect(planProblems(withCriteria([stray]), null)).toEqual([
			`Task 1 ("Read every clock value as epoch milliseconds"), criterion 1 ("${textOf(stray)}") serves "s9", which no story has: name the id of a story in the plan.`,
		]);
		const strayJob = {...good, tasks: [{...task, job: {...job, serves: ["s1", "s3"] as const}}]};
		expect(planProblems(strayJob, null)).toEqual([
			`Task 1 ("Read every clock value as epoch milliseconds"), its whole job ("${textOf(job)}") serves "s3", which no story has: name the id of a story in the plan.`,
		]);
	});

	it("sends back a story with no id, the same id twice, or an empty part", () => {
		const [s1] = good.stories;
		expect(
			planProblems({...good, stories: [s1, {...s1, who: " "}, {...s1, id: "my story"}]}, null),
		).toEqual([
			'Story 2 ("s1") has the same id as an earlier story.',
			'Story 2 ("s1"): its `who` is empty.',
			'Story 3 ("my story") needs a short id with no spaces, like s3.',
			'Story 3 ("my story") has no criterion: write one that serves it, or drop the story if nobody needs it.',
		]);
	});

	it("holds the job to its own rules and the criteria after it to one claim", () => {
		const small = {
			...good,
			tasks: [{...task, job: {...job, when: "a host runs one program", fixture: "one program"}}],
		};
		expect(planProblems(small, null)).toEqual([
			`Task 1 ("Read every clock value as epoch milliseconds"), its whole job ("When a host runs one program, ${job.result}"): its fixture is the smallest case: make it realistic, with more than two items, a second run, or a large input.`,
		]);
		const two = crit("someone runs it", "it reports it; it exits 1");
		expect(planProblems(withCriteria([two]), null)).toEqual([
			`Task 1 ("Read every clock value as epoch milliseconds"), criterion 1 ("${textOf(two)}"): its \`result\` joins two results with ';': split it in two.`,
		]);
	});

	it("names the criterion that names internal code, and says where the name goes", () => {
		const coded = crit("a host calls readAllowance with no library", "it is accepted");
		expect(planProblems(withCriteria([coded]), null)).toEqual([
			`Task 1 ("Read every clock value as epoch milliseconds"), criterion 1 ("${textOf(coded)}") names code a user never meets: readAllowance (a camelCase name). Name things the way a user meets them (a command, a flag, a config key, a published name), and put internal files and names in pointers.`,
		]);
	});

	it("passes a criterion that names what a user types: a flag, a glob, a config key the docs show", () => {
		const typed = [
			crit("someone runs the gate with `--boundaries --ci`", "it exits 1"),
			crit("a layer is declared as `**/*-plumbing.ts`", "a file five folders deep is in it"),
			crit("a rules file leaves `decidedBy` empty", "the gate refuses it"),
		];
		expect(planProblems(withCriteria(typed), {names: ["decidedBy"]})).toEqual([]);
		expect(planProblems(withCriteria(typed), null)).toHaveLength(1);
	});

	it("holds the job's fixture to the same names as its sentence", () => {
		const pinned = {
			...good,
			tasks: [{...task, job: {...job, fixture: "three runs of src/otel/fixture.ts"}}],
		};
		expect(planProblems(pinned, null)).toEqual([
			`Task 1 ("Read every clock value as epoch milliseconds"), its whole job ("${textOf(job)}") names code a user never meets: src/otel/fixture.ts (a path), fixture.ts (a file name). Name things the way a user meets them (a command, a flag, a config key, a published name), and put internal files and names in pointers.`,
		]);
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
		const blank = {...task.criteria[0]!, check: {how: "read" as const, what: " "}};
		expect(planProblems(withCriteria([blank]), null)).toEqual([
			`Task 1 ("Read every clock value as epoch milliseconds"), criterion 1 ("${textOf(blank)}"): its check does not say what it does.`,
		]);
	});
});

describe("the schema", () => {
	const read = reader(Plan);

	it("takes a whole plan, and refuses an ending or a check it does not know", () => {
		expect(Option.isSome(read(good))).toBe(true);
		expect(Option.isNone(read({...good, tasks: [{...task, ends: "merge"}]}))).toBe(true);
		const eyeball = {...task.criteria[0]!, check: {how: "eyeball", what: "x"}};
		expect(Option.isNone(read({...good, tasks: [{...task, criteria: [eyeball]}]}))).toBe(true);
	});

	it("cannot hold a criterion that serves no story, a task with no job, or a plan with no story", () => {
		const unlinked = {...task.criteria[0]!, serves: []};
		expect(Option.isNone(read({...good, tasks: [{...task, criteria: [unlinked]}]}))).toBe(true);
		expect(Option.isNone(read({...good, tasks: [{...task, job: {...job, serves: []}}]}))).toBe(
			true,
		);
		const {job: _, ...jobless} = task;
		expect(Option.isNone(read({...good, tasks: [jobless]}))).toBe(true);
		expect(Option.isNone(read({...good, stories: []}))).toBe(true);
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
		expect([...schema.required].sort()).toEqual([
			"exam",
			"gaps",
			"goal",
			"interface",
			"pointers",
			"properties",
			"questions",
			"stories",
			"summary",
			"tasks",
		]);
		expect(schema.additionalProperties).toBe(false);
		expect(Schema.decodeUnknownSync(Plan)(good)).toEqual(good);
	});

	it("says non-empty as minItems, never prefixItems: the agent's strict schema check refuses that keyword", () => {
		const text = JSON.stringify(jsonSchema(Plan));
		expect(text).not.toContain("prefixItems");
		// stories; a task's job and criteria serve; the goal's job and criteria serve.
		expect(text.match(/"minItems":1/g)).toHaveLength(5);
	});
});

describe("the view", () => {
	it("counts a plan's size, stories and the job included: the story's own words are 21", () => {
		expect(sizeOf(good)).toMatchObject({stories: 1, tasks: 1, criteria: 2});
		const bare = sizeOf({...good, stories: [{id: "s1", who: "", want: "", why: ""}]}).words;
		expect(sizeOf(good).words - bare).toBe(21);
	});

	it("shows the stories first, then each task with its whole job and every criterion's stories and check", () => {
		const view = planMarkdown(
			numbered({
				...good,
				questions: [{ask: "A new export?", options: ["yes", "no"], lean: "no", why: "smaller"}],
			}),
			"otel span timing (#367)",
		);
		expect(view).toContain("# Plan: otel span timing (#367)");
		expect(view).toContain("Size: 1 story, 1 task, 2 criteria,");
		expect(view.indexOf("## User stories")).toBeLessThan(view.indexOf("## Task 1"));
		expect(view).toContain(
			"- **s1**: As a host that traces runs, I want spans to start at the clock it gave, so that a trace lines up with the rest of its system.",
		);
		expect(view).toContain("## Task 1: Read every clock value as epoch milliseconds");
		expect(view).toContain("It ends in a pull request.");
		expect(view).toContain(
			`- [ ] \`c1 v1\` ${textOf(job)}\n  - **The whole job.** _Serves s1. Check (test): a test runs them and reads every span_  \n    _Fixture: ${job.fixture}_`,
		);
		expect(view).toContain(
			"- [ ] `c2 v1` When a run's clock starts at a value smaller than the time since the process started, the root span starts at exactly that clock value\n  - _Serves s1. Check (test): a test that does it and looks_",
		);
		expect(view).toContain("   - Lean: no");
		expect(view).toContain(
			"- `packages/tea/src/otel/index.ts`: every span start and end is set here",
		);
		expect(planMarkdown(numbered(good), "x")).toContain("## Open questions\n\nNone.");
		const ticked = {...good, pointers: [{at: "the `pnpm test` gate", why: "it fails"}]};
		expect(planMarkdown(numbered(ticked), "x")).toContain("- `` the `pnpm test` gate ``: it fails");
	});
});
