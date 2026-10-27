import {mkdir, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {getSessionInfo, type Options, type SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {
	createDraft,
	type DraftRun,
	noSpend,
	type Open,
	sdkRunner,
} from "@kampus/fabrika/agents/claude";
import {agentEnv, guardHook} from "@kampus/fabrika/agents/sandbox";
import {Effect, Layer, Schema, Stream} from "effect";
import {sh} from "../../sh.ts";
import {removeLinks} from "../review/reviewer.ts";
import {identifiersIn} from "./check.ts";
import {PlanDraft} from "./plan.ts";
import {type PlanMsg, Planner, PlanTicket, type Settings} from "./services.ts";

// The planner: the one agent job of the plan stage. A ticket and what code
// found about it go in; a plan, as data, comes out. It only reads: Read, Grep
// and Glob, in a copy of the code at the ticket's commit, held by the same
// Check as the reviewer (src/shell-guard.ts, `readOnly`). No shell, no write,
// no network.

/** The planner writes a plan with no ids: only the criteria book gives one (./ids.ts). */
export const planDraft = createDraft({name: "plan", output: PlanDraft});

/** What the planner is handed. */
export const Brief = Schema.Struct({
	ticket: PlanTicket,
	/** What code found about the names and paths the ticket mentions. `null`: nothing was gathered. */
	facts: Schema.NullOr(Schema.String),
	/** The names a user of the published packages meets: a criterion may name them. Empty: none were gathered. */
	names: Schema.Array(Schema.String),
});
export type Brief = typeof Brief.Type;

/** A text in a code fence longer than any run of backticks inside it. */
function fenced(text: string, word = ""): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}${word}\n${text.replace(/\n+$/, "")}\n${fence}`;
}

/**
 * The names a user meets, as the planner reads them. A repo's docs show
 * thousands, so only those the ticket itself uses are listed, and only those
 * that look like code: a plain word needs no leave. The Check knows them all.
 * Pure.
 */
export function namesBrief(names: readonly string[], ticket: string): string {
	const used = new Set(ticket.match(/[@\w$./*-]+/g)?.map((t) => t.replace(/^[./]+|[./]+$/g, "")));
	const shown = names.filter((name) => used.has(name) && identifiersIn(name).length > 0);
	const rule =
		"A flag, a glob pattern or a package name is a user's whatever its shape. So is any name the published packages' manifests and docs show their users: the Check knows them all, and sends back only internal names.";
	if (names.length === 0) return `None were gathered. ${rule}`;
	if (shown.length === 0) return rule;
	return [
		`Of the names the ticket uses, these are ones the published packages show their users, so a criterion may use them: ${shown.join(" ")}`,
		"",
		rule,
	].join("\n");
}

/** What the planner is sent first. Pure: the same brief gives the same text. */
export function promptOf(brief: Brief): string {
	return [
		`You are writing the plan for one ticket: ${brief.ticket.url}.`,
		"",
		"The code is in your working folder, at the commit the ticket is planned against. You can read it with Read, Grep and Glob. You have no shell and no network, and you change nothing. Your whole answer is one plan, as data, described at the end.",
		"",
		"# The ticket",
		"",
		fenced(`# ${brief.ticket.title}\n\n${brief.ticket.body}`, "markdown"),
		"",
		"# What code found about the names and paths the ticket mentions",
		"",
		brief.facts ?? "Nothing was gathered. Read the code yourself.",
		"",
		"# Names a user meets",
		"",
		namesBrief(brief.names, `${brief.ticket.title}\n${brief.ticket.body}`),
		"",
		"# How to plan",
		"",
		"Read the ticket and the code first, and think in your own words. Make sure you know who the ticket is for, what is wrong or missing for them today, and what they would see once it is fixed. Write the plan once, at the end.",
		"",
		"**Size the plan to the work.** Most tickets are one task. A small fix is one task with its whole job and at most a few more criteria, and the whole plan reads as a paragraph. Use more tasks only where the work splits into parts that each land on their own, or where an investigation has to answer before any code can be written. A long plan for a small fix is a mistake, not care.",
		"",
		'**Stories first: who is this for?** Before any task, write the user stories, in order: "As ‹who›, I want ‹want›, so that ‹why›". Cover every kind of user the ticket touches, not just one: the person running a command, a library\'s consumer, someone reading the docs, a maintainer of the code, an agent in the pipeline that reads or writes what changes. Each story has a short id that stays the same if the stories move (`s1`, `s2`, ...). Write a story only for someone the change really reaches; a story nobody needs is noise.',
		"",
		"**Every criterion names the stories it serves** (`serves`: their ids), and every story is served by at least one criterion. A criterion that serves nobody has no reason to exist; a story no criterion serves is a user the plan forgot.",
		"",
		"**A task ends in one of two things.** `pr`: a code or doc change lands. `answer`: an investigation, and what it ends in is written findings. A decision is never a task: it is an open question.",
		"",
		'**Criteria are outcomes.** Each says what someone can observe once the task is done, never how to build it, in two parts that read as one sentence, "When ‹when›, ‹result›":',
		"- `when`: the trigger. What someone does, or what happens. Leave out the word When.",
		"- `result`: the thing, and what someone can observe of it.",
		"",
		'Good: when "someone makes a slug from a title with two spaces in a row", result "the slug has one dash where the spaces were".',
		'A recipe, which is wrong: "Add a regex to the slug module that collapses whitespace." That says how, not what anyone sees.',
		"",
		"**Each task opens with its `job`: the user's whole job, end to end.** It is the first criterion, and it may say several things: it is the run that ties the rest together, the one a user would try first. Its `fixture` says the realistic case it runs on: more than two items, a second run, a large or real input. Not the smallest case a single claim gets away with. Give the fixture's shape (how many of what, run how often, what should come out); exact file names go in `pointers`.",
		'Good job: when "someone makes slugs from fifty real titles, some with runs of spaces, tabs or a leading space, and then makes slugs again from those slugs", result "every slug has single dashes and none starts or ends with one, and the second pass gives back the same slugs"; fixture "fifty titles taken from a real blog, a fifth of them with runs of whitespace, run twice".',
		"",
		"The criteria after the job are one claim each: if a `result` says two things, write two criteria. Use them for the edges the job does not show: a limit, an error, a case a user would try next.",
		"",
		"**Name things the way a user meets them.** A criterion may name what a user types or reads: a command and its flags, a config key they write, a published package or export, a glob pattern they write, an environment variable, a doc page by its title. The names above are the ones the published packages show their users. A criterion never names internal code: a source path, a private function, an internal type. Those go in `pointers`: they help a builder start, and bind nobody.",
		"",
		"**Each criterion names its check:** how someone will see it hold. `how` is `test` (an automated test shows it), `typecheck` (the compiler shows it), `run` (running a command shows it; `what` is the command) or `read` (a reviewer reads it: wording, a doc page). `what` says what the check does, in words.",
		"",
		'**Do not over-ask.** No criterion for a changeset, for lint, or for "the existing tests still pass", unless the ticket is about them. The pipeline checks those anyway.',
		"",
		"**Never make a product call quietly.** Where the ticket leaves a real choice open (what is in scope, a behaviour a user would notice, a published name, a trade-off), write it as an open question: what is asked, the options, your lean, and why. Write the plan with your lean, and say in the question which criteria depend on it. Do not ask what reading the code can answer: read the code. A plan with no open question is fine when there is none.",
		"",
		"# The plan",
		"",
		"`summary`: what is wrong or missing, and what will be true after, in two or three plain sentences.",
		"`stories`: who the ticket is for, in order, each with `id`, `who`, `want` and `why`.",
		"`tasks`: in the order they are to be done. Each has a `title`, `ends` (`pr` or `answer`), its `job` (`when`, `result`, `fixture`, `check`, `serves`) and its other `criteria` (`when`, `result`, `check`, `serves`).",
		"`goal`: only when there are two tasks or more. The whole plan's own `job` and `criteria`, in the same shape as a task's: what a user sees only once every task is in. All the tasks land in one pull request, and the last review judges the goal there.",
		"`pointers`: files, functions, tests and doc pages a builder may start from, each with why.",
		"`questions`: the open product calls, each with `ask`, `options`, `lean` and `why`.",
	].join("\n");
}

