// Experiment 135: are triage's weak scores the model's? Triage (the step the code still calls
// `sort`) was only ever scored on sonnet at its default effort (88, 92, 92b, 133). This runs the same
// briefs on the cases sonnet got wrong, plus a few it got right, with haiku at low effort (what the
// built machine runs, experiment 111), sonnet at its default effort (the baseline, run again), and
// opus at its default effort; opus at high effort on the misses if the money allows. Only the model
// and the effort change.
//
//   group p  kamp-us/phoenix, experiment 92b's tickets and its "both" brief (`lib/sort.ts` and
//            `lib/sort-bar.ts`: the drafted bar plus the pipeline's three written clauses). Today's
//            bar (packages/pipeline/src/stages/sort/bar.ts) has no "hardening" or "churn" rule, so on
//            today's brief these tickets are not a "no" at all; 92b's brief is the one under which
//            sort missed them. One call, as in 92b.
//   group d  kamp-us/demlik, today's brief and Check (packages/pipeline/src/stages/sort/), with
//            experiment 133's world: every ticket filed before it with its state at that moment, and
//            every ticket open at that moment as an open plan. Up to two tries, as the machine runs
//            it. 133's folds and controls, 88's tickets with a miss, and a few 88 got right.
//
// Run with
//   node experiments/135-triage-models.ts
//
//   STEP=fetch   first revisions and issue lists through `gh` (read-only). GROUP=p or d. Writes
//                only CACHE
//   STEP=sort    CONFIG=haiku-low|sonnet|opus|opus-high, GROUP=p or d, SET=misses|controls|keep|all
//                (default all), ONLY=<n,n>, RUNS (default 2), CONCURRENCY (default 3), DRY=1 prints
//                the estimate, PROMPT=1 the first prompt, MAX_USD (default 3) stops the step
//   STEP=field   print one field/runs.jsonl row per sort
//   (no STEP)    print the tables. WHY=1 adds each answer's why
//
// CACHE (default `runs/exp-135-cache`) holds ticket text and is never committed.
// `results/135-triage-models.json` holds each answer, its model, cost, time and tokens.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files, `node:child_process`
// for `gh`, as the other replay scripts do.
import {execFile} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {type Options, query} from "@anthropic-ai/claude-agent-sdk";
import {jsonSchema, reader} from "@kampus/fabrika/agents/claude";
import {nextTry} from "@kampus/pipeline/combos";
import {
	type Said as DSaid,
	saidOf as dSaidOf,
	type SortAnswer,
	SortReply,
} from "@kampus/pipeline/stages/sort/answer";
import {type Brief, promptFor, sortProblems} from "@kampus/pipeline/stages/sort/brief";
import type {OpenPlan} from "@kampus/pipeline/stages/sort/services";
import {sorterOptions} from "@kampus/pipeline/stages/sort/sorter";
import {Option, Schema} from "effect";
import {shuffled} from "./lib/review-rounds.ts";
import {
	allIssues,
	Cache,
	type Earlier,
	firstVersion,
	Run as PRunBase,
	type Said as PSaid,
	promptOf,
	saidOf as pSaidOf,
	REPO_NOTE,
	sortOnce,
	Ticket,
	Truth,
} from "./lib/sort.ts";
import {barLines, median, readBar, withClauses} from "./lib/sort-bar.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-135-cache");
const STEP = process.env.STEP ?? "tables";
const GROUP = process.env.GROUP === "d" ? "d" : "p";
const RESULTS = join(here, "results", "135-triage-models.json");
const RUNS = Number(process.env.RUNS ?? 2);
const TRIES = 2;
const only = process.env.ONLY?.split(",").map(Number);

// ---------------------------------------------------------------- the models

/** What changes between runs: the model and the effort. With no effort, none is sent. */
const CONFIGS = {
	"haiku-low": {model: "haiku", effort: "low", label: "haiku, low effort (the machine's)"},
	sonnet: {model: "sonnet", effort: undefined, label: "sonnet, default effort"},
	opus: {model: "opus", effort: undefined, label: "opus, default effort"},
	"opus-high": {model: "opus", effort: "high", label: "opus, high effort"},
} as const satisfies Record<
	string,
	{model: string; effort: Options["effort"] | undefined; label: string}
>;
type ConfigId = keyof typeof CONFIGS;
const CONFIG_IDS = Object.keys(CONFIGS) as ConfigId[];

