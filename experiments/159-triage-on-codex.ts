// Experiment 159: does GPT sol through Codex triage as well as opus did? Experiment 135 is the one
// place with hard evidence that the model matters for triage (the step the code still calls
// `sort`): opus closed 32 of 58 answers on phoenix's missed "no"s, sonnet 6. This runs 135's cases,
// briefs and scoring (`lib/triage-135.ts`, moved out of 135 unchanged) on GPT sol through this
// repo's Codex adapter (`@kampus/fabrika/agents/codex`, experiment 156's `codex exec --json`, with
// experiment 153's containment). Only the model and the harness change.
//
//   group p  kamp-us/phoenix, 92b's "both" brief, one call. 135 sent its one line of system
//            prompt as the SDK's system prompt; Codex has no such field in the adapter, so it
//            leads the prompt here.
//   group d  kamp-us/demlik, today's sort brief and Check, up to two tries, as in 135.
//
// Run with
//   node experiments/159-triage-on-codex.ts
//
//   STEP=sort    CONFIG=sol-medium|sol-high, GROUP=p or d, SET=misses|controls|keep|all (default
//                all), ONLY=<n,n>, RUNS (default 2), CONCURRENCY (default 2), PROMPT=1 prints the
//                first prompt and stops
//   STEP=field   print one field/runs.jsonl row per sort
//   (no STEP)    the tables, beside 135's opus and the saved sonnet. WHY=1 adds each answer's why
//
// It reads 135's ticket cache (`runs/exp-135-cache`; make it with 135's STEP=fetch). Codex runs on
// the laptop's ChatGPT plan: run it with no `OPENAI_API_KEY` or `CODEX_API_KEY` in the
// environment, and the adapter hands none on either way.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files, as 135 does.
import {existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Agent} from "@kampus/fabrika";
import {codexAdapter, psReaper} from "@kampus/fabrika/agents/codex";
import {nextTry} from "@kampus/pipeline/combos";
import {saidOf as dSaidOf, SortReply} from "@kampus/pipeline/stages/sort/answer";
import {type Brief, promptFor, sortProblems} from "@kampus/pipeline/stages/sort/brief";
import {Effect, Exit, Schema, Stream} from "effect";
import {Cache, SortAnswer as PSortAnswer, SYSTEM} from "./lib/sort.ts";
import {median} from "./lib/sort-bar.ts";
import {
	BATCH,
	CONTROLS,
	D_KEEP,
	D_OTHER,
	D_ROUTE,
	type DAnswered,
	DCache,
	dBrief,
	dLast,
	dRight,
	dSaid,
	dWord,
	dWrongNo,
	FOLDS,
	LATER,
	OUTCOME,
	P_CAUGHT,
	P_FALSE_NO,
	P_KEEP,
	P_KIND,
	type PAnswered,
	PICKED,
	pPrompt,
	pRight,
	pSaid,
	pWrongNo,
	REPOS,
	SETS,
	saved92b,
	truth92b,
	truthWord,
} from "./lib/triage-135.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-135-cache");
const STEP = process.env.STEP ?? "tables";
const GROUP = process.env.GROUP === "d" ? "d" : "p";
const RESULTS = join(here, "results", "159-triage-on-codex.json");
const RUNS = Number(process.env.RUNS ?? 2);
const TRIES = 2;
const only = process.env.ONLY?.split(",").map(Number);
const CODEX = process.env.CODEX ?? join(homedir(), ".local", "bin", "codex");

// ---------------------------------------------------------------- the model

/** GPT sol, the model the owner picked for stage agents (docs/direction/a-canvas-per-work.md). */
const MODEL = "gpt-6.1-sol";
const CONFIGS = {
	"sol-medium": {effort: "medium", label: "GPT sol, medium effort"},
	"sol-high": {effort: "high", label: "GPT sol, high effort"},
} as const;
type ConfigId = keyof typeof CONFIGS;
const CONFIG_IDS = Object.keys(CONFIGS) as ConfigId[];

/**
 * Codex is a coding agent with a shell; 135's calls had no tool at all. It works in an empty
 * folder, and the prompt says everything is in it. A tool it runs anyway is counted.
 */
