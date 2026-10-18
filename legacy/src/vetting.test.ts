import {execFileSync} from "node:child_process";
import {readFile, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {Workspace} from "./factory-services.ts";
import type {Issue, Snippet} from "./issue.ts";
import {checkoutToy, localWorkspace} from "./local.ts";
import {bareOf, nodeTests, TESTS_FILE, typesFor, VET_TSCONFIG, vitestTests} from "./tests.ts";
import {
	classify,
	classifySnippets,
	type SnippetVerdict,
	snippetResults,
	type TypeCheckError,
	type Vetted,
	vetProblems,
} from "./vetting.ts";

const issue = (criteria: Issue["criteria"]): Issue => ({
	id: "slugify",
	title: "slugify makes slugs",
	goal: "slugify turns a title into a URL slug",
	body: "",
	criteria,
	openDecision: null,
});

const example = (
	id: string,
	call: string,
	result: string,
	file = "slugify.js",
): Issue["criteria"][number] => ({
	kind: "example",
	id,
	rule: id,
	file,
	name: "slugify",
	uses: [],
	examples: [{call, result}],
});

const vet = (dir: string, draft: Issue) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* (yield* Workspace).vet(draft);
		}).pipe(Effect.provide(localWorkspace(dir, {test: ["node", "--test"]}))),
	);

const git = (dir: string, ...args: string[]) =>
	execFileSync("git", args, {cwd: dir, encoding: "utf8"});

describe("vetting a draft on today's code, in a fresh copy", () => {
	it("tells an example that fails from one that holds already and one that is broken", {
		timeout: 30_000,
	}, async () => {
		const toy = await checkoutToy("slugify");
		const draft = issue([
			example("lower", `slugify("Hello")`, `"hello"`),
			example("same", `slugify("abc")`, `"abc"`),
			example("throws", `slugify(undefined).length`, `0`),
		]);
		const before = git(toy.dir, "status", "--porcelain");

		const vetted = await vet(toy.dir, draft);

		expect(vetted.missing).toEqual([]);
		expect(vetted.examples.map((e) => [e.criterion, e.verdict])).toEqual([
			["lower", "fails"],
			["same", "holds_already"],
			["throws", "broken"],
		]);
		expect(vetted.examples[0]?.detail).toContain("'Hello' !== 'hello'");
		expect(vetted.examples[2]?.detail).toMatch(/^throws: TypeError: /);
		// The folder the builder works in is as it was: no test file, no worktree left behind.
		expect(git(toy.dir, "status", "--porcelain")).toBe(before);
		expect(git(toy.dir, "worktree", "list").trim().split("\n")).toHaveLength(1);
	});

	it("calls every example broken when the file does not load, and names a file that is not at HEAD", {
		timeout: 30_000,
	}, async () => {
		const toy = await checkoutToy("slugify");
		const gone = {
			...example("gone", `gone("a")`, `"a"`, "gone.js"),
			name: "gone",
		} as Issue["criteria"][number];
		const draft = issue([example("lower", `slugify("Hello")`, `"hello"`), gone]);

		const vetted = await vet(toy.dir, draft);

		expect(vetted.missing).toEqual([{criterion: "gone", file: "gone.js"}]);
		expect(vetted.examples.map((e) => e.verdict)).toEqual(["broken", "broken"]);
		expect(vetted.examples[0]?.detail).toMatch(/^did not run: .*gone\.js/);
	});

	it("needs no fresh copy for a draft with no examples", async () => {
		const toy = await checkoutToy("slugify");
		const draft = issue([
			{
				kind: "unchecked",
				id: "docs",
				rule: "The README says so",
				files: ["README.md"],
				about: "doc",
				why: "docs",
			},
		]);

		expect(await vet(toy.dir, draft)).toEqual({
			missing: [{criterion: "docs", file: "README.md"}],
			examples: [],
			snippets: [],
			tests: [],
		});
	});

	it("runs an existing test on today's code, and says whether it passes; a repo with no typecheck cannot check a snippet", {
		timeout: 30_000,
	}, async () => {
		const toy = await checkoutToy("slugify");
		await writeFile(
			join(toy.dir, "shape.test.js"),
			`import test from "node:test";\ntest("ok", () => {});\n`,
		);
		await writeFile(
			join(toy.dir, "red.test.js"),
			`import test from "node:test";\ntest("red", () => { throw new Error("red"); });\n`,
		);
		git(toy.dir, "add", "-A");
		git(toy.dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "tests");
		const draft = issue([
			{
				kind: "existing_test",
				id: "shape",
				rule: "The shape test passes",
				test: "shape.test.js",
				files: [],
			},
			{
				kind: "existing_test",
				id: "red",
				rule: "The red test passes",
				test: "red.test.js",
				files: [],
			},
			{
				kind: "existing_test",
				id: "gone",
				rule: "A test that is not there passes",
				test: "gone.test.js",
				files: [],
			},
			{
				kind: "type",
				id: "t",
				rule: "slugify takes a string",
				files: [],
				uses: [],
				snippets: [{expect: "compiles", today: "holds", code: "slugify;"}],
			},
		]);

		const vetted = await vet(toy.dir, draft);

		expect(vetted.missing).toEqual([{criterion: "gone", file: "gone.test.js"}]);
		expect(vetted.tests.map((t) => [t.criterion, t.verdict])).toEqual([
			["shape", "passes"],
			["red", "fails"],
		]);
		expect(vetted.tests[1]?.detail).toContain("red");
		expect(vetted.snippets).toEqual([
			{
				criterion: "t",
				snippet: 1,
				verdict: "broken",
				detail: "cannot be checked: this repo is not typechecked here",
			},
		]);
		// A failing existing test is fine; a snippet nothing can check is not.
		expect(vetProblems(draft, vetted)).toEqual([
			"Criterion gone names gone.test.js, which does not exist at HEAD. Name the file as it is in the repo.",
			"Snippet 1 of criterion t cannot be checked: this repo is not typechecked here. Fix it so only the change decides whether it holds.",
		]);
	});
});

