import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {type Issue, testNames} from "./issue.ts";
import {importPath, nodeTests, testsFor, vitestTests} from "./tests.ts";

const report = (name: string) =>
	readFile(join(import.meta.dirname, "..", "fixtures", "reports", name), "utf8");

/** The examples the captured reports ran: five calls to tea's `at`, one of them wrong. */
const issue: Issue = {
	id: "scratch",
	title: "at reads an index",
	goal: "at reads an index",
	body: "",
	criteria: [
		{
			kind: "example",
			id: "at-reads",
			rule: "at reads an index",
			file: "packages/tea/src/at.ts",
			name: "at",
			uses: [],
			examples: [
				{call: "at([1, 2], 0)", result: "1"},
				{call: "at([1, 2], 5)", result: "2"},
				{call: `at(["#a"], 0)`, result: `"#a"`},
				{call: `at(["a\\\\b"], 0)`, result: `"a\\\\b"`},
				{call: "[at([3], 0)].filter((x) => x !== undefined && x > 2)", result: "[3]"},
			],
		},
	],
	openDecision: null,
};

/** A call that builds the value it replays with the library's own constructor, as the library's tests do. */
const replayed: Issue = {
	...issue,
	criteria: [
		{
			kind: "example",
			id: "replays",
			rule: "replay folds every message",
			file: "packages/tea/src/runtime-types.ts",
			name: "replay",
			uses: [{name: "defineMachine", file: "packages/tea/src/index.ts"}],
			examples: [
				{
					call: "replay(defineMachine({ init: () => [0, []], update: {} }), { msgs: [] }).state",
					result: "0",
				},
			],
		},
		{
			kind: "example",
			id: "replays-again",
			rule: "replay is deterministic",
			file: "packages/tea/src/runtime-types.ts",
			name: "replay",
			uses: [
				{name: "defineMachine", file: "packages/tea/src/index.ts"},
				{name: "Cmd", file: "packages/tea/src/index.ts"},
			],
			examples: [
				{
					call: "replay(defineMachine({ init: () => [1, []], update: {} }), { msgs: [] }).state",
					result: "1",
				},
			],
		},
	],
};

describe("the names a call uses", () => {
	it("are imported beside the criterion's own, once each, in both flavours", () => {
		const vitest = tea.write(replayed);
		const node = testsFor(replayed);

		expect(vitest).toContain(`import { replay } from "./runtime-types";`);
		expect(vitest).toContain(`import { defineMachine, Cmd } from "./index";`);
		expect(vitest.match(/^import .*defineMachine/gm)).toHaveLength(1);
		expect(node).toContain(`import { replay } from "./packages/tea/src/runtime-types.ts";`);
		expect(node).toContain(`import { defineMachine, Cmd } from "./packages/tea/src/index.ts";`);
	});

	it("import the criterion's own name once when a call lists it again", () => {
		const again: Issue = {
			...issue,
			criteria: [
				{
					kind: "example",
					id: "at-again",
					rule: "at reads an index",
					file: "packages/tea/src/at.ts",
					name: "at",
					uses: [{name: "at", file: "packages/tea/src/at.ts"}],
					examples: [{call: "at([1], 0)", result: "1"}],
				},
			],
		};

		expect(tea.write(again)).toContain(`import { at } from "./at";\n`);
	});
});

const tea = vitestTests({package: "packages/tea", file: "src/fabrika-scratch.test.ts"});

describe("the vitest flavour", () => {
	it("writes one strict test per example, importing relative to where the file lives", () => {
		const text = tea.write(issue);

		expect(tea.file).toBe("packages/tea/src/fabrika-scratch.test.ts");
		expect(text).toContain(`import { expect, test } from "vitest";`);
		expect(text).toContain(`import { at } from "./at";`);
		expect(text).toContain(
			`test("at-reads: at([1, 2], 5)", () => {\n  expect(at([1, 2], 5)).toStrictEqual(2);\n});`,
		);
		expect(text.match(/^test\(/gm)).toHaveLength(testNames(issue).length);
	});

	it("runs its own file alone, from the package, with the reporter it reads", () => {
		expect(tea.run).toEqual([
			"pnpm",
			"--dir",
			"packages/tea",
			"exec",
			"vitest",
			"run",
			"--reporter=tap-flat",
			"src/fabrika-scratch.test.ts",
		]);
	});

	it("reads every example's name back out of a real package run, escapes and ` > ` included", async () => {
		const names = tea.read(await report("vitest-tap-flat.txt"));

		expect(names.failing).toEqual(["at-reads: at([1, 2], 5)"]);
		expect([...names.passing, ...names.failing].sort()).toEqual([...testNames(issue)].sort());
	});

	it("reads a file that failed to load as no test passing or failing", async () => {
		expect(tea.read(await report("vitest-load-failure.txt"))).toEqual({passing: [], failing: []});
	});

	it("cuts a package run to the failures and the issue's own tests, and says what it left out", async () => {
		const brief = tea.brief(await report("vitest-tap-flat.txt"));

		expect(brief).toContain("not ok 382 - src/fabrika-scratch.test.ts > at-reads: at([1, 2], 5)");
		expect(brief).toContain(`message: "expected undefined to strictly equal 2"`);
		expect(brief).toContain("ok 385 - src/fabrika-scratch.test.ts");
		expect(brief).toContain("> tsc --noEmit -p tsconfig.test.json");
		expect(brief).not.toContain("src/fenced-store.test.ts");
		expect(brief).toContain("# 8 passing tests of other files left out");
		// What it keeps still reads the same.
		expect(tea.read(brief)).toEqual(tea.read(await report("vitest-tap-flat.txt")));
	});

	it("leaves a report with nothing to cut as it is", async () => {
		const failed = await report("vitest-load-failure.txt");
		expect(tea.brief(failed)).toBe(failed);
	});
});

describe("an import path", () => {
	it("is relative to the importing file, with no .ts or .tsx", () => {
		expect(importPath("packages/tea/src/x.test.ts", "packages/tea/src/at.ts")).toBe("./at");
		expect(importPath("packages/tea/src/x.test.ts", "packages/tea/src/testing/index.ts")).toBe(
			"./testing/index",
		);
		expect(importPath("packages/tea/src/x.test.ts", "packages/tea/scripts/run.mjs")).toBe(
			"../scripts/run.mjs",
		);
		expect(importPath("packages/tea/src/x.test.ts", "packages/tea/src/react/view.tsx")).toBe(
			"./react/view",
		);
	});
});

describe("the node flavour", () => {
	it("is a toy's node:test file beside its code, as before", () => {
		expect(nodeTests.file).toBe("criteria.test.js");
		expect(nodeTests.write).toBe(testsFor);
		expect(nodeTests.run).toEqual(["node", "--test", "criteria.test.js"]);
	});

	it("reads node's TAP names and keeps the whole report", () => {
		const output =
			'TAP version 13\nok 1 - lower: slugify("Hi")\n  ---\nnot ok 2 - dashes: slugify("a b")\n1..2\n';

		expect(nodeTests.read(output)).toEqual({
			passing: [`lower: slugify("Hi")`],
			failing: [`dashes: slugify("a b")`],
		});
		expect(nodeTests.brief(output)).toBe(output);
	});
});
