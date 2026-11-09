import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";
import {signTree} from "./signtree.ts";

// Today's tooling. Git and oxfmt are real; nothing is signed.
const root = resolve(import.meta.dirname, "../../../..");
const env = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@example.test",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@example.test",
};
const git = (cwd: string, ...args: string[]) => {
	const r = spawnSync("git", ["-C", cwd, ...args], {encoding: "utf8", env});
	expect(r.status, r.stderr).toBe(0);
	return r.stdout.trim();
};

describe("drive's sign worktree, today's tooling", () => {
	// Plant: add the worktree without the node_modules link. P12 mutation (2026-11-09) was refused
	// as not_formatted on a formatted file, because oxfmt could not run there.
	it("scenario: oxfmt runs from the sign worktree and accepts a formatted file", () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "signtree-")));
		try {
			const main = join(dir, "main");
			mkdirSync(main);
			git(main, "init", "-q", "-b", "main");
			writeFileSync(join(main, ".gitignore"), "node_modules\n");
			writeFileSync(join(main, "a.ts"), "export const a = 1;\n");
			git(main, "add", "--all");
			git(main, "commit", "-q", "-m", "base");
			symlinkSync(join(root, "node_modules"), join(main, "node_modules"), "dir");
			const wt = join(dir, "wt");
			const got = signTree(main, wt, git(main, "rev-parse", "HEAD"), env);
			expect(got.code, got.err).toBe(0);
			const fmt = spawnSync(join(wt, "node_modules/.bin/oxfmt"), ["--check", "a.ts"], {
				cwd: wt,
				encoding: "utf8",
			});
			expect(fmt.status, fmt.stdout + fmt.stderr).toBe(0);
			expect(git(wt, "status", "--porcelain")).toBe("");
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});

	it("scenario: a main checkout without node_modules is refused, not run unchecked", () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "signtree-")));
		try {
			const main = join(dir, "main");
			mkdirSync(main);
			git(main, "init", "-q", "-b", "main");
			git(main, "commit", "-q", "--allow-empty", "-m", "base");
			const got = signTree(main, join(dir, "wt"), "HEAD", env);
			expect(got.code).not.toBe(0);
			expect(got.err).toMatch(/node_modules/);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});