/** What the planner is sent on a later try: the Check's problems, in the same conversation. */
export const promptFor = (brief: Brief, note: string | null): string =>
	note === null ? promptOf(brief) : note;

const READ_TOOLS = ["Read", "Grep", "Glob"];

/**
 * The Agent SDK options of one run. `tools` is the whole list of built-in
 * tools it has. No settings are loaded from the machine or from the code, so
 * neither can add a tool, a hook or an instruction; no server of tools, and
 * no connector of the signed-in account. The Check reads every call first.
 */
export const plannerOptions = (
	settings: Settings,
	tree: string,
	refused: (tool: string, why: string) => void = () => {},
): Options => ({
	cwd: tree,
	env: agentEnv(),
	model: settings.model,
	effort: settings.effort,
	settingSources: [],
	strictMcpConfig: true,
	mcpServers: {},
	settings: {disableClaudeAiConnectors: true},
	permissionMode: "dontAsk",
	tools: [...READ_TOOLS],
	allowedTools: [...READ_TOOLS],
	hooks: {
		PreToolUse: [{hooks: [guardHook({tree, alsoWritable: [], readOnly: true}, refused)]}],
	},
	maxBudgetUsd: settings.budget,
});

/** Where a live planner gets its code, and how it is watched. */
export interface PlannerConfig {
	/** A local clone that holds every commit a ticket is planned at. Read, never changed. */
	readonly repo: string;
	/** Is shown every SDK message, for a log. */
	readonly seen?: (message: SDKMessage) => void;
	/** How the SDK's query is opened. A test stands a scripted one in. */
	readonly open?: Open;
	/** Whether a conversation is kept under `session` for the copy `tree`. A test stands its own in. */
	readonly kept?: (session: string, tree: string) => Effect.Effect<boolean>;
}

