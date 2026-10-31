// Experiment 136: can the planner, which reads the code, tell that a new ticket belongs inside an
// older open ticket's plan, so that one pull request carries both ("fold")?
//
// Experiment 133 found triage cannot: 2 right folds of 26 answers on 13 real demlik folds. Its lean
// was to move fold to the planner. This tests that lean on the same 13 folds and 13 controls
// (`133-truth.json`, `fold` and `control`).
//
// The planner is the plan stage's own: the Agent SDK options of `plannerOptions`
// (packages/pipeline/src/stages/plan/planner.ts), so Read, Grep and Glob only, held by the
// read-only Check, no settings, no servers, no connectors. Model and effort are the plan stage's
// defaults (`AGENT_DEFAULT` in packages/pipeline/src/setup.ts): opus, effort medium. It reads a
// copy of demlik's code with no history, as `livePlanner` makes one, at the last commit on main
// before the ticket was filed: main as the plan stage (./at-main.ts) would have fetched it then.
// Only one thing differs from a plan run: it is asked the fold question and nothing else, and
// answers `{joins, why}`. No full plan is written. Three arms (ARM):
//
//   may      the cheap shape: read the code where it helps, stop once you can answer
//   must     read the code first, where this ticket's change and each close ticket's change would
//            land, then answer. Added after the first three `may` runs read no code at all
//   unbuilt  brief `must`, with the list cut to tickets that had no pull request open yet. Added
//            after `must`'s answers were in: 10 of its 11 wrong names were such tickets. A case
//            whose list it does not change keeps `must`'s answers, as its prompt is the same
//
// Part B (PART=b) turns the question around, for the batches: the planner of a batch's first
// ticket (HEADS), two minutes after it was filed, is asked which open tickets its pull request
// should also carry, older or newer, and answers `{carries, why}`. Brief `must` only.
//
// Run with
//   node experiments/136-planner-folds.ts
//
//   STEP=fetch   every demlik issue with its labels, the first revision of each picked ticket and
//                of each ticket it could join, through `gh` (read-only), and the commit on main
//                before each was filed, from DEMLIK (a local clone of kamp-us/demlik; default
//                runs/exp-136-cache/demlik), and every pull request with the issues it closes.
//                Writes only CACHE. A cache already there is kept and only filled in where it
//                lacks something
//   STEP=ask     the planner, ARM=may, must or unbuilt (default must), RUNS (default 2) per
//                ticket; PART=b
//                asks part B's heads instead. ONLY=<n,n>, DRY=1 prints the estimate, PROMPT=1
//                prints the first prompt, MAX_USD (default 8, every arm and part together) stops
//                before a call that could pass it
//   STEP=field   print one field/runs.jsonl row per answer, every arm and part B
//   STEP=clean   remove the code copies under CACHE
//   (no STEP)    print the tables, every arm and part B. WHY=1 adds the planner's why on every
//                answer
//
// CACHE (default `runs/exp-136-cache`) holds ticket text and code and is never committed.
// `results/136-planner-folds.json` holds each answer, what it cost, and what the planner was shown.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files, `node:child_process`
// for `gh`, `git` and `tar`, as the other replay scripts do.
import {execFile} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika/agents/claude";
import {plannerOptions} from "@kampus/pipeline/stages/plan/planner";
import type {Settings} from "@kampus/pipeline/stages/plan/services";
import {removeLinks} from "@kampus/pipeline/stages/review/reviewer";
import {Option, Schema} from "effect";
import {median, pct} from "./lib/sort-bar.ts";
import {firstVersion, Ticket} from "./lib/sort.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-136-cache");
const DEMLIK = process.env.DEMLIK ?? join(CACHE, "demlik");
const STEP = process.env.STEP ?? "tables";
const RESULTS = join(here, "results", "136-planner-folds.json");
const T133 = join(here, "results", "133-triage-folds-and-needs-info.json");
const RUNS = Number(process.env.RUNS ?? 2);
const TRIES = 2;
const only = process.env.ONLY?.split(",").map(Number);
const ARMS = ["may", "must", "unbuilt"] as const;
type Arm = (typeof ARMS)[number];
const ARM: Arm = ARMS.find((a) => a === process.env.ARM) ?? "must";
const REPO = "kamp-us/demlik";
/** The plan stage's defaults. The budget is a cap per run, lower than the stage's $2, to keep the whole run under $8. */
const SETTINGS: Settings = {model: "opus", effort: "medium", budget: 1};
/** An open ticket's summary: its first revision's opening, at most this many characters, as in 133. */
const SUMMARY = 300;

// ---------------------------------------------------------------- the truth

const Fold = Schema.Struct({into: Schema.Array(Schema.Int), why: Schema.String});
const Control = Schema.Struct({near: Schema.Array(Schema.Int), why: Schema.String});
const TruthFile = Schema.Struct({
	fold: Schema.Record(Schema.String, Fold),
	control: Schema.Record(Schema.String, Control),
});
const truth = Schema.decodeUnknownSync(TruthFile)(
	JSON.parse(readFileSync(join(here, "133-truth.json"), "utf8")),
);
const FOLDS = Object.keys(truth.fold).map(Number);
/**
 * The controls in the order they are run, fixed before any answer was seen: the most batch-like
 * first (filed fewest seconds after the newest ticket it could join), so that a cut keeps the
 * hardest. #575 is moved up to seventh: it was triage's one false fold in 133.
 */
const CONTROLS = [468, 524, 412, 46, 360, 206, 575, 66, 212, 393, 569, 107, 682];
const PICKED = [...FOLDS, ...CONTROLS];
/**
 * Part B, 133's own "what would settle it": the planner of a batch's first ticket, a little after
 * that ticket was filed, asked which open tickets its pull request should also carry. Each head is
 * the ticket a batch fold folded into (388, 411, 423, 20), or the newest ticket a batch control
 * was filed seconds after (467, 523, 45, 358). Added after part A's answers were in.
 */