/** List prices per token, for the estimate only: what a call cost is read from the SDK's result. */
const PRICE: Record<string, {in: number; out: number; read: number}> = {
	haiku: {in: 0.1e-6, out: 0.5e-6, read: 0.01e-6},
	sonnet: {in: 2e-6, out: 10e-6, read: 0.2e-6},
	opus: {in: 4e-6, out: 20e-6, read: 0.2e-6},
};

// ---------------------------------------------------------------- the cases

const truth92b = Schema.decodeUnknownSync(Truth)(
	JSON.parse(readFileSync(join(here, "92b-truth.json"), "utf8")),
).tickets;
const truth88 = Schema.decodeUnknownSync(Truth)(
	JSON.parse(readFileSync(join(here, "88-truth.json"), "utf8")),
).tickets;
const Truth133 = Schema.Struct({
	fold: Schema.Record(Schema.String, Schema.Struct({into: Schema.Array(Schema.Int)})),
	control: Schema.Record(Schema.String, Schema.Struct({near: Schema.Array(Schema.Int)})),
});
const truth133 = Schema.decodeUnknownSync(Truth133, {onExcessProperty: "ignore"})(
	JSON.parse(readFileSync(join(here, "133-truth.json"), "utf8")),
);

const SavedPAnswers = Schema.Record(Schema.String, Schema.Array(PRunBase));
/** 92b's answers with its "both" brief, and 88's with its own brief and the bare run, and 92's "both". */
const saved92b = Schema.decodeUnknownSync(Schema.Struct({both: SavedPAnswers}), {
	onExcessProperty: "ignore",
})(JSON.parse(readFileSync(join(here, "results", "92b-sort-bar-phoenix.json"), "utf8"))).both;
const saved88 = Schema.decodeUnknownSync(
	Schema.Struct({runs: SavedPAnswers, bare: SavedPAnswers}),
	{
		onExcessProperty: "ignore",
	},
)(JSON.parse(readFileSync(join(here, "results", "88-sort-routing.json"), "utf8")));
const saved92 = Schema.decodeUnknownSync(Schema.Struct({both: SavedPAnswers}), {
	onExcessProperty: "ignore",
})(JSON.parse(readFileSync(join(here, "results", "92-sort-bar.json"), "utf8"))).both;

/** How 92b's separate reader sorted each missed "no" (92b, "The misses"). */
const P_KIND = {
	text: [
		7318, 7344, 8242, 8259, 8320, 8327, 8501, 9727, 10138, 10142, 8496, 8587, 8785, 8826, 9890,
		10128, 10144, 10214,
	],
	line: [7216, 8141, 8246, 8338, 8577, 9951, 10236, 8537, 10463],
	code: [7986, 10139],
} as const;
/** The 6 real "no"s 92b's "both" brief closed in both runs. */
const P_CAUGHT = Object.keys(truth92b)
	.map(Number)
	.filter(
		(n) =>
			truth92b[n]?.next === "no" &&
			!Object.values(P_KIND)
				.flat()
				.includes(n as never),
	);
/** Built tickets 92b's "both" brief said "no" or "duplicate" to at least once. */
const P_FALSE_NO = [2563, 2792, 6457, 7750, 2915];
const SEED = 135;
const pAllRight = (n: number) => {
	const runs = saved92b[n] ?? [];
	return (
		runs.length > 0 &&
		runs.every((r) => r.answer !== null && pSaidOf(r.answer.sort) === truth92b[n]?.next)
	);
};
/** Keep right, phoenix: a seeded draw of 5 built tickets 92b's "both" brief routed right both times. */
const P_KEEP = shuffled(
	Object.keys(truth92b)
		.map(Number)
		.filter((n) => ["plan", "ruling", "research"].includes(truth92b[n]?.next ?? ""))
		.filter((n) => !P_FALSE_NO.includes(n) && pAllRight(n)),
	SEED,
)
	.slice(0, 5)
	.toSorted((a, b) => a - b);

const FOLDS = Object.keys(truth133.fold).map(Number);
/** 133: filed within 21 seconds of their target, by the same filer, in one batch. */
const BATCH = [21, 389, 390, 391, 392, 413, 424, 425, 426];
const LATER = FOLDS.filter((n) => !BATCH.includes(n));
const CONTROLS = Object.keys(truth133.control).map(Number);
/** 88's misses on tickets that really were a yes: ruling against plan, mostly. */
const D_ROUTE = [248, 272, 316, 320, 323, 604];
/** 88's other misses: two duplicates only the code shows, three "no"s today's bar has no rule for. */
const D_OTHER = [173, 295, 319, 615, 633];
const d88AllRight = (n: number) => {
	const runs = [...(saved88.runs[n] ?? []), ...(saved88.bare[n] ?? []), ...(saved92[n] ?? [])];
	return (
		runs.length > 0 &&
		runs.every((r) => r.answer !== null && pSaidOf(r.answer.sort) === truth88[n]?.next)
	);
};
/** Keep right, demlik: a seeded draw of 5 real yeses 88 routed right in all six saved answers. */
const D_KEEP = shuffled(
	Object.keys(truth88)
		.map(Number)
		.filter((n) => ["plan", "ruling", "research"].includes(truth88[n]?.next ?? ""))
		.filter((n) => !CONTROLS.includes(n) && d88AllRight(n)),
	SEED,
)
	.slice(0, 5)
	.toSorted((a, b) => a - b);

