// Experiment 92b: does experiment 92's bar for what is worth doing hold on a
// repo it was not drafted from? Sort runs on closed kamp-us/phoenix tickets:
// value-bar closures as the real "no"s, tickets built by a merged pull request
// as the "yes" controls, and a few duplicates (`92b-truth.json`). The bar is
// 92's, unchanged; the brief is 92's with phoenix's repo note.
//
// Run with
//   node experiments/92b-sort-bar-phoenix.ts
//
//   STEP=fetch   every test ticket's first title and body, and the list of
//                earlier issues, through `gh` (read-only). Writes only CACHE
//   STEP=sort    ask Claude through the Agent SDK, no tools. VARIANT=nobar
//                (88's brief), bar (92's drafted bar) or both (drafted bar
//                plus the pipeline's written clauses). MODEL (default
//                sonnet), RUNS (default 2), ONLY=<n,n>, DRY=1 prints the
//                estimate, MAX_USD (default $5)
//   STEP=jev     the same tickets and bar through Jev (needs
//                TYPESAFE_API_KEY). VARIANT=bar or both; RUNS, ONLY, DRY
//   STEP=field   print one field/runs.jsonl row per Claude answer
//   (no STEP)    print the tables
//
// CACHE (default `runs/exp-92b-cache`) holds the ticket text and is never
// committed. `results/92b-sort-bar-phoenix.json` holds each answer, its cost
// and time.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {Schema} from "effect";
import {
	type Answer,
	type Bar,
	barLines,
	FLOOR,
	isRoute,
	JEV_USD_PER_TOKEN,
	type JevPool,
	JevRun,
	jevPairs,
	jevQuestions,
	jevState,
	median,
	type Pool,
	pct,
	readBar,
	scoring,
	showJevAgainstClaude,
	top,
	withClauses,
} from "./lib/sort-bar.ts";
import {
	allIssues,
	Cache,
	type Earlier,
	firstVersion,
	promptOf,
	Run,
	SAID,
	SONNET_IN,
	SONNET_OUT,
	saidOf,
	sortOnce,
	type Ticket,
	Truth,
} from "./lib/sort.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-92b-cache");
const STEP = process.env.STEP ?? "tables";
const REPO = "kamp-us/phoenix";
const RESULTS = join(here, "results", "92b-sort-bar-phoenix.json");
const TICKETS = join(CACHE, "tickets.json");
const RUNS = Number(process.env.RUNS ?? 2);
const only = process.env.ONLY?.split(",").map(Number);

/**
 * How many earlier tickets sort sees. phoenix has over 7,000 issues; listing
 * them all would make each call about 100k tokens. The 200 filed just before
 * the ticket hold every duplicate's original here.
 */
const WINDOW = 200;

/** What phoenix is, in the same shape as demlik's note. */
const PHOENIX_NOTE = [
	"The repo is kamp-us/phoenix, a pnpm monorepo:",
	"- kamp.us: a Turkish-first community site (a link board and a dictionary), one Cloudflare Worker that serves the web app and its backend.",
	"- fabrika: the agent work pipeline, a Claude Code plugin of skills plus fabrika-cli, its command-line tool. Its home is this repo; other repos use it.",
	"- Tuval: a desktop app for running and watching coding agents.",
	"- Smaller packages: a design system, and guards and scripts the CI runs.",
	"Work is done by agents: a builder turns a ticket into a pull request, a reviewer checks it, a shipper merges it. The repo's owners make the calls that need a person.",
].join("\n");

// ---------------------------------------------------------------- the bar

const drafted = readBar(join(here, "92-value-bar.json"));
const written = readBar(join(here, "92-written-bar.json"));
const VARIANTS = ["nobar", "bar", "both"] as const;
type Variant = (typeof VARIANTS)[number];
const variant: Variant = VARIANTS.find((v) => v === process.env.VARIANT) ?? "both";
const barOf = (v: "bar" | "both"): Bar => (v === "bar" ? drafted : withClauses(drafted, written));
/** The bar's examples keep their words but lose their demlik issue numbers. */
const linesOf = (v: Variant) => (v === "nobar" ? [] : barLines(barOf(v), {numbers: false}));