/** A vetting with only these examples' verdicts. */
const ofExamples = (examples: Vetted["examples"], missing: Vetted["missing"] = []): Vetted => ({
	missing,
	examples,
	snippets: [],
	tests: [],
});

describe("what vetting tells the writer", () => {
	const draft = issue([
		example("lower", `slugify("Hello")`, `"hello"`),
		example("same", `slugify("abc")`, `"abc"`),
	]);
	const lower = {criterion: "lower", call: `slugify("Hello")`};
	const same = {criterion: "same", call: `slugify("abc")`};

	it("passes a draft whose every example fails and whose every file is there", () => {
		const vetted = ofExamples([
			{...lower, verdict: "fails", detail: "x"},
			{...same, verdict: "fails", detail: "y"},
		]);

		expect(vetProblems(draft, vetted)).toEqual([]);
	});

	it("sends back an example that holds already, one that is broken, and a file that is not there, each with what to do", () => {
		const vetted = ofExamples(
			[
				{
					...lower,
					verdict: "broken",
					detail: "does not typecheck: TS2345: Argument of type '{}' is not assignable",
				},
				{...same, verdict: "holds_already", detail: ""},
			],
			[{criterion: "lower", file: "slugify.ts"}],
		);
		const problems = vetProblems(draft, vetted);

		expect(problems).toHaveLength(4);
		expect(problems[0]).toBe(
			"Criterion lower names slugify.ts, which does not exist at HEAD. Name the file as it is in the repo.",
		);
		expect(problems[1]).toContain(
			"If that type error is the bug itself, the rule is about types: make it a type criterion, with a snippet that shows it",
		);
		expect(problems[2]).toContain("already holds on today's code");
		expect(problems[2]).toContain("make it a type criterion");
		expect(problems[3]).toBe(
			"Nothing fails on today's code: no example, no snippet marked to fail today, no existing test. So nothing shows what the change does.",
		);
	});

	it("sends back ids used twice, and an example that was never run", () => {
		const twice = issue([
			example("lower", `slugify("Hello")`, `"hello"`),
			example("lower", `slugify("A")`, `"a"`),
		]);
		const problems = vetProblems(twice, ofExamples([{...lower, verdict: "fails", detail: ""}]));

		expect(problems).toEqual([
			"Criterion id lower is used more than once. Give each criterion its own id.",
			'Example `slugify("A")` (criterion lower) was not run. Write it again.',
		]);
	});

	it("passes a draft that is all unchecked rules, about files that are there", () => {
		const unchecked = issue([
			{
				kind: "unchecked",
				id: "types",
				rule: "ctx is optional",
				files: ["src/a.ts"],
				about: "type",
				why: "types",
			},
		]);

		expect(vetProblems(unchecked, ofExamples([]))).toEqual([]);
	});
});

