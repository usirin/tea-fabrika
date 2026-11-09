import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import * as fc from "fast-check";
import {expect, it} from "vitest";

// Today's CI, both versions. Covers changes.mjs and the shared gitignore.mjs.
// Before changes.mjs exists, run main's actual shell classifier. This is a behavioral
// baseline, not a missing-import red. Remove the adapter once the implementation lands.
const options = {seed: 119120, numRuns: 100};
const heavy = {check: true, test: true, next: true, e2e: true};
type Flags = typeof heavy & {field: boolean};
type Runner = (args: string[]) => {status: number | null; stdout: string};
const baseline = (paths: string[] | null, event: string): Flags => {
	const root = mkdtempSync(join(tmpdir(), "ci-red-"));
	try {
		const workflow = readFileSync(new URL("../workflows/check.yaml", import.meta.url), "utf8");
		const script = workflow.slice(
			workflow.indexOf("          code=true"),
			workflow.indexOf("\n  check:"),
		);
		writeFileSync(join(root, "git"), '#!/bin/sh\ncat "$DIFF"\n', {mode: 0o755});
		writeFileSync(join(root, "diff"), paths?.join("\n") ?? "");
		const output = join(root, "output");
		const ran = spawnSync("bash", ["-c", script], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${root}:${process.env["PATH"]}`,
				DIFF: join(root, "diff"),
				BASE: event === "push" ? "" : "base",
				HEAD: "head",
				GITHUB_OUTPUT: output,
			},
		});
		expect(ran.status).toBe(0);
		const code = readFileSync(output, "utf8").trim() === "code=true";
		return {check: true, test: code, next: code, e2e: code, field: false};
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
};
const moduleUrl = new URL("./changes.mjs", import.meta.url);
const ci: {
	classify: (paths: string[] | null, event: string) => Flags;
	readPaths: (base: string, head: string, event: string, run: Runner) => string[] | null;
} = existsSync(moduleUrl)
	? await import(moduleUrl.href)
	: {
			classify: baseline,
			readPaths: (_base, _head, _event, run) => {
				const result = run(["diff", "--name-only"]);
				return result.stdout.trim().split("\n");
			},
		};
const word = fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/);
const safe = fc.oneof(
	word.map((s) => `field/${s}.jsonl`),
	word.map((s) => `docs/${s}.md`),
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
		fc.property(list, (paths) =>
			expect(ci.classify(paths, "push")).toEqual({...heavy, field: true}),
		),
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
				field: paths.some((p) => p.startsWith("field/")),
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
				expect(ci.readPaths("--bad", "c".repeat(40), "pull_request", run)).toBeNull();
				expect(ci.readPaths("0".repeat(40), "c".repeat(40), "push", run)).toBeNull();
			},
		),
		options,
	);
});

it("shared tracked-file check agrees with Git, including command errors", async () => {
	const url = new URL("../../oxlint-plugins/gitignore.mjs", import.meta.url);
	const check: (root: string) => {ok: boolean} = existsSync(url)
		? (await import(url.href)).checkTracked
		: (root) => {
				const got = spawnSync("git", ["ls-files", "-ci", "--exclude-per-directory=.gitignore"], {
					cwd: root,
					encoding: "utf8",
				});
				return {ok: got.status === 0 && got.stdout === ""};
			};
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
				expect(check(tree).ok).toBe(!ignored);
				expect(check(join(root, "missing")).ok).toBe(false);
			} finally {
				rmSync(root, {recursive: true, force: true});
			}
		}),
		options,
	);
});
