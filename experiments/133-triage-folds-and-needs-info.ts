// Experiment 133: two answers triage (the code still calls it sort) was never measured on.
//
//   part A  fold. A yes that is part of an open plan (`partOf` in
//           packages/pipeline/src/stages/sort/answer.ts). 13 demlik tickets triage folded into a
//           ticket that was open when they were filed, and 13 controls that got a plan of their
//           own while a related ticket was open (`133-truth.json`, `fold` and `control`).
//   part B  "ask the filer for more". Triage has no such answer. Closed kamp-us/phoenix tickets
//           that once had `status:needs-info`, replayed to see what triage says without one
//           (`133-truth.json`, `needsInfo`).
//
// The sorter is today's: the brief and Check in packages/pipeline/src/stages/sort/brief.ts, the
// answer in answer.ts, the Agent SDK options in sorter.ts, and up to two tries, the second told
// what the Check found (as the sort machine runs it). The model is sonnet at the SDK's default
// effort, as experiment 92b ran it. Each ticket is read as it was filed (its first revision, as
// in 88), and so is the world around it: the other tickets with their state at that moment, and
// on demlik the tickets open at that moment as the open plans, each summed up by its own first
// revision.
//
// Run with
//   node experiments/133-triage-folds-and-needs-info.ts
//
//   STEP=fetch   the tickets, their first revisions and the issue lists, through `gh`
//                (read-only). PART=a or b for one part only. Writes only CACHE
//   STEP=sort    PART=a or b. RUNS (default 2), ONLY=<n,n>, DRY=1 prints the estimate,
//                PROMPT=1 prints the first prompt, MAX_USD (default 5)
//   STEP=field   print one field/runs.jsonl row per answer
//   (no STEP)    print the tables. WHY=1 adds the sorter's why on every answer
//
// CACHE (default `runs/exp-133-cache`) holds ticket text and is never committed.
// `results/133-triage-folds-and-needs-info.json` holds each answer, its cost and time.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files, `node:child_process`
// for `gh`, as the other replay scripts do.
import {execFile} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika/agents/claude";
import {nextTry} from "@kampus/pipeline/combos";
import {type Said, SortReply, saidOf} from "@kampus/pipeline/stages/sort/answer";
import {type Brief, promptFor, sortProblems} from "@kampus/pipeline/stages/sort/brief";
import type {OpenPlan} from "@kampus/pipeline/stages/sort/services";
import {sorterOptions} from "@kampus/pipeline/stages/sort/sorter";
import {Option, Schema} from "effect";
import {median, pct} from "./lib/sort-bar.ts";
import {firstVersion, REPO_NOTE, SONNET_IN, SONNET_OUT, Ticket} from "./lib/sort.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-133-cache");
const STEP = process.env.STEP ?? "tables";
const PART = process.env.PART === "b" ? "b" : "a";
const RESULTS = join(here, "results", "133-triage-folds-and-needs-info.json");
const RUNS = Number(process.env.RUNS ?? 2);
const TRIES = 2;
const only = process.env.ONLY?.split(",").map(Number);

const REPOS = {a: "kamp-us/demlik", b: "kamp-us/phoenix"} as const;
/** phoenix has over 7,000 issues: as in 92b, sort sees the 200 filed just before the ticket. */
const WINDOW = {a: Number.POSITIVE_INFINITY, b: 200} as const;
/** A plan's summary: its first revision's opening, at most this many characters. */
const SUMMARY = 300;

/** What phoenix is, as experiment 92b put it. */
const PHOENIX_NOTE = [
	"The repo is kamp-us/phoenix, a pnpm monorepo:",
	"- kamp.us: a Turkish-first community site (a link board and a dictionary), one Cloudflare Worker that serves the web app and its backend.",
	"- fabrika: the agent work pipeline, a Claude Code plugin of skills plus fabrika-cli, its command-line tool. Its home is this repo; other repos use it.",
	"- Tuval: a desktop app for running and watching coding agents.",
	"- Smaller packages: a design system, and guards and scripts the CI runs.",
	"Work is done by agents: a builder turns a ticket into a pull request, a reviewer checks it, a shipper merges it. The repo's owners make the calls that need a person.",
].join("\n");
const NOTES = {a: REPO_NOTE, b: PHOENIX_NOTE} as const;

