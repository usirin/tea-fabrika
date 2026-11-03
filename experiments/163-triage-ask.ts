// Experiment 163, part 4: triage in two. The model checks facts by reading the code and closes only
// on a fact it shows; when a real fault turns on worth, it asks the owner, with its trace. One brief,
// v6, run as written, no tuning: on the 119 of parts 1 to 3 and on part 3's 63 exam tickets.
//
//   STEP=prs     the pull requests open when each ticket was filed, read from GitHub (read-only):
//                their heads are fetched into the clone (push off), and each one's files and diff
//                are taken at its last commit before the filing, so no later work shows
//   STEP=check   the open pull requests listed for a few tickets (ONLY=4208,4313)
//   STEP=run     SET=tuning|exam MODEL=sol|opus RUNS=2; DRY=1 prints the estimate; MAX_USD caps
//                part 4's opus spend (default 12)
//   STEP=report  the numbers per model and set (the default); WHY=1 adds every answer
//   STEP=sample  a seeded sample of asks, with their ticket title, for the by-hand judgment
//   STEP=load    phoenix's filing rate over the last 60 days, from GitHub, and asks per week
//   STEP=field   one field/runs.jsonl row per answer
//   STEP=listprice  GPT sol's dollars at OpenAI's list price (lib/list-price.ts) for every GPT sol
//                triage answer of experiments 159 to 163: a new `listUsd` on its field/runs.jsonl
//                row, from the tokens its results file saved; every other line is left as it was
//
// Node at the edge, said out loud: `node:fs` for the data and cache files and `node:child_process`
// for `git` on the clone and `gh` reads, as part 3 does.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Schema} from "effect";
import {
	casePrompt,
	type Heard,
	opusOnce,
	READ_USD,
	solOnce,
	type Tree,
	treePool,
	type World,
} from "./lib/brief-eval-live.ts";
import {type Brief, briefOf, ExamSet, LabelledSet} from "./lib/brief-eval.ts";
import {SOL, type Used, usdAt} from "./lib/list-price.ts";
import {shuffled} from "./lib/review-rounds.ts";
import {Cache} from "./lib/sort.ts";
import {PHOENIX_NOTE} from "./lib/triage-135.ts";
import {
	AskRecord,
	type AskSummary,
	answerOf,
	askSummarize,
	type Item,
	SetName,
	type Triage,
} from "./lib/triage-ask.ts";

const here = import.meta.dirname;
const STEP = process.env.STEP ?? "report";
const REPO = "kamp-us/phoenix";
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-163-cache");
const CLONE = process.env.CLONE ?? join(CACHE, "phoenix");
const AT_FILE = join(CACHE, "at.json");
const PRS_FILE = join(CACHE, "prs.json");
const OPEN_FILE = join(CACHE, "open.json");
const TREES = process.env.TREES ?? join(realpathSync(tmpdir()), "exp-163-trees-4");
/** One writer a file: a second model run at the same time writes its own RESULTS, merged after. */
const RESULTS = process.env.RESULTS ?? join(here, "results", "163-triage-ask.json");
/** As part 3: phoenix's own triage skill and triager, and its top AGENTS.md and CLAUDE.md. */
const LEFT = [
	"claude-plugins/fabrika/skills/triage",
	"claude-plugins/fabrika/agents/triager.md",
	"AGENTS.md",
	"CLAUDE.md",
];
/** Where a case's open pull requests sit in its code copy. Not hidden: rg skips hidden folders. */
const PR_DIR = "open-pull-requests-at-filing";
/** A diff longer than this is cut, with a line saying so. */
const DIFF_LINES = 3000;

const readJson = <T>(file: string, schema: Schema.Codec<T, unknown>): T =>
	Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(file, "utf8")));
const writeJson = (file: string, value: unknown) =>
	writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);
const git = (...args: string[]) =>
	execFileSync("git", ["-C", CLONE, ...args], {encoding: "utf8", maxBuffer: 1 << 28});

// ---------------------------------------------------------------- GPT sol at list price

