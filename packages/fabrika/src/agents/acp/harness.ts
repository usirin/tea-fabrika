import {createHash} from "node:crypto";
import {readdirSync, realpathSync} from "node:fs";
import {basename, dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {Effect, FileSystem, Option} from "effect";
import type {SystemPrompt} from "../agent/turn.ts";
import {agentEnv, type Env, runEnv, toolHome} from "../claude/env.ts";
import {
	fencedEnv,
	filesOf,
	inside,
	LOGIN_FILES,
	opens,
	TOOLS,
	toolchain,
} from "../claude/sandbox.ts";
import type {Spawnable} from "./client.ts";

// The harnesses `acp --agent` can start, and how each is contained. Swapping
// the harness is this table and nothing else: the client, the fold and the
// program are the same for every row.
//
//   claude   Zed's Claude adapter, @agentclientprotocol/claude-agent-acp, pinned in adapters/
//   fake     ./fake-agent.ts: a scripted ACP agent, no model, for tests and CI
//
// Each adapter is installed apart from the workspace, at an exact version,
// with its own lockfile (adapters/package.json), and started from there by
// path: never `npx` of a latest. Node is touched here only to find files:
// the adapter's script by its path, node's own binary to run it with, and what
// is in home and where a link leads for Codex's profile (`localDisk`).
//
// Containment, as the builder has it (src/stages/build/builder.ts):
//
//   - the process gets `agentEnv()`: what a program needs and its login, no other variable.
//   - it runs in the scratch folder `acp --folder` names, never a repository.
//   - the Claude adapter is handed the builder's Agent SDK options through
//     `_meta.claudeCode.options` on every session/new, load and resume: no
//     settings files loaded by the SDK, no MCP server, no connector, the
//     builder's tools only, and the OS sandbox (no network, writes only in the
//     folder and the temp folders, home unreadable but for the folder and the
//     toolchain: `filesOf`). The adapter
//     spreads them over its own defaults.
//   - every permission ask is refused unless the line says otherwise (./program.ts).
//
// It loads no settings and so no rule files either: a builder on this row is
// handed the repository's rules as text in its prompt. The SDK runners read
// them themselves with `ownRules` (../claude/rules.ts, experiment 155), but
// the adapter pins an older Agent SDK (0.3.286) that experiment did not test,
// and an option it does not know would be dropped, loading the project's
// settings with the rules.
//
// What cannot cross: a PreToolUse hook and a custom spawn are functions, and
// `_meta` is JSON. The adapter itself still reads the owner's settings files
// for its own defaults (the permission mode among them): see experiment 76.
//
// The Codex adapter, @agentclientprotocol/codex-acp, pinned in adapters/ with
// the Codex it bundles (experiments 152 and 153):
//
//   - its own Codex home (`CODEX_HOME`) per folder, that holds one thing at
//     first: a link to the login file. The login is never read, copied or
//     moved. So the owner's `config.toml` (MCP servers, plugins, model) and
//     global `AGENTS.md` are not loaded, and no session is saved among the
//     owner's. The home is made before the adapter starts (`prepare`) and
//     kept, so a session can be opened again; whoever removes the folder
//     removes the home (`codexHomeOf`). It is under home, not the temp
//     folders: the agent's commands may write the temp folders, and a
//     `config.toml` written into its own home would be loaded at the next start.
//   - `HOME` is that home too: Codex also reads skills from `~/.agents`,
//     outside its own home.
//   - mode `read-only` or `workspace-write`, never `agent` (a model of
//     Codex's own answers the asks) and never full access. Set with
//     `INITIAL_AGENT_MODE`, from the row's `access`, which every caller
//     names: there is no default. An ask comes to us, refused unless the line says.
//   - `CODEX_CONFIG`, merged into every session's config (`codexConfig`): the
//     shell gets only the core variables and no login shell, no web search,
//     Codex's features that reach past the folder off, and a permission
//     profile that opens the folder and the toolchain and closes what is beside
//     them under home (`homeFence`).
//   - `NO_BROWSER`: no browser login is offered.
//
// What it does not hold, measured in experiment 153: writes in the temp
// folders are open (the adapter sends its own sandbox with every turn, and
// that one keeps them); reads outside home are open; there is no dollar cap
// and no typed answer field. Nor is home closed whole when something opened is
// under it: its names can be listed, and an entry made during a run that starts
// like a way down to an opened folder is open (`homeFence` says why).

export const AGENTS = ["claude", "codex", "fake"] as const;
export type AgentName = (typeof AGENTS)[number];

interface Started extends Spawnable {
	/** `_meta` for session/new, load and resume. */
	readonly meta: Readonly<Record<string, unknown>> | undefined;
	/** The script the command runs: it must be there. */
	readonly script: string;
	/** What must be made before the command starts, when the harness needs anything. */
	readonly prepare?: Effect.Effect<void, string, FileSystem.FileSystem>;
}

/** A row, ready to start. Codex's keeps the access it was made with, so its config can be made again (`withSystem`). */
export type Harness =
	| (Started & {readonly name: "claude" | "fake"})
	| (Started & {readonly name: "codex"; readonly access: FolderAccess});

/**
 * A row of the table, as a caller asks for it. Codex's names what its folder
 * allows, with no default: a turn that only reads cannot get a writable
 * folder because its author forgot to say.
 */
export type Row = "claude" | "fake" | {readonly name: "codex"; readonly access: FolderAccess};

/** The row's name. */
export const rowName = (row: Row): AgentName => (typeof row === "string" ? row : row.name);

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Where the pinned adapters are installed: `pnpm --dir adapters install --ignore-workspace --frozen-lockfile`. */
export const ADAPTERS = at("../../../../../adapters/node_modules/");

const CLAUDE = `${ADAPTERS}@agentclientprotocol/claude-agent-acp/dist/index.js`;
const CODEX = `${ADAPTERS}@agentclientprotocol/codex-acp/dist/index.js`;
const FAKE = at("./fake-agent.ts");

/** Under home, the folder that holds every Codex home. */
const CODEX_HOMES = ".cache/tea-fabrika/codex";

/**
 * The Codex home of a run in `folder`: one per folder, under home's cache,
 * where the agent's commands can neither read nor write (`codexConfig`).
 */
export const codexHomeOf = (folder: string, parent: Env = process.env) =>
	`${parent.HOME ?? ""}/${CODEX_HOMES}/${createHash("sha256").update(folder).digest("hex").slice(0, 16)}`;

/** The modes a contained Codex may run in. `agent` lets a model answer the asks; full access has no sandbox. */
export const CODEX_MODES = ["read-only", "workspace-write"] as const;

/** What a contained Codex may do in its folder: change it, or only read it. */
export type FolderAccess = "write" | "read";

/** The mode a Codex row starts in, by its access. */
const MODE_OF = {
	write: "workspace-write",
	read: "read-only",
} as const satisfies Record<FolderAccess, (typeof CODEX_MODES)[number]>;

/** One thing in a folder, by name. A link is told apart, so it is never followed. */
export interface Entry {
	readonly name: string;
	readonly link: boolean;
}

/** What a folder holds, or `null` when it cannot be read. */
export type Listing = (folder: string) => readonly Entry[] | null;

/** What the fence asks of the machine it is made on. All of it comes in here, so `homeFence` is pure. */
export interface Disk {
	readonly list: Listing;
	/** A path with every link followed and its spelling made plain, or `null` when it is not there. */
	readonly real: (path: string) => string | null;
	/** How many first characters of a name the box's patterns may close by. 0 lists every entry. */
	readonly depth: number;
}

/** The real disk, as a `Listing`. A read that fails is `null`. */
export const listFolder: Listing = (folder) =>
	Option.getOrNull(
		Option.liftThrowable(() =>
			readdirSync(folder, {withFileTypes: true}).map((entry) => ({
				name: entry.name,
				link: entry.isSymbolicLink(),
			})),
		)(),
	);

/**
 * How far to trust patterns on a system. Only a Mac's Seatbelt has been tested with them. Nothing
 * proves them elsewhere, and a pattern that matched nothing would leave a name open, so elsewhere
 * every entry is listed by name.
 */
export const depthFor = (platform: string) => (platform === "darwin" ? 2 : 0);

/** This machine, as a `Disk`: the one place the fence touches it. */
export const localDisk: Disk = {
	list: listFolder,
	real: (path) => Option.getOrNull(Option.liftThrowable(() => realpathSync.native(path))()),
	depth: depthFor(process.platform),
};

/** Under home, where a login is kept, and where each Codex home is made, some of them after the fence is. */
const LOGINS = [...LOGIN_FILES, ".codex/auth.json", CODEX_HOMES];

/** Closed whether it is there or not. `.codex` is not a login: its `packages` may be opened. */
const ALWAYS_CLOSED = [...LOGINS, ".codex"];

const plain = (path: string) => path.replace(/(?<=.)\/+$/, "");

const lines = <Rule>(paths: readonly string[], rule: Rule): Record<string, Rule> =>
	Object.fromEntries(paths.map((path) => [path, rule]));

/** Where a path really is, as far as it is there: a login may not be there yet, under a link that is. */
const realSoFar = (path: string, real: Disk["real"]): string => {
	const there = real(path);
	if (there !== null) return there;
	return dirname(path) === path ? path : join(realSoFar(dirname(path), real), basename(path));
};

/**
 * A path a key cannot name as it is: a pattern character, a quote, or a control character of one
 * byte. One of two bytes (U+0080 to U+009F) matches as itself, and `?` would not match it.
 */
const ODD = /[*?[\]"]|(?![\u0080-\u009f])\p{Cc}/u;

/**
 * The pattern that matches an odd path. A pattern character, and the two that mean something only
 * inside a pattern (a brace, a backslash), each stand in brackets. A control character and a quote
 * cannot, so `?` takes their place: it matches that one byte, and may close a name beside it too.
 */
const pattern = (path: string) =>
	path.replace(/[*?[\]{}\\]/g, "[$&]").replace(/"|(?![\u0080-\u009f])\p{Cc}/gu, "?");

/** The keys that close a path. A pattern closes one name and not what is in it, so an odd path takes two. */
const closing = (path: string): readonly string[] =>
	ODD.test(path) ? [pattern(path), `${pattern(path)}/**`] : [path];

/**
 * What may stand in a pattern: a class and `?` work by byte, so nothing of more than one byte, and
 * nothing a pattern reads.
 */
const IN_A_PATTERN = /^[A-Za-z0-9._ -]*$/;

/** A folder's path that may start a pattern as it is. */
const PATTERN_FOLDER = /^[A-Za-z0-9._ /-]*$/;

/**
 * The keys that close all that is in `dir` but the names `kept`. Each folder on the way down is a
 * few patterns instead of a line per entry, so the table is short and names little.
 *
 * A pattern closes what does not share a start with a kept name, up to `depth` characters. Past
 * that, entries that share the start are listed and closed by name. The box's class matches with no
 * regard to case, so the names are compared with none too. At depth 0 that is every entry.
 */
const closingAllBut = (
	dir: string,
	kept: readonly string[],
	names: readonly string[],
	depth: number,
): readonly string[] => {
	const keys = (key: string) => [key, `${key}/**`];
	const listed = (start: string) =>
		names
			.filter((name) => name.toLowerCase().startsWith(start.toLowerCase()) && !kept.includes(name))
			.flatMap((name) => closing(`${dir}/${name}`));
	const walk = (start: string, here: readonly string[]): readonly string[] => {
		const longer = here.filter((name) => name.length > start.length);
		if (longer.length === 0) return keys(`${dir}/${start}?*`);
		if (start.length >= depth) return listed(start);
		const next = [...new Set(longer.map((name) => name.charAt(start.length)))];
		// A dash in a class stands for itself only at its end.
		const set = [...next.filter((c) => c !== "-").sort(), ...next.filter((c) => c === "-")];
		// The start is an entry of its own, unless it is kept or names none: a key for `.` or `..`
		// breaks the box's profile.
		const hasOwnLine = !here.includes(start) && !["", ".", ".."].includes(start);
		return [
			...keys(`${dir}/${start}[!${set.join("")}]*`),
			...(hasOwnLine ? keys(`${dir}/${start}`) : []),
			...next.flatMap((c) =>
				walk(
					`${start}${c}`,
					longer.filter((name) => name.startsWith(`${start}${c}`)),
				),
			),
		];
	};
	return depth === 0 ? listed("") : walk("", kept);
};

/**
 * The profile's filesystem table: what is beside the opened folders is closed,
 * home itself is not. Pure: the machine comes in as `disk`.
 *
 * Seatbelt's deny on a folder refuses even `lstat` on that folder. Node's
 * `realpathSync` looks at every parent of a script, so closing home whole
 * stops every Node script under it, `pnpm` under `~/.volta` too, with
 * `EPERM: lstat '<home>'`. So walk down from home. An entry that is an opened
 * folder is left alone, one that holds an opened folder is walked into, and
 * every other entry is closed. A folder that cannot be read is closed.
 *
 * The table is of real paths, for Codex follows links: `~/t` linking to `~/.ssh`,
 * as a tool, used to open `~/.ssh/id_x` past the narrower deny. So home, the folder
 * and every read line are resolved first. A line whose real path would open home
 * or a login opens nothing (`opens`), and neither does one that is not there or
 * one inside a login's real target: each gets no line and counts for nothing, so
 * a `PNPM_HOME` of home, or a Codex at `~/codex`, cannot undo the lines that close
 * home. A login is closed at its real target as well as its written path, so a
 * `.ssh` that links into the opened folder is closed. A link in a folder walked
 * is closed like any entry and never walked through, so a folder named through a
 * link in home (`~/dev` linking to `~/work`, the folder `~/dev/copy`) has its real
 * path opened and that link closed: Codex starts and work in the folder runs, and a
 * command that names the folder by the link is refused. With nothing else opened
 * under home, home is closed whole, for nothing under it needs to run.
 *
 * Codex reads a key with one of `* ? [ ]` in it as a pattern, and a key with a
 * control character matches nothing (Codex 0.165.0, in `codex sandbox`, by
 * hand and in the tests). So an odd path is closed by `closing`. Written plainly
 * it would stay readable, and `Icon\r` is a common file name on a Mac. An odd
 * path cannot be opened by a key at all: Codex refuses a pattern that opens,
 * and `/**` does not make the part before it plain. So it gets no line. It does
 * not need one: the walk leaves it alone, reads are open where nothing closes
 * them, and `:workspace` makes the working folder writable by itself.
 *
 * A folder is closed by patterns as far as `disk.depth` allows (`closingAllBut`).
 * If its own path or a way down holds anything a pattern cannot carry
 * (`IN_A_PATTERN`), every entry in it is listed by name, which is also all there is
 * at depth 0. A table the box could not take is refused before it starts (`fenceTooBig`).
 *
 * This is weaker than a whole closed home, in two ways. A command can list the
 * names in home and in each folder on the way down to an opened one. An
 * entry made after this table that shares its first characters with a way down
 * is open. We accept both: the names are not secrets, and the entries that hold
 * logins exist before a run starts. `ALWAYS_CLOSED` covers one that does not. See
 * docs/direction/codex-box-home-listing.md.
 */
export const homeFence = (
	home: string,
	reads: readonly string[],
	folder: string,
	access: FolderAccess,
	disk: Disk,
): Record<string, FolderAccess | "deny"> => {
	const root = disk.real(plain(home)) ?? plain(home);
	const targets = (paths: readonly string[]) =>
		paths.map((path) => realSoFar(`${root}/${path}`, disk.real));
	const loginTargets = targets(LOGINS);
	const opensNothing = (path: string) =>
		opens(path, root, LOGINS) || loginTargets.some((target) => inside(target, path));
	const realLine = (path: string) => {
		const there = disk.real(plain(path));
		return there === null || opensNothing(there) ? [] : [there];
	};
	const tools = reads.flatMap(realLine);
	const own = realLine(folder);
	const opened = [...tools, ...own];
	const holdsOpened = (path: string) => opened.some((open) => open.startsWith(`${path}/`));
	const nameable = (path: string) => !ODD.test(path);
	const beside = (dir: string): readonly string[] => {
		const entries = disk.list(dir);
		if (entries === null) return closing(dir);
		const ways = entries.filter(({name, link}) => {
			const path = `${dir}/${name}`;
			return !link && (opened.includes(path) || holdsOpened(path));
		});
		const kept = ways.map(({name}) => name);
		const plainEnough =
			PATTERN_FOLDER.test(dir) &&
			kept.every((name) => IN_A_PATTERN.test(name.slice(0, disk.depth)));
		return [
			...closingAllBut(
				dir,
				kept,
				entries.map(({name}) => name),
				plainEnough ? disk.depth : 0,
			),
			...kept
				.map((name) => `${dir}/${name}`)
				.filter((path) => !opened.includes(path))
				.flatMap(beside),
		];
	};
	return {
		...lines(holdsOpened(root) ? beside(root) : closing(root), "deny"),
		...lines(tools.filter(nameable), "read"),
		...lines(own.filter(nameable), access),
		// Last, so a login stays closed even if something asks to open it. One that holds an opened
		// folder is not closed whole, for the same reason as home: the walk closed what is in it.
		...lines(
			[...ALWAYS_CLOSED.map((path) => `${root}/${path}`), ...targets(ALWAYS_CLOSED)]
				.filter((path) => !holdsOpened(path))
				.flatMap(closing),
			"deny",
		),
	};
};

/**
 * The most lines a table may hold. Too many and Codex's box runs nothing (Codex 0.165.0 on a Mac):
 * patterns stop it somewhere past 750 lines, plain names at about 1,900. Its answer comes per command
 * and reads like a broken tool, so we say it first. Patterns cost more the deeper they are, and those
 * can stop it under this limit too. No real table has that many, and the box runs nothing then either.
 * Off a Mac nothing has been measured, so the same number stands.
 */
export const FENCE_LIMIT = 600;

/** What to say when a table is over the limit, or `null` when it fits. Counts only: it names no entry. */
export const fenceTooBig = (table: Readonly<Record<string, unknown>>): string | null => {
	const count = Object.keys(table).length;
	return count > FENCE_LIMIT
		? `Codex's box would need ${count} lines to close what is beside the opened folders, and it takes at most ${FENCE_LIMIT}. Nothing was started. Use a folder with fewer names beside it.`
		: null;
};

/**
 * Merged into every Codex session's config by the adapter (`CODEX_CONFIG`).
 * The permission profile opens the folder, the toolchain, and the adapters'
 * own folder, where the Codex that runs inside the box is, and closes what is
 * beside them under home (`homeFence`). The folder is writable
 * (`access: "write"`), or only readable for a turn that reads code and
 * changes nothing (`access: "read"`). There is no default: every caller says.
 */
export const codexConfig = (
	folder: string,
	tools: readonly string[],
	home: string,
	access: FolderAccess,
	/** How home is read and links are followed, for what the profile opens and closes (`homeFence`). */
	disk: Disk,
	/** Core variables only, plus this: where a version manager holds the real tools (`toolHome`). */
	set: Readonly<Record<string, string>> = {},
) => ({
	shell_environment_policy: {inherit: "core", ...(Object.keys(set).length > 0 ? {set} : {})},
	allow_login_shell: false,
	web_search: "disabled",
	default_permissions: "fenced",
	permissions: {
		fenced: {
			// `:workspace` makes the working folder writable whatever the folder's own line says
			// (experiment 163, part 3), so a read turn starts from `:read-only`.
			extends: access === "write" ? ":workspace" : ":read-only",
			filesystem: homeFence(home, [...tools, ADAPTERS.replace(/\/$/, "")], folder, access, disk),
		},
	},
	// Codex's own features that reach past the folder, on by default in a fresh home (codex 0.159.3).
	features: {
		apps: false,
		plugins: false,
		remote_plugin: false,
		browser_use: false,
		browser_use_external: false,
		in_app_browser: false,
		computer_use: false,
		image_generation: false,
		multi_agent: false,
		tool_suggest: false,
		skill_mcp_dependency_install: false,
		goals: false,
	},
});

/** The owner's login file, by where Codex keeps it. Only ever linked to. */
const codexLogin = (parent: Env) =>
	`${parent.CODEX_HOME ?? `${parent.HOME ?? ""}/.codex`}/auth.json`;

/**
 * Whether a Codex login is the plan's and holds no API key, by two of its
 * fields and nothing else: a run on the plan is never billed to a key. Codex
 * can move from a plan login to a key it has stored, quietly (openai/codex
 * issue 40871). Only the answer leaves here, never a value of the file.
 */
export const planLogin = (text: string): "plan" | "not_json" | "not_plan" | "has_key" => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return "not_json";
	}
	if (typeof parsed !== "object" || parsed === null) return "not_json";
	const {auth_mode: mode, OPENAI_API_KEY: key} = parsed as Record<string, unknown>;
	if (mode !== "chatgpt") return "not_plan";
	return key === undefined || key === null || key === "" ? "plan" : "has_key";
};

const PLAN_REFUSED = {
	not_json: "the codex login file is not one codex wrote: run `codex login`",
	not_plan: "the codex login is not a ChatGPT plan login: this row runs only on the plan",
	has_key:
		"the codex login holds an API key: a plan run could be billed to it; run `codex logout` and `codex login`",
} as const;

/**
 * Make the Codex home: a folder holding a link to the login, nothing else.
 * Kept when there; refused when its `auth.json` is anything but that link,
 * or when the login is not the plan's or holds a key (`planLogin`).
 */
export const codexHome = (home: string, login: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const link = `${home}/auth.json`;
		const there = yield* fs.exists(login).pipe(Effect.orElseSucceed(() => false));
		if (!there)
			return yield* Effect.fail("codex is not signed in on this machine: run `codex login`");
		const plan = planLogin(yield* fs.readFileString(login).pipe(Effect.orElseSucceed(() => "")));
		if (plan !== "plan") return yield* Effect.fail(PLAN_REFUSED[plan]);
		yield* fs.makeDirectory(home, {recursive: true, mode: 0o700}).pipe(Effect.mapError(String));
		const linked = yield* fs.readLink(link).pipe(Effect.option);
		if (linked._tag === "Some") {
			if (linked.value === login) return;
			return yield* Effect.fail(`${link} links somewhere else`);
		}
		if (yield* fs.exists(link).pipe(Effect.orElseSucceed(() => false)))
			return yield* Effect.fail(`${link} is a file, not a link to the login`);
		yield* fs.symlink(login, link).pipe(Effect.mapError(String));
	});