// ---------------------------------------------------------------- the truth

const Fold = Schema.Struct({into: Schema.Array(Schema.Int), why: Schema.String});
const Control = Schema.Struct({near: Schema.Array(Schema.Int), why: Schema.String});
/**
 * Who held what triage waited on: the filer, the code (a scout's read), an owner's ruling on a real
 * question, or an owner's permission only, where triage already knew its answer.
 */
const WHO = ["filer", "code", "owner_ruling", "owner_permission"] as const;
const NeedsInfo = Schema.Struct({
	/** How it ended: built by a merged PR, closed for no answer, closed as not worth doing or as a duplicate. */
	end: Schema.Literals(["built", "no_answer", "no", "duplicate"]),
	/** What the label asked for, in a few words. */
	asked: Schema.String,
	/** Did someone answer the ask, and did the answer change what happened. */
	answered: Schema.Boolean,
	changed: Schema.Boolean,
	who: Schema.Literals(WHO),
	why: Schema.String,
});
const TruthFile = Schema.Struct({
	note: Schema.String,
	fold: Schema.Record(Schema.String, Fold),
	control: Schema.Record(Schema.String, Control),
	needsInfoNote: Schema.optional(Schema.String),
	needsInfo: Schema.optional(Schema.Record(Schema.String, NeedsInfo)),
});
const truth = Schema.decodeUnknownSync(TruthFile)(
	JSON.parse(readFileSync(join(here, "133-truth.json"), "utf8")),
);
const FOLDS = Object.keys(truth.fold).map(Number);
const CONTROLS = Object.keys(truth.control).map(Number);
const NEEDS = Object.keys(truth.needsInfo ?? {}).map(Number);
const PICKED = {a: [...FOLDS, ...CONTROLS], b: NEEDS} as const;

// ---------------------------------------------------------------- the cache

const Listed = Schema.Struct({
	n: Schema.Int,
	title: Schema.String,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
});
type Listed = typeof Listed.Type;
const PartCache = Schema.Struct({
	tickets: Schema.Array(Ticket),
	/** The first revision of every ticket that was open when a picked ticket was filed (part A). */
	plans: Schema.Array(Ticket),
	all: Schema.Array(Listed),
});
type PartCache = typeof PartCache.Type;
const cacheFile = (part: "a" | "b") => join(CACHE, `${part}.json`);