const HEADS = [388, 411, 423, 20, 467, 523, 45, 358];
/** When a head's planner is taken to run: this long after the head was filed. Sort takes seconds. */
const PLAN_AFTER_MS = 120_000;
const PART: "a" | "b" = process.env.PART === "b" ? "b" : "a";
/** The moment a head's planner runs. Pure. */
const momentOf = (createdAt: string) =>
	new Date(Date.parse(createdAt) + PLAN_AFTER_MS).toISOString().replace(/\.\d+Z$/, "Z");

// ---------------------------------------------------------------- the cache

const Listed = Schema.Struct({
	n: Schema.Int,
	title: Schema.String,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
	/** Every label it carries now or was ever given. */
	labels: Schema.Array(Schema.String),
});
type Listed = typeof Listed.Type;
/** A pull request: when it opened and closed, and the issues it closes. */
const Pr = Schema.Struct({
	n: Schema.Int,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
	closes: Schema.Array(Schema.Int),
});
type Pr = typeof Pr.Type;
const CacheFile = Schema.Struct({
	all: Schema.Array(Listed),
	/** The first revision of every picked ticket and of every ticket one could join. */
	firsts: Schema.Array(Ticket),
	/** The last commit on main before each picked ticket was filed. */
	at: Schema.Record(Schema.String, Schema.String),
	/** Part B: the last commit on main before each head's planner runs. */
	pull: Schema.Record(Schema.String, Schema.String),
	/** Every pull request, for arm `unbuilt`. */
	prs: Schema.Array(Pr),
});
type CacheFile = typeof CacheFile.Type;
const cacheFile = join(CACHE, "cases.json");

const run = (cmd: string, args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile(cmd, args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null
				? resolve(stdout)
				: reject(new Error(`${cmd} failed: ${stderr.slice(0, 300)}`)),
		),
	);

const ISSUES = `query($endCursor: String) {
  repository(owner: "kamp-us", name: "demlik") {
    issues(first: 100, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title createdAt closedAt
        labels(first: 30) { nodes { name } }
        timelineItems(first: 100, itemTypes: [LABELED_EVENT]) {
          nodes { ... on LabeledEvent { label { name } } }
        }
      }
    }
  }
}`;
const IssueNode = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
	labels: Schema.Struct({nodes: Schema.Array(Schema.Struct({name: Schema.String}))}),
	timelineItems: Schema.Struct({
		nodes: Schema.Array(
			Schema.Struct({label: Schema.optional(Schema.Struct({name: Schema.String}))}),
		),
	}),
});

/** Every demlik issue, with when it opened and closed and every label it ever had. Titles are today's. */
async function listAll(): Promise<Listed[]> {
	const out = await run("gh", [
		"api",
		"graphql",
		"--paginate",
		"-f",
		`query=${ISSUES}`,
		"--jq",
		".data.repository.issues.nodes[]",
	]);
	return out
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => Schema.decodeUnknownSync(IssueNode)(JSON.parse(line)))
		.map((i) => ({
			n: i.number,
			title: i.title,
			createdAt: i.createdAt,
			closedAt: i.closedAt,
			labels: [
				...new Set([
					...i.labels.nodes.map((l) => l.name),
					...i.timelineItems.nodes.flatMap((e) => (e.label === undefined ? [] : [e.label.name])),
				]),
			].sort(),
		}));
}

const PRS = `query($endCursor: String) {
  repository(owner: "kamp-us", name: "demlik") {
    pullRequests(first: 100, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes { number createdAt closedAt closingIssuesReferences(first: 20) { nodes { number } } }
    }
  }
}`;
const PrNode = Schema.Struct({
	number: Schema.Int,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
	closingIssuesReferences: Schema.Struct({
		nodes: Schema.Array(Schema.Struct({number: Schema.Int})),
	}),
});

/** Every demlik pull request, with the issues it closes. */
async function listPrs(): Promise<Pr[]> {
	const out = await run("gh", [
		"api",
		"graphql",
		"--paginate",
		"-f",
		`query=${PRS}`,
		"--jq",
		".data.repository.pullRequests.nodes[]",
	]);
	return out
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => Schema.decodeUnknownSync(PrNode)(JSON.parse(line)))
		.map((p) => ({
			n: p.number,
			createdAt: p.createdAt,
			closedAt: p.closedAt,
			closes: p.closingIssuesReferences.nodes.map((i) => i.number),
		}));
}

/** Labels today's triage gives work it sends on to be built: a plan. */
const WORK = ["type:bug", "type:feature", "type:chore", "type:epic"];
/** Labels of a ticket that is not headed for a plan: a session, a map, a spike, a ruling, a finding, or closed by triage. */
const NOT_WORK = [
	"grilling:session",
	"wayfinding:map",
	"prototyping:spike",
	"type:decision",
	"type:investigation",
	"closed-by-triage",
	"duplicate",
];
/** Triage sent it to plan, at its filing or later: it was typed as work, and never as anything else. Pure. */
const sentToPlan = (i: Listed) =>
	i.labels.some((l) => WORK.includes(l)) && !i.labels.some((l) => NOT_WORK.includes(l));

/** Filed before `t`: earlier, or in the same second with a lower number. Pure. */
const filedBefore = (i: Listed, t: {n: number; createdAt: string}) =>
	i.createdAt < t.createdAt || (i.createdAt === t.createdAt && i.n < t.n);
/** Open at `at`. Pure. */
const openAt = (i: Listed, at: string) =>
	i.createdAt <= at && (i.closedAt === null || i.closedAt > at);

/** The tickets `t` may join: filed before it, open when it was filed, and sent to plan. Newest first. Pure. */
const joinable = (all: readonly Listed[], t: {n: number; createdAt: string}) =>
	all
		.filter((i) => i.n !== t.n && filedBefore(i, t) && openAt(i, t.createdAt) && sentToPlan(i))
		.toSorted((x, y) => y.createdAt.localeCompare(x.createdAt) || y.n - x.n);