if (STEP === "listprice") {
	type Saved = {readonly used: Used; taken: boolean};
	const isUsed = (x: unknown): x is Used =>
		typeof x === "object" &&
		x !== null &&
		["input", "cached", "output"].every(
			(k) => typeof (x as Record<string, unknown>)[k] === "number",
		);
	const sum = (xs: readonly Used[]): Used => ({
		input: xs.reduce((s, x) => s + x.input, 0),
		cached: xs.reduce((s, x) => s + x.cached, 0),
		output: xs.reduce((s, x) => s + x.output, 0),
	});
	// Every saved call, by experiment and lane. A sort that took tries also counts as their sum.
	const saved = new Map<string, Saved[]>();
	const keep = (exp: string, lane: string, used: Used) =>
		saved.set(`${exp}|${lane}`, [...(saved.get(`${exp}|${lane}`) ?? []), {used, taken: false}]);
	const callsOf = (o: unknown): Used[] => {
		if (Array.isArray(o)) return o.flatMap(callsOf);
		if (typeof o !== "object" || o === null) return [];
		const r = o as Record<string, unknown>;
		if (isUsed(r.tokens)) return [r.tokens];
		if (Array.isArray(r.tries)) {
			const tries = r.tries.flatMap(callsOf);
			return tries.length > 1 ? [...tries, sum(tries)] : tries;
		}
		return [];
	};
	const old = [
		["159", "159-triage-on-codex.json"],
		["161", "161-triage-security-line.json"],
		["162", "162-triage-random-built.json"],
	] as const;
	for (const [exp, file] of old) {
		const j = JSON.parse(readFileSync(join(here, "results", file), "utf8")) as {
			configs: Record<string, Record<"p" | "d", Record<string, unknown>>>;
		};
		for (const config of Object.values(j.configs))
			for (const [group, repo] of [
				["p", "kamp-us/phoenix"],
				["d", "kamp-us/demlik"],
			] as const)
				for (const [n, runs] of Object.entries(config[group] ?? {}))
					for (const run of Array.isArray(runs) ? runs : [runs])
						for (const used of callsOf(run)) keep(exp, `${repo}#${n}`, used);
	}
	for (const file of ["163-triage-brief-eval.json", "163-exam.json", "163-triage-ask.json"]) {
		const j = JSON.parse(readFileSync(join(here, "results", file), "utf8")) as {
			records: {case: string; model: string; tokens: Used}[];
		};
		for (const r of j.records) if (r.model === "sol") keep("163", r.case, r.tokens);
	}
	const RUNS = join(here, "..", "field", "runs.jsonl");
	const lines = readFileSync(RUNS, "utf8").split("\n");
	const totals: Record<string, {rows: number; usd: number; missed: number}> = {};
	const out = lines.map((line) => {
		if (!line.includes('"gpt-6.1-sol"')) return line;
		const row = JSON.parse(line) as Record<string, unknown>;
		const exp = /^experiment (159|161|162|163)\b/.exec(String(row.why ?? ""))?.[1];
		if (row.role !== "triager" || exp === undefined || "listUsd" in row) return line;
		const t = totals[exp] ?? {rows: 0, usd: 0, missed: 0};
		totals[exp] = t;
		const found = (saved.get(`${exp}|${row.lane}`) ?? []).find(
			(s) => !s.taken && s.used.input + s.used.output === row.billed,
		);
		if (found === undefined) {
			t.missed += 1;
			return line;
		}
		found.taken = true;
		const usd = usdAt(SOL, found.used);
		t.rows += 1;
		t.usd += usd;
		const next: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(row)) {
			next[k] = v;
			if (k === "costUsd") next.listUsd = +usd.toFixed(4);
		}
		if (!("listUsd" in next)) next.listUsd = +usd.toFixed(4);
		if (JSON.stringify(row) !== line) throw new Error(`a row would change shape: ${line}`);
		return JSON.stringify(next);
	});
	writeFileSync(RUNS, out.join("\n"));
	for (const [exp, t] of Object.entries(totals))
		console.log(
			`experiment ${exp}: ${t.rows} rows priced, $${t.usd.toFixed(2)} at ${SOL.source} (${SOL.read}); ${t.missed} rows with no saved tokens to match`,
		);
	process.exit(0);
}