const SETS = {
	p: {
		misses: [...Object.values(P_KIND).flat(), ...P_FALSE_NO],
		controls: [] as number[],
		keep: [...P_CAUGHT, ...P_KEEP],
	},
	d: {misses: [...FOLDS, ...D_ROUTE, ...D_OTHER], controls: CONTROLS, keep: D_KEEP},
} as const;
const PICKED = {
	p: [...SETS.p.misses, ...SETS.p.keep],
	d: [...SETS.d.misses, ...SETS.d.controls, ...SETS.d.keep],
} as const;
const REPOS = {p: "kamp-us/phoenix", d: "kamp-us/demlik"} as const;

// ---------------------------------------------------------------- the briefs

/** What phoenix is, as experiment 92b put it. */
const PHOENIX_NOTE = [
	"The repo is kamp-us/phoenix, a pnpm monorepo:",
	"- kamp.us: a Turkish-first community site (a link board and a dictionary), one Cloudflare Worker that serves the web app and its backend.",
	"- fabrika: the agent work pipeline, a Claude Code plugin of skills plus fabrika-cli, its command-line tool. Its home is this repo; other repos use it.",
	"- Tuval: a desktop app for running and watching coding agents.",
	"- Smaller packages: a design system, and guards and scripts the CI runs.",
	"Work is done by agents: a builder turns a ticket into a pull request, a reviewer checks it, a shipper merges it. The repo's owners make the calls that need a person.",
].join("\n");
/** 92b's "both": the drafted bar plus the written clauses, examples without demlik's numbers. */
const P_BAR = barLines(
	withClauses(readBar(join(here, "92-value-bar.json")), readBar(join(here, "92-written-bar.json"))),
	{numbers: false},
);
/** As in 92b: the 200 tickets filed just before, by number. */
const P_WINDOW = 200;
const pEarlier = (all: readonly Earlier[], t: Ticket) =>
	all
		.filter((e) => e.n < t.n)
		.toSorted((a, b) => b.n - a.n)
		.slice(0, P_WINDOW);
const pPrompt = (all: readonly Earlier[], t: Ticket) =>
	promptOf(t, t.body, pEarlier(all, t), P_BAR, PHOENIX_NOTE);

