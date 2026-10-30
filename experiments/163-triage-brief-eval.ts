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
// Part 3: a brief may read the code (`code: read` in its head), at the commit on main before the
// ticket was filed.
//
//   STEP=trees    the commit of every case, from a clone of phoenix at CLONE (read, never pushed)
//   STEP=tune ALL=1  the brief on all 119 cases: the locked half was read in part 2, so it is spent.
//                 For a brief that reads code, MAX_USD caps part 3's whole opus spend, exam included
//   STEP=probe    one GPT sol turn in a code copy: the brief arrives, and the folder stays read-only
//   STEP=exam     FRESH=<labelled set file>: one brief on one model, once, against 163-exam-bar.json
//                 (EXAM_BAR); answers in results/163-exam.json. Refuses a second exam of a brief
//                 hash and model on any set; a stopped exam goes on, on its own set only
//   STEP=examtest the exam step on a tiny made-up set, through the real command with FAKE=1: $0
//
// Node at the edge, said out loud: `node:fs` for the data and cache files, as 162 does;
// `node:child_process` for `git` on the clone and to run this script in the exam test.
import {execFileSync} from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Schema} from "effect";
import {
	type Answer,
	Bar,
	type Brief,
	briefOf,
	type Case,
	ExamBook,
	exam,
	examGate,
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
	setHashOf,
	splitOf,
	summarize,
	verdictOf,
} from "./lib/brief-eval.ts";
import {
	casePrompt,
	codeLine,
	liveSorter,
	READ_USD,
	treePool,
	type World,
} from "./lib/brief-eval-live.ts";
import {allIssues, Cache, firstVersion, Truth} from "./lib/sort.ts";
import {P_CAUGHT, P_FALSE_NO, P_KIND, PHOENIX_NOTE, truth92b} from "./lib/triage-135.ts";
import {codexTurn} from "./lib/triage-codex.ts";

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
/** Part 3: a clone of phoenix (read, never pushed), the commit of each case, and the code copies. */
const CLONE = process.env.CLONE ?? join(CACHE, "phoenix");
const AT_FILE = join(CACHE, "at.json");
/**
 * The code copies live outside home: Codex's box denies home, and Codex looks for AGENTS.md in the
 * folders above its own, so a copy under this repo would hand it this repo's rules (field note).
 */
const TREES = process.env.TREES ?? join(realpathSync(tmpdir()), "exp-163-trees");
/**
 * Taken out of every code copy. Phoenix's own triage skill and triager: the brief being replaced,
 * which a model could follow in place of the one under test. Its top AGENTS.md and CLAUDE.md:
 * Codex loads AGENTS.md as rules on its own and the Agent SDK here loads none, so both get neither.
 */
const LEFT = [
	"claude-plugins/fabrika/skills/triage",
	"claude-plugins/fabrika/agents/triager.md",
	"AGENTS.md",
	"CLAUDE.md",
];
const EXAM_FILE = join(here, "results", "163-exam.json");
const EXAM_BAR = process.env.EXAM_BAR ?? join(here, "163-exam-bar.json");

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

// ---------------------------------------------------------------- around: trees (part 3)

const AtFile = Schema.Record(Schema.String, Schema.String);
const atMap = (): Record<string, string> =>
	existsSync(AT_FILE) ? {...readJson(AT_FILE, AtFile)} : {};
/** The last commit on phoenix's main before a moment, from the clone. Reads only. */
const mainAt = (moment: string) =>
	execFileSync(
		"git",
		["-C", CLONE, "rev-list", "-1", "--first-parent", `--before=${moment}`, "origin/main"],
		{encoding: "utf8"},
	).trim();
/** Every ticket in the cache gets the commit it was filed against, kept in AT_FILE. */
const fillAt = (tickets: readonly {n: number; createdAt: string}[]) => {
	const at = atMap();
	for (const t of tickets) {
		if (at[t.n] !== undefined) continue;
		const sha = mainAt(t.createdAt);
		if (sha === "") throw new Error(`no commit on main before #${t.n}`);
		at[t.n] = sha;
	}
	writeJson(AT_FILE, at);
	return at;
};

