// Experiment 163, part 6: can Jev attach a precedent to an ask? Advice only: the hint is shown
// beside an ask, "the owner settled #N like this before", and never answers or closes anything.
// The code is what ships for the duplicate hint (experiment 167): the cheap filter
// (`candidatesOf`), the yes-or-no question's shape (`createYesNoJudge`), the text Jev reads
// (`textOf`), the ranking (`hintsOf`) and the live Jev with its cap and receipts (`jevFromConfig`).
// Only the pool changes: the phoenix tickets settled before the asked one was filed, not the open
// ones. And the question: "does how #N was settled answer this one?", not "is it a duplicate?".
//
//   STEP=bodies   every phoenix issue's first body and last comments, through gh, read-only
//   STEP=list     for the hand labels: each asked ticket and the earlier tickets most likely to
//                 rule it, from four places (below). No call.
//   STEP=plan     the pairs Jev would read and a cost estimate. No call.
//   STEP=run      asks Jev the pairs not yet answered; ONLY=6374,10591 asks those tickets only;
//                 MAX_USD caps the run (default 0.5). Needs TYPESAFE_API_KEY.
//   STEP=report   the numbers against the labels (the default); writes results/163-precedent-hint.json
//   STEP=field    one field/runs.jsonl row for each run
//
// Node at the edge, said out loud: `node:fs` for the data and cache files and `node:child_process`
// for `gh` reads, as parts 4 and 5 do.
import {execFileSync} from "node:child_process";
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {DEFAULT_JEV_MODEL} from "@demlik/tea/jev";
import {JevReceipts, jevFromConfig, receiptLine, spentOf} from "@kampus/pipeline/jev-live";
import {createYesNoJudge} from "@kampus/pipeline/primitives";
import {
	type Candidate,
	candidatesOf,
	duplicateJudge,
	hintsOf,
	MAX_CANDIDATES,
	type Scored,
	TOP,
	textOf,
} from "@kampus/pipeline/tickets/duplicates";
import {Effect, Layer, Schedule, Schema} from "effect";
import {FetchHttpClient} from "effect/http";
import {numbersOf} from "./lib/fewer-asks.ts";
import {Cache} from "./lib/sort.ts";
import {AskRecord} from "./lib/triage-ask.ts";

const here = import.meta.dirname;
const STEP = process.env.STEP ?? "report";
const CACHE = process.env.CACHE ?? join(here, "..", "runs", "exp-163-cache");
const BODIES_FILE = join(CACHE, "bodies.json");
/**
 * Which question Jev is asked: `precedent` (the default, below); `duplicate`, the shipped
 * duplicate question word for word, with the earlier ticket as `existing`; or `sibling`, written
 * after the first two came back low, whose "no" no longer covers a like fault in another place.
 * Each has its own results file.
 */
const QUESTIONS = ["precedent", "duplicate", "sibling"] as const;
type Question = (typeof QUESTIONS)[number];
const QUESTION: Question = QUESTIONS.find((q) => q === process.env.QUESTION) ?? "precedent";
const resultsOf = (q: string) =>
	join(here, "results", `163-precedent-hint${q === "precedent" ? "" : `-${q}`}.json`);
const RESULTS = resultsOf(QUESTION);
const PART5 = join(here, "results", "163-fewer-asks.json");
const FLOORS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

const readJson = <T>(file: string, schema: Schema.Codec<T, unknown>): T =>
	Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(file, "utf8")));
const writeJson = (file: string, value: unknown) =>
	writeFileSync(file, `${JSON.stringify(value, null, "\t")}\n`);
const gh = (...args: string[]) => execFileSync("gh", args, {encoding: "utf8", maxBuffer: 1 << 29});

// ---------------------------------------------------------------- the asks part 4 left

const cache = readJson(join(CACHE, "p.json"), Cache);
const ticketOf = (n: number) => {
	const t = cache.tickets.find((x) => x.n === n);
	if (t === undefined) throw new Error(`#${n} is not in the cache`);
	return t;
};
const titleOf = new Map(cache.all.map((t) => [t.n, t.title]));
const records = readJson(
	join(here, "results", "163-triage-ask.json"),
	Schema.Struct({records: Schema.Array(AskRecord)}),
).records.filter((r) => r.brief === "triage-v6" && r.said === "ask");
const nOf = (r: AskRecord) => Number(r.case.split("#")[1]);
/** Every ticket some part 4 run asked on, with why it asked and what really happened. */
const asked = [...new Set(records.map(nOf))]
	.toSorted((a, b) => a - b)
	.map((n) => {
		const rs = records.filter((r) => nOf(r) === n);
		return {
			n,
			whys: [...new Set(rs.map((r) => r.why ?? "?"))].toSorted(),
			really: (rs[0] as AskRecord).really,
		};
	});

