import {realpathSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {isAbsolute, join, relative, resolve} from "node:path";
import {
	getSessionInfo,
	type HookCallback,
	type Options,
	type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {Clock, Effect, Layer, Stream} from "effect";
import {createDraft, type DraftRun, noSpend, type Open, sdkRunner} from "../../draft.ts";
import {agentEnv} from "../../env.ts";
import {guardHook} from "../../shell-guard.ts";
import {sdkTrace} from "../../trace/agent.ts";
import type {Refused} from "../review/reviewer.ts";
import {
	type BuildBrief,
	type BuildDrafted,
	Builder,
	Built,
	type Ran,
	type Settings,
} from "./form.ts";
import {guarded, lockOf} from "./guarded.ts";

// The builder: the one agent job of this stage. A brief goes in, a form comes
// out, and the working copy is changed. It is started the way every agent
// here is (`createDraft` and `sdkRunner`, src/draft.ts).
//
// It works in one working copy and nowhere else, and it cannot reach the
// network or any account. Three holds, each at a different layer:
//
//   1. the operating system: the SDK's sandbox runs every Bash command with
//      writes only to the copy and the temp folders, no network at all, and
//      the login files (git's, gh's, ssh's) unreadable. `failIfUnavailable`:
//      where the sandbox cannot start, the run does not start either. No
//      command may leave it (`allowUnsandboxedCommands: false`).
//   2. the Check before each tool call (src/shell-guard.ts): writes only in
//      the copy, no merge, no push to main, no approval; and here, beside it,
//      reads only in the copy and the temp folders, and no command that talks
//      to GitHub or the network by name.
//   3. its environment: an agent's short one (src/env.ts). It holds the
//      agent's own login and no gh or git one.
//
// It never commits, pushes or opens anything: code does, after it, from its
// form (./machine.ts). It may run the repo's checks (typecheck, lint, tests)
// inside the sandbox, and says which it ran.
//
// Its process runs under a guard (./guard.ts): it stops when the run that
// started it ends, a `kill -9` too, and no second builder starts in a copy
// whose builder is still alive. Started again after a restart, it carries the
// round's conversation on (`BuildBrief.session`) instead of starting over.

export const builderDraft = createDraft({name: "builder", output: Built});

/** A text in a code fence longer than any run of backticks inside it, so nothing in the text can close it. */
function fenced(text: string, word = ""): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}${word}\n${text.replace(/\n+$/, "")}\n${fence}`;
}

/** What the builder is sent. Pure: the same brief gives the same text. */
export function promptOf(brief: BuildBrief): string {
	const criteria = brief.criteria.map((c) => `${c.n}. ${c.text}`);
	const open =
		brief.open.length === 0
			? []
			: [
					"# What the last review left open",
					"",
					`This is round ${brief.round}. The change on this branch was reviewed after the round before, and these were left open. Close each one. Change only what closing them needs; what the review found met stays as it is.`,
					"",
					...brief.open.flatMap((item) => [
						`- ${item.n === 0 ? "" : `Criterion ${item.n}: `}${item.text}`,
						`  - Why it is open: ${item.says.replace(/\s+/g, " ")}`,
						...(item.where.length === 0 ? [] : [`  - Where: ${item.where.join(", ")}`]),
						...item.wants.map((want) => `  - Wants: ${want.replace(/\s+/g, " ")}`),
					]),
					"",
				];
	return [
		`You are building one ticket: ${brief.ticket}, "${brief.title}". Round ${brief.round}.`,
		"",
		`Your working folder is a copy of the repository on the branch ${brief.branch}. Change the code there so the ticket's acceptance criteria hold. You have Read, Grep, Glob, Edit, Write and Bash. Bash runs in a sandbox: it can write only in your folder and the temp folder, and it has no network. Do not try to commit, push, open a pull request or call GitHub: you cannot, and code does all of that after you, from your form.`,
		"",
		"# How to work",
		"",
		"Read the ticket and the code around what it names first. Make the smallest change that meets every criterion. Add or change tests where the criteria ask for behaviour. Then run the repository's own checks for what you touched: its typecheck, its lint, and the tests near your change (look in package.json for the commands; prefix heavy ones with `nice -n 19`). Fix what they find. Dependencies are already installed; there is no network to install more.",
		"",
		"Where the ticket asks for something you cannot do here, or where you chose to do something other than it says, say so in the form: that is a deviation, and a reviewer reads it.",
		"",
		...open,
		"# The ticket's acceptance criteria",
		"",
		...criteria,
		"",
		"# The ticket",
		"",
		fenced(brief.body, "markdown"),
		"",
		"# The form",
		"",
		"Fill it once, at the very end.",
		"",
		"`summary`: what the change does, in a few plain sentences. It becomes the pull request's text.",
		"`deviations`: each place the change does something other than the ticket asks, and why. Empty when there is none.",
		"`ran`: each check you ran at the end, as the command, and whether it passed.",
		"`left`: what you could not do, and why. Empty when nothing.",
	].join("\n");
}

