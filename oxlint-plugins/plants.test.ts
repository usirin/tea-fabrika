// The lint rules are the exam, so each one is seen to fail. Each planted line says whether its rule
// must refuse it. The planted files sit beside this one, so the repository's own .oxlintrc.json is
// what runs. `no-secret-env` and `no-redacted-value` are planted in
// packages/fabrika/src/redacted-lint.test.ts, `no-project-settings` in
// packages/fabrika/src/agents/claude/rules.test.ts.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";
import {afterAll, describe, expect, it} from "vitest";

const ROOT = join(import.meta.dirname, "..");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

const plant = mkdtempSync(join(import.meta.dirname, ".plant-"));
afterAll(() => rmSync(plant, {recursive: true, force: true}));
// What `./b.laws` must be taken for: a file with one more extension, not a named file.
writeFileSync(join(plant, "b.laws.ts"), "export const b = 1;\n");

/** The lines `pnpm lint`'s oxlint refuses in this file under one rule's code. */
const fires = (path: string, code: string): readonly number[] => {
	const out = spawnSync(OXLINT, ["--format=json", relative(ROOT, path)], {
		cwd: ROOT,
		encoding: "utf8",
	});
	const report = JSON.parse(out.stdout) as {
		readonly diagnostics: readonly {
			readonly code: string;
			readonly labels: readonly {readonly span: {readonly line: number}}[];
		}[];
	};
	return report.diagnostics
		.filter((d) => d.code === code)
		.flatMap((d) => (d.labels[0] === undefined ? [] : [d.labels[0].span.line]))
		.sort((a, b) => a - b);
};

interface Plant {
	readonly code: string;
	/** The file's name, for a rule that looks at it. */
	readonly file?: string;
	readonly prelude: readonly string[];
	readonly lines: readonly (readonly [string, boolean])[];
}

const EFFECT = 'import {Context, Data, Duration, Effect, Schedule} from "effect";';

