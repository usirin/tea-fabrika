import {existsSync, readFileSync, realpathSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {basename, delimiter, dirname, isAbsolute, join, relative, resolve} from "node:path";

// The sandbox a Claude Code agent works inside, as plain functions: its tool
// list, the folders its commands may read and write (the Agent SDK's
// `sandbox.filesystem`), and the environment they get. The builder runs inside
// it (the pipeline's build stage), and so does `acp --agent claude`
// (../acp/harness.ts). It imports nothing but Node, so a process that only
// checks a call (the build stage's check hook, run once per tool call) loads
// nothing else: about 50 ms a start instead of about 300. On
// `@kampus/fabrika/agents/sandbox`, with ./env.ts and ./shell-guard.ts.
//
// Until experiment 114 this was the build stage's `check.ts`. The builder's
// own rule on one tool call stayed there: only the build stage uses it.

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
export const gitOf = (tree: string): readonly string[] => {
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
	return {
		allowWrite: [tree, ...temp],
		denyRead: [homedir()],
		allowRead: [tree, ...gitOf(tree), ...temp, ...tools].filter((path) => !opensHome(path)),
	};
};

/** Would reading this folder open the home folder, or a file a login lives in? */
export const opensHome = (path: string) =>
	inside(path, homedir()) ||
	loginFiles().some((login) => inside(path, login) || inside(login, path));

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