if (STEP === "trees") {
	if (!existsSync(join(CLONE, ".git"))) {
		console.error(`no clone at ${CLONE}: gh repo clone ${REPO} <CLONE> -- --no-checkout`);
		process.exit(1);
	}
	execFileSync("git", ["-C", CLONE, "fetch", "--quiet", "origin", "main"]);
	const cache = readJson(CACHE_FILE, Cache);
	const at = fillAt(cache.tickets);
	console.log(
		`${Object.keys(at).length} tickets, ${new Set(Object.values(at)).size} commits, in ${AT_FILE}`,
	);
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

let book: ExamBook = existsSync(EXAM_FILE)
	? readJson(EXAM_FILE, ExamBook)
	: {entries: [], records: []};
const usdOf = (rs: readonly RunRecord[]) =>
	rs.filter((r) => r.model === "opus").reduce((s, r) => s + (r.usd ?? 0), 0);
/** Part 3's opus spend, its cap's measure: every answer of a brief that reads code, and the exam. */
const part3Spent = () => usdOf(records.filter((r) => r.code !== undefined)) + usdOf(book.records);

/** The live world: the cache, and a code copy per case for a brief that reads code. */
const worldOf = (cache: typeof Cache.Type, at: Record<string, string>): World => ({
	tickets: cache.tickets,
	all: cache.all,
	notes: {[REPO]: PHOENIX_NOTE},
	tree: treePool({
		clone: CLONE,
		root: TREES,
		atOf: (c) => at[c.n],
		keep: Number(process.env.KEEP_TREES ?? 6),
		left: LEFT,
	}),
});

/**
 * Opus's dollars for `calls` calls. With no code, 162's estimate: a first call writes the prompt to
 * the cache at twice the input price, a later one reads it; 4 characters a token, the SDK's own
 * 4,500, 1,000 output. With code, the mean of the read-code calls made so far, or GUESS_USD before
 * there are any.
 */
function estimateOf(
	b: Brief,
	world: World,
	cases: readonly Case[],
	runs: number,
	calls: number,
): number {
	if (b.code === "read") {
		const made = [...records, ...book.records].filter(
			(r) => r.model === "opus" && r.code !== undefined && r.usd !== null,
		);
		const each =
			made.length === 0
				? Number(process.env.GUESS_USD ?? 0.2)
				: made.reduce((s, r) => s + (r.usd ?? 0), 0) / made.length;
		return calls * each;
	}
	const price = {in: 4e-6, out: 20e-6, read: 0.2e-6};
	return cases.reduce((s, c) => {
		const tokens = (b.text.length + casePrompt(world, c).length) / 4 + 4500;
		return s + tokens * price.in * 2 + (runs - 1) * tokens * price.read + runs * 1000 * price.out;
	}, 0);
}

const lineOf = (r: RunRecord) =>
	`${r.case} ${r.said ?? r.error ?? "none"}${r.rule === null ? "" : `:${r.rule}`}${r.right === false ? " (wrong)" : ""} ${(r.ms / 1000).toFixed(1)} s${r.code === undefined ? "" : `, ${r.code.reads} reads`}${r.usd === null ? "" : `, $${r.usd.toFixed(4)}`}`;
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
	// Part 3 tunes on all 119 cases (ALL=1): the locked half was read in part 2, so it is spent.
	const all = STEP === "tune" && process.env.ALL === "1";
	const ids = all ? [...split.open, ...split.locked] : half === "open" ? split.open : split.locked;
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
	const world = worldOf(readJson(CACHE_FILE, Cache), atMap());
	const runs = Number(process.env.RUNS ?? 2);
	const MAX_USD = Number(process.env.MAX_USD ?? 2);
	const spent = brief.code === "read" ? part3Spent : opusSpent;
	const held = (c: Case) =>
		records.filter(
			(r) => r.case === c.id && r.brief === brief.id && r.hash === brief.hash && r.model === model,
		).length;
	const calls = cases.reduce((s, c) => s + Math.max(0, runs - held(c)), 0);
	console.log(
		`${brief.id} (${brief.hash}) on ${model}, ${all ? "all" : half}: ${cases.length} cases x ${runs}, ${calls} calls to make${model === "opus" ? `, about $${estimateOf(brief, world, cases, runs, calls).toFixed(2)} at list price; spent so far $${spent().toFixed(2)}, cap $${MAX_USD}` : ", on the ChatGPT plan"}`,
	);
	if (process.env.DRY === "1") process.exit(0);
	const concurrency = Number(process.env.CONCURRENCY ?? 2);
	const halves: readonly Half[] = all ? ["open", "locked"] : [half];
	let got = 0;
	for (const h of halves) {
		const mine = cases.filter((c) => !all || halfOf(c.id) === h);
		const out = await Effect.runPromise(
			score({
				brief,
				model,
				cases: mine,
				half: h,
				runs,
				have: records,
				concurrency,
				kept: (r) =>
					Effect.sync(() => {
						records.push(plain(r));
						save();
						console.log(lineOf(r));
					}),
				// Never start a call that could pass the cap.
				stop: () =>
					model === "opus" &&
					spent() + (brief.code === "read" ? READ_USD : 0) * concurrency >= MAX_USD,
			}).pipe(Effect.provide(liveSorter(world)), Effect.scoped),
		);
		got += out.length;
	}
	console.log(`${got} answers; spent $${spent().toFixed(2)}`);
	process.exit(0);
}

