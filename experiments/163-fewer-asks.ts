// Experiment 163, part 5: fewer asks without looser closes. Offline, on part 4's 229 asks: a code
// rule that sends every security ticket to the owner, then three ways to ask less (bundle asks one
// decision settles, follow a ruling made earlier on a like ticket, keep a worth ask when building is
// cheap), each alone and together, against the proposed bar.
//
//   STEP=ruled   every phoenix issue's state, why it closed and when, read from GitHub (read-only),
//                then the closing note of each earlier ticket a matcher will be shown
//   STEP=match   MODEL=haiku|sonnet: which earlier ruling decides each asked ticket, if any; DRY=1
//                prints the estimate; MAX_USD caps all matcher spend together (default 5)
//   STEP=groups  ten seeded bundles, with their tickets' titles, for the by-hand check
//   STEP=report  every scenario against the bar (the default); writes results/163-fewer-asks.json
//   STEP=field   one field/runs.jsonl row per matcher call
//
// Node at the edge, said out loud: `node:fs` for the data and cache files and `node:child_process`
// for `gh` reads, as part 4 does.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {Schema} from "effect";
import {ExamSet, LabelledSet, type Verdict} from "./lib/brief-eval.ts";
import {
	type Answer,
	type AskInfo,
	BAR,
	type BarNumbers,
	barOf,
	breakEven,
	bundles,
	firstFileOf,
	followRulings,
	keepWorth,
	keyBundles,
	lexicon,
	linked,
	MatchAnswer,
	MatchRecord,
	numbersOf,
	PER_WEEK,
	type Ruling,
	rulingFrom,
	securityRule,
	spread,
} from "./lib/fewer-asks.ts";
import {claudeOnce} from "./lib/fewer-asks-live.ts";
import {HAIKU, SONNET, usdAt} from "./lib/list-price.ts";
import {shuffled} from "./lib/review-rounds.ts";
import {Cache} from "./lib/sort.ts";
import {AskRecord} from "./lib/triage-ask.ts";

const here = import.meta.dirname;
const STEP = process.env.STEP ?? "report";
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-163-cache");
const RULED_FILE = join(CACHE, "ruled.json");
const NOTES_FILE = join(CACHE, "notes.json");
const ASKS = join(here, "results", "163-triage-ask.json");
const RESULTS = join(here, "results", "163-fewer-asks.json");
const RUNS = join(here, "..", "field", "runs.jsonl");
/** How many earlier tickets a matcher sees, best lexical match first. */
const SHOWN = 8;
const SEED = 1635;

const readJson = <T>(file: string, schema: Schema.Codec<T, unknown>): T =>
	Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(file, "utf8")));
const writeJson = (file: string, value: unknown) =>
	writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);
const gh = (...args: string[]) => execFileSync("gh", args, {encoding: "utf8", maxBuffer: 1 << 28});
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(0)}%`);

// ---------------------------------------------------------------- what part 4 left

const tuning = readJson(join(here, "163-set.json"), LabelledSet);
const examSet = readJson(join(here, "163-exam-set.json"), ExamSet);
const security = new Map<string, boolean>([
	...tuning.cases.map((c): [string, boolean] => [c.id, c.kind === "security"]),
	...examSet.cases.map((c): [string, boolean] => [c.id, c.security === true]),
]);
const cache = readJson(join(CACHE, "p.json"), Cache);
const ticketOf = (n: number) => {
	const t = cache.tickets.find((x) => x.n === n);
	if (t === undefined) throw new Error(`#${n} is not in the cache`);
	return t;
};
const OpenPr = Schema.Struct({n: Schema.Int});
const open = readJson(join(CACHE, "open.json"), Schema.Record(Schema.String, Schema.Array(OpenPr)));
const records = readJson(ASKS, Schema.Struct({records: Schema.Array(AskRecord)})).records.filter(
	(r) => r.brief === "triage-v6" && r.said !== null,
);
const answers: Answer[] = records.map((r) => {
	const n = Number(r.case.split("#")[1]);
	return {
		case: r.case,
		n,
		group: `${r.model}|${r.set}`,
		run: r.run,
		said: r.said as Answer["said"],
		why: r.why ?? "",
		really: r.really,
		security: security.get(r.case) === true,
		filed: ticketOf(n).createdAt,
		trace: r.trace ?? "",
	};
});
const asked = [...new Set(answers.filter((a) => a.said === "ask").map((a) => a.n))].toSorted(
	(a, b) => a - b,
);

