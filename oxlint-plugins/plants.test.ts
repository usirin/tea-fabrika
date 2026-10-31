// The lint rules are the exam, so each one is seen to fail. Each planted line says whether its rule
// must refuse it. The planted files sit beside this one, so the repository's own .oxlintrc.json is
// what runs. `no-secret-env` and `no-redacted-value` are planted in
// packages/fabrika/src/redacted-lint.test.ts, `no-project-settings` in
// packages/fabrika/src/agents/claude/rules.test.ts.
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
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
		const elsewhere = ["no-secret-env", "no-redacted-value", "no-project-settings"];
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
