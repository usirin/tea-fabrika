// Experiment 88: does sort's "what's next" route real tickets right, with no
// ticket-kind label?
//
// Sort reads one new ticket and answers: a duplicate of an earlier one, yes, or
// no with a one-line reason (docs/direction/sort-answers-yes-or-no.md). The
// claim under test: a "yes" can also say what the ticket needs next, so the
// ledger needs no kind label (bug, feature, chore, decision, investigation,
// epic):
//
//   plan      something gets built: code, docs, config
//   ruling    an owner must choose before anything is built; never a builder
//   research  the answer is unknown and must be found out; ends in a finding
//
// Forty closed kamp-us/demlik issues are sorted from what was there when each
// was filed: its first title and its first body (read from GitHub's edit
// history, so nothing triage or planning added later is shown), and the
// numbers and titles of the issues filed before it, for the duplicate check.
// No labels, no comments, no pull requests. Each ticket is sorted twice, and
// both answers are set beside what really happened (88-truth.json).
//
// Run with
//   node experiments/88-sort-routing.ts
//
//   STEP=fetch   read each ticket's first title and body, and the list of
//                earlier issues, through `gh` (read-only). Writes only CACHE
//   STEP=sort    ask Claude through the Agent SDK, no tools (MODEL, default
//                sonnet; RUNS, default 2; ONLY=<n,n>; DRY=1 prints the
//                estimate and stops; stops before MAX_USD, default $5)
//   (no STEP)    print the tables from the saved answers and the truth file
//
// CACHE (default `runs/exp-88-cache`) holds the ticket text and is never
// committed. `results/88-sort-routing.json` holds each answer, its cost and
// time; `88-truth.json` the hand reading of what happened.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files
// and `node:child_process` for `gh`, as the other replay scripts do.
import {execFile} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {Option, Schema} from "effect";
import {agentEnv} from "../wip/src/env.ts";
import {jsonSchema, reader} from "../wip/src/schema.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-88-cache");
const STEP = process.env.STEP ?? "tables";
const REPO = "kamp-us/demlik";
const RESULTS = join(here, "results", "88-sort-routing.json");
const TRUTH = join(here, "88-truth.json");
const TICKETS = join(CACHE, "tickets.json");

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
const SortAnswer = Schema.Struct({sort: Schema.Union([Yes, No])});
type SortAnswer = typeof SortAnswer.Type;
const readAnswer = reader(SortAnswer);

/** One answer as the tables read it: `dup`, `no`, or the route of a yes. */
type Said = "plan" | "ruling" | "research" | "no" | "dup";
const saidOf = (a: SortAnswer["sort"]): Said =>
	a.answer === "yes" ? a.next : a.duplicateOf !== undefined ? "dup" : "no";

// ---------------------------------------------------------------- the data

const Ticket = Schema.Struct({
	n: Schema.Int,
	createdAt: Schema.String,
	title: Schema.String,
	body: Schema.String,
	/** How the first body was found: `unedited` (the body today), `history` (the oldest revision), or `history-gap` (the oldest revision had no text). */
	source: Schema.Literals(["unedited", "history", "history-gap"]),
	retitled: Schema.Boolean,
});
type Ticket = typeof Ticket.Type;
const Earlier = Schema.Struct({n: Schema.Int, title: Schema.String, createdAt: Schema.String});
const Cache = Schema.Struct({tickets: Schema.Array(Ticket), all: Schema.Array(Earlier)});

const Truth = Schema.Struct({
	note: Schema.String,
	tickets: Schema.Record(
		Schema.String,
		Schema.Struct({
			label: Schema.String,
			p0: Schema.optional(Schema.Boolean),
			end: Schema.Literals(["plan", "ruling", "research", "no", "dup"]),
			next: Schema.Literals(["plan", "ruling", "research", "no", "dup"]),
			dupOf: Schema.optional(Schema.Int),
			/** Set where `next` was put right after the run, from the ticket's history: the blind reading. */
			blindNext: Schema.optional(Schema.Literals(["plan", "ruling", "research", "no", "dup"])),
			why: Schema.String,
		}),
	),
});
const truth = Schema.decodeUnknownSync(Truth)(JSON.parse(readFileSync(TRUTH, "utf8"))).tickets;
const PICKED = Object.keys(truth).map(Number);

