import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as fc from "fast-check";
import {expect, it} from "vitest";
import {checkTracked} from "../../oxlint-plugins/gitignore.mjs";
import * as ci from "./changes.mjs";

// Today's CI, both versions. Covers changes.mjs and the shared gitignore.mjs.
// Red baseline adapters are preserved in the first T342 tests commit. These laws
// now import the implementation directly, so deleting it cannot bypass a check.
// T342 source plants, all caught: PR skips on main, all Markdown safe, broad
// packages prefix, any-match skips, every next path skips test, newline splitting,
// and ignored diff failure. The broad-prefix plant first survived mixed lists;
// checking each shared path alone closed that gap. Shared-check plants accepting
// hidden tracked files or failed Git output both failed the tracked-file law.
const options = {seed: 119120, numRuns: 100};
const heavy = {check: true, test: true, next: true, e2e: true};
type Runner = (args: string[]) => {status: number | null; stdout: string};
const word = fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/);
const safe = fc.oneof(
	word.map((s) => `field/${s}.jsonl`),
	word.map((s) => `docs/${s}.md`),
	word.map((s) => `field/${s}.md`),
);
const today = fc
	.tuple(fc.constantFrom("apps", "programs", "packs", "wip", "legacy", "packages/fabrika"), word)
	.map(([dir, s]) => `${dir}/${s}.ts`);
const next = word.map((s) => `next/packages/libfabrika/src/${s}.ts`);
const shared = fc.oneof(
	word.map((s) => `unknown/${s}`),
	fc.constantFrom(
		"packages/fabrika-design/src/colors.ts",
		"packages-other/file.ts",
		"nextish/file.ts",
		".agents/skills/tests/SKILL.md",
		".claude/skills/tests/SKILL.md",
		"pnpm-lock.yaml",
		"field/nested/a.jsonl",
		"tools/field/a.jsonl",
		"field/a.jsonl.ts",
	),
);
const path = fc.oneof(
	safe,
	today,
	next,
	shared,
	fc.string({minLength: 1}).map((s) => `unusual/${s}`),
);
const list = fc.array(path, {maxLength: 12});

