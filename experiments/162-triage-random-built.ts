// Experiment 162: does GPT sol, with experiment 161's security line in the bar, wrongly close built
// work? 161 measured that on 10 built phoenix tickets, 5 of them picked because a model had closed
// them. This draws 30 built kamp-us/phoenix tickets at random instead, the same kind 92b and 135 call
// "built", and sorts each twice on GPT sol (161's harness, model, effort and bar) and twice on opus
// (135's way: 92b's "both" brief through the Agent SDK, no security line).
//
//   built    filed 2026-07-01 or later, closed completed by a merged pull request, not an epic
//            (92b's yes side). `next` from triage's type label: decision is ruling, investigation is
//            research, the rest plan. The 10 built tickets 135, 159 and 161 used are left out.
//   draw     every such ticket by number, shuffled with seed 162 (`shuffled`, the seeded shuffle
//            135 used), the first 30.
//   security a held-out set of built security tickets, by a rule written before any answer (see
//            "the security set" below), scored on its own.
//
// Run with
//   node experiments/162-triage-random-built.ts
//
//   STEP=draw    list phoenix's closed issues through `gh` (read-only) and write 162-truth.json.
//                Refuses to run again once the file exists: GitHub moves on, the draw must not
//   STEP=fetch   first versions of both sets and phoenix's issue list through `gh`, into CACHE
//   STEP=security-read  the security set's hand read: its candidates in their seeded order, K of
//                them (default 30), with each first body's opening and labels. The reading itself
//                is in 162-truth.json (`security`)
//   STEP=sort    MODEL=sol or opus, SET=random|security|all (default all). ONLY=<n,n>, RUNS
//                (default 2), CONCURRENCY (default 2),
//                PROMPT=1 prints the first prompt and stops. opus: DRY=1 prints the estimate,
//                MAX_USD (default 10) stops the step once opus's whole spend here, both sets,
//                reaches it
//   STEP=field   print one field/runs.jsonl row per sort
//   (no STEP)    the tables. WHY=1 adds each answer's why
//
// CACHE (default `runs/exp-162-cache`) holds ticket text and is never committed. GPT sol runs on the
// laptop's ChatGPT plan: run it with no `OPENAI_API_KEY` or `CODEX_API_KEY`. Opus runs on the Agent
// SDK's own login, with no `TYPESAFE_API_KEY`.
//
// Node at the edge, said out loud: `node:fs` for the cache and result files, `node:child_process`
// for `gh`, as 135 does.
import {execFile} from "node:child_process";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Schema} from "effect";
import {shuffled} from "./lib/review-rounds.ts";
import {median} from "./lib/sort-bar.ts";
import {
	allIssues,
	Cache,
	firstVersion,
	Run as PRunBase,
	type Said,
	SYSTEM,
	saidOf,
	sortOnce,
	type Ticket,
	Truth,
} from "./lib/sort.ts";
import {
	dBrief,
	P_BAR_SECURITY,
	P_FALSE_NO,
	P_KEEP,
	type PAnswered,
	pPrompt,
	pSaid,
} from "./lib/triage-135.ts";
import {fieldRows, resultsAt, sortStep} from "./lib/triage-codex.ts";

const here = import.meta.dirname;
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-162-cache");
const STEP = process.env.STEP ?? "tables";
const REPO = "kamp-us/phoenix";
const SEED = 162;
const SIZE = 30;
const SINCE = "2026-07-01";
const TRUTH = join(here, "162-truth.json");
const USED = [...P_FALSE_NO, ...P_KEEP];
const only = process.env.ONLY?.split(",").map(Number);
const RUNS = Number(process.env.RUNS ?? 2);

const SOL = "sol-security";
const EFFORT = "medium";
const sol = resultsAt(join(here, "results", "162-triage-random-built.json"));

// ---------------------------------------------------------------- the draw

const gh = (args: readonly string[]) =>
	new Promise<string>((resolve, reject) =>
		execFile("gh", args as string[], {maxBuffer: 256 * 1024 * 1024}, (error, stdout, stderr) =>
			error === null ? resolve(stdout) : reject(new Error(`gh failed: ${stderr.slice(0, 300)}`)),
		),
	);

