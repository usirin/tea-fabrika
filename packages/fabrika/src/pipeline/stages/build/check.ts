import {existsSync, readFileSync, realpathSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {basename, delimiter, dirname, isAbsolute, join, relative, resolve} from "node:path";
import {refusal} from "../../shell-guard.ts";

// The builder's holds that are plain functions: its check on one tool call,
// its tool list, and the folders its commands may read and write. Kept apart
// from ./builder.ts, which starts the Agent SDK, so a process that only checks
// a call (./check-hook.ts, run once per tool call) loads nothing else: about
// 50 ms a start instead of about 300.

const inside = (folder: string, path: string) => {
	const rel = relative(folder, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** A path with its links followed, as far as it is there: `/copy/out/x` where `out` links elsewhere is that elsewhere's `x`. */
const realOf = (path: string): string => {
	const parent = dirname(path);
	try {
		return realpathSync(path);
	} catch {
		return parent === path ? path : join(realOf(parent), basename(path));
	}
};

/** The part of a glob before its first wildcard, as a folder: `/a/b/*.ts` is `/a/b`. */
const fixedPart = (pattern: string): string => {
	const wild = pattern.search(/[*?[{]/);
	return wild === -1 ? pattern : dirname(`${pattern.slice(0, wild)}x`);
};

const READS = new Set(["Read", "Grep", "Glob"]);

/** Commands that talk to GitHub or the network, or that would let a command out of the sandbox. Refused by name. */
const TALKS =
	/(^|[\s;&|(`])(gh|curl|wget|ssh|scp|nc|npm\s+publish|pnpm\s+publish|git\s+(push|remote|fetch|pull|clone|config|credential))\b/;

/**
 * The builder's own rule, beside the shared Check: a read stays in the copy
 * and the temp folders, a command that talks to GitHub or the network is
 * refused by name, and no command may ask to leave the sandbox.
 */
export function builderRefusal(
	tree: string,
	temp: readonly string[],
	tool: string,
	input: Readonly<Record<string, unknown>>,
): string | null {
	const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
	if (READS.has(tool)) {
		const pattern = tool === "Glob" ? text(input.pattern) : null;
		// A Glob's pattern can leave the folder on its own: `/elsewhere/**`, `~/x`,
		// or `..`, which after a `**` that matched nothing climbs one more than it shows.
		if (pattern !== null && (pattern.startsWith("~") || pattern.split(/[\\/]/).includes("..")))
			return `The pattern ${pattern} leaves your working copy. Glob only inside ${tree}, without ".." or "~".`;
		const asked = [
			text(input.file_path),
			text(input.path),
			pattern !== null && isAbsolute(pattern) ? fixedPart(pattern) : null,
		].flatMap((p) => (p === null ? [] : [resolve(tree, p)]));
		// A link is followed: the builder's commands can make one in the copy that points out of it.
		const homes = [tree, realOf(tree), ...temp];
		const outside = asked
			.flatMap((p) => [p, realOf(p)])
			.find((p) => !homes.some((home) => inside(home, p)));
		return outside === undefined
			? null
			: `${outside} is outside your working copy. Read only inside ${tree}.`;
	}
	if (tool !== "Bash") return null;
	if (input.dangerouslyDisableSandbox === true)
		return "Every command runs in the sandbox here. Run it without asking to leave it.";
	const command = text(input.command) ?? "";
	if (TALKS.test(command))
		return "This run has no network and no account. Do not call GitHub, push, fetch or reach the network: code commits, pushes and opens the pull request after you, from your form.";
	return null;
}

/**
 * The builder's whole check on one tool call: the shared Check
 * (src/shell-guard.ts), then the builder's own rule above. The reason to
 * refuse, or `null`. The SDK path runs the two as its PreToolUse hooks
 * (`builderOptions`, ./builder.ts); the ACP path runs this as a command hook
 * (./check-hook.ts) and on each permission ask (./builder-acp.ts). One
 * function, so the paths cannot drift.
 */
export const builderCheck =
	(tree: string, temp: readonly string[]) =>
	(tool: string, input: Readonly<Record<string, unknown>>): string | null =>
		refusal({tree, alsoWritable: [...temp]}, tool, input) ??
		builderRefusal(tree, temp, tool, input);

/** One line of the check hook's log (./check-hook.ts): the tool, and why it was refused, `null` for an allow. Never the call's input. */
export interface Checked {
	readonly tool: string;
	readonly why: string | null;
}

/** The temp folders, by their real paths: on some systems the one named is a link. */
export const temps = (): readonly string[] => {
	const real = (p: string) => {
		// A folder that is not there is left out; nothing is guessed about it.
		try {
			return [realpathSync(p)];
		} catch {
			return [];
		}
	};
	return [...new Set([...real(tmpdir()), ...real("/tmp")])];
};

/** The files a login lives in, under the home folder. No folder the builder may read holds one. */
const LOGIN_FILES = [".git-credentials", ".config/gh", ".ssh", ".netrc", ".npmrc", ".aws"];
const loginFiles = () => LOGIN_FILES.map((file) => join(homedir(), file));

/** Folders under home that many programs keep things in: opening one opens them all. */
const SHARED = [".local", ".config", ".cache", "Library"];

/**
 * The folders under home the builder's commands run from: where `node` and
 * `pnpm` on the PATH are, with their links followed, where the node running
 * this process is, and pnpm's own folder. Each program's is the folder above
 * the one holding it, so a version manager's whole folder (Volta's shims and
 * the tools they start); the holding folder alone where the one above is home
 * or a shared one. The edge is Node's here: `process.execPath`, the PATH and
 * `process.platform`.
 */
export const toolchain = (
	env: Readonly<Record<string, string | undefined>> = process.env,
	exec: string = process.execPath,
): readonly string[] => {
	const home = homedir();
	const onPath = (name: string) =>
		(env.PATH ?? "")
			.split(delimiter)
			.filter((dir) => isAbsolute(dir))
			.map((dir) => join(dir, name))
			.find((path) => existsSync(path));
	const programs = [onPath("node"), onPath("pnpm"), exec].flatMap((p) =>
		p === undefined ? [] : [p, realOf(p)],
	);
	const roots = programs.flatMap((program) => {
		const holder = dirname(program);
		const above = dirname(holder);
		if (!inside(home, holder) || holder === home) return [];
		return [above === home || SHARED.some((s) => above === join(home, s)) ? holder : above];
	});
	return [...new Set([...roots, pnpmHome(env)])].filter(
		(root, _, all) => inside(home, root) && !all.some((o) => o !== root && inside(o, root)),
	);
};

/**
 * pnpm's own folder: the pnpm version a repo pins (`packageManager`) is
 * kept there, and its store. `PNPM_HOME`, or pnpm's default for the system.
 */
const pnpmHome = (env: Readonly<Record<string, string | undefined>>): string => {
	const home = homedir();
	if (env.PNPM_HOME !== undefined && env.PNPM_HOME !== "") return env.PNPM_HOME;
	if (process.platform === "darwin") return join(home, "Library", "pnpm");
	return join(env.XDG_DATA_HOME ?? join(home, ".local", "share"), "pnpm");
};

/** The clone's git folder a worktree's `.git` file leads to, which holds the worktree's own. None for a plain clone: its `.git` is in it. */
const gitOf = (tree: string): readonly string[] => {
	try {
		const line = readFileSync(join(tree, ".git"), "utf8").match(/^gitdir:\s*(.+)$/m);
		if (line?.[1] === undefined) return [];
		const own = resolve(tree, line[1].trim());
		const common = readFileSync(join(own, "commondir"), "utf8").trim();
		return [resolve(own, common)];
	} catch {
		// A plain clone, or no git at all: nothing outside the copy to open.
		return [];
	}
};

/**
 * Where the builder's commands may read and write, for the sandbox around
 * every Bash call. They write in the copy and the temp folders. The home
 * folder is unreadable but for the copy, the git folder the copy is a
 * worktree of, and the toolchain; the system's own folders, outside home,
 * stay readable. A folder that would open home or a login file is left out,
 * so a wrong toolchain fails a build instead of opening it.
 */
export const filesOf = (
	tree: string,
	temp: readonly string[] = temps(),
	tools: readonly string[] = toolchain(),
) => {
	const home = homedir();
	const opens = (path: string) =>
		inside(path, home) || loginFiles().some((login) => inside(path, login) || inside(login, path));
	return {
		allowWrite: [tree, ...temp],
		denyRead: [home],
		allowRead: [tree, ...gitOf(tree), ...temp, ...tools].filter((path) => !opens(path)),
	};
};

/**
 * The agent's environment as its commands need it inside `filesOf`, which
 * they inherit:
 *
 *   - PATH keeps only the folders they may read. A program is looked up in
 *     each folder in turn, and an unreadable one ends the lookup with EPERM
 *     instead of moving on: `git` under a PATH that starts with a folder in
 *     home is not found at all.
 *   - git and npm (pnpm reads npm's) are pointed at no user config. git stops
 *     on one it may not read ("unable to access ~/.gitconfig"), the builder
 *     never commits, and a user config can hold a login.
 *   - the config folder (`~/.config`, where git also looks for its ignore
 *     file) is an empty one: a program finds no settings of its own, as on a
 *     fresh machine, instead of failing to read them. `/var/empty` is the
 *     system's empty folder on a Mac and the BSDs; where it is not there, a
 *     setting is not found all the same.
 */
export const fencedEnv = (
	env: Readonly<Record<string, string>>,
	tools: readonly string[] = toolchain(env),
): Record<string, string> => {
	const home = homedir();
	const path = (env.PATH ?? "")
		.split(delimiter)
		.filter((dir) => isAbsolute(dir) && (!inside(home, dir) || tools.some((t) => inside(t, dir))));
	return {
		...env,
		...(env.PATH === undefined ? {} : {PATH: path.join(delimiter)}),
		GIT_CONFIG_GLOBAL: "/dev/null",
		NPM_CONFIG_USERCONFIG: "/dev/null",
		XDG_CONFIG_HOME: "/var/empty",
	};
};

/** The builder's tools: the whole list it has, and the only ones it may use. */
export const TOOLS: readonly string[] = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];
