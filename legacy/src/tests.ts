import {posix} from "node:path";
import {
	type ExampleCriterion,
	type Import,
	type Issue,
	snippetName,
	type TypeCriterion,
	testName,
} from "./issue";
import type {TestOutcome, TestOutcomes, TypeCheckError} from "./vetting";

/** A command as its program and arguments, run from the repo root. */
export type Command = readonly [string, ...string[]];

/** The names of the issue's tests that passed and that failed in one run. */
export interface TestNames {
	readonly passing: string[];
	readonly failing: string[];
}

/**
 * How a repo's issue tests are written and run: where the file goes, what it
 * says, the command that runs it alone, and how a report reads back. A
 * property of the repo, so a toy and a monorepo each get their own.
 */
export interface TestFlavour {
	/** Where the issue's tests are written, relative to the repo root. The builder may read it and never change it. */
	readonly file: string;
	/** The file's text: one test per example, named by {@link testName}, asserting exactly the example. */
	readonly write: (issue: Issue) => string;
	/** The command that runs only {@link TestFlavour.file}. */
	readonly run: Command;
	/** The issue's tests that passed and failed, out of a report of `run` or of the repo's whole test command. */
	readonly read: (output: string) => TestNames;
	/** The report cut to what a reader needs: it goes to the builder and to the failure reader. */
	readonly brief: (output: string) => string;
	/** Each of the issue's tests in a report of `run`, with whether a failure was its assertion; and why the file did not load, if it did not. */
	readonly outcomes: (output: string) => TestOutcomes;
	/**
	 * How to typecheck the issue's own files alone, when the repo is typed:
	 * vetting checks the examples' file with it, and the type snippets' file is
	 * checked with it everywhere. Without one, a type criterion cannot be checked.
	 */
	readonly typecheck?: TypeCheck;
	/** The command that runs one test file of the repo alone, for an existing-test criterion; `null` for a file it cannot run. */
	readonly runTest: (file: string) => Command | null;
}

/** Typechecking some of the issue's own files, and nothing else, with the repo's settings. */
export interface TypeCheck {
	/** Where the issue's type snippets are written, relative to the repo root: a `.test-d.ts` beside its tests. Locked like them. */
	readonly snippets: string;
	/** Files to write before `run` and take out after, by path from the repo root, so that it checks only `files`: a tsconfig, say. */
	readonly setup: (files: readonly string[]) => Readonly<Record<string, string>>;
	readonly run: Command;
	/** The type errors in `file` (from the repo root), by line. Errors elsewhere are the repo's own, and not read. */
	readonly read: (output: string, file: string) => readonly TypeCheckError[];
}

/**
 * The failure block under a `not ok` line of a TAP report, as node:test and
 * vitest both write it: the error's class name, and its message.
 */