/** A type criterion with these snippets, importing `replay`. */
const typeRule = (id: string, snippets: readonly Snippet[]): Issue["criteria"][number] => ({
	kind: "type",
	id,
	rule: id,
	files: ["src/runtime-types.ts"],
	uses: [{name: "replay", file: "src/index.ts"}],
	snippets: snippets as [Snippet, ...Snippet[]],
});

const shows: Snippet = {expect: "compiles", today: "fails", code: "replay(pure, { msgs: [] });"};
const guard: Snippet = {
	expect: "rejects",
	today: "holds",
	code: "// @ts-expect-error ctx is required\nreplay(db, { msgs: [] });",
};

describe("what vetting tells the writer about type snippets and existing tests", () => {
	const verdict = (
		criterion: string,
		snippet: number,
		v: SnippetVerdict["verdict"],
		detail = "",
	): SnippetVerdict => ({
		criterion,
		snippet,
		verdict: v,
		detail,
	});
	const vetted = (snippets: readonly SnippetVerdict[], tests: Vetted["tests"] = []): Vetted => ({
		missing: [],
		examples: [],
		snippets,
		tests,
	});

	it("passes a snippet that shows the change failing today beside a guard that holds", () => {
		const draft = issue([typeRule("ctx", [shows, guard])]);

		expect(
			vetProblems(
				draft,
				vetted([
					verdict("ctx", 1, "fails", "does not compile: TS2345"),
					verdict("ctx", 2, "holds", "is rejected: TS2345"),
				]),
			),
		).toEqual([]);
	});

	it("sends back a guard that fails today and a change that holds already, each the right way round", () => {
		const draft = issue([typeRule("ctx", [shows, guard])]);
		const problems = vetProblems(
			draft,
			vetted([
				verdict("ctx", 1, "holds", "compiles"),
				verdict(
					"ctx",
					2,
					"fails",
					"has a marked line that compiles: TS2578: Unused '@ts-expect-error' directive.",
				),
			]),
		);

		expect(problems).toEqual([
			"Snippet 1 of criterion ctx is marked as failing today, but on today's code it already compiles, so it shows nothing the change does. If it is a limit the change must keep, mark it today: holds; otherwise leave it out.",
			"Snippet 2 of criterion ctx is marked as holding today, a guard, but on today's code it has a marked line that compiles: TS2578: Unused '@ts-expect-error' directive. If it shows the change, mark it today: fails; otherwise fix it.",
			"Nothing fails on today's code: no example, no snippet marked to fail today, no existing test. So nothing shows what the change does.",
		]);
	});

	it("sends back a broken snippet, one whose marks do not fit what it expects, and one never checked", () => {
		const marked: Snippet = {...shows, code: `// @ts-expect-error\n${shows.code}`};
		const unmarked: Snippet = {...guard, code: "replay(db, { msgs: [] });"};
		const draft = issue([typeRule("ctx", [shows, marked, unmarked]), typeRule("more", [shows])]);
		const problems = vetProblems(
			draft,
			vetted([
				verdict(
					"ctx",
					1,
					"broken",
					"does not typecheck for a reason no change fixes: TS2304: Cannot find name 'pure'.",
				),
			]),
		);

		expect(problems).toEqual([
			"Snippet 1 of criterion ctx does not typecheck for a reason no change fixes: TS2304: Cannot find name 'pure'. Fix it so only the change decides whether it holds.",
			"Snippet 2 of criterion ctx expects to compile, and marks a line with @ts-expect-error. Make it a rejects snippet, or take the mark out.",
			"Snippet 3 of criterion ctx expects a type error, and marks no line. Put `// @ts-expect-error` on the line above the one that must be rejected.",
			"Snippet 1 of criterion more was not checked. Write it again.",
			"Nothing fails on today's code: no example, no snippet marked to fail today, no existing test. So nothing shows what the change does.",
		]);
	});

	it("takes an existing test passing or failing today, but not one it cannot run, nor one not run at all", () => {
		const page: Issue["criteria"][number] & {kind: "existing_test"} = {
			kind: "existing_test",
			id: "page",
			rule: "The how-to runs",
			test: "src/docs/a.test.ts",
			files: [],
		};
		const other = {...page, id: "other", test: "packages/other/a.test.ts"};
		const draft = issue([typeRule("ctx", [shows]), page, other]);
		const ran = (verdict: Vetted["tests"][number]["verdict"], detail = "") => ({
			criterion: "page",
			test: page.test,
			verdict,
			detail,
		});
		const showing = [verdict("ctx", 1, "fails", "does not compile: TS2345")];

		expect(
			vetProblems(
				draft,
				vetted(showing, [ran("passes"), {...ran("passes"), criterion: "other", test: other.test}]),
			),
		).toEqual([]);
		expect(
			vetProblems(
				draft,
				vetted(showing, [
					ran("fails", "1 failed"),
					{...ran("passes"), criterion: "other", test: other.test},
				]),
			),
		).toEqual([]);
		expect(
			vetProblems(draft, vetted(showing, [ran("cannot_run", "it is outside the package")])),
		).toEqual([
			"Criterion page names the test src/docs/a.test.ts, which cannot be run here: it is outside the package. Name a test the lane can run, or make the rule unchecked.",
			"The test packages/other/a.test.ts (criterion other) was not run. Name it again.",
		]);
	});

	it("counts an existing test that fails today as showing the change", () => {
		const draft = issue([
			{kind: "existing_test", id: "page", rule: "The how-to runs", test: "a.test.js", files: []},
		]);

		expect(
			vetProblems(
				draft,
				vetted([], [{criterion: "page", test: "a.test.js", verdict: "fails", detail: ""}]),
			),
		).toEqual([]);
		expect(
			vetProblems(
				draft,
				vetted([], [{criterion: "page", test: "a.test.js", verdict: "passes", detail: ""}]),
			),
		).toHaveLength(1);
	});
});