/** Part B: the tickets a head's pull request could carry, open and sent to plan when its planner runs, older or newer. Newest first. Pure. */
const carriable = (all: readonly Listed[], head: {n: number; createdAt: string}) => {
	const at = momentOf(head.createdAt);
	return all
		.filter((i) => i.n !== head.n && openAt(i, at) && sentToPlan(i))
		.toSorted((x, y) => y.createdAt.localeCompare(x.createdAt) || y.n - x.n);
};

// ---------------------------------------------------------------- the prompt

/** A first revision's opening, without comments, headings or runs of space: 133's `summaryOf`. Pure. */
const summaryOf = (t: Ticket) => {
	const text = t.body
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^#+ .*$/gm, "")
		.replace(/\s+/g, " ")
		.trim();
	return `${t.title}. ${text.length > SUMMARY ? `${text.slice(0, SUMMARY)}…` : text}`;
};

/** A text in a code fence longer than any run of backticks inside it, as the planner's brief fences it. */
function fenced(text: string): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((r) => r[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}markdown\n${text.replace(/\n+$/, "")}\n${fence}`;
}

interface Case {
	readonly ticket: Ticket;
	readonly at: string;
	readonly listed: readonly {readonly n: number; readonly summary: string}[];
}

/** A pull request that closes `n` was open at `at`: its plan is done and its build is out. Pure. */
const builtAt = (prs: readonly Pr[], n: number, at: string) =>
	prs.some(
		(p) => p.closes.includes(n) && p.createdAt <= at && (p.closedAt === null || p.closedAt > at),
	);

/**
 * One case, as the planner would meet it the moment the ticket was filed. Arm `unbuilt` leaves out
 * the tickets that had a pull request open then. Pure.
 */
function caseOf(cache: CacheFile, n: number, arm: Arm = "must"): Case {
	const firsts = new Map(cache.firsts.map((t) => [t.n, t]));
	const ticket = firsts.get(n);
	const at = cache.at[n];
	if (ticket === undefined || at === undefined) throw new Error(`#${n} is not in the cache`);
	const listed = joinable(cache.all, ticket)
		.filter((i) => arm !== "unbuilt" || !builtAt(cache.prs, i.n, ticket.createdAt))
		.flatMap((i) => {
			const first = firsts.get(i.n);
			return first === undefined ? [] : [{n: i.n, summary: summaryOf(first)}];
		});
	return {ticket, at, listed};
}

/** Part B: one head, as its planner would meet it two minutes after the head was filed. Pure. */
function headOf(cache: CacheFile, n: number): Case {
	const firsts = new Map(cache.firsts.map((t) => [t.n, t]));
	const ticket = firsts.get(n);
	const at = cache.pull[n];
	if (ticket === undefined || at === undefined) throw new Error(`head #${n} is not in the cache`);
	const listed = carriable(cache.all, ticket).flatMap((i) => {
		const first = firsts.get(i.n);
		return first === undefined ? [] : [{n: i.n, summary: summaryOf(first)}];
	});
	return {ticket, at, listed};
}

/** How much code the brief asks it to read before it answers, by arm. `unbuilt` changes only the list. */
const MUST =
	"Read the code before you answer, even when the ticket's text seems to be enough: find where this ticket's change would land, and where the change of each listed ticket that could be close would land. Then decide whether the two make one change. You need not read everything: stop once you know what each change would touch. If more than one fits, name the one whose change this ticket adds to most directly.";
const READING: Record<Arm, string> = {
	may: "Read the code where it helps you decide: what each change would touch, and whether the two make one change. Stop reading once you can answer. If more than one fits, name the one whose change this ticket adds to most directly.",
	must: MUST,
	unbuilt: MUST,
};

/** The fold question, in the planner's own framing. Pure: the same case and arm give the same text. */
export function promptOf(c: Case, arm: Arm): string {
	return [
		`You are the planner for one ticket: https://github.com/${REPO}/issues/${c.ticket.n}. Before any plan is written, answer one question: does this ticket belong inside the plan of one of the open tickets listed below, so that one pull request carries the work of both?`,
		"",
		"The code is in your working folder, at the commit the ticket would be planned against. You can read it with Read, Grep and Glob. You have no shell and no network, and you change nothing. Your whole answer is one small piece of data, described at the end. Do not write a plan.",
		"",
		"# The ticket",
		"",
		fenced(`# ${c.ticket.title}\n\n${c.ticket.body}`),
		"",
		"# The open tickets it could join",
		"",
		"Each was filed before this one, is still open, and is headed for a plan. Each shows its title and the opening of its text as it was filed, newest first.",
		"",
		...(c.listed.length === 0 ? ["None."] : c.listed.map((l) => `- #${l.n}: ${l.summary}`)),
		"",
		"# How to answer",
		"",
		"Join one (`joins`: its number) when this ticket's work belongs inside that ticket's plan: one pull request should carry both, because this ticket adds to the same change. For example a case that change misses, a part of it, or an edit to the same code that is best made in the same pass.",
		"",
		"Leave it alone (`joins: null`) when this ticket is a change of its own, one a builder would rather land in its own pull request. Being about the same package or the same topic is not enough on its own.",
		"",
		READING[arm],
		"",
		"`joins`: the number of one ticket from the list above, or null.",
		"`why`: one or two plain sentences.",
	].join("\n");
}