const PLANTS: readonly Plant[] = [
	{
		code: "fabrika(no-bare-tell)",
		prelude: [
			"declare const run: {tell: (n: string, x: number) => unknown};",
			"declare const tell: (r: unknown, n: string, x: number) => unknown;",
			"declare const xs: number[];",
		],
		lines: [
			['tell(run, "n", 1);', true],
			['run.tell("n", 1);', true],
			['xs.forEach((x) => run.tell("n", x));', true],
			['export const told = tell(run, "n", 1);', false],
		],
	},
	{
		code: "fabrika(no-context-tag)",
		prelude: [EFFECT],
		lines: [
			['export const a = Context.Tag("a");', true],
			['export const b = Context.GenericTag("b");', true],
			['export const c = Effect.Service("c");', true],
			['export const d = Context.Service("d");', false],
		],
	},
	{
		code: "fabrika(no-data-taggederror)",
		prelude: [EFFECT, "declare const Other: {TaggedError: (n: string) => new () => object};"],
		lines: [
			['export class A extends Data.TaggedError("A") {}', true],
			['export class B extends Other.TaggedError("B") {}', false],
		],
	},
	{
		code: "fabrika(no-effect-promise)",
		prelude: [EFFECT, "declare const p: () => Promise<number>;", "declare const c: () => string;"],
		lines: [
			["export const a = Effect.promise(p);", true],
			["export const b = Effect.tryPromise(p);", true],
			["export const d = Effect.tryPromise({try: p, catch: c});", false],
		],
	},
	{
		code: "fabrika(no-expect-in-if)",
		file: "planted.test.ts",
		prelude: [
			"declare const it: (n: string, f: () => void) => void;",
			"declare const expect: (x: unknown) => {toBe: (y: unknown) => void};",
			"declare const x: number;",
		],
		lines: [
			['it("a", () => { if (x > 0) { expect(x).toBe(1); } });', true],
			['it("b", () => { expect(x).toBe(1); if (x > 0) { expect(x).toBe(1); } });', false],
		],
	},
	{
		code: "fabrika(no-implicit-effect-concurrency)",
		prelude: [EFFECT, "declare const xs: number[];", "declare const f: (x: number) => unknown;"],
		lines: [
			["export const a = Effect.all(xs);", true],
			["export const b = Effect.forEach(xs, f);", true],
			["export const c = Effect.validate(xs, f);", true],
			['export const d = Effect.all(xs, {concurrency: "unbounded"});', false],
			["export const e = Effect.forEach(xs, f, {concurrency: 1});", false],
		],
	},
	{
		code: "fabrika(no-numeric-duration)",
		prelude: [EFFECT],
		lines: [
			["export const a = Effect.sleep(5000);", true],
			["export const b = Schedule.spaced(1000);", true],
			['export const c = Effect.sleep("5 seconds");', false],
			["export const d = Effect.sleep(Duration.seconds(5));", false],
		],
	},
	{
		code: "fabrika(no-raw-try-catch)",
		prelude: [EFFECT, "declare const f: () => void;", "export const e = Effect.void;"],
		lines: [
			["try { f(); } catch { f(); }", true],
			["export const g = () => { f(); };", false],
		],
	},
	{
		code: "fabrika(no-throw-in-effect-gen)",
		prelude: [EFFECT],
		lines: [
			['export const a = Effect.gen(function* () { throw new Error("a"); });', true],
			['export const b = () => { throw new Error("b"); };', false],
		],
	},
	{
		code: "fabrika(no-type-assertions)",
		prelude: ["declare const x: number;"],
		lines: [
			["export const a = x as any;", true],
			["export const b = x as unknown as string;", true],
			["export const c = x as number;", false],
		],
	},
	{
		code: "fabrika(use-import-extensions)",
		prelude: [],
		lines: [
			['export {a} from "./thing";', true],
			['export {b} from "./b.laws";', true],
			['export const c = import("./thing");', true],
			['export {d} from "./thing.ts";', false],
			['export {e} from "effect";', false],
			// Only `b.laws.ts` is there, so Node would not find either of these.
			['export {f} from "./b.laws.js";', true],
			['export {g} from "./b.laws.tsx";', true],
			['export {h} from "./b.laws.ts";', false],
		],
	},
	{
		code: "fabrika(no-redacted-value)",
		file: "planted.tsx",
		prelude: ['import {Redacted} from "effect";', "declare const Other: {value: () => null};"],
		lines: [
			["export const a = <Redacted.value />;", true],
			["export const b = <Redacted.value></Redacted.value>;", true],
			["export const c = <Other.value />;", false],
		],
	},
	// Biome's built-in rules that must not be lost in the move.
	{
		code: "eslint(no-unused-vars)",
		prelude: [],
		lines: [
			['import {gone} from "./gone.ts";', true],
			["const unused = 1;", true],
			["export const f = (a: number, _b: number) => a;", false],
			["export const g = (a: number, b: number) => a;", true],
		],
	},
	{
		code: "typescript(no-non-null-assertion)",
		prelude: ["declare const x: number | undefined;"],
		lines: [
			["export const a = x!;", true],
			["export const b = x ?? 0;", false],
		],
	},
	{
		code: "typescript(ban-ts-comment)",
		prelude: [],
		lines: [
			["// @ts-ignore", true],
			["export const a = 1;", false],
		],
	},
	{
		code: "eslint(no-sequences)",
		prelude: [],
		lines: [
			["export const a = (1, 2);", true],
			["export const b = [1, 2];", false],
		],
	},
	{
		code: "eslint(array-callback-return)",
		prelude: ["declare const xs: number[];", "declare const f: (x: number) => void;"],
		lines: [
			["xs.forEach((x) => x);", true],
			["xs.forEach((x) => { f(x); });", false],
		],
	},
	{
		code: "typescript(no-empty-object-type)",
		prelude: [],
		lines: [
			["export declare const a: {};", true],
			["export declare const b: {c: 1};", false],
		],
	},
];

describe("each rule refuses what it is there to refuse", () => {
	it.each(PLANTS.map((p, i) => [p.code, p, i] as const))("%s", (_code, p, i) => {
		const file = join(plant, `${i}-${p.file ?? "planted.ts"}`);
		writeFileSync(file, `${[...p.prelude, ...p.lines.map(([line]) => line)].join("\n")}\n`);
		const want = p.lines.flatMap(([, refused], at) => (refused ? [p.prelude.length + at + 1] : []));
		expect(fires(file, p.code)).toEqual(want);
	});

	it("a test file is the only place no-expect-in-if looks", () => {
		const file = join(plant, "not-a-test.ts");
		const line = 'it("a", () => { if (x > 0) { expect(x).toBe(1); } });';
		writeFileSync(file, `declare const it: any, expect: any, x: number;\n${line}\n`);
		expect(fires(file, "fabrika(no-expect-in-if)")).toEqual([]);
	});

	it("the plugin has one planted line or more for every rule it lists", async () => {
		const {default: plugin} = await import("./index.ts");
		const planted = new Set(PLANTS.map((p) => p.code));
		// `no-bare-disable` reports at the top of the file, so it has its own test below.
		const elsewhere = [
			"no-secret-env",
			"no-redacted-value",
			"no-project-settings",
			"no-bare-disable",
		];
		const missing = Object.keys(plugin.rules).filter(
			(rule) => !planted.has(`fabrika(${rule})`) && !elsewhere.includes(rule),
		);
		expect(missing).toEqual([]);
	});
});