// ---------------------------------------------------------------- the exam (part 3)

/** A fake Sorter's answers for a set: right on every case but the first keep, which it closes. */
const fakeAnswersOf = (cases: readonly Case[]): Record<string, Answer["triage"]> => {
	const wrong = cases.find((c) => c.right === "keep")?.id;
	return Object.fromEntries(
		cases.map((c) => [
			c.id,
			(c.right === "close") !== (c.id === wrong)
				? {answer: "close", rule: brief.rules[0] ?? "", of: null, why: "fake"}
				: {answer: "keep", why: "fake"},
		]),
	);
};

if (STEP === "exam") {
	const fresh = process.env.FRESH;
	if (fresh === undefined) {
		console.error("FRESH=<path to the fresh labelled set> is needed");
		process.exit(1);
	}
	const examSet = readJson(fresh, LabelledSet);
	const examBar = readJson(EXAM_BAR, Bar);
	const model = Schema.decodeUnknownSync(Model)(process.env.MODEL);
	const fake = process.env.FAKE === "1";
	const examFile = process.env.EXAM_FILE ?? EXAM_FILE;
	const held: ExamBook = existsSync(examFile)
		? readJson(examFile, ExamBook)
		: {entries: [], records: []};
	const runs = Number(process.env.RUNS ?? 2);
	const setId = setHashOf(examSet);
	const gate = examGate(held, examBar, brief, model, setId);
	console.log(
		`exam: ${brief.id} (${brief.hash}) on ${model}, set ${setId} (${examSet.cases.length} cases x ${runs}): ${gate.go === "refuse" ? `refused: ${gate.why}` : gate.go}`,
	);
	if (gate.go === "refuse") process.exit(1);
	let world: World | null = null;
	if (!fake) {
		// The fresh cases' text, the issue list and their commits, read-only, into the cache.
		const cache = readJson(CACHE_FILE, Cache);
		const tickets = [...cache.tickets];
		for (const c of examSet.cases)
			if (!tickets.some((t) => t.n === c.n)) tickets.push(await firstVersion(c.n, REPO));
		const newest = Math.max(...examSet.cases.map((c) => c.n));
		const listed = cache.all.some((e) => e.n >= newest) ? cache.all : await allIssues(REPO, 20_000);
		writeFileSync(CACHE_FILE, JSON.stringify({tickets, all: listed}, null, "\t"));
		if (brief.code === "read") {
			execFileSync("git", ["-C", CLONE, "fetch", "--quiet", "origin", "main"]);
			fillAt(tickets.filter((t) => examSet.cases.some((c) => c.n === t.n)));
		}
		world = worldOf({tickets, all: listed}, atMap());
	}
	// The cap counts all of part 3's opus spend, tuning included: $25, the owner's cap.
	const MAX_USD = Number(process.env.MAX_USD ?? 25);
	const calls = examSet.cases.length * runs;
	if (model === "opus" && world !== null)
		console.log(
			`  about $${estimateOf(brief, world, examSet.cases, runs, calls).toFixed(2)} at list price; part 3 spent so far $${part3Spent().toFixed(2)}, cap $${MAX_USD}`,
		);
	if (process.env.DRY === "1") process.exit(0);
	const concurrency = Number(process.env.CONCURRENCY ?? 2);
	const got = await Effect.runPromise(
		exam({
			book: held,
			bar: examBar,
			brief,
			model,
			set: examSet,
			runs,
			concurrency,
			save: (b) =>
				Effect.sync(() => {
					const kept = {...b, records: b.records.map(plain)};
					if (!fake) book = kept;
					writeJson(examFile, Schema.encodeSync(ExamBook)(kept));
				}),
			stop: () =>
				!fake &&
				model === "opus" &&
				part3Spent() + (brief.code === "read" ? READ_USD : 0) * concurrency >= MAX_USD,
			now: () => new Date().toISOString(),
		}).pipe(
			Effect.provide(world === null ? fakeSorter(fakeAnswersOf(examSet.cases)) : liveSorter(world)),
			Effect.scoped,
		),
	);
	if (got.verdict === null) {
		console.log("  stopped before every case had its runs: run again to go on, on the same set");
		process.exit(2);
	}
	console.log(`  ${got.verdict.every((x) => x.pass) ? "PASS" : "FAIL"}`);
	for (const x of got.verdict)
		console.log(
			`  ${x.pass ? "pass" : "FAIL"} ${x.metric} ${(100 * x.share).toFixed(0)}% (${x.is} ${(100 * x.value).toFixed(0)}%)`,
		);
	if (got.summary !== null) printSummary(got.summary);
	process.exit(0);
}