const Listed = Schema.Struct({
	n: Schema.Int,
	title: Schema.String,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
});
type Listed = typeof Listed.Type;
const DCache = Schema.Struct({
	tickets: Schema.Array(Ticket),
	/** The first revision of every ticket open when a picked ticket was filed. */
	plans: Schema.Array(Ticket),
	all: Schema.Array(Listed),
});
type DCache = typeof DCache.Type;
const openAt = (i: Listed, t: string) => i.createdAt < t && (i.closedAt === null || i.closedAt > t);
/** 133's plan summary: the first revision's opening, at most 300 characters. Pure. */
const summaryOf = (t: Ticket) => {
	const text = t.body
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^#+ .*$/gm, "")
		.replace(/\s+/g, " ")
		.trim();
	return `${t.title}. ${text.length > 300 ? `${text.slice(0, 300)}…` : text}`;
};
/** 133's world for one demlik ticket, as it stood when the ticket was filed. Pure. */
function dBrief(cache: DCache, t: Ticket): Brief {
	const at = t.createdAt;
	const before = cache.all
		.filter((i) => i.n !== t.n && i.createdAt < at)
		.toSorted((x, y) => y.createdAt.localeCompare(x.createdAt));
	const firsts = new Map(cache.plans.map((p) => [p.n, p]));
	const plans: OpenPlan[] = before
		.filter((i) => openAt(i, at))
		.flatMap((i) => {
			const p = firsts.get(i.n);
			return p === undefined
				? []
				: [{number: i.n, tickets: [i.n], summary: summaryOf(p), approved: false}];
		});
	return {
		ticket: {
			url: `https://github.com/${REPOS.d}/issues/${t.n}`,
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
		note: REPO_NOTE,
	};
}

// ---------------------------------------------------------------- the calls

const PRun = Schema.Struct({...PRunBase.fields, model: Schema.String});
type PRun = typeof PRun.Type;
const Try = Schema.Struct({
	answer: Schema.NullOr(SortReply),
	problems: Schema.Array(Schema.String),
	error: Schema.NullOr(Schema.String),
	model: Schema.String,
	usd: Schema.Number,
	ms: Schema.Number,
	tokens: Schema.Number,
});
type Try = typeof Try.Type;
const DRun = Schema.Struct({tries: Schema.Array(Try)});
type DRun = typeof DRun.Type;
const readReply = reader(SortReply);

/** One call with the pipeline sorter's own options, the model and effort swapped in. */
async function dCall(
	prompt: string,
	cwd: string,
	c: (typeof CONFIGS)[ConfigId],
): Promise<Omit<Try, "problems">> {
	const started = Date.now();
	const {effort: _, ...rest} = sorterOptions(
		{model: c.model, effort: "high", budget: 0.5, note: ""},
		cwd,
	);
	const options: Options = c.effort === undefined ? rest : {...rest, effort: c.effort};
	let seen = "";
	for await (const message of query({
		prompt,
		options: {...options, outputFormat: {type: "json_schema", schema: jsonSchema(SortReply)}},
	})) {
		if (message.type === "system" && message.subtype === "init") seen = message.model;
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
				model: seen,
				usd: message.total_cost_usd,
				ms: Date.now() - started,
				tokens,
			};
		}
	}
	throw new Error("no result");
}

