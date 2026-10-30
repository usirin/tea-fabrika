// Experiment 163, part 4: triage with three answers. The model closes only on a fact it shows, keeps
// a clear serious fault or a feature, and asks the owner on everything that turns on worth. Pure:
// the answer's shape, one answer as a record, and the numbers. No platform import.
import {Schema} from "effect";
import {type Brief, Tokens, Verdict} from "./brief-eval.ts";

/** Why a ticket stays open without asking. */
export const KEEP_WHY = ["fault", "feature"] as const;
/** Why the owner is asked: worth, a security ticket (always), or a trace that does not settle it. */
export const ASK_WHY = ["worth", "security", "unclear"] as const;
export type AskWhy = (typeof ASK_WHY)[number];

/** The answer a three-way brief asks for. A close names one of the brief's own close facts. */
export const answerOf = (brief: Brief) =>
	Schema.Struct({
		triage: Schema.Union([
			Schema.Struct({
				answer: Schema.Literal("close"),
				why: Schema.Literals(brief.rules),
				of: Schema.NullOr(Schema.Int),
				trace: Schema.String,
			}),
			Schema.Struct({
				answer: Schema.Literal("keep"),
				why: Schema.Literals(KEEP_WHY),
				trace: Schema.String,
			}),
			Schema.Struct({
				answer: Schema.Literal("ask"),
				why: Schema.Literals(ASK_WHY),
				trace: Schema.String,
				question: Schema.String,
			}),
		]),
	});
export type Triage =
	| {
			readonly answer: "close";
			readonly why: string;
			readonly of: number | null;
			readonly trace: string;
	  }
	| {readonly answer: "keep"; readonly why: (typeof KEEP_WHY)[number]; readonly trace: string}
	| {
			readonly answer: "ask";
			readonly why: AskWhy;
			readonly trace: string;
			readonly question: string;
	  };

/** The two sets part 4 scores on: the 119 of parts 1 to 3, and the 63 of part 3's exam. */
export const SETS = ["tuning", "exam"] as const;
export const SetName = Schema.Literals(SETS);
export type SetName = typeof SetName.Type;

/** One ticket as part 4 asks and scores it, from either set. */
export interface Item {
	readonly id: string;
	readonly repo: string;
	readonly n: number;
	readonly set: SetName;
	readonly kind: string;
	/** What really happened: built (keep) or closed by a person (close). */
	readonly right: Verdict;
	readonly security: boolean;
}

/** One answer to one ticket. */
export const AskRecord = Schema.Struct({
	case: Schema.String,
	set: SetName,
	brief: Schema.String,
	hash: Schema.String,
	model: Schema.Literals(["opus", "sol"]),
	modelId: Schema.String,
	run: Schema.Int,
	said: Schema.NullOr(Schema.Literals(["close", "keep", "ask"])),
	why: Schema.NullOr(Schema.String),
	of: Schema.NullOr(Schema.Int),
	trace: Schema.NullOr(Schema.String),
	question: Schema.NullOr(Schema.String),
	/** What really happened to the ticket. */
	really: Verdict,
	/** Pull requests open when the ticket was filed, as listed to the model. */
	prs: Schema.Int,
	usd: Schema.NullOr(Schema.Number),
	ms: Schema.Number,
	tokens: Tokens,
	error: Schema.NullOr(Schema.String),
	at: Schema.String,
	code: Schema.Struct({
		at: Schema.String,
		reads: Schema.Number,
		context: Schema.optional(Schema.Number),
	}),
});
export type AskRecord = typeof AskRecord.Type;

const tally = (xs: readonly string[]): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const x of xs) out[x] = (out[x] ?? 0) + 1;
	return out;
};

/** One model's numbers on one set. Answers count every run; tickets count a ticket once. Pure. */
export function askSummarize(items: readonly Item[], records: readonly AskRecord[]) {
	const mine = records.filter((r) => items.some((c) => c.id === r.case));
	const answered = mine.filter((r) => r.said !== null);
	const itemOf = (r: AskRecord) => items.find((c) => c.id === r.case) as Item;
	const ticketsWhere = (p: (r: AskRecord) => boolean) =>
		new Set(answered.filter(p).map((r) => r.case));
	const wrongClose = (r: AskRecord) => r.said === "close" && r.really === "keep";
	const wrongKeep = (r: AskRecord) => r.said === "keep" && r.really === "close";
	const asks = answered.filter((r) => r.said === "ask");
	const byCase = Map.groupBy(answered, (r) => r.case);
	const twice = [...byCase.values()].filter((rs) => rs.length > 1);
	// A run the cap stopped short counts only the tickets it answered.
	const ran = items.filter((c) => byCase.has(c.id));
	return {
		tickets: new Set(answered.map((r) => r.case)).size,
		answers: answered.length,
		none: mine.length - answered.length,
		/** Every answer, by what was said and what really happened. */
		grid: tally(answered.map((r) => `${r.said}/${r.really}`)),
		wrongClose: {
			answers: answered.filter(wrongClose).length,
			tickets: ticketsWhere(wrongClose).size,
			of: ran.filter((c) => c.right === "keep").length,
			byWhy: tally(answered.filter(wrongClose).map((r) => r.why ?? "")),
			ids: [...ticketsWhere(wrongClose)],
		},
		wrongKeep: {
			answers: answered.filter(wrongKeep).length,
			tickets: ticketsWhere(wrongKeep).size,
			of: ran.filter((c) => c.right === "close").length,
			ids: [...ticketsWhere(wrongKeep)],
		},
		rightClose: answered.filter((r) => r.said === "close" && r.really === "close").length,
		asks: {
			answers: asks.length,
			share: answered.length === 0 ? 0 : asks.length / answered.length,
			byWhy: tally(asks.map((r) => r.why ?? "")),
			byReally: tally(asks.map((r) => r.really)),
			byKind: tally(asks.map((r) => itemOf(r).kind)),
		},
		/** Security tickets: every answer should be ask. */
		security: tally(answered.filter((r) => itemOf(r).security).map((r) => r.said ?? "")),
		agreement: {
			same: twice.filter((rs) => new Set(rs.map((r) => r.said)).size === 1).length,
			of: twice.length,
		},
		usd: mine.reduce((s, r) => s + (r.usd ?? 0), 0),
	};
}
export type AskSummary = ReturnType<typeof askSummarize>;