// ---------------------------------------------------------------- earlier tickets

const Settled = Schema.Literals(["built", "not_planned", "duplicate", "done", "open"]);
type Settled = typeof Settled.Type;
const Ruled = Schema.Struct({
	n: Schema.Int,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
	how: Settled,
});
type Ruled = typeof Ruled.Type;
const ruled = readJson(join(CACHE, "ruled.json"), Schema.Array(Ruled));
const ruledOf = new Map(ruled.map((r) => [r.n, r]));
const HOW: Record<Settled, string> = {
	built: "built: a merged pull request closed it",
	not_planned: "closed unbuilt, as not planned",
	duplicate: "closed as a duplicate",
	done: "closed as completed, with no pull request",
	open: "open",
};

const Note = Schema.Struct({at: Schema.String, body: Schema.String});
const Bodies = Schema.Record(
	Schema.String,
	Schema.Struct({body: Schema.String, notes: Schema.Array(Note)}),
);

if (STEP === "bodies") {
	// The first body (cut to what the hint reads) of every issue, and its last three comments.
	const q = `query($endCursor:String){repository(owner:"kamp-us",name:"phoenix"){issues(first:50,after:$endCursor,orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor} nodes{number body comments(last:3){nodes{createdAt body}}}}}}`;
	const out = gh(
		"api",
		"graphql",
		"--paginate",
		"-f",
		`query=${q}`,
		"--jq",
		".data.repository.issues.nodes[]",
	);
	const Node = Schema.Struct({
		number: Schema.Int,
		body: Schema.String,
		comments: Schema.Struct({
			nodes: Schema.Array(Schema.Struct({createdAt: Schema.String, body: Schema.String})),
		}),
	});
	const all: Record<string, {body: string; notes: {at: string; body: string}[]}> = {};
	for (const line of out.split("\n").filter(Boolean)) {
		const x = Schema.decodeUnknownSync(Node)(JSON.parse(line));
		all[x.number] = {
			body: x.body.slice(0, 3000),
			notes: x.comments.nodes.map((c) => ({at: c.createdAt, body: c.body.slice(0, 1500)})),
		};
	}
	writeJson(BODIES_FILE, all);
	console.log(`${Object.keys(all).length} bodies`);
	process.exit(0);
}

const bodies = existsSync(BODIES_FILE) ? readJson(BODIES_FILE, Bodies) : {};

/** The note an earlier ticket was closed with: its last comment from before it closed, plus a minute. */
const closingNote = (p: Ruled, before: string): string | null => {
	if (p.closedAt === null || p.how === "built") return null;
	const limit = new Date(Date.parse(p.closedAt) + 60e3).toISOString();
	const fit = (bodies[p.n]?.notes ?? []).filter((c) => c.at <= limit && c.at < before);
	return fit.at(-1)?.body.slice(0, 500).replaceAll(/\s+/g, " ") ?? null;
};

/** The tickets settled before `n` was filed, as the filter reads them: title and first body. */
const poolOf = (n: number): readonly Candidate[] => {
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
		.map((r) => ({number: r.n, title: titleOf.get(r.n) as string, body: bodies[r.n]?.body ?? ""}));
};
const filedOf = (n: number) => {
	const t = ticketOf(n);
	return {title: t.title, body: t.body};
};
/** The shipped filter over that pool: at most 20, the rarest shared words first. Kept once read. */
const shortlists = new Map<number, readonly Candidate[]>();
const shortlistOf = (n: number): readonly Candidate[] => {
	const got = shortlists.get(n) ?? candidatesOf(filedOf(n), poolOf(n), MAX_CANDIDATES);
	shortlists.set(n, got);
	return got;
};