const NO_TOOLS =
	"Everything you need is in this message. Do not run any command or read any file: answer from the text alone.";

// ---------------------------------------------------------------- the calls

const Tokens = Schema.Struct({input: Schema.Number, cached: Schema.Number, output: Schema.Number});
type Tokens = typeof Tokens.Type;
/** One Codex turn: what it said, how long, its tokens and how many tools it ran. */
const Turn = {
	error: Schema.NullOr(Schema.String),
	model: Schema.String,
	effort: Schema.String,
	ms: Schema.Number,
	tokens: Tokens,
	tools: Schema.Number,
	stop: Schema.NullOr(Schema.String),
};
const PRun = Schema.Struct({answer: Schema.NullOr(PSortAnswer), ...Turn});
type PRun = typeof PRun.Type;
const Try = Schema.Struct({
	answer: Schema.NullOr(SortReply),
	problems: Schema.Array(Schema.String),
	...Turn,
});
type Try = typeof Try.Type;
const DRun = Schema.Struct({tries: Schema.Array(Try)});
type DRun = typeof DRun.Type;

const service = Effect.gen(function* () {
	return Agent.makeAgents({
		adapters: {codex: yield* codexAdapter({codex: CODEX})},
		sessions: Agent.memorySessions(),
		reaper: psReaper,
	});
}).pipe(Effect.provide(nodeServices));

/** The text of a failure, with the home folder cut out, so no local path lands in a result. */
const scrub = (text: string) => text.replaceAll(homedir(), "~").slice(0, 400);

let turns = 0;
/** One Codex turn through the adapter: a new session each time, so no turn sees another. */
async function codexTurn<A>(
	prompt: string,
	answer: Schema.Codec<A, unknown>,
	folder: string,
	effort: string,
): Promise<{answer: A | null} & Omit<PRun, "answer">> {
	const agents = await Effect.runPromise(service);
	turns += 1;
	const started = Date.now();
	const exit = await Effect.runPromise(
		Effect.exit(
			Stream.runCollect(
				agents.run({
					provider: "codex",
					session: `exp-159/${process.pid}/${turns}`,
					folder,
					prompt: `${NO_TOOLS}\n\n${prompt}`,
					answer,
					model: MODEL,
					effort,
					limits: {...Agent.NO_LIMITS, seconds: 300},
				}),
			),
		),
	);
	const heard = Exit.isSuccess(exit) ? [...exit.value] : [];
	const end = heard.find((h): h is Agent.Ended<A> => h._tag === "ended") ?? null;
	const tools = new Set(heard.flatMap((h) => (h._tag === "tool" ? [h.id] : []))).size;
	return {
		answer: end?.answer ?? null,
		error: Exit.isFailure(exit)
			? scrub(String(exit.cause))
			: end?.answer === null || end === null
				? `${end?.stop ?? "no end"}: no answer that fits`
				: null,
		model: MODEL,
		effort,
		ms: Date.now() - started,
		tokens: end?.tokens ?? {input: 0, cached: 0, output: 0},
		tools,
		stop: end?.stop ?? null,
	};
}

/** One demlik sort as the machine runs it: a try, the Check, and one more try told the problems. */
async function dSort(brief: Brief, folder: string, effort: string): Promise<DRun> {
	const tries: Try[] = [];
	let note: string | null = null;
	for (let i = 1; i <= TRIES; i++) {
		const got = await codexTurn(promptFor(brief, note), SortReply, folder, effort);
		const problems = got.answer === null ? [] : sortProblems(got.answer, brief);
		tries.push({...got, problems: [...problems]});
		if (got.answer === null) break;
		const next = nextTry(problems, i, TRIES);
		if (next.go !== "again") break;
		note = next.note;
	}
	return {tries};
}

// ---------------------------------------------------------------- results

const PPool = Schema.Record(Schema.String, Schema.Array(PRun));
const DPool = Schema.Record(Schema.String, Schema.Array(DRun));
const Saved = Schema.Struct({
	configs: Schema.Record(Schema.String, Schema.Struct({p: PPool, d: DPool})),
});
type Pools<P = PRun, D = DRun> = {p: Record<string, P[]>; d: Record<string, D[]>};
type Saved = {configs: Record<string, Pools>};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {configs: {}};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);
const poolsOf = (id: ConfigId): Pools => {
	saved.configs[id] ??= {p: {}, d: {}};
	return saved.configs[id];
};

