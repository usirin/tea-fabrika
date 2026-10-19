// Sort on closed kamp-us/demlik tickets, as experiments 88 and 92 run it: the
// answer's shape, the ticket as it was filed, the brief sort is sent, and one
// call to Claude with no tools.
//
// Node at the edge, said out loud: `node:child_process` for `gh`, as the other
// replay scripts do.
import {execFile} from "node:child_process";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {Option, Schema} from "effect";
import {agentEnv} from "../../wip/src/env.ts";
import {jsonSchema, reader} from "../../wip/src/schema.ts";

// ---------------------------------------------------------------- the answer

/** A yes always says what comes next. */
const Yes = Schema.Struct({
	answer: Schema.Literal("yes"),
	next: Schema.Literals(["plan", "ruling", "research"]),
	why: Schema.String,
});
/** A no always says why; a duplicate is a no that names the earlier ticket. */
const No = Schema.Struct({
	answer: Schema.Literal("no"),
	reason: Schema.String,
	duplicateOf: Schema.optional(Schema.Int),
	why: Schema.String,
});
/** Sort's answer, as data. A yes with no route, or a no with no reason, cannot be written. */
export const SortAnswer = Schema.Struct({sort: Schema.Union([Yes, No])});
export type SortAnswer = typeof SortAnswer.Type;
const readAnswer = reader(SortAnswer);

/** One answer as the tables read it: `dup`, `no`, or the route of a yes. */
export const SAID = ["plan", "ruling", "research", "no", "dup"] as const;
export type Said = (typeof SAID)[number];
export const saidOf = (a: SortAnswer["sort"]): Said =>
	a.answer === "yes" ? a.next : a.duplicateOf !== undefined ? "dup" : "no";

// ---------------------------------------------------------------- the ticket

export const Ticket = Schema.Struct({
	n: Schema.Int,
	createdAt: Schema.String,
	title: Schema.String,
	body: Schema.String,
	/** How the first body was found: `unedited` (the body today), `history` (the oldest revision), or `history-gap` (the oldest revision had no text). */
	source: Schema.Literals(["unedited", "history", "history-gap"]),
	retitled: Schema.Boolean,
});
export type Ticket = typeof Ticket.Type;
const Earlier = Schema.Struct({n: Schema.Int, title: Schema.String, createdAt: Schema.String});
export type Earlier = typeof Earlier.Type;
export const Cache = Schema.Struct({tickets: Schema.Array(Ticket), all: Schema.Array(Earlier)});

/** What really happened to one ticket, read by hand from its labels, comments and closing PR. */
export const TruthEntry = Schema.Struct({
	label: Schema.String,
	p0: Schema.optional(Schema.Boolean),
	end: Schema.Literals(SAID),
	next: Schema.Literals(SAID),
	dupOf: Schema.optional(Schema.Int),
	/** Set where `next` was put right after the run, from the ticket's history: the blind reading. */
	blindNext: Schema.optional(Schema.Literals(SAID)),
	why: Schema.String,
});
export type TruthEntry = typeof TruthEntry.Type;
export const Truth = Schema.Struct({
	note: Schema.String,
	tickets: Schema.Record(Schema.String, TruthEntry),
});

/** One sort call as saved: the answer or why there was none, and what it cost. */
export const Run = Schema.Struct({
	answer: Schema.NullOr(SortAnswer),
	error: Schema.NullOr(Schema.String),
	usd: Schema.Number,
	ms: Schema.Number,
	tokens: Schema.Number,
});
export type Run = typeof Run.Type;

/**
 * The body without its suggested next step and its filing footer. Pure. Every
 * demlik report here was written by an agent that knew the kind labels, and
 * most end in a "Suggested next step" that says "decide", "spike" or "fix".
 */
