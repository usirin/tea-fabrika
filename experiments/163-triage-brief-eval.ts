// Experiment 163: the triage brief, made the tested way. Part 1: the labelled set, its split, the
// scorer, brief v1, a proposed pass bar, and a smoke run on 5 open cases. The locked half is not run.
//
// Each step of the future brief-lab program is its own STEP here, with its own input and output file:
//
//   STEP=set      the labelled set     in: 92b-truth.json, 162-truth.json   out: 163-set.json
//   STEP=split    the open and locked halves, seed 163, per kind
//                                      in: 163-set.json                     out: 163-split.json
//   STEP=bar      the owner's pass bar, checked and printed
//                                      in: 163-bar.json (written by hand, `proposed` until approved)
//   STEP=brief    a brief, checked and printed with its rules and hash
//                                      in: 163-briefs/<id>.md (BRIEF=triage-v1)
//   STEP=tune     the brief on the open half          in: the above    out: results/163-triage-brief-eval.json
//   STEP=lock     the brief once on the locked half; refuses unless 163-bar.json is approved
//   STEP=decide   the locked numbers against the bar  in: the results and the bar
//
// and around them:
//
//   STEP=fetch    every case's first title and body, and phoenix's issue list, through `gh`
//                 (read-only), into CACHE (default runs/exp-163-cache, never committed)
//   STEP=selftest the scorer on a fake Sorter: no model, no network, $0
//   STEP=report   the numbers of every brief, model and half run so far (the default)
//   STEP=field    one field/runs.jsonl row per answer
//
// tune and lock: MODEL=opus|sol, BRIEF (default triage-v1), RUNS (default 2), CONCURRENCY (default
// 2), ONLY=<case id,case id>, SMOKE=1 (one open case of each of 5 kinds), DRY=1 prints the estimate,
// MAX_USD (default 2) stops opus once its spend in the results file reaches it.
//
// Node at the edge, said out loud: `node:fs` for the data and cache files, as 162 does.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {Effect, Schema} from "effect";
import {
	type Answer,
	Bar,
	type Brief,
	briefOf,
	type Case,
	fakeSorter,
	type Half,
	KINDS,
	type Kind,
	LabelledSet,
	Model,
	RunRecord,
	Split,
	type Summary,
	score,
	splitOf,
	summarize,
	verdictOf,
} from "./lib/brief-eval.ts";
import {casePrompt, liveSorter, type World} from "./lib/brief-eval-live.ts";
import {allIssues, Cache, firstVersion, Truth} from "./lib/sort.ts";
import {P_CAUGHT, P_FALSE_NO, P_KIND, PHOENIX_NOTE, truth92b} from "./lib/triage-135.ts";

const here = import.meta.dirname;
const STEP = process.env.STEP ?? "report";
const REPO = "kamp-us/phoenix";
const SEED = 163;
const SET_FILE = join(here, "163-set.json");
const SPLIT_FILE = join(here, "163-split.json");
const BAR_FILE = join(here, "163-bar.json");
const BRIEFS = join(here, "163-briefs");
const RESULTS = join(here, "results", "163-triage-brief-eval.json");
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-163-cache");
const CACHE_FILE = join(CACHE, "p.json");

const readJson = <T>(file: string, schema: Schema.Codec<T, unknown>): T =>
	Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(file, "utf8")));
const writeJson = (file: string, value: unknown) =>
	writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);

// ---------------------------------------------------------------- step 1: the labelled set