/** One demlik sort as the machine runs it: a try, the Check, and one more try told the problems. */
async function dSort(brief: Brief, cwd: string, c: (typeof CONFIGS)[ConfigId]): Promise<DRun> {
	const tries: Try[] = [];
	let note: string | null = null;
	for (let i = 1; i <= TRIES; i++) {
		const got = await dCall(promptFor(brief, note), cwd, c);
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
type Pools = {p: Record<string, PRun[]>; d: Record<string, DRun[]>};
type Saved = {configs: Record<string, Pools>};
const saved: Saved = existsSync(RESULTS)
	? (Schema.decodeUnknownSync(Saved)(JSON.parse(readFileSync(RESULTS, "utf8"))) as Saved)
	: {configs: {}};
const save = () => writeFileSync(RESULTS, `${JSON.stringify(saved, null, "\t")}\n`);
const poolsOf = (id: ConfigId): Pools => {
	saved.configs[id] ??= {p: {}, d: {}};
	return saved.configs[id];
};

const pFile = () => join(CACHE, "p.json");
const dFile = () => join(CACHE, "d.json");
const loadP = () => {
	if (!existsSync(pFile())) {
		console.error(`no ${pFile()}: run STEP=fetch GROUP=p first`);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(Cache)(JSON.parse(readFileSync(pFile(), "utf8")));
};
const loadD = (): DCache => {
	if (!existsSync(dFile())) {
		console.error(`no ${dFile()}: run STEP=fetch GROUP=d first`);
		process.exit(1);
	}
	return Schema.decodeUnknownSync(DCache)(JSON.parse(readFileSync(dFile(), "utf8")));
};

// ---------------------------------------------------------------- fetch

const gh = (args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile("gh", args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 300)}`)),
		),
	);

/** Every demlik issue with when it opened and closed. Titles are as they stand today. */
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

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const tickets: Ticket[] = [];
	for (const n of PICKED[GROUP]) tickets.push(await firstVersion(n, REPOS[GROUP]));
	if (GROUP === "p") {
		const all = await allIssues(REPOS.p, 20_000);
		writeFileSync(pFile(), JSON.stringify({tickets, all}, null, "\t"));
		console.log(`${REPOS.p}: ${tickets.length} tickets, ${all.length} issues listed`);
	} else {
		const all = await listAll(REPOS.d);
		const open = [
			...new Set(
				tickets.flatMap((t) =>
					all.filter((i) => i.n !== t.n && openAt(i, t.createdAt)).map((i) => i.n),
				),
			),
		];
		const plans: Ticket[] = [];
		for (const n of open) plans.push(await firstVersion(n, REPOS.d));
		writeFileSync(dFile(), JSON.stringify({tickets, plans, all}, null, "\t"));
		console.log(
			`${REPOS.d}: ${tickets.length} tickets, ${plans.length} open plans, ${all.length} issues`,
		);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- sort

const pUsd = (r: PRun) => r.usd;
const dUsd = (r: DRun) => r.tries.reduce((s, t) => s + t.usd, 0);

if (STEP === "sort") {
	const id = (process.env.CONFIG ?? "") as ConfigId;
	const c = CONFIGS[id];
	if (c === undefined) {
		console.error(`CONFIG is one of ${CONFIG_IDS.join(", ")}`);
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
	const p = GROUP === "p" ? loadP() : null;
	const d = GROUP === "d" ? loadD() : null;
	const ticketOf = (n: number) =>
		(p ?? d)?.tickets.find((t) => t.n === n) ??
		(() => {
			throw new Error(`#${n} is not in the cache: run STEP=fetch GROUP=${GROUP}`);
		})();
	const promptOfN = (n: number) =>
		p !== null ? pPrompt(p.all, ticketOf(n)) : promptFor(dBrief(d as DCache, ticketOf(n)), null);
	const todo = wanted.filter((n) => (only === undefined || only.includes(n)) && have(n) < RUNS);
	const price = PRICE[c.model] ?? {in: 0, out: 0, read: 0};
	// The pilot's first calls cost about twice the input price a token: the SDK writes the prompt to
	// the cache, at the one-hour rate. A second run of the same prompt reads it back.
	let input = 0;
	const estimate = todo.reduce((s, n) => {
		const tokens = promptOfN(n).length / 4;
		const runs = RUNS - have(n);
		input += tokens;
		const first = have(n) === 0 ? tokens * price.in * 2 : tokens * price.read;
		return s + first + (runs - 1) * tokens * price.read + runs * 1000 * price.out;
	}, 0);
	const calls = todo.reduce((s, n) => s + RUNS - have(n), 0);
	console.log(
		`${id}, group ${GROUP}, set ${set}: ${calls} sorts on ${todo.length} tickets, ${Math.round(input)} prompt tokens, about $${estimate.toFixed(2)} at list price (cache writes at twice the input price, 1,000 output tokens a call)`,
	);
	if (process.env.PROMPT === "1" && todo[0] !== undefined) console.log(promptOfN(todo[0]));
	if (process.env.DRY === "1") process.exit(0);
	const MAX_USD = Number(process.env.MAX_USD ?? 3);
	const cwd = mkdtempSync(join(tmpdir(), "exp-135-"));
	let spent = 0;
	const queue = [...todo];
	const word = (n: number, said: string, usd: number, ms: number, extra = "") =>
		console.log(`#${n} ${said}${extra} ($${usd.toFixed(4)}, ${(ms / 1000).toFixed(1)} s)`);
	const worker = async () => {
		for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
			while (have(n) < RUNS) {
				if (spent >= MAX_USD) return;
				if (p !== null) {
					const r = await sortOnce(n, promptOfN(n), cwd, c.model, c.effort);
					spent += pUsd(r);
					pools.p[n] = [...(pools.p[n] ?? []), r];
					save();
					word(
						n,
						r.answer === null ? (r.error ?? "none") : pSaidOf(r.answer.sort),
						r.usd,
						r.ms,
						` ${r.model}`,
					);
				} else {
					const r = await dSort(dBrief(d as DCache, ticketOf(n)), cwd, c);
					spent += dUsd(r);
					pools.d[n] = [...(pools.d[n] ?? []), r];
					save();
					const last = r.tries.at(-1);
					word(
						n,
						last?.answer === null || last?.answer === undefined
							? (last?.error ?? "none")
							: dWord(last.answer.sort),
						dUsd(r),
						r.tries.reduce((s, t) => s + t.ms, 0),
						` ${last?.model}${r.tries.length > 1 ? `, ${r.tries.length} tries` : ""}`,
					);
				}
			}
		}
	};
	await Promise.all(Array.from({length: Number(process.env.CONCURRENCY ?? 3)}, () => worker()));
	console.log(
		`spent $${spent.toFixed(2)}${spent >= MAX_USD ? ` (stopped at MAX_USD $${MAX_USD})` : ""}`,
	);
	process.exit(0);
}

// ---------------------------------------------------------------- reading the answers

/** A demlik answer in one word, with its target: `fold #388`, `duplicate #20`, `no:carried`. */
function dWord(a: SortAnswer): string {
	if (a.answer === "duplicate") return `duplicate #${a.of}`;
	if (a.answer === "no") return `no:${a.rule}`;
	if (a.next === "plan") return a.partOf === null ? "plan" : `fold #${a.partOf}`;
	return a.next;
}
const dLast = (r: DRun) => r.tries.at(-1)?.answer?.sort ?? null;
const dSaid = (r: DRun): DSaid | null => {
	const a = dLast(r);
	return a === null ? null : dSaidOf(a);
};
const pSaid = (r: PRun): PSaid | null => (r.answer === null ? null : pSaidOf(r.answer.sort));