/** An earlier ticket as Jev reads it: how it was settled, first, so the body cut cannot drop it. */
const earlierText = (c: Candidate, before: string) => {
	const p = ruledOf.get(c.number) as Ruled;
	const note = closingNote(p, before);
	const head = `Settled ${(p.closedAt ?? "").slice(0, 10)}: ${HOW[p.how]}.${note === null ? "" : ` Closing note: ${note}`}`;
	return textOf({title: c.title, body: `${head}\n\n${c.body}`});
};

// ---------------------------------------------------------------- the question

/** The duplicate hint's question, turned to a settled ticket. Same shape: a yes, with criteria. */
const precedentJudge = createYesNoJudge({
	name: "precedent",
	instructions:
		"`new` is a ticket just filed, which the owner is asked about. `earlier` is a ticket settled before it: built, or closed unbuilt, as its first line says. Each is its title, then its body. Would the way `earlier` was settled answer `new` the same way: is `new` the same request, or the same kind of request on the same part for the same reason?",
	criteria: {
		true: "The same request, or the same kind of request on the same part for the same reason: the owner's answer on `earlier` answers `new` too",
		false:
			"A different fault or request, even in the same file, feature or subject; or `new` raises something the settling of `earlier` does not answer",
	},
});

/**
 * The third question. The precedent question's "no" says "a different fault, even in the same
 * feature", which also fits most labelled precedents: the same rule broken in another place.
 */
const siblingJudge = createYesNoJudge({
	name: "sibling",
	instructions:
		"`new` is a ticket just filed, which the owner is asked about. `earlier` is a ticket settled before it: built, or closed unbuilt, as its first line says. Each is its title, then its body. Did the owner already settle the same kind of problem `new` raises, so the same answer likely holds?",
	criteria: {
		true: "`earlier` fixes or declines the same kind of fault or request as `new`: the same rule broken in another place, the same gap in a sibling path, or the same change asked again",
		false:
			"`earlier` is about a different kind of fault or request, even in the same file or feature; sharing a subject or a module is not enough",
	},
});

// ---------------------------------------------------------------- STEP=list, for the labels

if (STEP === "list") {
	// Four places a precedent could come from, read by hand before any Jev call:
	// 1. an earlier ticket the asked ticket's own body names, settled before it was filed
	// 2. what part 5's matchers cited (haiku, sonnet), and their why
	// 3. part 5's lexical top three (titles)
	// 4. the shipped filter's top five over the settled pool (title and first body)
	const Part5 = Schema.Struct({
		match: Schema.Array(
			Schema.Struct({
				n: Schema.Int,
				model: Schema.String,
				shown: Schema.Array(Schema.Struct({n: Schema.Int, score: Schema.Number})),
				kind: Schema.NullOr(Schema.String),
				cites: Schema.NullOr(Schema.Int),
				why: Schema.NullOr(Schema.String),
			}),
		),
	});
	const part5 = readJson(PART5, Part5).match;
	const line = (k: number) => {
		const p = ruledOf.get(k);
		return `#${k} [${p?.how ?? "?"} ${(p?.closedAt ?? "").slice(0, 10)}] ${titleOf.get(k) ?? "?"}`;
	};
	for (const a of asked) {
		const t = ticketOf(a.n);
		console.log(
			`\n=== #${a.n} filed ${t.createdAt.slice(0, 10)} really ${a.really}, asked ${a.whys.join("/")}: ${t.title}`,
		);
		const named = numbersOf(t.body).filter((k) => {
			const p = ruledOf.get(k);
			return p !== undefined && p.closedAt !== null && p.closedAt < t.createdAt && k !== a.n;
		});
		for (const k of named) console.log(`  body names ${line(k)}`);
		for (const m of part5.filter((x) => x.n === a.n && x.cites !== null))
			console.log(`  ${m.model} ${m.kind} ${line(m.cites as number)}: ${m.why}`);
		const lex = part5.find((x) => x.n === a.n)?.shown ?? [];
		for (const c of lex.slice(0, 3)) console.log(`  lex ${c.score.toFixed(2)} ${line(c.n)}`);
		for (const c of shortlistOf(a.n).slice(0, 5)) console.log(`  filter ${line(c.number)}`);
	}
	process.exit(0);
}

// ---------------------------------------------------------------- the hand labels