describe("classifying type snippets", () => {
	const draft = issue([
		typeRule("ctx", [shows, guard]),
		typeRule("more", [{...guard, today: "fails"}]),
	]);
	const written = typesFor("src/f.test-d.ts")(draft);
	const lineOf = (text: string, from = 0) =>
		written.split("\n").findIndex((l, i) => i >= from && l.includes(text)) + 1;
	const firstCall = lineOf("replay(pure");
	const guardMark = lineOf("@ts-expect-error");
	const moreMark = lineOf("@ts-expect-error", guardMark);
	const run = (errors: readonly TypeCheckError[], bare: readonly TypeCheckError[] = []) =>
		classifySnippets(draft, {written, errors, bare}).map((s) => [
			s.criterion,
			s.snippet,
			s.verdict,
			s.detail,
		]);

	it("tells a snippet that compiles from one that does not, and a marked line that is rejected from one that compiles", () => {
		const rejected = {line: guardMark + 1, message: "TS2345: Property 'ctx' is missing."};

		expect(
			run(
				[
					{line: firstCall, message: "TS2345: Property 'ctx' is missing."},
					{line: moreMark, message: "TS2578: Unused '@ts-expect-error' directive."},
				],
				[rejected],
			),
		).toEqual([
			["ctx", 1, "fails", "does not compile: TS2345: Property 'ctx' is missing."],
			["ctx", 2, "holds", "is rejected: TS2345: Property 'ctx' is missing."],
			[
				"more",
				1,
				"fails",
				"has a marked line that compiles: TS2578: Unused '@ts-expect-error' directive.",
			],
		]);
		expect(run([], [rejected]).map(([, , v]) => v)).toEqual(["holds", "holds", "holds"]);
	});

	it("calls broken what no change fixes: a name never imported, one never used, an error outside a marked line, a rejection for a missing name, bad imports", () => {
		expect(run([{line: firstCall, message: "TS2304: Cannot find name 'pure'."}])[0]?.[2]).toBe(
			"broken",
		);
		expect(
			run([
				{line: firstCall, message: "TS6133: 'x' is declared but its value is never read."},
			])[0]?.[2],
		).toBe("broken");
		expect(run([{line: guardMark - 1, message: "TS2345: something else"}])[1]?.[2]).toBe("broken");
		expect(
			run([], [{line: guardMark + 1, message: "TS2304: Cannot find name 'db'."}])[1]?.[2],
		).toBe("broken");
		expect(
			run([{line: 3, message: "TS2305: Module has no exported member 'replay'."}]).map(
				([, , v]) => v,
			),
		).toEqual(["broken", "broken", "broken"]);
	});

	it("reads, for the lane, which snippets hold as written, by their checks' names", () => {
		expect(snippetResults(draft, written, [{line: firstCall, message: "TS2345: x"}])).toEqual({
			passing: ["ctx: snippet 2", "more: snippet 1"],
			failing: ["ctx: snippet 1"],
		});
		expect(snippetResults(draft, written, [{line: 3, message: "TS2305: x"}]).failing).toHaveLength(
			3,
		);
	});
});

