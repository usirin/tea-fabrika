// Can a reviewer agent find the case a ticket's tests left out? Two parts.
//
// Part A, free: take the tickets kamp-us/demlik shipped last, newest first,
// until there are 100 acceptance-criterion lines, and sort every line by the
// written rules in `61-sorting.json`: a recipe code could run, a line that
// needs reading, or both, with a flag for a line that claims every / all /
// never / unchanged without listing the cases.
//
// Part B, paid: for merged pull requests where one case under one criterion is
// known to have been left out, hand a reviewer the code at the pull request's
// head commit, the ticket's criteria and the names of the changed test files,
// and ask per criterion which case the tests do not try. Three runs a case was
// the plan; the budget bought two.
//
// Run with
//   node experiments/61-missing-case.ts
//
//   (no STEP)     print the tables from the saved files: no key, no network
//   STEP=lines    Part A: read the tickets through `gh` (read-only) and write
//                 `61-criteria.json`. UNTIL=<time> pins the newest merge taken
//   STEP=keys     Part B: read each case's pull request and ticket through
//                 `gh` (read-only) and write `results/missing-case-keys.json`:
//                 the head commit, the changed test files, the criteria as
//                 written, beside the hand-written key from `61-cases.json`
//   STEP=leaks    Part B: unpack each head commit into a new folder with no
//                 `.git`, and search it for the words `61-cases.json` lists per
//                 case. Needs CLONE=<a clone that holds every head commit; a
//                 bare one is fine>. Git only, read-only: `archive`
//   STEP=review   Part B: the reviewer runs. Needs CLONE. ARM=code (the whole
//                 copy, the default) or ARM=tests (only the changed test
//                 files). STEP=prompt prints what a case's reviewer is sent.
//                 RUNS=<per case, default 3>, ONLY=<case ids>,
//                 MAX_USD=<stop before this much is spent over every saved run,
//                 default 12>, RUN_USD=<the most one run may cost, default
//                 2.5>. Runs go round the cases, so a stop leaves the cases
//                 even. A run already saved is not run again
//
// The reviewer is started with the review stage's own settings
// (`reviewerOptions`, src/stages/review/reviewer.ts): the same model and
// effort, three tools (Read, Grep, Glob) as the whole tool list, no settings
// loaded from the machine or from the code, and the Check that refuses a read
// outside the folder it was given. It gets no diff, no pull request text, no
// deviations, no follow-up issue and no review.
//
// `61-sorting.json`, `61-cases.json` and `61-marks.json` are written by hand.
// `61-criteria.json` and everything under `results/` is written by this script.
// No saved file holds a path from the machine it ran on.
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {isAbsolute, join, relative, resolve} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika/pipeline/schema";
import {
	DEFAULT_EFFORT,
	DEFAULT_MODEL,
	reviewerOptions,
} from "@kampus/fabrika/pipeline/stages/review/reviewer";
import {Option, Schema} from "effect";

const here = import.meta.dirname;
const STEP = process.env.STEP ?? "tables";
const REPO = "kamp-us/demlik";
/** The merge of the newest pull request taken, so a later run reads the same tickets. */
const UNTIL = process.env.UNTIL ?? "2026-10-12T03:37:23Z";
const WANT_LINES = 100;
const CLONE = process.env.CLONE ?? "";
const ARM = process.env.ARM === "tests" ? "tests" : "code";
const RUNS = Number(process.env.RUNS ?? 3);
const MAX_USD = Number(process.env.MAX_USD ?? 12);
/** The most one run may cost before the SDK stops it. */
const RUN_USD = Number(process.env.RUN_USD ?? 2.5);
const ONLY = (process.env.ONLY ?? "").split(",").filter((id) => id !== "");

const criteriaFile = join(here, "61-criteria.json");
const sortingFile = join(here, "61-sorting.json");
const casesFile = join(here, "61-cases.json");
const marksFile = join(here, "61-marks.json");
const keysFile = join(here, "results", "missing-case-keys.json");
const leaksFile = join(here, "results", "missing-case-leaks.json");
const runsFile = join(here, "results", "missing-case-runs.json");
const countsFile = join(here, "results", "missing-case.json");

// ---------------------------------------------------------------- small tools

const pct = (n: number, of: number) => (of === 0 ? "" : `${((100 * n) / of).toFixed(1)}%`);
const share = (n: number, of: number) => `${n} of ${of} (${pct(n, of)})`;
const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);
const short = (text: string, most: number) =>
	text.length > most ? `${text.slice(0, most - 1)}…` : text;
const cell = (text: string) => text.replaceAll("|", "/").replaceAll("\n", " ");
function table(
	title: string,
	head: readonly string[],
	rows: readonly (readonly (string | number)[])[],
): void {
	console.log(`\n${title}\n`);
	console.log(`| ${head.join(" | ")} |`);
	console.log(`|${head.map(() => "---").join("|")}|`);
	for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const writeJson = (file: string, value: unknown) =>
	writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);
