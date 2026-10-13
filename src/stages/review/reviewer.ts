import {mkdir, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Options, SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {Clock, Context, Effect, Layer, Option, Stream} from "effect";
import {sessionOf} from "../../combos.ts";
import {
	createDraft,
	type DraftRun,
	noSpend,
	type Open,
	type Spend,
	sdkRunner,
} from "../../draft.ts";
import {sh} from "../../operator-live.ts";
import {guardHook} from "../../shell-guard.ts";
import type {Brief} from "./gate.ts";
import {RUBRIC_FILE} from "./pack.ts";
import {Form} from "./sheet.ts";

// The reviewer: the one agent job of this stage. A brief goes in, a form
// comes out. It is started the way every agent here is (`createDraft` and
// `sdkRunner`, src/draft.ts) and held by the same Check before each tool call
// (src/shell-guard.ts), with that Check's `readOnly` rule on.
//
// It only reads. It is handed the code as it stands at the commit, in a
// folder made for this one run and removed after it. It has three tools:
// Read, Grep, Glob. No shell, no write, no network, nothing to post with.

export const reviewerDraft = createDraft({name: "reviewer", output: Form});

// ---------------------------------------------------------------- the prompt

/** A text in a code fence longer than any run of backticks inside it, so nothing in the text can close it. */
function fenced(text: string, word = ""): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}${word}\n${text.replace(/\n+$/, "")}\n${fence}`;
}

/**
 * What the reviewer is sent. Pure: the same brief gives the same text.
 *
 * Two parts of it are there on purpose, and a test holds each in place:
 * "think first, fill the form last", and "the rows are not the whole job".
 * Without the first an agent grades as it reads and stops reading. Without
 * the second it treats the criteria as a checklist, and a fault no criterion
 * names is never looked for.
 */
export function promptOf(brief: Brief): string {
	const criteria = brief.criteria.map(
		(c) =>
			`${c.n}. [${c.checked ? "x" : " "}] ${c.text}${c.evidence === null ? "" : `\n   Evidence mark: its proof is said to live in: ${c.evidence}`}`,
	);
	const deviations =
		brief.deviations.state === "listed"
			? fenced(brief.deviations.text)
			: brief.deviations.state === "none"
				? "The builder says there are none. That is a claim: the diff may say otherwise."
				: "The pull request's text has no deviations section.";
	const checks = brief.checks.required.map((check) => `${check.name}: ${check.state}`).join(", ");
	return [
		`You are reviewing one pull request at one commit: ${brief.pr} at ${brief.head}.`,
		"",
		"The code as it stands at that commit is in your working folder. You can read it with Read, Grep and Glob. You have no shell: you cannot run a test, a build or any command. You have no network. You post nothing. Your whole answer is one form, described at the end.",
		"",
		"# How to work",
		"",
		"Read and think freely first. Read the diff. Open the files around it. Follow what calls what. Read the tests. Ask yourself what a user would try first, and whether it would work. Take your time, and think in your own words. Do not think about the form while you do this, and do not fill it in as you go. Fill the form only at the very end, once, when you know what you think.",
		"",
		"The rows are not the whole job. The criteria below say what the ticket asked for. A change can meet every one of them and still be wrong. So you must also look for what the criteria do not name. Each rubric below has standing checks: things to look for in every change, whatever its ticket says. Work through them against this change, and report what you find as findings.",
		"",
		"# The ticket's acceptance criteria",
		"",
		`From ${brief.ticket.id}. The box shows whether it is ticked in the ticket today; it is not proof of anything.`,
		"",
		...criteria,
		"",
		"# The changed files",
		"",
		"Each with the kind of review that reads it.",
		"",
		...brief.files.map((file) => `- ${file.path} (${file.kind})`),
		"",
		"# Deviations the builder declared",
		"",
		deviations,
		"",
		"# The required checks at this commit",
		"",
		`${brief.checks.state}${checks === "" ? "" : ` (${checks})`}. Code read this; you did not run them and cannot. You may rely on it for what those checks cover, and say so as a limit.`,
		"",
		"# The rubrics",
		"",
		"One per kind of review this change owes. Each was written for a reviewer with a shell, who posts the verdict. You have neither. Use the judgment each one asks for. Leave out its steps about posting, verdict marks and labels: code does those from your form. Where a rubric asks for something you could not do (run a command, read the pull request's own text), do not guess: list it under `skipped`.",
		"",
		...brief.rubrics.flatMap((rubric) => [
			`## ${rubric.kind} (${RUBRIC_FILE[rubric.kind]})`,
			"",
			fenced(rubric.text, "markdown"),
			"",
		]),
		"# The diff",
		"",
		"From where the branch left its base to the commit under review.",
		"",
		fenced(brief.diff, "diff"),
		"",
		"# The form",
		"",
		"Fill it once, at the end.",
		"",
		"`rows`: one row for every criterion, by its number. No criterion left out, none twice.",
		"- `pass`: the change meets it. `where`: the lines that show it. `says`: how you know. `limit`: what your pass does not cover, or null.",
		"- `fail`: it does not. `where`: the lines that show it, or an empty list when what it asks for is not there at all. Every failed row needs a finding that comes from it.",
		"- `unseen`: you could not see what you needed. For a criterion whose proof lives somewhere you were not given, or needs a command run. `unseen` is not a fail and not a pass. Never grade a row `fail` because you could not look.",
		"",
		`\`findings\`: each thing that has to change before this can land. Only those: every finding blocks. \`kind\` is the one review it belongs to (${brief.kinds.join(", ")}): the kind of the file it is in. \`from\` says where it came from: a criterion by number, a rubric's standing check by the rubric's own name for it, or a deviation. Keep the fault and its proof apart. \`fault\`: what is wrong, and nothing else. \`at\`: where it is, or null when it is something missing. \`proof\`: what you read or worked out that shows it. \`wants\`: what has to be true for it to be closed, not how to write the fix.`,
		"",
		"`skipped`: what you did not look at, and why.",
		"",
		"Line numbers are the lines of the file as it is in your working folder. Give no ids, no severity and no verdict: code works those out.",
	].join("\n");
}