const gh = (args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile("gh", args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 300)}`)),
		),
	);

/** Every issue of the repo with when it opened and closed. Titles are as they stand today. */
async function listAll(repo: string): Promise<Listed[]> {
	const raw = JSON.parse(
		await gh([
			"issue",
			"list",
			"-R",
			repo,
			"--state",
			"all",
			"--limit",
			"20000",
			"--json",
			"number,title,createdAt,closedAt",
		]),
	) as {number: number; title: string; createdAt: string; closedAt: string | null}[];
	return raw.map((i) => ({
		n: i.number,
		title: i.title,
		createdAt: i.createdAt,
		closedAt: i.closedAt === "" || i.closedAt?.startsWith("0001") ? null : i.closedAt,
	}));
}

/** Open at `t`: filed before it and not yet closed. */
const openAt = (i: Listed, t: string) => i.createdAt < t && (i.closedAt === null || i.closedAt > t);

// ---------------------------------------------------------------- the brief

/** A first revision's opening, without headings or markup runs, for a plan's summary. Pure. */
const summaryOf = (t: Ticket) => {
	const text = t.body
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^#+ .*$/gm, "")
		.replace(/\s+/g, " ")
		.trim();
	return `${t.title}. ${text.length > SUMMARY ? `${text.slice(0, SUMMARY)}…` : text}`;
};

/** What the sorter is handed for one ticket, as the world stood when it was filed. Pure. */
function briefOf(part: "a" | "b", cache: PartCache, t: Ticket): Brief {
	const at = t.createdAt;
	const before = cache.all
		.filter((i) => i.n !== t.n && i.createdAt < at)
		.toSorted((x, y) => y.createdAt.localeCompare(x.createdAt))
		.slice(0, WINDOW[part]);
	const firsts = new Map(cache.plans.map((p) => [p.n, p]));
	const plans: OpenPlan[] =
		part === "b"
			? []
			: before
					.filter((i) => openAt(i, at))
					.flatMap((i) => {
						const p = firsts.get(i.n);
						return p === undefined
							? []
							: [{number: i.n, tickets: [i.n], summary: summaryOf(p), approved: false}];
					});
	return {
		ticket: {
			url: `https://github.com/${REPOS[part]}/issues/${t.n}`,
			number: t.n,
			state: "open",
			title: t.title,
			body: t.body,
		},
		context: {
			earlier: before.map((i) => ({
				number: i.n,
				title: i.title,
				state: openAt(i, at) ? ("open" as const) : ("closed" as const),
				reason: null,
			})),
			plans,
		},
		note: NOTES[part],
	};
}

// ---------------------------------------------------------------- one sort

const Try = Schema.Struct({
	answer: Schema.NullOr(SortReply),
	problems: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
	usd: Schema.Number,
	ms: Schema.Number,
	tokens: Schema.Number,
});
type Try = typeof Try.Type;
/** One sort: every try, the last one the answer. */
const Run = Schema.Struct({tries: Schema.Array(Try)});
type Run = typeof Run.Type;
const readReply = reader(SortReply);

/** One call through the Agent SDK with the pipeline sorter's own options, and no effort set. */
async function callOnce(prompt: string, cwd: string): Promise<Omit<Try, "problems">> {
	const started = Date.now();
	const {effort: _, ...options} = sorterOptions(
		{model: "sonnet", effort: "high", budget: 0.5, note: ""},
		cwd,
	);
	for await (const message of query({
		prompt,
		options: {...options, outputFormat: {type: "json_schema", schema: jsonSchema(SortReply)}},
	})) {
		if (message.type === "result") {
			const u = message.usage;
			const tokens =
				u.input_tokens +
				u.output_tokens +
				(u.cache_creation_input_tokens ?? 0) +
				(u.cache_read_input_tokens ?? 0);
			const answer =
				message.subtype === "success" ? readReply(message.structured_output) : Option.none();
			return {
				answer: Option.getOrNull(answer),
				error: Option.isSome(answer) ? null : `${message.subtype}: no answer that fits`,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens,
			};
		}
	}
	throw new Error("no result");
}

/** One sort as the machine runs it: a try, the Check, and one more try told the problems. */
async function sortOnce(brief: Brief, cwd: string): Promise<Run> {
	const tries: Try[] = [];
	let note: string | null = null;
	for (let i = 1; i <= TRIES; i++) {
		const got = await callOnce(promptFor(brief, note), cwd);
		const problems = got.answer === null ? [] : sortProblems(got.answer, brief);
		tries.push({...got, problems: [...problems]});
		if (got.answer === null) break;
		const next = nextTry(problems, i, TRIES);
		if (next.go !== "again") break;
		note = next.note;
	}
	return {tries};
}

const lastOf = (r: Run) => r.tries.at(-1);
const usdOf = (r: Run) => r.tries.reduce((s, t) => s + t.usd, 0);
const saidOfRun = (r: Run): Said | null => {
	const a = lastOf(r)?.answer;
	return a === null || a === undefined ? null : saidOf(a.sort);
};
const partOfRun = (r: Run): number | null => {
	const a = lastOf(r)?.answer?.sort;
	return a?.answer === "yes" && a.next === "plan" ? a.partOf : null;
};
const passed = (r: Run) => {
	const last = lastOf(r);
	return last !== undefined && last.answer !== null && last.problems.length === 0;
};