const POOL_QUERY = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){
  issues(first:100,after:$after,states:CLOSED,orderBy:{field:CREATED_AT,direction:DESC}){
    pageInfo{hasNextPage endCursor}
    nodes{number createdAt stateReason labels(first:30){nodes{name}}
      timelineItems(itemTypes:[CLOSED_EVENT],last:1){nodes{... on ClosedEvent{closer{__typename ... on PullRequest{number merged}}}}}}
  }}}`;
const Closed = Schema.Struct({
	number: Schema.Int,
	createdAt: Schema.String,
	stateReason: Schema.NullOr(Schema.String),
	labels: Schema.Struct({nodes: Schema.Array(Schema.Struct({name: Schema.String}))}),
	timelineItems: Schema.Struct({
		nodes: Schema.Array(
			Schema.Struct({
				closer: Schema.optional(
					Schema.NullOr(
						Schema.Struct({
							__typename: Schema.String,
							number: Schema.optional(Schema.Int),
							merged: Schema.optional(Schema.Boolean),
						}),
					),
				),
			}),
		),
	}),
});
type Closed = typeof Closed.Type;
const Page = Schema.Struct({
	data: Schema.Struct({
		repository: Schema.Struct({
			issues: Schema.Struct({
				pageInfo: Schema.Struct({
					hasNextPage: Schema.Boolean,
					endCursor: Schema.NullOr(Schema.String),
				}),
				nodes: Schema.Array(Closed),
			}),
		}),
	}),
});

/** Every closed phoenix issue filed on or after SINCE, newest first. */
async function closedSince(): Promise<Closed[]> {
	const out: Closed[] = [];
	let after: string | null = null;
	for (;;) {
		const raw = await gh([
			"api",
			"graphql",
			"-f",
			`query=${POOL_QUERY}`,
			"-F",
			"owner=kamp-us",
			"-F",
			"name=phoenix",
			...(after === null ? [] : ["-f", `after=${after}`]),
		]);
		const {nodes, pageInfo} = Schema.decodeUnknownSync(Page)(JSON.parse(raw)).data.repository
			.issues;
		out.push(...nodes.filter((i) => i.createdAt >= SINCE));
		const oldest = nodes.at(-1)?.createdAt ?? "";
		if (!pageInfo.hasNextPage || oldest < SINCE) return out;
		after = pageInfo.endCursor;
	}
}

/** The merged pull request that closed it, if one did. Pure. */
const closerOf = (i: Closed): number | null => {
	const c = i.timelineItems.nodes.at(-1)?.closer;
	return c?.__typename === "PullRequest" && c.merged === true && c.number !== undefined
		? c.number
		: null;
};
/** Triage's type label, without its prefix, or "none". Pure. */
const typeOf = (i: Closed): string =>
	i.labels.nodes.find((l) => l.name.startsWith("type:"))?.name.slice("type:".length) ?? "none";
/** 92b's route from the type label. Pure. */
const nextOf = (type: string): Said =>
	type === "decision" ? "ruling" : type === "investigation" ? "research" : "plan";

const Truth162 = Schema.Struct({
	...Truth.fields,
	seed: Schema.Int,
	drawn: Schema.String,
	/** Every built ticket the draw was made from, by number, before the shuffle. */
	pool: Schema.Array(Schema.Int),
	/** The held-out security set: its rule, every candidate read and why, and the tickets kept. */
	security: Schema.optional(
		Schema.Struct({
			rule: Schema.String,
			read: Schema.Array(Schema.Struct({n: Schema.Int, keep: Schema.Boolean, why: Schema.String})),
			tickets: Truth.fields.tickets,
		}),
	),
});

if (STEP === "draw") {
	if (existsSync(TRUTH)) {
		console.error(`${TRUTH} exists: the draw is made once`);
		process.exit(1);
	}
	const closed = await closedSince();
	const built = closed.filter(
		(i) =>
			i.stateReason === "COMPLETED" &&
			closerOf(i) !== null &&
			typeOf(i) !== "epic" &&
			!USED.includes(i.number),
	);
	const pool = built.map((i) => i.number).toSorted((a, b) => a - b);
	const picked = shuffled(pool, SEED)
		.slice(0, SIZE)
		.toSorted((a, b) => a - b);
	const byN = new Map(built.map((i) => [i.number, i]));
	const tickets = Object.fromEntries(
		picked.map((n) => {
			const i = byN.get(n) as Closed;
			const type = typeOf(i);
			const next = nextOf(type);
			const pr = closerOf(i);
			return [
				String(n),
				{
					label: type,
					end: next,
					next,
					why:
						next === "plan"
							? `built: PR ${pr} closed it`
							: `triage typed it ${type === "decision" ? "a decision" : "an investigation"}; PR ${pr} closed it`,
				},
			];
		}),
	);
	const drawn = new Date().toISOString().slice(0, 10);
	const truth = {
		note: `Experiment 162. A seeded draw (seed ${SEED}) of ${SIZE} kamp-us/phoenix tickets filed ${SINCE} or later, closed completed by a merged pull request, not epics, made on ${drawn} (UTC) from the ${pool.length} such tickets listed in \`pool\`, leaving out the 10 built tickets experiments 135, 159 and 161 used. 92b's yes side, drawn again: \`next\` from triage's type label (decision is ruling, investigation is research, the rest plan).`,
		seed: SEED,
		drawn,
		pool,
		tickets,
	};
	writeFileSync(TRUTH, `${JSON.stringify(truth, null, "\t")}\n`);
	console.log(
		`${closed.length} closed since ${SINCE}, ${pool.length} built; drew ${picked.join(", ")}`,
	);
	process.exit(0);
}