describe("the type snippets' file", () => {
	it("imports what the snippets use once, relative to it, and gives each snippet a block of its own under its name", () => {
		const draft = issue([typeRule("ctx", [shows, guard]), typeRule("more", [shows])]);
		const written = typesFor("packages/tea/src/fabrika-1.test-d.ts")({
			...draft,
			criteria: draft.criteria.map((c) =>
				c.kind === "type" ? {...c, uses: [{name: "replay", file: "packages/tea/src/index.ts"}]} : c,
			) as Issue["criteria"],
		});

		expect(written).toBe(
			[
				`// The issue's type criteria, written from its data. Every block must typecheck as it is:`,
				`// a "compiles" block compiles, and in a "rejects" block each line under a mark is a type error.`,
				`import { replay } from "./index";`,
				`export {};`,
				``,
				`// "ctx: snippet 1" compiles`,
				`{`,
				`  replay(pure, { msgs: [] });`,
				`}`,
				``,
				`// "ctx: snippet 2" rejects`,
				`{`,
				`  // @ts-expect-error ctx is required`,
				`  replay(db, { msgs: [] });`,
				`}`,
				``,
				`// "more: snippet 1" compiles`,
				`{`,
				`  replay(pure, { msgs: [] });`,
				`}`,
				``,
			].join("\n"),
		);
	});

	it("has a bare copy beside it, line for line, its marks plain comments", () => {
		const draft = issue([typeRule("ctx", [guard])]);
		const written = typesFor("src/f.test-d.ts")(draft);
		const bare = typesFor(bareOf("src/f.test-d.ts"))(draft, true);

		expect(bareOf("src/f.test-d.ts")).toBe("src/f.bare.test-d.ts");
		expect(bare.split("\n")).toHaveLength(written.split("\n").length);
		expect(bare).toContain("  // rejected here: ctx is required");
		expect(bare).not.toContain("@ts-expect-error");
	});
});

describe("classifying a run", () => {
	const draft = issue([example("a", "f(1)", "1"), example("b", "f(2)", "2")]);
	const written = [
		'import { f } from "./f";',
		"",
		'test("a: f(1)", () => {',
		"  expect(f(1)).toStrictEqual(1);",
		"});",
		"",
		'test("b: f(2)", () => {',
		"  expect(f(2)).toStrictEqual(2);",
		"});",
	].join("\n");

	it("pins a type error to the example whose lines hold it, and an error in the imports to all of them", () => {
		const outcomes = {
			tests: new Map([
				["a: f(1)", {kind: "passed" as const}],
				["b: f(2)", {kind: "passed" as const}],
			]),
			loadError: null,
		};

		expect(
			classify(draft, written, outcomes, [{line: 8, message: "TS2554: Expected 0 arguments"}]).map(
				(e) => e.verdict,
			),
		).toEqual(["holds_already", "broken"]);
		expect(
			classify(draft, written, outcomes, [{line: 1, message: "TS2305: no export f"}]).map(
				(e) => e.verdict,
			),
		).toEqual(["broken", "broken"]);
	});
});