/** No long dash, no person's name and no host reaches the public file, as in part 4. */
const LONG_DASH = String.fromCodePoint(0x2014);
const NAMES_FILE = join(CACHE, "names.txt");
const names = existsSync(NAMES_FILE)
	? readFileSync(NAMES_FILE, "utf8")
			.split("\n")
			.map((x) => x.trim())
			.filter(Boolean)
	: [];
const masked = new RegExp(`\\b(?:${names.join("|") || "(?!)"})\\b`, "gi");
const plain = (s: string) =>
	s
		.replaceAll(LONG_DASH, ":")
		.replaceAll(masked, "[name]")
		.replaceAll(/[\w.-]+\.workers\.dev\b/g, "[a Cloudflare host]");

// ---------------------------------------------------------------- earlier rulings

/** How a phoenix issue was settled: built by a merged pull request, or closed unbuilt, and why. */
const Settled = Schema.Literals(["built", "not_planned", "duplicate", "done", "open"]);
type Settled = typeof Settled.Type;
const Ruled = Schema.Struct({
	n: Schema.Int,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
	how: Settled,
});
type Ruled = typeof Ruled.Type;
const Note = Schema.Struct({at: Schema.String, body: Schema.String});
type Note = typeof Note.Type;

/** What an earlier ticket's settling says of a like ticket: build it, close it, or nothing. */
const verdictOf = (how: Settled): Verdict | null =>
	how === "built" ? "keep" : how === "not_planned" || how === "duplicate" ? "close" : null;
const HOW: Record<Settled, string> = {
	built: "built: a merged pull request closed it",
	not_planned: "closed unbuilt, as not planned",
	duplicate: "closed as a duplicate",
	done: "closed as completed, with no pull request",
	open: "open",
};

const ruled: Ruled[] = existsSync(RULED_FILE) ? [...readJson(RULED_FILE, Schema.Array(Ruled))] : [];
const ruledOf = new Map(ruled.map((r) => [r.n, r]));
const titleOf = new Map(cache.all.map((t) => [t.n, t.title]));
const textOf = (n: number) => {
	const t = ticketOf(n);
	return `${t.title}\n${t.title}\n${t.body.slice(0, 1200)}`;
};
const lex = lexicon(
	new Map<number, string>([
		...ruled
			.filter((r) => titleOf.has(r.n))
			.map((r): [number, string] => [r.n, titleOf.get(r.n) as string]),
		...asked.map((n): [number, string] => [n, textOf(n)]),
	]),
);
/** The earlier tickets settled before `n` was filed, best lexical match first. No label is read. */
const candidatesOf = (n: number) => {
	const filed = ticketOf(n).createdAt;
	return ruled
		.filter(
			(r) =>
				r.n !== n &&
				r.how !== "open" &&
				r.closedAt !== null &&
				r.closedAt < filed &&
				titleOf.has(r.n),
		)
		.map((r) => ({n: r.n, score: +lex.cosine(n, r.n).toFixed(4)}))
		.toSorted((a, b) => b.score - a.score)
		.slice(0, SHOWN);
};