const Run = Schema.Struct({
	answer: Schema.NullOr(SortAnswer),
	error: Schema.NullOr(Schema.String),
	usd: Schema.Number,
	ms: Schema.Number,
	tokens: Schema.Number,
});
type Run = typeof Run.Type;
const Saved = Schema.Struct({
	model: Schema.String,
	runs: Schema.Record(Schema.String, Schema.Array(Run)),
	bare: Schema.optional(Schema.Record(Schema.String, Schema.Array(Run))),
});
type Runs = Record<string, Run[]>;
type Saved = {model: string; runs: Runs; bare?: Runs};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {model: "", runs: {}};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);

/**
 * `VARIANT=bare`: the follow-up run. Every demlik report here was written by
 * an agent that knew the kind labels, and most end in a "Suggested next step"
 * that says "decide", "spike" or "fix". The bare variant cuts that section and
 * the filing footer, to see how much of the route rested on the reporter
 * naming it. Its answers are kept apart, under `bare`.
 */
const VARIANT = process.env.VARIANT === "bare" ? "bare" : "runs";
saved[VARIANT] ??= {};
const pool: Runs = saved[VARIANT];

/** The body without its suggested next step and its filing footer. Pure. */
function bareBody(body: string): string {
	return body
		.replace(/^#{2,3} Suggested next step[^\n]*\n[\s\S]*?(?=^#{1,3} |^---\s*$|$(?![\s\S]))/m, "")
		.replace(/^---\s*\n\s*<sub>Filed by[\s\S]*$/m, "")
		.trimEnd();
}

const gh = (args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile("gh", args as string[], {maxBuffer: 64 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 300)}`)),
		),
	);

// ---------------------------------------------------------------- fetch

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
async function firstVersion(n: number): Promise<Ticket> {
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

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const tickets: Ticket[] = [];
	for (const n of PICKED) {
		tickets.push(await firstVersion(n));
		console.log(`#${n} ${tickets.at(-1)?.source}`);
	}
	const list = JSON.parse(
		await gh([
			"issue",
			"list",
			"-R",
			REPO,
			"--state",
			"all",
			"--limit",
			"2000",
			"--json",
			"number,title,createdAt",
		]),
	) as {number: number; title: string; createdAt: string}[];
	const all = list.map((i) => ({n: i.number, title: i.title, createdAt: i.createdAt}));
	writeFileSync(TICKETS, JSON.stringify({tickets, all}, null, "\t"));
	console.log(`${tickets.length} tickets, ${all.length} issues listed`);
	process.exit(0);
}

// ---------------------------------------------------------------- sort

const REPO_NOTE = [
	"The repo is kamp-us/demlik, a pnpm workspace of four npm packages:",
	"- @demlik/tea: a library for durable, replayable state machines in the Elm style (one pure reducer, a Promise engine and an Effect engine, host adapters).",
	"- @demlik/code-graph: a command-line tool that builds a code graph of a TypeScript repo and reports smells, as JSON for agents.",
	"- @demlik/structure-sweep and @demlik/backlog-sweep: tools that ask a small classifier (Jev) about a repo's folder structure and an issue backlog.",
	"Work is done by agents: a builder turns a ticket into a pull request, a reviewer checks it, a shipper merges it. The repo's owners make the calls that need a person.",
].join("\n");

const SYSTEM =
	"You sort new tickets for a software project. You read one ticket and give one answer, as data. Do not use any tool.";

/** The ticket text in a fence longer than any run of backticks inside it. */
function fenced(text: string): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	return `${fence}markdown\n${text.replace(/\n+$/, "")}\n${fence}`;
}

