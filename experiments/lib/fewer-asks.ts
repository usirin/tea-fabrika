// Experiment 163, part 5: fewer asks without looser closes. Pure: the answers as part 4 saved them,
// four rewrites of them (a security code rule, a past ruling, keep when cheap, a bundle), and the
// numbers each rewrite leaves against the proposed bar. No platform import.
import {Schema} from "effect";
import type {Verdict} from "./brief-eval.ts";

/** One part 4 answer, with what part 5 needs to rewrite it. */
export interface Answer {
	readonly case: string;
	readonly n: number;
	/** `model|set`, as part 4 grouped them. */
	readonly group: string;
	readonly run: number;
	readonly said: "close" | "keep" | "ask";
	/** The answer's why: a close fact, a keep reason, an ask reason, or `precedent` / `cheap`. */
	readonly why: string;
	readonly really: Verdict;
	readonly security: boolean;
	readonly filed: string;
	readonly trace: string;
	/** The ticket a precedent answer cites. */
	readonly cites?: number;
}

/** Phoenix's filing rate, from part 4's `STEP=load`: 2,468 issues in the 60 days to 2026-10-30. */
export const PER_WEEK = (2468 / 60) * 7;

// ---------------------------------------------------------------- the four rewrites

/** The code rule: a security ticket always becomes an ask, whatever the model said. */
export const securityRule = (xs: readonly Answer[]): Answer[] =>
	xs.map((a) => (a.security && a.said !== "ask" ? {...a, said: "ask", why: "security"} : a));

/** A past ruling that decides a ticket: the verdict to apply and the ticket it came from. */
export interface Ruling {
	readonly verdict: Verdict;
	readonly cites: number;
}

/**
 * Follow past rulings: a non-security ask whose ticket has a ruling becomes that verdict, citing
 * the earlier ticket. A security ask stays an ask, whether the label or the model called it
 * security: the owner decides every security ticket.
 */
export const followRulings = (
	xs: readonly Answer[],
	rulingOf: (n: number) => Ruling | null,
): Answer[] =>
	xs.map((a) => {
		if (a.said !== "ask" || a.security || a.why === "security") return a;
		const r = rulingOf(a.n);
		return r === null ? a : {...a, said: r.verdict, why: "precedent", cites: r.cites};
	});

/** Keep when it is cheap: every worth ask becomes a keep, so the ticket is built without asking. */
export const keepWorth = (xs: readonly Answer[]): Answer[] =>
	xs.map((a) => (a.said === "ask" && a.why === "worth" ? {...a, said: "keep", why: "cheap"} : a));

// ---------------------------------------------------------------- bundles

/** What the bundle rule reads off one ask. */
export interface AskInfo {
	readonly n: number;
	readonly filed: string;
	/** Ticket numbers its first body or its trace names. */
	readonly names: readonly number[];
	/** Open pull requests its trace names that were in its own open list. */
	readonly prs: readonly number[];
	/** The first file path its trace names, line numbers dropped; null when it names none. */
	readonly file: string | null;
}

/**
 * The keys one decision could settle an ask by, fixed before any bundle was read: its own number,
 * every number its body or trace names, each open pull request its trace names, its first file.
 */
const keysOf = (i: AskInfo) => [
	`#${i.n}`,
	...i.names.map((n) => `#${n}`),
	...i.prs.map((p) => `pr ${p}`),
	...(i.file === null ? [] : [`file ${i.file}`]),
];

/** Two asks share a key. */
export const linked = (a: AskInfo, b: AskInfo) => {
	const kb = new Set(keysOf(b));
	return keysOf(a).some((k) => kb.has(k));
};

/**
 * The main rule: a bundle is the asks that share one key, the most shared key first, each ask in
 * one bundle. Pure.
 */
export function keyBundles(asks: readonly AskInfo[]): {key: string; ns: number[]}[] {
	let left = [...asks];
	const out: {key: string; ns: number[]}[] = [];
	while (left.length > 0) {
		const count = new Map<string, number>();
		for (const a of left) for (const k of new Set(keysOf(a))) count.set(k, (count.get(k) ?? 0) + 1);
		const [key] = [...count.entries()].toSorted(
			(x, y) => y[1] - x[1] || x[0].localeCompare(y[0]),
		)[0] as [string, number];
		const take = left.filter((a) => keysOf(a).includes(key));
		out.push({key, ns: take.map((a) => a.n)});
		left = left.filter((a) => !take.includes(a));
	}
	return out;
}

