// Experiment 134: do doc lines that were true at merge stay true? A sample of
// statements merged kamp-us/demlik PRs added to a README, a package doc or a
// doc comment (`134-truth.json`), each read against demlik's main today.
//
// Run with
//   node experiments/134-docs-drift.ts
//
//   STEP=fetch   the merged PR list of kamp-us/demlik through `gh`
//                (read-only). Writes only CACHE
//   STEP=sample  the seeded draw of docs-touching PRs, from CACHE
//   STEP=read    ask Claude (sonnet) through the Agent SDK, no tools: does
//                each statement still hold on main? DEMLIK=<a full clone of
//                kamp-us/demlik>, ONLY=<id,id>, DRY=1 prints the estimate,
//                PROMPT=1 prints the first prompt, MAX_USD (default $5)
//   (no STEP)    print the tables from 134-truth.json and the saved answers
//
// CACHE (default `runs/exp-134-cache`) is never committed.
// `results/134-docs-drift.json` holds each answer, its cost and time.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files,
// `node:child_process` for `gh` and `git` (read-only).
import {execFile} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika/agents/claude";
import {agentEnv} from "@kampus/fabrika/agents/sandbox";
import {Option, Schema} from "effect";
import {shuffled} from "./lib/review-rounds.ts";
import {SONNET_IN, SONNET_OUT} from "./lib/sort.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-134-cache");
const STEP = process.env.STEP ?? "tables";
const REPO = "kamp-us/demlik";
const RESULTS = join(here, "results", "134-docs-drift.json");
const PRS = join(CACHE, "prs.json");
const only = process.env.ONLY?.split(",");
/** Part B reads the closed tickets of both repos. */
const ISSUE_REPOS = ["kamp-us/demlik", "kamp-us/phoenix"] as const;
const issuesFile = (repo: string) => join(CACHE, `issues-${repo.split("/")[1]}.json`);

/** A week before the run, so every sampled doc has had time to drift. */
const CUTOFF = "2026-10-17";
const SEED = 134;
/** How many PRs the draw lists; the hand pick walks them in order. */
const DRAW = 30;

const run = (cmd: string, args: readonly string[], cwd?: string) =>
	new Promise<string>((resolve, reject) =>
		execFile(cmd, args as string[], {cwd, maxBuffer: 64 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null
				? resolve(stdout)
				: reject(new Error(`${cmd} failed: ${stderr.slice(0, 300)}`)),
		),
	);

// ---------------------------------------------------------------- the data

const Verdict = Schema.Literals(["holds", "drifted", "gone", "unsure"]);
type Verdict = typeof Verdict.Type;
const VERDICTS: readonly Verdict[] = ["holds", "drifted", "gone", "unsure"];

/**
 * Why a statement is gone. `moved`: the doc was reorganised and the statement
 * left its page. `kept`: the PR that changed the code edited the statement too.
 * `removed`: the doc or the code was deleted.
 */
const Fate = Schema.Literals(["moved", "kept", "removed"]);

/** One doc statement, as the PR added it, and my own read of it on main. */
const Statement = Schema.Struct({
	id: Schema.String,
	/** The PR that wrote the statement; for a control, the PR that fixed it. */
	pr: Schema.Int,
	/**
	 * `86` for the tickets behind experiment 86's plans, `draw` for the seeded
	 * draw, `control` for a doc known to be wrong, read at the commit just before
	 * its fix, to see that the reader can say `drifted` at all.
	 */
	from: Schema.Literals(["86", "draw", "control"]),
	/** The commit read as "today"; main when left out. Controls only. */
	rev: Schema.optional(Schema.String),
	merged: Schema.String,
	/** The PR's squash commit on main. */
	at: Schema.String,
	/** Where the PR wrote the statement. */
	doc: Schema.String,
	/** Where that file is on main, after any move; null when it is deleted. */
	now: Schema.NullOr(Schema.String),
	/** The statement in the doc's own words, as the PR left it. */
	says: Schema.String,
	/** The code it describes, as paths on main. */
	code: Schema.Array(Schema.String),
	/** Words that find the statement and its code, on main. */
	find: Schema.Array(Schema.String),
	mine: Verdict,
	fate: Schema.optional(Fate),
	why: Schema.String,
});
type Statement = typeof Statement.Type;

/**
 * One closed ticket read in part B. `drift`: the doc was true once and a
 * later change made it false. `born`: the doc was wrong when it was written.
 * `unclear`: a doc-and-code mismatch, but the text does not say which. `not`:
 * the title matched, but the ticket is not "the doc says X, the code does Y".
 */
const Read = Schema.Struct({
	n: Schema.Int,
	kind: Schema.Literals(["drift", "born", "unclear", "not"]),
	/** For a mismatch: closed as done (true) or as not planned (false). */
	fixed: Schema.optional(Schema.Boolean),
});
type Read = typeof Read.Type;
const Search = Schema.Struct({
	repo: Schema.String,
	/** Closed issues on the day of the fetch. */
	closed: Schema.Int,
	/** Of those, the titles that name a doc. */
	hits: Schema.Int,
	read: Schema.Array(Read),
});
const Truth = Schema.Struct({
	note: Schema.String,
	main: Schema.String,
	statements: Schema.Array(Statement),
	tickets: Schema.Array(Search),
});
const truth = Schema.decodeUnknownSync(Truth)(
	JSON.parse(readFileSync(join(here, "134-truth.json"), "utf8")),
);

/** The reader's answer. A verdict always says why. */
const Answer = Schema.Struct({
	verdict: Verdict,
	why: Schema.String,
});
const readAnswer = reader(Answer);

const Run = Schema.Struct({
	answer: Schema.NullOr(Answer),
	error: Schema.NullOr(Schema.String),
	usd: Schema.Number,
	ms: Schema.Number,
	tokens: Schema.Number,
});
type Run = typeof Run.Type;
const Saved = Schema.Struct({
	model: Schema.String,
	runs: Schema.Record(Schema.String, Run),
});
type Saved = {model: string; runs: Record<string, Run>};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {model: "", runs: {}};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);

