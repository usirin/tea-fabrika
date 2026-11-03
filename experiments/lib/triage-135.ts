// Experiment 135's cases, briefs and scoring, shared by 135 (Claude models) and 159 (GPT sol through
// Codex), so the only thing that changes between them is the model and the harness. Moved out of
// `135-triage-models.ts` unchanged; that script's tables print the same after the move.
//
//   group p  kamp-us/phoenix, experiment 92b's tickets and its "both" brief.
//   group d  kamp-us/demlik, today's sort brief and Check, with experiment 133's world.
//
// Node at the edge, said out loud: `node:fs` to read the truth and saved-answer files.
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
	type Said as DSaid,
	saidOf as dSaidOf,
	type SortAnswer,
	type SortReply,
} from "@kampus/pipeline/stages/sort/answer";
import type {Brief} from "@kampus/pipeline/stages/sort/brief";
import type {OpenPlan} from "@kampus/pipeline/stages/sort/services";
import {Schema} from "effect";
import {shuffled} from "./review-rounds.ts";
import {barLines, readBar, withClauses} from "./sort-bar.ts";
import {
	type Earlier,
	Run as PRunBase,
	type Said as PSaid,
	type SortAnswer as PSortAnswer,
	promptOf,
	saidOf as pSaidOf,
	REPO_NOTE,
	Ticket,
	Truth,
} from "./sort.ts";

const here = join(import.meta.dirname, "..");

// ---------------------------------------------------------------- the cases

export const truth92b = Schema.decodeUnknownSync(Truth)(
	JSON.parse(readFileSync(join(here, "92b-truth.json"), "utf8")),
).tickets;
export const truth88 = Schema.decodeUnknownSync(Truth)(
	JSON.parse(readFileSync(join(here, "88-truth.json"), "utf8")),
).tickets;
const Truth133 = Schema.Struct({
	fold: Schema.Record(Schema.String, Schema.Struct({into: Schema.Array(Schema.Int)})),
	control: Schema.Record(Schema.String, Schema.Struct({near: Schema.Array(Schema.Int)})),
});
export const truth133 = Schema.decodeUnknownSync(Truth133, {onExcessProperty: "ignore"})(
	JSON.parse(readFileSync(join(here, "133-truth.json"), "utf8")),
);