const load = <T>(file: string, schema: Schema.Codec<T, unknown>): T => {
	if (!existsSync(file)) {
		console.error(
			`no ${file}: run STEP=fetch GROUP=${GROUP} node experiments/135-triage-models.ts`,
		);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(file, "utf8")));
};

const dTokens = (r: DRun): Tokens =>
	r.tries.reduce(
		(s, t) => ({
			input: s.input + t.tokens.input,
			cached: s.cached + t.tokens.cached,
			output: s.output + t.tokens.output,
		}),
		{input: 0, cached: 0, output: 0},
	);
const dMs = (r: DRun) => r.tries.reduce((s, t) => s + t.ms, 0);
const dTools = (r: DRun) => r.tries.reduce((s, t) => s + t.tools, 0);

// ---------------------------------------------------------------- sort

if (STEP === "sort") {
	const id = (process.env.CONFIG ?? "") as ConfigId;
	const c = CONFIGS[id];
	if (c === undefined) {
		console.error(`CONFIG is one of ${CONFIG_IDS.join(", ")}`);
		process.exit(1);
	}
	if (process.env.OPENAI_API_KEY !== undefined || process.env.CODEX_API_KEY !== undefined) {
		console.error("an OpenAI key is set: this runs on the ChatGPT plan only; unset it");
		process.exit(1);
	}
	const set = process.env.SET ?? "all";
	const wanted: readonly number[] =
		set === "all"
			? PICKED[GROUP]
			: set === "misses" || set === "controls" || set === "keep"
				? SETS[GROUP][set]
				: [];
	const pools = poolsOf(id);
	const have = (n: number) =>
		GROUP === "p" ? (pools.p[n]?.length ?? 0) : (pools.d[n]?.length ?? 0);
	const p = GROUP === "p" ? load(join(CACHE, "p.json"), Cache) : null;
	const d = GROUP === "d" ? load(join(CACHE, "d.json"), DCache) : null;
	const ticketOf = (n: number) => {
		const t = (p ?? d)?.tickets.find((x) => x.n === n);
		if (t === undefined) throw new Error(`#${n} is not in the cache`);
		return t;
	};
	const pPromptOf = (n: number) =>
		p === null ? "" : `${SYSTEM}\n\n${pPrompt(p.all, ticketOf(n))}`;
	const todo = wanted.filter((n) => (only === undefined || only.includes(n)) && have(n) < RUNS);
	const calls = todo.reduce((s, n) => s + RUNS - have(n), 0);
	console.log(`${id}, group ${GROUP}, set ${set}: ${calls} sorts on ${todo.length} tickets`);
	if (process.env.PROMPT === "1" && todo[0] !== undefined) {
		console.log(
			p !== null ? pPromptOf(todo[0]) : promptFor(dBrief(d as DCache, ticketOf(todo[0])), null),
		);
		process.exit(0);
	}
	const folder = realpathSync(mkdtempSync(join(tmpdir(), "exp-159-")));
	const queue = [...todo];
	const word = (n: number, said: string, ms: number, extra: string) =>
		console.log(`#${n} ${said} (${(ms / 1000).toFixed(1)} s${extra})`);
	const worker = async () => {
		for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
			while (have(n) < RUNS) {
				if (p !== null) {
					const r = await codexTurn(pPromptOf(n), PSortAnswer, folder, c.effort);
					pools.p[n] = [...(pools.p[n] ?? []), r];
					save();
					word(n, pSaid(r) ?? r.error ?? "none", r.ms, `, ${r.tools} tools`);
				} else {
					const r = await dSort(dBrief(d as DCache, ticketOf(n)), folder, c.effort);
					pools.d[n] = [...(pools.d[n] ?? []), r];
					save();
					const last = r.tries.at(-1);
					word(
						n,
						last?.answer === null || last?.answer === undefined
							? (last?.error ?? "none")
							: dWord(last.answer.sort),
						dMs(r),
						`, ${dTools(r)} tools${r.tries.length > 1 ? `, ${r.tries.length} tries` : ""}`,
					);
				}
			}
		}
	};
	await Promise.all(Array.from({length: Number(process.env.CONCURRENCY ?? 2)}, () => worker()));
	process.exit(0);
}