/** Part B's question: the head's planner, asked what else its pull request should carry. Brief `must`. Pure. */
export function pullPromptOf(c: Case): string {
	return [
		`You are the planner for one ticket: https://github.com/${REPO}/issues/${c.ticket.n}. Before you write its plan, answer one question: should the pull request for this ticket also carry the work of any of the open tickets listed below?`,
		"",
		"The code is in your working folder, at the commit the ticket would be planned against. You can read it with Read, Grep and Glob. You have no shell and no network, and you change nothing. Your whole answer is one small piece of data, described at the end. Do not write a plan.",
		"",
		"# The ticket",
		"",
		fenced(`# ${c.ticket.title}\n\n${c.ticket.body}`),
		"",
		"# The open tickets its pull request could carry",
		"",
		"Each is still open and is headed for a plan. Some were filed before this ticket and some after it. Each shows its title and the opening of its text as it was filed, newest first.",
		"",
		...(c.listed.length === 0 ? ["None."] : c.listed.map((l) => `- #${l.n}: ${l.summary}`)),
		"",
		"# How to answer",
		"",
		"Carry one (put its number in `carries`) when its work belongs inside this ticket's plan: one pull request should do both, because it adds to the same change. For example a case this change misses, a part of it, or an edit to the same code that is best made in the same pass.",
		"",
		"Leave it out when it is a change of its own, one a builder would rather land in its own pull request. Being about the same package or the same topic is not enough on its own.",
		"",
		"Read the code before you answer, even when the tickets' text seems to be enough: find where this ticket's change would land, and where the change of each listed ticket that could be close would land. Then decide whether they make one change. You need not read everything: stop once you know what each change would touch.",
		"",
		"`carries`: the numbers of the tickets from the list above that this pull request should also carry, or an empty list.",
		"`why`: one or two plain sentences.",
	].join("\n");
}

// ---------------------------------------------------------------- one answer

const FoldAnswer = Schema.Struct({joins: Schema.NullOr(Schema.Int), why: Schema.String});
/** Part B's answer. */
const PullAnswer = Schema.Struct({carries: Schema.Array(Schema.Int), why: Schema.String});
const Answer = Schema.Union([FoldAnswer, PullAnswer]);
type Answer = typeof Answer.Type;
const ANSWERS = {
	a: {schema: FoldAnswer, read: reader(FoldAnswer)},
	b: {schema: PullAnswer, read: reader(PullAnswer)},
} as const;

/** The answer's Check: every ticket it names is one from the list. Pure. */
function problemsOf(a: Answer, c: Case): string[] {
	const named = "joins" in a ? (a.joins === null ? [] : [a.joins]) : a.carries;
	return named
		.filter((n) => !c.listed.some((l) => l.n === n))
		.map(
			(n) =>
				`#${n} is not one of the open tickets listed: name only tickets from the list${"joins" in a ? ", or give `joins: null`" : ""}.`,
		);
}

const Try = Schema.Struct({
	answer: Schema.NullOr(Answer),
	problems: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
	usd: Schema.Number,
	ms: Schema.Number,
	turns: Schema.Number,
	/** Every token billed, each turn's input counted again. */
	billed: Schema.Number,
	/** The conversation's size at its last turn. */
	context: Schema.Number,
	/** Read, Grep and Glob calls. */
	reads: Schema.Number,
	/** The model the SDK ran, by its full name. */
	model: Schema.String,
});
type Try = typeof Try.Type;
const Run = Schema.Struct({tries: Schema.Array(Try)});
type Run = typeof Run.Type;

type Usage = {
	readonly input_tokens: number;
	readonly output_tokens: number;
	readonly cache_creation_input_tokens?: number | null;
	readonly cache_read_input_tokens?: number | null;
};
const total = (u: Usage) =>
	u.input_tokens +
	u.output_tokens +
	(u.cache_creation_input_tokens ?? 0) +
	(u.cache_read_input_tokens ?? 0);

/** One planner call, with the plan stage's own options. Its folder is the code at the case's commit. */
async function askOnce(
	prompt: string,
	tree: string,
	part: "a" | "b",
): Promise<Omit<Try, "problems">> {
	const started = Date.now();
	let context = 0;
	let reads = 0;
	const {schema, read} = ANSWERS[part];
	for await (const message of query({
		prompt,
		options: {
			...plannerOptions(SETTINGS, tree),
			// One call, never continued: nothing of it is kept on disk.
			persistSession: false,
			outputFormat: {type: "json_schema", schema: jsonSchema(schema)},
		},
	})) {
		if (message.type === "assistant" && message.parent_tool_use_id === null) {
			context = total(message.message.usage as Usage);
			for (const block of message.message.content)
				if (block.type === "tool_use" && ["Read", "Grep", "Glob"].includes(block.name)) reads += 1;
		}
		if (message.type === "result") {
			const answer: Option.Option<Answer> =
				message.subtype === "success" ? read(message.structured_output) : Option.none();
			return {
				answer: Option.getOrNull(answer),
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				turns: message.num_turns,
				billed: total(message.usage),
				context,
				reads,
				model: Object.keys(message.modelUsage).join(","),
			};
		}
	}
	throw new Error("no result");
}

/** One answer: a try, the Check, and one more try told what the Check found. `arm` null: part B. */
async function askCase(c: Case, arm: Arm | null, tree: string): Promise<Run> {
	const tries: Try[] = [];
	let note: string | null = null;
	for (let i = 1; i <= TRIES; i++) {
		const first = arm === null ? pullPromptOf(c) : promptOf(c, arm);
		const prompt = note === null ? first : `${first}\n\n# Your last answer\n\n${note}`;
		const got = await askOnce(prompt, tree, arm === null ? "b" : "a");
		const problems = got.answer === null ? [] : problemsOf(got.answer, c);
		tries.push({...got, problems});
		if (got.answer === null || problems.length === 0) break;
		note = problems.join("\n");
	}
	return {tries};
}

/** The code at one commit, as plain files with no history and no links, as `livePlanner` copies it. */
async function treeAt(commit: string): Promise<string> {
	const tree = join(CACHE, "trees", commit, "code");
	if (!existsSync(join(tree, "package.json"))) {
		mkdirSync(tree, {recursive: true});
		const packed = join(CACHE, "trees", commit, "code.tar");
		await run("git", ["-C", DEMLIK, "archive", "--format=tar", "-o", packed, commit]);
		await run("tar", ["-xf", packed, "-C", tree]);
		rmSync(packed);
		await removeLinks(tree);
	}
	// The real path: the Check judges paths as written.
	return realpathSync(tree);
}