// ---------------------------------------------------------------- results

const Pool = Schema.Record(Schema.String, Schema.Array(Run));
type Pool = Record<string, Run[]>;
const Saved = Schema.Struct({model: Schema.String, a: Pool, b: Pool});
type Saved = {model: string; a: Pool; b: Pool};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {model: "sonnet", a: {}, b: {}};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);

const loadCache = (part: "a" | "b"): PartCache => {
	if (!existsSync(cacheFile(part))) {
		console.error(`no ${cacheFile(part)}: run STEP=fetch first`);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(PartCache)(JSON.parse(readFileSync(cacheFile(part), "utf8")));
};

// ---------------------------------------------------------------- fetch

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const parts = process.env.PART === undefined ? (["a", "b"] as const) : ([PART] as const);
	for (const part of parts) {
		if (PICKED[part].length === 0) continue;
		const repo = REPOS[part];
		const all = await listAll(repo);
		const tickets: Ticket[] = [];
		for (const n of PICKED[part]) tickets.push(await firstVersion(n, repo));
		const open =
			part === "b"
				? []
				: [
						...new Set(
							tickets.flatMap((t) =>
								all.filter((i) => i.n !== t.n && openAt(i, t.createdAt)).map((i) => i.n),
							),
						),
					];
		const plans: Ticket[] = [];
		for (const n of open) plans.push(await firstVersion(n, repo));
		writeFileSync(cacheFile(part), JSON.stringify({tickets, plans, all}, null, "\t"));
		console.log(
			`${repo}: ${tickets.length} tickets, ${plans.length} open plans, ${all.length} issues`,
		);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- sort

if (STEP === "sort") {
	const cache = loadCache(PART);
	const pool = saved[PART];
	const todo = cache.tickets
		.filter((t) => only === undefined || only.includes(t.n))
		.flatMap((t) => Array.from({length: Math.max(0, RUNS - (pool[t.n]?.length ?? 0))}, () => t));
	const chars = todo.reduce((s, t) => s + promptFor(briefOf(PART, cache, t), null).length, 0);
	const estimate = (chars / 4) * SONNET_IN + todo.length * 400 * SONNET_OUT;
	console.log(
		`${todo.length} calls, ${Math.round(chars / 4)} input tokens, about $${estimate.toFixed(2)} at sonnet's list price, before the cache and before second tries`,
	);
	if (process.env.PROMPT === "1" && todo[0] !== undefined)
		console.log(promptFor(briefOf(PART, cache, todo[0]), null));
	if (process.env.DRY === "1") process.exit(0);
	const MAX_USD = Number(process.env.MAX_USD ?? 5);
	const cwd = mkdtempSync(join(tmpdir(), "exp-133-"));
	let spent = 0;
	for (const t of todo) {
		if (spent >= MAX_USD) {
			console.log(`stopped at $${spent.toFixed(2)}`);
			break;
		}
		const r = await sortOnce(briefOf(PART, cache, t), cwd);
		spent += usdOf(r);
		pool[t.n] = [...(pool[t.n] ?? []), r];
		save();
		const a = lastOf(r)?.answer?.sort;
		const extra =
			a === undefined
				? (lastOf(r)?.error ?? "")
				: a.answer === "no"
					? `: ${a.rule}`
					: a.answer === "duplicate"
						? ` of #${a.of}`
						: a.answer === "yes" && a.next === "plan" && a.partOf !== null
							? ` into #${a.partOf}`
							: "";
		console.log(
			`#${t.n} ${saidOfRun(r) ?? "none"}${extra} (${r.tries.length} tr${r.tries.length === 1 ? "y" : "ies"}${passed(r) ? "" : ", Check not passed"}, $${usdOf(r).toFixed(3)}, ${(r.tries.reduce((s, x) => s + x.ms, 0) / 1000).toFixed(1)} s)`,
		);
	}
	console.log(`spent $${spent.toFixed(2)}`);
	process.exit(0);
}

// ---------------------------------------------------------------- field rows

const runsOf = (part: "a" | "b", ns: readonly number[]) =>
	ns.flatMap((n) => (saved[part][n] ?? []).map((run, i) => ({n, i, run})));

const truthWord = (part: "a" | "b", n: number) =>
	part === "b"
		? `needs-info, ended ${truth.needsInfo?.[n]?.end}`
		: truth.fold[n] !== undefined
			? `fold into #${truth.fold[n]?.into.join(" or #")}`
			: "a plan of its own";

/** An answer by its outcome's name, as the sort stage prints it. */
const OUTCOME: Record<Said, string> = {
	duplicate: "done:closed:duplicate",
	no: "done:closed:no",
	plan: "send:plan:yes",
	fold: "send:plan:fold",
	research: "send:research:yes",
	ruling: "ask:owner:ruling",
};

if (STEP === "field") {
	for (const part of ["a", "b"] as const) {
		for (const {n, i, run} of runsOf(part, PICKED[part])) {
			const tokens = run.tries.reduce((s, t) => s + t.tokens, 0);
			const said = saidOfRun(run);
			console.log(
				JSON.stringify({
					date: "2026-10-24",
					lane: `${REPOS[part]}#${n}`,
					role: "triager",
					model: "sonnet",
					effort: null,
					outcome: said === null ? "stopped" : "pass",
					why: `experiment 133 part ${part}: today's sort brief and Check on the first title and body, no tools (run ${i + 1}, ${run.tries.length} tries); said ${said}${partOfRun(run) === null ? "" : ` into #${partOfRun(run)}`}, really ${truthWord(part, n)}; posted nothing`,
					tokens,
					tools: null,
					minutes: +(run.tries.reduce((s, t) => s + t.ms, 0) / 60000).toFixed(2),
					note: part === "a" ? "2026-10-24-01" : "2026-10-24-02",
					driver_caused: false,
					costUsd: +usdOf(run).toFixed(4),
					billed: tokens,
					replay: true,
					name: said === null ? null : OUTCOME[said],
				}),
			);
		}
	}
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- tables

const word = (run: Run) => {
	const a = lastOf(run)?.answer?.sort;
	if (a === undefined) return "none";
	if (a.answer === "duplicate") return `duplicate #${a.of}`;
	if (a.answer === "no") return `no:${a.rule}`;
	if (a.next === "plan") return a.partOf === null ? "plan" : `fold #${a.partOf}`;
	return a.next;
};
const all = [...Object.values(saved.a), ...Object.values(saved.b)].flat();
const allUsd = all.reduce((s, r) => s + usdOf(r), 0);
console.log(
	`model ${saved.model}; ${all.length} sorts, ${all.reduce((s, r) => s + r.tries.length, 0)} calls, $${allUsd.toFixed(2)}; median ${(median(all.map((r) => r.tries.reduce((s, t) => s + t.ms, 0))) / 1000).toFixed(1)} s a sort; Check passed ${pct(all.filter(passed).length, all.length)}\n`,
);

// Part A
const foldRuns = runsOf("a", FOLDS);
const controlRuns = runsOf("a", CONTROLS);
const rightTarget = foldRuns.filter(
	({n, run}) => saidOfRun(run) === "fold" && truth.fold[n]?.into.includes(partOfRun(run) ?? -1),
);
const wrongTarget = foldRuns.filter(
	({n, run}) => saidOfRun(run) === "fold" && !truth.fold[n]?.into.includes(partOfRun(run) ?? -1),
);
const falseFolds = controlRuns.filter(({run}) => saidOfRun(run) === "fold");
const said = (rs: readonly {run: Run}[]) => {
	const counts = new Map<string, number>();
	for (const {run} of rs) {
		const w = word(run).replace(/ #\d+$/, "");
		counts.set(w, (counts.get(w) ?? 0) + 1);
	}
	return [...counts].map(([w, c]) => `${w} ${c}`).join(", ");
};
console.log(`part A: ${FOLDS.length} folds, ${CONTROLS.length} controls, kamp-us/demlik`);
console.log(`  folds caught with the right target: ${pct(rightTarget.length, foldRuns.length)}`);
console.log(`  folded into the wrong ticket: ${wrongTarget.length}`);
const dupRight = foldRuns.filter(({n, run}) => {
	const a = lastOf(run)?.answer?.sort;
	return a?.answer === "duplicate" && truth.fold[n]?.into.includes(a.of) === true;
});
console.log(`  called a duplicate of the right ticket instead: ${dupRight.length}`);
console.log(`  what it said on folds: ${said(foldRuns)}`);
console.log(`  false folds on controls: ${pct(falseFolds.length, controlRuns.length)}`);
console.log(`  what it said on controls: ${said(controlRuns)}`);
const sameBoth = (part: "a" | "b", ns: readonly number[]) =>
	ns.filter((n) => {
		const ws = (saved[part][n] ?? []).map(word);
		return ws.length > 1 && ws.every((w) => w === ws[0]);
	}).length;
console.log(`  same answer every run: ${sameBoth("a", PICKED.a)} of ${PICKED.a.length} tickets`);
const cache = existsSync(cacheFile("a")) ? loadCache("a") : null;
if (cache !== null) {
	const sizes = FOLDS.flatMap((n) => {
		const t = cache.tickets.find((x) => x.n === n);
		return t === undefined ? [] : [briefOf("a", cache, t).context.plans.length];
	});
	console.log(
		`  open plans listed on a fold ticket: ${Math.min(...sizes)} to ${Math.max(...sizes)}, median ${median(sizes)}`,
	);
}
console.log("\nevery part A ticket (* a miss):");
for (const n of PICKED.a) {
	const f = truth.fold[n];
	const ws = (saved.a[n] ?? []).map((run) => {
		const ok =
			f === undefined
				? saidOfRun(run) !== "fold"
				: saidOfRun(run) === "fold" && f.into.includes(partOfRun(run) ?? -1);
		return `${word(run)}${ok ? "" : "*"}`;
	});
	console.log(`#${n} ${truthWord("a", n)}: ${ws.join(" / ")}`);
	if (process.env.WHY === "1")
		for (const run of saved.a[n] ?? []) console.log(`    ${lastOf(run)?.answer?.sort.why}`);
}

// Part B
if (NEEDS.length > 0) {
	const ni = truth.needsInfo ?? {};
	const bRuns = runsOf("b", NEEDS);
	console.log(`\npart B: ${NEEDS.length} closed needs-info tickets, kamp-us/phoenix`);
	console.log(`  what it said: ${said(bRuns)}`);
	console.log(`  same answer every run: ${sameBoth("b", NEEDS)} of ${NEEDS.length} tickets`);
	for (const who of WHO)
		console.log(
			`  a missing fact, ${who}: ${NEEDS.filter((n) => ni[n]?.who === who).length} tickets (changed the outcome: ${NEEDS.filter((n) => ni[n]?.who === who && ni[n]?.changed).length})`,
		);
	console.log("\nevery part B ticket:");
	for (const n of NEEDS) {
		const t = ni[n];
		console.log(
			`#${n} ended ${t?.end}, who ${t?.who}${t?.changed ? ", the answer changed it" : ""}: ${(saved.b[n] ?? []).map(word).join(" / ")}`,
		);
		if (process.env.WHY === "1")
			for (const run of saved.b[n] ?? []) console.log(`    ${lastOf(run)?.answer?.sort.why}`);
	}
}