if (!existsSync(TRUTH)) {
	console.error("no 162-truth.json: run STEP=draw first");
	process.exit(1);
}
const truth = Schema.decodeUnknownSync(Truth162)(JSON.parse(readFileSync(TRUTH, "utf8")));
const RANDOM = Object.keys(truth.tickets).map(Number);
const SECURE = Object.keys(truth.security?.tickets ?? {}).map(Number);
const PICKED = [...RANDOM, ...SECURE];
const nextFor = (n: number) => truth.tickets[n]?.next ?? truth.security?.tickets[n]?.next;

// ---------------------------------------------------------------- the security set

/**
 * The held-out security set, by a rule written before any answer was seen: a built ticket from
 * the same pool whose title matches SECURITY_WORDS, not in the random 30 or the 10 used before,
 * read in a seeded order (seed 162), every candidate read, kept when its first body names a
 * security gap. A security gap: a hole in who may see or do what, a secret or credential that can
 * reach a log, an error, an output, the repo or a third party, an injection or unsafe-input path,
 * or a ReDoS. The aim was 12; all 66 candidates held 10.
 */
const SECURITY_WORDS =
	/\b(secur\w*|authori[sz]\w*|authenticat\w*|unauthori[sz]\w*|unauthenticat\w*|permission\w*|privilege\w*|secrets?|credentials?|passwords?|leak\w*|redact\w*|inject\w*|xss|csrf|ssrf|idor|redos|backtrack\w*|saniti[sz]\w*|untrusted|signature\w*|spoof\w*|traversal|exploit\w*|vulnerab\w*|cors|bearer|api.?keys?)\b/i;
const candidates = (all: readonly {n: number; title: string}[]) => {
	const titles = new Map(all.map((i) => [i.n, i.title]));
	return shuffled(
		truth.pool.filter(
			(n) => !RANDOM.includes(n) && !USED.includes(n) && SECURITY_WORDS.test(titles.get(n) ?? ""),
		),
		SEED,
	).map((n) => ({n, title: titles.get(n) ?? ""}));
};

// ---------------------------------------------------------------- fetch

const pFile = join(CACHE, "p.json");
if (STEP === "security-read") {
	// The hand read: candidates in the seeded order, each with its first body's opening and labels.
	const cache = Schema.decodeUnknownSync(Cache)(JSON.parse(readFileSync(pFile, "utf8")));
	const list = candidates(cache.all);
	console.log(`${list.length} candidates`);
	for (const {n, title} of list.slice(0, Number(process.env.K ?? 30))) {
		const t = await firstVersion(n, REPO);
		const labels = JSON.parse(
			await gh(["issue", "view", String(n), "-R", REPO, "--json", "labels"]),
		) as {labels: {name: string}[]};
		const body = t.body
			.replace(/<!--[\s\S]*?-->/g, "")
			.replace(/\s+/g, " ")
			.slice(0, 380);
		console.log(
			`\n#${n} [${labels.labels.map((l) => l.name).join(", ")}] ${t.title}${t.title === title ? "" : ` (now: ${title})`}\n  ${body}`,
		);
	}
	process.exit(0);
}
if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const tickets: Ticket[] = [];
	for (const n of PICKED) tickets.push(await firstVersion(n, REPO));
	const all = await allIssues(REPO, 20_000);
	writeFileSync(pFile, JSON.stringify({tickets, all}, null, "\t"));
	console.log(`${REPO}: ${tickets.length} tickets, ${all.length} issues listed`);
	process.exit(0);
}

// ---------------------------------------------------------------- opus, as 135 ran it

