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
const RESULTS = join(here, "results", "163-precedent-hint.json");
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
/** The shipped filter over that pool: at most 20, the rarest shared words first. */
const shortlistOf = (n: number) => candidatesOf(filedOf(n), poolOf(n), MAX_CANDIDATES);

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