const SavedPAnswers = Schema.Record(Schema.String, Schema.Array(PRunBase));
/** 92b's answers with its "both" brief, and 88's with its own brief and the bare run, and 92's "both". */
export const saved92b = Schema.decodeUnknownSync(Schema.Struct({both: SavedPAnswers}), {
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
export const P_KIND = {
	text: [
		7318, 7344, 8242, 8259, 8320, 8327, 8501, 9727, 10138, 10142, 8496, 8587, 8785, 8826, 9890,
		10128, 10144, 10214,
	],
	line: [7216, 8141, 8246, 8338, 8577, 9951, 10236, 8537, 10463],
	code: [7986, 10139],
} as const;
/** The 6 real "no"s 92b's "both" brief closed in both runs. */
export const P_CAUGHT = Object.keys(truth92b)
	.map(Number)
	.filter(
		(n) =>
			truth92b[n]?.next === "no" &&
			!Object.values(P_KIND)
				.flat()
				.includes(n as never),
	);
/** Built tickets 92b's "both" brief said "no" or "duplicate" to at least once. */
export const P_FALSE_NO = [2563, 2792, 6457, 7750, 2915];
const SEED = 135;
const pAllRight = (n: number) => {
	const runs = saved92b[n] ?? [];
	return (
		runs.length > 0 &&
		runs.every((r) => r.answer !== null && pSaidOf(r.answer.sort) === truth92b[n]?.next)
	);
};
/** Keep right, phoenix: a seeded draw of 5 built tickets 92b's "both" brief routed right both times. */
export const P_KEEP = shuffled(
	Object.keys(truth92b)
		.map(Number)
		.filter((n) => ["plan", "ruling", "research"].includes(truth92b[n]?.next ?? ""))
		.filter((n) => !P_FALSE_NO.includes(n) && pAllRight(n)),
	SEED,
)
	.slice(0, 5)
	.toSorted((a, b) => a - b);

export const FOLDS = Object.keys(truth133.fold).map(Number);
/** 133: filed within 21 seconds of their target, by the same filer, in one batch. */
export const BATCH = [21, 389, 390, 391, 392, 413, 424, 425, 426];
export const LATER = FOLDS.filter((n) => !BATCH.includes(n));
export const CONTROLS = Object.keys(truth133.control).map(Number);
/** 88's misses on tickets that really were a yes: ruling against plan, mostly. */
export const D_ROUTE = [248, 272, 316, 320, 323, 604];
/** 88's other misses: two duplicates only the code shows, three "no"s today's bar has no rule for. */
export const D_OTHER = [173, 295, 319, 615, 633];
const d88AllRight = (n: number) => {
	const runs = [...(saved88.runs[n] ?? []), ...(saved88.bare[n] ?? []), ...(saved92[n] ?? [])];
	return (
		runs.length > 0 &&
		runs.every((r) => r.answer !== null && pSaidOf(r.answer.sort) === truth88[n]?.next)
	);
};
/** Keep right, demlik: a seeded draw of 5 real yeses 88 routed right in all six saved answers. */
export const D_KEEP = shuffled(
	Object.keys(truth88)
		.map(Number)
		.filter((n) => ["plan", "ruling", "research"].includes(truth88[n]?.next ?? ""))
		.filter((n) => !CONTROLS.includes(n) && d88AllRight(n)),
	SEED,
)
	.slice(0, 5)
	.toSorted((a, b) => a - b);

export const SETS = {
	p: {
		misses: [...Object.values(P_KIND).flat(), ...P_FALSE_NO],
		controls: [] as number[],
		keep: [...P_CAUGHT, ...P_KEEP],
	},
	d: {misses: [...FOLDS, ...D_ROUTE, ...D_OTHER], controls: CONTROLS, keep: D_KEEP},
} as const;
export const PICKED = {
	p: [...SETS.p.misses, ...SETS.p.keep],
	d: [...SETS.d.misses, ...SETS.d.controls, ...SETS.d.keep],
} as const;
export const REPOS = {p: "kamp-us/phoenix", d: "kamp-us/demlik"} as const;

// ---------------------------------------------------------------- the briefs

/** What phoenix is, as experiment 92b put it. */
export const PHOENIX_NOTE = [
	"The repo is kamp-us/phoenix, a pnpm monorepo:",
	"- kamp.us: a Turkish-first community site (a link board and a dictionary), one Cloudflare Worker that serves the web app and its backend.",
	"- fabrika: the agent work pipeline, a Claude Code plugin of skills plus fabrika-cli, its command-line tool. Its home is this repo; other repos use it.",
	"- Tuval: a desktop app for running and watching coding agents.",
	"- Smaller packages: a design system, and guards and scripts the CI runs.",
	"Work is done by agents: a builder turns a ticket into a pull request, a reviewer checks it, a shipper merges it. The repo's owners make the calls that need a person.",
].join("\n");
/** 92b's "both": the drafted bar plus the written clauses. */
export const P_BAR_BOTH = withClauses(
	readBar(join(here, "92-value-bar.json")),
	readBar(join(here, "92-written-bar.json")),
);
/** The bar as 92b's brief states it, examples without demlik's numbers. */
const P_BAR = barLines(P_BAR_BOTH, {numbers: false});
/** Experiment 161's security line, as a "still a yes" clause after 92b's "a person filed it". */
export const SECURITY = {
	id: "a-security-gap-is-not-hardening",
	rule: "A security gap is not hardening. A hole in who may see or do what, or a secret that could leak into a log or an error message, is a yes even if nobody has used it yet: a hole nobody has used is still a hole.",
	example: {what: "a webhook that takes a request without checking its signature"},
	evidence: ["experiment 159: #2563 and #8010, closed by GPT sol, built by the project"],
} as const;
/** 92b's "both" bar with 161's security line, as 161 and 162 state it. */
export const P_BAR_SECURITY = barLines(
	withClauses(P_BAR_BOTH, {note: "", no: [], stillYes: [SECURITY]}),
	{numbers: false},
);
/** As in 92b: the 200 tickets filed just before, by number. */
const P_WINDOW = 200;
const pEarlier = (all: readonly Earlier[], t: Ticket) =>
	all
		.filter((e) => e.n < t.n)
		.toSorted((a, b) => b.n - a.n)
		.slice(0, P_WINDOW);
/** 92b's prompt for one phoenix ticket; `bar` swaps in other bar lines (experiment 161 adds one). */
export const pPrompt = (all: readonly Earlier[], t: Ticket, bar: readonly string[] = P_BAR) =>
	promptOf(t, t.body, pEarlier(all, t), bar, PHOENIX_NOTE);

export const Listed = Schema.Struct({
	n: Schema.Int,
	title: Schema.String,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
});
export type Listed = typeof Listed.Type;
export const DCache = Schema.Struct({
	tickets: Schema.Array(Ticket),
	/** The first revision of every ticket open when a picked ticket was filed. */
	plans: Schema.Array(Ticket),
	all: Schema.Array(Listed),
});
export type DCache = typeof DCache.Type;
export const openAt = (i: Listed, t: string) =>
	i.createdAt < t && (i.closedAt === null || i.closedAt > t);
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
export function dBrief(cache: DCache, t: Ticket): Brief {
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

// ---------------------------------------------------------------- the scoring

/** What scoring reads of a phoenix answer, and of a demlik run (its last try counts). */
export interface PAnswered {
	readonly answer: PSortAnswer | null;
}
export interface DAnswered {
	readonly tries: readonly {readonly answer: SortReply | null}[];
}

/** An answer by its outcome's name, as the sort stage prints it. */
export const OUTCOME: Record<DSaid, string> = {
	duplicate: "done:closed:duplicate",
	no: "done:closed:no",
	plan: "send:plan:yes",
	fold: "send:plan:fold",
	research: "send:research:yes",
	ruling: "ask:owner:ruling",
};

/** A demlik answer in one word, with its target: `fold #388`, `duplicate #20`, `no:carried`. */
export function dWord(a: SortAnswer): string {
	if (a.answer === "duplicate") return `duplicate #${a.of}`;
	if (a.answer === "no") return `no:${a.rule}`;
	if (a.next === "plan") return a.partOf === null ? "plan" : `fold #${a.partOf}`;
	return a.next;
}
export const dLast = (r: DAnswered) => r.tries.at(-1)?.answer?.sort ?? null;
export const dSaid = (r: DAnswered): DSaid | null => {
	const a = dLast(r);
	return a === null ? null : dSaidOf(a);
};
export const pSaid = (r: PAnswered): PSaid | null =>
	r.answer === null ? null : pSaidOf(r.answer.sort);

/** Is a demlik answer the one the ticket really needed? Pure. */
export function dRight(n: number, r: DAnswered): boolean {
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
export function dWrongNo(n: number, r: DAnswered): boolean {
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
export const pRealNo = (n: number) => truth92b[n]?.next === "no";
export const pRight = (n: number, r: PAnswered) => {
	const s = pSaid(r);
	return pRealNo(n) ? s === "no" || s === "dup" : s === truth92b[n]?.next;
};
export const pWrongNo = (n: number, r: PAnswered) => {
	const s = pSaid(r);
	return !pRealNo(n) && truth92b[n]?.next !== "dup" && (s === "no" || s === "dup");
};

export function truthWord(n: number): string {
	const f = truth133.fold[n];
	if (f !== undefined) return `fold into #${f.into.join(" or #")}`;
	if (truth133.control[n] !== undefined) return "a plan of its own";
	const t = truth88[n];
	if (t?.next === "dup") return `duplicate of #${t.dupOf}`;
	return t?.next ?? "unknown";
}
