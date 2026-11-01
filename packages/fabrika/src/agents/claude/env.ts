// The environment a process this repo starts may have. A child process is
// handed its parent's whole environment unless it is given one, so every key
// set on the machine was readable by an agent with a shell, and by a test
// file an agent wrote. Here the environment is a keep-list of names instead:
// a variable that is not named is not handed on.
//
// This takes variables away and nothing else. A process still reads the files
// its user can read.

/** The environment of a parent process, or of a test standing in for one. */
export type Env = Readonly<Record<string, string | undefined>>;

/** What a program needs to run at all: where programs are, the home folder, the temp folder, the locale. */
const RUN = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];

/**
 * How `claude` finds its own login. Where the login is kept in the system's
 * keychain it is looked up under `USER`: without it an agent starts signed
 * out. The other three are where a login is when it is not in the keychain: a
 * key or a token of its own, or a settings folder that was moved.
 */
const LOGIN = ["USER", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"];

/** Where git finds a key that an ssh agent holds, for a shell that pushes its branch. A socket's path, not a key. */
const PUSH = ["SSH_AUTH_SOCK"];

const kept = (names: readonly string[], parent: Env): Record<string, string> =>
	Object.fromEntries(
		names.flatMap((name) => {
			const value = parent[name];
			return value === undefined ? [] : [[name, value]];
		}),
	);

/** Volta's folder of shims on a PATH: `<anything>/.volta/bin`, an absolute path. Volta's default place. */
const VOLTA_ON_PATH = /(?:^|:)(\/[^:]*\/\.volta)\/bin\/?(?::|$)/;

/**
 * Where a version manager holds the real tools, for a process given another home. A Volta shim
 * looks for them under the home folder unless this says where they are. Under another home it finds
 * none, looks along the PATH for the real tool, finds itself, and waits on the child it starts: a
 * chain that grows to the user's process limit. With a Volta pin it says "Could not download"
 * instead. So its folder on the PATH brings its home, set in the parent or not. The chain still
 * happens for `VOLTA_HOME=""`, another `VOLTA_HOME`, or a shim's folder not named `.volta`, and no
 * box caps its processes: docs/direction/codex-box-home-listing.md.
 */
export const toolHome = (parent: Env = process.env): Record<string, string> => {
	const home = parent.VOLTA_HOME ?? VOLTA_ON_PATH.exec(parent.PATH ?? "")?.[1];
	return home === undefined ? {} : {VOLTA_HOME: home};
};

/** For a program that runs code a ticket or an agent wrote: a test file, an install, a typecheck. */
export const runEnv = (parent: Env = process.env) => ({...kept(RUN, parent), ...toolHome(parent)});

/** For an agent's own process: what a program needs, and its login. */
export const agentEnv = (parent: Env = process.env) => ({
	...runEnv(parent),
	...kept(LOGIN, parent),
});

/** For a shell, the one agent that pushes: an agent's, and where git finds its key. */
export const shellEnv = (parent: Env = process.env) => ({
	...agentEnv(parent),
	...kept(PUSH, parent),
});

/** Where `gh` finds its login: the keychain (under `USER`), a moved settings folder, or a token. */
const HOST = ["USER", "GH_CONFIG_DIR", "GH_TOKEN", "GITHUB_TOKEN"];

/**
 * For code's own `git` and `gh`, never an agent's and never code a ticket
 * wrote: the build stage's clone, push and pull request. What a program needs,
 * where `gh` finds its login, and where git finds its key.
 */
export const hostEnv = (parent: Env = process.env) => ({
	...runEnv(parent),
	...kept([...HOST, ...PUSH], parent),
});