// ---------------------------------------------------------------- fetch

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const raw = await run("gh", [
		"pr",
		"list",
		"-R",
		REPO,
		"--state",
		"merged",
		"--limit",
		"1000",
		"--json",
		"number,title,mergedAt,files,mergeCommit",
	]);
	writeFileSync(PRS, raw);
	console.log(`${JSON.parse(raw).length} merged PRs`);
	for (const repo of ISSUE_REPOS) {
		const list = await run("gh", [
			"issue",
			"list",
			"-R",
			repo,
			"--state",
			"closed",
			"--limit",
			"10000",
			"--json",
			"number,title,createdAt,closedAt,stateReason",
		]);
		writeFileSync(issuesFile(repo), list);
		console.log(`${repo}: ${JSON.parse(list).length} closed issues`);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- sample

/** A doc that describes code: a README, a SPEC, or a reference, how-to or tutorial page. Not an index. */
const describesCode = (path: string) =>
	path.endsWith(".md") &&
	!path.endsWith("/index.md") &&
	(/(^|\/)(README|SPEC)\.md$/.test(path) || /(^|\/)docs\/(reference|how-to|tutorial)\//.test(path));

const PR = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	mergedAt: Schema.String,
	files: Schema.Array(Schema.Struct({path: Schema.String})),
});

if (STEP === "sample") {
	const prs = Schema.decodeUnknownSync(Schema.Array(PR))(JSON.parse(readFileSync(PRS, "utf8")));
	const from86 = new Set(truth.statements.filter((s) => s.from === "86").map((s) => s.pr));
	const pool = prs
		.filter(
			(p) =>
				p.mergedAt < CUTOFF &&
				!p.title.startsWith("chore(release)") &&
				!from86.has(p.number) &&
				p.files.some((f) => describesCode(f.path)),
		)
		.toSorted((a, b) => a.number - b.number);
	console.log(`${pool.length} docs-touching PRs merged before ${CUTOFF}; the draw, seed ${SEED}:`);
	for (const p of shuffled(pool, SEED).slice(0, DRAW)) {
		const docs = p.files.map((f) => f.path).filter(describesCode);
		console.log(`#${p.number} ${p.mergedAt.slice(0, 10)} ${p.title}\n    ${docs.join(", ")}`);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- part B: the tickets

/** A title that names a doc of any kind. The hand read decides whether it is a mismatch. */
const NAMES_A_DOC =
	/(README|\bdocs?\b|docblock|comment|JSDoc|TSDoc|SPEC|reference|how-to|tutorial|guide|glossary|CLAUDE\.md|changelog|page|prose|pattern doc|\.patterns|ADR)/i;
/** How many titles part B reads in a repo; the rest is the seeded draw's estimate. */
const READ_AT_MOST = 80;

const Issue = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	createdAt: Schema.String,
	closedAt: Schema.String,
});
const issuesOf = (repo: string) =>
	existsSync(issuesFile(repo))
		? Schema.decodeUnknownSync(Schema.Array(Issue))(
				JSON.parse(readFileSync(issuesFile(repo), "utf8")),
			)
		: undefined;