describe("a flavour reading its own report back", () => {
	it("node:test: an assertion is a failure, any other error is not", () => {
		const report = [
			"TAP version 13",
			"ok 1 - a: f(1)",
			"not ok 2 - b: f(3)",
			"  ---",
			"  error: |-",
			"    Expected values to be strictly deep-equal:",
			"    3 !== 4",
			"  code: 'ERR_ASSERTION'",
			"  name: 'AssertionError'",
			"  ...",
			"not ok 3 - c: f(2)",
			"  ---",
			"  error: 'bad x'",
			"  name: 'TypeError'",
			"  ...",
		].join("\n");
		const {tests, loadError} = nodeTests.outcomes(report);

		expect(Object.fromEntries(tests)).toEqual({
			"a: f(1)": {kind: "passed"},
			"b: f(3)": {
				kind: "failed",
				assertion: true,
				error: "Expected values to be strictly deep-equal: 3 !== 4",
			},
			"c: f(2)": {kind: "failed", assertion: false, error: "TypeError: bad x"},
		});
		expect(loadError).toBeNull();
		expect(
			nodeTests.outcomes(
				`# SyntaxError: The requested module './m.js' does not provide an export named 'g'\nnot ok 1 - ${TESTS_FILE}`,
			).loadError,
		).toBe("SyntaxError: The requested module './m.js' does not provide an export named 'g'");
	});

	it("vitest: reads the issue's tests out of a whole package's tap-flat report, and a file that did not load", async () => {
		const flavour = vitestTests({package: "packages/tea", file: "src/fabrika-scratch.test.ts"});
		const report = await readFile(
			join(import.meta.dirname, "..", "fixtures", "reports", "vitest-tap-flat.txt"),
			"utf8",
		);
		const failed = await readFile(
			join(import.meta.dirname, "..", "fixtures", "reports", "vitest-load-failure.txt"),
			"utf8",
		);
		const {tests} = flavour.outcomes(report);

		expect(tests.get("at-reads: at([1, 2], 0)")).toEqual({kind: "passed"});
		expect(tests.get("at-reads: at([1, 2], 5)")).toEqual({
			kind: "failed",
			assertion: true,
			error: "expected undefined to strictly equal 2",
		});
		expect(
			tests.has(
				"acceptedTypes — transitions form > returns the refusing state's own row keys, not the table-wide union",
			),
		).toBe(false);
		expect(flavour.outcomes(failed)).toEqual({
			tests: new Map(),
			loadError:
				"Cannot find module './does-not-exist' imported from /work/demlik/packages/tea/src/fabrika-scratch.test.ts",
		});
	});

	it("vitest: typechecks the issue's files alone with the package's own settings, and reads back each one's errors", () => {
		const flavour = vitestTests({
			package: "packages/tea",
			file: "src/fabrika-558.test.ts",
			tsconfig: "tsconfig.test.json",
		});
		const check = flavour.typecheck;
		if (check === undefined) throw new Error("expected a typecheck");
		const tests = "packages/tea/src/fabrika-558.test.ts";

		expect(check.snippets).toBe("packages/tea/src/fabrika-558.test-d.ts");
		expect(
			JSON.parse(check.setup([tests, check.snippets])[`packages/tea/${VET_TSCONFIG}`] ?? ""),
		).toEqual({
			extends: "./tsconfig.test.json",
			compilerOptions: {noEmit: true},
			files: ["src/fabrika-558.test.ts", "src/fabrika-558.test-d.ts"],
			include: [],
		});
		expect(check.run).toEqual(["pnpm", "--dir", "packages/tea", "exec", "tsc", "-p", VET_TSCONFIG]);
		const output = [
			"src/fabrika-558.test.ts(6,10): error TS2345: Argument of type '{ msgs: never[]; }' is not assignable to parameter.",
			"  Property 'ctx' is missing.",
			"src/fabrika-558.test-d.ts(9,3): error TS2578: Unused '@ts-expect-error' directive.",
			"src/runtime-types.ts(12,1): error TS1005: the repo's own",
		].join("\n");
		expect(check.read(output, tests)).toEqual([
			{
				line: 6,
				message: "TS2345: Argument of type '{ msgs: never[]; }' is not assignable to parameter.",
			},
		]);
		expect(check.read(output, check.snippets)).toEqual([
			{line: 9, message: "TS2578: Unused '@ts-expect-error' directive."},
		]);
		expect(vitestTests({package: "packages/tea", file: "src/x.test.ts"}).typecheck).toBeUndefined();
	});

	it("vitest: runs an existing test of its package alone, from the package, and no test outside it", () => {
		const flavour = vitestTests({package: "packages/tea", file: "src/fabrika-558.test.ts"});

		expect(flavour.runTest("packages/tea/src/docs/how-to/replay-in-a-test.test.ts")).toEqual([
			"pnpm",
			"--dir",
			"packages/tea",
			"exec",
			"vitest",
			"run",
			"--reporter=tap-flat",
			"src/docs/how-to/replay-in-a-test.test.ts",
		]);
		expect(flavour.runTest("packages/other/src/a.test.ts")).toBeNull();
	});

	it("vitest: a package at the repo's root runs any test, from the root", () => {
		const flavour = vitestTests({package: ".", file: "src/fabrika-296.test.ts"});

		expect(flavour.file).toBe("src/fabrika-296.test.ts");
		expect(flavour.runTest("src/docs/how-to/hand-wire-resilient-call.test.ts")).toEqual([
			"pnpm",
			"--dir",
			".",
			"exec",
			"vitest",
			"run",
			"--reporter=tap-flat",
			"src/docs/how-to/hand-wire-resilient-call.test.ts",
		]);
	});
});