if (STEP === "ruled") {
	const q = `query($endCursor:String){repository(owner:"kamp-us",name:"phoenix"){issues(first:100,after:$endCursor,orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor} nodes{number createdAt closedAt state stateReason closedByPullRequestsReferences(first:5,includeClosedPrs:true){nodes{mergedAt}}}}}}`;
	const Node = Schema.Struct({
		number: Schema.Int,
		createdAt: Schema.String,
		closedAt: Schema.NullOr(Schema.String),
		state: Schema.String,
		stateReason: Schema.NullOr(Schema.String),
		closedByPullRequestsReferences: Schema.Struct({
			nodes: Schema.Array(Schema.Struct({mergedAt: Schema.NullOr(Schema.String)})),
		}),
	});
	const out = gh(
		"api",
		"graphql",
		"--paginate",
		"-f",
		`query=${q}`,
		"--jq",
		".data.repository.issues.nodes[]",
	);
	const all = out
		.split("\n")
		.filter(Boolean)
		.map((l) => Schema.decodeUnknownSync(Node)(JSON.parse(l)))
		.map((x): Ruled => {
			const merged = x.closedByPullRequestsReferences.nodes.some(
				(p) => p.mergedAt !== null && x.closedAt !== null && p.mergedAt <= x.closedAt,
			);
			const how: Settled =
				x.state !== "CLOSED"
					? "open"
					: x.stateReason === "NOT_PLANNED"
						? "not_planned"
						: x.stateReason === "DUPLICATE"
							? "duplicate"
							: merged
								? "built"
								: "done";
			return {n: x.number, createdAt: x.createdAt, closedAt: x.closedAt, how};
		});
	writeJson(RULED_FILE, all);
	const tally = Object.groupBy(all, (r) => r.how);
	console.log(
		`${all.length} issues: ${Object.entries(tally)
			.map(([k, v]) => `${k} ${v?.length}`)
			.join(", ")}`,
	);
	console.log("run STEP=ruled again to read the closing notes of the tickets a matcher sees");
	if (ruled.length === 0) process.exit(0);
	// The closing notes, for the earlier tickets closed unbuilt that some asked ticket is shown.
	const shown = [...new Set(asked.flatMap((n) => candidatesOf(n).map((c) => c.n)))].filter(
		(n) => ruledOf.get(n)?.how !== "built",
	);
	const notes: Record<string, Note[]> = {};
	for (let i = 0; i < shown.length; i += 40) {
		const part = shown.slice(i, i + 40);
		const body = part
			.map((n) => `i${n}: issue(number:${n}){comments(last:4){nodes{createdAt body}}}`)
			.join(" ");
		const got = JSON.parse(
			gh(
				"api",
				"graphql",
				"-f",
				`query=query{repository(owner:"kamp-us",name:"phoenix"){${body}}}`,
			),
		) as {
			data: {repository: Record<string, {comments: {nodes: {createdAt: string; body: string}[]}}>};
		};
		for (const n of part)
			notes[n] = (got.data.repository[`i${n}`]?.comments.nodes ?? []).map((c) => ({
				at: c.createdAt,
				body: c.body.slice(0, 1500),
			}));
	}
	writeJson(NOTES_FILE, notes);
	console.log(`closing notes read for ${shown.length} earlier tickets`);
	process.exit(0);
}

const notes: Record<string, readonly Note[]> = existsSync(NOTES_FILE)
	? readJson(NOTES_FILE, Schema.Record(Schema.String, Schema.Array(Note)))
	: {};
/** The note an earlier ticket was closed with: its last comment from before it closed, plus a minute. */
const closingNote = (p: Ruled, before: string): string | null => {
	if (p.closedAt === null) return null;
	const limit = new Date(Date.parse(p.closedAt) + 60e3).toISOString();
	const fit = (notes[p.n] ?? []).filter((c) => c.at <= limit && c.at < before);
	return fit.at(-1)?.body.slice(0, 500).replaceAll(/\s+/g, " ") ?? null;
};

// ---------------------------------------------------------------- the matcher

const MATCH_BRIEF = `You check whether a ticket was already decided, so its owner need not be asked again.

You see a new ticket (its title and first body) and up to eight earlier tickets. Each earlier ticket was settled before the new one was filed: built by a merged pull request, or closed unbuilt. Where one was closed unbuilt you may see the note it was closed with.

Answer one of three:
- same: the new ticket asks for the very work an earlier ticket settled, so nothing new would be decided. Name that ticket.
- rule: an earlier ticket is the same kind of request, on the same part of the code, for the same reason, so its settling would settle the new one the same way. Name that ticket.
- none: no earlier ticket decides the new one.

Pick none unless you are sure. A ticket on the same file but for a different fault is none. A wrong match closes or builds a ticket the owner never saw, and costs more than one more question. Keep why to one sentence.`;