/** The config a Codex row's session starts from, for its folder and its home. */
const rowConfig = (parent: Env, folder: string, access: FolderAccess, tools: readonly string[]) =>
	codexConfig(
		folder,
		tools,
		parent.HOME ?? codexHomeOf(folder, parent),
		access,
		localDisk,
		toolHome(parent),
	);

/** Fails, saying why, when the row's table is more than the box can take. */
const fenceFits = (parent: Env, folder: string, access: FolderAccess) =>
	Effect.suspend(() => {
		const config = rowConfig(parent, folder, access, toolchain(parent));
		const tooBig = fenceTooBig(config.permissions.fenced.filesystem);
		return tooBig === null ? Effect.void : Effect.fail(tooBig);
	});

/** The Codex adapter's whole environment: a program's, its home, its mode and config, both by `access`. */
export const codexEnv = (
	parent: Env,
	folder: string,
	access: FolderAccess,
	tools: readonly string[] = toolchain(parent),
	/** More config on top, as a turn's system prompt (`codexSystem`). */
	more: Readonly<Record<string, unknown>> = {},
): Record<string, string> => {
	const home = codexHomeOf(folder, parent);
	return {
		...runEnv(parent),
		...(parent.USER === undefined ? {} : {USER: parent.USER}),
		HOME: home,
		CODEX_HOME: home,
		NO_BROWSER: "1",
		INITIAL_AGENT_MODE: MODE_OF[access],
		CODEX_CONFIG: JSON.stringify({
			...rowConfig(parent, folder, access, tools),
			...more,
		}),
	};
};

