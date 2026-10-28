// Triage on GPT sol through this repo's Codex adapter, shared by experiment 159 (135's briefs as they
// are) and 161 (the same briefs with a line added). Moved out of `159-triage-on-codex.ts`; that
// script's tables print the same after the move.
//
//   the calls    one Codex turn through the adapter, and a demlik sort with its Check and retry
//   the results  one file of runs per experiment, by config and group
//   the sorts    a pool of workers over the tickets still short of their runs
//   the tables   135's rows, beside 135's opus and the saved sonnet
//
// Node at the edge, said out loud: `node:fs` for the cache and result files and to remove the
// Codex homes and the empty folder each run made, as 135 does for its files.
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Agent} from "@kampus/fabrika";
import {codexHomeOf} from "@kampus/fabrika/agents/acp";
import {codexAdapter, psReaper} from "@kampus/fabrika/agents/codex";
import {nextTry} from "@kampus/pipeline/combos";
import {saidOf as dSaidOf, SortReply} from "@kampus/pipeline/stages/sort/answer";
import {type Brief, promptFor, sortProblems} from "@kampus/pipeline/stages/sort/brief";
import {Effect, Exit, Schema, Stream} from "effect";
import {Cache, type Earlier, SortAnswer as PSortAnswer, type Ticket} from "./sort.ts";
import {median} from "./sort-bar.ts";
import {
	BATCH,
	CONTROLS,
	D_KEEP,
	D_OTHER,
	D_ROUTE,
	type DAnswered,
	DCache,
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
	pRight,
	pSaid,
	pWrongNo,
	REPOS,
	saved92b,
	truth92b,
	truthWord,
} from "./triage-135.ts";

const here = join(import.meta.dirname, "..");
export const CODEX = process.env.CODEX ?? join(homedir(), ".local", "bin", "codex");
/** GPT sol, the model the owner picked for stage agents (docs/direction/a-canvas-per-work.md). */
export const MODEL = "gpt-6.1-sol";
const TRIES = 2;

/**
 * Codex is a coding agent with a shell; 135's calls had no tool at all. It works in an empty
 * folder, and the prompt says everything is in it. A tool it runs anyway is counted.
 */
const NO_TOOLS =
	"Everything you need is in this message. Do not run any command or read any file: answer from the text alone.";

// ---------------------------------------------------------------- the calls

const Tokens = Schema.Struct({input: Schema.Number, cached: Schema.Number, output: Schema.Number});
export type Tokens = typeof Tokens.Type;
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
export type PRun = typeof PRun.Type;
const Try = Schema.Struct({
	answer: Schema.NullOr(SortReply),
	problems: Schema.Array(Schema.String),
	...Turn,
});
type Try = typeof Try.Type;
const DRun = Schema.Struct({tries: Schema.Array(Try)});
export type DRun = typeof DRun.Type;

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
/**
 * One Codex turn through the adapter: a new session each time, so no turn sees another. The
 * session's Codex home is removed after the turn; the login it links to is not touched.
 */
async function codexTurn<A>(
	prompt: string,
	answer: Schema.Codec<A, unknown>,
	at: Where,
): Promise<{answer: A | null} & Omit<PRun, "answer">> {
	const agents = await Effect.runPromise(service);
	turns += 1;
	const session = `${at.name}/${process.pid}/${turns}`;
	const started = Date.now();
	const exit = await Effect.runPromise(
		Effect.exit(
			Stream.runCollect(
				agents.run({
					provider: "codex",
					session,
					folder: at.folder,
					prompt: `${NO_TOOLS}\n\n${prompt}`,
					answer,
					model: MODEL,
					effort: at.effort,
					limits: {...Agent.NO_LIMITS, seconds: 300},
				}),
			),
		),
	);
	rmSync(codexHomeOf(`session:${session}`), {recursive: true, force: true});
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
		effort: at.effort,
		ms: Date.now() - started,
		tokens: end?.tokens ?? {input: 0, cached: 0, output: 0},
		tools,
		stop: end?.stop ?? null,
	};
}

/** Where a turn runs: the experiment's name for its sessions, the empty folder, the effort. */
interface Where {
	readonly name: string;
	readonly folder: string;
	readonly effort: string;
}

/**
 * One demlik sort as the machine runs it: a try, the Check, and one more try told the problems.
 * `edit` changes the prompt the brief gives, the same way on every try (experiment 161 adds a line).
 */
