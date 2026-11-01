// Experiment 92: can sort say "no" once it is given the repo's bar for what is
// worth doing, without closing good tickets? And does Jev give the same
// answers for far less?
//
// Experiment 88 sorted 40 closed kamp-us/demlik tickets from their first title
// and body. Sort said no once in 160 answers and never on the three tickets
// triage closed as not worth doing. Here the same brief carries one more part:
// a drafted bar (`92-value-bar.json`), written from demlik's record without
// looking at any test ticket. The 40 tickets come back with 88's answer key,
// corrections included, plus the other closed-not-worth-it tickets demlik has
// (`92-truth.json`).
//
// Run with
//   node experiments/92-sort-bar.ts
//
//   STEP=fetch   every test ticket's first title and body, and the list of
//                earlier issues, through `gh` (read-only). Writes only CACHE
//   STEP=sort    ask Claude through the Agent SDK, no tools, with the bar.
//                VARIANT=nobar sorts with 88's brief, for the tickets 88 did
//                not sort. MODEL (default sonnet), RUNS (default 2),
//                ONLY=<n,n>, DRY=1 prints the estimate, MAX_USD (default $5)
//   STEP=jev     the same tickets and bar through Jev, as three questions in
//                one call (needs TYPESAFE_API_KEY). RUNS, ONLY, DRY as above
//   STEP=field   print one field/runs.jsonl row per Claude answer with the bar
//   (no STEP)    print the tables
//
// CACHE (default `runs/exp-92-cache`) holds the ticket text and is never
// committed. `results/92-sort-bar.json` holds each answer, its cost and time.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {Schema} from "effect";
import {
	type Answer,
	type Bar,
	barLines,
	JEV_USD_PER_TOKEN,
	type JevPool,
	JevRun,
	jevPairs,
	jevQuestions,
	jevState,
	median,
	type Pool,
	readBar,
	scoring,
	showJevAgainstClaude,
	withClauses,
} from "./lib/sort-bar.ts";
import {
	allIssues,
	Cache,
	firstVersion,
	promptOf,
	REPO_NOTE,
	Run,
	SAID,
	SONNET_IN,
	SONNET_OUT,
	saidOf,
	sortOnce,
	type Ticket,
	Truth,
	type TruthEntry,
} from "./lib/sort.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-92-cache");
const STEP = process.env.STEP ?? "tables";
const REPO = "kamp-us/demlik";
const RESULTS = join(here, "results", "92-sort-bar.json");
const RESULTS_88 = join(here, "results", "88-sort-routing.json");
const TICKETS = join(CACHE, "tickets.json");
const RUNS = Number(process.env.RUNS ?? 2);
const only = process.env.ONLY?.split(",").map(Number);

// ---------------------------------------------------------------- the bar

const barFile = (file: string): Bar => readBar(join(here, file));
const drafted = barFile("92-value-bar.json");
const written = barFile("92-written-bar.json");

/**
 * The briefs compared. `bar`: the drafted bar alone. `both`: the drafted bar
 * plus the clauses the pipeline already has in writing. `nobar`: 88's brief,
 * for the tickets 88 did not sort.
 */
const VARIANTS = ["bar", "both", "nobar"] as const;
type Variant = (typeof VARIANTS)[number];
const variant: Variant = VARIANTS.find((v) => v === process.env.VARIANT) ?? "bar";
const barOf = (v: "bar" | "both"): Bar => (v === "bar" ? drafted : withClauses(drafted, written));

// ---------------------------------------------------------------- the data

const truthOf = (file: string) =>
	Schema.decodeUnknownSync(Truth)(JSON.parse(readFileSync(join(here, file), "utf8"))).tickets;
const truth88 = truthOf("88-truth.json");
const truthAdded = truthOf("92-truth.json");
const truth: Record<string, TruthEntry> = {...truth88, ...truthAdded};
const PICKED = Object.keys(truth).map(Number);
const {answersOf, right, scores, show} = scoring(truth);