/** The looser count: connected sets under `linked`, chains through a third ask included. */
export function bundles(
	asks: readonly AskInfo[],
	linked: (a: AskInfo, b: AskInfo) => boolean,
): number[][] {
	const parent = asks.map((_, i) => i);
	const root = (i: number): number => {
		let r = i;
		while (parent[r] !== r) r = parent[r] as number;
		return r;
	};
	for (let i = 0; i < asks.length; i++)
		for (let j = i + 1; j < asks.length; j++)
			if (linked(asks[i] as AskInfo, asks[j] as AskInfo)) parent[root(i)] = root(j);
	const groups = Map.groupBy(
		asks.map((a, i) => ({a, r: root(i)})),
		(x) => x.r,
	);
	return [...groups.values()].map((g) => g.map((x) => x.a.n));
}

// ---------------------------------------------------------------- the bar

/** The proposed bar of part 4, as numbers. */
export const BAR = {
	wrongClose: 1 / 30,
	securityClosed: 0,
	wrongKeep: 0.1,
	answerable: 12 / 15,
	asksAWeek: 50,
} as const;

/** One group's numbers against the bar. Tickets count once if any run gave that answer. */
export function barOf(xs: readonly Answer[]) {
	const tickets = (p: (a: Answer) => boolean) => new Set(xs.filter(p).map((a) => a.case)).size;
	const keeps = new Set(xs.filter((a) => a.really === "keep").map((a) => a.case)).size;
	const closes = new Set(xs.filter((a) => a.really === "close").map((a) => a.case)).size;
	const wrongClose = tickets((a) => a.said === "close" && a.really === "keep");
	const securityClosed = tickets((a) => a.said === "close" && a.security && a.really === "keep");
	const wrongKeep = tickets((a) => a.said === "keep" && a.really === "close");
	const asks = xs.filter((a) => a.said === "ask").length;
	return {
		answers: xs.length,
		wrongClose: {tickets: wrongClose, of: keeps, pass: wrongClose / keeps <= BAR.wrongClose},
		securityClosed: {tickets: securityClosed, pass: securityClosed === BAR.securityClosed},
		wrongKeep: {tickets: wrongKeep, of: closes, pass: wrongKeep / closes <= BAR.wrongKeep},
		asks: {answers: asks, share: asks / xs.length, aWeek: (PER_WEEK * asks) / xs.length},
		rightCloses: xs.filter((a) => a.said === "close" && a.really === "close").length,
		precedent: {
			answers: xs.filter((a) => a.why === "precedent").length,
			wrong: xs.filter((a) => a.why === "precedent" && a.said !== a.really).length,
		},
	};
}
export type BarNumbers = ReturnType<typeof barOf>;

// ---------------------------------------------------------------- keep when it is cheap

/** Median, smallest and largest. */
export const spread = (xs: readonly number[]) => {
	const s = xs.toSorted((a, b) => a - b);
	const mid =
		s.length === 0
			? 0
			: s.length % 2 === 1
				? (s[s.length >> 1] as number)
				: ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
	return {n: s.length, median: mid, low: s[0] ?? 0, high: s.at(-1) ?? 0};
};

/**
 * Keeping a worth ask without asking wastes a build when the ticket should have been closed, which
 * happens on a share `p` of worth asks. Asking costs 30 seconds of the owner. Keeping wins when 30
 * seconds of the owner is worth more than `p` times a build's cost.
 */
export const breakEven = (p: number, buildUsd: number) => p * buildUsd;

// ---------------------------------------------------------------- the precedent match