if (STEP === "probe") {
	// One GPT sol turn in a code copy, built as a read-code case is: does the brief arrive, and does
	// the box keep the folder read-only? On the ChatGPT plan, no answer saved.
	const c = set.cases[0] as Case;
	const world = worldOf(readJson(CACHE_FILE, Cache), atMap());
	const Probe = Schema.Struct({
		ran: Schema.String,
		after: Schema.String,
		rules: Schema.Array(Schema.String),
		files: Schema.Number,
	});
	// The sentence after "Keep is the safe answer." in the brief: only a model that got the brief knows it.
	const after = (/Keep is the safe answer\. (\S+ \S+ \S+ \S+)/.exec(brief.text)?.[1] ?? "").trim();
	const got = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const tree = yield* (world.tree as NonNullable<World["tree"]>)(c);
				const r = yield* Effect.promise(() =>
					codexTurn(
						// The prompt as solOnce builds it, with the check after it.
						`${brief.text}\n\n${casePrompt(world, c)}\n\n${codeLine(tree)}\n\n# Before the real work: a check of your box\n\nDo not triage. Run this one command exactly, and copy what it prints into \`ran\`: \`chmod u+w . ; touch probe.txt ; echo exit=$?\`. Copy the sentence that follows "Keep is the safe answer." in your triage instructions into \`after\`, list the close rules they name in \`rules\`, and give what \`ls | wc -l\` counts in \`files\`.`,
						Probe,
						{name: "exp-163-probe", folder: tree.path, effort: "medium", reads: "code"},
					),
				);
				return {r, wrote: existsSync(join(tree.path, "probe.txt"))};
			}),
		),
	);
	console.log(
		JSON.stringify({answer: got.r.answer, error: got.r.error, commands: got.r.commands}, null, 2),
	);
	const checks: [string, boolean][] = [
		["the brief arrived", after !== "" && got.r.answer?.after.startsWith(after) === true],
		["its rules arrived", brief.rules.every((x) => got.r.answer?.rules.includes(x) === true)],
		["it ran the write", got.r.commands.some((x) => x.includes("touch probe.txt"))],
		["the folder stayed read-only", !got.wrote && /exit=[1-9]/.test(got.r.answer?.ran ?? "")],
		["it could read the folder", (got.r.answer?.files ?? 0) > 3],
	];
	for (const [what, ok] of checks) console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
	process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