const gh = <T>(args: readonly string[]): T =>
	JSON.parse(execFileSync("gh", [...args], {encoding: "utf8", maxBuffer: 64 * 1024 * 1024})) as T;
const git = (args: readonly string[]) =>
	execFileSync("git", ["-C", CLONE, ...args], {encoding: "utf8", maxBuffer: 256 * 1024 * 1024});

// ---------------------------------------------------------------- reading a ticket

/** Where a triaged ticket keeps the report it was rewritten from. Lines under it are not the ticket's criteria. */
const ORIGINAL = "<!-- fabrika:enriched";
const CHECKBOX = /^\s*- \[[ xX]\] (.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;

/** The address of this repo names an account. One criterion line holds it; the account is cut. */
const scrub = (text: string) =>
	text.replaceAll(/github\.com\/[\w-]+\/tea-fabrika/g, "github.com/…/tea-fabrika");

/**
 * The ticket without the original report: from triage's marker to the end of
 * the folded block it opens, or to the end of the ticket when the block is
 * never closed. One ticket (#117) got its criteria from a ruling written under
 * the block, so cutting everything after the marker would lose them.
 */
function withoutOriginal(body: string): string {
	const from = body.indexOf(ORIGINAL);
	if (from === -1) return body;
	const close = body.indexOf("</details>", from);
	return close === -1 ? body.slice(0, from) : body.slice(0, from) + body.slice(close);
}

/**
 * A ticket's acceptance criteria as written: every checkbox line under a
 * heading that says "Acceptance criteria", outside the original report.
 */
export function criteriaOf(body: string): string[] {
	const out: string[] = [];
	let under = false;
	for (const line of withoutOriginal(body).split("\n")) {
		const heading = HEADING.exec(line);
		if (heading !== null) under = /acceptance criteria/i.test(heading[1] ?? "");
		const box = CHECKBOX.exec(line);
		if (under && box !== null) out.push(scrub((box[1] ?? "").trim()));
	}
	return out;
}

interface Issue {
	readonly number: number;
	readonly title: string;
	readonly body: string;
	readonly labels: readonly {readonly name: string}[];
}
const issue = (n: number) =>
	gh<Issue>(["issue", "view", String(n), "-R", REPO, "--json", "number,title,body,labels"]);

// ---------------------------------------------------------------- Part A: the lines

interface Line {
	/** `<ticket>#<its place in the ticket's list>`. */
	readonly id: string;
	readonly ticket: number;
	readonly n: number;
	readonly text: string;
}
interface Criteria {
	readonly until: string;
	readonly tickets: readonly {
		readonly ticket: number;
		readonly title: string;
		readonly pr: number;
		readonly merged: string;
		readonly lines: number;
	}[];
	readonly lines: readonly Line[];
}

interface Merged {
	readonly number: number;
	readonly mergedAt: string;
}
const closes = (pr: number) =>
	gh<{
		data: {
			repository: {pullRequest: {closingIssuesReferences: {nodes: readonly {number: number}[]}}};
		};
	}>([
		"api",
		"graphql",
		"-f",
		`query=query { repository(owner: "kamp-us", name: "demlik") { pullRequest(number: ${pr}) { closingIssuesReferences(first: 30) { nodes { number } } } } }`,
	]).data.repository.pullRequest.closingIssuesReferences.nodes.map((node) => node.number);

/**
 * Walk the merged pull requests, newest first. Take every ticket one closes,
 * except an epic's own ticket: its lines say its children's again. Stop after
 * the first pull request that brings the count to `WANT_LINES`.
 */
function fetchLines(): Criteria {
	const merged = gh<readonly Merged[]>([
		"pr",
		"list",
		"-R",
		REPO,
		"--state",
		"merged",
		"--limit",
		"120",
		"--json",
		"number,mergedAt",
	])
		.filter((pr) => pr.mergedAt <= UNTIL)
		.sort((a, b) => (a.mergedAt < b.mergedAt ? 1 : -1));
	const tickets: Criteria["tickets"][number][] = [];
	const lines: Line[] = [];
	for (const pr of merged) {
		if (lines.length >= WANT_LINES) break;
		for (const number of closes(pr.number).sort((a, b) => a - b)) {
			const ticket = issue(number);
			if (ticket.labels.some((label) => label.name === "type:epic")) continue;
			const own = criteriaOf(ticket.body);
			if (own.length === 0) continue;
			tickets.push({
				ticket: number,
				title: ticket.title,
				pr: pr.number,
				merged: pr.mergedAt,
				lines: own.length,
			});
			own.forEach((text, i) => {
				lines.push({id: `${number}#${i + 1}`, ticket: number, n: i + 1, text});
			});
		}
	}
	return {until: UNTIL, tickets, lines};
}

type Kind = "recipe" | "reading" | "both";
interface Sorting {
	readonly labels: Readonly<
		Record<string, {readonly kind: Kind; readonly universal: boolean; readonly why: string}>
	>;
}

function partA(): Record<string, unknown> | null {
	if (!existsSync(criteriaFile)) return null;
	const criteria = readJson<Criteria>(criteriaFile);
	const labels = readJson<Sorting>(sortingFile).labels;
	const sorted = criteria.lines.filter((line) => labels[line.id] !== undefined);
	console.log(
		`\n# Part A: ${criteria.lines.length} criterion lines on ${criteria.tickets.length} tickets, ${sorted.length} sorted`,
	);
	if (sorted.length === 0) return null;
	const of = (kind: Kind, universal?: boolean) =>
		sorted.filter(
			(line) =>
				labels[line.id]?.kind === kind &&
				(universal === undefined || labels[line.id]?.universal === universal),
		).length;
	const universal = sorted.filter((line) => labels[line.id]?.universal === true).length;
	const kinds: readonly Kind[] = ["recipe", "both", "reading"];
	table(
		"A1. How the lines sort",
		["Kind", "Lines", "Of them universal"],
		[
			...kinds.map((kind) => [kind, share(of(kind), sorted.length), of(kind, true)]),
			["all", sorted.length, share(universal, sorted.length)],
		],
	);
	const withRecipe = of("recipe") + of("both");
	const withReading = of("reading") + of("both");
	console.log(`\nA line with a recipe in it: ${share(withRecipe, sorted.length)}`);
	console.log(`A line with a reading part in it: ${share(withReading, sorted.length)}`);
	console.log(
		`A recipe-only line that is also universal: ${share(of("recipe", true), of("recipe"))} of the recipe-only lines`,
	);
	table(
		"A2. By ticket",
		["Ticket", "Lines", "recipe", "both", "reading", "universal"],
		criteria.tickets.map((ticket) => {
			const own = sorted.filter((line) => line.ticket === ticket.ticket);
			const count = (kind: Kind) => own.filter((line) => labels[line.id]?.kind === kind).length;
			return [
				`#${ticket.ticket} ${cell(short(ticket.title, 60))}`,
				own.length,
				count("recipe"),
				count("both"),
				count("reading"),
				own.filter((line) => labels[line.id]?.universal === true).length,
			];
		}),
	);
	return {
		lines: sorted.length,
		tickets: criteria.tickets.length,
		recipe: of("recipe"),
		both: of("both"),
		reading: of("reading"),
		universal,
		recipeAndUniversal: of("recipe", true),
		bothAndUniversal: of("both", true),
		readingAndUniversal: of("reading", true),
	};
}

// ---------------------------------------------------------------- Part B: the keys

/**
 * How a case's gap became known.
 * - `declared`: the builder wrote the gap down in the pull request.
 * - `seen in review`: the pipeline's own reviewer saw it while reviewing the
 *   pull request, did not send the work back, and it was filed as a follow-up
 *   before the merge.
 * - `found later`: nobody wrote it down by the merge. A later report showed it.
 */
type How = "declared" | "seen in review" | "found later";
const HOWS: readonly How[] = ["declared", "seen in review", "found later"];

/** One case, as written by hand before any run of it. */
interface Case {
	readonly id: string;
	readonly pr: number;
	readonly ticket: number;
	/** The criterion the gap sits under, by its place in the ticket's list. */
	readonly criterion: number;
	/** The missing case, in one plain sentence. */
	readonly missing: string;
	/** How the gap became known, and where it is written down. */
	readonly from: {readonly how: How; readonly url: string};
	/** Set on a case added after the plan was committed: when, and why. */
	readonly added?: string;
	/** Why the case counts: the criterion's own words that cover it, and what the code and tests show. */
	readonly sound: string;
	/** What to search the copy for, before a run: the folders, and the words. */
	readonly grep: {readonly in: readonly string[]; readonly for: readonly string[]};
}
interface Key extends Case {
	readonly head: string;
	readonly title: string;
	readonly criteria: readonly string[];
	readonly tests: readonly string[];
}

/** A changed file is a test file by its name or by a folder it sits in. */
export const isTestFile = (path: string) =>
	/\.test(-d)?\.[cm]?[jt]sx?$/.test(path) ||
	path.split("/").some((part) => ["test", "tests", "__tests__", "test-helpers"].includes(part));

function fetchKeys(): Key[] {
	return readJson<readonly Case[]>(casesFile).map((one) => {
		const pr = gh<{headRefOid: string; files: readonly {path: string; deletions: number}[]}>([
			"pr",
			"view",
			String(one.pr),
			"-R",
			REPO,
			"--json",
			"headRefOid,files",
		]);
		const ticket = issue(one.ticket);
		return {
			...one,
			head: pr.headRefOid,
			title: ticket.title,
			criteria: criteriaOf(ticket.body),
			tests: pr.files.map((file) => file.path).filter(isTestFile),
		};
	});
}

// ---------------------------------------------------------------- Part B: a fresh copy

/**
 * The code at one commit as plain files in a new folder under the system's
 * temp folder: `git archive` out of the clone, unpacked. With `only`, just
 * those paths. No `.git`, so nothing of the history is there to read.
 */
function freshCopy(head: string, only: readonly string[] = []): {root: string; tree: string} {
	// The real path: on some systems the temp folder is a link, and the Check judges paths as written.
	const root = realpathSync(mkdtempSync(join(tmpdir(), "missing-case-")));
	const tree = join(root, "code");
	mkdirSync(tree);
	const packed = join(root, "head.tar");
	git([
		"archive",
		"--format=tar",
		"-o",
		packed,
		head,
		...(only.length === 0 ? [] : ["--", ...only]),
	]);
	execFileSync("tar", ["-xf", packed, "-C", tree]);
	rmSync(packed);
	if (existsSync(join(tree, ".git"))) {
		console.error("the copy holds a .git folder: stopping");
		process.exit(1);
	}
	return {root, tree};
}

interface Hit {
	readonly file: string;
	readonly line: number;
	readonly text: string;
	readonly word: string;
}

/** Search one copy for a case's words. `grep` exits 1 when it finds nothing, which is an answer. */
function searchCopy(tree: string, key: Key): Hit[] {
	const hits: Hit[] = [];
	for (const word of key.grep.for) {
		const folders = key.grep.in.filter((folder) => existsSync(join(tree, folder)));
		if (folders.length === 0) continue;
		const found = Option.getOrElse(
			Option.liftThrowable(() =>
				execFileSync("grep", ["-rnEi", "--", word, ...folders], {
					cwd: tree,
					encoding: "utf8",
					maxBuffer: 64 * 1024 * 1024,
				}),
			)(),
			() => "",
		);
		for (const row of found.split("\n").filter((line) => line !== "")) {
			const match = /^([^:]+):(\d+):(.*)$/.exec(row);
			if (match === null) continue;
			hits.push({
				file: match[1] ?? "",
				line: Number(match[2]),
				text: short((match[3] ?? "").trim(), 220),
				word,
			});
		}
	}
	return hits;
}

// ---------------------------------------------------------------- Part B: the reviewer

/** One missing case, as the reviewer names it. */
const Missing = Schema.Struct({
	/** The missing case in one plain sentence. */
	case: Schema.String,
	/** The file that shows it, as a path from the working folder. */
	file: Schema.String,
	/** The lines that show it, such as `120-134`. */
	lines: Schema.String,
	/** What the code does with the case, as read. */
	code: Schema.Literals(["wrong", "unsure", "fine"]),
	/** How sure the reviewer is that the criterion covers the case and no test tries it. */
	sure: Schema.Literals(["high", "medium", "low"]),
});
const Answer = Schema.Struct({
	rows: Schema.Array(
		Schema.Struct({
			/** The criterion's number in the ticket's list. */
			criterion: Schema.Finite,
			missing: Schema.Array(Missing),
		}),
	),
});
type Answer = typeof Answer.Type;
const readAnswer = reader(Answer);

/** What the reviewer is sent. Pure: the same key and arm give the same text. */
export function promptOf(key: Pick<Key, "title" | "criteria" | "tests">, arm: "code" | "tests") {
	return [
		"You are checking the tests of one finished change against its ticket.",
		"",
		arm === "code"
			? "The code as it stands after the change is in your working folder. You can read it with Read, Grep and Glob. You have no shell: you cannot run a test, a build or any command. You have no network."
			: "Only the test files of the change are in your working folder. The rest of the code is not there. You can read them with Read, Grep and Glob. You have no shell: you cannot run a test, a build or any command. You have no network.",
		"",
		"# The ticket",
		"",
		key.title,
		"",
		"Its acceptance criteria, as written:",
		"",
		...key.criteria.map((text, i) => `${i + 1}. ${text}`),
		"",
		"# The test files the change added or changed",
		"",
		...key.tests.map((path) => `- ${path}`),
		"",
		"# The question",
		"",
		"For each criterion: what case does this line cover that the tests do not try?",
		"",
		"A case is one concrete input or situation. It counts when all three hold:",
		"- the words of the criterion cover it,",
		"- no test in the folder tries it,",
		arm === "code"
			? "- it matters: reading the code, the case would go wrong, or you cannot tell that it goes right."
			: "- it matters: a wrong result there would break what the criterion promises.",
		"",
		arm === "code"
			? "How to work: read each criterion and decide what it promises. Find the tests that check it and note the inputs they try. Then read the code that does the work, and ask which inputs the criterion's words cover that the tests never reach."
			: "How to work: read each criterion and decide what it promises. Find the tests that check it and note the inputs they try. Then ask which inputs the criterion's words cover that the tests never reach.",
		"",
		"Do not list every test someone could add. Name a case only if you would want it tried before this ships. For most criteria the right answer is no case at all, and an empty list is a fine answer. At most two cases for one criterion.",
		"",
		"# The answer",
		"",
		"One row for every criterion, by its number, none left out.",
		"- `missing`: the cases, or an empty list.",
		"- `case`: the missing case in one plain sentence: the input or situation, and what happens to it.",
		"- `file` and `lines`: the place in the code or the tests that shows it, as a path from the working folder and a line range like `120-134`.",
		arm === "code"
			? "- `code`: what the code does with this case, as you read it. `wrong`: it does the wrong thing. `unsure`: you cannot tell from reading. `fine`: it does the right thing and only the test is missing."
			: "- `code`: always `unsure` here, since the code is not in your folder.",
		"- `sure`: how sure you are that the criterion covers the case and that no test tries it: `high`, `medium` or `low`.",
	].join("\n");
}

/** One reviewer run, as saved. */
interface Run {
	readonly case: string;
	readonly arm: "code" | "tests";
	readonly n: number;
	/** The model and the tools, as the SDK's first message names them. */
	readonly model: string;
	readonly tools: readonly string[];
	readonly usd: number;
	readonly seconds: number;
	readonly turns: number;
	/** Every token billed, each turn's whole input counted again. */
	readonly tokens: number;
	/** Each tool call: the tool, and what it was pointed at, as a path from the copy. */
	readonly calls: readonly {readonly tool: string; readonly at: string}[];
	/** The calls the Check refused. */
	readonly refused: readonly {readonly tool: string; readonly why: string}[];
	readonly end: "answer" | "misfit" | "broke";
	readonly error: string | null;
	readonly rows: Answer["rows"];
}

/**
 * A tool in a run's list that comes from a connector of the signed-in account,
 * not from the list the run was started with. Its name is not saved: it would
 * say which services that account has connected. One entry per such tool.
 */
const CONNECTOR_TOOL = "(a connector's tool)";
const listed = (tool: string) => (tool.startsWith("mcp__") ? CONNECTOR_TOOL : tool);

/** What a tool call was pointed at, never as a path of this machine. */
function targetOf(tree: string, input: Readonly<Record<string, unknown>>): string {
	const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
	const at = (path: string) => {
		const rel = relative(tree, resolve(tree, path));
		return rel.startsWith("..") || isAbsolute(rel) ? "(outside the copy)" : rel === "" ? "." : rel;
	};
	const file = text(input.file_path);
	if (file !== null) return at(file);
	const pattern = text(input.pattern);
	const path = text(input.path);
	return [path === null ? null : at(path), pattern].filter((part) => part !== null).join(" :: ");
}

async function review(key: Key, arm: "code" | "tests", n: number): Promise<Run> {
	const {root, tree} = freshCopy(key.head, arm === "tests" ? key.tests : []);
	const calls: {tool: string; at: string}[] = [];
	const refused: {tool: string; why: string}[] = [];
	const seen = {model: "", tools: [] as string[], usd: 0, seconds: 0, turns: 0, tokens: 0};
	const out: {structured: unknown; error: string | null; ended: boolean} = {
		structured: undefined,
		error: null,
		ended: false,
	};
	const stream = query({
		prompt: promptOf(key, arm),
		options: {
			...reviewerOptions(
				{repo: CLONE, model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, maxUsd: RUN_USD},
				tree,
				(tool, why) => refused.push({tool, why: why.replaceAll(tree, "(the copy)")}),
			),
			sessionId: randomUUID(),
			outputFormat: {type: "json_schema", schema: jsonSchema(Answer)},
		},
	});
	const drain = async () => {
		for await (const message of stream) {
			if (message.type === "system" && message.subtype === "init") {
				seen.model = message.model;
				seen.tools = message.tools.map(listed);
			}
			if (message.type === "assistant" && message.parent_tool_use_id === null) {
				for (const block of message.message.content) {
					if (block.type === "tool_use")
						calls.push({
							tool: block.name,
							at: targetOf(tree, (block.input ?? {}) as Record<string, unknown>),
						});
				}
			}
			if (message.type === "result") {
				out.ended = true;
				seen.usd = message.total_cost_usd;
				seen.seconds = message.duration_ms / 1000;
				seen.turns = message.num_turns;
				const usage = message.usage;
				seen.tokens =
					usage.input_tokens +
					usage.output_tokens +
					(usage.cache_creation_input_tokens ?? 0) +
					(usage.cache_read_input_tokens ?? 0);
				if (message.subtype === "success" && !message.is_error)
					out.structured = message.structured_output;
				else out.error = message.subtype;
			}
		}
	};
	// The SDK throws after an error result it already sent; only a throw before one is news.
	await drain().catch((error: unknown) => {
		if (!out.ended) out.error = String(error).replaceAll(tree, "(the copy)");
	});
	rmSync(root, {recursive: true, force: true});
	const answer = Option.getOrNull(readAnswer(out.structured));
	return {
		case: key.id,
		arm,
		n,
		model: seen.model,
		tools: seen.tools,
		usd: seen.usd,
		seconds: Math.round(seen.seconds),
		turns: seen.turns,
		tokens: seen.tokens,
		calls: calls.filter((call) => call.tool !== "StructuredOutput"),
		refused,
		end: out.error !== null ? "broke" : answer === null ? "misfit" : "answer",
		error: out.error,
		rows: answer === null ? [] : answer.rows,
	};
}

const savedRuns = (): Run[] => (existsSync(runsFile) ? readJson<Run[]>(runsFile) : []);

async function reviewAll(keys: readonly Key[]): Promise<void> {
	const runs = savedRuns();
	const spent = () => sum(runs.map((run) => run.usd));
	// What the next run is expected to cost: the mean so far, and never more than its own cap.
	const mean = () => Math.min(runs.length === 0 ? 1 : spent() / runs.length, RUN_USD);
	for (let n = 1; n <= RUNS; n++) {
		for (const key of keys) {
			if (ONLY.length > 0 && !ONLY.includes(key.id)) continue;
			if (runs.some((run) => run.case === key.id && run.arm === ARM && run.n === n)) continue;
			if (spent() + mean() > MAX_USD) {
				console.log(
					`stopping: $${spent().toFixed(2)} spent, and one more run would pass $${MAX_USD}`,
				);
				return;
			}
			console.log(`case ${key.id}, arm ${ARM}, run ${n} ...`);
			const run = await review(key, ARM, n);
			runs.push(run);
			writeJson(runsFile, runs);
			console.log(
				`  ${run.end}: ${sum(run.rows.map((row) => row.missing.length))} cases named, $${run.usd.toFixed(2)}, ${run.seconds} s, ${run.calls.length} tool calls, ${run.refused.length} refused; $${spent().toFixed(2)} so far`,
			);
		}
	}
}

// ---------------------------------------------------------------- Part B: the marks

type Known = "hit" | "near" | "miss";
type Mark = "real" | "not real" | "cannot tell";
/** A named case in a run: `<case>/<arm>/<run>#<criterion>.<its place in that row>`. */
const refOf = (run: Run, criterion: number, i: number) =>
	`${run.case}/${run.arm}/${run.n}#${criterion}.${i + 1}`;
interface Marks {
	/** Per run (`<case>/<arm>/<run>`): did it name the known case, and which of its named cases are the known one. */
	readonly runs: Readonly<
		Record<string, {readonly known: Known; readonly refs: readonly string[]; readonly why: string}>
	>;
	/** Every other case a run named, one entry per distinct case, with the runs that named it. */
	readonly others: readonly {
		readonly case: string;
		readonly what: string;
		readonly mark: Mark;
		/** For a real case: does the code do the wrong thing with it, as read? */
		readonly bug?: "yes" | "no" | "unsure";
		readonly why: string;
		readonly refs: readonly string[];
	}[];
	/** What the search of each copy found, read by hand. */
	readonly leaks: readonly {
		readonly case: string;
		readonly file: string;
		readonly line: number;
		readonly kind: "leak" | "hint";
		readonly why: string;
	}[];
}

function partB(): Record<string, unknown> | null {
	if (!existsSync(keysFile)) return null;
	const keys = readJson<readonly Key[]>(keysFile);
	console.log(`\n# Part B: ${keys.length} cases`);
	table(
		"B1. The cases and their keys",
		["Case", "Ticket", "Criteria", "Under", "Test files", "Known how", "The missing case"],
		keys.map((key) => [
			key.id,
			`#${key.ticket}`,
			key.criteria.length,
			key.criterion,
			key.tests.length,
			key.from.how,
			cell(key.missing),
		]),
	);
	const runs = savedRuns();
	if (runs.length === 0) return {cases: keys.length};
	const marks = existsSync(marksFile)
		? readJson<Marks>(marksFile)
		: {runs: {}, others: [], leaks: []};
	const leaked = (id: string) =>
		marks.leaks.some((leak) => leak.case === id && leak.kind === "leak");
	const named = (run: Run) =>
		run.rows.flatMap((row) => row.missing.map((_, i) => refOf(run, row.criterion, i)));
	const out: Record<string, unknown> = {cases: keys.length};

	for (const arm of ["code", "tests"] as const) {
		const mine = runs.filter((run) => run.arm === arm);
		if (mine.length === 0) continue;
		const idOf = (run: Run) => `${run.case}/${run.arm}/${run.n}`;
		const knownOf = (run: Run) => marks.runs[idOf(run)]?.known ?? null;
		const otherRefs = (run: Run) => {
			const known = new Set(marks.runs[idOf(run)]?.refs ?? []);
			return named(run).filter((ref) => !known.has(ref));
		};
		const markOf = (ref: string) =>
			marks.others.find((other) => other.refs.includes(ref))?.mark ?? null;
		const unmarked = mine.flatMap((run) => [
			...(knownOf(run) === null ? [idOf(run)] : []),
			...otherRefs(run).filter((ref) => markOf(ref) === null),
		]);
		if (unmarked.length > 0)
			console.log(
				`\nNot marked yet (${unmarked.length}): ${unmarked.slice(0, 40).join(", ")}${unmarked.length > 40 ? " …" : ""}`,
			);

		const count = (some: readonly Run[], known: Known) =>
			some.filter((run) => knownOf(run) === known).length;
		table(
			`B2 (${arm}). Did a run name the known case?`,
			["Case", "Known how", "Leaked", "Run 1", "Run 2", "Run 3", "Hits", "Hits or near"],
			keys.flatMap((key) => {
				const own = mine.filter((run) => run.case === key.id).sort((a, b) => a.n - b.n);
				if (own.length === 0) return [];
				const at = (n: number) => {
					const run = own.find((one) => one.n === n);
					return run === undefined ? "" : run.end === "answer" ? (knownOf(run) ?? "?") : run.end;
				};
				return [
					[
						key.id,
						key.from.how,
						leaked(key.id) ? "yes" : "no",
						at(1),
						at(2),
						at(3),
						`${count(own, "hit")} of ${own.length}`,
						`${count(own, "hit") + count(own, "near")} of ${own.length}`,
					],
				];
			}),
		);
		const clean = mine.filter((run) => !leaked(run.case));
		if (clean.length !== mine.length)
			console.log(`\nOn cases with no leak, hit: ${share(count(clean, "hit"), clean.length)}`);

		const others = (run: Run, mark: Mark) =>
			otherRefs(run).filter((ref) => markOf(ref) === mark).length;
		const bugOf = (ref: string) =>
			marks.others.find((other) => other.refs.includes(ref))?.bug ?? null;

		// The same numbers per group of cases: the cases of the plan, each kind, and all.
		const groups: readonly (readonly [string, readonly Key[]])[] = [
			["the cases of the plan", keys.filter((key) => key.added === undefined)],
			...HOWS.map((how) => [how, keys.filter((key) => key.from.how === how)] as const),
			["every case", keys],
		];
		const groupRows = groups.map(([name, cases]) => {
			const ids = new Set(cases.map((key) => key.id));
			const own = mine.filter((run) => ids.has(run.case));
			const perCase = cases
				.map((key) => own.filter((run) => run.case === key.id))
				.filter((runsOf) => runsOf.length > 0);
			const allHit = perCase.filter((runsOf) => count(runsOf, "hit") === runsOf.length).length;
			const noHit = perCase.filter((runsOf) => count(runsOf, "hit") === 0).length;
			const other = sum(own.map((run) => otherRefs(run).length));
			return {
				name,
				cases: cases.length,
				runs: own.length,
				hit: count(own, "hit"),
				near: count(own, "near"),
				allHit,
				noHit,
				mixed: perCase.length - allHit - noHit,
				other,
				real: sum(own.map((run) => others(run, "real"))),
				notReal: sum(own.map((run) => others(run, "not real"))),
				cannotTell: sum(own.map((run) => others(run, "cannot tell"))),
			};
		});
		table(
			`B2b (${arm}). The same, by how the gap became known`,
			[
				"Cases",
				"How many",
				"Runs",
				"Hit",
				"Hit or near",
				"Hit in every run",
				"In some runs",
				"In no run",
				"Other cases named",
				"real",
				"not real",
				"cannot tell",
			],
			groupRows.map((row) => [
				row.name,
				row.cases,
				row.runs,
				row.runs === 0 ? "" : share(row.hit, row.runs),
				row.runs === 0 ? "" : share(row.hit + row.near, row.runs),
				row.allHit,
				row.mixed,
				row.noHit,
				row.other,
				row.other === 0 ? "" : share(row.real, row.other),
				row.other === 0 ? "" : share(row.notReal, row.other),
				row.other === 0 ? "" : share(row.cannotTell, row.other),
			]),
		);
		table(
			`B3 (${arm}). The other cases each run named, and what it cost`,
			[
				"Run",
				"Named",
				"Known",
				"Other",
				"real",
				"not real",
				"cannot tell",
				"$",
				"Seconds",
				"Tool calls",
				"Refused",
			],
			mine.map((run) => [
				idOf(run),
				named(run).length,
				named(run).length - otherRefs(run).length,
				otherRefs(run).length,
				others(run, "real"),
				others(run, "not real"),
				others(run, "cannot tell"),
				run.usd.toFixed(2),
				run.seconds,
				run.calls.length,
				run.refused.length,
			]),
		);
		const allOther = sum(mine.map((run) => otherRefs(run).length));
		const real = sum(mine.map((run) => others(run, "real")));
		const notReal = sum(mine.map((run) => others(run, "not real")));
		const cannot = sum(mine.map((run) => others(run, "cannot tell")));
		console.log(
			`\nOther cases named: ${allOther} over ${mine.length} runs, ${(allOther / mine.length).toFixed(1)} a run`,
		);
		console.log(`  real: ${share(real, allOther)}`);
		console.log(`  not real: ${share(notReal, allOther)}`);
		console.log(`  cannot tell: ${share(cannot, allOther)}`);
		const realRefs = mine.flatMap((run) => otherRefs(run).filter((ref) => markOf(ref) === "real"));
		const bugs = (bug: "yes" | "no" | "unsure") =>
			realRefs.filter((ref) => bugOf(ref) === bug).length;
		console.log(
			`  of the real ones, does the code do the wrong thing, as read: yes ${bugs("yes")}, unsure ${bugs("unsure")}, no ${bugs("no")}`,
		);
		const distinct = marks.others.filter((other) =>
			other.refs.some((ref) => ref.includes(`/${arm}/`)),
		);
		const distinctOf = (mark: Mark) => distinct.filter((other) => other.mark === mark).length;
		console.log(
			`As distinct cases: ${distinct.length}, real ${distinctOf("real")}, not real ${distinctOf("not real")}, cannot tell ${distinctOf("cannot tell")}`,
		);
		const usd = sum(mine.map((run) => run.usd));
		const seconds = sum(mine.map((run) => run.seconds));
		console.log(
			`Cost: $${usd.toFixed(2)} for ${mine.length} runs, $${(usd / mine.length).toFixed(2)} a run; ${Math.round(seconds / mine.length)} s a run`,
		);
		console.log(`Model: ${[...new Set(mine.map((run) => run.model))].join(", ")}`);
		const extra = (run: Run) => run.tools.filter((tool) => tool === CONNECTOR_TOOL).length;
		const withExtra = mine.filter((run) => extra(run) > 0);
		console.log(
			`Tools in every run's list: ${[...new Set(mine.flatMap((run) => run.tools.filter((tool) => tool !== CONNECTOR_TOOL)))].join(", ")}`,
		);
		console.log(
			`Runs whose list also held connector tools: ${withExtra.length} of ${mine.length}${withExtra.length === 0 ? "" : ` (${withExtra.map((run) => `${idOf(run)}: ${extra(run)}`).join(", ")})`}`,
		);
		console.log(
			`Calls by tool: ${[...new Set(mine.flatMap((run) => run.calls.map((call) => call.tool)))].map((tool) => `${tool} ${sum(mine.map((run) => run.calls.filter((call) => call.tool === tool).length))}`).join(", ")}; refused: ${sum(mine.map((run) => run.refused.length))}`,
		);
		out[arm] = {
			runs: mine.length,
			hit: count(mine, "hit"),
			near: count(mine, "near"),
			miss: count(mine, "miss"),
			other: allOther,
			real,
			notReal,
			cannotTell: cannot,
			bugYes: bugs("yes"),
			bugUnsure: bugs("unsure"),
			bugNo: bugs("no"),
			usd: Number(usd.toFixed(2)),
			seconds,
			runsWithConnectorTools: withExtra.map(idOf),
			groups: groupRows,
		};
	}

	if (process.env.LIST === "1") {
		table(
			"B4. Every other case a run named, and its mark",
			["Case", "What it named", "Mark", "Code wrong?", "Why", "Named in"],
			marks.others.map((other) => [
				other.case,
				cell(other.what),
				other.mark,
				other.bug ?? "",
				cell(other.why),
				other.refs.map((ref) => ref.slice(ref.indexOf("/") + 1)).join(", "),
			]),
		);
	}
	out.spent = Number(sum(runs.map((run) => run.usd)).toFixed(2));
	console.log(`\nSpent on every saved run: $${sum(runs.map((run) => run.usd)).toFixed(2)}`);
	return out;
}

// ---------------------------------------------------------------- the steps

const needClone = () => {
	if (CLONE === "" || !existsSync(CLONE)) {
		console.error("CLONE is not set: point it at a clone that holds every head commit");
		process.exit(1);
	}
};

if (STEP === "lines") {
	const criteria = fetchLines();
	writeJson(criteriaFile, criteria);
	console.log(`${criteria.lines.length} lines on ${criteria.tickets.length} tickets`);
} else if (STEP === "keys") {
	const keys = fetchKeys();
	writeJson(keysFile, keys);
	for (const key of keys)
		console.log(
			`${key.id}: ${key.head.slice(0, 7)}, ${key.criteria.length} criteria, ${key.tests.length} test files`,
		);
} else if (STEP === "leaks") {
	needClone();
	const found = readJson<readonly Key[]>(keysFile).map((key) => {
		const {root, tree} = freshCopy(key.head);
		const hits = searchCopy(tree, key);
		rmSync(root, {recursive: true, force: true});
		console.log(`${key.id}: ${hits.length} lines to read`);
		return {case: key.id, hits};
	});
	writeJson(leaksFile, found);
} else if (STEP === "prompt") {
	for (const key of readJson<readonly Key[]>(keysFile))
		if (ONLY.length === 0 || ONLY.includes(key.id)) console.log(`${promptOf(key, ARM)}\n`);
} else if (STEP === "review") {
	needClone();
	await reviewAll(readJson<readonly Key[]>(keysFile));
} else {
	const a = partA();
	const b = partB();
	if (process.env.SAVE === "1") writeJson(countsFile, {partA: a, partB: b});
}