// ---------------------------------------------------------------- field rows

if (STEP === "field") {
	for (const id of CONFIG_IDS) {
		const pools = saved.configs[id];
		if (pools === undefined) continue;
		const c = CONFIGS[id];
		const row = (
			lane: string,
			why: string,
			tokens: Tokens,
			tools: number,
			ms: number,
			ok: boolean,
			name: string | null,
		) =>
			console.log(
				JSON.stringify({
					date: "2026-10-27",
					lane,
					role: "triager",
					model: MODEL,
					effort: c.effort,
					outcome: ok ? "pass" : "stopped",
					why,
					tokens: tokens.input + tokens.output,
					tools,
					minutes: +(ms / 60000).toFixed(2),
					note: "2026-10-27-04",
					driver_caused: false,
					costUsd: null,
					billed: tokens.input + tokens.output,
					replay: true,
					name,
				}),
			);
		for (const [n, runs] of Object.entries(pools.p))
			runs.forEach((r, i) => {
				row(
					`${REPOS.p}#${n}`,
					`experiment 159 group p: 92b's "both" brief through Codex on the ChatGPT plan (run ${i + 1}); said ${pSaid(r)}, really ${truth92b[n]?.next}; posted nothing`,
					r.tokens,
					r.tools,
					r.ms,
					r.answer !== null,
					pSaid(r),
				);
			});
		for (const [n, runs] of Object.entries(pools.d))
			runs.forEach((r, i) => {
				const a = dLast(r);
				row(
					`${REPOS.d}#${n}`,
					`experiment 159 group d: today's sort brief and Check through Codex on the ChatGPT plan (run ${i + 1}, ${r.tries.length} tries); said ${a === null ? "none" : dWord(a)}, really ${truthWord(Number(n))}; posted nothing`,
					dTokens(r),
					dTools(r),
					dMs(r),
					a !== null,
					a === null ? null : OUTCOME[dSaidOf(a)],
				);
			});
	}
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- tables

/** 135's saved answers: its opus, and the sonnet it stood on (92b's and 133's). */
const Saved135 = Schema.Struct({
	configs: Schema.Record(
		Schema.String,
		Schema.Struct({
			p: Schema.Record(
				Schema.String,
				Schema.Array(Schema.Struct({answer: Schema.NullOr(PSortAnswer)})),
			),
			d: Schema.Record(
				Schema.String,
				Schema.Array(
					Schema.Struct({tries: Schema.Array(Schema.Struct({answer: Schema.NullOr(SortReply)}))}),
				),
			),
		}),
	),
});
const saved135 = Schema.decodeUnknownSync(Saved135, {onExcessProperty: "ignore"})(
	JSON.parse(readFileSync(join(here, "results", "135-triage-models.json"), "utf8")),
);
const Saved133 = Schema.Struct({
	a: Schema.Record(
		Schema.String,
		Schema.Array(
			Schema.Struct({tries: Schema.Array(Schema.Struct({answer: Schema.NullOr(SortReply)}))}),
		),
	),
});
const sonnetSaved: Pools<PAnswered, DAnswered> = {
	p: saved92b,
	d: Schema.decodeUnknownSync(Saved133, {onExcessProperty: "ignore"})(
		JSON.parse(readFileSync(join(here, "results", "133-triage-folds-and-needs-info.json"), "utf8")),
	).a,
};

type Column = {id: string; label: string; pools: Pools<PAnswered, DAnswered>};
const columns: Column[] = [
	{id: "sonnet-saved", label: "sonnet, saved (92b, 133)", pools: sonnetSaved},
	...(saved135.configs.opus === undefined
		? []
		: [{id: "opus-135", label: "opus, default effort (135)", pools: saved135.configs.opus}]),
	...CONFIG_IDS.flatMap((id) => {
		const pools = saved.configs[id];
		return pools === undefined ? [] : [{id, label: CONFIGS[id].label, pools}];
	}),
];

const pAnswers = (col: Column, ns: readonly number[]) =>
	ns.flatMap((n) => (col.pools.p[n] ?? []).map((r) => ({n, r})));
const dAnswers = (col: Column, ns: readonly number[]) =>
	ns.flatMap((n) => (col.pools.d[n] ?? []).map((r) => ({n, r})));
const count = <T>(xs: readonly T[], f: (x: T) => boolean) => xs.filter(f).length;
const frac = (a: number, b: number) => (b === 0 ? "-" : `${a}/${b}`);
const pRow = (ns: readonly number[], f: (n: number, r: PAnswered) => boolean) => (col: Column) => {
	const as = pAnswers(col, ns);
	return frac(
		count(as, ({n, r}) => f(n, r)),
		as.length,
	);
};
const dRow = (ns: readonly number[], f: (n: number, r: DAnswered) => boolean) => (col: Column) => {
	const as = dAnswers(col, ns);
	return frac(
		count(as, ({n, r}) => f(n, r)),
		as.length,
	);
};
const P_MISSED = Object.values(P_KIND).flat();

/** 135's rows, the same cases and the same scoring. */
const rows: [string, (col: Column) => string][] = [
	["p: real no closed, all 29 sonnet missed", pRow(P_MISSED, pRight)],
	["p: real no closed, text shows it (18 tickets)", pRow(P_KIND.text, pRight)],
	["p: real no closed, a line the bar does not draw (9)", pRow(P_KIND.line, pRight)],
	["p: real no closed, needs the code (2)", pRow(P_KIND.code, pRight)],
	["p: real no closed, caught by 92b both times (6)", pRow(P_CAUGHT, pRight)],
	["p: wrong no, built tickets 92b closed (5)", pRow(P_FALSE_NO, pWrongNo)],
	["p: wrong no, built tickets kept right (5)", pRow(P_KEEP, pWrongNo)],
	["p: route right, all 10 built tickets", pRow([...P_FALSE_NO, ...P_KEEP], pRight)],
	["d: right fold, batch siblings (9)", dRow(BATCH, dRight)],
	["d: right fold, later reports (4)", dRow(LATER, dRight)],
	["d: false fold, controls (13)", dRow(CONTROLS, (_n, r) => dSaid(r) === "fold")],
	["d: route right, 88's route misses (6)", dRow(D_ROUTE, dRight)],
	["d: right, 88's other misses (5)", dRow(D_OTHER, dRight)],
	["d: route right, kept right (5)", dRow(D_KEEP, dRight)],
	[
		"wrong no on good work, all groups",
		(col) => {
			const ps = pAnswers(col, [...P_FALSE_NO, ...P_KEEP]);
			const ds = dAnswers(col, [...FOLDS, ...CONTROLS, ...D_ROUTE, ...D_KEEP]);
			return frac(
				count(ps, ({n, r}) => pWrongNo(n, r)) + count(ds, ({n, r}) => dWrongNo(n, r)),
				ps.length + ds.length,
			);
		},
	],
	[
		"same answer both runs (tickets)",
		(col) => {
			const pWords = (n: number) => (col.pools.p[n] ?? []).map(pSaid);
			const dWords = (n: number) =>
				(col.pools.d[n] ?? []).map((r) => {
					const a = dLast(r);
					return a === null ? "none" : dWord(a);
				});
			const same = (ws: readonly unknown[]) => ws.length > 1 && ws.every((w) => w === ws[0]);
			const pHad = PICKED.p.filter((n) => pWords(n).length > 1);
			const dHad = PICKED.d.filter((n) => dWords(n).length > 1);
			return frac(
				pHad.filter((n) => same(pWords(n))).length + dHad.filter((n) => same(dWords(n))).length,
				pHad.length + dHad.length,
			);
		},
	],
];

/** Only the runs both columns have, so a sample is read against opus on the same tickets. */
const cut = process.env.SAME === "1";
const ours = CONFIG_IDS.flatMap((id) =>
	saved.configs[id] === undefined ? [] : [saved.configs[id]],
);
const inOurs = (g: "p" | "d", n: string) => ours.some((pools) => (pools[g][n]?.length ?? 0) > 0);
const shown: Column[] = cut
	? columns.map((col) => ({
			...col,
			pools: {
				p: Object.fromEntries(Object.entries(col.pools.p).filter(([n]) => inOurs("p", n))),
				d: Object.fromEntries(Object.entries(col.pools.d).filter(([n]) => inOurs("d", n))),
			},
		}))
	: columns;

for (const id of CONFIG_IDS) {
	const pools = saved.configs[id];
	if (pools === undefined) continue;
	const ps = PICKED.p.flatMap((n) => pools.p[n] ?? []);
	const ds = PICKED.d.flatMap((n) => pools.d[n] ?? []);
	const ms = [...ps.map((r) => r.ms), ...ds.map(dMs)];
	const tokens = [...ps.map((r) => r.tokens), ...ds.map(dTokens)];
	const turnsOf = [...ps.map((r) => r.ms), ...ds.flatMap((r) => r.tries.map((t) => t.ms))];
	const toolsUsed = ps.filter((r) => r.tools > 0).length + ds.filter((r) => dTools(r) > 0).length;
	const noAnswer =
		ps.filter((r) => r.answer === null).length + ds.filter((r) => dLast(r) === null).length;
	console.log(
		`${CONFIGS[id].label} [${MODEL}]: ${ms.length} sorts, ${turnsOf.length} turns; median ${(median(turnsOf) / 1000).toFixed(1)} s a turn, ${(median(ms) / 1000).toFixed(1)} s a sort, slowest turn ${(Math.max(...turnsOf) / 1000).toFixed(1)} s; median ${median(tokens.map((t) => t.input))} input (${median(tokens.map((t) => t.cached))} cached) and ${median(tokens.map((t) => t.output))} output tokens a sort, ${tokens.reduce((s, t) => s + t.input + t.output, 0)} in all; ${ds.filter((r) => r.tries.length > 1).length} second tries, ${toolsUsed} sorts ran a tool, ${noAnswer} with no answer`,
	);
}
console.log(cut ? "\n(only tickets GPT sol ran)\n" : "");
const width = Math.max(...rows.map(([name]) => name.length));
console.log(`${"".padEnd(width)}  ${shown.map((c) => c.id.padStart(13)).join("")}`);
for (const [name, f] of rows)
	console.log(`${name.padEnd(width)}  ${shown.map((c) => f(c).padStart(13)).join("")}`);

if (process.env.EACH !== "0") {
	console.log(
		"\nevery ticket GPT sol ran (* not right; for real yeses in group p, a no or duplicate):",
	);
	for (const n of PICKED.p) {
		if (!inOurs("p", String(n))) continue;
		const cells = shown.map(
			(col) =>
				`${col.id}: ${(col.pools.p[n] ?? []).map((r) => `${pSaid(r) ?? "none"}${pRight(n, r) ? "" : "*"}`).join(",") || "-"}`,
		);
		console.log(`p #${n} really ${truth92b[n]?.next}: ${cells.join("  ")}`);
		if (process.env.WHY === "1")
			for (const col of shown.slice(1))
				for (const r of col.pools.p[n] ?? [])
					console.log(
						`    ${col.id}: ${r.answer?.sort.answer === "no" ? `${r.answer.sort.reason}. ` : ""}${r.answer?.sort.why}`,
					);
	}
	for (const n of PICKED.d) {
		if (!inOurs("d", String(n))) continue;
		const cells = shown.map(
			(col) =>
				`${col.id}: ${
					(col.pools.d[n] ?? [])
						.map((r) => {
							const a = dLast(r);
							return `${a === null ? "none" : dWord(a)}${dRight(n, r) ? "" : "*"}`;
						})
						.join(",") || "-"
				}`,
		);
		console.log(`d #${n} really ${truthWord(n)}: ${cells.join("  ")}`);
		if (process.env.WHY === "1")
			for (const col of shown.slice(1))
				for (const r of col.pools.d[n] ?? []) console.log(`    ${col.id}: ${dLast(r)?.why}`);
	}
}