function failureAt(
	lines: readonly string[],
	from: number,
): {readonly name: string | null; readonly message: string} {
	const block: string[] = [];
	for (let i = from + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (/^(ok|not ok) \d+ |^# Subtest|^1\.\.|^TAP version/.test(line)) break;
		block.push(line);
	}
	const name =
		block.map((l) => /^\s*name:\s*['"]?([\w.$]+)/.exec(l)?.[1]).find((n) => n !== undefined) ??
		null;
	const at = block.findIndex((l) => /^\s*(?:message|error):\s*\S/.test(l));
	if (at === -1) return {name, message: ""};
	const value = (block[at] ?? "").replace(/^\s*(?:message|error):\s*/, "");
	if (value !== "|-" && value !== "|") return {name, message: unquote(value)};
	const indent = (l: string) => l.length - l.trimStart().length;
	const own = indent(block[at] ?? "");
	const rest: string[] = [];
	for (const l of block.slice(at + 1)) {
		if (l.trim() !== "" && indent(l) <= own) break;
		rest.push(l.trim());
	}
	return {name, message: rest.filter((l) => l !== "").join(" ")};
}

const unquote = (value: string) => {
	const quoted = /^(['"])(.*)\1$/.exec(value.trim());
	return quoted === null ? value.trim() : (quoted[2] ?? "").replace(/\\"/g, '"');
};

/** A failure is the test's own assertion when the error is an assertion error: node's and chai's are both named so. */
const outcomeOf = (failure: {
	readonly name: string | null;
	readonly message: string;
}): TestOutcome => ({
	kind: "failed",
	assertion: failure.name === "AssertionError",
	error:
		failure.name === null || failure.name === "AssertionError"
			? failure.message
			: `${failure.name}: ${failure.message}`,
});

/** The examples as tests, each name once. */
const testsOf = (issue: Issue) => {
	const examples = issue.criteria.filter((c): c is ExampleCriterion => c.kind === "example");
	const seen = new Set<string>();
	const tests = examples.flatMap((c) =>
		c.examples.flatMap((e) => {
			const name = testName(c, e);
			if (seen.has(name)) return [];
			seen.add(name);
			return [{name, call: e.call, result: e.result}];
		}),
	);
	return {imports: examples.flatMap((c) => [{name: c.name, file: c.file}, ...c.uses]), tests};
};

/** Every file imported from, with the names imported from it, each once. */
const importsOf = (imports: readonly Import[]) => {
	const names = new Map<string, Set<string>>();
	for (const {name, file} of imports) names.set(file, (names.get(file) ?? new Set()).add(name));
	return [...names];
};

/** A `@ts-expect-error` comment: the line under it must be a type error. */
const EXPECT_ERROR = /\/\/\s*@ts-expect-error\b/;

/** Whether a snippet's line marks the next one as a type error. */
export const marksError = (line: string) => EXPECT_ERROR.test(line);

/**
 * The issue's type snippets as one TypeScript file, written to `file` (from
 * the repo root): what they use is imported once on top, relative to it, and
 * each snippet is a block of its own under a line naming it, so what one
 * declares never meets another's. `bare` writes every `@ts-expect-error` as a
 * plain comment, line for line, so the error it hid shows: vetting reads from
 * that copy why a rejected line is rejected.
 */
export const typesFor =
	(file: string) =>
	(issue: Issue, bare = false): string => {
		const criteria = issue.criteria.filter((c): c is TypeCriterion => c.kind === "type");
		const indent = (line: string) =>
			line === "" ? line : `  ${bare ? line.replace(EXPECT_ERROR, "// rejected here:") : line}`;
		return [
			`// The issue's type criteria, written from its data. Every block must typecheck as it is:`,
			`// a "compiles" block compiles, and in a "rejects" block each line under a mark is a type error.`,
			...importsOf(criteria.flatMap((c) => c.uses)).map(
				([from, imported]) =>
					`import { ${[...imported].join(", ")} } from ${JSON.stringify(importPath(file, from))};`,
			),
			`export {};`,
			``,
			...criteria.flatMap((c) =>
				c.snippets.flatMap((s, i) => [
					`// ${JSON.stringify(snippetName(c, i))} ${s.expect}`,
					`{`,
					...s.code.split("\n").map(indent),
					`}`,
					``,
				]),
			),
		].join("\n");
	};

/** The bare copy of a snippets file, beside it: `a.test-d.ts` is `a.bare.test-d.ts`. */
export const bareOf = (file: string) => file.replace(/(\.test-d)?\.tsx?$/, ".bare$&");

/** The file a toy's examples are written to: beside the toy's code. */
export const TESTS_FILE = "criteria.test.js";

/**
 * A node:test file with one test per example, named by {@link testName}. Code
 * writes it from the issue's data, so what it asserts is exactly the example.
 */
export function testsFor(issue: Issue): string {
	const {imports, tests} = testsOf(issue);
	return [
		`import assert from "node:assert/strict";`,
		`import test from "node:test";`,
		...importsOf(imports).map(
			([file, imported]) => `import { ${[...imported].join(", ")} } from "./${file}";`,
		),
		``,
		...tests.map(
			({name, call, result}) =>
				`test(${JSON.stringify(name)}, () => {\n  assert.deepStrictEqual(${call}, ${result});\n});\n`,
		),
	].join("\n");
}

/** The names of the tests with one outcome, out of a TAP report such as `node --test` prints. */
const tapNames = (outcome: "ok" | "not ok", output: string): string[] =>
	[...output.matchAll(new RegExp(`^${outcome} \\d+ - (.+)$`, "gm"))].flatMap((match) =>
		match[1] === undefined ? [] : [match[1]],
	);

/**
 * Each test in a `node --test` TAP report. A file that does not load is a
 * `not ok` named for the file, with node's own error printed above it as `#`
 * lines; the first of those that names an error is why.
 */
function nodeOutcomes(output: string, file: string): TestOutcomes {
	const lines = output.split("\n");
	const tests = new Map<string, TestOutcome>();
	lines.forEach((line, i) => {
		const match = /^(ok|not ok) \d+ - (.+)$/.exec(line);
		if (match === null || match[2] === undefined || match[2] === file) return;
		tests.set(match[2], match[1] === "ok" ? {kind: "passed"} : outcomeOf(failureAt(lines, i)));
	});
	const loadError =
		lines.map((l) => /^#\s*(\w*Error\b.*)$/.exec(l)?.[1]).find((e) => e !== undefined) ?? null;
	return {tests, loadError};
}

/** A toy's tests: node:test beside the code, run with `node --test`. */
export const nodeTests: TestFlavour = {
	file: TESTS_FILE,
	write: testsFor,
	run: ["node", "--test", TESTS_FILE],
	read: (output) => ({passing: tapNames("ok", output), failing: tapNames("not ok", output)}),
	brief: (output) => output,
	outcomes: (output) => nodeOutcomes(output, TESTS_FILE),
	runTest: (file) => ["node", "--test", file],
};

/** The vitest reporter the vitest flavour reads: one TAP line per test, `<file> > <name>`. */
export const VITEST_REPORTER = "tap-flat";

/**
 * A module path the way a TypeScript repo imports it: relative to the
 * importing file, starting `./` or `../`, with no `.ts` or `.tsx`, which
 * vitest's and tsc's resolvers both fill back in.
 */
export const importPath = (from: string, to: string): string => {
	const relative = posix.relative(posix.dirname(from), to).replace(/\.tsx?$/, "");
	return relative.startsWith(".") ? relative : `./${relative}`;
};

/**
 * A vitest file with one test per example, named by {@link testName}.
 * `toStrictEqual` is `assert.deepStrictEqual`'s match: an `undefined`
 * property, an array hole and a class instance against a plain object all
 * count, and `-0` is not `0`. `file` is where it is written, relative to the
 * repo root as the criteria's files are, so each import is relative to it.
 */
export const vitestTestsFor =
	(file: string) =>
	(issue: Issue): string => {
		const {imports, tests} = testsOf(issue);
		return [
			`import { expect, test } from "vitest";`,
			...importsOf(imports).map(
				([from, imported]) =>
					`import { ${[...imported].join(", ")} } from ${JSON.stringify(importPath(file, from))};`,
			),
			``,
			...tests.map(
				({name, call, result}) =>
					`test(${JSON.stringify(name)}, () => {\n  expect(${call}).toStrictEqual(${result});\n});\n`,
			),
		].join("\n");
	};

/**
 * One line of vitest's `tap-flat` report: `ok 3 - src/a.test.ts > name # time=1.20ms`.
 * vitest escapes `\` and `#` in the name and turns a newline into a space, so
 * the first unescaped ` # ` starts the comment: the time, SKIP or TODO.
 */
const TAP_FLAT = /^(ok|not ok) \d+ - (.*?)(?: # (?:time=\S+|SKIP|TODO))?$/;

/** One `tap-flat` line as its outcome, the test file it names, and the test's name. */
function tapFlatLine(text: string) {
	const match = TAP_FLAT.exec(text);
	if (match === null || match[1] === undefined || match[2] === undefined) return null;
	const outcome = match[1] as "ok" | "not ok";
	const cut = match[2].indexOf(" > ");
	// A file with no test in it, such as one that failed to load, is a line of its own with no name.
	const file = cut === -1 ? match[2] : match[2].slice(0, cut);
	const name = cut === -1 ? null : match[2].slice(cut + 3).replace(/\\([\\#])/g, "$1");
	return {outcome, file, name};
}

/** The tsconfig written beside a package's own while the issue's files are typechecked, holding only them. */
export const VET_TSCONFIG = "tsconfig.fabrika-vet.json";

/** One `tsc` error line: `src/a.test.ts(12,5): error TS2345: Argument of type…`. */
const TSC_ERROR = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;

/** Where the type snippets go beside an issue's test file: `src/a.test.ts` gets `src/a.test-d.ts`. */
export const snippetsBeside = (file: string) => `${file.replace(/\.test\.tsx?$/, "")}.test-d.ts`;

/**
 * Typechecking some of the issue's files alone, with the package's own
 * settings: a tsconfig that extends `tsconfig` (the one the package checks its
 * tests with) and names only them. `tsc` still reads what they import, and
 * its errors there are the repo's own, so only the asked file's are read back.
 * `snippets` is where the type snippets go, inside the package.
 */
function vitestTypecheck(options: {
	readonly package: string;
	readonly snippets: string;
	readonly tsconfig: string;
}): TypeCheck {
	const inPackage = (file: string) => posix.relative(options.package, file);
	return {
		snippets: posix.join(options.package, options.snippets),
		setup: (files) => {
			const config = {
				extends: `./${options.tsconfig}`,
				compilerOptions: {noEmit: true},
				files: files.map(inPackage),
				include: [],
			};
			return {[posix.join(options.package, VET_TSCONFIG)]: `${JSON.stringify(config, null, 2)}\n`};
		},
		run: ["pnpm", "--dir", options.package, "exec", "tsc", "-p", VET_TSCONFIG],
		read: (output, file) =>
			output.split("\n").flatMap((text) => {
				const match = TSC_ERROR.exec(text.trim());
				if (match === null || posix.normalize(match[1] ?? "") !== posix.normalize(inPackage(file)))
					return [];
				return [{line: Number(match[2]), message: `${match[3]}: ${match[4]}`}];
			}),
	};
}

/**
 * The issue's tests in one package of a monorepo, run by vitest from that
 * package's folder. `package` is the folder and `file` the test file inside
 * it, as vitest names it in its report: `packages/tea` and `src/criteria.test.ts`.
 * The repo's whole test command must report with {@link VITEST_REPORTER} too.
 * `tsconfig`, when given, is the package's tsconfig for its tests: vetting
 * typechecks the file with it, and the type snippets go in a `.test-d.ts`
 * beside the file, checked with it too. An existing test it can run is one in
 * the package.
 */
export function vitestTests(options: {
	readonly package: string;
	readonly file: string;
	readonly tsconfig?: string;
}): TestFlavour {
	const file = posix.join(options.package, options.file);
	const lines = (output: string) =>
		output.split("\n").map((text) => ({text, line: tapFlatLine(text)}));
	const names = (outcome: "ok" | "not ok", output: string) =>
		lines(output).flatMap(({line}) =>
			line !== null && line.file === options.file && line.outcome === outcome && line.name !== null
				? [line.name]
				: [],
		);
	const outcomes = (output: string): TestOutcomes => {
		const all = output.split("\n");
		const tests = new Map<string, TestOutcome>();
		let loadError: string | null = null;
		all.forEach((text, i) => {
			const line = tapFlatLine(text);
			if (line === null || line.file !== options.file) return;
			if (line.name === null) {
				if (line.outcome === "not ok")
					loadError = failureAt(all, i).message || "the file did not load";
				return;
			}
			tests.set(line.name, line.outcome === "ok" ? {kind: "passed"} : outcomeOf(failureAt(all, i)));
		});
		return {tests, loadError};
	};
	const vitest = (inPackage: string): Command => [
		"pnpm",
		"--dir",
		options.package,
		"exec",
		"vitest",
		"run",
		`--reporter=${VITEST_REPORTER}`,
		inPackage,
	];
	return {
		outcomes,
		...(options.tsconfig === undefined
			? {}
			: {
					typecheck: vitestTypecheck({
						package: options.package,
						snippets: snippetsBeside(options.file),
						tsconfig: options.tsconfig,
					}),
				}),
		file,
		write: vitestTestsFor(file),
		run: vitest(options.file),
		// A package at the repo's root (".") holds every test in the repo.
		runTest: (test) =>
			options.package === "." || test.startsWith(`${options.package}/`)
				? vitest(posix.relative(options.package, test))
				: null,
		read: (output) => ({passing: names("ok", output), failing: names("not ok", output)}),
		// A whole package's run is thousands of passing lines that say nothing about
		// the change: keep every failure and the issue's own tests, and count the rest.
		brief: (output) => {
			const all = lines(output);
			const kept = all.filter(
				({line}) => line === null || line.outcome === "not ok" || line.file === options.file,
			);
			const left = all.length - kept.length;
			return left === 0
				? output
				: [...kept.map(({text}) => text), `# ${left} passing tests of other files left out`].join(
						"\n",
					);
		},
	};
}