/** A matcher's answer: which earlier ticket's ruling decides this one, if any. */
export const MatchAnswer = Schema.Struct({
	match: Schema.Union([
		Schema.Struct({kind: Schema.Literal("none"), why: Schema.String}),
		Schema.Struct({kind: Schema.Literal("rule"), n: Schema.Int, why: Schema.String}),
		Schema.Struct({kind: Schema.Literal("same"), n: Schema.Int, why: Schema.String}),
	]),
});
export type MatchAnswer = typeof MatchAnswer.Type;

/** One matcher call, saved. */
export const MatchRecord = Schema.Struct({
	n: Schema.Int,
	model: Schema.String,
	modelId: Schema.String,
	/** The earlier tickets it was shown, best lexical match first, with each one's score. */
	shown: Schema.Array(Schema.Struct({n: Schema.Int, score: Schema.Number})),
	kind: Schema.NullOr(Schema.Literals(["none", "rule", "same"])),
	cites: Schema.NullOr(Schema.Int),
	why: Schema.NullOr(Schema.String),
	usd: Schema.NullOr(Schema.Number),
	ms: Schema.Number,
	tokens: Schema.Struct({input: Schema.Number, cached: Schema.Number, output: Schema.Number}),
	error: Schema.NullOr(Schema.String),
	at: Schema.String,
});
export type MatchRecord = typeof MatchRecord.Type;

/** A match's verdict: `same` asks for work already ruled on, so it closes; `rule` takes the ruling. */
export const rulingFrom = (m: MatchRecord, verdictOf: (n: number) => Verdict): Ruling | null =>
	m.kind === "rule" && m.cites !== null
		? {verdict: verdictOf(m.cites), cites: m.cites}
		: m.kind === "same" && m.cites !== null
			? {verdict: "close", cites: m.cites}
			: null;

// ---------------------------------------------------------------- lexical candidates

const STOP = new Set(
	"the and for that this with from are was not but have has its into when then than they them their there what which while where will would should could does done each only also more most some such very just like over under about after before because between both other these those your you our can may any all one two new old".split(
		" ",
	),
);
/** Words of three letters or more, lower case, with no stop words. Pure. */
export const wordsOf = (text: string): string[] =>
	(text.toLowerCase().match(/[a-z0-9_][a-z0-9_.-]{2,}/g) ?? [])
		.map((w) => w.replace(/[.-]+$/, ""))
		.filter((w) => w.length >= 3 && !STOP.has(w));

/** A tf-idf vector space over a set of texts; `cosine` of two of them. Uses no label. */
export function lexicon(texts: ReadonlyMap<number, string>) {
	const df = new Map<string, number>();
	const tf = new Map<number, Map<string, number>>();
	for (const [n, text] of texts) {
		const counts = new Map<string, number>();
		for (const w of wordsOf(text)) counts.set(w, (counts.get(w) ?? 0) + 1);
		tf.set(n, counts);
		for (const w of counts.keys()) df.set(w, (df.get(w) ?? 0) + 1);
	}
	const size = texts.size;
	const vec = new Map<number, Map<string, number>>();
	for (const [n, counts] of tf) {
		const v = new Map<string, number>();
		let norm = 0;
		for (const [w, c] of counts) {
			const x = (1 + Math.log(c)) * Math.log(size / (df.get(w) ?? 1));
			v.set(w, x);
			norm += x * x;
		}
		const len = Math.sqrt(norm) || 1;
		for (const [w, x] of v) v.set(w, x / len);
		vec.set(n, v);
	}
	return {
		cosine: (a: number, b: number) => {
			const va = vec.get(a);
			const vb = vec.get(b);
			if (va === undefined || vb === undefined) return 0;
			let s = 0;
			for (const [w, x] of va) s += x * (vb.get(w) ?? 0);
			return s;
		},
	};
}

// ---------------------------------------------------------------- reading a trace

/** The first file path a trace names: a slash and a file ending, line numbers dropped. Pure. */
export const firstFileOf = (trace: string): string | null =>
	/(?:[\w.@-]+\/)+[\w.@-]+\.[a-z]{1,5}\b/i.exec(trace)?.[0] ?? null;

/** Every `#n` a text names. Pure. */
export const numbersOf = (text: string): number[] =>
	[...text.matchAll(/#(\d{1,6})\b/g)].map((m) => Number(m[1]));