// ---------------------------------------------------------------- results

const Kept = Schema.Struct({
	/** The commit the code was read at. */
	at: Schema.String,
	/** The tickets it was shown as ones it could join, newest first. */
	listed: Schema.Array(Schema.Int),
	runs: Schema.Array(Run),
});
type Kept = {at: string; listed: readonly number[]; runs: Run[]};
type Cases = Record<string, Kept>;
const Saved = Schema.Struct({
	model: Schema.String,
	effort: Schema.String,
	/** Each arm's answers, by ticket. */
	may: Schema.Record(Schema.String, Kept),
	must: Schema.Record(Schema.String, Kept),
	/** Only the cases whose list it changes; the others keep `must`'s answers. */
	unbuilt: Schema.optional(Schema.Record(Schema.String, Kept)),
	/** Part B's answers, by head; `listed` is what its pull request could carry. */
	pull: Schema.optional(Schema.Record(Schema.String, Kept)),
});
type Saved = {model: string; effort: string; pull: Cases} & Record<Arm, Cases>;
const saved: Saved = existsSync(RESULTS)
	? (() => {
			const s = Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8")));
			return {...s, unbuilt: s.unbuilt ?? {}, pull: s.pull ?? {}} as Saved;
		})()
	: {model: SETTINGS.model, effort: SETTINGS.effort, may: {}, must: {}, unbuilt: {}, pull: {}};
/** An arm's answers as the tables read them: `unbuilt` borrows `must`'s where its list is the same. */
const viewOf = (arm: Arm): Cases =>
	arm !== "unbuilt"
		? saved[arm]
		: Object.fromEntries(
				PICKED.flatMap((n) => {
					const k = saved.unbuilt[n] ?? saved.must[n];
					return k === undefined ? [] : [[String(n), k]];
				}),
			);
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);

const loadCache = (): CacheFile => {
	if (!existsSync(cacheFile)) {
		console.error(`no ${cacheFile}: run STEP=fetch first`);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(CacheFile)(JSON.parse(readFileSync(cacheFile, "utf8")));
};

// ---------------------------------------------------------------- fetch

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	if (!existsSync(join(DEMLIK, ".git")))
		await run("gh", ["repo", "clone", REPO, DEMLIK, "--", "--quiet", "--no-checkout"]);
	await run("git", ["-C", DEMLIK, "fetch", "--quiet", "origin"]);
	// A cache already there is kept, so the cases part A ran on stay as they were.
	const old = existsSync(cacheFile)
		? Schema.decodeUnknownSync(
				Schema.Struct({
					...CacheFile.fields,
					pull: Schema.optional(CacheFile.fields.pull),
					prs: Schema.optional(CacheFile.fields.prs),
				}),
			)(JSON.parse(readFileSync(cacheFile, "utf8")))
		: undefined;
	const all = old?.all ?? (await listAll());
	const byN = new Map(all.map((i) => [i.n, i]));
	const issue = (n: number) => {
		const i = byN.get(n);
		if (i === undefined) throw new Error(`#${n} is not a demlik issue`);
		return i;
	};
	const picked = PICKED.map(issue);
	const heads = HEADS.map(issue);
	const wanted = [
		...new Set([
			...PICKED,
			...picked.flatMap((t) => joinable(all, t).map((i) => i.n)),
			...HEADS,
			...heads.flatMap((h) => carriable(all, h).map((i) => i.n)),
		]),
	];
	const firsts: Ticket[] = [...(old?.firsts ?? [])];
	for (const n of wanted)
		if (!firsts.some((t) => t.n === n)) firsts.push(await firstVersion(n, REPO));
	/** The last commit on main before a moment. */
	const mainAt = async (moment: string, n: number) => {
		const sha = (
			await run("git", [
				"-C",
				DEMLIK,
				"rev-list",
				"-1",
				"--first-parent",
				`--before=${moment}`,
				"origin/main",
			])
		).trim();
		if (sha === "") throw new Error(`no commit on main before #${n}`);
		return sha;
	};
	const at: Record<string, string> = {...old?.at};
	for (const t of picked) at[t.n] ??= await mainAt(t.createdAt, t.n);
	const pull: Record<string, string> = {...old?.pull};
	for (const h of heads) pull[h.n] ??= await mainAt(momentOf(h.createdAt), h.n);
	const prs = old?.prs ?? (await listPrs());
	writeFileSync(cacheFile, JSON.stringify({all, firsts, at, pull, prs}, null, "\t"));
	console.log(
		`${all.length} issues, ${firsts.length} first revisions, ${new Set([...Object.values(at), ...Object.values(pull)]).size} commits`,
	);
	process.exit(0);
}

if (STEP === "clean") {
	rmSync(join(CACHE, "trees"), {recursive: true, force: true});
	console.log("removed the code copies");
	process.exit(0);
}

// ---------------------------------------------------------------- ask

/** What one run costs, for the estimate: a guess from 86's plans until the first runs measure it. */
const GUESS_USD = Number(process.env.GUESS_USD ?? 0.25);

/** An answer in a few words, for the log and the tables. Pure. */
const wordOf = (a: Answer | null | undefined) =>
	a === null || a === undefined
		? "none"
		: "joins" in a
			? a.joins === null
				? "own"
				: `#${a.joins}`
			: a.carries.length === 0
				? "carries none"
				: `carries #${a.carries.join(", #")}`;