// ---------------------------------------------------------------- a turn's system prompt, in each maker's way

/**
 * The Agent SDK's `systemPrompt` for a turn's: Claude Code's own preset with
 * ours appended, or ours alone as a custom prompt (the SDK's `Options`
 * docs). The same for the SDK adapter and for ACP's Claude row, which spreads
 * `_meta.claudeCode.options` over its own default, the bare preset.
 *
 * `snapshot: false`, so a resumed turn gets its own prompt. By default the SDK
 * records a session's first prompt and sends that record on every later
 * request and resume, ignoring the text a later turn passes (the `systemPrompt`
 * docs of SDK 0.3.296; 0.3.286, which ACP's row pins, has the same field).
 * Codex exec takes the turn's on every turn already.
 */
export const claudeSystem = (system: SystemPrompt) =>
	system._tag === "append"
		? ({type: "preset", preset: "claude_code", append: system.text, snapshot: false} as const)
		: ({type: "custom", prompt: system.text, snapshot: false} as const);

/**
 * Codex's config for a turn's system prompt, and the file it names, if any.
 * `developer_instructions` is a developer message on top of Codex's own
 * instructions; `model_instructions_file` replaces them, and is read from a
 * file (Codex's config reference). The file goes in Codex's own home, which
 * the agent's commands can neither read nor write (`codexConfig`).
 *
 * The file is named by a hash of its text. A home can be shared: ACP's is one
 * per folder, so two sessions on one folder have one home. With one fixed
 * name, the second session's prompt would overwrite the first's before the
 * first Codex read it. Named by its text, a file only ever holds that text,
 * so no session can change another's prompt.
 */