const matchPrompt = (n: number) => {
	const t = ticketOf(n);
	const lines = candidatesOf(n).map((c) => {
		const p = ruledOf.get(c.n) as Ruled;
		const note = p.how === "built" ? null : closingNote(p, t.createdAt);
		return `- #${c.n}, filed ${p.createdAt.slice(0, 10)}, settled ${(p.closedAt ?? "").slice(0, 10)}: ${titleOf.get(c.n)}\n  Settled: ${HOW[p.how]}${note === null ? "" : `\n  Closing note: ${note}`}`;
	});
	return `New ticket #${n}, filed ${t.createdAt.slice(0, 10)}\nTitle: ${t.title}\n\n${t.body.slice(0, 4000)}\n\nEarlier tickets, settled before it was filed:\n${lines.join("\n")}`;
};

const Results = Schema.Struct({
	match: Schema.Array(MatchRecord),
	report: Schema.optional(Schema.Unknown),
});
const saved = existsSync(RESULTS) ? readJson(RESULTS, Results) : {match: [], report: undefined};
const matches: MatchRecord[] = [...saved.match];
const save = (report: unknown) => writeJson(RESULTS, {match: matches, report});

if (STEP === "match") {
	const model = process.env.MODEL === "sonnet" ? "sonnet" : "haiku";
	const price = model === "sonnet" ? SONNET : HAIKU;
	const cap = Number(process.env.MAX_USD ?? 5);
	if (ruled.length === 0) throw new Error("run STEP=ruled first");
	const todo = asked.filter((n) => !matches.some((m) => m.n === n && m.model === model));
	const chars = todo.reduce((s, n) => s + MATCH_BRIEF.length + matchPrompt(n).length, 0);
	// About four characters a token; the SDK adds its own framing and the answer's schema to each call.
	const tokensIn = chars / 4 + todo.length * 3000;
	const estimate = usdAt(price, {input: tokensIn, cached: 0, output: todo.length * 150});
	const spent = () => matches.reduce((s, m) => s + (m.usd ?? 0), 0);
	console.log(
		`${model}: ${todo.length} tickets to match, about ${Math.round(tokensIn)} tokens in, about $${estimate.toFixed(2)} at list price; spent so far $${spent().toFixed(2)} of $${cap}`,
	);
	if (process.env.DRY === "1") {
		const n = todo[0];
		if (n !== undefined) console.log(`\n--- the first prompt\n${matchPrompt(n)}`);
		process.exit(0);
	}
	for (const n of todo) {
		if (spent() >= cap) {
			console.log(`stopped at the cap: $${spent().toFixed(2)}`);
			break;
		}
		const heard = await claudeOnce(model, MATCH_BRIEF, matchPrompt(n), MatchAnswer, CACHE);
		const m = heard.answer?.match ?? null;
		const shown = candidatesOf(n);
		const cites = m === null || m.kind === "none" ? null : m.n;
		matches.push({
			n,
			model,
			modelId: heard.modelId,
			shown,
			kind: m?.kind ?? null,
			// A citation must be one of the tickets shown; any other is read as none.
			cites: cites !== null && shown.some((c) => c.n === cites) ? cites : null,
			why: m === null ? null : plain(m.why),
			usd: heard.usd,
			ms: heard.ms,
			tokens: heard.tokens,
			error: heard.error,
			at: new Date().toISOString(),
		});
		save(saved.report);
		console.log(`#${n}: ${m?.kind ?? "error"}${cites === null ? "" : ` #${cites}`}`);
	}
	console.log(`spent $${spent().toFixed(2)}`);
	process.exit(0);
}

if (STEP === "field") {
	for (const m of matches)
		console.log(
			JSON.stringify({
				date: m.at.slice(0, 10),
				lane: `kamp-us/phoenix#${m.n}`,
				role: "triager",
				model: m.modelId,
				effort: null,
				outcome: m.kind === null ? "stopped" : "pass",
				why: `experiment 163 part 5: precedent matcher, ${m.shown.length} earlier tickets settled before this one was filed, no tools; said ${m.kind ?? "nothing"}${m.cites === null ? "" : ` #${m.cites}`}; posted nothing`,
				tokens: m.tokens.input + m.tokens.output,
				tools: 0,
				minutes: +(m.ms / 60000).toFixed(2),
				note: "2026-10-30-16",
				driver_caused: false,
				costUsd: m.usd === null ? null : +m.usd.toFixed(4),
				billed: m.tokens.input + m.tokens.output,
				replay: true,
				name: m.kind,
			}),
		);
	process.exit(0);
}

// ---------------------------------------------------------------- bundles

/** What the bundle rule reads off one ask: its own body, its trace and its own open list. */
const infoOf = (a: Answer): AskInfo => {
	const own = new Set((open[String(a.n)] ?? []).map((p) => p.n));
	const said = numbersOf(a.trace);
	return {
		n: a.n,
		filed: a.filed,
		names: [...new Set([...numbersOf(ticketOf(a.n).body), ...said])],
		prs: said.filter((p) => own.has(p)),
		file: firstFileOf(a.trace),
	};
};
/** ISO week of a date, as `YYYY-Www`. */
const weekOf = (iso: string) => {
	const d = new Date(iso);
	const day = (d.getUTCDay() + 6) % 7;
	d.setUTCDate(d.getUTCDate() - day + 3);
	const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
	const w =
		1 +
		Math.round(
			(d.getTime() - first.getTime()) / 86400e3 / 7 - 0.5 + ((first.getUTCDay() + 6) % 7) / 7,
		);
	return `${d.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
};
/** Bundles of the asks within each filing week: the owner reads the week's asks together. */
const weeklyBundles = (asks: readonly AskInfo[]) =>
	[...Map.groupBy(asks, (a) => weekOf(a.filed)).values()].flatMap(keyBundles);

/**
 * Decisions in a real week of `k` asks, sketched: unique asked tickets of one model drawn `k` at a
 * time across all weeks, bundled by the main rule, and, past the pool's size, a power law fitted to
 * that curve. The pool spans about fourteen weeks, a real week one: links within a week are likely
 * denser, so this leans toward too many decisions; the power law past the pool leans either way.
 */
function decisionsAt(pool: readonly AskInfo[], k: number): {ratio: number; fitted: boolean} {
	if (pool.length < 4) return {ratio: 1, fitted: false};
	const at = (m: number) => {
		let sum = 0;
		for (let t = 0; t < 40; t++) sum += keyBundles(shuffled(pool, SEED + t).slice(0, m)).length;
		return sum / 40;
	};
	if (k <= pool.length)
		return {ratio: at(Math.max(1, Math.round(k))) / Math.round(k), fitted: false};
	const xs = [0.25, 0.5, 0.75, 1].map((f) => Math.max(2, Math.round(f * pool.length)));
	const pts = xs.map((m) => [Math.log(m), Math.log(at(m))] as const);
	const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
	const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
	const b =
		pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) /
		pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
	const a = my - b * mx;
	return {ratio: Math.exp(a + b * Math.log(k)) / k, fitted: true};
}

// The hand check, written after reading STEP=groups: does one decision settle every ask in the bundle?
const HAND: readonly {readonly key: string; readonly one: boolean; readonly why: string}[] = [
	{
		key: "#9362",
		one: false,
		why: "a state move and a version pin; both only list the same open PR",
	},
	{
		key: "#1205",
		one: true,
		why: "three leaks of the newcomer sandbox; one ruling (the sandbox must hold on every path) settles all",
	},
	{key: "#7308", one: true, why: "two faults in the same spawn-clear branch check"},
	{
		key: "file apps/web/worker/features/pano/mutations.ts",
		one: false,
		why: "four faults that each start at the same entry file: a broadcast flag, a URL check, a self-vote guard, a typed update",
	},
	{
		key: "#10245",
		one: false,
		why: "a refusal message and a review re-entry; same open PR, different jobs",
	},
	{key: "#8161", one: false, why: "an empty workspace id and a hook called conditionally"},
	{key: "#8118", one: false, why: "a clipped notice and a missing test, both in the chat window"},
	{
		key: "file .github/workflows/ci.yml",
		one: false,
		why: "a comment author check and a test that skips .tsx files",
	},
	{key: "#4168", one: false, why: "an exit code and a verdict order, both near the approval gate"},
	{key: "#6552", one: false, why: "a plan approval verb and a broadcast leak"},
];
/** The hand check's share of bundles that are one decision, used to discount what bundling saves. */
const HELD = HAND.length === 0 ? 1 : HAND.filter((h) => h.one).length / HAND.length;

if (STEP === "groups") {
	const pool = answers.filter((a) => a.group === "sol|tuning" && a.run === 1 && a.said === "ask");
	const all = [
		...keyBundles(pool.map(infoOf)),
		...keyBundles(
			answers.filter((a) => a.group === "sol|exam" && a.run === 1 && a.said === "ask").map(infoOf),
		),
	].filter((b) => b.ns.length > 1);
	console.log(`${all.length} bundles of two or more; ten drawn with seed ${SEED}:`);
	for (const b of shuffled(all, SEED).slice(0, 10)) {
		console.log(`\n${b.key}:`);
		for (const n of b.ns) {
			const a = answers.find((x) => x.n === n && x.run === 1 && x.said === "ask") as Answer;
			console.log(`  #${n} ${ticketOf(n).title}\n     ${a.why}: ${a.trace.slice(0, 260)}`);
		}
	}
	process.exit(0);
}