/** Is a demlik answer the one the ticket really needed? Pure. */
function dRight(n: number, r: DRun): boolean {
	const a = dLast(r);
	if (a === null) return false;
	const fold = truth133.fold[n];
	if (fold !== undefined)
		return (
			a.answer === "yes" && a.next === "plan" && a.partOf !== null && fold.into.includes(a.partOf)
		);
	if (truth133.control[n] !== undefined)
		return a.answer === "yes" && a.next === "plan" && a.partOf === null;
	const t = truth88[n];
	if (t === undefined) return false;
	if (t.next === "dup") return a.answer === "duplicate" && a.of === t.dupOf;
	if (t.next === "no") return a.answer === "no";
	return a.answer === "yes" && a.next === t.next;
}
/** A demlik "no" on work that was really done: a no, or a duplicate that is not a fold's own target. */
function dWrongNo(n: number, r: DRun): boolean {
	const a = dLast(r);
	if (a === null) return false;
	const realYes =
		truth133.fold[n] !== undefined ||
		truth133.control[n] !== undefined ||
		["plan", "ruling", "research"].includes(truth88[n]?.next ?? "");
	if (!realYes) return false;
	if (a.answer === "no") return true;
	return a.answer === "duplicate" && !(truth133.fold[n]?.into.includes(a.of) ?? false);
}
const pRealNo = (n: number) => truth92b[n]?.next === "no";
const pRight = (n: number, r: PRun) => {
	const s = pSaid(r);
	return pRealNo(n) ? s === "no" || s === "dup" : s === truth92b[n]?.next;
};
const pWrongNo = (n: number, r: PRun) => {
	const s = pSaid(r);
	return !pRealNo(n) && truth92b[n]?.next !== "dup" && (s === "no" || s === "dup");
};

/** Sonnet's saved answers on the same briefs: 92b's "both" for group p, 133's part A for group d. */
function savedSonnet(): Pools {
	const raw = JSON.parse(
		readFileSync(join(here, "results", "133-triage-folds-and-needs-info.json"), "utf8"),
	) as {a: Record<string, {tries: (Omit<Try, "model"> & {model?: string})[]}[]>};
	const d: Record<string, DRun[]> = {};
	for (const [n, runs] of Object.entries(raw.a))
		d[n] = runs.map((r) => ({tries: r.tries.map((t) => ({...t, model: t.model ?? "sonnet"}))}));
	const p: Record<string, PRun[]> = {};
	for (const [n, runs] of Object.entries(saved92b))
		p[n] = runs.map((r) => ({...r, model: "claude-sonnet-5-5"}));
	return {p, d};
}

// ---------------------------------------------------------------- field rows

if (STEP === "field") {
	for (const id of CONFIG_IDS) {
		const pools = saved.configs[id];
		if (pools === undefined) continue;
		const c = CONFIGS[id];
		for (const [n, runs] of Object.entries(pools.p))
			runs.forEach((r, i) => {
				console.log(
					JSON.stringify({
						date: "2026-10-24",
						lane: `${REPOS.p}#${n}`,
						role: "triager",
						model: r.model,
						effort: c.effort ?? null,
						outcome: r.answer === null ? "stopped" : "pass",
						why: `experiment 135 group p: 92b's "both" brief on the first title and body, no tools (run ${i + 1}); said ${pSaid(r)}, really ${truth92b[n]?.next}; posted nothing`,
						tokens: r.tokens,
						tools: null,
						minutes: +(r.ms / 60000).toFixed(2),
						note: "2026-10-24-03",
						driver_caused: false,
						costUsd: +r.usd.toFixed(4),
						billed: r.tokens,
						replay: true,
						name: pSaid(r),
					}),
				);
			});
		for (const [n, runs] of Object.entries(pools.d))
			runs.forEach((r, i) => {
				const tokens = r.tries.reduce((s, t) => s + t.tokens, 0);
				const a = dLast(r);
				console.log(
					JSON.stringify({
						date: "2026-10-24",
						lane: `${REPOS.d}#${n}`,
						role: "triager",
						model: r.tries.at(-1)?.model ?? c.model,
						effort: c.effort ?? null,
						outcome: a === null ? "stopped" : "pass",
						why: `experiment 135 group d: today's sort brief and Check on the first title and body, no tools (run ${i + 1}, ${r.tries.length} tries); said ${a === null ? "none" : dWord(a)}, really ${truthWord(Number(n))}; posted nothing`,
						tokens,
						tools: null,
						minutes: +(r.tries.reduce((s, t) => s + t.ms, 0) / 60000).toFixed(2),
						note: "2026-10-24-03",
						driver_caused: false,
						costUsd: +dUsd(r).toFixed(4),
						billed: tokens,
						replay: true,
						name: a === null ? null : OUTCOME[dSaidOf(a)],
					}),
				);
			});
	}
	process.exit(0);
}