/** A conversation the SDK kept on disk for this copy, under this id. Unreadable is not kept. */
const keptOnDisk = (session: string, tree: string): Effect.Effect<boolean> =>
	Effect.tryPromise({
		try: () => getSessionInfo(session, {dir: tree}),
		catch: () => "unread" as const,
	}).pipe(
		Effect.map((info) => info !== undefined),
		Effect.orElseSucceed(() => false),
	);

/**
 * The code at one commit, as plain files in a folder under `root`: `git
 * archive` out of the clone, unpacked, with its symbolic links taken out, so
 * the read-only Check's paths mean what they say. No `.git`: the planner
 * cannot read a later commit.
 */
const copyAt = (repo: string, root: string, commit: string) =>
	Effect.gen(function* () {
		const tree = join(root, commit, "code");
		yield* Effect.tryPromise({
			try: () => mkdir(tree, {recursive: true}),
			catch: () => `a folder for the code at ${commit} could not be made`,
		});
		const packed = join(root, commit, "code.tar");
		yield* sh("git", ["-C", repo, "archive", "--format=tar", "-o", packed, commit]).pipe(
			Effect.flatMap(() => sh("tar", ["-xf", packed, "-C", tree])),
			Effect.mapError(() => `the code at ${commit} could not be copied out of the clone`),
		);
		yield* Effect.tryPromise({
			try: () => removeLinks(tree),
			catch: () => `the symbolic links in the code at ${commit} could not be taken out`,
		});
		return tree;
	});

/** A run that never got going, as the Msg it ends with. */
const brokeOf = (run: DraftRun, error: string): PlanMsg => ({
	type: "plan_failed",
	key: run.key,
	id: run.id,
	error,
	spend: noSpend,
});

/**
 * The planner on the Agent SDK. Each commit's copy is made once, at its first
 * run, and kept until the layer closes: every try of one ticket reads the same
 * folder, which a continued conversation needs.
 */
export const livePlanner = (config: PlannerConfig) =>
	Layer.effect(
		Planner,
		Effect.gen(function* () {
			const root = yield* Effect.acquireRelease(
				// The real path: on some systems the temp folder is a link, and the Check judges paths as written.
				Effect.tryPromise({
					try: () => mkdtemp(join(tmpdir(), "plan-")).then((made) => realpath(made)),
					catch: () => ({_tag: "no_temp_folder" as const}),
				}),
				(made) =>
					// biome-ignore lint/plugin: closing a scope has no way to fail with a typed error; a temp folder that cannot be removed is a bug
					Effect.promise(() => rm(made, {recursive: true, force: true})),
			);
			const trees = new Map<string, string>();
			const treeOf = (commit: string) =>
				Effect.gen(function* () {
					const kept = trees.get(commit);
					if (kept !== undefined) return kept;
					const tree = yield* copyAt(config.repo, root, commit);
					trees.set(commit, tree);
					return tree;
				});
			return {
				run: (run: DraftRun, settings: Settings) =>
					Stream.unwrap(
						treeOf(run.folder ?? "HEAD").pipe(
							// A try that carries a conversation on, on a host that does not have it (the
							// one that had it was killed, or its copy is gone): the same prompt, anew.
							Effect.flatMap((tree) =>
								(run.session.continues
									? (config.kept ?? keptOnDisk)(run.session.id, tree)
									: Effect.succeed(false)
								).pipe(
									Effect.map((kept) => ({
										tree,
										on: kept ? run : {...run, session: {...run.session, continues: false}},
									})),
								),
							),
							Effect.map(({tree, on}) =>
								sdkRunner(planDraft, () => plannerOptions(settings, tree), {
									seen: (_run, message) => config.seen?.(message),
									...(config.open === undefined ? {} : {open: config.open}),
								})({id: "plan", type: "plan", deps: on} as Sub<"plan", DraftRun>),
							),
							Effect.catch((error: string) => Effect.succeed(Stream.make(brokeOf(run, error)))),
						),
					),
			};
		}),
	);