// ---------------------------------------------------------------- the report

if (STEP !== "report") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

const truthOf = new Map(answers.map((a) => [a.n, a.really]));
const rulingsBy = (model: string) => {
	const by = new Map<number, Ruling>();
	for (const m of matches.filter((x) => x.model === model)) {
		const r = rulingFrom(m, (n) => verdictOf((ruledOf.get(n) as Ruled).how) ?? "close");
		// A `rule` match on a ticket closed as done, with no pull request, rules nothing.
		if (
			r !== null &&
			!(m.kind === "rule" && verdictOf((ruledOf.get(m.cites as number) as Ruled).how) === null)
		)
			by.set(m.n, r);
	}
	return by;
};
/** The free baseline: the best lexical match, when it is close enough, rules as it was settled. */
const lexicalRulings = (floor: number) => {
	const by = new Map<number, Ruling>();
	for (const n of asked) {
		const top = candidatesOf(n)[0];
		const v = top === undefined ? null : verdictOf((ruledOf.get(top.n) as Ruled).how);
		if (top !== undefined && top.score >= floor && v !== null)
			by.set(n, {verdict: v, cites: top.n});
	}
	return by;
};

// The matcher alone, per model: how many asked tickets it decides, and how often it is right.
const matchQuality = (by: Map<number, Ruling>) => {
	// The tickets a precedent may answer: some ask on them is not a security ask.
	const nonSecurity = asked.filter((n) =>
		answers.some((a) => a.n === n && a.said === "ask" && !a.security && a.why !== "security"),
	);
	const decided = nonSecurity.filter((n) => by.has(n));
	const right = decided.filter((n) => by.get(n)?.verdict === truthOf.get(n));
	const wrongClose = decided.filter(
		(n) => by.get(n)?.verdict === "close" && truthOf.get(n) === "keep",
	);
	return {
		tickets: nonSecurity.length,
		decided: decided.length,
		right: right.length,
		wrongClose: wrongClose.length,
		wrong: decided.filter((n) => !right.includes(n)).map((n) => `#${n}`),
	};
};