if (STEP === "set") {
	const id = (n: number) => `${REPO}#${n}`;
	const kindOf92b = (n: number, next: string): Kind =>
		next === "dup"
			? "duplicate"
			: next === "no"
				? Object.values(P_KIND)
						.flat()
						.includes(n as never)
					? "hard-no"
					: "easy-no"
				: P_FALSE_NO.includes(n)
					? "hard-yes"
					: "built";
	const missedHow = (n: number) =>
		(P_KIND.text as readonly number[]).includes(n)
			? "the text shows it"
			: (P_KIND.line as readonly number[]).includes(n)
				? "a line the bar did not draw"
				: "needs the code";
	const from92b: Case[] = Object.entries(truth92b).map(([key, e]) => {
		const n = Number(key);
		const kind = kindOf92b(n, e.next);
		const extra =
			kind === "hard-no"
				? `; 92b's brief missed it at least once (${missedHow(n)})`
				: kind === "easy-no"
					? "; 92b's brief closed it in both runs"
					: kind === "hard-yes"
						? "; 92b's brief closed it at least once"
						: "";
		return {
			id: id(n),
			repo: REPO,
			n,
			source: "92b-truth.json",
			kind,
			right: e.next === "no" || e.next === "dup" ? "close" : "keep",
			of: e.dupOf ?? null,
			why: `${e.why}${extra}`,
		};
	});
	const t162 = Schema.decodeUnknownSync(
		Schema.Struct({
			tickets: Truth.fields.tickets,
			security: Schema.Struct({tickets: Truth.fields.tickets}),
		}),
		{onExcessProperty: "ignore"},
	)(JSON.parse(readFileSync(join(here, "162-truth.json"), "utf8")));
	const from162 = (tickets: typeof t162.tickets, kind: Kind): Case[] =>
		Object.entries(tickets).map(([key, e]) => ({
			id: id(Number(key)),
			repo: REPO,
			n: Number(key),
			source: "162-truth.json",
			kind,
			right: "keep",
			of: null,
			why: e.why,
		}));
	const cases = [
		...from92b,
		...from162(t162.tickets, "built-random"),
		...from162(t162.security.tickets, "security"),
	].toSorted((a, b) => a.n - b.n);
	if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error("a case is twice");
	if (P_CAUGHT.some((n) => kindOf92b(n, "no") !== "easy-no")) throw new Error("92b's caught no's");
	const set: LabelledSet = {
		note: "Experiment 163. Every labelled triage case on kamp-us/phoenix, as one set. The yes-or-no question: does triage close the ticket (a no or a duplicate) or keep it? `right` is what really happened, from the source file, read before any answer of this experiment. 92b's 29 hard no's are the tickets 92b's brief missed at least once (135, 159 and 161 ran each twice: the '58 hard no's' are 58 answers on these 29). `hard-yes` is 135's 5 built tickets 92b's brief closed; `built` the rest of 92b's yes side.",
		left: [
			{
				source: "88-truth.json and 92-truth.json (kamp-us/demlik, 45 tickets)",
				why: "another repo with another bar: its no's are 'already fixed on main', 'the target was removed', 'a settled no asked again', which brief v1 has no rule for and which need the code. They want a demlik brief and a demlik set of their own, not a share of this one.",
			},
			{
				source: "133-truth.json `fold` (13) and `control` (13), kamp-us/demlik",
				why: "a fold's right answer is neither close nor keep: the work is real and lands in another open ticket's plan. A yes-or-no answer cannot be scored right or wrong on it. The controls are keeps, but only there to test folds, and they are demlik's.",
			},
			{
				source: "133-truth.json `needsInfo` (15)",
				why: "the right answer is a third outcome, asking the filer, which this question does not have.",
			},
		],
		cases,
	};
	writeJson(SET_FILE, Schema.encodeSync(LabelledSet)(set));
	const by = Object.fromEntries(KINDS.map((k) => [k, cases.filter((c) => c.kind === k).length]));
	console.log(`${cases.length} cases: ${JSON.stringify(by)}`);
	process.exit(0);
}

const set = readJson(SET_FILE, LabelledSet);

// ---------------------------------------------------------------- step 1b: the split

if (STEP === "split") {
	if (existsSync(SPLIT_FILE)) {
		console.error(`${SPLIT_FILE} exists: the split is made once`);
		process.exit(1);
	}
	const split = splitOf(
		set,
		SEED,
		"Experiment 163. Each kind shuffled with seed 163 (`shuffled`, the seeded shuffle 135 and 162 used), its first half rounded down open, the rest locked. Tune on the open half as often as needed; the locked half is scored once, after the owner approves the bar.",
	);
	writeJson(SPLIT_FILE, split);
	process.exit(0);
}

const split = readJson(SPLIT_FILE, Split);
const halfOf = (id: string): Half => (split.locked.includes(id) ? "locked" : "open");
const casesOf = (half: Half) => set.cases.filter((c) => halfOf(c.id) === half);

// ---------------------------------------------------------------- around: fetch