// ---------------------------------------------------------------- the holds

const inside = (folder: string, path: string) => {
	const rel = relative(folder, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
		const asked = [text(input.file_path), text(input.path)].flatMap((p) =>
			p === null ? [] : [resolve(tree, p)],
		);
		const outside = asked.find((p) => !inside(tree, p) && !temp.some((t) => inside(t, p)));
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

/** The temp folders, by their real paths: on some systems the one named is a link. */
const temps = (): readonly string[] => {
	const real = (p: string) => {
		// biome-ignore lint/plugin: a folder that is not there is left out; nothing is guessed about it
		try {
			return [realpathSync(p)];
		} catch {
			return [];
		}
	};
	return [...new Set([...real(tmpdir()), ...real("/tmp")])];
};

/** The files a login lives in, under the home folder. The sandbox makes them unreadable to every command. */
const LOGIN_FILES = [".git-credentials", ".config/gh", ".ssh", ".netrc", ".npmrc", ".aws"];
const loginFiles = () => LOGIN_FILES.map((file) => join(homedir(), file));

const TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "Bash"];

/**
 * The Agent SDK options of one run. `tools` is the whole list; no settings are
 * loaded from the machine or from the copy; no server of tools is offered,
 * and the account's connectors are turned off. The sandbox and the two
 * Checks are above.
 */
export const builderOptions = (
	settings: Settings,
	tree: string,
	refused: (tool: string, why: string) => void,
	/** How `claude` is started: under its guard (./guarded.ts). */
	spawn?: Options["spawnClaudeCodeProcess"],
): Options => {
	const temp = temps();
	const own: HookCallback = async (input) => {
		if (input.hook_event_name !== "PreToolUse") return {};
		const why = builderRefusal(
			tree,
			temp,
			input.tool_name,
			(input.tool_input ?? {}) as Record<string, unknown>,
		);
		if (why === null) return {};
		refused(input.tool_name, why);
		return {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: why,
			},
		};
	};
	return {
		cwd: tree,
		env: agentEnv(),
		model: settings.model,
		effort: settings.effort,
		settingSources: [],
		strictMcpConfig: true,
		mcpServers: {},
		settings: {disableClaudeAiConnectors: true},
		// Kept on disk, so a builder started again in the same round can carry
		// its conversation on (`BuildBrief.session`).
		persistSession: true,
		...(spawn === undefined ? {} : {spawnClaudeCodeProcess: spawn}),
		permissionMode: "dontAsk",
		tools: [...TOOLS],
		allowedTools: [...TOOLS],
		sandbox: {
			enabled: true,
			failIfUnavailable: true,
			autoAllowBashIfSandboxed: true,
			allowUnsandboxedCommands: false,
			network: {allowedDomains: [], strictAllowlist: true},
			filesystem: {allowWrite: [tree, ...temp], denyRead: loginFiles()},
		},
		hooks: {
			PreToolUse: [{hooks: [guardHook({tree, alsoWritable: [...temp]}, refused), own]}],
		},
		maxBudgetUsd: settings.budget,
	};
};

// ---------------------------------------------------------------- the service

/** Where a live builder is watched. A setting of the service, not of a build. */
export interface BuilderConfig {
	readonly seen?: (message: SDKMessage) => void;
	/** How the SDK's query is opened. A test stands a scripted one in. */
	readonly open?: Open;
	/** Whether a conversation is kept under `session` for the copy `tree`. A test stands its own in. */
	readonly kept?: (session: string, tree: string) => Effect.Effect<boolean>;
}