// Keep when it is cheap: what a build costs, from the field rows of real lanes.
const Run = Schema.Struct({
	lane: Schema.NullOr(Schema.Unknown),
	role: Schema.String,
	costUsd: Schema.optional(Schema.NullOr(Schema.Number)),
	minutes: Schema.optional(Schema.NullOr(Schema.Number)),
	replay: Schema.optional(Schema.Boolean),
	driver_caused: Schema.optional(Schema.Boolean),
});
const runs = readFileSync(RUNS, "utf8")
	.split("\n")
	.filter(Boolean)
	.map((l) => Schema.decodeUnknownSync(Run)(JSON.parse(l)));
const real = (r: typeof Run.Type) =>
	typeof r.lane === "string" && r.lane.startsWith("kamp-us/demlik#") && r.replay !== true;
const machineUsd = [
	...Map.groupBy(
		runs.filter((r) => real(r) && r.role === "machine" && typeof r.costUsd === "number"),
		(r) => r.lane as string,
	).values(),
].map((rs) => rs.reduce((s, r) => s + (r.costUsd ?? 0), 0));
const laneMinutes = [
	...Map.groupBy(
		runs.filter(
			(r) =>
				real(r) &&
				["builder", "reviewer", "shipper"].includes(r.role) &&
				r.driver_caused !== true &&
				typeof r.minutes === "number",
		),
		(r) => r.lane as string,
	).entries(),
]
	.filter(([lane]) => runs.some((r) => r.lane === lane && r.role === "builder"))
	.map(([, rs]) => rs.reduce((s, r) => s + (r.minutes ?? 0), 0));