// ---------------------------------------------------------------- the service

/** A tool call the Check refused. */
export interface Refused {
	readonly tool: string;
	readonly why: string;
}

/** What every run leaves behind, however it ended. `tools`: each tool it called, in order. */
export interface Ran {
	readonly spend: Spend;
	readonly tools: readonly string[];
	readonly refused: readonly Refused[];
}

/** How one reviewer run ended. Never a throw. */
export type Drafted =
	| ({readonly answer: "form"; readonly form: Form} & Ran)
	/** It ended on its own, and what it handed back does not read as a form. */
	| ({readonly answer: "misfit"} & Ran)
	/** It never got to an answer: no code to read, a tool in its list it was not given, the run broke, or it ran out of dollars. */
	| ({readonly answer: "broke"; readonly error: string} & Ran);

/** The reviewer, as a service: one brief in, one ended run out. A test stands a scripted one in. */
export class Reviewer extends Context.Service<
	Reviewer,
	{readonly draft: (brief: Brief) => Effect.Effect<Drafted>}
>()("Reviewer") {}

/** The settings of a live reviewer. Nothing here is fixed by the code. */
export interface ReviewerConfig {
	/** A local clone that holds the commit under review. It is read, never changed: nothing is fetched into it or checked out in it. */
	readonly repo: string;
	readonly model: string;
	readonly effort: "low" | "medium" | "high";
	/** The dollars one run may cost before the SDK stops it. */
	readonly maxUsd: number;
	/** Is shown every SDK message, for a log. */
	readonly seen?: (message: SDKMessage) => void;
	/** How the SDK's query is opened. A test stands a scripted one in. */
	readonly open?: Open;
}

/** Today's fabrika reviewer runs on these (src/operate.ts, field/runs.jsonl). */
export const DEFAULT_MODEL = "opus";
export const DEFAULT_EFFORT = "medium";

const READ_TOOLS = ["Read", "Grep", "Glob"];

/**
 * The Agent SDK options of one run. `tools` is the whole list of tools the
 * agent has, not only the ones approved ahead. No settings are loaded from
 * the machine or from the code under review, so neither can add a tool, a
 * hook or an instruction. The Check reads every call before it runs.
 *
 * No server of tools is offered either. A reviewer reads text anyone can
 * write, so a tool that reaches the network is not to be in its list at all,
 * refused or not. `strictMcpConfig` leaves out every server a file names.
 * The connectors of the signed-in account are named by no file: the SDK
 * fetches them from the account, and `disableClaudeAiConnectors` is its
 * setting that stops that. The runner ends a run whose list still holds
 * anything else (`extraTools`, src/draft.ts).
 */