it("main enables every job for every path list", () => {
	fc.assert(
		fc.property(list, (paths) => {
			expect(ci.classify(paths, "push")).toEqual({...heavy, field: true});
		}),
		options,
	);
});
it("nonempty safe lists skip the heavy jobs and skills Markdown does not", () => {
	fc.assert(
		fc.property(fc.array(safe, {minLength: 1, maxLength: 12}), (paths) => {
			expect(ci.classify(paths, "pull_request")).toEqual({
				check: false,
				test: false,
				next: false,
				e2e: false,
				field: paths.some((p) => /^field\/[^/]+\.jsonl$/.test(p)),
			});
			for (const tree of [".agents", ".claude"])
				expect(
					ci.classify([...paths, `${tree}/skills/tests/SKILL.md`], "pull_request"),
				).toMatchObject(heavy);
		}),
		options,
	);
});
it("shared paths run everything; adding paths never disables a job", () => {
	fc.assert(
		fc.property(
			fc.array(path, {minLength: 1, maxLength: 10}),
			list,
			shared,
			(paths, more, unknown) => {
				expect(ci.classify([unknown], "pull_request")).toMatchObject(heavy);
				expect(ci.classify([...paths, unknown], "pull_request")).toMatchObject(heavy);
				const before = ci.classify(paths, "pull_request");
				const after = ci.classify([...paths, ...more], "pull_request");
				for (const key of ["check", "test", "next", "e2e", "field"] as const)
					expect(!before[key] || after[key]).toBe(true);
				expect(ci.classify([], "pull_request")).toMatchObject(heavy);
				expect(ci.classify(null, "pull_request")).toMatchObject(heavy);
			},
		),
		options,
	);
});
it("today, next, mixed and the shared plant helper have separate version flags", () => {
	fc.assert(
		fc.property(fc.array(today, {minLength: 1}), fc.array(next, {minLength: 1}), (old, fresh) => {
			expect(ci.classify(old, "pull_request")).toMatchObject({...heavy, next: false});
			expect(ci.classify(fresh, "pull_request")).toMatchObject({...heavy, test: false, e2e: false});
			expect(ci.classify([...old, ...fresh], "pull_request")).toMatchObject(heavy);
			expect(
				ci.classify([...fresh, "next/apps/fabrika/src/exam/plant.ts"], "pull_request"),
			).toMatchObject({test: true, e2e: false});
		}),
		options,
	);
});
it("NUL diff keeps both move names and unusual paths; failed reads cannot skip", () => {
	fc.assert(
		fc.property(
			word,
			word,
			fc.constantFrom(" ", "\t", "\n"),
			fc.constantFrom(1, 128, null),
			(old, fresh, space, status) => {
				const paths = [`apps/${old}${space}old.ts`, `next/${fresh}${space}new.ts`];
				const calls: string[][] = [];
				const run: Runner = (args) => {
					calls.push(args);
					return {
						status: 0,
						stdout: args[0] === "merge-base" ? `${"a".repeat(40)}\n` : `${paths.join("\0")}\0`,
					};
				};
				expect(ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", run)).toEqual(paths);
				expect(calls[0]).toEqual(["merge-base", "b".repeat(40), "c".repeat(40)]);
				expect(calls[1]).toEqual([
					"diff",
					"--no-renames",
					"--name-only",
					"-z",
					"a".repeat(40),
					"c".repeat(40),
					"--",
				]);
				expect(
					ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", () => ({
						status,
						stdout: "",
					})),
				).toBeNull();
				expect(
					ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", (args) =>
						args[0] === "merge-base" ? {status: 0, stdout: "a".repeat(40)} : {status, stdout: ""},
					),
				).toBeNull();
				expect(ci.readPaths("b".repeat(40), "c".repeat(40), "push", run)).toEqual(paths);
				expect(calls.at(-1)).toEqual([
					"diff",
					"--no-renames",
					"--name-only",
					"-z",
					"b".repeat(40),
					"c".repeat(40),
					"--",
				]);
				expect(ci.readPaths("--bad", "c".repeat(40), "pull_request", run)).toBeNull();
				// A platform refusal has null stdout at runtime, despite Node's generic string type.
				expect(
					ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", () =>
						spawnSync("git", ["status"], {
							cwd: join(tmpdir(), "t342-no-such-folder", old),
							encoding: "utf8",
						}),
					),
				).toBeNull();
				expect(ci.readPaths("0".repeat(40), "c".repeat(40), "push", run)).toBeNull();
				// Zeros at either end are legal; only the all-zero SHA means no history.
				const zeros = `0${"a".repeat(38)}0`;
				expect(ci.readPaths(zeros, zeros, "push", run)).toEqual(paths);
				// A merge base Git prints that is not a SHA cannot reach the diff.
				expect(
					ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", (args) =>
						args[0] === "merge-base" ? {status: 0, stdout: "\n"} : run(args),
					),
				).toBeNull();
				// Empty output is no paths; output cut before its last NUL cannot skip.
				const answer = (stdout: string) =>
					ci.readPaths("b".repeat(40), "c".repeat(40), "push", () => ({status: 0, stdout}));
				expect(answer("")).toEqual([]);
				expect(answer(paths.join("\0"))).toBeNull();
			},
		),
		options,
	);
});

it("shared tracked-file check agrees with Git, including command errors", () => {
	fc.assert(
		fc.property(word, fc.boolean(), (name, ignored) => {
			const root = mkdtempSync(join(tmpdir(), "ci-ignore-"));
			try {
				const data = join(root, "data");
				// These disposable Git fixtures never touch this checkout's index or history.
				expect(
					spawnSync("git", ["init", "-q", "--separate-git-dir", data, join(root, "tree")]).status,
				).toBe(0);
				const tree = join(root, "tree");
				writeFileSync(join(tree, name), "test");
				expect(spawnSync("git", ["add", "--", name], {cwd: tree}).status).toBe(0);
				writeFileSync(join(tree, ".gitignore"), ignored ? `${name}\n` : "other\n");
				expect(checkTracked(tree).ok).toBe(!ignored);
				expect(checkTracked(join(root, "missing")).ok).toBe(false);
			} finally {
				rmSync(root, {recursive: true, force: true});
			}
		}),
		options,
	);
});