if (STEP === "ask") {
	const cache = loadCache();
	const cases = PART === "b" ? saved.pull : saved[ARM];
	const caseFor = (n: number) => (PART === "b" ? headOf(cache, n) : caseOf(cache, n, ARM));
	const promptFor = (c: Case) => (PART === "b" ? pullPromptOf(c) : promptOf(c, ARM));
	/** Arm `unbuilt` asks only where its list differs from `must`'s: elsewhere the prompt is the same. */
	const differs = (n: number) =>
		ARM !== "unbuilt" ||
		caseOf(cache, n, "unbuilt").listed.length !== caseOf(cache, n, "must").listed.length;
	const todo = (PART === "b" ? HEADS : PICKED)
		.filter((n) => (only === undefined || only.includes(n)) && (PART === "b" || differs(n)))
		.flatMap((n) =>
			Array.from({length: Math.max(0, RUNS - (cases[n]?.runs.length ?? 0))}, () => n),
		);
	const chars = todo.reduce((s, n) => s + promptFor(caseFor(n)).length, 0);
	console.log(
		`${PART === "b" ? "part B" : `arm ${ARM}`}: ${todo.length} calls; the prompts are ${Math.round(chars / 4)} tokens in all; about $${(todo.length * GUESS_USD).toFixed(2)} at $${GUESS_USD} a call`,
	);
	if (process.env.PROMPT === "1" && todo[0] !== undefined) console.log(promptFor(caseFor(todo[0])));
	if (process.env.DRY === "1") process.exit(0);
	const MAX_USD = Number(process.env.MAX_USD ?? 8);
	let spent = [...ARMS.map((arm) => saved[arm]), saved.pull]
		.flatMap((cs) => Object.values(cs))
		.flatMap((k) => k.runs)
		.reduce((s, r) => s + r.tries.reduce((x, t) => x + t.usd, 0), 0);
	for (const n of todo) {
		// A call may spend up to its budget: never start one that could pass the cap.
		if (spent + SETTINGS.budget > MAX_USD) {
			console.log(`stopped at $${spent.toFixed(2)} in all, before #${n}`);
			break;
		}
		const c = caseFor(n);
		const r = await askCase(c, PART === "b" ? null : ARM, await treeAt(c.at));
		const usd = r.tries.reduce((s, t) => s + t.usd, 0);
		spent += usd;
		const kept = cases[n] ?? {at: c.at, listed: c.listed.map((l) => l.n), runs: []};
		cases[n] = {...kept, runs: [...kept.runs, r]};
		save();
		const last = r.tries.at(-1);
		console.log(
			`#${n}: ${last?.answer === null || last === undefined ? `(none: ${last?.error})` : wordOf(last.answer)}; ${r.tries.length} tr${r.tries.length === 1 ? "y" : "ies"}, ${last?.turns} turns, ${last?.reads} reads, $${usd.toFixed(3)}, ${((last?.ms ?? 0) / 1000).toFixed(0)} s; $${spent.toFixed(2)} in all`,
		);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- reading the answers

const lastOf = (r: Run) => r.tries.at(-1);
const usdOf = (r: Run) => r.tries.reduce((s, t) => s + t.usd, 0);
const msOf = (r: Run) => r.tries.reduce((s, t) => s + t.ms, 0);
const sum = (r: Run, key: "turns" | "billed" | "reads") => r.tries.reduce((s, t) => s + t[key], 0);
/** The ticket it joined, `null` for none, `undefined` for no answer. */
const joinsOf = (r: Run): number | null | undefined => {
	const a = lastOf(r)?.answer;
	return a === null || a === undefined || !("joins" in a) ? undefined : a.joins;
};
/** Part B: what the head's pull request would carry, `undefined` for no answer. */
const carriesOf = (r: Run): readonly number[] | undefined => {
	const a = lastOf(r)?.answer;
	return a === null || a === undefined || !("carries" in a) ? undefined : a.carries;
};
/**
 * Part B: the listed tickets that really landed in the head's pull request. A fold into the head,
 * or into a set of targets that holds the head (#424 to #426 into #423 and #422, so #422 too).
 * Pure.
 */
const sharedOf = (head: number, listed: readonly number[]) =>
	listed.filter(
		(n) =>
			truth.fold[n]?.into.includes(head) === true ||
			Object.values(truth.fold).some((f) => f.into.includes(head) && f.into.includes(n)),
	);

type Verdict = "right" | "sibling" | "neighbour" | "none" | "no_answer" | "kept" | "false_fold";
/**
 * One answer against the truth. On a fold: `right` names a right target; `sibling` names a ticket
 * that itself folded into a right target, so the same pull request carries all three; `neighbour`
 * names another ticket; `none` joins nothing. On a control: `kept` joins nothing, `false_fold`
 * joins something. Pure.
 */
function verdictOf(n: number, r: Run): Verdict {
	const j = joinsOf(r);
	if (j === undefined) return "no_answer";
	const f = truth.fold[n];
	if (f === undefined) return j === null ? "kept" : "false_fold";
	if (j === null) return "none";
	if (f.into.includes(j)) return "right";
	if (truth.fold[j]?.into.some((x) => f.into.includes(x)) === true) return "sibling";
	return "neighbour";
}

const truthWord = (n: number) =>
	truth.fold[n] !== undefined
		? `fold into #${truth.fold[n]?.into.join(" or #")}`
		: `own plan (near #${truth.control[n]?.near.join(", #")})`;

// ---------------------------------------------------------------- field rows

if (STEP === "field") {
	const NOTE = process.env.NOTE ?? "2026-10-24-07";
	for (const arm of ARMS)
		for (const n of PICKED)
			(saved[arm][n]?.runs ?? []).forEach((r, i) => {
				const j = joinsOf(r);
				const last = lastOf(r);
				console.log(
					JSON.stringify({
						date: "2026-10-24",
						lane: `${REPO}#${n}`,
						role: "planner",
						model: SETTINGS.model,
						effort: SETTINGS.effort,
						outcome: j === undefined ? "stopped" : "pass",
						why: `experiment 136, ${arm === "unbuilt" ? "brief must with tickets that had a pull request open left off the list" : `brief ${arm}`}: the planner's options and model, asked only whether the first title and body join an open ticket, code read at main before filing (run ${i + 1}, ${r.tries.length} tries, ${sum(r, "turns")} turns); said ${j === undefined ? "nothing" : j === null ? "no join" : `joins #${j}`}, really ${truthWord(n)}; posted nothing`,
						tokens: last?.context ?? 0,
						tools: sum(r, "reads"),
						minutes: +(msOf(r) / 60000).toFixed(2),
						note: NOTE,
						driver_caused: false,
						costUsd: +usdOf(r).toFixed(4),
						billed: sum(r, "billed"),
						replay: true,
						name: null,
					}),
				);
			});
	for (const n of HEADS)
		(saved.pull[n]?.runs ?? []).forEach((r, i) => {
			const cs = carriesOf(r);
			const last = lastOf(r);
			const shared = sharedOf(n, saved.pull[n]?.listed ?? []);
			console.log(
				JSON.stringify({
					date: "2026-10-24",
					lane: `${REPO}#${n}`,
					role: "planner",
					model: SETTINGS.model,
					effort: SETTINGS.effort,
					outcome: cs === undefined ? "stopped" : "pass",
					why: `experiment 136 part B: the planner's options and model, asked only which open tickets this ticket's pull request should also carry, two minutes after filing, code read at main then (run ${i + 1}, ${r.tries.length} tries, ${sum(r, "turns")} turns); said ${cs === undefined ? "nothing" : cs.length === 0 ? "none" : `#${cs.join(", #")}`}, really ${shared.length === 0 ? "none" : `#${shared.join(", #")}`}; posted nothing`,
					tokens: last?.context ?? 0,
					tools: sum(r, "reads"),
					minutes: +(msOf(r) / 60000).toFixed(2),
					note: NOTE,
					driver_caused: false,
					costUsd: +usdOf(r).toFixed(4),
					billed: sum(r, "billed"),
					replay: true,
					name: null,
				}),
			);
		});
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- tables

/** 133's triage answers on the same tickets, for the baseline. */
const T133Run = Schema.Struct({
	tries: Schema.Array(Schema.Struct({answer: Schema.NullOr(Schema.Unknown)})),
});
const t133 = existsSync(T133)
	? (Schema.decodeUnknownSync(
			Schema.Struct({a: Schema.Record(Schema.String, Schema.Array(T133Run))}),
		)(JSON.parse(readFileSync(T133, "utf8"))).a as Record<string, readonly (typeof T133Run.Type)[]>)
	: {};
const triageWord = (r: typeof T133Run.Type): string => {
	const a = (r.tries.at(-1)?.answer as {sort?: Record<string, unknown>} | null)?.sort;
	if (a === undefined) return "none";
	if (a.answer === "duplicate") return `dup #${a.of}`;
	if (a.answer === "no") return "no";
	if (a.next === "plan") return a.partOf === null ? "own" : `fold #${a.partOf}`;
	return String(a.next);
};

/** The 9 folds filed in one batch with their target, within 21 seconds; the other 4 are later reports. */
const BATCH = [389, 390, 391, 392, 413, 424, 425, 426, 21];
const count = (rs: readonly {v: Verdict}[], ...vs: Verdict[]) =>
	rs.filter((x) => vs.includes(x.v)).length;
const triageOn = (ns: readonly number[]) => ns.flatMap((n) => (t133[n] ?? []).map((r) => ({n, r})));

const everyRun = [...ARMS.map((arm) => saved[arm]), saved.pull]
	.flatMap((cs) => Object.values(cs))
	.flatMap((k) => k.runs);
console.log(
	`${saved.model} (${[...new Set(everyRun.flatMap((r) => r.tries.map((t) => t.model)))].join(", ")}), effort ${saved.effort}; $${everyRun.reduce((s, r) => s + usdOf(r), 0).toFixed(2)} in all`,
);

for (const arm of ARMS) {
	const cases = viewOf(arm);
	const all = Object.values(cases).flatMap((k) => k.runs);
	if (all.length === 0) continue;
	const per = (f: (r: Run) => number) => median(all.map(f));
	const fresh = Object.values(saved[arm]).flatMap((k) => k.runs);
	console.log(
		`\n## arm ${arm}: ${all.length} answers, ${all.reduce((s, r) => s + r.tries.length, 0)} calls${arm === "unbuilt" ? `, ${fresh.length} of the answers new (${Object.keys(saved.unbuilt).length} cases whose list changed), the rest must's` : ""}; new spend $${fresh.reduce((s, r) => s + usdOf(r), 0).toFixed(2)}`,
	);
	console.log(
		`a run, median: $${per(usdOf).toFixed(3)}, ${(per(msOf) / 1000).toFixed(0)} s, ${per((r) => sum(r, "turns"))} turns, ${per((r) => sum(r, "reads"))} reads, ${per((r) => lastOf(r)?.context ?? 0)} tokens of context at the end, ${per((r) => sum(r, "billed"))} billed`,
	);
	console.log(
		`a run, range: $${Math.min(...all.map(usdOf)).toFixed(3)} to $${Math.max(...all.map(usdOf)).toFixed(3)}, ${Math.min(...all.map((r) => sum(r, "turns")))} to ${Math.max(...all.map((r) => sum(r, "turns")))} turns, ${Math.min(...all.map((r) => sum(r, "reads")))} to ${Math.max(...all.map((r) => sum(r, "reads")))} reads`,
	);
	const runsOf = (ns: readonly number[]) =>
		ns.flatMap((n) => (cases[n]?.runs ?? []).map((r) => ({n, r, v: verdictOf(n, r)})));
	const ran = (ns: readonly number[]) => ns.filter((n) => (cases[n]?.runs.length ?? 0) > 0);
	for (const [label, ns] of [
		["folds", FOLDS],
		["  batch folds", BATCH],
		["  later reports", FOLDS.filter((n) => !BATCH.includes(n))],
	] as const) {
		const rs = runsOf(ns);
		console.log(
			`${label}: ${ran(ns).length} tickets, ${rs.length} answers; right ${count(rs, "right")}, a sibling in the same pull request ${count(rs, "sibling")}, a neighbour ${count(rs, "neighbour")}, nothing ${count(rs, "none")}, no answer ${count(rs, "no_answer")}`,
		);
	}
	const controls = runsOf(CONTROLS);
	console.log(
		`controls: ${ran(CONTROLS).length} tickets, ${controls.length} answers; false folds ${pct(count(controls, "false_fold"), controls.length)}, no answer ${count(controls, "no_answer")}`,
	);
	const same = ran(PICKED).filter((n) => {
		const js = (cases[n]?.runs ?? []).map(joinsOf);
		return js.length > 1 && js.every((j) => j === js[0]);
	}).length;
	console.log(`same answer both runs: ${same} of ${ran(PICKED).length}`);
	// 133's triage on the same tickets that ran here.
	const triageRight = triageOn(ran(FOLDS)).filter(({n, r}) => {
		const w = triageWord(r);
		return w.startsWith("fold #") && truth.fold[n]?.into.includes(Number(w.slice(6))) === true;
	}).length;
	const triageFalse = triageOn(ran(CONTROLS)).filter(({r}) =>
		triageWord(r).startsWith("fold"),
	).length;
	console.log(
		`133's triage on the same tickets: right ${triageRight} of ${triageOn(ran(FOLDS)).length}, false folds ${triageFalse} of ${triageOn(ran(CONTROLS)).length}`,
	);
	console.log(
		"\n| # | really | listed | planner | triage (133) | reads | $ | s |\n|---|---|---|---|---|---|---|---|",
	);
	for (const n of PICKED) {
		const k = cases[n];
		if (k === undefined) continue;
		const word = (r: Run) => {
			const j = joinsOf(r);
			const v = verdictOf(n, r);
			const ok = v === "right" || v === "sibling" || v === "kept";
			return `${j === undefined ? "none" : j === null ? "own" : `#${j}`}${ok ? "" : "*"}`;
		};
		console.log(
			`| ${n} | ${truthWord(n)} | ${k.listed.length} | ${k.runs.map(word).join(" / ")} | ${(t133[n] ?? []).map(triageWord).join(" / ")} | ${k.runs.map((r) => sum(r, "reads")).join(" / ")} | ${k.runs.map((r) => usdOf(r).toFixed(2)).join(" / ")} | ${k.runs.map((r) => (msOf(r) / 1000).toFixed(0)).join(" / ")} |`,
		);
		if (process.env.WHY === "1")
			for (const r of k.runs) console.log(`    ${lastOf(r)?.answer?.why ?? lastOf(r)?.error}`);
	}
	console.log("(* a miss)");
}

// Part B: what each head's pull request would carry, against what really landed in it.
const heads = HEADS.filter((n) => (saved.pull[n]?.runs.length ?? 0) > 0);
if (heads.length > 0) {
	const rows = heads.flatMap((n) => {
		const k = saved.pull[n] as Kept;
		const shared = sharedOf(n, k.listed);
		// The controls filed after the head, in its batch: tickets with a pull request of their own.
		const own = CONTROLS.filter((c) => k.listed.includes(c));
		return k.runs.map((r) => ({n, r, k, shared, own, cs: carriesOf(r)}));
	});
	const all = rows.map((x) => x.r);
	console.log(
		`\n## part B: ${heads.length} heads, ${all.length} answers, $${all.reduce((s, r) => s + usdOf(r), 0).toFixed(2)}; a run, median: $${median(all.map(usdOf)).toFixed(3)}, ${(median(all.map(msOf)) / 1000).toFixed(0)} s, ${median(all.map((r) => sum(r, "turns")))} turns, ${median(all.map((r) => sum(r, "reads")))} reads`,
	);
	const carried = (x: (typeof rows)[number], ns: readonly number[]) =>
		ns.filter((m) => x.cs?.includes(m) === true).length;
	const slots = (f: (x: (typeof rows)[number]) => readonly number[]) =>
		rows.reduce((s, x) => s + f(x).length, 0);
	const other = rows.flatMap((x) =>
		(x.cs ?? []).filter((m) => !x.shared.includes(m) && !x.own.includes(m)),
	);
	console.log(
		`really in the same pull request: carried ${rows.reduce((s, x) => s + carried(x, x.shared), 0)} of ${slots((x) => x.shared)}; batch controls with their own pull request: carried ${rows.reduce((s, x) => s + carried(x, x.own), 0)} of ${slots((x) => x.own)}; any other ticket carried ${other.length} times${other.length === 0 ? "" : ` (#${[...new Set(other)].join(", #")})`}; no answer ${rows.filter((x) => x.cs === undefined).length}`,
	);
	const same = heads.filter((n) => {
		const cs = (saved.pull[n]?.runs ?? []).map((r) => (carriesOf(r) ?? []).toSorted().join(","));
		return cs.length > 1 && cs.every((c) => c === cs[0]);
	}).length;
	console.log(`same answer both runs: ${same} of ${heads.length}`);
	console.log(
		"\n| head | listed | really same pull request | own pull request | planner carries | reads | $ | s |\n|---|---|---|---|---|---|---|---|",
	);
	for (const n of heads) {
		const k = saved.pull[n] as Kept;
		const shared = sharedOf(n, k.listed);
		const own = CONTROLS.filter((c) => k.listed.includes(c));
		const list = (ns: readonly number[]) => (ns.length === 0 ? "none" : `#${ns.join(", #")}`);
		console.log(
			`| ${n} | ${k.listed.length} | ${list(shared)} | ${list(own)} | ${k.runs.map((r) => (carriesOf(r) === undefined ? "no answer" : list(carriesOf(r) ?? []))).join(" / ")} | ${k.runs.map((r) => sum(r, "reads")).join(" / ")} | ${k.runs.map((r) => usdOf(r).toFixed(2)).join(" / ")} | ${k.runs.map((r) => (msOf(r) / 1000).toFixed(0)).join(" / ")} |`,
		);
		if (process.env.WHY === "1")
			for (const r of k.runs) console.log(`    ${lastOf(r)?.answer?.why ?? lastOf(r)?.error}`);
	}
}