// ---------------------------------------------------------------- the two sets, as items

const tuning = readJson(join(here, "163-set.json"), LabelledSet);
const examSet = readJson(join(here, "163-exam-set.json"), ExamSet);
const items: readonly Item[] = [
	...tuning.cases.map((c): Item => ({
		id: c.id,
		repo: c.repo,
		n: c.n,
		set: "tuning",
		kind: c.kind,
		right: c.right,
		security: c.kind === "security",
	})),
	...examSet.cases.map((c): Item => ({
		id: c.id,
		repo: c.repo,
		n: c.n,
		set: "exam",
		kind: c.kind,
		right: c.right,
		security: c.security === true,
	})),
];
const cache = readJson(join(CACHE, "p.json"), Cache);
const at = readJson(AT_FILE, Schema.Record(Schema.String, Schema.String));
const filedOf = (n: number) => {
	const t = cache.tickets.find((x) => x.n === n);
	if (t === undefined) throw new Error(`#${n} is not in the cache`);
	return t.createdAt;
};

// ---------------------------------------------------------------- the open pull requests

const Pr = Schema.Struct({
	number: Schema.Int,
	title: Schema.String,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
	headRefName: Schema.String,
});
/** One pull request as it stood when a ticket was filed. */
const OpenPr = Schema.Struct({
	n: Schema.Int,
	title: Schema.String,
	branch: Schema.String,
	opened: Schema.String,
	/** Its last commit before the filing, or null when none of its commits is older (a later rebase). */
	head: Schema.NullOr(Schema.String),
	files: Schema.Array(Schema.String),
	lines: Schema.Int,
});
type OpenPr = typeof OpenPr.Type;
const OpenFile = Schema.Record(Schema.String, Schema.Array(OpenPr));

/**
 * A pull request's head when a ticket was filed, and the commit its own changes start from. Phoenix
 * squash-merges, so a pull request's own commits are the ones main does not hold. Agents rebase, which
 * resets a commit's committer date but keeps its author date, so the head is its newest own commit
 * written before the filing, and its diff runs from the parent of its oldest own commit: its own
 * changes, without main's later work. A pull request main already holds (a merge commit) falls back
 * to the newest commit before the filing, against the ticket's commit.
 */
const headAt = (
	n: number,
	base: string,
	moment: string,
): {readonly head: string | null; readonly from: string} => {
	const ref = `refs/pr/${n}`;
	const own = git("log", "--format=%H %aI", ref, "--not", "origin/main")
		.split("\n")
		.filter(Boolean)
		.map((l) => l.split(" ") as [string, string]);
	if (own.length > 0) {
		const head = own.find(([, when]) => new Date(when) < new Date(moment))?.[0] ?? null;
		if (head === null) return {head: null, from: base};
		const chain = git("rev-list", head, "--not", "origin/main").trim().split("\n");
		return {head, from: `${chain.at(-1)}^`};
	}
	const found = git("rev-list", "-1", `--before=${moment}`, ref).trim();
	const ahead = found === "" ? 0 : Number(git("rev-list", "--count", `${base}..${found}`).trim());
	return ahead === 0 ? {head: null, from: base} : {head: found, from: base};
};