const OpusRun = Schema.Struct({...PRunBase.fields, model: Schema.String});
type OpusRun = typeof OpusRun.Type;
const OPUS_FILE = join(here, "results", "162-triage-random-built-opus.json");
const OpusSaved = Schema.Struct({p: Schema.Record(Schema.String, Schema.Array(OpusRun))});
const opus: {p: Record<string, OpusRun[]>} = existsSync(OPUS_FILE)
	? (Schema.decodeUnknownSync(OpusSaved)(JSON.parse(readFileSync(OPUS_FILE, "utf8"))) as {
			p: Record<string, OpusRun[]>;
		})
	: {p: {}};
const saveOpus = () => writeFileSync(OPUS_FILE, `${JSON.stringify(opus, null, "\t")}\n`);
const opusSpent = () =>
	Object.values(opus.p)
		.flat()
		.reduce((s, r) => s + r.usd, 0);
/** 135's list price for opus, for the estimate only; what a call cost is read from the SDK. */
const OPUS_PRICE = {in: 4e-6, out: 20e-6, read: 0.2e-6};

if (STEP === "sort") {
	const which = process.env.MODEL;
	const set = process.env.SET ?? "all";
	const sets: Record<string, readonly number[]> = {random: RANDOM, security: SECURE, all: PICKED};
	const wanted = (sets[set] ?? []).filter((n) => only === undefined || only.includes(n));
	if (wanted.length === 0) {
		console.error("SET is random, security or all, and ONLY names tickets in it");
		process.exit(1);
	}
	if (which === "sol") {
		await sortStep({
			name: "exp-162",
			group: "p",
			cache: CACHE,
			wanted,
			only,
			runs: RUNS,
			concurrency: Number(process.env.CONCURRENCY ?? 2),
			effort: EFFORT,
			label: SOL,
			pools: sol.poolsOf(SOL),
			save: sol.save,
			pPromptOf: (all, t) => `${SYSTEM}\n\n${pPrompt(all, t, P_BAR_SECURITY)}`,
			dBriefOf: dBrief,
			dEdit: (prompt) => prompt,
			printPrompt: process.env.PROMPT === "1",
		});
		process.exit(0);
	}
	if (which !== "opus") {
		console.error("MODEL is sol or opus");
		process.exit(1);
	}
	if (process.env.TYPESAFE_API_KEY !== undefined) {
		console.error("TYPESAFE_API_KEY is set: opus runs on the SDK's own login; unset it");
		process.exit(1);
	}
	const cache = Schema.decodeUnknownSync(Cache)(JSON.parse(readFileSync(pFile, "utf8")));
	const ticketOf = (n: number) => {
		const t = cache.tickets.find((x) => x.n === n);
		if (t === undefined) throw new Error(`#${n} is not in the cache: run STEP=fetch`);
		return t;
	};
	// 135's prompt: 92b's "both" brief, no security line; SYSTEM goes as the system prompt.
	const promptOfN = (n: number) => pPrompt(cache.all, ticketOf(n));
	const have = (n: number) => opus.p[n]?.length ?? 0;
	const todo = wanted.filter((n) => have(n) < RUNS);
	// 135's estimate: a first sort writes the prompt to the cache at twice the input price, a second
	// reads it back; 4 characters a token plus the SDK's own 4,500.
	const estimate = todo.reduce((s, n) => {
		const tokens = promptOfN(n).length / 4 + 4500;
		const runs = RUNS - have(n);
		const first = have(n) === 0 ? tokens * OPUS_PRICE.in * 2 : tokens * OPUS_PRICE.read;
		return s + first + (runs - 1) * tokens * OPUS_PRICE.read + runs * 1000 * OPUS_PRICE.out;
	}, 0);
	const calls = todo.reduce((s, n) => s + RUNS - have(n), 0);
	const MAX_USD = Number(process.env.MAX_USD ?? 10);
	console.log(
		`opus: ${calls} sorts on ${todo.length} tickets, about $${estimate.toFixed(2)} at list price, ${(calls * 0.11).toFixed(2)} at 135's $0.11 a sort; spent here so far $${opusSpent().toFixed(2)}, cap $${MAX_USD}`,
	);
	if (process.env.PROMPT === "1" && todo[0] !== undefined) console.log(promptOfN(todo[0]));
	if (process.env.DRY === "1") process.exit(0);
	const cwd = mkdtempSync(join(tmpdir(), "exp-162-"));
	const queue = [...todo];
	const worker = async () => {
		for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
			while (have(n) < RUNS) {
				if (opusSpent() >= MAX_USD) return;
				const r = await sortOnce(n, promptOfN(n), cwd, "opus");
				opus.p[n] = [...(opus.p[n] ?? []), r];
				saveOpus();
				console.log(
					`#${n} ${r.answer === null ? (r.error ?? "none") : saidOf(r.answer.sort)} ($${r.usd.toFixed(4)}, ${(r.ms / 1000).toFixed(1)} s ${r.model})`,
				);
			}
		}
	};
	await Promise.all(Array.from({length: Number(process.env.CONCURRENCY ?? 2)}, () => worker()));
	rmSync(cwd, {recursive: true, force: true});
	console.log(
		`opus spent here $${opusSpent().toFixed(2)}${opusSpent() >= MAX_USD ? ` (stopped at MAX_USD $${MAX_USD})` : ""}`,
	);
	process.exit(0);
}