export function bareBody(body: string): string {
	return body
		.replace(/^#{2,3} Suggested next step[^\n]*\n[\s\S]*?(?=^#{1,3} |^---\s*$|$(?![\s\S]))/m, "")
		.replace(/^---\s*\n\s*<sub>Filed by[\s\S]*$/m, "")
		.trimEnd();
}

// ---------------------------------------------------------------- fetch

const gh = (args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile("gh", args as string[], {maxBuffer: 64 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 300)}`)),
		),
	);

const ISSUE = `query($n:Int!){repository(owner:"kamp-us",name:"demlik"){issue(number:$n){
  number title body createdAt
  userContentEdits(first:100){nodes{editedAt diff}}
  timelineItems(itemTypes:[RENAMED_TITLE_EVENT],first:1){nodes{... on RenamedTitleEvent{previousTitle}}}
}}}`;
const IssueReply = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			issue: Schema.Struct({
				number: Schema.Int,
				title: Schema.String,
				body: Schema.String,
				createdAt: Schema.String,
				userContentEdits: Schema.Struct({
					nodes: Schema.Array(
						Schema.Struct({editedAt: Schema.String, diff: Schema.NullOr(Schema.String)}),
					),
				}),
				timelineItems: Schema.Struct({
					nodes: Schema.Array(Schema.Struct({previousTitle: Schema.optional(Schema.String)})),
				}),
			}),
		}),
	}),
});

/**
 * The ticket as it was filed. GitHub keeps every revision of a body; the
 * oldest is the text the reporter filed, before triage or planning wrote into
 * it. A title renamed later is put back from its first rename.
 */
export async function firstVersion(n: number): Promise<Ticket> {
	const raw = await gh(["api", "graphql", "-f", `query=${ISSUE}`, "-F", `n=${n}`]);
	const i = Schema.decodeUnknownSync(IssueReply)(JSON.parse(raw)).data.repository.issue;
	const edits = [...i.userContentEdits.nodes].sort((a, b) => a.editedAt.localeCompare(b.editedAt));
	const oldest = edits[0];
	const rename = i.timelineItems.nodes[0]?.previousTitle;
	return {
		n,
		createdAt: i.createdAt,
		title: rename ?? i.title,
		retitled: rename !== undefined,
		...(oldest === undefined
			? {body: i.body, source: "unedited" as const}
			: oldest.diff === null
				? {body: i.body, source: "history-gap" as const}
				: {body: oldest.diff, source: "history" as const}),
	};
}

/** Every issue in the repo, open or closed: number, title as it stands today, and filing time. */
export async function allIssues(repo: string): Promise<Earlier[]> {
	const list = JSON.parse(
		await gh([
			"issue",
			"list",
			"-R",
			repo,
			"--state",
			"all",
			"--limit",
			"2000",
			"--json",
			"number,title,createdAt",
		]),
	) as {number: number; title: string; createdAt: string}[];
	return list.map((i) => ({n: i.number, title: i.title, createdAt: i.createdAt}));
}

// ---------------------------------------------------------------- the brief

export const REPO_NOTE = [
	"The repo is kamp-us/demlik, a pnpm workspace of four npm packages:",
	"- @demlik/tea: a library for durable, replayable state machines in the Elm style (one pure reducer, a Promise engine and an Effect engine, host adapters).",
	"- @demlik/code-graph: a command-line tool that builds a code graph of a TypeScript repo and reports smells, as JSON for agents.",
	"- @demlik/structure-sweep and @demlik/backlog-sweep: tools that ask a small classifier (Jev) about a repo's folder structure and an issue backlog.",
	"Work is done by agents: a builder turns a ticket into a pull request, a reviewer checks it, a shipper merges it. The repo's owners make the calls that need a person.",
].join("\n");

export const SYSTEM =
	"You sort new tickets for a software project. You read one ticket and give one answer, as data. Do not use any tool.";

/** The plain-word meaning of each route, as sort's brief states it. */
export const ROUTES = {
	plan: "something gets built or changed (code, docs, config, a workflow). The next step is to plan the work and hand it to a builder.",
	ruling:
		"an owner of the project must choose before anything is built: between options, on a direction, a name, a policy, a trade-off. A builder must not pick for them. After the ruling the ticket may come back to be built.",
	research:
		"nobody knows the answer yet and it has to be found out: measured, tried in a throwaway spike, or read out of the code or the docs. It ends in a finding, not a pull request.",
} as const;

/** The ticket text in a fence longer than any run of backticks inside it. */
function fenced(text: string): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}markdown\n${text.replace(/\n+$/, "")}\n${fence}`;
}

/**
 * What sort is sent. Pure: the same ticket, body, list and bar give the same
 * text. `bar` is the repo's bar for what is worth doing, as lines; with none,
 * the brief is experiment 88's, word for word.
 */
export function promptOf(
	t: Ticket,
	body: string,
	earlier: readonly {n: number; title: string}[],
	bar: readonly string[] = [],
): string {
	return [
		REPO_NOTE,
		"",
		"# What you answer",
		"",
		"First: is this ticket a duplicate of an earlier one? A duplicate asks for the same change, or reports the same problem, as an earlier ticket, open or closed. If it is, answer no and give that ticket's number as duplicateOf.",
		"",
		'Otherwise: is it worth doing? Answer yes or no. A no carries a one-line reason a reader can act on, for example "not now: nobody needs this yet" or "won\'t do: out of scope".',
		"",
		...(bar.length === 0 ? [] : [...bar, ""]),
		"A yes also says what the ticket needs next, one of:",
		`- plan: ${ROUTES.plan}`,
		`- ruling: ${ROUTES.ruling}`,
		`- research: ${ROUTES.research}`,
		"",
		"Pick the one step that has to happen first. `why` is one or two sentences on why you picked it.",
		"",
		`# The ticket: #${t.n}, filed ${t.createdAt.slice(0, 10)}`,
		"",
		fenced(`# ${t.title}\n\n${body}`),
		"",
		"# Earlier tickets in this repo, open or closed, newest first",
		"",
		earlier.length === 0
			? "None."
			: earlier
					.toReversed()
					.map((e) => `#${e.n} ${e.title}`)
					.join("\n"),
	].join("\n");
}

// ---------------------------------------------------------------- one call

/** Sonnet's list price, for the estimate only: what a call cost is read from the SDK's result. */
export const SONNET_IN = 3 / 1e6;
export const SONNET_OUT = 15 / 1e6;

/** One sort call through the Agent SDK: no tools, no skills, no settings, the answer read back by its schema. */
export async function sortOnce(
	n: number,
	prompt: string,
	cwd: string,
	model = "sonnet",
): Promise<Run & {model: string}> {
	const started = Date.now();
	let seen = "";
	for await (const message of query({
		prompt,
		options: {
			model,
			systemPrompt: SYSTEM,
			tools: [],
			skills: [],
			mcpServers: {},
			strictMcpConfig: true,
			maxTurns: 3,
			settingSources: [],
			persistSession: false,
			cwd,
			env: agentEnv(),
			outputFormat: {type: "json_schema", schema: jsonSchema(SortAnswer)},
		},
	})) {
		if (message.type === "system" && message.subtype === "init") seen = message.model;
		if (message.type === "result") {
			const u = message.usage;
			const tokens =
				u.input_tokens +
				u.output_tokens +
				(u.cache_creation_input_tokens ?? 0) +
				(u.cache_read_input_tokens ?? 0);
			const answer =
				message.subtype === "success" ? readAnswer(message.structured_output) : Option.none();
			return {
				model: seen,
				answer: Option.getOrNull(answer),
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens,
			};
		}
	}
	throw new Error(`no result for #${n}`);
}