if (STEP === "prs") {
	if (!existsSync(PRS_FILE)) {
		const out = execFileSync(
			"gh",
			[
				"pr",
				"list",
				"-R",
				REPO,
				"--state",
				"all",
				"--limit",
				"12000",
				"--json",
				"number,title,createdAt,closedAt,mergedAt,headRefName",
			],
			{encoding: "utf8", maxBuffer: 1 << 28},
		);
		writeFileSync(PRS_FILE, out);
	}
	const prs = readJson(PRS_FILE, Schema.Array(Pr));
	const openAt = (moment: string) =>
		prs.filter((p) => p.createdAt < moment && (p.closedAt === null || p.closedAt > moment));
	const wanted = [...new Set(items.flatMap((c) => openAt(filedOf(c.n)).map((p) => p.number)))];
	const have = new Set(git("for-each-ref", "--format=%(refname)", "refs/pr").split("\n"));
	const missing = wanted.filter((n) => !have.has(`refs/pr/${n}`));
	for (let i = 0; i < missing.length; i += 100)
		git(
			"fetch",
			"--quiet",
			"--no-tags",
			"origin",
			...missing.slice(i, i + 100).map((n) => `+refs/pull/${n}/head:refs/pr/${n}`),
		);
	const open: Record<string, OpenPr[]> = {};
	for (const c of items) {
		const moment = filedOf(c.n);
		const base = at[c.n];
		if (base === undefined) throw new Error(`#${c.n} has no commit`);
		open[c.n] = openAt(moment).map((p) => {
			const {head, from} = headAt(p.number, base, moment);
			const files =
				head === null ? [] : git("diff", "--name-only", from, head).split("\n").filter(Boolean);
			const lines = head === null ? 0 : git("diff", from, head).split("\n").length;
			return {
				n: p.number,
				title: p.title,
				branch: p.headRefName,
				opened: p.createdAt,
				head,
				files,
				lines,
			};
		});
	}
	writeJson(OPEN_FILE, open);
	const counts = Object.values(open).map((xs) => xs.length);
	const empty = Object.values(open)
		.flat()
		.filter((p) => p.head === null).length;
	console.log(
		`${items.length} tickets, ${wanted.length} pull requests, ${counts.reduce((s, x) => s + x, 0)} listings (median ${counts.toSorted((a, b) => a - b)[counts.length >> 1]}); ${empty} with no commit before the filing`,
	);
	process.exit(0);
}

const open = existsSync(OPEN_FILE) ? readJson(OPEN_FILE, OpenFile) : {};
const openOf = (n: number): readonly OpenPr[] => open[n] ?? [];

/** The prompt's list of open pull requests. Pure. */
const prsText = (n: number): string => {
	const xs = openOf(n);
	const shown = (p: OpenPr) =>
		p.head === null
			? `- #${p.n} ${p.title} (opened ${p.opened.slice(0, 10)}): no commit of it from before the filing could be read`
			: `- #${p.n} ${p.title} (opened ${p.opened.slice(0, 10)}): ${p.files.length} files changed by then: ${p.files.slice(0, 25).join(", ")}${p.files.length > 25 ? ", ..." : ""}. Diff: ${PR_DIR}/${p.n}.diff`;
	return [
		`# The ${xs.length} pull requests open when the ticket was filed`,
		"",
		"Each as it stood at that moment, not merged into the code you have. Its diff is in your folder.",
		"",
		xs.length === 0 ? "None." : xs.map(shown).join("\n"),
	].join("\n");
};

/** A case's diffs, as files in its own code copy. */
const extraOf = (c: Item) => {
	const base = at[c.n] as string;
	const files: Record<string, string> = {};
	for (const p of openOf(c.n)) {
		if (p.head === null) continue;
		const all = git("diff", headAt(p.n, base, filedOf(c.n)).from, p.head).split("\n");
		files[`${PR_DIR}/${p.n}.diff`] =
			all.length <= DIFF_LINES
				? all.join("\n")
				: `${all.slice(0, DIFF_LINES).join("\n")}\n[cut: ${all.length - DIFF_LINES} more lines]\n`;
	}
	return {key: `t${c.n}`, files};
};