/** The titles part B reads: every hit when there are few, a seeded draw when there are many. */
const toRead = (issues: readonly (typeof Issue.Type)[]) => {
	const hits = issues
		.filter((i) => NAMES_A_DOC.test(i.title))
		.toSorted((a, b) => a.number - b.number);
	return {
		hits,
		read: hits.length <= READ_AT_MOST ? hits : shuffled(hits, SEED).slice(0, READ_AT_MOST),
	};
};

if (STEP === "tickets") {
	for (const repo of ISSUE_REPOS) {
		const issues = issuesOf(repo);
		if (issues === undefined) throw new Error(`no ${issuesFile(repo)}: run STEP=fetch first`);
		const {hits, read} = toRead(issues);
		console.log(
			`\n${repo}: ${issues.length} closed, ${hits.length} name a doc, ${read.length} to read`,
		);
		for (const i of read.toSorted((a, b) => b.number - a.number)) {
			console.log(`#${i.number} ${i.createdAt.slice(0, 10)} ${i.title}`);
		}
	}
	process.exit(0);
}

// ---------------------------------------------------------------- read

const git = (args: readonly string[]) => run("git", args, process.env.DEMLIK);
const showAt = (rev: string, path: string) => git(["show", `${rev}:${path}`]).catch(() => null);

/**
 * The parts of a file around the words, 20 lines each side, merged and capped.
 * With none of the words in the file, its first 40 lines, so the reader sees
 * what the file is now.
 */
function windowsOf(text: string, words: readonly string[], cap = 300): string {
	const lines = text.split("\n");
	const near = new Set<number>();
	lines.forEach((line, i) => {
		if (!words.some((w) => line.includes(w))) return;
		for (let j = Math.max(0, i - 20); j <= Math.min(lines.length - 1, i + 20); j++) near.add(j);
	});
	if (near.size === 0) {
		return `(none of ${words.map((w) => `"${w}"`).join(", ")} appears in this file; its first 40 of ${lines.length} lines)\n${lines.slice(0, 40).join("\n")}`;
	}
	const kept = [...near].toSorted((a, b) => a - b).slice(0, cap);
	const out: string[] = [];
	kept.forEach((i, k) => {
		if (k > 0 && i !== (kept[k - 1] ?? 0) + 1) out.push("…");
		out.push(`${i + 1}: ${lines[i]}`);
	});
	if (near.size > cap) out.push(`… (${near.size - cap} more lines near the words, cut)`);
	return out.join("\n");
}

const numbered = (text: string) =>
	text
		.split("\n")
		.map((line, i) => `${i + 1}: ${line}`)
		.join("\n");

const SYSTEM = [
	"You check one statement from a project's docs against the project as it is today.",
	"A pull request added or changed the statement. Since then the code and the docs may have changed.",
	"Judge only from the text you are shown. Answer with one verdict:",
	"- holds: the doc still makes this statement, in these or close words, and the code shown agrees with it.",
	"- drifted: the doc still makes this statement, but the code shown now does something else, so the statement is false.",
	"- gone: the doc no longer makes this statement (it was removed, moved away or rewritten to say something else), or the code it describes was removed.",
	"- unsure: the text shown is not enough to tell.",
	"Say why in two or three sentences, naming the lines you relied on.",
].join("\n");

/**
 * `WHOLE=1` sends each code file whole instead of the windows around the words,
 * to tell a reader that cannot judge from what it is shown apart from one that
 * judges wrong. Its answers are saved under `<id>+whole`.
 */