/**
 * Which asks truly have a precedent, written from the record before any Jev call (STEP=list, read
 * by hand, one reader). An earlier ticket is a precedent of an ask when both hold:
 *
 *   1. it is the same request, or the same kind of request on the same part of the code for the
 *      same reason (a missing sandbox mask on another read path counts; "a missing test" on an
 *      unrelated module does not), and
 *   2. how it was settled points the way the ask was really settled: built for a kept ask, closed
 *      unbuilt (or already done) for a closed one.
 *
 * `right`: the earlier tickets a hint may show as the precedent. `wrong`: a ruling later reversed,
 * or a like ticket settled the other way; a hint to it counts as wrong unless a `right` one ranks
 * above it. `sure: false` marks a call one reader could make either way. Asks not listed have no
 * precedent: any hint on them is a false hint.
 */
interface Label {
	readonly right: readonly number[];
	readonly wrong?: readonly number[];
	readonly sure: boolean;
	readonly why: string;
}
const LABELS: Readonly<Record<number, Label>> = {
	1811: {
		right: [1309, 1358, 1205, 1280],
		sure: true,
		why: "another path out of the newcomer sandbox; each earlier leak was built shut",
	},
	2013: {
		right: [1402, 1407],
		sure: false,
		why: "the shared public-live predicate was built; this asks to use it everywhere",
	},
	2550: {
		right: [2216],
		sure: true,
		why: "the owner ruled self-votes blocked; comments are the one path left",
	},
	3361: {
		right: [3341],
		sure: true,
		why: "the same CodeQL alert class, built on #3341; one alert survived",
	},
	3724: {
		right: [1358, 1391, 1312, 1309, 1205],
		sure: true,
		why: "a list with no sandbox mask, as search, landing and profile counts were, all built",
	},
	4200: {
		right: [258, 4016],
		sure: true,
		why: "verdict ordering lets a stale verdict win; both earlier fixes built",
	},
	4236: {
		right: [3653],
		sure: false,
		why: "the leftover call sites of the single-source pipeline-cli work",
	},
	4313: {
		right: [1811, 1309],
		sure: true,
		why: "a broadcast that leaks sandbox state, as #1811 did",
	},
	4736: {
		right: [4208, 4219],
		sure: true,
		why: "the same exit-1 collision, built twice on sibling verbs",
	},
	5490: {
		right: [4113, 5016],
		sure: false,
		why: "the build claim admits what the pick pool filters; both built",
	},
	6374: {
		right: [6068, 5795],
		wrong: [6062, 5752],
		sure: true,
		why: "the reversed ruling: #6062 closed under #5752 (a strand is a human act), then #6068 and #5795 built the release path the day before this was filed",
	},
	6467: {
		right: [1358, 3724, 1280],
		sure: true,
		why: "a read path that widens to sandboxed content; every earlier one built shut",
	},
	8826: {
		right: [5565, 5763, 5827, 5831],
		sure: false,
		why: "the acceptance-criteria heading level, already fixed on #5565 and closed on its siblings",
	},
	8992: {
		right: [6616],
		wrong: [6269],
		sure: false,
		why: "#6616 built the blocked_by fence for epic children; #6269 (closed) is the lexical match part 5 followed into a wrong close",
	},
	9196: {
		right: [9178, 8703],
		sure: true,
		why: "the review-ui route ignores a verdict it rests on; the same route fixed twice",
	},
	9611: {
		right: [9537, 9515],
		sure: true,
		why: "the same ADR 0402 ruling: saved state leaves the project",
	},
	9890: {
		right: [7666],
		sure: true,
		why: "the same request, a shared Intl helper, closed unbuilt three weeks earlier",
	},
	9928: {
		right: [7299, 7300, 7301],
		sure: true,
		why: "the same --help clean-up, built in three batches",
	},
	9935: {
		right: [7299, 7300, 7301],
		sure: true,
		why: "the same --help clean-up, built in three batches",
	},
	10591: {
		right: [10363, 10370],
		sure: true,
		why: "an owner-only check that counts an agent's comment, built twice",
	},
};

/** Asks with no precedent where a like ticket was settled the other way: a hint there misleads. */
const CONTRARY: Readonly<Record<number, readonly number[]>> = {
	6557: [1280],
	6566: [6010],
	8320: [7894],
	8524: [7761, 7991],
	9623: [7886],
	10418: [9223],
};