export const codexSystem = (
	system: SystemPrompt,
	home: string,
): {
	readonly config: Readonly<Record<string, string>>;
	readonly file: {readonly path: string; readonly text: string} | null;
} => {
	if (system._tag === "append") return {config: {developer_instructions: system.text}, file: null};
	const path = `${home}/system-${createHash("sha256").update(system.text).digest("hex").slice(0, 16)}.md`;
	return {config: {model_instructions_file: path}, file: {path, text: system.text}};
};

/**
 * Write the file `codexSystem` names, if it names one, before Codex starts.
 * It goes to a fresh file first and is then renamed into place, so a Codex
 * reading the name sees the whole text or no file, never half of it.
 */
export const writeSystem = (file: ReturnType<typeof codexSystem>["file"]) =>
	Effect.gen(function* () {
		if (file === null) return;
		const fs = yield* FileSystem.FileSystem;
		const dir = file.path.slice(0, file.path.lastIndexOf("/"));
		const fresh = yield* fs.makeTempFile({directory: dir, prefix: ".system-"});
		yield* fs.writeFileString(fresh, file.text, {mode: 0o600});
		yield* fs.chmod(fresh, 0o600);
		yield* fs.rename(fresh, file.path);
	}).pipe(Effect.mapError(String));

/**
 * A row, told a turn's system prompt. ACP has no system prompt field, so each
 * row is told in its own adapter's way: the Claude row in its
 * `_meta.claudeCode.options` (set where the adapter builds them,
 * ../acp/adapter.ts, with `claudeSystem`), the Codex row in `CODEX_CONFIG`,
 * and the fake in `_meta.system`, which it notes in its log.
 */