const WHOLE = process.env.WHOLE === "1";
const keyOf = (s: Statement) => (WHOLE ? `${s.id}+whole` : s.id);

async function promptOf(s: Statement, main: string): Promise<string> {
	const doc = s.now === null ? null : await showAt(main, s.now);
	const code = await Promise.all(
		s.code.map(async (path) => ({path, text: await showAt(main, path)})),
	);
	return [
		// A control's `pr` is the PR that later fixed it, so the reader is not told its number.
		s.from === "control"
			? `The statement. An earlier pull request of ${REPO} wrote it in \`${s.doc}\`:`
			: `The statement. Pull request #${s.pr} of ${REPO}, merged ${s.merged}, wrote it in \`${s.doc}\`:`,
		"",
		s.says,
		"",
		`The doc today${s.now !== null && s.now !== s.doc ? ` (the file is now at \`${s.now}\`)` : ""}:`,
		doc === null ? "(the file no longer exists)" : windowsOf(doc, s.find),
		"",
		"The code today:",
		...code.flatMap(({path, text}) => [
			`--- ${path}`,
			text === null
				? "(the file no longer exists)"
				: WHOLE
					? numbered(text)
					: windowsOf(text, s.find),
		]),
	].join("\n");
}

async function readOnce(prompt: string, model = "sonnet"): Promise<Run & {model: string}> {
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
			cwd: CACHE,
			env: agentEnv(),
			outputFormat: {type: "json_schema", schema: jsonSchema(Answer)},
		},
	})) {
		if (message.type === "system" && message.subtype === "init") seen = message.model;
		if (message.type === "result") {
			const u = message.usage;
			const answer =
				message.subtype === "success" ? readAnswer(message.structured_output) : Option.none();
			return {
				model: seen,
				answer: Option.getOrNull(answer),
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens:
					u.input_tokens +
					u.output_tokens +
					(u.cache_creation_input_tokens ?? 0) +
					(u.cache_read_input_tokens ?? 0),
			};
		}
	}
	throw new Error("no result");
}

if (STEP === "read") {
	if (process.env.DEMLIK === undefined) throw new Error("DEMLIK=<a full clone of kamp-us/demlik>");
	mkdirSync(CACHE, {recursive: true});
	const todo = truth.statements.filter(
		(s) => (only === undefined || only.includes(s.id)) && saved.runs[keyOf(s)] === undefined,
	);
	const prompts = await Promise.all(todo.map((s) => promptOf(s, s.rev ?? truth.main)));
	const chars = prompts.reduce((sum, p) => sum + p.length + SYSTEM.length, 0);
	const estimate = (chars / 4) * SONNET_IN + todo.length * 300 * SONNET_OUT;
	console.log(
		`${todo.length} calls, about ${Math.round(chars / 4)} input tokens, about $${estimate.toFixed(2)} at sonnet's list price`,
	);
	if (process.env.PROMPT === "1" && prompts[0] !== undefined) console.log(prompts[0]);
	if (process.env.DRY === "1") process.exit(0);
	const MAX_USD = Number(process.env.MAX_USD ?? 5);
	let spent = 0;
	for (const [i, s] of todo.entries()) {
		if (spent >= MAX_USD) {
			console.log(`stopped at $${spent.toFixed(2)}`);
			break;
		}
		const r = await readOnce(prompts[i] ?? "", process.env.MODEL);
		spent += r.usd;
		saved.model = r.model;
		const {model: _, ...kept} = r;
		saved.runs[keyOf(s)] = kept;
		save();
		console.log(
			`${keyOf(s)}: ${r.answer?.verdict ?? r.error} (mine ${s.mine}) $${r.usd.toFixed(3)} ${(r.ms / 1000).toFixed(1)} s`,
		);
	}
	console.log(`spent $${spent.toFixed(2)}`);
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- tables

const count = (xs: readonly Statement[], v: Verdict) => xs.filter((s) => s.mine === v).length;
const days = (from: string, to: string) =>
	Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const CHECKED = "2026-10-23";

const sampled = truth.statements.filter((s) => s.from !== "control");
const controls = truth.statements.filter((s) => s.from === "control");
console.log(`part A: ${sampled.length} statements, read against demlik main ${truth.main}`);
console.log(`\n${"".padEnd(22)}${VERDICTS.map((v) => v.padStart(9)).join("")}`);
for (const [name, xs] of [
	["experiment 86 tickets", sampled.filter((s) => s.from === "86")],
	["seeded draw", sampled.filter((s) => s.from === "draw")],
	["all", sampled],
] as const) {
	console.log(
		`${`${name} (${xs.length})`.padEnd(22)}${VERDICTS.map((v) => String(count(xs, v)).padStart(9)).join("")}`,
	);
}
const gone = sampled.filter((s) => s.mine === "gone");
console.log(
	`\ngone, by fate: ${(["moved", "kept", "removed"] as const).map((f) => `${f} ${gone.filter((s) => s.fate === f).length}`).join(", ")}`,
);
const ages = sampled.map((s) => days(s.merged, CHECKED)).toSorted((a, b) => a - b);
console.log(
	`age at the check: ${ages[0]} to ${ages.at(-1)} days, median ${ages[Math.floor(ages.length / 2)]}`,
);
console.log(
	`controls (known drifts, read just before their fix, not counted above): ${controls.length}, reader said ${controls.map((s) => `${s.id} ${saved.runs[s.id]?.answer?.verdict ?? "-"}`).join(", ")}`,
);

const runs = Object.values(saved.runs);
if (runs.length > 0) {
	console.log(`\nthe reader (${saved.model}), against my read:`);
	const answered = truth.statements.filter((s) => saved.runs[s.id]?.answer);
	console.log(`  (controls included: ${controls.length})`);
	const whole = truth.statements.filter((s) => saved.runs[`${s.id}+whole`]?.answer);
	if (whole.length > 0) {
		console.log(
			`  with each code file whole: ${whole.map((s) => `${s.id} ${saved.runs[`${s.id}+whole`]?.answer?.verdict} (mine ${s.mine})`).join(", ")}`,
		);
	}
	const agree = answered.filter((s) => saved.runs[s.id]?.answer?.verdict === s.mine);
	console.log(`  agrees on ${agree.length} of ${answered.length}`);
	console.log(`${"  mine \\ reader".padEnd(22)}${VERDICTS.map((v) => v.padStart(9)).join("")}`);
	for (const m of VERDICTS) {
		const row = answered.filter((s) => s.mine === m);
		if (row.length === 0) continue;
		console.log(
			`${`  ${m}`.padEnd(22)}${VERDICTS.map((v) => String(row.filter((s) => saved.runs[s.id]?.answer?.verdict === v).length).padStart(9)).join("")}`,
		);
	}
	for (const s of answered.filter((x) => saved.runs[x.id]?.answer?.verdict !== x.mine)) {
		const a = saved.runs[s.id]?.answer;
		console.log(`  ${s.id}: reader ${a?.verdict}, mine ${s.mine}. Reader: ${a?.why}`);
	}
	const usd = runs.reduce((sum, r) => sum + r.usd, 0);
	const ms = runs.map((r) => r.ms).toSorted((a, b) => a - b);
	console.log(
		`  cost $${usd.toFixed(2)} for ${runs.length} calls; median ${(ms[Math.floor(ms.length / 2)] ?? 0) / 1000} s a call`,
	);
}

console.log('\npart B: closed tickets whose point is "a doc says X, the code does Y"');
for (const {repo, closed, hits, read} of truth.tickets) {
	const of = (k: Read["kind"]) => read.filter((r) => r.kind === k).length;
	const yes = read.length - of("not");
	const per100 = (n: number) => ((100 * (n / read.length) * hits) / closed).toFixed(1);
	console.log(
		`${repo}: read ${read.length} of ${hits} titles that name a doc (${closed} closed); ${yes} are a mismatch (drift ${of("drift")}, born wrong ${of("born")}, unclear ${of("unclear")})`,
	);
	console.log(
		`  about ${Math.round((yes / read.length) * hits)} mismatch tickets, ${per100(yes)} per 100 closed; drift alone ${per100(of("drift"))} per 100`,
	);
	const shelved = read.filter((r) => r.kind !== "not" && r.fixed === false).map((r) => `#${r.n}`);
	console.log(`  closed as not planned: ${shelved.length} of ${yes} (${shelved.join(", ")})`);
}
