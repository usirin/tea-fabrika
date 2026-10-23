import {mkdir, mkdtemp, readdir, realpath, rm, unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {
	createSdkMcpServer,
	type McpSdkServerConfigWithInstance,
	type Options,
	type SDKMessage,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {
	createDraft,
	type DraftRun,
	jsonSchema,
	noSpend,
	type Open,
} from "@kampus/fabrika/agents/claude";
import {agentEnv, guardHook} from "@kampus/fabrika/agents/sandbox";
import {sdkTrace} from "@kampus/fabrika/agents/trace";
import {Clock, Context, Effect, Layer, Option, Queue, Schema, Stream} from "effect";
import {z} from "zod";
import {sessionOf} from "../../combos.ts";
import {sh} from "../../sh.ts";
import type {Brief} from "./gate.ts";
import {RUBRIC_FILE} from "./pack.ts";
import {Form} from "./sheet.ts";
import {
	type Note,
	OPENED,
	OPENED_NAMES,
	SERVER,
	type ToolName,
	type Tools,
	toolName,
} from "./tools.ts";

// The reviewer: the one agent job of this stage. A brief goes in, a form
// comes out. It is started the way every agent here is (`createDraft` and
// `sdkRunner`, src/draft.ts) and held by the same Check before each tool call
// (src/shell-guard.ts), with that Check's `readOnly` rule on.
//
// It only reads. It is handed the code as it stands at the commit, in a
// folder made for this one run and removed after it. It reads with three
// tools: Read, Grep, Glob. No shell, no write, no network, nothing to post
// with. Beside them it has the tools its machine opens to it (./tools.ts),
// served from this process: each call goes out on the run's own stream, as
// it is made, and changes nothing itself. The machine runs the reviewer as a
// Sub, so that stream is the Sub's, and each call reaches it as a Msg.

export const reviewerDraft = createDraft({name: "reviewer", output: Form});

// ---------------------------------------------------------------- the prompt

/** A text in a code fence longer than any run of backticks inside it, so nothing in the text can close it. */
export function fenced(text: string, word = ""): string {
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
 *
 * `note`: on a second try, why code refused the form before, with that form
 * (the review machine writes it). `null` on a first try.
 *
 * `focus`: what this one run is to spend most of its reading on, said after
 * the way of working. `null`, the default: no focus, and the text is the same
 * as it was before there was one. Several runs on one commit, each with its
 * own focus, read the change in different ways (experiment 113).
 */
export function promptOf(brief: Brief, note: string | null, focus: string | null = null): string {
	const criteria = brief.criteria.map(
		(c) =>
			`- ${c.id}: [${c.checked ? "x" : " "}] ${c.text}${c.evidence === null ? "" : `\n  - Evidence mark: its proof is said to live in: ${c.evidence}`}`,
	);
	const deviations =
		brief.deviations.state === "listed"
			? fenced(brief.deviations.text)
			: brief.deviations.state === "none"
				? "The builder says there are none. That is a claim: the diff may say otherwise."
				: "The pull request's text has no deviations section.";
	const checks = brief.checks.required.map((check) => `${check.name}: ${check.state}`).join(", ");
	const rules =
		brief.rules.length === 0
			? []
			: [
					"# The repository's own rules",
					"",
					"The repository keeps instructions for agents that work in it. Code read them from the base branch, not from this change, and they are shown here as written. Treat each rule about what a change must hold or include (a test, a changelog or changeset entry, docs kept in step, a file kept in step with another) as one more standing check: hold this change against it, and report a breach as a finding whose `from` is `rule`, naming the file and the rule in a few words. Leave the parts about tools, other agents and steps of their pipeline: they are not about the change.",
					"",
					...brief.rules.flatMap((rule) => [
						`## ${rule.file}`,
						"",
						fenced(rule.text, "markdown"),
						"",
					]),
				];
	const again =
		note === null
			? []
			: [
					"",
					"# Another try",
					"",
					"This commit was reviewed once already, and code refused the form that review handed back. You are a new run: you do not remember it. Its form and what was wrong with it are below. Review the change as much as you need to, then fill the whole form again, once, at the end, so that none of these problems is in it.",
					"",
					note,
				];
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
		`You have one more tool, \`${toolName("file_note")}\`. ${OPENED.file_note.says} It is the only tool you have that is not a read, and it is not your answer: your answer is still the one form, filled once at the very end.`,
		"",
		...(focus === null
			? []
			: [
					"# Your focus for this run",
					"",
					"Other runs review this same commit, each with its own focus. Still do the whole review and fill the whole form: every criterion gets a row. But spend most of your reading on this:",
					"",
					focus,
					"",
				]),
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
		`${brief.checks.state}${checks === "" ? "" : ` (${checks})`}. Code read this; you did not run them and cannot. You may rely on it for what those checks cover, and say so in \`says\`.`,
		"",
		...rules,
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
		"`rows`: one row for every criterion, by its id (`c1`, `c4`, ...: the id before it above, never its place in the list). No criterion left out, none twice.",
		"- `pass`: the change meets it. `where`: the lines that show it. `says`: how you know. `limit`: null. A pass is the whole criterion: if part of it is not met, grade it `fail` with a finding; if you could not see part of it, `unseen`. A form that names a limit on a pass comes back to you.",
		"- `fail`: it does not. `where`: the lines that show it, or an empty list when what it asks for is not there at all. Every failed row needs a finding that comes from it.",
		"- `unseen`: you could not see what you needed. For a criterion whose proof lives somewhere you were not given, or needs a command run. `unseen` is not a fail and not a pass. Never grade a row `fail` because you could not look.",
		"",
		`\`findings\`: each thing that has to change before this can land. Only those: every finding blocks. \`kind\` is the one review it belongs to (${brief.kinds.join(", ")}): the kind of the file it is in, or for something missing, of the changed files it is about. \`from\` says where it came from: a criterion by its id, a rubric's standing check by the rubric's own name for it, a deviation, or a rule of the repository's own. Keep the fault and its proof apart. \`fault\`: what is wrong, and nothing else. \`at\`: where it is, or null when it is something missing. \`proof\`: what you read or worked out that shows it. \`wants\`: what has to be true for it to be closed, not how to write the fix.`,
		"",
		"`skipped`: what you did not look at, and why.",
		"",
		"Line numbers are the lines of the file as it is in your working folder. Give no ids, no severity and no verdict: code works those out.",
		...again,
	].join("\n");
}

// ---------------------------------------------------------------- the service

/** A tool call the Check refused. */
export const Refused = Schema.Struct({tool: Schema.String, why: Schema.String});
export type Refused = typeof Refused.Type;

/** What a run cost, as the SDK reported it (`Spend`, src/draft.ts). */
export const Spent = Schema.Struct({
	costUsd: Schema.Finite,
	tokens: Schema.Finite,
	context: Schema.Finite,
	turns: Schema.Finite,
	minutes: Schema.Finite,
});

/** What every run leaves behind, however it ended. `tools`: each tool it called, in order. */
export const Ran = Schema.Struct({
	spend: Spent,
	tools: Schema.Array(Schema.String),
	refused: Schema.Array(Refused),
	/** The symbolic links taken out of the copy of the code before the run. Each is a path the reviewer could not read. */
	links: Schema.Finite,
});
export type Ran = typeof Ran.Type;

/** A run that never started: nothing spent, nothing called. */
export const noRun: Ran = {spend: noSpend, tools: [], refused: [], links: 0};

/** How one reviewer run ended. Never a throw. */
export type Drafted =
	| ({readonly answer: "form"; readonly form: Form} & Ran)
	/** It ended on its own, and what it handed back does not read as a form. */
	| ({readonly answer: "misfit"} & Ran)
	/** It reached its limit in dollars before it handed anything back. */
	| ({readonly answer: "over_budget"} & Ran)
	/** It never got to an answer: no code to read, a tool in its list it was not given, or the run broke. */
	| ({readonly answer: "broke"; readonly error: string} & Ran);

export const EFFORTS = ["low", "medium", "high"] as const;

/**
 * How one reviewer run is to spend: the model, its effort, and the most it
 * may cost. Chosen when the review is started, kept in the machine's state,
 * and handed to the reviewer with each brief.
 */
export const Settings = Schema.Struct({
	model: Schema.String,
	effort: Schema.Literals(EFFORTS),
	/** The dollars one run may cost before the SDK stops it. */
	budget: Schema.Finite,
});
export type Settings = typeof Settings.Type;

/**
 * What one reviewer run says, in the order it says it: a call to one of the
 * tools its machine opened, as it is made, then how the run ended, once.
 */
export type Said =
	| {readonly kind: "note"; readonly note: Note}
	| {readonly kind: "ended"; readonly drafted: Drafted};

/**
 * The reviewer, as a service: one brief in, a stream of what the run says
 * out. It is a stream, not one answer, because the agent calls its opened
 * tools while it works, and each call has to reach the machine as it is
 * made. The stream ends after `ended`. A test stands a scripted one in.
 * `note`: why code refused the last try's form, on a second try (`promptOf`).
 */
export class Reviewer extends Context.Service<
	Reviewer,
	{
		readonly review: (brief: Brief, settings: Settings, note: string | null) => Stream.Stream<Said>;
	}
>()("Reviewer") {}

/** Where a live reviewer gets its code, and how it is watched. A setting of the service, not of a review. */
export interface ReviewerConfig {
	/**
	 * A local clone that holds the commit under review, or the clone for each
	 * pull request's url. It is read, never changed: nothing is fetched into it
	 * or checked out in it.
	 */
	readonly repo: string | ((pr: string) => string);
	/** Is shown every SDK message, for a log. */
	readonly seen?: (message: SDKMessage) => void;
	/** How the SDK's query is opened. A test stands a scripted one in. */
	readonly open?: Open;
	/**
	 * What every run of this reviewer is to spend most of its reading on
	 * (`promptOf`). Left out: no focus, as before. To run several focuses on
	 * one commit, run one review per focus, each with its own reviewer.
	 */
	readonly focus?: string;
}

/** Today's fabrika reviewer runs on these (src/operate.ts, field/runs.jsonl). */
export const DEFAULT_MODEL = "opus";
export const DEFAULT_EFFORT = "medium";
/** The dollars one run may cost when nobody says. */
export const DEFAULT_BUDGET = 2;

const READ_TOOLS = ["Read", "Grep", "Glob"];

/**
 * An opened tool's input, as the SDK takes it: a zod shape. It is made from
 * the Effect schema in `OPENED`, through its JSON Schema, so the two cannot
 * say different things. zod: the SDK's `tool` takes nothing else.
 */
const shapeOf = (name: ToolName): z.ZodRawShape => {
	const made = z.fromJSONSchema(jsonSchema(OPENED[name].input));
	// `fromJSONSchema` is typed as any zod type; from an object's JSON Schema it makes an object, and a test holds that.
	return (made as z.ZodObject).shape;
};

const said = (text: string) => ({content: [{type: "text" as const, text}]});

/**
 * The opened tools as the SDK takes them: one per entry of `OPENED`, each
 * handing its call through its door. The input is read against the Effect
 * schema again before it goes in: the door takes only a value that fits.
 */
export const openedTools = (tools: Tools) =>
	(Object.keys(OPENED) as ToolName[]).map((name) =>
		tool(name, OPENED[name].says, shapeOf(name), async (args) => {
			const input = Schema.decodeUnknownOption(OPENED[name].input)(args);
			if (Option.isNone(input))
				return {...said("Refused: that input does not fit the tool's shape."), isError: true};
			const heard = await Effect.runPromise(tools[name](input.value));
			return heard === "taken"
				? said("Taken. It is kept apart from your review.")
				: {...said("Refused: the review is not taking this now."), isError: true};
		}),
	);

/** The in-process server the opened tools are served from. It reaches no network. */
export const openedServer = (tools: Tools): McpSdkServerConfigWithInstance =>
	createSdkMcpServer({name: SERVER, version: "1", tools: openedTools(tools)});

/**
 * The Agent SDK options of one run. `tools` is the whole list of built-in
 * tools the agent has, not only the ones approved ahead. No settings are
 * loaded from the machine or from the code under review, so neither can add a
 * tool, a hook or an instruction. The Check reads every call before it runs.
 *
 * One server of tools is offered: the in-process one that serves the tools
 * the machine opened (`openedServer`), which reaches no network. A reviewer
 * reads text anyone can write, so a tool that reaches the network is not to
 * be in its list at all, refused or not. `strictMcpConfig` leaves out every
 * server a file names. The connectors of the signed-in account are named by
 * no file: the SDK fetches them from the account, and
 * `disableClaudeAiConnectors` is its setting that stops that. The runner ends
 * a run whose list still holds anything else (`extraTools`, src/draft.ts).
 *
 * Its environment is an agent's short one (src/env.ts): what its process
 * needs to start and find its login, and no other variable of this machine.
 */
export const reviewerOptions = (
	settings: Settings,
	tree: string,
	refused: (tool: string, why: string) => void,
	tools: Tools,
): Options => ({
	cwd: tree,
	env: agentEnv(),
	model: settings.model,
	effort: settings.effort,
	settingSources: [],
	strictMcpConfig: true,
	mcpServers: {[SERVER]: openedServer(tools)},
	settings: {disableClaudeAiConnectors: true},
	persistSession: false,
	permissionMode: "dontAsk",
	tools: [...READ_TOOLS],
	allowedTools: [...READ_TOOLS, ...OPENED_NAMES],
	hooks: {
		PreToolUse: [
			{
				hooks: [guardHook({tree, alsoWritable: [], readOnly: true, opened: OPENED_NAMES}, refused)],
			},
		],
	},
	maxBudgetUsd: settings.budget,
});

/**
 * Take every symbolic link out of a folder, at any depth, and say how many
 * there were. Only the link is removed: what it points at is never opened,
 * walked into or changed.
 *
 * A commit can hold a link, and `git archive` keeps it. The Check judges a
 * path as it is written, so in a folder with no link in it, a path written
 * inside the folder is a file inside the folder. This is done once, before the
 * reviewer starts, and the reviewer has nothing to make a link with. Reading
 * where each asked path really leads, call by call, would leave a gap between
 * that reading and the tool's own, and would not see a link a search walks
 * through below the folder it was pointed at.
 *
 * It costs a harmless link too: one that points inside the folder is gone
 * from the copy, and what it pointed at is still there under its own path.
 */
export async function removeLinks(folder: string): Promise<number> {
	let removed = 0;
	// Walked by hand, one folder at a time: a link to a folder is a link here, never a folder to go into.
	for (const entry of await readdir(folder, {withFileTypes: true})) {
		const path = join(folder, entry.name);
		if (entry.isSymbolicLink()) {
			await unlink(path);
			removed += 1;
		} else if (entry.isDirectory()) removed += await removeLinks(path);
	}
	return removed;
}

/**
 * The code at one commit, as plain files in a new folder under the system's
 * temp folder: `git archive` out of the clone, unpacked, with its symbolic
 * links taken out ({@link removeLinks}). The clone itself is only read. The
 * folder is removed when the scope closes. `links`: how many were taken out.
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
		const links = yield* Effect.tryPromise({
			try: () => removeLinks(tree),
			catch: () => `the symbolic links in the code at ${head} could not be taken out of the copy`,
		});
		return {tree, links};
	});

/** The SDK's word for a run it stopped at its limit in dollars. */
const OVER_BUDGET = "error_max_budget_usd";

/** One live run, to its end. */
const draftLive = (
	config: ReviewerConfig,
	brief: Brief,
	settings: Settings,
	note: string | null,
	opened: Tools,
): Effect.Effect<Drafted> => {
	const tools: string[] = [];
	const refused: Refused[] = [];
	const left = (spend: Ran["spend"], links: number): Ran => ({spend, tools, refused, links});
	const onCopy = (tree: string, links: number) =>
		Effect.gen(function* () {
			const ran = (spend: Ran["spend"]) => left(spend, links);
			const stamp = String(yield* Clock.currentTimeMillis);
			const run: DraftRun = {
				key: brief.pr,
				id: stamp,
				prompt: promptOf(brief, note, config.focus ?? null),
				// A new conversation every run: a reviewer never picks up where another left off.
				session: {id: sessionOf(`review ${brief.pr} ${brief.head} ${stamp}`), continues: false},
				agent: null,
				folder: null,
			};
			// With tracing on, the run's turns and tool calls are spans under the review's; off, the plain runner.
			const traced = yield* sdkTrace("reviewer", `${brief.pr}#${stamp}`);
			const runner = traced.runner(
				reviewerDraft,
				() => reviewerOptions(settings, tree, (tool, why) => refused.push({tool, why}), opened),
				{
					seen: (_run, message) => config.seen?.(message),
					...(config.open === undefined ? {} : {open: config.open}),
					opened: OPENED_NAMES,
				},
			);
			// A Sub as the engine would hand it to a runner. This piece has no machine, so it opens the one Sub itself.
			const msgs = runner({id: "reviewer", type: "reviewer", deps: run} as Sub<
				"reviewer",
				DraftRun
			>);
			const {is} = reviewerDraft;
			const all = yield* Stream.runCollect(
				msgs.pipe(Stream.takeUntil((msg) => !is.tool(msg))),
			).pipe(Effect.ensuring(Effect.sync(traced.end)));
			for (const msg of all) if (is.tool(msg)) tools.push(msg.tool);
			const end = [...all].at(-1);
			if (end === undefined || is.tool(end))
				return {
					answer: "broke",
					error: "the run ended with no result",
					...ran(noSpend),
				} satisfies Drafted;
			if (is.failed(end))
				return (
					end.error.startsWith(OVER_BUDGET)
						? {answer: "over_budget", ...ran(end.spend)}
						: {answer: "broke", error: end.error, ...ran(end.spend)}
				) satisfies Drafted;
			return (
				end.output === null
					? {answer: "misfit", ...ran(end.spend)}
					: {answer: "form", form: end.output, ...ran(end.spend)}
			) satisfies Drafted;
		});
	// Only the copy can fail: a run that never got its code took no link out of it.
	const repo = typeof config.repo === "string" ? config.repo : config.repo(brief.pr);
	return codeAt(repo, brief.head).pipe(
		Effect.flatMap(({tree, links}) => onCopy(tree, links)),
		Effect.scoped,
		Effect.catch((error) => Effect.succeed<Drafted>({answer: "broke", error, ...left(noSpend, 0)})),
	);
};

/**
 * One run as a stream. The doors of the opened tools put each call on the
 * same line the run's end goes on, so a note is always said before the end:
 * the SDK hands back its result only after the tool call has answered.
 */
export const reviewStream = (
	draft: (tools: Tools) => Effect.Effect<Drafted>,
): Stream.Stream<Said> =>
	Stream.callback<Said>((line) =>
		Effect.forkScoped(
			Effect.gen(function* () {
				const tools: Tools = {
					file_note: (note) =>
						Effect.sync(() =>
							Queue.offerUnsafe(line, {kind: "note", note}) ? "taken" : "refused",
						),
				};
				const drafted = yield* draft(tools);
				Queue.offerUnsafe(line, {kind: "ended", drafted});
				Queue.endUnsafe(line);
			}),
		),
	);

/** The reviewer on the Agent SDK. */
export const liveReviewer = (config: ReviewerConfig) =>
	Layer.succeed(Reviewer, {
		review: (brief, settings, note) =>
			reviewStream((tools) => draftLive(config, brief, settings, note, tools)),
	});