// The labels must name asked tickets and earlier tickets settled before each was filed.
for (const [k, l] of Object.entries({...LABELS, ...mapValues(CONTRARY)})) {
	const n = Number(k);
	if (!asked.some((a) => a.n === n)) throw new Error(`label #${n} is not an asked ticket`);
	for (const e of [...l.right, ...(l.wrong ?? [])]) {
		const p = ruledOf.get(e);
		if (p?.closedAt == null || p.closedAt >= ticketOf(n).createdAt)
			throw new Error(`label #${n}: #${e} was not settled before it was filed`);
	}
}
function mapValues(xs: Readonly<Record<number, readonly number[]>>): Record<number, Label> {
	return Object.fromEntries(
		Object.entries(xs).map(([k, v]) => [k, {right: [], wrong: v, sure: true, why: "contrary"}]),
	);
}

// ---------------------------------------------------------------- the pairs

interface Pair {
	readonly key: string;
	readonly n: number;
	readonly of: number;
	/** Where the filter put `of` among the candidates, from 1. */
	readonly rank: number;
	readonly texts: {readonly new: string; readonly earlier: string};
}
const pairsOf = (n: number): Pair[] => {
	const t = ticketOf(n);
	return shortlistOf(n).map((c, i) => ({
		key: `${n}>${c.number}`,
		n,
		of: c.number,
		rank: i + 1,
		texts: {new: textOf(filedOf(n)), earlier: earlierText(c, t.createdAt)},
	}));
};

const Answered = Schema.Struct({
	key: Schema.String,
	n: Schema.Int,
	of: Schema.Int,
	rank: Schema.Int,
	yes: Schema.Finite,
});
type Answered = typeof Answered.Type;
const SpentRow = Schema.Struct({
	at: Schema.String,
	calls: Schema.Int,
	input: Schema.Int,
	output: Schema.Int,
	usd: Schema.Finite,
	ms: Schema.Finite,
});
const Results = Schema.Struct({
	model: Schema.String,
	answers: Schema.Array(Answered),
	runs: Schema.Array(SpentRow),
	/** Where the filter put each labelled precedent: its best rank among the 20, or null if cut. */
	recall: Schema.optional(Schema.Unknown),
	report: Schema.optional(Schema.Unknown),
});
type Results = typeof Results.Type;
const loadFrom = (file: string): Results =>
	existsSync(file) ? readJson(file, Results) : {model: DEFAULT_JEV_MODEL, answers: [], runs: []};
const load = () => loadFrom(RESULTS);

const only = process.env.ONLY?.split(",").map(Number);
const allPairs = () =>
	asked.filter((a) => only === undefined || only.includes(a.n)).flatMap((a) => pairsOf(a.n));

/** About four characters a token, plus the question and its criteria (about 250 tokens) a call. */
const estimate = (pairs: readonly Pair[]) => {
	const chars = pairs.reduce((s, p) => s + p.texts.new.length + p.texts.earlier.length, 0);
	const tokens = chars / 4 + pairs.length * 250;
	return {tokens: Math.round(tokens), usd: tokens * 0.042e-6};
};

if (STEP === "plan") {
	const pairs = allPairs();
	const e = estimate(pairs);
	console.log(
		`${pairs.length} pairs over ${new Set(pairs.map((p) => p.n)).size} asked tickets: about ${e.tokens} tokens in, about $${e.usd.toFixed(3)}`,
	);
	for (const [k, l] of Object.entries(LABELS)) {
		const ranks = pairsOf(Number(k))
			.filter((p) => l.right.includes(p.of))
			.map((p) => p.rank);
		console.log(
			`  #${k}: precedent at filter rank ${ranks.length === 0 ? "cut" : Math.min(...ranks)}`,
		);
	}
	const first = pairs[0];
	if (first !== undefined && process.env.SHOW === "1")
		console.log(`\n--- ${first.key}\nnew:\n${first.texts.new}\n\nearlier:\n${first.texts.earlier}`);
	process.exit(0);
}

