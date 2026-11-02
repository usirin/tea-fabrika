import {execFileSync, spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "@effect/vitest";
import {codexEnvOf, flagsOf} from "../codex/adapter.ts";
import {codexEnv} from "./harness.ts";

// Git in Codex's own box (self-fix PR 2). On ticket 117 the builder ran in a Codex box where git
// answered `spawnSync git EPERM`, so its own tests and lint died. These run `codex sandbox` with the
// whole environment `codexEnv` gives Codex, the host's real PATH in it, on a made-up home with no
// login. No model is called.

// Whether the box starts, asked the way "the fence, in Codex's own box" asks (harness.test.ts).
const boxHome = realpathSync(mkdtempSync(join(tmpdir(), "codex-box-")));
const made: string[] = [boxHome];
afterAll(() => {
	for (const path of made) rmSync(path, {recursive: true, force: true});
});
const boxEnv = codexEnvOf(process.env, boxHome);
const tried = spawnSync("codex", ["sandbox", "--", "/bin/sh", "-c", "exit 0"], {
	cwd: boxHome,
	env: boxEnv,
	encoding: "utf8",
	stdio: ["ignore", "ignore", "pipe"],
});
const noCodex =
	tried.error !== undefined &&
	"code" in tried.error &&
	["ENOENT", "EACCES", "EPERM"].includes(String(tried.error.code));
const insideABox = tried.stderr?.includes("sandbox_apply: Operation not permitted") ?? false;
const SLOW = 120_000;

/** Git as the host runs it outside any box, with no one's own settings. */
const hostGit = (cwd: string, args: readonly string[]) =>
	execFileSync(
		"git",
		[
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"-c",
			"init.defaultBranch=main",
			...args,
		],
		{
			cwd,
			env: {
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_CONFIG_NOSYSTEM: "1",
			},
			stdio: "ignore",
		},
	);

/**
 * A made-up home with no login, a clone in it, and a worktree copy of that clone, as a lane's copy
 * is. Then what Codex is handed for a write turn in that copy, by `codexEnv`, with the host's PATH.
 */
const laneCopy = () => {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "codex-git-")));
	made.push(home);
	const clone = join(home, "repo");
	mkdirSync(clone);
	writeFileSync(join(clone, "a.txt"), "a\n");
	hostGit(clone, ["init", "-q"]);
	hostGit(clone, ["add", "a.txt"]);
	hostGit(clone, ["commit", "-q", "-m", "first"]);
	const folder = join(home, "work", "copy");
	hostGit(clone, ["worktree", "add", "-q", "-b", "lane", folder]);
	const parent = {
		PATH: process.env.PATH,
		HOME: home,
		USER: process.env.USER,
		TMPDIR: tmpdir(),
	};
	const env = codexEnv(parent, folder, "write");
	// Code makes this home before a turn (`codexHome`). Here it holds no login.
	mkdirSync(env.HOME ?? join(home, "codex-home"), {recursive: true});
	const config: Record<string, unknown> = JSON.parse(env.CODEX_CONFIG ?? "{}");
	return {folder, env, config};
};

/** One shell line in Codex's box, in the copy, with the env and config Codex is handed. */
const inBox = (copy: ReturnType<typeof laneCopy>, line: string) => {
	const ran = spawnSync(
		"codex",
		["sandbox", ...flagsOf(copy.config), "--", "/bin/sh", "-c", line],
		{cwd: copy.folder, env: copy.env, encoding: "utf8"},
	);
	return {status: ran.status, said: `${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim()};
};

/** A path as one word of a shell line, whatever it holds. */
const word = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;

describe.skipIf(process.platform !== "darwin" || noCodex || insideABox || tried.status !== 0)(
	"git, in Codex's own box",
	() => {
		it(
			"runs `git --version` with the host's real PATH",
			() => {
				const ran = inBox(laneCopy(), "git --version");
				expect(ran.status, ran.said).toBe(0);
			},
			SLOW,
		);

		it(
			"runs `git status` from `node -e` in a worktree copy",
			() => {
				const script = `require("node:child_process").execFileSync("git", ["status"], {stdio: "inherit"})`;
				const ran = inBox(laneCopy(), `${word(process.execPath)} -e ${word(script)}`);
				expect(ran.status, ran.said).toBe(0);
			},
			SLOW,
		);
	},
);