async function dSort(brief: Brief, at: Where, edit: (prompt: string) => string): Promise<DRun> {
	const tries: Try[] = [];
	let note: string | null = null;
	for (let i = 1; i <= TRIES; i++) {
		const got = await codexTurn(edit(promptFor(brief, note)), SortReply, at);
		const problems = got.answer === null ? [] : sortProblems(got.answer, brief);
		tries.push({...got, problems: [...problems]});
		if (got.answer === null) break;
		const next = nextTry(problems, i, TRIES);
		if (next.go !== "again") break;
		note = next.note;
	}
	return {tries};
}

export const dTokens = (r: DRun): Tokens =>
	r.tries.reduce(
		(s, t) => ({
			input: s.input + t.tokens.input,
			cached: s.cached + t.tokens.cached,
			output: s.output + t.tokens.output,
		}),
		{input: 0, cached: 0, output: 0},
	);
export const dMs = (r: DRun) => r.tries.reduce((s, t) => s + t.ms, 0);
const dTools = (r: DRun) => r.tries.reduce((s, t) => s + t.tools, 0);

// ---------------------------------------------------------------- results

const PPool = Schema.Record(Schema.String, Schema.Array(PRun));
const DPool = Schema.Record(Schema.String, Schema.Array(DRun));
const Saved = Schema.Struct({
	configs: Schema.Record(Schema.String, Schema.Struct({p: PPool, d: DPool})),
});
export type Pools<P = PRun, D = DRun> = {p: Record<string, P[]>; d: Record<string, D[]>};
type SavedRuns = {configs: Record<string, Pools>};

/** An experiment's results file: every config's runs, read once, written after each sort. */
export function resultsAt(file: string) {
	const saved: SavedRuns = existsSync(file)
		? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(file, "utf8"))) as SavedRuns)
		: {configs: {}};
	return {
		saved,
		save: () => writeFileSync(file, `${JSON.stringify(saved, null, "\t")}\n`),
		poolsOf: (id: string): Pools => {
			saved.configs[id] ??= {p: {}, d: {}};
			return saved.configs[id];
		},
	};
}

const load = <T>(file: string, schema: Schema.Codec<T, unknown>, group: "p" | "d"): T => {
	if (!existsSync(file)) {
		console.error(
			`no ${file}: run STEP=fetch GROUP=${group} node experiments/135-triage-models.ts`,
		);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(file, "utf8")));
};

// ---------------------------------------------------------------- the sorts

/** What one sort step runs: which tickets, how, and where the answers go. */
export interface SortStep {
	readonly name: string;
	readonly group: "p" | "d";
	readonly cache: string;
	readonly wanted: readonly number[];
	readonly only: readonly number[] | undefined;
	readonly runs: number;
	readonly concurrency: number;
	readonly effort: string;
	readonly label: string;
	readonly pools: Pools;
	readonly save: () => void;
	/** The whole phoenix prompt for one ticket, from 135's cache. */
	readonly pPromptOf: (all: readonly Earlier[], t: Ticket) => string;
	/** The demlik brief for one ticket, and what changes in its prompt. */
	readonly dBriefOf: (cache: DCache, t: Ticket) => Brief;
	readonly dEdit: (prompt: string) => string;
	readonly printPrompt: boolean;
}

