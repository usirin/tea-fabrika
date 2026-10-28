import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {Effect, FileSystem} from "effect";
import type {SystemPrompt} from "../agent/turn.ts";
import {agentEnv, type Env, runEnv} from "../claude/env.ts";
import {fencedEnv, filesOf, TOOLS, toolchain} from "../claude/sandbox.ts";
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
// the adapter's script by its path, and node's own binary to run it with.
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
//     `INITIAL_AGENT_MODE`; an ask comes to us, refused unless the line says.
//   - `CODEX_CONFIG`, merged into every session's config (`codexConfig`): the
//     shell gets only the core variables and no login shell, no web search,
//     Codex's features that reach past the folder off, and a permission
//     profile that makes home unreadable but for the folder and the toolchain.
//   - `NO_BROWSER`: no browser login is offered.
//
// What it does not hold, measured in experiment 153: writes in the temp
// folders are open (the adapter sends its own sandbox with every turn, and
// that one keeps them); reads outside home are open; there is no dollar cap
// and no typed answer field.

export const AGENTS = ["claude", "codex", "fake"] as const;
export type AgentName = (typeof AGENTS)[number];

export interface Harness extends Spawnable {
	readonly name: AgentName;
	/** `_meta` for session/new, load and resume. */
	readonly meta: Readonly<Record<string, unknown>> | undefined;
	/** The script the command runs: it must be there. */
	readonly script: string;
	/** What must be made before the command starts, when the harness needs anything. */
	readonly prepare?: Effect.Effect<void, string, FileSystem.FileSystem>;
}

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Where the pinned adapters are installed: `pnpm --dir adapters install --ignore-workspace --frozen-lockfile`. */
export const ADAPTERS = at("../../../../../adapters/node_modules/");

const CLAUDE = `${ADAPTERS}@agentclientprotocol/claude-agent-acp/dist/index.js`;
const CODEX = `${ADAPTERS}@agentclientprotocol/codex-acp/dist/index.js`;
const FAKE = at("./fake-agent.ts");

/**
 * The Codex home of a run in `folder`: one per folder, under home's cache,
 * where the agent's commands can neither read nor write (`codexConfig`).
 */
export const codexHomeOf = (folder: string, parent: Env = process.env) =>
	`${parent.HOME ?? ""}/.cache/tea-fabrika/codex/${createHash("sha256").update(folder).digest("hex").slice(0, 16)}`;

/** The modes a contained Codex may run in. `agent` lets a model answer the asks; full access has no sandbox. */
export const CODEX_MODES = ["read-only", "workspace-write"] as const;

/**
 * Merged into every Codex session's config by the adapter (`CODEX_CONFIG`).
 * The permission profile is the builder's `filesOf` for reads: home denied
 * but for the folder and the toolchain, and the adapters' own folder, where
 * the Codex that runs inside the box is.
 */
export const codexConfig = (folder: string, tools: readonly string[], home: string) => ({
	shell_environment_policy: {inherit: "core"},
	allow_login_shell: false,
	web_search: "disabled",
	default_permissions: "fenced",
	permissions: {
		fenced: {
			extends: ":workspace",
			filesystem: {
				[home]: "deny",
				...Object.fromEntries([...tools, ADAPTERS.replace(/\/$/, "")].map((t) => [t, "read"])),
				[folder]: "write",
			},
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

/** The Codex adapter's whole environment: a program's, its home, its mode and config. */
export const codexEnv = (
	parent: Env,
	folder: string,
	mode: (typeof CODEX_MODES)[number],
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
		INITIAL_AGENT_MODE: mode,
		CODEX_CONFIG: JSON.stringify({...codexConfig(folder, tools, parent.HOME ?? home), ...more}),
	};
};

/** The mode the codex row runs in. */
const CODEX_ROW_MODE = "workspace-write" satisfies (typeof CODEX_MODES)[number];

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
				env: codexEnv(parent, folder, CODEX_ROW_MODE, toolchain(parent), config),
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
	name: AgentName,
	folder: string,
	budget: number | null,
	parent: Env = process.env,
): Harness {
	switch (name) {
		case "claude":
			return {
				name,
				...node(CLAUDE),
				env: fencedEnv(agentEnv(parent)),
				script: CLAUDE,
				meta: {claudeCode: {options: claudeOptions(folder, budget)}},
			};
		case "codex":
			return {
				name,
				...node(CODEX),
				env: codexEnv(parent, folder, CODEX_ROW_MODE),
				script: CODEX,
				meta: undefined,
				prepare: codexHome(codexHomeOf(folder, parent), codexLogin(parent)),
			};
		case "fake":
			return {name, ...node(FAKE), env: runEnv(parent), script: FAKE, meta: undefined};
	}
}