if (STEP === "run") {
	const results = load();
	const done = new Set(results.answers.map((a) => a.key));
	const todo = allPairs().filter((p) => !done.has(p.key));
	const e = estimate(todo);
	const cap = Number(process.env.MAX_USD ?? 0.5);
	console.log(`${todo.length} pairs to ask, about $${e.usd.toFixed(3)}; cap $${cap}`);
	if (e.usd > 2) throw new Error("the estimate passes $2: stop and report");
	const ask = (p: Pair) =>
		(QUESTION === "duplicate"
			? duplicateJudge.judge(results.model, {new: p.texts.new, existing: p.texts.earlier})
			: (QUESTION === "sibling" ? siblingJudge : precedentJudge).judge(results.model, p.texts)
		).pipe(
			Effect.retry({times: 3, schedule: Schedule.exponential("1 second")}),
			Effect.map(({yes}): Answered => ({key: p.key, n: p.n, of: p.of, rank: p.rank, yes})),
		);
	const program = Effect.gen(function* () {
		const got = yield* Effect.forEach(todo, (p) => Effect.option(ask(p)), {concurrency: 8});
		const spent = yield* (yield* JevReceipts).spent;
		return {got, spent};
	});
	const {got, spent} = await Effect.runPromise(
		program.pipe(
			Effect.provide(Layer.provide(jevFromConfig({calls: 4_000, usd: cap}), FetchHttpClient.layer)),
		),
	);
	const answers = got.flatMap((a) => (a._tag === "Some" ? [a.value] : []));
	writeJson(RESULTS, {
		...results,
		answers: [...results.answers, ...answers],
		runs: [...results.runs, {at: new Date().toISOString(), ...spent}],
	});
	console.log(`${answers.length} of ${todo.length} answered`);
	console.log(receiptLine(spent));
	for (const a of answers.toSorted((x, y) => y.yes - x.yes).slice(0, 12))
		console.log(
			`  ${a.yes.toFixed(2)} ${a.key} ${LABELS[a.n]?.right.includes(a.of) ? "precedent" : ""}`,
		);
	process.exit(0);
}

const results = load();

if (STEP === "field") {
	const s = results.runs.reduce(
		(t, r) => ({
			calls: t.calls + r.calls,
			input: t.input + r.input,
			output: t.output + r.output,
			usd: t.usd + r.usd,
			ms: t.ms + r.ms,
		}),
		spentOf([]),
	);
	console.log(
		JSON.stringify({
			date: (results.runs.at(-1)?.at ?? "").slice(0, 10),
			lane: null,
			role: "hand",
			model: results.model,
			effort: null,
			outcome: "pass",
			why: `experiment 163 part 6: the precedent hint (${QUESTION === "duplicate" ? "the shipped duplicate question word for word" : `the ${QUESTION} question`}), the shipped duplicate-hint filter over phoenix tickets settled before each of part 4's ${asked.length} asked tickets, ${s.calls} calls through the live Jev Layer in ${results.runs.length} runs, no agent; tokens is one call's mean size, billed is every token (${s.input} input, ${s.output} output), costUsd from the Layer's receipts; posted nothing`,
			tokens: Math.round((s.input + s.output) / Math.max(1, s.calls)),
			tools: null,
			minutes: null,
			note: null,
			costUsd: +s.usd.toFixed(4),
			billed: s.input + s.output,
			jev: s.calls,
		}),
	);
	process.exit(0);
}

if (STEP !== "report") {
	console.error(`unknown STEP ${STEP}`);
	process.exit(1);
}

// ---------------------------------------------------------------- the report

/** What one way of hinting shows on one ask: the earlier tickets, best first. */
type Shown = readonly number[];
interface Tally {
	readonly withPrecedent: number;
	readonly top1: number;
	readonly top3: number;
	/** A wrong (reversed or contrary) ruling shown above every right one. */
	readonly misled: number;
	readonly without: number;
	/** Asks without a precedent that got any hint. */
	readonly falseHint: number;
	/** Of those, the ones whose hint is a like ticket settled the other way. */
	readonly contrary: number;
	readonly hits: readonly number[];
	readonly falses: readonly number[];
}
const tally = (shownOf: (n: number) => Shown | null, sureOnly = false): Tally => {
	const ns = asked.map((a) => a.n).filter((n) => shownOf(n) !== null);
	const withP = ns.filter((n) => LABELS[n] !== undefined && (!sureOnly || LABELS[n]?.sure));
	const without = ns.filter((n) => LABELS[n] === undefined);
	const rightAt = (n: number) => {
		const l = LABELS[n] as Label;
		return (shownOf(n) as Shown).findIndex((x) => l.right.includes(x));
	};
	const wrongAt = (n: number) => {
		const l = LABELS[n] as Label;
		return (shownOf(n) as Shown).findIndex((x) => (l.wrong ?? []).includes(x));
	};
	const hits = withP.filter((n) => rightAt(n) === 0);
	const falses = without.filter((n) => (shownOf(n) as Shown).length > 0);
	return {
		withPrecedent: withP.length,
		top1: hits.length,
		top3: withP.filter((n) => rightAt(n) >= 0 && rightAt(n) < 3).length,
		misled: withP.filter((n) => wrongAt(n) >= 0 && (rightAt(n) < 0 || wrongAt(n) < rightAt(n)))
			.length,
		without: without.length,
		falseHint: falses.length,
		contrary: falses.filter((n) => (shownOf(n) as Shown).some((x) => CONTRARY[n]?.includes(x)))
			.length,
		hits,
		falses,
	};
};