if (STEP === "fetch") {
	mkdirSync(CACHE, {recursive: true});
	const tickets = [];
	for (const c of set.cases) tickets.push(await firstVersion(c.n, REPO));
	const all = await allIssues(REPO, 20_000);
	writeFileSync(CACHE_FILE, JSON.stringify({tickets, all}, null, "\t"));
	console.log(`${REPO}: ${tickets.length} tickets, ${all.length} issues listed`);
	process.exit(0);
}

// ---------------------------------------------------------------- step 2: the bar

const bar = readJson(BAR_FILE, Bar);
const BRIEF_ID = process.env.BRIEF ?? "triage-v1";
const brief: Brief = briefOf(readFileSync(join(BRIEFS, `${BRIEF_ID}.md`), "utf8"));

if (STEP === "bar") {
	console.log(
		`bar: ${bar.status}${bar.approved === null ? "" : `, by ${bar.approved.by} on ${bar.approved.on}`}`,
	);
	const built = casesOf("locked").filter((c) => c.right === "keep");
	const sizes: Record<string, number> = {
		badClose: built.length,
		securityClosed: built.filter((c) => c.kind === "security").length,
		hardNoClosed: casesOf("locked").filter((c) => c.kind === "hard-no").length * 2,
		agreement: casesOf("locked").length,
	};
	for (const l of bar.lines) {
		const n = sizes[l.metric];
		const allowed =
			n === undefined
				? ""
				: l.is === "max"
					? ` (on the locked half: at most ${Math.floor(l.value * n + 1e-9)} of ${n})`
					: ` (on the locked half: at least ${Math.ceil(l.value * n - 1e-9)} of ${n})`;
		console.log(`- ${l.metric} ${l.is} ${(100 * l.value).toFixed(0)}%${allowed}: ${l.why}`);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- step 3: the brief

if (STEP === "brief") {
	console.log(
		`${brief.id} (${brief.hash}): rules ${brief.rules.join(", ")}; ${brief.text.split(/\s+/).length} words`,
	);
	console.log(brief.text);
	process.exit(0);
}

// ---------------------------------------------------------------- the results

const Results = Schema.Struct({records: Schema.Array(RunRecord)});
const records: RunRecord[] = existsSync(RESULTS) ? [...readJson(RESULTS, Results).records] : [];
const save = () => writeJson(RESULTS, {records});
/** No long dash (U+2014) reaches the public file: a model's `why` sometimes has one. */
const LONG_DASH = String.fromCodePoint(0x2014);
const plain = (r: RunRecord): RunRecord =>
	r.why === null ? r : {...r, why: r.why.replaceAll(LONG_DASH, ":")};

// ---------------------------------------------------------------- around: the self-test, $0

if (STEP === "selftest") {
	const open = casesOf("open");
	const builtOne = open.find((c) => c.kind === "built-random") as Case;
	const securityOne = open.find((c) => c.kind === "security") as Case;
	const hardOne = open.find((c) => c.kind === "hard-no") as Case;
	// Right on every open case but three: one built and one security ticket closed, one hard no kept.
	const answers: Record<string, Answer["triage"]> = Object.fromEntries(
		open.map((c) => {
			const wrong = [builtOne.id, securityOne.id, hardOne.id].includes(c.id);
			const close = (c.right === "close") !== wrong;
			return [
				c.id,
				close
					? {answer: "close", rule: brief.rules[0] ?? "", of: null, why: "fake"}
					: {answer: "keep", why: "fake"},
			];
		}),
	);
	const got = await Effect.runPromise(
		score({
			brief,
			model: "opus",
			cases: open,
			half: "open",
			runs: 2,
			have: [],
			concurrency: 4,
			kept: () => Effect.void,
			stop: () => false,
		}).pipe(Effect.provide(fakeSorter(answers))),
	);
	const s = summarize(open, got);
	const keep = open.filter((c) => c.right === "keep").length;
	const hard = open.filter((c) => c.kind === "hard-no").length;
	const expect: [string, boolean][] = [
		["two answers a case", got.length === 2 * open.length],
		["bad closes are 2 tickets", s.badClose.k === 2 && s.badClose.n === keep],
		["one security ticket closed", s.securityClosed.k === 1],
		["hard no's closed: all but one ticket's two answers", s.hardNoClosed.k === 2 * hard - 2],
		["one missed no", s.missedNo.k === 1],
		["every ticket the same both runs", s.agreement.k === open.length],
		["no dollars", s.usd === 0],
		["each record decodes", got.every((r) => Schema.is(RunRecord)(r))],
		["the interval holds the share", s.badClose.lo <= 2 / keep && 2 / keep <= s.badClose.hi],
	];
	for (const [what, ok] of expect) console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
	process.exit(expect.every(([, ok]) => ok) ? 0 : 1);
}

// ---------------------------------------------------------------- steps 4 and 5: tune and lock

const opusSpent = () =>
	records.filter((r) => r.model === "opus").reduce((s, r) => s + (r.usd ?? 0), 0);
/** Five open cases, one of each of these kinds, the first of each in the split's order. */
const SMOKE_KINDS: readonly Kind[] = [
	"hard-no",
	"duplicate",
	"hard-yes",
	"built-random",
	"security",
];

if (STEP === "tune" || STEP === "lock") {
	const half: Half = STEP === "tune" ? "open" : "locked";
	if (half === "locked" && bar.status !== "approved") {
		console.error("the bar is not approved: the locked half stays shut");
		process.exit(1);
	}
	if (
		half === "locked" &&
		records.some((r) => r.half === "locked" && r.brief === brief.id && r.hash === brief.hash)
	) {
		console.error(`${brief.id} (${brief.hash}) already ran on the locked half: it is scored once`);
		process.exit(1);
	}
	const model = Schema.decodeUnknownSync(Model)(process.env.MODEL);
	const only = process.env.ONLY?.split(",");
	const ids = half === "open" ? split.open : split.locked;
	const smoke = SMOKE_KINDS.flatMap((k) => {
		const c = ids.find((id) => set.cases.find((x) => x.id === id)?.kind === k);
		return c === undefined ? [] : [c];
	});
	const wanted =
		process.env.SMOKE === "1"
			? smoke
			: only !== undefined
				? ids.filter((id) => only.includes(id))
				: ids;
	const cases = wanted.map((id) => set.cases.find((c) => c.id === id) as Case);
	const cache = readJson(CACHE_FILE, Cache);
	const world: World = {tickets: cache.tickets, all: cache.all, notes: {[REPO]: PHOENIX_NOTE}};
	const runs = Number(process.env.RUNS ?? 2);
	const MAX_USD = Number(process.env.MAX_USD ?? 2);
	// 162's estimate for opus: a first call writes the prompt to the cache at twice the input price, a
	// later one reads it; 4 characters a token, the SDK's own 4,500, 1,000 output.
	const price = {in: 4e-6, out: 20e-6, read: 0.2e-6};
	const estimate = cases.reduce((s, c) => {
		const tokens = (brief.text.length + casePrompt(world, c).length) / 4 + 4500;
		return s + tokens * price.in * 2 + (runs - 1) * tokens * price.read + runs * 1000 * price.out;
	}, 0);
	console.log(
		`${brief.id} (${brief.hash}) on ${model}, ${half} half: ${cases.length} cases x ${runs}${model === "opus" ? `, about $${estimate.toFixed(2)} at list price; opus spent here so far $${opusSpent().toFixed(2)}, cap $${MAX_USD}` : ", on the ChatGPT plan"}`,
	);
	if (process.env.DRY === "1") process.exit(0);
	const got = await Effect.runPromise(
		score({
			brief,
			model,
			cases,
			half,
			runs,
			have: records,
			concurrency: Number(process.env.CONCURRENCY ?? 2),
			kept: (r) =>
				Effect.sync(() => {
					records.push(plain(r));
					save();
					console.log(
						`${r.case} ${r.said ?? r.error ?? "none"}${r.rule === null ? "" : `:${r.rule}`}${r.right === false ? " (wrong)" : ""} ${(r.ms / 1000).toFixed(1)} s${r.usd === null ? "" : `, $${r.usd.toFixed(4)}`}`,
					);
				}),
			stop: () => model === "opus" && opusSpent() >= MAX_USD,
		}).pipe(Effect.provide(liveSorter(world)), Effect.scoped),
	);
	console.log(`${got.length} answers; opus spent here $${opusSpent().toFixed(2)}`);
	process.exit(0);
}

// ---------------------------------------------------------------- around: field rows

if (STEP === "field") {
	for (const r of records)
		console.log(
			JSON.stringify({
				date: r.at.slice(0, 10),
				lane: r.case,
				role: "triager",
				model: r.modelId,
				effort: r.model === "sol" ? "medium" : null,
				outcome: r.said === null ? "stopped" : "pass",
				why: `experiment 163: brief ${r.brief} (${r.hash}) on the ${r.half} half, first title and body, no tools (run ${r.run}); said ${r.said}${r.rule === null ? "" : ` (${r.rule})`}, really ${set.cases.find((c) => c.id === r.case)?.right}; posted nothing`,
				tokens: r.tokens.input + r.tokens.output,
				tools: null,
				minutes: +(r.ms / 60000).toFixed(2),
				note: null,
				driver_caused: false,
				costUsd: r.usd === null ? null : +r.usd.toFixed(4),
				billed: r.tokens.input + r.tokens.output,
				replay: true,
				name: r.said === "close" ? `close:${r.rule}` : r.said,
			}),
		);
	process.exit(0);
}

// ---------------------------------------------------------------- step 6 and the report

const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const line = (name: string, c: Summary["badClose"]) =>
	`  ${name}: ${c.k}/${c.n}${c.n === 0 ? "" : ` (${pct(c.k / c.n)}, 95% ${pct(c.lo)} to ${pct(c.hi)})`}`;
function printSummary(s: Summary): void {
	console.log(line("bad closes, built tickets closed at least once", s.badClose));
	console.log(line("bad closes, answers", s.badCloseAnswers));
	console.log(line("security tickets closed at least once", s.securityClosed));
	console.log(line("hard no's closed, answers", s.hardNoClosed));
	console.log(line("all no's and duplicates closed, answers", s.noClosed));
	console.log(line("missed no's, tickets kept at least once", s.missedNo));
	console.log(line("agreement, tickets with the same verdict every run", s.agreement));
	console.log(`  no answer: ${s.none}; $${s.usd.toFixed(2)}`);
}
const groups = [...new Set(records.map((r) => `${r.brief}|${r.hash}|${r.model}|${r.half}`))];

if (STEP === "decide") {
	const locked = groups.filter((g) => g.endsWith("|locked"));
	if (locked.length === 0) {
		console.error("no locked-half run yet: STEP=lock first");
		process.exit(1);
	}
	for (const g of locked) {
		const [b, h, m] = g.split("|");
		const rs = records.filter(
			(r) => r.brief === b && r.hash === h && r.model === m && r.half === "locked",
		);
		const v = verdictOf(bar, summarize(casesOf("locked"), rs));
		console.log(`${b} (${h}) on ${m}: ${v.every((x) => x.pass) ? "PASS" : "FAIL"}`);
		for (const x of v)
			console.log(
				`  ${x.pass ? "pass" : "FAIL"} ${x.metric} ${pct(x.share)} (${x.is} ${pct(x.value)})`,
			);
	}
	process.exit(0);
}

if (STEP !== "report") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}
const count = (half: Half, kind: Kind) => casesOf(half).filter((c) => c.kind === kind).length;
console.log(`${set.cases.length} cases; open ${split.open.length}, locked ${split.locked.length}`);
for (const k of KINDS)
	console.log(`  ${k}: ${count("open", k)} open, ${count("locked", k)} locked`);
for (const g of groups) {
	const [b, h, m, half] = g.split("|") as [string, string, string, Half];
	const rs = records.filter(
		(r) => r.brief === b && r.hash === h && r.model === m && r.half === half,
	);
	const ran = casesOf(half).filter((c) => rs.some((r) => r.case === c.id));
	console.log(`\n${b} (${h}) on ${m}, ${half} half, ${ran.length} cases, ${rs.length} answers`);
	printSummary(summarize(ran, rs));
	for (const c of ran)
		console.log(
			`  ${c.id} ${c.kind}, really ${c.right}: ${rs
				.filter((r) => r.case === c.id)
				.map(
					(r) =>
						`${r.said ?? "none"}${r.rule === null ? "" : `:${r.rule}`}${r.right === false ? "*" : ""}`,
				)
				.join(", ")}`,
		);
	if (process.env.WHY === "1")
		for (const r of rs) console.log(`    ${r.case} run ${r.run}: ${r.why ?? r.error}`);
}
