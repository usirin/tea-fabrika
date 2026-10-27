// How a Claude run reads the rule files of the folder it works in: the way
// Claude Code ships it, and nothing else of the project (experiment 155,
// docs/direction/agents-read-rules-the-normal-way.md).
//
// `settingSources: ["project"]` is what turns on Claude Code's own loading of
// CLAUDE.md: the top file, its `@file` imports, `.claude/rules`, and a nested
// CLAUDE.md once a file in its folder is read. On its own it also loads the
// project's `.claude/settings.json`, and in experiment 155 that ran the
// project's hooks, handed its `env` to the agent and to every command, and
// ran its `apiKeyHelper`. So the project's settings, `.mcp.json` and
// `.claude` folders (skills, agents, commands) are read from another folder,
// `projectConfigRoot`, the system's empty one. The rule files still come from
// the working folder.
//
// `/var/empty` is there on a Mac and the BSDs and is owned by root, so no
// agent can put a settings file in it. Where it is not there, Claude Code
// does not start ("--project-config-root is not an existing directory"): a
// run fails, it never falls back to the project's settings.
//
// Claude Code reads AGENTS.md only through its built-in agents-md plugin, and
// by default only where a project has no CLAUDE.md of its own. Its
// `instructionFiles` option set to `claude-md-and-agents-md` loads AGENTS.md
// beside CLAUDE.md, nested ones too, the same way.

/** Where Claude Code reads a project's settings from instead of the working folder: the system's empty folder. */
export const NO_PROJECT_CONFIG = "/var/empty";

/** The built-in plugin option that loads AGENTS.md files beside CLAUDE.md. */
export const AGENTS_MD = {
	"cc-plugin-agents-md@builtin": {options: {instructionFiles: "claude-md-and-agents-md"}},
} as const;

/**
 * The Agent SDK options that load the working folder's rule files and none of
 * its settings. `settings` is the run's own flag settings; the AGENTS.md
 * option is added to them. Spread over the run's options, never beside a
 * `settingSources` or a `settings` of its own.
 */
export const ownRules = <S extends Readonly<Record<string, unknown>>>(settings: S) => ({
	settingSources: ["project" as const],
	projectConfigRoot: NO_PROJECT_CONFIG,
	settings: {...settings, pluginConfigs: AGENTS_MD},
});