const scoresBy = Map.groupBy(results.answers, (a) => a.n);
/** Every question that has answers, with its run and its scores by asked ticket. */
const asks = QUESTIONS.map((q) => {
	const run = q === "precedent" ? results : loadFrom(resultsOf(q));
	return {q, run, by: Map.groupBy(run.answers, (a) => a.n)};
}).filter((x) => x.run.answers.length > 0);
/**
 * Jev's hints on an ask, or null when some of its pairs were never answered. A floor below 0
 * shows Jev's top three whatever they scored: its ranking alone.
 */
const jevShown =
	(floor: number, by = scoresBy) =>
	(n: number) => {
		const xs = by.get(n) ?? [];
		if (xs.length === 0 || xs.length < shortlistOf(n).length) return null;
		return hintsOf(
			xs.map((a): Scored => ({of: a.of as Scored["of"], yes: a.yes})),
			floor,
			TOP,
		).map((h) => h.of);
	};

// Part 5's three, on the same labels: each shows at most one earlier ticket.
const Part5 = Schema.Struct({
	match: Schema.Array(
		Schema.Struct({
			n: Schema.Int,
			model: Schema.String,
			shown: Schema.Array(Schema.Struct({n: Schema.Int, score: Schema.Number})),
			kind: Schema.NullOr(Schema.String),
			cites: Schema.NullOr(Schema.Int),
		}),
	),
});
const part5 = readJson(PART5, Part5).match;
const matcherShown = (model: string) => (n: number) => {
	const m = part5.find((x) => x.n === n && x.model === model);
	return m === undefined ? null : m.cites === null ? [] : [m.cites];
};
const lexicalShown = (floor: number) => (n: number) => {
	const top = part5.find((x) => x.n === n)?.shown[0];
	return top === undefined ? null : top.score >= floor ? [top.n] : [];
};
/** The shipped filter alone, no Jev: its top three. Shows something on every ask. */
const filterShown = (n: number) =>
	shortlistOf(n)
		.slice(0, 3)
		.map((c) => c.number);

const ways: Record<string, (n: number) => Shown | null> = {
	...Object.fromEntries(
		asks.flatMap(({q, by}) => [
			...FLOORS.map((f) => [`${q} question at ${f}`, jevShown(f, by)] as const),
			[`${q} question ranking, no floor`, jevShown(-1, by)] as const,
		]),
	),
	"part 5 haiku": matcherShown("haiku"),
	"part 5 sonnet": matcherShown("sonnet"),
	"part 5 text match at 0.3": lexicalShown(0.3),
	"part 5 text match at 0.4": lexicalShown(0.4),
	"filter alone, top 3": filterShown,
};
const table: Record<string, Tally & {sure: Pick<Tally, "withPrecedent" | "top1" | "top3">}> = {};
for (const [name, f] of Object.entries(ways)) {
	const t = tally(f);
	const s = tally(f, true);
	table[name] = {...t, sure: {withPrecedent: s.withPrecedent, top1: s.top1, top3: s.top3}};
	console.log(
		`${name}: with a precedent ${t.withPrecedent}: top 1 ${t.top1}, top 3 ${t.top3}, misled ${t.misled} (sure only ${s.top1}/${s.top3} of ${s.withPrecedent}); without ${t.without}: a false hint on ${t.falseHint} (${t.contrary} pointing the other way)`,
	);
}