// ---------------------------------------------------------------- the data

const truth = Schema.decodeUnknownSync(Truth)(
	JSON.parse(readFileSync(join(here, "92b-truth.json"), "utf8")),
).tickets;
const PICKED = Object.keys(truth).map(Number);
const {answersOf, right, scores, show, realNo} = scoring(truth);
/** The clause triage named when it closed a real "no". */
const clauseOf = (n: number) =>
	truth[n]?.why.includes("hardening") === true ? "hardening" : "churn";

const PoolS = Schema.Record(Schema.String, Schema.Array(Run));
const JevPoolS = Schema.Record(Schema.String, Schema.Array(JevRun));
const Saved = Schema.Struct({
	model: Schema.String,
	nobar: PoolS,
	bar: PoolS,
	both: PoolS,
	jev: Schema.Struct({model: Schema.String, tokens: Schema.Number, bar: JevPoolS, both: JevPoolS}),
});
type Saved = {
	model: string;
	nobar: Pool;
	bar: Pool;
	both: Pool;
	jev: {model: string; tokens: number; bar: JevPool; both: JevPool};
};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {
			model: "",
			nobar: {},
			bar: {},
			both: {},
			jev: {model: "jev-latest", tokens: 0, bar: {}, both: {}},
		};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);

const loadCache = () => {
	if (!existsSync(TICKETS)) {
		console.error(`no ${TICKETS}: run STEP=fetch first`);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(Cache)(JSON.parse(readFileSync(TICKETS, "utf8")));
};
/** The WINDOW tickets filed just before `t`, newest first, the order `gh` lists them in. */
const earlierOf = (all: readonly Earlier[], t: Ticket) =>
	all
		.filter((e) => e.n < t.n)
		.toSorted((a, b) => b.n - a.n)
		.slice(0, WINDOW);

// ---------------------------------------------------------------- fetch

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const tickets: Ticket[] = [];
	for (const n of PICKED) {
		tickets.push(await firstVersion(n, REPO));
		console.log(`#${n} ${tickets.at(-1)?.source}`);
	}
	const all = await allIssues(REPO, 10_000);
	writeFileSync(TICKETS, JSON.stringify({tickets, all}, null, "\t"));
	console.log(`${tickets.length} tickets, ${all.length} issues listed`);
	process.exit(0);
}

const todoOf = <R>(tickets: readonly Ticket[], pool: Record<string, readonly R[]>) =>
	tickets
		.filter((t) => only === undefined || only.includes(t.n))
		.flatMap((t) => Array.from({length: Math.max(0, RUNS - (pool[t.n]?.length ?? 0))}, () => t));

// ---------------------------------------------------------------- sort

