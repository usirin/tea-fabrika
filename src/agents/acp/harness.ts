import {fileURLToPath} from "node:url";
import {agentEnv, type Env, runEnv} from "../../env.ts";
import {loginFiles, TOOLS, temps} from "../../stages/build/check.ts";
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
//     folder and the temp folders, the login files unreadable). The adapter
//     spreads them over its own defaults.
//   - every permission ask is refused unless the line says otherwise (./program.ts).
//
// What cannot cross: a PreToolUse hook and a custom spawn are functions, and
// `_meta` is JSON. The adapter itself still reads the owner's settings files
// for its own defaults (the permission mode among them): see experiment 76.
//
// Not listed: codex-acp. It loads the owner's ~/.codex config (its MCP
// servers and plugins) whatever `CODEX_CONFIG` says, and pointed at an empty
// CODEX_HOME it has no login. It cannot be contained the builder's way, so
// it is not run.

export const AGENTS = ["claude", "fake"] as const;
export type AgentName = (typeof AGENTS)[number];

export interface Harness extends Spawnable {
	readonly name: AgentName;
	/** `_meta` for session/new, load and resume. */
	readonly meta: Readonly<Record<string, unknown>> | undefined;
	/** The script the command runs: it must be there. */
	readonly script: string;
}

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Where the pinned adapters are installed: `pnpm --dir adapters install --ignore-workspace --frozen-lockfile`. */
export const ADAPTERS = at("../../../adapters/node_modules/");

const CLAUDE = `${ADAPTERS}@agentclientprotocol/claude-agent-acp/dist/index.js`;
const FAKE = at("./fake-agent.ts");

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
		filesystem: {allowWrite: [folder, ...temps()], denyRead: loginFiles()},
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
				env: agentEnv(parent),
				script: CLAUDE,
				meta: {claudeCode: {options: claudeOptions(folder, budget)}},
			};
		case "fake":
			return {name, ...node(FAKE), env: runEnv(parent), script: FAKE, meta: undefined};
	}
}