describe("lint.ts, the first step of pnpm lint", () => {
	const lint = (path: string) =>
		spawnSync(process.execPath, ["oxlint-plugins/lint.ts", relative(ROOT, path)], {
			cwd: ROOT,
			encoding: "utf8",
		});

	const advice = join(plant, "advice.ts");
	const blocking = join(plant, "blocking.ts");

	it("prints an advice rule's fire and does not fail", () => {
		writeFileSync(
			advice,
			[
				'import {Effect} from "effect";',
				"declare const f: () => void;",
				"export const e = Effect.void;",
				"try { f(); } catch { f(); }",
				"",
			].join("\n"),
		);
		const out = lint(advice);
		expect(out.stdout).toContain("fabrika(no-raw-try-catch)");
		expect(out.stdout).toContain("oxlint: 0 blocking, 1 advice");
		expect(out.status).toBe(0);
	});

	it("fails on a warning from a blocking rule", () => {
		writeFileSync(blocking, "declare const x: number;\nexport const a = x as any;\n");
		const out = lint(blocking);
		expect(out.stdout).toContain("fabrika(no-type-assertions)");
		expect(out.status).toBe(1);
	});

	it("fails when oxlint looked at nothing, so a clean run cannot be faked by a bad path", () => {
		const out = lint(join(plant, "no-such-file.ts"));
		expect(out.status).not.toBe(0);
	});
});

const SECRET = "export const a = process.env.GITHUB_TOKEN;";

describe("an ignore comment names its rules and says why", () => {
	const run = (name: string, text: string) => {
		const file = join(plant, name);
		writeFileSync(file, text);
		return spawnSync(process.execPath, ["oxlint-plugins/lint.ts", relative(ROOT, file)], {
			cwd: ROOT,
			encoding: "utf8",
		});
	};

	it.each([
		["no rule, the next line", `// oxlint-disable-next-line\n${SECRET}\n`],
		["no reason", `// oxlint-disable-next-line fabrika/no-secret-env\n${SECRET}\n`],
		["no rule, a reason", `// oxlint-disable-next-line -- why\n${SECRET}\n`],
		["an empty reason", `// oxlint-disable-next-line fabrika/no-secret-env -- \n${SECRET}\n`],
		["words but no dashes", `// oxlint-disable-next-line fabrika/no-secret-env why\n${SECRET}\n`],
		["no rule, the whole file", `/* oxlint-disable */\n${SECRET}\n`],
		["no rule, lower down", `\n\n/* oxlint-disable */\n${SECRET}\n`],
		["no rule, this line", `${SECRET} // oxlint-disable-line\n`],
		["a rule glued on", `/* oxlint-disablefabrika/no-secret-env */\n${SECRET}\n`],
		["eslint, the whole file", `/* eslint-disable */\n${SECRET}\n`],
		["eslint, the next line", `// eslint-disable-next-line\n${SECRET}\n`],
		["eslint, in full", `// eslint-disable-next-line fabrika/no-secret-env -- why\n${SECRET}\n`],
		[
			"JSX",
			`export const a = (\n\t<a>\n\t\t{/* oxlint-disable-next-line */}\n\t\t<b />\n\t</a>\n);\n`,
		],
	])("refuses %s, and that comment cannot silence the refusal", (name, text) => {
		const out = run(`bare-${name.replaceAll(/\W/g, "-")}.tsx`, text);
		expect(out.stdout).toContain("fabrika(no-bare-disable)");
		expect(out.status).toBe(1);
	});

	it("says which line, since it reports at the top of the file", () => {
		const out = run("line.ts", `\n\n// oxlint-disable-next-line\n${SECRET}\n`);
		expect(out.stdout).toContain("on line 3");
	});

	it.each([
		["one rule", `// oxlint-disable-next-line fabrika/no-secret-env -- why\n${SECRET}\n`],
		["from here on", `/* oxlint-disable fabrika/no-secret-env -- why\n more why */\n${SECRET}\n`],
		[
			"two rules",
			`// oxlint-disable-next-line fabrika/no-secret-env, no-debugger -- why\n${SECRET}\ndebugger;\n`,
		],
		["words that only mention it", `// the oxlint-disable comment\nexport const b = 1;\n`],
	])("takes %s", (_name, text) => {
		const out = run("named.ts", text);
		expect(out.stdout).not.toContain("no-bare-disable");
	});
});