if (STEP === "sort") {
	const cache = loadCache();
	const pool = saved[variant];
	const todo = todoOf(cache.tickets, pool);
	const promptFor = (t: Ticket) =>
		promptOf(t, t.body, earlierOf(cache.all, t), linesOf(variant), PHOENIX_NOTE);
	const chars = todo.reduce((sum, t) => sum + promptFor(t).length, 0);
	const estimate = (chars / 4) * SONNET_IN + todo.length * 300 * SONNET_OUT;
	console.log(
		`${todo.length} calls, ${Math.round(chars / 4)} input tokens, about $${estimate.toFixed(2)} at sonnet's list price, before the cache`,
	);
	if (process.env.PROMPT === "1" && todo[0] !== undefined) console.log(promptFor(todo[0]));
	if (process.env.DRY === "1") process.exit(0);
	const MAX_USD = Number(process.env.MAX_USD ?? 5);
	let spent = 0;
	for (const t of todo) {
		if (spent >= MAX_USD) {
			console.log(`stopped at $${spent.toFixed(2)}`);
			break;
		}
		const r = await sortOnce(t.n, promptFor(t), CACHE, process.env.MODEL);
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

// ---------------------------------------------------------------- Jev

if (STEP === "jev") {
	if (variant === "nobar") throw new Error("Jev is asked with a bar: VARIANT=bar or both");
	const cache = loadCache();
	const b = barOf(variant);
	const jevPool = saved.jev[variant];
	const todo = todoOf(cache.tickets, jevPool);
	const stateOf = (t: Ticket) => jevState(PHOENIX_NOTE, t, earlierOf(cache.all, t), b);
	const sizeOf = (t: Ticket) =>
		(JSON.stringify(stateOf(t)).length + JSON.stringify(jevQuestions).length) / 4;
	const tokens = todo.reduce((n, t) => n + sizeOf(t), 0);
	console.log(
		`Jev: ${todo.length} calls, about ${Math.round(tokens / 1000)}k tokens, about $${(tokens * JEV_USD_PER_TOKEN).toFixed(3)}; largest call ${Math.round(Math.max(0, ...todo.map(sizeOf)) / 1000)}k tokens`,
	);
	if (process.env.DRY === "1" || todo.length === 0) process.exit(0);
	const {askAll, pool} = await import("./lib/jev.ts");
	const share = (raw: Record<string, unknown>, name: string) => {
		const a = raw[name] as {probabilities: Record<string, number>} | undefined;
		if (a === undefined) throw new Error(`Jev did not answer ${name}`);
		return Object.fromEntries(Object.entries(a.probabilities).map(([k, v]) => [k, +v.toFixed(3)]));
	};
	const answers = await pool(todo, 4, async (t) => {
		const started = Date.now();
		const raw = await askAll(jevQuestions, stateOf(t));
		const run: JevRun = {
			dup: share(raw, "dup"),
			worth: share(raw, "worth"),
			next: share(raw, "next"),
			ms: Date.now() - started,
		};
		return {t, run};
	});
	for (const {t, run} of answers) {
		jevPool[t.n] = [...(jevPool[t.n] ?? []), run];
		console.log(`#${t.n} ${JSON.stringify(run)}`);
	}
	saved.jev.tokens = Math.round(saved.jev.tokens + tokens);
	save();
	process.exit(0);
}

// ---------------------------------------------------------------- field rows

const named = {
	nobar: "no bar (88's brief)",
	bar: "the drafted bar",
	both: "the drafted bar and the written clauses",
} as const;

if (STEP === "field") {
	for (const a of answersOf(saved[variant], PICKED)) {
		console.log(
			JSON.stringify({
				date: "2026-10-18",
				lane: `${REPO}#${a.n}`,
				role: "triager",
				model: "sonnet",
				effort: null,
				outcome: a.run.answer === null ? "stopped" : "pass",
				why: `experiment 92b: sort from the first title and body with ${named[variant]}, no tools (run ${a.i + 1} of ${saved[variant][a.n]?.length}); said ${a.said}, really ${truth[a.n]?.next}; posted nothing`,
				tokens: a.run.tokens,
				tools: null,
				minutes: +(a.run.ms / 60000).toFixed(2),
				note: null,
				driver_caused: false,
				costUsd: +a.run.usd.toFixed(4),
				billed: a.run.tokens,
				replay: true,
				name: a.said,
			}),
		);
	}
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- tables

console.log(`model ${saved.model}; ${PICKED.length} tickets, earlier list of ${WINDOW}\n`);
const nos = PICKED.filter(realNo);
const byClause = (c: string) => nos.filter((n) => clauseOf(n) === c);
for (const v of VARIANTS) {
	show(`all ${PICKED.length} tickets, ${named[v]}`, scores(saved[v], PICKED));
	for (const c of ["hardening", "churn"]) {
		const as = answersOf(saved[v], byClause(c));
		console.log(
			`  real "no" closed, ${c} (${byClause(c).length} tickets): ${pct(as.filter((a) => a.said === "no" || a.said === "dup").length, as.length)}`,
		);
	}
}

for (const v of VARIANTS) {
	console.log(`\nconfusion with ${named[v]}, \`next\` across, said down:`);
	console.log(`${"".padEnd(10)}${SAID.map((k) => k.padStart(9)).join("")}`);
	const as = answersOf(saved[v], PICKED);
	for (const said of [...SAID, null]) {
		console.log(
			`${String(said).padEnd(10)}${SAID.map((k) => String(as.filter((a) => a.said === said && truth[a.n]?.next === k).length).padStart(9)).join("")}`,
		);
	}
}

console.log("\nevery ticket (no bar | drafted bar | both; * a miss by `next`):");
const marks = (as: readonly Answer[]) =>
	as.map((a) => `${a.said}${right(a) ? "" : "*"}`).join(" / ");
for (const n of PICKED) {
	const t = truth[n];
	if (t === undefined) continue;
	const reasons = VARIANTS.flatMap((v) =>
		answersOf(saved[v], [n])
			.map((a) => a.run.answer?.sort)
			.flatMap((s) =>
				s?.answer === "no"
					? [`${v}: ${s.reason}${s.duplicateOf ? ` (#${s.duplicateOf})` : ""}`]
					: [],
			),
	);
	console.log(
		`#${n} next=${t.next}${realNo(n) ? ` (${clauseOf(n)})` : ""}: ${VARIANTS.map((v) => marks(answersOf(saved[v], [n]))).join(" | ")}${process.env.REASONS === "1" && reasons.length > 0 ? `\n    ${reasons.join("\n    ")}` : ""}`,
	);
}
if (process.env.WHY === "1") {
	for (const v of VARIANTS) {
		console.log(`\nwhy, on every miss with ${named[v]}:`);
		for (const a of answersOf(saved[v], PICKED).filter((x) => !right(x))) {
			console.log(`#${a.n} run ${a.i + 1} ${a.said}: ${a.run.answer?.sort.why}`);
		}
	}
}

// ---------------------------------------------------------------- Jev against Claude

const jevCalls = [...Object.values(saved.jev.bar), ...Object.values(saved.jev.both)].flat();
const jevUsdACall = (saved.jev.tokens * JEV_USD_PER_TOKEN) / Math.max(1, jevCalls.length);
for (const v of ["bar", "both"] as const) {
	const pairs = jevPairs(saved[v], saved.jev[v], PICKED);
	if (pairs.length === 0) continue;
	showJevAgainstClaude(
		`\nJev (${saved.jev.model}) against Claude, both with ${named[v]}, run by run, ${pairs.length} pairs:`,
		pairs,
		truth,
	);
	// The split 92 could not make: Jev's yes/no beside Claude's, on real "no"s and on real yeses.
	for (const [name, keep] of [
		["real no tickets", (n: number) => realNo(n)],
		["real yes tickets", (n: number) => isRoute(truth[n]?.next ?? "no")],
	] as const) {
		const ps = pairs.filter((p) => keep(p.n) && p.said !== "dup" && p.jev !== "dup");
		const worth = (p: (typeof ps)[number]) => top(p.j.worth)[0];
		const claudeNo = ps.filter((p) => p.said === "no");
		console.log(
			`  on ${name}: yes/no agree ${pct(ps.filter((p) => worth(p) === (p.said === "no" ? "no" : "yes")).length, ps.length)}; Claude said no ${claudeNo.length}, Jev said no on those ${claudeNo.filter((p) => worth(p) === "no").length}; Jev said no ${ps.filter((p) => worth(p) === "no").length} (at ${FLOOR} or above ${ps.filter((p) => worth(p) === "no" && top(p.j.worth)[1] >= FLOOR).length})`,
		);
	}
	const jevRuns = Object.values(saved.jev[v]).flat();
	const claudeRuns = Object.values(saved[v]).flat();
	const claudeUsd = claudeRuns.reduce((s, r) => s + r.usd, 0);
	console.log(
		`  cost: Jev about $${(jevUsdACall * jevRuns.length).toFixed(3)} for ${jevRuns.length} calls, Claude $${claudeUsd.toFixed(2)} for ${claudeRuns.length}`,
	);
	console.log(
		`  time: Jev median ${(median(jevRuns.map((r) => r.ms)) / 1000).toFixed(2)} s a call, Claude median ${(median(claudeRuns.map((r) => r.ms)) / 1000).toFixed(1)} s`,
	);
}
