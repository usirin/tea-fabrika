import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Options, SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {type DraftRun, type Open, sdkRunner} from "@kampus/fabrika/agents/claude";
import {agentEnv} from "@kampus/fabrika/agents/sandbox";
import {Effect, Layer} from "effect";
import {sortDraft} from "./machine.ts";
import {type Settings, Sorter} from "./services.ts";

// The sorter: the one agent job of the sort stage. A ticket and the repo's other tickets and open
// plans go in; one answer comes out. It has no tool at all: everything it needs is in its prompt.
// No shell, no file, no network, no settings or connectors of the machine.
//
// Every try is a new conversation: the prompt is whole (./brief.ts), so a try taken over by another
// host, which has no conversation to continue, reads the same as one that was not.

/**
 * The Agent SDK options of one run: no tool, nothing loaded from the machine, a dollar cap. It
 * works in an empty folder, so it has no rule files to read (`ownRules`, experiment 155).
 */
export const sorterOptions = (settings: Settings, cwd: string): Options => ({
	cwd,
	env: agentEnv(),
	model: settings.model,
	effort: settings.effort,
	settingSources: [],
	strictMcpConfig: true,
	mcpServers: {},
	settings: {disableClaudeAiConnectors: true},
	permissionMode: "dontAsk",
	tools: [],
	allowedTools: [],
	persistSession: false,
	maxBudgetUsd: settings.budget,
});

export interface SorterConfig {
	/** Is shown every SDK message, for a log. */
	readonly seen?: (message: SDKMessage) => void;
	/** How the SDK's query is opened. A test stands a scripted one in. */
	readonly open?: Open;
}

/** The sorter on the Agent SDK, in an empty folder of its own that the layer removes. */
export const liveSorter = (config: SorterConfig = {}) =>
	Layer.effect(
		Sorter,
		Effect.gen(function* () {
			const cwd = yield* Effect.acquireRelease(
				Effect.tryPromise({
					try: () => mkdtemp(join(tmpdir(), "sort-")).then((made) => realpath(made)),
					catch: () => ({_tag: "no_temp_folder" as const}),
				}),
				(made) =>
					// oxlint-disable-next-line fabrika/no-effect-promise -- closing a scope has no way to fail with a typed error; a temp folder that cannot be removed is a bug
					Effect.promise(() => rm(made, {recursive: true, force: true})),
			);
			return Sorter.of({
				run: (run: DraftRun, settings: Settings) =>
					sdkRunner(sortDraft, () => sorterOptions(settings, cwd), {
						seen: (_run, message) => config.seen?.(message),
						...(config.open === undefined ? {} : {open: config.open}),
					})({
						id: "sort",
						type: "sort",
						deps: {...run, session: {...run.session, continues: false}},
					} as Sub<"sort", DraftRun>),
			});
		}),
	);