const solPools = sol.saved.configs[SOL];
const setOf = (n: number) =>
	SECURE.includes(n) ? "a held-out security ticket" : "a random built ticket";

// ---------------------------------------------------------------- field rows

if (STEP === "field") {
	if (solPools !== undefined)
		for (const [name, ns] of [
			["a random built ticket", RANDOM],
			["a held-out security ticket", SECURE],
		] as const)
			fieldRows({
				pools: {
					p: Object.fromEntries(Object.entries(solPools.p).filter(([n]) => ns.includes(Number(n)))),
					d: {},
				},
				effort: EFFORT,
				date: "2026-10-27",
				note: "2026-10-27-03",
				what: {
					p: `experiment 162: ${name}, 92b's "both" brief plus 161's "a security gap is not hardening"`,
					d: "",
				},
				pTruth: (n) => nextFor(Number(n)),
			});
	for (const [n, runs] of Object.entries(opus.p))
		runs.forEach((r, i) => {
			const said = r.answer === null ? null : saidOf(r.answer.sort);
			console.log(
				JSON.stringify({
					date: "2026-10-27",
					lane: `${REPO}#${n}`,
					role: "triager",
					model: r.model,
					effort: null,
					outcome: r.answer === null ? "stopped" : "pass",
					why: `experiment 162: ${setOf(Number(n))}, 92b's "both" brief on the first title and body, no tools, as 135 ran opus (run ${i + 1}); said ${said}, really ${nextFor(Number(n))}; posted nothing`,
					tokens: r.tokens,
					tools: null,
					minutes: +(r.ms / 60000).toFixed(2),
					note: "2026-10-27-03",
					driver_caused: false,
					costUsd: +r.usd.toFixed(4),
					billed: r.tokens,
					replay: true,
					name: said,
				}),
			);
		});
	process.exit(0);
}

if (STEP !== "tables") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- tables

/** Wilson's 95% interval for k of n, as percents. Pure. */
function wilson(k: number, n: number): [number, number] {
	if (n === 0) return [0, 100];
	const z = 1.96;
	const p = k / n;
	const mid = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
	const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
	return [Math.max(0, mid - half) * 100, Math.min(1, mid + half) * 100];
}
const range = (k: number, n: number) => {
	const [lo, hi] = wilson(k, n);
	return `${k}/${n} (${((100 * k) / Math.max(n, 1)).toFixed(0)}%, 95% ${lo.toFixed(0)} to ${hi.toFixed(0)}%)`;
};

const closes = (s: Said | null) => s === "no" || s === "dup";
type Col = {id: string; runs: (n: number) => readonly PAnswered[]};
const cols: Col[] = [
	{id: "GPT sol + security line", runs: (n) => solPools?.p[n] ?? []},
	{id: "opus (135's way)", runs: (n) => opus.p[n] ?? []},
];
const solRuns = Object.values(solPools?.p ?? {}).flat();
if (solRuns.length > 0)
	console.log(
		`${SOL} [${[...new Set(solRuns.map((r) => r.model))].join(", ")}, ${EFFORT}]: ${solRuns.length} sorts; median ${(median(solRuns.map((r) => r.ms)) / 1000).toFixed(1)} s a sort, slowest ${(Math.max(...solRuns.map((r) => r.ms)) / 1000).toFixed(1)} s; median ${median(solRuns.map((r) => r.tokens.input))} input (${median(solRuns.map((r) => r.tokens.cached))} cached) and ${median(solRuns.map((r) => r.tokens.output))} output tokens a sort, ${solRuns.reduce((s, r) => s + r.tokens.input + r.tokens.output, 0)} in all; ${solRuns.filter((r) => r.tools > 0).length} ran a tool, ${solRuns.filter((r) => r.answer === null).length} with no answer`,
	);