if (STEP === "examtest") {
	// The exam step on a tiny made-up set, through the real command with FAKE=1, then the gate's
	// cases in process. No model, no network, $0. Nothing outside a temp folder is written.
	const dir = mkdtempSync(join(tmpdir(), "exp-163-examtest-"));
	const pick = (k: Kind) => set.cases.find((c) => c.kind === k) as Case;
	const tiny: LabelledSet = {
		note: "a made-up exam set for the test",
		left: [],
		cases: [pick("hard-no"), pick("duplicate"), pick("built-random"), pick("security")],
	};
	const other: LabelledSet = {...tiny, cases: [pick("easy-no"), pick("built")]};
	const approved: Bar = {...bar, status: "approved", approved: {by: "test", on: "2026-10-30"}};
	const files = {
		set: join(dir, "set.json"),
		other: join(dir, "other.json"),
		bar: join(dir, "bar.json"),
		proposed: join(dir, "proposed.json"),
		book: join(dir, "exam.json"),
	};
	writeJson(files.set, Schema.encodeSync(LabelledSet)(tiny));
	writeJson(files.other, Schema.encodeSync(LabelledSet)(other));
	writeJson(files.bar, approved);
	writeJson(files.proposed, {...approved, status: "proposed", approved: null});
	const cli = (env: Record<string, string>) => {
		try {
			const out = execFileSync(process.execPath, [join(here, "163-triage-brief-eval.ts")], {
				env: {...process.env, STEP: "exam", FAKE: "1", EXAM_FILE: files.book, ...env},
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return {code: 0, out};
		} catch (e) {
			const x = e as {status: number; stdout: string};
			return {code: x.status, out: x.stdout};
		}
	};
	const v = {BRIEF: BRIEF_ID, FRESH: files.set, EXAM_BAR: files.bar};
	const first = cli({...v, MODEL: "sol"});
	const again = cli({...v, MODEL: "sol"});
	const elsewhere = cli({...v, MODEL: "sol", FRESH: files.other});
	const opus = cli({...v, MODEL: "opus"});
	const unapproved = cli({...v, MODEL: "opus", EXAM_BAR: files.proposed, BRIEF: "triage-v1"});
	const kept = readJson(files.book, ExamBook);
	// In process: an exam stopped part way goes on on its own set only.
	const stopAfter = (n: number) => {
		let seen = 0;
		return () => seen++ >= n;
	};
	const job = {
		bar: approved,
		brief,
		model: "sol" as const,
		runs: 2,
		concurrency: 1,
		now: () => "2026-10-30T00:00:00Z",
	};
	const run = (b: ExamBook, s: LabelledSet, stop: () => boolean) => {
		let last = b;
		return Effect.runPromise(
			exam({
				...job,
				book: b,
				set: s,
				stop,
				save: (x) =>
					Effect.sync(() => {
						last = x;
					}),
			}).pipe(Effect.provide(fakeSorter(fakeAnswersOf(s.cases)))),
		).then((r) => ({r, book: last}));
	};
	const empty: ExamBook = {entries: [], records: []};
	const part = await run(empty, tiny, stopAfter(3));
	const onOther = await run(part.book, other, () => false);
	const rest = await run(part.book, tiny, () => false);
	const failing = await Effect.runPromise(
		exam({
			...job,
			book: empty,
			set: tiny,
			stop: () => false,
			save: () => Effect.void,
		}).pipe(Effect.provide(fakeSorter({}))),
	);
	const expect: [string, boolean][] = [
		["the first exam runs and scores", first.code === 0 && /FAIL|PASS/.test(first.out)],
		["the fake's one wrong close fails bad closes", /FAIL badClose/.test(first.out)],
		[
			"a second exam of the same brief and model is refused",
			again.code === 1 && /scored once/.test(again.out),
		],
		[
			"so is the same brief and model on another set",
			elsewhere.code === 1 && /scored once/.test(elsewhere.out),
		],
		["another model gets its own shot", opus.code === 0],
		[
			"an unapproved exam bar is refused",
			unapproved.code === 1 && /not approved/.test(unapproved.out),
		],
		[
			"the book holds two finished entries and every answer",
			kept.entries.length === 2 &&
				kept.entries.every((e) => e.done !== null) &&
				kept.records.length === 2 * 2 * tiny.cases.length,
		],
		["the book's records are exam records", kept.records.every((r) => r.half === "exam")],
		["a stopped exam gives no verdict", part.r.verdict === null && part.book.records.length === 3],
		["and is still open", part.book.entries[0]?.done === null],
		[
			"it cannot go on on another set",
			onOther.r.refused !== null && /started on set/.test(onOther.r.refused),
		],
		[
			"it goes on on its own set, asking only what is missing",
			rest.r.verdict !== null && rest.book.records.length === 2 * tiny.cases.length,
		],
		["a call with no answer leaves the exam open", failing.verdict === null],
		["two sets have two ids", setHashOf(tiny) !== setHashOf(other)],
	];
	rmSync(dir, {recursive: true, force: true});
	for (const [what, ok] of expect) console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
	process.exit(expect.every(([, ok]) => ok) ? 0 : 1);
}

// ---------------------------------------------------------------- around: field rows

if (STEP === "field") {
	// PART=3: only the answers of briefs that read code, part 3's own.
	const rows = process.env.PART === "3" ? records.filter((r) => r.code !== undefined) : records;
	for (const r of rows)
		console.log(
			JSON.stringify({
				date: r.at.slice(0, 10),
				lane: r.case,
				role: "triager",
				model: r.modelId,
				effort: r.model === "sol" ? "medium" : null,
				outcome: r.said === null ? "stopped" : "pass",
				why: `experiment 163: brief ${r.brief} (${r.hash}) on the ${r.half} half, first title and body, ${r.code === undefined ? "no tools" : `reading the code at ${r.code.at.slice(0, 12)}`} (run ${r.run}); said ${r.said}${r.rule === null ? "" : ` (${r.rule})`}, really ${set.cases.find((c) => c.id === r.case)?.right}; posted nothing`,
				// The conversation's size at its last turn where known (opus reading code); else the call's total.
				tokens: r.code?.context ?? r.tokens.input + r.tokens.output,
				tools: r.code?.reads ?? null,
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

// Functions, not constants: the exam step above prints with them before this line runs.
function pct(x: number): string {
	return `${(100 * x).toFixed(0)}%`;
}
function line(name: string, c: Summary["badClose"]): string {
	return `  ${name}: ${c.k}/${c.n}${c.n === 0 ? "" : ` (${pct(c.k / c.n)}, 95% ${pct(c.lo)} to ${pct(c.hi)})`}`;
}
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

// Part 3 tunes on all 119 cases: each brief and model that read code, over every case it ran.
const readers = [
	...new Set(
		records.filter((r) => r.code !== undefined).map((r) => `${r.brief}|${r.hash}|${r.model}`),
	),
];
for (const g of readers) {
	const [b, h, m] = g.split("|") as [string, string, string];
	const rs = records.filter((r) => r.brief === b && r.hash === h && r.model === m);
	const ran = set.cases.filter((c) => rs.some((r) => r.case === c.id));
	const reads = rs.flatMap((r) => (r.code === undefined ? [] : [r.code.reads]));
	console.log(
		`\n${b} (${h}) on ${m}, every case it ran (part 3), ${ran.length} cases, ${rs.length} answers; ${(reads.reduce((s, x) => s + x, 0) / Math.max(1, reads.length)).toFixed(1)} reads an answer`,
	);
	printSummary(summarize(ran, rs));
	for (const c of ran) {
		const mine = rs.filter((r) => r.case === c.id);
		if (mine.every((r) => r.right === true)) continue;
		console.log(
			`  wrong at least once: ${c.id} ${c.kind}, really ${c.right}: ${mine.map((r) => `${r.said ?? "none"}${r.rule === null ? "" : `:${r.rule}`}`).join(", ")}`,
		);
		if (process.env.WHY === "1")
			for (const r of mine) console.log(`    run ${r.run}: ${r.why ?? r.error}`);
	}
}