if (STEP === "check") {
	for (const n of (process.env.ONLY ?? "4208,4313").split(",").map(Number)) {
		console.log(`#${n} ${cache.tickets.find((t) => t.n === n)?.title}\n${prsText(n)}\n`);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- the answers

const BRIEF_ID = process.env.BRIEF ?? "triage-v6";
const brief: Brief = briefOf(readFileSync(join(here, "163-briefs", `${BRIEF_ID}.md`), "utf8"));
const schema = answerOf(brief);
const Results = Schema.Struct({records: Schema.Array(AskRecord)});
const records: AskRecord[] = existsSync(RESULTS) ? [...readJson(RESULTS, Results).records] : [];
const save = () => writeJson(RESULTS, {records});
const LONG_DASH = String.fromCodePoint(0x2014);
/**
 * No long dash and no person's name (a branch, a path, a fixture) reaches the public file. The names
 * are one a line in the cache's `names.txt`, kept out of the repo so this file does not hold them.
 */
const NAMES_FILE = join(CACHE, "names.txt");
const names = existsSync(NAMES_FILE)
	? readFileSync(NAMES_FILE, "utf8")
			.split("\n")
			.map((x) => x.trim())
			.filter(Boolean)
	: [];
const masked = new RegExp(`\\b(?:${names.join("|") || "(?!)"})\\b`, "gi");
const plain = (s: string | null) =>
	s === null ? null : s.replaceAll(LONG_DASH, ":").replaceAll(masked, "[name]");
const spent = () => records.filter((r) => r.model === "opus").reduce((s, r) => s + (r.usd ?? 0), 0);

if (STEP === "run") {
	for (const key of ["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"])
		if (process.env[key] !== undefined) {
			console.error(`${key} is set: unset it`);
			process.exit(1);
		}
	const set = Schema.decodeUnknownSync(SetName)(process.env.SET);
	const model = Schema.decodeUnknownSync(Schema.Literals(["opus", "sol"]))(process.env.MODEL);
	const runs = Number(process.env.RUNS ?? 2);
	const MAX_USD = Number(process.env.MAX_USD ?? 12);
	const only = process.env.ONLY?.split(",").map(Number);
	const mine = items.filter((c) => c.set === set && (only === undefined || only.includes(c.n)));
	const held = (c: Item) =>
		records.filter(
			(r) =>
				r.case === c.id &&
				r.hash === brief.hash &&
				r.model === model &&
				r.set === set &&
				r.said !== null,
		).length;
	// In a seeded order (SEED), so a run the cap stops short is a random sample, not the oldest tickets.
	const calls = shuffled(
		mine.flatMap((c) =>
			Array.from({length: Math.max(0, runs - held(c))}, (_, i) => ({c, run: held(c) + i + 1})),
		),
		Number(process.env.SEED ?? 1634),
	);
	// Part 3's exam mean on opus with the code, $0.148 an answer, is the guess before part 4 has any.
	const made = records.filter((r) => r.model === "opus" && r.usd !== null);
	const each = made.length === 0 ? 0.148 : spent() / made.length;
	console.log(
		`${brief.id} (${brief.hash}) on ${model}, ${set}: ${mine.length} tickets x ${runs}, ${calls.length} calls${model === "opus" ? `, about $${(each * calls.length).toFixed(2)}; part 4 spent $${spent().toFixed(2)}, cap $${MAX_USD}` : ", on the ChatGPT plan"}`,
	);
	if (process.env.DRY === "1") process.exit(0);
	const world: World = {tickets: cache.tickets, all: cache.all, notes: {[REPO]: PHOENIX_NOTE}};
	const tree = treePool({
		clone: CLONE,
		root: TREES,
		atOf: (c) => at[c.n],
		keep: Number(process.env.KEEP_TREES ?? 4),
		left: LEFT,
		extra: (c) => extraOf(c as Item),
	});
	const concurrency = Number(process.env.CONCURRENCY ?? 2);
	const ask = (c: Item, t: Tree): Promise<Heard<{readonly triage: Triage}>> => {
		const prompt = `${casePrompt(world, c)}\n\n${prsText(c.n)}`;
		return model === "opus"
			? opusOnce(brief, schema, prompt, t.path, t)
			: solOnce(brief, schema, prompt, t.path, t);
	};
	await Effect.runPromise(
		Effect.forEach(
			calls,
			({c, run}) =>
				Effect.suspend(() =>
					model === "opus" && spent() + READ_USD * concurrency >= MAX_USD
						? Effect.void
						: Effect.scoped(
								tree(c).pipe(
									Effect.flatMap((t) => Effect.promise(() => ask(c, t))),
									Effect.flatMap((h) =>
										Effect.sync(() => {
											const a = h.answer?.triage ?? null;
											const r: AskRecord = {
												case: c.id,
												set,
												brief: brief.id,
												hash: brief.hash,
												model,
												modelId: h.modelId,
												run,
												said: a?.answer ?? null,
												why: a?.why ?? null,
												of: a?.answer === "close" ? a.of : null,
												trace: plain(a?.trace ?? null),
												question: a?.answer === "ask" ? plain(a.question) : null,
												really: c.right,
												prs: openOf(c.n).length,
												usd: h.usd,
												ms: h.ms,
												tokens: h.tokens,
												error: h.error === null ? null : h.error.replaceAll(homedir(), "~"),
												at: new Date().toISOString(),
												code: h.code ?? {at: at[c.n] as string, reads: 0},
											};
											records.push(r);
											save();
											console.log(
												`${c.id} ${c.kind} really ${c.right}: ${r.said ?? r.error}${r.why === null ? "" : `:${r.why}`} ${(r.ms / 1000).toFixed(0)} s, ${r.code.reads} reads${r.usd === null ? "" : `, $${r.usd.toFixed(3)}`}`,
											);
										}),
									),
									Effect.catch((e) => Effect.sync(() => console.log(`${c.id} failed: ${e}`))),
								),
							),
				),
			{concurrency, discard: true},
		),
	);
	console.log(`done; part 4 opus spend $${spent().toFixed(2)}`);
	process.exit(0);
}

// ---------------------------------------------------------------- the numbers

const pct = (k: number, n: number) => (n === 0 ? "-" : `${((100 * k) / n).toFixed(0)}%`);
const show = (o: Record<string, number>) =>
	Object.entries(o)
		.toSorted((a, b) => b[1] - a[1])
		.map(([k, v]) => `${k} ${v}`)
		.join(", ");
const groups = [...new Set(records.map((r) => `${r.hash}|${r.model}|${r.set}`))];
const summaryOf = (g: string): {s: AskSummary; rs: AskRecord[]; set: SetName} => {
	const [h, m, set] = g.split("|") as [string, string, SetName];
	const rs = records.filter((r) => r.hash === h && r.model === m && r.set === set);
	return {
		s: askSummarize(
			items.filter((c) => c.set === set),
			rs,
		),
		rs,
		set,
	};
};

if (STEP === "sample") {
	// A seeded sample of asks over both models and sets, for the by-hand judgment.
	const asks = records
		.filter((r) => r.said === "ask")
		.toSorted((a, b) => (a.case + a.model + a.run).localeCompare(b.case + b.model + b.run));
	const pick = shuffled(asks, Number(process.env.SEED ?? 1634)).slice(
		0,
		Number(process.env.N ?? 15),
	);
	for (const r of pick) {
		const c = items.find((x) => x.id === r.case) as Item;
		const t = cache.tickets.find((x) => x.n === c.n);
		console.log(
			`\n${r.case} (${r.model}, ${r.set}, run ${r.run}) ${c.kind}, really ${r.really}\n  title: ${t?.title}\n  ask:${r.why}\n  trace: ${r.trace}\n  question: ${r.question}`,
		);
	}
	process.exit(0);
}

if (STEP === "load") {
	// Phoenix's filing rate over the last 60 days, read from GitHub, and each run's ask share on it.
	const since = new Date(Date.now() - 60 * 86400e3).toISOString().slice(0, 10);
	const filed = Number(
		execFileSync(
			"gh",
			[
				"api",
				"-X",
				"GET",
				"search/issues",
				"-f",
				`q=repo:${REPO} is:issue created:>=${since}`,
				"--jq",
				".total_count",
			],
			{encoding: "utf8"},
		).trim(),
	);
	const perWeek = (filed / 60) * 7;
	console.log(`${filed} issues filed since ${since}: ${perWeek.toFixed(1)} a week`);
	for (const g of groups) {
		const {s, rs, set} = summaryOf(g);
		const random = rs.filter(
			(r) => r.said !== null && items.find((c) => c.id === r.case)?.kind === "built-random",
		);
		const randomShare =
			random.length === 0 ? 0 : random.filter((r) => r.said === "ask").length / random.length;
		console.log(
			`  ${g}: ask share ${pct(s.asks.answers, s.answers)}, ${(perWeek * s.asks.share).toFixed(0)} asks a week; on built-random only ${pct(random.filter((r) => r.said === "ask").length, random.length)} (${(perWeek * randomShare).toFixed(0)} a week)`,
		);
		void set;
	}
	process.exit(0);
}

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
				why: `experiment 163 part 4: brief ${r.brief} (${r.hash}) on the ${r.set === "exam" ? "63 exam tickets" : "119 tuning tickets"}, reading the code at ${r.code.at.slice(0, 12)} and ${r.prs} open pull requests (run ${r.run}); said ${r.said}${r.why === null ? "" : ` (${r.why})`}, really ${r.really}; posted nothing`,
				tokens: r.code.context ?? r.tokens.input + r.tokens.output,
				tools: r.code.reads,
				minutes: +(r.ms / 60000).toFixed(2),
				note: null,
				driver_caused: false,
				costUsd: r.usd === null ? null : +r.usd.toFixed(4),
				billed: r.tokens.input + r.tokens.output,
				replay: true,
				name: r.said === null ? null : `${r.said}:${r.why}`,
			}),
		);
	process.exit(0);
}