export const reviewerOptions = (
	config: ReviewerConfig,
	tree: string,
	refused: (tool: string, why: string) => void,
): Options => ({
	cwd: tree,
	model: config.model,
	effort: config.effort,
	settingSources: [],
	strictMcpConfig: true,
	settings: {disableClaudeAiConnectors: true},
	persistSession: false,
	permissionMode: "dontAsk",
	tools: [...READ_TOOLS],
	allowedTools: [...READ_TOOLS],
	hooks: {PreToolUse: [{hooks: [guardHook({tree, alsoWritable: [], readOnly: true}, refused)]}]},
	maxBudgetUsd: config.maxUsd,
});

/**
 * The code at one commit, as plain files in a new folder under the system's
 * temp folder: `git archive` out of the clone, unpacked. The clone itself is
 * only read. The folder is removed when the scope closes.
 */
const codeAt = (repo: string, head: string) =>
	Effect.gen(function* () {
		const has = yield* Effect.option(sh("git", ["-C", repo, "cat-file", "-e", `${head}^{commit}`]));
		if (Option.isNone(has)) {
			return yield* Effect.fail(
				`the clone does not hold commit ${head}. Fetch it into that clone first (for a pull request: git fetch origin pull/<number>/head), then run again. This run fetches nothing.`,
			);
		}
		const root = yield* Effect.acquireRelease(
			// The real path: on some systems the temp folder is a link, and the Check judges paths as written.
			Effect.tryPromise({
				try: () => mkdtemp(join(tmpdir(), "review-")).then((made) => realpath(made)),
				catch: () => "a temp folder for the code could not be made",
			}),
			(made) =>
				// biome-ignore lint/plugin: closing a scope has no way to fail with a typed error; a temp folder that cannot be removed is a bug
				Effect.promise(() => rm(made, {recursive: true, force: true})),
		);
		const tree = join(root, "code");
		yield* Effect.tryPromise({
			try: () => mkdir(tree),
			catch: () => "a folder for the code could not be made in the temp folder",
		});
		const packed = join(root, "head.tar");
		yield* sh("git", ["-C", repo, "archive", "--format=tar", "-o", packed, head]).pipe(
			Effect.flatMap(() => sh("tar", ["-xf", packed, "-C", tree])),
			Effect.mapError(() => `the code at ${head} could not be copied out of the clone`),
		);
		return tree;
	});

/** One live run, to its end. */
const draftLive = (config: ReviewerConfig, brief: Brief): Effect.Effect<Drafted> => {
	const tools: string[] = [];
	const refused: Refused[] = [];
	const ran = (spend: Spend): Ran => ({spend, tools, refused});
	return Effect.gen(function* () {
		const tree = yield* codeAt(config.repo, brief.head);
		const stamp = String(yield* Clock.currentTimeMillis);
		const run: DraftRun = {
			key: brief.pr,
			id: stamp,
			prompt: promptOf(brief),
			// A new conversation every run: a reviewer never picks up where another left off.
			session: {id: sessionOf(`review ${brief.pr} ${brief.head} ${stamp}`), continues: false},
			agent: null,
			folder: null,
		};
		const runner = sdkRunner(
			reviewerDraft,
			() => reviewerOptions(config, tree, (tool, why) => refused.push({tool, why})),
			{
				...(config.seen === undefined ? {} : {seen: (_run, message) => config.seen?.(message)}),
				...(config.open === undefined ? {} : {open: config.open}),
			},
		);
		// A Sub as the engine would hand it to a runner. This piece has no machine, so it opens the one Sub itself.
		const msgs = runner({id: "reviewer", type: "reviewer", deps: run} as Sub<"reviewer", DraftRun>);
		const {is} = reviewerDraft;
		const all = yield* Stream.runCollect(msgs.pipe(Stream.takeUntil((msg) => !is.tool(msg))));
		for (const msg of all) if (is.tool(msg)) tools.push(msg.tool);
		const end = [...all].at(-1);
		if (end === undefined || is.tool(end))
			return {
				answer: "broke",
				error: "the run ended with no result",
				...ran(noSpend),
			} satisfies Drafted;
		if (is.failed(end))
			return {answer: "broke", error: end.error, ...ran(end.spend)} satisfies Drafted;
		return (
			end.output === null
				? {answer: "misfit", ...ran(end.spend)}
				: {answer: "form", form: end.output, ...ran(end.spend)}
		) satisfies Drafted;
	}).pipe(
		Effect.scoped,
		Effect.catch((error) => Effect.succeed<Drafted>({answer: "broke", error, ...ran(noSpend)})),
	);
};

/** The reviewer on the Agent SDK. */
export const liveReviewer = (config: ReviewerConfig) =>
	Layer.succeed(Reviewer, {draft: (brief) => draftLive(config, brief)});