const buildUsd = spread(machineUsd);
const buildMinutes = spread(laneMinutes);

// Worth asks are counted after the security rule, which is applied first in every scenario.
const afterRule = securityRule(answers);
const worthAsks = afterRule.filter((a) => a.said === "ask" && a.why === "worth");
const worthClose = worthAsks.filter((a) => a.really === "close").length / worthAsks.length;
const worthByModel = Object.fromEntries(
	["sol", "opus"].map((m) => {
		const all = afterRule.filter((a) => a.group.startsWith(`${m}|`));
		const xs = worthAsks.filter((a) => a.group.startsWith(`${m}|`));
		const p = xs.filter((a) => a.really === "close").length / xs.length;
		return [
			m,
			{
				asks: xs.length,
				closeShare: +p.toFixed(3),
				aWeek: +((PER_WEEK * xs.length) / all.length).toFixed(0),
				breakEven: {
					median: +breakEven(p, buildUsd.median).toFixed(2),
					low: +breakEven(p, buildUsd.low).toFixed(2),
					high: +breakEven(p, buildUsd.high).toFixed(2),
				},
			},
		];
	}),
);
const values = [0.25, 0.5, 1, 2, 5];

// Every scenario, per group, after the security rule (and the baseline before it).
const scenarios: Record<string, (xs: readonly Answer[]) => Answer[]> = {
	"as part 4 left it": (xs) => [...xs],
	"security rule": securityRule,
	"security + haiku precedent": (xs) => {
		const by = rulingsBy("haiku");
		return followRulings(securityRule(xs), (n) => by.get(n) ?? null);
	},
	"security + sonnet precedent": (xs) => {
		const by = rulingsBy("sonnet");
		return followRulings(securityRule(xs), (n) => by.get(n) ?? null);
	},
	"security + keep worth": (xs) => keepWorth(securityRule(xs)),
};
const best = process.env.PRECEDENT ?? "sonnet";
scenarios[`security + ${best} precedent + keep worth`] = (xs) => {
	const by = rulingsBy(best);
	return keepWorth(followRulings(securityRule(xs), (n) => by.get(n) ?? null));
};

const groupsOf = [...new Set(answers.map((a) => `${a.group}|${a.run}`))].toSorted();
const report: Record<string, Record<string, BarNumbers & {decisions: unknown}>> = {};
for (const [name, f] of Object.entries(scenarios)) {
	report[name] = {};
	console.log(`\n== ${name}`);
	for (const g of groupsOf) {
		const xs = f(answers.filter((a) => `${a.group}|${a.run}` === g));
		const bar = barOf(xs);
		const askInfos = xs.filter((a) => a.said === "ask").map(infoOf);
		const model = g.split("|")[0] as string;
		// The pool for the week sketch: this model's asked tickets after this scenario, every set and run.
		const poolAnswers = f(answers.filter((a) => a.group.startsWith(`${model}|`))).filter(
			(a) => a.said === "ask",
		);
		const pool = [...new Map(poolAnswers.map((a) => [a.n, infoOf(a)])).values()];
		const week = decisionsAt(pool, bar.asks.aWeek);
		const decisions = {
			wholeSet: keyBundles(askInfos).length,
			sameWeek: weeklyBundles(askInfos).length,
			chained: bundles(askInfos, linked).length,
			aWeek: +(bar.asks.aWeek * week.ratio).toFixed(0),
			/** What bundling saves, kept only in the share of bundles the hand check found to be one decision. */
			aWeekChecked: +(bar.asks.aWeek - bar.asks.aWeek * (1 - week.ratio) * HELD).toFixed(0),
			fitted: week.fitted,
		};
		report[name][g] = {...bar, decisions};
		console.log(
			`  ${g}: wrong closes ${bar.wrongClose.tickets}/${bar.wrongClose.of} (${pct(bar.wrongClose.tickets, bar.wrongClose.of)})${bar.wrongClose.pass ? "" : " FAIL"}; security closed ${bar.securityClosed.tickets}${bar.securityClosed.pass ? "" : " FAIL"}; wrong keeps ${bar.wrongKeep.tickets}/${bar.wrongKeep.of} (${pct(bar.wrongKeep.tickets, bar.wrongKeep.of)})${bar.wrongKeep.pass ? "" : " FAIL"}; asks ${bar.asks.answers}/${bar.answers}, ${bar.asks.aWeek.toFixed(0)} a week; decisions ${decisions.wholeSet} whole set, ${decisions.sameWeek} by week, ${decisions.chained} chained; about ${decisions.aWeek} a week${week.fitted ? " (fitted)" : ""}, ${decisions.aWeekChecked} after the hand check; precedent ${bar.precedent.answers} answers, ${bar.precedent.wrong} wrong`,
		);
	}
}