function truthWord(n: number): string {
	const f = truth133.fold[n];
	if (f !== undefined) return `fold into #${f.into.join(" or #")}`;
	if (truth133.control[n] !== undefined) return "a plan of its own";
	const t = truth88[n];
	if (t?.next === "dup") return `duplicate of #${t.dupOf}`;
	return t?.next ?? "unknown";
}

/** An answer by its outcome's name, as the sort stage prints it. */
const OUTCOME: Record<DSaid, string> = {
	duplicate: "done:closed:duplicate",
	no: "done:closed:no",
	plan: "send:plan:yes",
	fold: "send:plan:fold",
	research: "send:research:yes",
	ruling: "ask:owner:ruling",
};

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- tables

type Column = {id: string; label: string; pools: Pools};
const columns: Column[] = [
	{id: "sonnet-saved", label: "sonnet, saved (92b, 133)", pools: savedSonnet()},
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

const rows: [string, (col: Column) => string][] = [
	[
		"p: real no closed, text shows it (18 tickets)",
		(col) => {
			const as = pAnswers(col, P_KIND.text);
			return frac(
				count(as, ({n, r}) => pRight(n, r)),
				as.length,
			);
		},
	],
	[
		"p: real no closed, a line the bar does not draw (9)",
		(col) => {
			const as = pAnswers(col, P_KIND.line);
			return frac(
				count(as, ({n, r}) => pRight(n, r)),
				as.length,
			);
		},
	],
	[
		"p: real no closed, needs the code (2)",
		(col) => {
			const as = pAnswers(col, P_KIND.code);
			return frac(
				count(as, ({n, r}) => pRight(n, r)),
				as.length,
			);
		},
	],
	[
		"p: real no closed, caught by 92b both times (6)",
		(col) => {
			const as = pAnswers(col, P_CAUGHT);
			return frac(
				count(as, ({n, r}) => pRight(n, r)),
				as.length,
			);
		},
	],
	[
		"p: wrong no, built tickets 92b closed (5)",
		(col) => {
			const as = pAnswers(col, P_FALSE_NO);
			return frac(
				count(as, ({n, r}) => pWrongNo(n, r)),
				as.length,
			);
		},
	],
	[
		"p: wrong no, built tickets kept right (5)",
		(col) => {
			const as = pAnswers(col, P_KEEP);
			return frac(
				count(as, ({n, r}) => pWrongNo(n, r)),
				as.length,
			);
		},
	],
	[
		"p: route right, all 10 built tickets",
		(col) => {
			const as = pAnswers(col, [...P_FALSE_NO, ...P_KEEP]);
			return frac(
				count(as, ({n, r}) => pRight(n, r)),
				as.length,
			);
		},
	],
	[
		"d: right fold, batch siblings (9)",
		(col) => {
			const as = dAnswers(col, BATCH);
			return frac(
				count(as, ({n, r}) => dRight(n, r)),
				as.length,
			);
		},
	],
	[
		"d: right fold, later reports (4)",
		(col) => {
			const as = dAnswers(col, LATER);
			return frac(
				count(as, ({n, r}) => dRight(n, r)),
				as.length,
			);
		},
	],
	[
		"d: duplicate of the fold's target (13)",
		(col) => {
			const as = dAnswers(col, FOLDS);
			return frac(
				count(as, ({n, r}) => {
					const a = dLast(r);
					return a?.answer === "duplicate" && (truth133.fold[n]?.into.includes(a.of) ?? false);
				}),
				as.length,
			);
		},
	],
	[
		"d: false fold, controls (13)",
		(col) => {
			const as = dAnswers(col, CONTROLS);
			return frac(
				count(as, ({r}) => dSaid(r) === "fold"),
				as.length,
			);
		},
	],
	[
		"d: route right, 88's route misses (6)",
		(col) => {
			const as = dAnswers(col, D_ROUTE);
			return frac(
				count(as, ({n, r}) => dRight(n, r)),
				as.length,
			);
		},
	],
	[
		"d: right, 88's other misses (5)",
		(col) => {
			const as = dAnswers(col, D_OTHER);
			return frac(
				count(as, ({n, r}) => dRight(n, r)),
				as.length,
			);
		},
	],
	[
		"d: route right, kept right (5)",
		(col) => {
			const as = dAnswers(col, D_KEEP);
			return frac(
				count(as, ({n, r}) => dRight(n, r)),
				as.length,
			);
		},
	],
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
			const pSame = PICKED.p.filter((n) => {
				const ws = (col.pools.p[n] ?? []).map(pSaid);
				return ws.length > 1 && ws.every((w) => w === ws[0]);
			});
			const pHad = PICKED.p.filter((n) => (col.pools.p[n]?.length ?? 0) > 1);
			const dSame = PICKED.d.filter((n) => {
				const ws = (col.pools.d[n] ?? []).map((r) => {
					const a = dLast(r);
					return a === null ? "none" : dWord(a);
				});
				return ws.length > 1 && ws.every((w) => w === ws[0]);
			});
			const dHad = PICKED.d.filter((n) => (col.pools.d[n]?.length ?? 0) > 1);
			return frac(pSame.length + dSame.length, pHad.length + dHad.length);
		},
	],
];

