import {accessSync, constants, readdirSync, type Stats, statSync} from "node:fs";

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
// agent can put a settings file in it. Debian and Ubuntu do not ship it, and
// where it is not there Claude Code does not start ("--project-config-root is
// not an existing directory"): a run fails, it never falls back to the
// project's settings. A box image makes it (`MAKE_EMPTY_FOLDER`), and a live
// run checks it first (`emptyFolderRefusal`), so the failure names the fix.
//
// This file is the only place that may name `settingSources` with a source in
// it, or `projectConfigRoot` at all: `pnpm lint` refuses both anywhere else
// (biome-plugins/no-project-settings.grit). A live run checks its options
// again before Claude Code starts (`startRefusal`).
//
// Claude Code reads AGENTS.md only through its built-in agents-md plugin, and
// by default only where a project has no CLAUDE.md of its own. Its
// `instructionFiles` option set to `claude-md-and-agents-md` loads AGENTS.md
// beside CLAUDE.md, nested ones too, the same way.
//
// Node at the edge: the folder check reads the file system with `node:fs`.
// This file is on `@kampus/fabrika/agents/sandbox`, which loads no Effect and
// no Agent SDK.

/** Where Claude Code reads a project's settings from instead of the working folder: the system's empty folder. */
export const NO_PROJECT_CONFIG = "/var/empty";

/** How a machine or a box image gets the empty folder: made by root, so no agent can write in it. */
export const MAKE_EMPTY_FOLDER = `mkdir -p -m 0555 ${NO_PROJECT_CONFIG}`;

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

/** The part of a run's Agent SDK options that says where its settings come from. */
export interface SettingsFrom {
	readonly settingSources?: readonly string[] | undefined;
	readonly projectConfigRoot?: string | undefined;
}

const USE = `Load them with ownRules (@kampus/fabrika/agents/sandbox), or none with settingSources: [].`;

/**
 * Why these options would load settings a run must not have, or `null` when
 * they load none (`settingSources: []`) or only the folder's rule files
 * (`ownRules`). Pure. The Agent SDK loads every settings file when
 * `settingSources` is left out, so that is refused too.
 */
export const settingsRefusal = (options: SettingsFrom): string | null => {
	const sources = options.settingSources;
	if (sources === undefined)
		return `settingSources is not set, and the Agent SDK then loads every settings file: the user's, the project's and the local one. ${USE}`;
	if (sources.length === 0) return null;
	const others = sources.filter((source) => source !== "project");
	if (others.length > 0)
		return `settingSources names ${others.join(" and ")}, so the user's own or the local settings would load. ${USE}`;
	if (options.projectConfigRoot !== NO_PROJECT_CONFIG)
		return `settingSources names project, and projectConfigRoot is ${options.projectConfigRoot === undefined ? "not set" : `${options.projectConfigRoot}, not ${NO_PROJECT_CONFIG}`}, so the project's hooks, env and apiKeyHelper would load with its rules (experiment 155). ${USE}`;
	return null;
};

/** The folder's entries, or `null` when this process cannot list it. */
const entriesOf = (folder: string): readonly string[] | null => {
	try {
		return readdirSync(folder);
	} catch {
		return null;
	}
};

/** Whether this process may write in the folder. Root may write anywhere but on a read-only mount. */
const writable = (folder: string): boolean => {
	try {
		accessSync(folder, constants.W_OK);
		return true;
	} catch {
		return false;
	}
};

const statOf = (path: string): Stats | undefined => {
	try {
		return statSync(path, {throwIfNoEntry: false});
	} catch {
		return undefined;
	}
};

const FIX = `On a machine: sudo ${MAKE_EMPTY_FOLDER}. In a box image, as root before USER: RUN ${MAKE_EMPTY_FOLDER}.`;

/**
 * Why Claude Code cannot read a project's settings from `folder`, or `null`
 * when it can: the folder is there, holds nothing, and this process cannot
 * write in it, so neither can an agent it starts. Each answer names the fix.
 */
export const emptyFolderRefusal = (folder: string = NO_PROJECT_CONFIG): string | null => {
	const stat = statOf(folder);
	if (stat === undefined)
		return `${folder} is not on this machine, and Claude Code does not start without it: a run reads the project's settings from that empty folder (experiment 155). Debian and Ubuntu do not ship it. ${FIX}`;
	if (!stat.isDirectory())
		return `${folder} is not a folder, and Claude Code does not start without one: a run reads the project's settings from it. Remove it, then make the folder. ${FIX}`;
	const held = entriesOf(folder);
	if (held === null)
		return `${folder} cannot be listed by this process, and Claude Code does not start then. Make it readable: sudo chmod 0555 ${folder}.`;
	if (held.length > 0)
		return `${folder} is not empty (it holds ${held.join(", ")}), and Claude Code reads a project's settings from it. Remove what it holds.`;
	if (writable(folder))
		return `${folder} can be written by this process, so an agent it starts could put settings there for the next run. Make it root's and read-only: sudo chown root ${folder} && sudo chmod 0555 ${folder}. Root writes anywhere: run the agent as another user, or mount the folder read-only.`;
	return null;
};

/**
 * Why a live run must not start, or `null`: its options load settings they
 * must not (`settingsRefusal`), or they read them from the empty folder and
 * this machine's is not ready (`emptyFolderRefusal`).
 */
export const startRefusal = (options: SettingsFrom): string | null =>
	settingsRefusal(options) ??
	(options.projectConfigRoot === NO_PROJECT_CONFIG ? emptyFolderRefusal() : null);