const opusRuns = Object.values(opus.p).flat();
if (opusRuns.length > 0)
	console.log(
		`opus [${[...new Set(opusRuns.map((r) => r.model))].join(", ")}]: ${opusRuns.length} sorts, $${opusSpent().toFixed(2)}; median ${(median(opusRuns.map((r) => r.ms)) / 1000).toFixed(1)} s and ${median(opusRuns.map((r) => r.tokens))} tokens a sort, ${opusRuns.reduce((s, r) => s + r.tokens, 0)} in all; first sorts $${median(Object.values(opus.p).flatMap((rs) => (rs[0] === undefined ? [] : [rs[0].usd]))).toFixed(3)} median, ${opusRuns.filter((r) => r.answer === null).length} with no answer`,
	);

const why = (r: PAnswered) =>
	r.answer === null
		? "no answer"
		: `${r.answer.sort.answer === "no" ? `${r.answer.sort.reason}. ` : ""}${r.answer.sort.why}`;
const labelOf = (n: number) =>
	truth.tickets[n]?.label ?? truth.security?.tickets[n]?.label ?? "none";

/** One set's numbers for both models, then every ticket, with the whys where the models differ. */
function printSet(name: string, ns: readonly number[]): void {
	console.log(`\n================ ${name} (${ns.length} tickets)`);
	for (const c of cols) {
		const answers = ns.flatMap((n) => c.runs(n).map((r) => ({n, s: pSaid(r)})));
		const tickets = ns.filter((n) => c.runs(n).length > 0);
		const wrong = answers.filter((a) => closes(a.s)).length;
		const wrongTickets = tickets.filter((n) => c.runs(n).some((r) => closes(pSaid(r)))).length;
		const route = answers.filter((a) => a.s === nextFor(a.n)).length;
		const same = tickets.filter((n) => {
			const ws = c.runs(n).map(pSaid);
			return ws.length > 1 && ws.every((w) => w === ws[0]);
		}).length;
		console.log(c.id);
		console.log(`  wrong close (no or dup), answers: ${range(wrong, answers.length)}`);
		console.log(
			`  wrong close, tickets closed at least once: ${range(wrongTickets, tickets.length)}`,
		);
		console.log(`  route right, answers: ${range(route, answers.length)}`);
		console.log(`  same answer both runs: ${same}/${tickets.length} tickets`);
		const by: Record<string, number> = {};
		for (const a of answers) by[a.s ?? "none"] = (by[a.s ?? "none"] ?? 0) + 1;
		console.log(`  answers: ${JSON.stringify(by)}`);
	}
	// Agreement: every sol answer against every opus answer on the same ticket.
	const both = ns.filter((n) => cols.every((c) => c.runs(n).length > 0));
	let pairs = 0;
	let agree = 0;
	for (const n of both)
		for (const a of cols[0]?.runs(n) ?? [])
			for (const b of cols[1]?.runs(n) ?? []) {
				pairs += 1;
				if (pSaid(a) === pSaid(b)) agree += 1;
			}
	const allSame = both.filter((n) => {
		const ws = cols.flatMap((c) => c.runs(n).map(pSaid));
		return ws.every((w) => w === ws[0]);
	});
	console.log(
		`agreement: ${agree}/${pairs} answer pairs (${((100 * agree) / Math.max(pairs, 1)).toFixed(0)}%); all four answers the same on ${allSame.length}/${both.length} tickets`,
	);
	console.log("every ticket (* a close, or a route that is not the key's; > the models differ):");
	for (const n of ns) {
		const cells = cols.map(
			(c) =>
				`${c.id}: ${
					c
						.runs(n)
						.map((r) => `${pSaid(r) ?? "none"}${pSaid(r) === nextFor(n) ? "" : "*"}`)
						.join(",") || "-"
				}`,
		);
		const differ = both.includes(n) && !allSame.includes(n);
		console.log(
			`${differ ? ">" : " "} #${n} ${labelOf(n)}, really ${nextFor(n)}: ${cells.join("  ")}`,
		);
		if (process.env.WHY === "1" || differ)
			for (const c of cols) for (const r of c.runs(n)) console.log(`    ${c.id}: ${why(r)}`);
	}
}
printSet("random built", RANDOM);
if (SECURE.length > 0) printSet("held-out security", SECURE);