// Where the filter put each labelled precedent, and what Jev scored it.
const recall = Object.entries(LABELS).map(([k, l]) => {
	const n = Number(k);
	const pairs = pairsOf(n).filter((p) => l.right.includes(p.of));
	const scored = (scoresBy.get(n) ?? []).toSorted((a, b) => b.yes - a.yes);
	const best = scored.find((a) => l.right.includes(a.of));
	const wrong = scored.find((a) => (l.wrong ?? []).includes(a.of));
	return {
		n,
		sure: l.sure,
		rank: pairs.length === 0 ? null : Math.min(...pairs.map((p) => p.rank)),
		yes: best === undefined ? null : +best.yes.toFixed(3),
		place: best === undefined ? null : scored.indexOf(best) + 1,
		wrongYes: wrong === undefined ? null : +wrong.yes.toFixed(3),
		top: scored[0] === undefined ? null : {of: scored[0].of, yes: +scored[0].yes.toFixed(3)},
	};
});
console.log("\nthe labelled asks: filter rank, Jev's best score on a precedent, and its place");
for (const r of recall)
	console.log(
		`  #${r.n}${r.sure ? "" : " (unsure)"}: filter rank ${r.rank ?? "cut"}, yes ${r.yes ?? "-"}, place ${r.place ?? "-"}${r.wrongYes === null ? "" : `, wrong ruling ${r.wrongYes}`}; Jev's top #${r.top?.of} at ${r.top?.yes}`,
	);
console.log("\nthe surest hints on asks without a precedent:");
for (const a of results.answers
	.filter((x) => LABELS[x.n] === undefined)
	.toSorted((x, y) => y.yes - x.yes)
	.slice(0, 15))
	console.log(
		`  ${a.yes.toFixed(2)} #${a.n} > #${a.of}${CONTRARY[a.n]?.includes(a.of) ? " (settled the other way)" : ""}: ${titleOf.get(a.n)?.slice(0, 70)} / ${titleOf.get(a.of)?.slice(0, 70)}`,
	);

/**
 * Is there any floor that would work? The best score on an ask without a precedent sets the
 * lowest floor with no false hint; count the asks whose precedent scores above it.
 */
const separation = (by: Map<number, readonly Answered[]>) => {
	const topOf = (n: number) => Math.max(0, ...(by.get(n) ?? []).map((a) => a.yes));
	const noneTop = asked
		.filter((a) => LABELS[a.n] === undefined)
		.map((a) => topOf(a.n))
		.toSorted((a, b) => b - a);
	const rightTop = Object.entries(LABELS).map(([k, l]) =>
		Math.max(
			0,
			...(by.get(Number(k)) ?? []).filter((a) => l.right.includes(a.of)).map((a) => a.yes),
		),
	);
	const floor = noneTop[0] ?? 0;
	return {
		noneTop: noneTop.slice(0, 5).map((x) => +x.toFixed(3)),
		rightMedian: +(
			rightTop.toSorted((a, b) => a - b)[Math.floor(rightTop.length / 2)] ?? 0
		).toFixed(3),
		aboveEveryNone: rightTop.filter((x) => x > floor).length,
	};
};
const separations = Object.fromEntries(asks.map(({q, by}) => [q, separation(by)]));
for (const [q, s] of Object.entries(separations))
	console.log(
		`\n${q} question: best scores on asks without a precedent ${s.noneTop.join(", ")}; a precedent's best score, median ${s.rightMedian}; precedents above every ask without one: ${s.aboveEveryNone} of ${Object.keys(LABELS).length}`,
	);

const spentOfRuns = (rs: Results) =>
	rs.runs.reduce(
		(t, r) => ({
			calls: t.calls + r.calls,
			input: t.input + r.input,
			output: t.output + r.output,
			usd: t.usd + r.usd,
			ms: t.ms + r.ms,
		}),
		spentOf([]),
	);
const spent = Object.fromEntries(asks.map(({q, run}) => [q, spentOfRuns(run)]));
for (const [q, s] of Object.entries(spent)) console.log(`${q}: ${receiptLine(s)}`);
writeJson(RESULTS, {
	...results,
	recall,
	report: {
		note: "Experiment 163, part 6. Jev's yes on each pair (an asked ticket of part 4, an earlier phoenix ticket settled before it was filed, picked by the shipped duplicate-hint filter), and every way of hinting against the hand labels in 163-precedent-hint.ts. The duplicate and sibling questions' answers are in 163-precedent-hint-duplicate.json and 163-precedent-hint-sibling.json.",
		labelled: Object.keys(LABELS).length,
		asked: asked.length,
		ways: table,
		separations,
		spent,
	},
});
console.log(`wrote ${RESULTS}`);