const PoolS = Schema.Record(Schema.String, Schema.Array(Run));
const JevPoolS = Schema.Record(Schema.String, Schema.Array(JevRun));
const Saved = Schema.Struct({
	model: Schema.String,
	bar: PoolS,
	both: PoolS,
	nobar: PoolS,
	jev: Schema.Struct({
		model: Schema.String,
		tokens: Schema.Number,
		bar: JevPoolS,
		both: JevPoolS,
	}),
});
type Saved = {
	model: string;
	bar: Pool;
	both: Pool;
	nobar: Pool;
	jev: {model: string; tokens: number; bar: JevPool; both: JevPool};
};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {
			model: "",
			bar: {},
			both: {},
			nobar: {},
			jev: {model: "jev-latest", tokens: 0, bar: {}, both: {}},
		};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);

/** Experiment 88's answers with no bar, on its 40 tickets, from the full first body. */
const pool88: Pool = (JSON.parse(readFileSync(RESULTS_88, "utf8")) as {runs: Pool}).runs;

const loadCache = () => {
	if (!existsSync(TICKETS)) {
		console.error(`no ${TICKETS}: run STEP=fetch first`);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(Cache)(JSON.parse(readFileSync(TICKETS, "utf8")));
};
const earlierOf = (all: typeof Cache.Type.all, t: Ticket) => all.filter((e) => e.n < t.n);

// ---------------------------------------------------------------- fetch

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const tickets: Ticket[] = [];
	for (const n of PICKED) {
		tickets.push(await firstVersion(n));
		console.log(`#${n} ${tickets.at(-1)?.source}`);
	}
	const all = await allIssues(REPO);
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
	const tickets =
		variant === "nobar" ? cache.tickets.filter((t) => pool88[t.n] === undefined) : cache.tickets;
	const todo = todoOf(tickets, pool);
	const promptFor = (t: Ticket) =>
		promptOf(
			t,
			t.body,
			earlierOf(cache.all, t),
			variant === "nobar" ? [] : barLines(barOf(variant)),
		);
	const chars = todo.reduce((sum, t) => sum + promptFor(t).length, 0);
	const estimate = (chars / 4) * SONNET_IN + todo.length * 300 * SONNET_OUT;
	console.log(
		`${todo.length} calls, ${Math.round(chars / 4)} input tokens, about $${estimate.toFixed(2)} at sonnet's list price`,
	);
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
	const stateOf = (t: Ticket) => jevState(REPO_NOTE, t, earlierOf(cache.all, t), b);
	const sizeOf = (t: Ticket) =>
		(JSON.stringify(stateOf(t)).length + JSON.stringify(jevQuestions).length) / 4;
	const tokens = todo.reduce((n, t) => n + sizeOf(t), 0);
	console.log(
		`Jev: ${todo.length} calls, about ${Math.round(tokens / 1000)}k tokens, about $${((tokens * 0.042) / 1e6).toFixed(3)} at $0.042 a million; largest call ${Math.round(Math.max(0, ...todo.map(sizeOf)) / 1000)}k tokens`,
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

// ---------------------------------------------------------------- tables

const old = Object.keys(truth88).map(Number);
const added = Object.keys(truthAdded).map(Number);

if (STEP === "field") {
	const cache = loadCache();
	const filed = new Map(cache.tickets.map((t) => [t.n, t]));
	const brief = {
		bar: "with the drafted value bar",
		both: "with the drafted value bar and the pipeline's written clauses",
		nobar: "with experiment 88's brief",
	}[variant];
	for (const a of answersOf(saved[variant], PICKED)) {
		if (filed.get(a.n) === undefined) continue;
		const want = truth[a.n]?.next;
		console.log(
			JSON.stringify({
				date: "2026-10-18",
				lane: `${REPO}#${a.n}`,
				role: "triager",
				model: "sonnet",
				effort: null,
				outcome: a.run.answer === null ? "stopped" : "pass",
				why: `experiment 92: sort from the first title and body ${brief}, no tools (run ${a.i + 1} of ${saved[variant][a.n]?.length}); said ${a.said}, really ${want}; posted nothing`,
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

console.log(
	`model ${saved.model}; drafted bar: ${drafted.no.length} no rules, ${drafted.stillYes.length} still-yes; written clauses: ${written.no.length} no, ${written.stillYes.length} still-yes\n`,
);
const named = {bar: "the drafted bar", both: "the drafted bar and the written clauses"};
show("88's 40 tickets, no bar (experiment 88's main run)", scores(pool88, old));
for (const v of ["bar", "both"] as const)
	show(`88's 40 tickets, ${named[v]}`, scores(saved[v], old));
show(`the ${added.length} added tickets, no bar`, scores(saved.nobar, added));
for (const v of ["bar", "both"] as const)
	show(`the ${added.length} added tickets, ${named[v]}`, scores(saved[v], added));
for (const v of ["bar", "both"] as const)
	show(`all ${PICKED.length} tickets, ${named[v]}`, scores(saved[v], PICKED));

for (const v of ["bar", "both"] as const) {
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
	const before = answersOf(pool88[n] === undefined ? saved.nobar : pool88, [n]);
	const reasons = (["bar", "both"] as const).flatMap((v) =>
		answersOf(saved[v], [n])
			.map((a) => a.run.answer?.sort)
			.flatMap((s) =>
				s?.answer === "no"
					? [`${v}: ${s.reason}${s.duplicateOf ? ` (#${s.duplicateOf})` : ""}`]
					: [],
			),
	);
	console.log(
		`#${n} next=${t.next}: ${marks(before)} | ${marks(answersOf(saved.bar, [n]))} | ${marks(answersOf(saved.both, [n]))}${reasons.length > 0 ? `\n    ${reasons.join("\n    ")}` : ""}`,
	);
}
if (process.env.WHY === "1") {
	for (const v of ["bar", "both"] as const) {
		console.log(`\nwhy, on every miss with ${named[v]}:`);
		for (const a of answersOf(saved[v], PICKED).filter((x) => !right(x))) {
			console.log(`#${a.n} run ${a.i + 1} ${a.said}: ${a.run.answer?.sort.why}`);
		}
	}
}

// ---------------------------------------------------------------- Jev against Claude

const jevCalls = [...Object.values(saved.jev.bar), ...Object.values(saved.jev.both)].flat();
/** Jev's dollars a call, from the tokens sent over every call made. */
const jevUsdACall = (saved.jev.tokens * JEV_USD_PER_TOKEN) / Math.max(1, jevCalls.length);

for (const v of ["bar", "both"] as const) {
	const pairs = jevPairs(saved[v], saved.jev[v], PICKED);
	if (pairs.length === 0) continue;
	showJevAgainstClaude(
		`\nJev (${saved.jev.model}) against Claude, both with ${named[v]}, run by run, ${pairs.length} pairs:`,
		pairs,
		truth,
	);
	const jevRuns = Object.values(saved.jev[v]).flat();
	const claudeRuns = Object.values(saved[v]).flat();
	const claudeUsd = claudeRuns.reduce((s, r) => s + r.usd, 0);
	console.log(
		`  cost: Jev about $${(jevUsdACall * jevRuns.length).toFixed(3)} for ${jevRuns.length} calls ($${jevUsdACall.toFixed(5)} a call), Claude $${claudeUsd.toFixed(2)} for ${claudeRuns.length} ($${(claudeUsd / claudeRuns.length).toFixed(4)} a call)`,
	);
	console.log(
		`  time: Jev median ${(median(jevRuns.map((r) => r.ms)) / 1000).toFixed(2)} s a call, Claude median ${(median(claudeRuns.map((r) => r.ms)) / 1000).toFixed(1)} s`,
	);
}