export const withSystem = (
	harness: Harness,
	system: SystemPrompt,
	folder: string,
	parent: Env = process.env,
): Harness => {
	switch (harness.name) {
		case "claude":
			return harness;
		case "codex": {
			const {config, file} = codexSystem(system, codexHomeOf(folder, parent));
			const prepare = harness.prepare ?? Effect.void;
			return {
				...harness,
				env: codexEnv(parent, folder, harness.access, toolchain(parent), config),
				prepare: Effect.andThen(prepare, writeSystem(file)),
			};
		}
		case "fake":
			return {...harness, meta: {...harness.meta, system}};
	}
};

/** The Agent SDK options the Claude adapter is handed, the builder's own less what is a function. */
export const claudeOptions = (folder: string, budget: number | null) => ({
	settingSources: [],
	strictMcpConfig: true,
	mcpServers: {},
	settings: {disableClaudeAiConnectors: true},
	allowDangerouslySkipPermissions: false,
	tools: [...TOOLS],
	sandbox: {
		enabled: true,
		failIfUnavailable: true,
		autoAllowBashIfSandboxed: true,
		allowUnsandboxedCommands: false,
		network: {allowedDomains: [], strictAllowlist: true},
		filesystem: filesOf(folder),
	},
	...(budget === null ? {} : {maxBudgetUsd: budget}),
});

/** Node, warnings about its own experimental parts off: they go to stderr, which nobody reads. */
const node = (script: string): Pick<Spawnable, "command" | "args"> => ({
	command: process.execPath,
	args: ["--disable-warning=ExperimentalWarning", script],
});

export function harnessOf(
	row: Row,
	folder: string,
	budget: number | null,
	parent: Env = process.env,
): Harness {
	if (typeof row !== "string")
		return {
			name: row.name,
			access: row.access,
			...node(CODEX),
			env: codexEnv(parent, folder, row.access),
			script: CODEX,
			meta: undefined,
			prepare: Effect.andThen(
				fenceFits(parent, folder, row.access),
				codexHome(codexHomeOf(folder, parent), codexLogin(parent)),
			),
		};
	switch (row) {
		case "claude":
			return {
				name: row,
				...node(CLAUDE),
				env: fencedEnv(agentEnv(parent)),
				script: CLAUDE,
				meta: {claudeCode: {options: claudeOptions(folder, budget)}},
			};
		case "fake":
			return {name: row, ...node(FAKE), env: runEnv(parent), script: FAKE, meta: undefined};
	}
}