describe("a plain file cannot take a folder out of the checks", () => {
	const LINT = join(ROOT, "oxlint-plugins", "lint.ts");
	const FORMAT = join(ROOT, "oxlint-plugins", "format.ts");
	const inFolder = (files: Readonly<Record<string, string>>) => {
		const folder = mkdtempSync(join(plant, "hide-"));
		mkdirSync(join(folder, "sub"));
		for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
		return folder;
	};
	const node = (script: string, cwd: string, ...args: readonly string[]) =>
		spawnSync(process.execPath, [script, ...args], {cwd, encoding: "utf8"});

	it.each([
		["a .eslintignore", ".eslintignore", "sub/\n"],
		["a nested .oxlintrc.json", "sub/.oxlintrc.json", "{}\n"],
		["a nested oxlint.config.ts", "sub/oxlint.config.ts", "export default {};\n"],
	])("oxlint still refuses a secret beside %s", (_name, file, text) => {
		const cwd = inFolder({"sub/a.ts": `${SECRET}\n`, [file]: text});
		const out = node(LINT, cwd, ".");
		expect(out.stdout).toContain("fabrika(no-secret-env)");
		expect(out.status).toBe(1);
	});

	it.each([
		["a .prettierignore", ".prettierignore", "sub/\n"],
		["a nested .oxfmtrc.json", "sub/.oxfmtrc.json", '{"ignorePatterns": ["**"]}\n'],
	])("oxfmt still refuses unformatted code beside %s", (_name, file, text) => {
		const cwd = inFolder({"sub/a.ts": "export   const a   = 1\n", [file]: text});
		const out = node(FORMAT, cwd, "--check", ".");
		expect(out.stdout).toContain("sub/a.ts");
		expect(out.status).toBe(1);
	});

	it("oxfmt takes formatted code, so the two above fail for the right reason", () => {
		const cwd = inFolder({"sub/a.ts": "export const a = 1;\n"});
		expect(node(FORMAT, cwd, "--check", ".").status).toBe(0);
	});

	it("a .gitignore over a tracked file fails lint.ts, and names the file", () => {
		const cwd = inFolder({"sub/a.ts": `${SECRET}\n`, "sub/.gitignore": "*\n"});
		spawnSync("git", ["init", "-q"], {cwd});
		spawnSync("git", ["add", "-f", "sub/a.ts"], {cwd});
		const out = node(LINT, cwd, ".");
		expect(out.stderr).toContain("sub/a.ts");
		expect(out.status).toBe(2);
	});
});

describe("rules that apply by path", () => {
	const plantIn = (folder: string, text: string) => {
		const at = mkdtempSync(join(ROOT, folder, ".plant-"));
		const file = join(at, "planted.ts");
		writeFileSync(file, text);
		return {at, file};
	};
	const made: string[] = [];
	afterAll(() => {
		for (const at of made) rmSync(at, {recursive: true, force: true});
	});

	it.each([
		["eslint(prefer-template)", 'export const f = (a: string) => a + "b";\n'],
		["eslint(prefer-arrow-callback)", "export const a = [1].map(function (x) { return x; });\n"],
		["eslint(require-yield)", "export const a = function* () { return 1; };\n"],
	])("experiments/ is under %s", (code, text) => {
		const {at, file} = plantIn("experiments", text);
		made.push(at);
		expect(fires(file, code)).toEqual([1]);
	});

	const HOOK =
		'import {useState} from "react";\nexport const f = (x: number) => { if (x) useState(0); };\n';

	it.each(["apps", "programs"])("a hook in a .ts file under %s/ is checked", (folder) => {
		const {at, file} = plantIn(folder, HOOK);
		made.push(at);
		expect(fires(file, "react-hooks(rules-of-hooks)")).toEqual([2]);
	});

	const EFFECTS = [
		'import {useEffect, useEffectEvent} from "react";',
		"export const stale = (n: number) => {",
		"\tuseEffect(() => console.log(n), []);",
		"};",
		"export const fresh = (n: number) => {",
		"\tconst log = useEffectEvent(() => console.log(n));",
		"\tuseEffect(() => log(), [n]);",
		"};",
		"",
	].join("\n");

	it.each(["apps", "programs"])("an effect's stale value under %s/ is refused", (folder) => {
		const {at, file} = plantIn(folder, EFFECTS);
		made.push(at);
		expect(fires(file, "react-hooks(exhaustive-deps)")).toEqual([3]);
	});

	it("a `use` in a .ts file under packages/ is left alone: it is Effect's, not a hook", () => {
		const {at, file} = plantIn("packages", HOOK);
		made.push(at);
		expect(fires(file, "react-hooks(rules-of-hooks)")).toEqual([]);
	});
});