const costOf = (col: Column) => {
	const ps = PICKED.p.flatMap((n) => col.pools.p[n] ?? []);
	const ds = PICKED.d.flatMap((n) => col.pools.d[n] ?? []);
	const usd = [...ps.map(pUsd), ...ds.map(dUsd)];
	const ms = [...ps.map((r) => r.ms), ...ds.map((r) => r.tries.reduce((s, t) => s + t.ms, 0))];
	const tokens = [
		...ps.map((r) => r.tokens),
		...ds.map((r) => r.tries.reduce((s, t) => s + t.tokens, 0)),
	];
	const total = usd.reduce((s, x) => s + x, 0);
	const models = new Set([
		...ps.map((r) => r.model),
		...ds.flatMap((r) => r.tries.map((t) => t.model)),
	]);
	return {
		sorts: usd.length,
		total,
		mean: usd.length === 0 ? 0 : total / usd.length,
		ms: median(ms),
		tokens: median(tokens),
		models: [...models].join(", "),
		retried: ds.filter((r) => r.tries.length > 1).length,
		noAnswer:
			ps.filter((r) => r.answer === null).length + ds.filter((r) => dLast(r) === null).length,
	};
};

console.log(
	`cases: group p ${PICKED.p.length} phoenix tickets (keep right: ${P_KEEP.join(", ")}); group d ${PICKED.d.length} demlik tickets (keep right: ${D_KEEP.join(", ")})\n`,
);
for (const col of columns) {
	const c = costOf(col);
	console.log(
		`${col.label} [${c.models}]: ${c.sorts} sorts, $${c.total.toFixed(2)}, $${c.mean.toFixed(4)} a sort, median ${(c.ms / 1000).toFixed(1)} s and ${c.tokens} tokens a sort, ${c.retried} second tries, ${c.noAnswer} with no answer`,
	);
}
console.log("");
const width = Math.max(...rows.map(([name]) => name.length));
console.log(`${"".padEnd(width)}  ${columns.map((c) => c.id.padStart(13)).join("")}`);
for (const [name, f] of rows)
	console.log(`${name.padEnd(width)}  ${columns.map((c) => f(c).padStart(13)).join("")}`);

if (process.env.EACH !== "0") {
	console.log("\nevery ticket (* not right; for real yeses in group p, a no or duplicate):");
	for (const n of PICKED.p) {
		const cells = columns.map(
			(col) =>
				`${col.id}: ${(col.pools.p[n] ?? []).map((r) => `${pSaid(r) ?? "none"}${pRight(n, r) ? "" : "*"}`).join(",") || "-"}`,
		);
		console.log(`p #${n} really ${truth92b[n]?.next}: ${cells.join("  ")}`);
		if (process.env.WHY === "1")
			for (const col of columns)
				for (const r of col.pools.p[n] ?? [])
					console.log(
						`    ${col.id}: ${r.answer?.sort.answer === "no" ? `${r.answer.sort.reason}. ` : ""}${r.answer?.sort.why}`,
					);
	}
	for (const n of PICKED.d) {
		const cells = columns.map(
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
			for (const col of columns)
				for (const r of col.pools.d[n] ?? []) console.log(`    ${col.id}: ${dLast(r)?.why}`);
	}
}