const quality = {
	haiku: matchQuality(rulingsBy("haiku")),
	sonnet: matchQuality(rulingsBy("sonnet")),
	...Object.fromEntries(
		[0.3, 0.4, 0.5].map((f) => [`lexical ${f}`, matchQuality(lexicalRulings(f))]),
	),
};
console.log("\n== the matcher alone, on the non-security asked tickets");
for (const [k, q] of Object.entries(quality))
	console.log(
		`  ${k}: decides ${q.decided} of ${q.tickets}, right ${q.right}, wrong closes ${q.wrongClose}; wrong ${q.wrong.join(" ")}`,
	);
const matchUsd = Object.fromEntries(
	["haiku", "sonnet"].map((m) => [
		m,
		+matches
			.filter((x) => x.model === m)
			.reduce((s, x) => s + (x.usd ?? 0), 0)
			.toFixed(4),
	]),
);
console.log(`  matcher dollars at list price: ${JSON.stringify(matchUsd)}`);

const cheap = {
	worthAsks: worthAsks.length,
	closeShare: +worthClose.toFixed(3),
	byModel: worthByModel,
	buildUsd,
	buildMinutes,
	breakEven: {
		median: +breakEven(worthClose, buildUsd.median).toFixed(2),
		low: +breakEven(worthClose, buildUsd.low).toFixed(2),
		high: +breakEven(worthClose, buildUsd.high).toFixed(2),
	},
	/** Worth asks a week that keeping removes, per model, at each value of 30 s of the owner (median build). */
	removedAt: values.map((v) => ({
		ownerUsd: v,
		...Object.fromEntries(
			Object.entries(worthByModel).map(([m, w]) => [m, v > w.breakEven.median ? w.aWeek : 0]),
		),
	})),
};
for (const [m, w] of Object.entries(worthByModel))
	console.log(
		`  ${m}: ${w.asks} worth asks, ${pct(Math.round(w.closeShare * 1000), 1000)} really closed, ${w.aWeek} a week; break-even $${w.breakEven.median} ($${w.breakEven.low} to $${w.breakEven.high})`,
	);
console.log(`  removed a week at $${values.join(", $")}: ${JSON.stringify(cheap.removedAt)}`);
console.log(
	`\n== keep when cheap: ${worthAsks.length} worth asks, ${pct(Math.round(worthClose * 1000), 1000)} really closed; a build $${buildUsd.median.toFixed(2)} median ($${buildUsd.low.toFixed(2)} to $${buildUsd.high.toFixed(2)}, ${buildUsd.n} lanes), ${buildMinutes.median.toFixed(1)} agent minutes median (${buildMinutes.low.toFixed(1)} to ${buildMinutes.high.toFixed(1)}, ${buildMinutes.n} lanes); keeping beats asking when 30 s of the owner is worth more than $${cheap.breakEven.median} ($${cheap.breakEven.low} to $${cheap.breakEven.high})`,
);
console.log(
	`  hand check: ${HAND.filter((h) => h.one).length} of ${HAND.length} bundles are one decision`,
);

save({
	note: "Experiment 163, part 5. Every number is computed from part 4's answers (results/163-triage-ask.json), phoenix's issue states read read-only, and the matcher calls in `match`.",
	perWeek: +PER_WEEK.toFixed(1),
	bar: BAR,
	scenarios: report,
	matcher: {quality, usd: matchUsd, shown: SHOWN},
	cheap,
	hand: HAND,
});
console.log(`\nwrote ${RESULTS}`);