if (STEP !== "report") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}
for (const g of groups) {
	const {s, rs} = summaryOf(g);
	const tokens = rs.reduce(
		(a, r) => ({
			in: a.in + r.tokens.input,
			cached: a.cached + r.tokens.cached,
			out: a.out + r.tokens.output,
		}),
		{in: 0, cached: 0, out: 0},
	);
	const ms = rs.map((r) => r.ms).toSorted((a, b) => a - b);
	const reads = rs.map((r) => r.code.reads).toSorted((a, b) => a - b);
	console.log(
		`\n${g}: ${s.tickets} tickets, ${s.answers} answers, ${s.none} none, $${s.usd.toFixed(2)}`,
	);
	console.log(`  grid (said/really): ${show(s.grid)}`);
	console.log(
		`  wrong closes: ${s.wrongClose.answers} answers, ${s.wrongClose.tickets} of ${s.wrongClose.of} built tickets (${pct(s.wrongClose.tickets, s.wrongClose.of)}); by fact: ${show(s.wrongClose.byWhy)}; ${s.wrongClose.ids.join(" ")}`,
	);
	console.log(
		`  wrong keeps: ${s.wrongKeep.answers} answers, ${s.wrongKeep.tickets} of ${s.wrongKeep.of} closed tickets (${pct(s.wrongKeep.tickets, s.wrongKeep.of)}); ${s.wrongKeep.ids.join(" ")}`,
	);
	console.log(
		`  asks: ${s.asks.answers} of ${s.answers} (${pct(s.asks.answers, s.answers)}); by why: ${show(s.asks.byWhy)}; really: ${show(s.asks.byReally)}; by kind: ${show(s.asks.byKind)}`,
	);
	console.log(`  security tickets' answers: ${show(s.security)}`);
	console.log(`  agreement: ${s.agreement.same} of ${s.agreement.of}`);
	console.log(
		`  tokens in ${tokens.in} (cached ${tokens.cached}), out ${tokens.out}; median ${((ms[ms.length >> 1] ?? 0) / 1000).toFixed(1)} s, ${reads[reads.length >> 1]} reads`,
	);
	if (process.env.WHY === "1")
		for (const r of rs)
			console.log(
				`    ${r.case} run ${r.run} ${r.said}:${r.why} really ${r.really}: ${r.trace} | ${r.question ?? ""}`,
			);
}