/** What sort is sent. Pure: the same ticket and list give the same text. */
function promptOf(t: Ticket, earlier: readonly {n: number; title: string}[]): string {
	return [
		REPO_NOTE,
		"",
		"# What you answer",
		"",
		"First: is this ticket a duplicate of an earlier one? A duplicate asks for the same change, or reports the same problem, as an earlier ticket, open or closed. If it is, answer no and give that ticket's number as duplicateOf.",
		"",
		'Otherwise: is it worth doing? Answer yes or no. A no carries a one-line reason a reader can act on, for example "not now: nobody needs this yet" or "won\'t do: out of scope".',
		"",
		"A yes also says what the ticket needs next, one of:",
		"- plan: something gets built or changed (code, docs, config, a workflow). The next step is to plan the work and hand it to a builder.",
		"- ruling: an owner of the project must choose before anything is built: between options, on a direction, a name, a policy, a trade-off. A builder must not pick for them. After the ruling the ticket may come back to be built.",
		"- research: nobody knows the answer yet and it has to be found out: measured, tried in a throwaway spike, or read out of the code or the docs. It ends in a finding, not a pull request.",
		"",
		"Pick the one step that has to happen first. `why` is one or two sentences on why you picked it.",
		"",
		`# The ticket: #${t.n}, filed ${t.createdAt.slice(0, 10)}`,
		"",
		fenced(`# ${t.title}\n\n${VARIANT === "bare" ? bareBody(t.body) : t.body}`),
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

/** Sonnet's list price, for the estimate only: what a call cost is read from the SDK's result. */
const SONNET_IN = 3 / 1e6;
const SONNET_OUT = 15 / 1e6;

async function sortOnce(t: Ticket, prompt: string): Promise<Run & {model: string}> {
	const started = Date.now();
	let model = "";
	for await (const message of query({
		prompt,
		options: {
			model: process.env.MODEL ?? "sonnet",
			systemPrompt: SYSTEM,
			tools: [],
			skills: [],
			mcpServers: {},
			strictMcpConfig: true,
			maxTurns: 3,
			settingSources: [],
			persistSession: false,
			cwd: CACHE,
			env: agentEnv(),
			outputFormat: {type: "json_schema", schema: jsonSchema(SortAnswer)},
		},
	})) {
		if (message.type === "system" && message.subtype === "init") model = message.model;
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
				model,
				answer: Option.getOrNull(answer),
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens,
			};
		}
	}
	throw new Error(`no result for #${t.n}`);
}