/** A conversation the SDK kept on disk for this copy, under this name. */
const keptOnDisk = (session: string, tree: string): Effect.Effect<boolean> =>
	Effect.tryPromise({
		try: () => getSessionInfo(session, {dir: tree}),
		// Unreadable is the same answer as not kept: the run starts the conversation anew.
		catch: () => "unread" as const,
	}).pipe(
		Effect.map((info) => info !== undefined),
		Effect.orElseSucceed(() => false),
	);

/** What a builder started again is sent, in the round's own conversation, in place of the brief it already has. */
export function carryOnOf(brief: BuildBrief): string {
	return [
		`You were stopped partway through round ${brief.round} of ${brief.ticket}: the process running you ended, and this is the same conversation, started again.`,
		"",
		`What you changed so far is in your working folder, on ${brief.branch}; nothing was committed. A command you had running when you were stopped did not finish, and its result is lost. Look at where the work stands first (\`git status\`, \`git diff\`), then carry on from there to meet every criterion. Do not start over.`,
		"",
		"Fill the form once, at the very end, as you were asked at the start.",
	].join("\n");
}

const OVER_BUDGET = "error_max_budget_usd";

/** One live run, to its end. */
export const draftLive = (
	config: BuilderConfig,
	brief: BuildBrief,
	settings: Settings,
): Effect.Effect<BuildDrafted> =>
	Effect.gen(function* () {
		const tools: string[] = [];
		const refused: Refused[] = [];
		const ran = (spend: Ran["spend"]): Ran => ({spend, tools, refused, links: 0});
		const stamp = String(yield* Clock.currentTimeMillis);
		// The round's conversation: started at the first run, carried on by a
		// run started again after a restart, where the first one left any. What
		// a round knows of the round before is in its brief, never in this.
		const continues = yield* (config.kept ?? keptOnDisk)(brief.session, brief.tree);
		const run: DraftRun = {
			key: brief.ticket,
			id: stamp,
			prompt: continues ? carryOnOf(brief) : promptOf(brief),
			session: {id: brief.session, continues},
			agent: null,
			folder: null,
		};
		// One builder per working copy, and it stops with this process (./guard.ts).
		const guard = guarded(lockOf(brief.tree));
		const traced = yield* sdkTrace("builder", `${brief.ticket}#${brief.round}#${stamp}`);
		const runner = sdkRunner(
			builderDraft,
			() =>
				builderOptions(settings, brief.tree, (tool, why) => refused.push({tool, why}), guard.spawn),
			{
				seen: (_run, message) => {
					config.seen?.(message);
					traced?.seen(message);
				},
				...(config.open === undefined ? {} : {open: config.open}),
			},
		);
		const msgs = runner({id: "builder", type: "builder", deps: run} as Sub<"builder", DraftRun>);
		const {is} = builderDraft;
		const all = yield* Stream.runCollect(msgs.pipe(Stream.takeUntil((msg) => !is.tool(msg)))).pipe(
			Effect.ensuring(Effect.sync(() => traced?.end())),
		);
		for (const msg of all) if (is.tool(msg)) tools.push(msg.tool);
		const end = [...all].at(-1);
		if (end === undefined || is.tool(end))
			return {
				answer: "broke",
				error: "the run ended with no result",
				...ran(noSpend),
			} satisfies BuildDrafted;
		if (is.failed(end))
			return (
				end.error.startsWith(OVER_BUDGET)
					? {answer: "over_budget", ...ran(end.spend)}
					: {answer: "broke", error: guard.refused() ?? end.error, ...ran(end.spend)}
			) satisfies BuildDrafted;
		return (
			end.output === null
				? {answer: "misfit", ...ran(end.spend)}
				: {answer: "built", built: end.output, ...ran(end.spend)}
		) satisfies BuildDrafted;
	});

/** The builder on the Agent SDK. */
export const liveBuilder = (config: BuilderConfig = {}) =>
	Layer.succeed(Builder, {build: (brief, settings) => draftLive(config, brief, settings)});