/** Sort every wanted ticket up to its runs, a few at a time, saving after each answer. */
export async function sortStep(s: SortStep): Promise<void> {
	if (process.env.OPENAI_API_KEY !== undefined || process.env.CODEX_API_KEY !== undefined) {
		console.error("an OpenAI key is set: this runs on the ChatGPT plan only; unset it");
		process.exit(1);
	}
	const have = (n: number) =>
		s.group === "p" ? (s.pools.p[n]?.length ?? 0) : (s.pools.d[n]?.length ?? 0);
	const p = s.group === "p" ? load(join(s.cache, "p.json"), Cache, "p") : null;
	const d = s.group === "d" ? load(join(s.cache, "d.json"), DCache, "d") : null;
	const ticketOf = (n: number) => {
		const t = (p ?? d)?.tickets.find((x) => x.n === n);
		if (t === undefined) throw new Error(`#${n} is not in the cache`);
		return t;
	};
	const pPromptOf = (n: number) => (p === null ? "" : s.pPromptOf(p.all, ticketOf(n)));
	const todo = s.wanted.filter(
		(n) => (s.only === undefined || s.only.includes(n)) && have(n) < s.runs,
	);
	const calls = todo.reduce((sum, n) => sum + s.runs - have(n), 0);
	console.log(`${s.label}, group ${s.group}: ${calls} sorts on ${todo.length} tickets`);
	if (s.printPrompt && todo[0] !== undefined) {
		console.log(
			p !== null
				? pPromptOf(todo[0])
				: s.dEdit(promptFor(s.dBriefOf(d as DCache, ticketOf(todo[0])), null)),
		);
		process.exit(0);
	}
	const folder = realpathSync(mkdtempSync(join(tmpdir(), `${s.name}-`)));
	const at: Where = {name: s.name, folder, effort: s.effort};
	const queue = [...todo];
	const word = (n: number, said: string, ms: number, extra: string) =>
		console.log(`#${n} ${said} (${(ms / 1000).toFixed(1)} s${extra})`);
	const worker = async () => {
		for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
			while (have(n) < s.runs) {
				if (p !== null) {
					const r = await codexTurn(pPromptOf(n), PSortAnswer, at);
					s.pools.p[n] = [...(s.pools.p[n] ?? []), r];
					s.save();
					word(n, pSaid(r) ?? r.error ?? "none", r.ms, `, ${r.tools} tools`);
				} else {
					const r = await dSort(s.dBriefOf(d as DCache, ticketOf(n)), at, s.dEdit);
					s.pools.d[n] = [...(s.pools.d[n] ?? []), r];
					s.save();
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
	await Promise.all(Array.from({length: s.concurrency}, () => worker()));
	rmSync(folder, {recursive: true, force: true});
}

// ---------------------------------------------------------------- field rows

/** One field/runs.jsonl row per sort of one config. */
export function fieldRows(f: {
	readonly pools: Pools;
	readonly effort: string;
	readonly date: string;
	readonly note: string;
	/** What ran, for each group's `why`: "experiment 159 group p: 92b's \"both\" brief". */
	readonly what: {readonly p: string; readonly d: string};
}): void {
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
				date: f.date,
				lane,
				role: "triager",
				model: MODEL,
				effort: f.effort,
				outcome: ok ? "pass" : "stopped",
				why,
				tokens: tokens.input + tokens.output,
				tools,
				minutes: +(ms / 60000).toFixed(2),
				note: f.note,
				driver_caused: false,
				costUsd: null,
				billed: tokens.input + tokens.output,
				replay: true,
				name,
			}),
		);
	for (const [n, runs] of Object.entries(f.pools.p))
		runs.forEach((r, i) => {
			row(
				`${REPOS.p}#${n}`,
				`${f.what.p} through Codex on the ChatGPT plan (run ${i + 1}); said ${pSaid(r)}, really ${truth92b[n]?.next}; posted nothing`,
				r.tokens,
				r.tools,
				r.ms,
				r.answer !== null,
				pSaid(r),
			);
		});
	for (const [n, runs] of Object.entries(f.pools.d))
		runs.forEach((r, i) => {
			const a = dLast(r);
			row(
				`${REPOS.d}#${n}`,
				`${f.what.d} through Codex on the ChatGPT plan (run ${i + 1}, ${r.tries.length} tries); said ${a === null ? "none" : dWord(a)}, really ${truthWord(Number(n))}; posted nothing`,
				dTokens(r),
				dTools(r),
				dMs(r),
				a !== null,
				a === null ? null : OUTCOME[dSaidOf(a)],
			);
		});
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
const Saved133 = Schema.Struct({
	a: Schema.Record(
		Schema.String,
		Schema.Array(
			Schema.Struct({tries: Schema.Array(Schema.Struct({answer: Schema.NullOr(SortReply)}))}),
		),
	),
});

export type Column = {id: string; label: string; pools: Pools<PAnswered, DAnswered>};
/** The saved columns every table starts with: sonnet (92b, 133), and 135's opus. */
export function savedColumns(): Column[] {
	const saved135 = Schema.decodeUnknownSync(Saved135, {onExcessProperty: "ignore"})(
		JSON.parse(readFileSync(join(here, "results", "135-triage-models.json"), "utf8")),
	);
	const sonnet: Pools<PAnswered, DAnswered> = {
		p: saved92b,
		d: Schema.decodeUnknownSync(Saved133, {onExcessProperty: "ignore"})(
			JSON.parse(
				readFileSync(join(here, "results", "133-triage-folds-and-needs-info.json"), "utf8"),
			),
		).a,
	};
	return [
		{id: "sonnet-saved", label: "sonnet, saved (92b, 133)", pools: sonnet},
		...(saved135.configs.opus === undefined
			? []
			: [{id: "opus-135", label: "opus, default effort (135)", pools: saved135.configs.opus}]),
	];
}

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
export const P_MISSED = Object.values(P_KIND).flat();

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

/** The time and token line of one config's sorts. */
export function printTurns(label: string, pools: Pools): void {
	const ps = PICKED.p.flatMap((n) => pools.p[n] ?? []);
	const ds = PICKED.d.flatMap((n) => pools.d[n] ?? []);
	const ms = [...ps.map((r) => r.ms), ...ds.map(dMs)];
	const tokens = [...ps.map((r) => r.tokens), ...ds.map(dTokens)];
	const turnsOf = [...ps.map((r) => r.ms), ...ds.flatMap((r) => r.tries.map((t) => t.ms))];
	const toolsUsed = ps.filter((r) => r.tools > 0).length + ds.filter((r) => dTools(r) > 0).length;
	const noAnswer =
		ps.filter((r) => r.answer === null).length + ds.filter((r) => dLast(r) === null).length;
	console.log(
		`${label} [${MODEL}]: ${ms.length} sorts, ${turnsOf.length} turns; median ${(median(turnsOf) / 1000).toFixed(1)} s a turn, ${(median(ms) / 1000).toFixed(1)} s a sort, slowest turn ${(Math.max(...turnsOf) / 1000).toFixed(1)} s; median ${median(tokens.map((t) => t.input))} input (${median(tokens.map((t) => t.cached))} cached) and ${median(tokens.map((t) => t.output))} output tokens a sort, ${tokens.reduce((s, t) => s + t.input + t.output, 0)} in all; ${ds.filter((r) => r.tries.length > 1).length} second tries, ${toolsUsed} sorts ran a tool, ${noAnswer} with no answer`,
	);
}

/**
 * The rows across the columns, then every ticket the new columns ran. With `cut`, each column keeps
 * only the tickets the new columns ran, so a partial run is read against the others on the same
 * tickets. `why` adds each answer's why, for every column but the first.
 */
export function printTables(t: {
	readonly columns: readonly Column[];
	readonly ours: readonly Pools[];
	readonly cut: boolean;
	readonly each: boolean;
	readonly why: boolean;
	readonly cutNote: string;
	readonly eachNote: string;
}): void {
	const inOurs = (g: "p" | "d", n: string) =>
		t.ours.some((pools) => (pools[g][n]?.length ?? 0) > 0);
	const shown: readonly Column[] = t.cut
		? t.columns.map((col) => ({
				...col,
				pools: {
					p: Object.fromEntries(Object.entries(col.pools.p).filter(([n]) => inOurs("p", n))),
					d: Object.fromEntries(Object.entries(col.pools.d).filter(([n]) => inOurs("d", n))),
				},
			}))
		: t.columns;
	console.log(t.cut ? `\n${t.cutNote}\n` : "");
	const width = Math.max(...rows.map(([name]) => name.length));
	console.log(`${"".padEnd(width)}  ${shown.map((c) => c.id.padStart(13)).join("")}`);
	for (const [name, f] of rows)
		console.log(`${name.padEnd(width)}  ${shown.map((c) => f(c).padStart(13)).join("")}`);
	if (!t.each) return;
	console.log(`\n${t.eachNote}`);
	for (const n of PICKED.p) {
		if (!inOurs("p", String(n))) continue;
		const cells = shown.map(
			(col) =>
				`${col.id}: ${(col.pools.p[n] ?? []).map((r) => `${pSaid(r) ?? "none"}${pRight(n, r) ? "" : "*"}`).join(",") || "-"}`,
		);
		console.log(`p #${n} really ${truth92b[n]?.next}: ${cells.join("  ")}`);
		if (t.why)
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
		if (t.why)
			for (const col of shown.slice(1))
				for (const r of col.pools.d[n] ?? []) console.log(`    ${col.id}: ${dLast(r)?.why}`);
	}
}