const loadCache = () => {
	if (!existsSync(TICKETS)) {
		console.error(`no ${TICKETS}: run STEP=fetch first`);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(Cache)(JSON.parse(readFileSync(TICKETS, "utf8")));
};

if (STEP === "sort") {
	const cache = loadCache();
	const RUNS = Number(process.env.RUNS ?? 2);
	const MAX_USD = Number(process.env.MAX_USD ?? 5);
	const only = process.env.ONLY?.split(",").map(Number);
	const todo = cache.tickets
		.filter((t) => only === undefined || only.includes(t.n))
		.flatMap((t) => {
			const done = pool[t.n]?.length ?? 0;
			return Array.from({length: Math.max(0, RUNS - done)}, () => t);
		});
	const promptFor = (t: Ticket) =>
		promptOf(
			t,
			cache.all.filter((e) => e.n < t.n),
		);
	const chars = todo.reduce((sum, t) => sum + promptFor(t).length, 0);
	const estimate = (chars / 4) * SONNET_IN + todo.length * 300 * SONNET_OUT;
	console.log(
		`${todo.length} calls, ${Math.round(chars / 4)} input tokens, about $${estimate.toFixed(2)} at sonnet's list price`,
	);
	if (process.env.DRY === "1") process.exit(0);
	let spent = 0;
	for (const t of todo) {
		if (spent >= MAX_USD) {
			console.log(`stopped at $${spent.toFixed(2)}`);
			break;
		}
		const r = await sortOnce(t, promptFor(t));
		spent += r.usd;
		saved.model = r.model;
		const {model: _, ...run} = r;
		pool[t.n] = [...(pool[t.n] ?? []), run];
		save();
		const a = r.answer?.sort;
		console.log(
			`#${t.n} ${a === undefined ? r.error : saidOf(a)}${a?.answer === "no" ? `: ${a.reason}` : ""} ($${r.usd.toFixed(3)}, ${(r.ms / 1000).toFixed(1)} s)`,
		);
	}
	console.log(`spent $${spent.toFixed(2)}`);
	process.exit(0);
}

// ---------------------------------------------------------------- tables

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

type Row = {n: number; label: string; end: Said; next: Said; said: (Said | null)[]};
const rows: Row[] = PICKED.flatMap((n) => {
	const t = truth[n];
	const runs = pool[n];
	if (t === undefined || runs === undefined) return [];
	return [
		{
			n,
			label: t.label,
			end: t.end,
			next: t.next,
			said: runs.map((r) => (r.answer === null ? null : saidOf(r.answer.sort))),
		},
	];
});
/** A duplicate is right only when it names the right earlier ticket. */
const right = (n: number, said: Said | null, want: Said, run: number) => {
	if (said !== want) return false;
	if (want !== "dup") return true;
	const a = pool[n]?.[run]?.answer?.sort;
	return a?.answer === "no" && a.duplicateOf === truth[n]?.dupOf;
};
const pct = (a: number, b: number) =>
	b === 0 ? "-" : `${a} of ${b} (${Math.round((100 * a) / b)}%)`;
const answers = rows.flatMap((r) => r.said.map((s, i) => ({r, s, i})));
const yesNo = (s: Said | null) => (s === null ? null : s === "no" || s === "dup" ? "no" : "yes");

console.log(
	`${VARIANT === "bare" ? "bare variant (no suggested next step), " : ""}model ${saved.model}, ${rows.length} tickets, ${answers.length} answers\n`,
);
console.log(
	"right by `next` (the first step it really took):",
	pct(answers.filter((a) => right(a.r.n, a.s, a.r.next, a.i)).length, answers.length),
);
console.log(
	"right by `end` (the brief's mapping from the end state):",
	pct(answers.filter((a) => right(a.r.n, a.s, a.r.end, a.i)).length, answers.length),
);
console.log(
	"right by the blind reading of `next`, before two were put right:",
	pct(
		answers.filter((a) => right(a.r.n, a.s, truth[a.r.n]?.blindNext ?? a.r.next, a.i)).length,
		answers.length,
	),
);
console.log(
	"right by either:",
	pct(
		answers.filter((a) => right(a.r.n, a.s, a.r.next, a.i) || right(a.r.n, a.s, a.r.end, a.i))
			.length,
		answers.length,
	),
);
console.log(
	"yes/no right by `next`:",
	pct(answers.filter((a) => yesNo(a.s) === yesNo(a.r.next)).length, answers.length),
);
const stable = rows.filter((r) => r.said.length >= 2 && r.said.every((s) => s === r.said[0]));
console.log(
	"same answer both runs:",
	pct(stable.length, rows.filter((r) => r.said.length >= 2).length),
);

console.log("\nby label (right by `next`, answers):");
const labels = [...new Set(rows.map((r) => r.label))];
for (const label of labels) {
	const of = answers.filter((a) => a.r.label === label);
	console.log(
		`  ${label}: ${pct(of.filter((a) => right(a.r.n, a.s, a.r.next, a.i)).length, of.length)}`,
	);
}

console.log("\nconfusion, `next` across, said down:");
const kinds: Said[] = ["plan", "ruling", "research", "no", "dup"];
console.log(`${"".padEnd(10)}${kinds.map((k) => k.padStart(9)).join("")}`);
for (const said of [...kinds, null]) {
	console.log(
		`${String(said).padEnd(10)}${kinds.map((k) => String(answers.filter((a) => a.s === said && a.r.next === k).length).padStart(9)).join("")}`,
	);
}

console.log("\nevery ticket:");
for (const r of rows) {
	const runs = pool[r.n] ?? [];
	const marks = r.said.map((s, i) => `${s}${right(r.n, s, r.next, i) ? "" : "*"}`).join(" / ");
	const reasons = runs
		.map((x) => x.answer?.sort)
		.map((a) =>
			a === undefined
				? ""
				: a.answer === "no"
					? `${a.reason}${a.duplicateOf ? ` (#${a.duplicateOf})` : ""}`
					: "",
		)
		.filter((x) => x !== "");
	console.log(
		`#${r.n} [${r.label}] next=${r.next} end=${r.end}: ${marks}${reasons.length > 0 ? ` | ${reasons.join(" | ")}` : ""}`,
	);
}
if (process.env.WHY === "1") {
	console.log("\nwhy, on every miss by `next`:");
	for (const a of answers.filter((x) => !right(x.r.n, x.s, x.r.next, x.i))) {
		console.log(`#${a.r.n} run ${a.i + 1} ${a.s}: ${pool[a.r.n]?.[a.i]?.answer?.sort.why}`);
	}
}
const all = Object.values(pool).flat();
console.log(
	`\ncost $${all.reduce((s, r) => s + r.usd, 0).toFixed(2)}, ${all.length} calls, median ${(
		([...all].sort((a, b) => a.ms - b.ms)[Math.floor(all.length / 2)]?.ms ?? 0) / 1000
	).toFixed(1)} s a call`,
);
