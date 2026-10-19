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
// time; `88-truth.json` the hand reading of what happened. The answer's shape,
// the fetch and the brief are in `lib/sort.ts`, shared with experiment 92.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {Schema} from "effect";
import {
	allIssues,
	bareBody,
	Cache,
	firstVersion,
	promptOf,
	Run,
	type Run as RunT,
	type Said,
	SONNET_IN,
	SONNET_OUT,
	saidOf,
	sortOnce,
	type Ticket,
	Truth,
} from "./lib/sort.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-88-cache");
const STEP = process.env.STEP ?? "tables";
const REPO = "kamp-us/demlik";
const RESULTS = join(here, "results", "88-sort-routing.json");
const TRUTH = join(here, "88-truth.json");
const TICKETS = join(CACHE, "tickets.json");

// ---------------------------------------------------------------- the data

const truth = Schema.decodeUnknownSync(Truth)(JSON.parse(readFileSync(TRUTH, "utf8"))).tickets;
const PICKED = Object.keys(truth).map(Number);

const Saved = Schema.Struct({
	model: Schema.String,
	runs: Schema.Record(Schema.String, Schema.Array(Run)),
	bare: Schema.optional(Schema.Record(Schema.String, Schema.Array(Run))),
});
type Runs = Record<string, RunT[]>;
type Saved = {model: string; runs: Runs; bare?: Runs};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {model: "", runs: {}};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);

/**
 * `VARIANT=bare`: the follow-up run. It cuts the suggested next step and the
 * filing footer (`bareBody`), to see how much of the route rested on the
 * reporter naming it. Its answers are kept apart, under `bare`.
 */
const VARIANT = process.env.VARIANT === "bare" ? "bare" : "runs";
saved[VARIANT] ??= {};
const pool: Runs = saved[VARIANT];

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

// ---------------------------------------------------------------- sort

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
			VARIANT === "bare" ? bareBody(t.body) : t.body,
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
