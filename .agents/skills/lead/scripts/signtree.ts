// Today's tooling. The worktree drive signs a Claude step's work in: a detached checkout of MAIN at
// the lane's base, with MAIN's node_modules linked in. stepcommit's format check runs oxfmt from
// `<root>/node_modules/.bin`; without the link it cannot run, and every Claude step was refused as
// `not_formatted` (P12 mutation, 2026-11-09).

import {spawnSync} from "node:child_process";
import {existsSync, symlinkSync} from "node:fs";
import {join} from "node:path";

type Ran = {code: number; out: string; err: string};

/** Adds the worktree at `base` and links MAIN's node_modules into it. `code` 0 means ready. */
export const signTree = (main: string, wt: string, base: string, env?: NodeJS.ProcessEnv): Ran => {
	const r = spawnSync("git", ["-C", main, "worktree", "add", "-q", "--detach", wt, base], {
		encoding: "utf8",
		env,
	});
	const add = {code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? ""};
	if (add.code !== 0) return add;
	const modules = join(main, "node_modules");
	if (!existsSync(modules)) return {code: 1, out: "", err: `no node_modules in ${main}`};
	symlinkSync(modules, join(wt, "node_modules"), "dir");
	return add;
};
