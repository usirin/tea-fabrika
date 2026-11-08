import {hash, TraceId} from "@kampus/fabrika-old";
import {Effect, Option, Schema} from "effect";

const Line = Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty(), Schema.isMaxLength(120), Schema.isPattern(/^[^\r\n]*$/));
const Id = Schema.String.check(Schema.isPattern(/^\S{1,128}$/));
const Hash = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const Percent = Schema.Finite.check(Schema.isBetween({minimum: 0, maximum: 100}));
export const Rec = Schema.TaggedUnion({
	pick: {pick: Line, why: Line, cost: Line, sure: Schema.NullOr(Percent)},
	none: {why: Line},
});
export type Rec = typeof Rec.Type;
export const Answer = Schema.TaggedUnion({rec: {}, against: {pick: Line, note: Line}, chose: {pick: Line}});
export type Answer = typeof Answer.Type;
const DisplayRec = Schema.Union([Rec, Schema.TaggedStruct("hidden", {})]);
const Pick = Schema.Struct({pick: Line, does: Schema.NonEmptyString});
const Text = Schema.Struct({title: Schema.String, body: Schema.String});
// Plan contents stay JSON, including fields added by later plan writers. Required parts cannot vanish.
const Plan = Schema.Struct({
	summary: Schema.String,
	stories: Schema.Array(Schema.Json),
	tasks: Schema.Array(Schema.Json),
	pointers: Schema.Array(Schema.Json),
	questions: Schema.Array(Schema.Struct({
		id: Schema.String, ask: Schema.String, options: Schema.Array(Schema.String), lean: Schema.String,
		why: Schema.String, cost: Schema.optionalKey(Schema.String), sure: Schema.optionalKey(Schema.Finite),
		doubt: Schema.optionalKey(Schema.String),
	})),
});
export const Evidence = Schema.TaggedUnion({
	plan: {version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), plan: Plan},
	change: {
		head: Schema.String, diff: Schema.String, checks: Schema.Array(Schema.Json),
		review: Schema.NullOr(Schema.Json), rules: Schema.Array(Schema.Struct({path: Schema.String, text: Schema.String})),
	},
	other: {text: Schema.String},
});
const display = {what: Line, picks: Schema.NonEmptyArray(Pick), ticket: Text, evidence: Evidence};
export const Shows = Schema.Struct({...display, rec: DisplayRec});
export type Shows = typeof Shows.Type;
const fields = {
	ask: Id, for: Schema.NonEmptyString, step: Schema.NonEmptyString, repo: Schema.NonEmptyString,
	why: Schema.NullOr(Schema.String), rec: Rec, until: Schema.NullOr(Schema.Finite),
	replaces: Schema.optionalKey(Id), trace: Schema.optionalKey(TraceId),
};
const Draft = Schema.Struct({...fields, ...display});
export const Asked = Schema.Struct({
	type: Schema.Literal("asked"), format: Schema.Literal(1), ...fields,
	shows: Shows, saw: Hash, blind: Schema.Struct({policy: Schema.Int, hidden: Schema.Boolean}),
});
export type Asked = typeof Asked.Type;
const Took = Schema.Struct({
	key: Schema.NonEmptyString, rec: Schema.Literals(["shown", "hidden", "none"]),
	ms: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)), opened: Schema.Array(Schema.String), said: Schema.Finite,
});
export const Via = Schema.TaggedUnion({window: {took: Took}, chat: {session: Id, took: Schema.optionalKey(Took)}});
export const Answered = Schema.Struct({
	type: Schema.Literal("answered"), format: Schema.Literal(1), ask: Id, answer: Answer,
	saw: Hash, via: Via, needed: Schema.optionalKey(Schema.Boolean),
});
export type Answered = typeof Answered.Type;

/** Stable draw, recorded once with the ask. FNV-1a mixes the seed and policy with its id. */
export const blindDraw = (ask: string, seed = 119120, policy = 1) => {
	let n = 2166136261;
	for (const char of `${policy}/${seed}/${ask}`) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
	return {policy, hidden: (n >>> 0) % 5 === 0};
};

export const sealAsk = (input: unknown, policy?: {seed: number}) => Effect.gen(function* () {
	const draft = yield* Schema.decodeUnknownEffect(Draft)(input);
	if (new Set(draft.picks.map((p) => p.pick)).size !== draft.picks.length)
		return yield* Effect.fail(new Error("An ask repeats a pick"));
	if (draft.rec._tag === "pick" && !draft.picks.some((p) => p.pick === draft.rec.pick))
		return yield* Effect.fail(new Error("The recommendation is not offered"));
	const blind = blindDraw(draft.ask, policy?.seed);
	const shows = {
		what: draft.what, picks: draft.picks, ticket: draft.ticket,
		evidence: draft.evidence,
		rec: draft.rec._tag === "pick" && blind.hidden ? Schema.TaggedStruct("hidden", {}).make({}) : draft.rec,
	};
	// Decode for validation, but keep every JSON field of the full plan, including future fields.
	const source = input as typeof draft;
	const complete = {...shows, evidence: source.evidence};
	return Asked.make({
		type: "asked", format: 1, ask: draft.ask, for: draft.for, step: draft.step, repo: draft.repo,
		why: draft.why, rec: draft.rec, until: draft.until, shows: complete,
		saw: yield* hash(complete), blind,
		...(draft.replaces === undefined ? {} : {replaces: draft.replaces}),
		...(draft.trace === undefined ? {} : {trace: draft.trace}),
	});
});

/** Resolve only what was actually offered and visible. A blind choice always stays chose. */
export const answerOf = (asked: Asked, input: unknown): {pick: string; note: string} | null => {
	const decoded = Schema.decodeUnknownOption(Answer)(input);
	if (Option.isNone(decoded)) return null;
	const answer = decoded.value;
	const rec = asked.shows.rec;
	if (answer._tag === "rec") return rec._tag === "pick" ? {pick: rec.pick, note: ""} : null;
	if (!asked.shows.picks.some((p) => p.pick === answer.pick)) return null;
	if (answer._tag === "chose") return rec._tag !== "pick" ? {pick: answer.pick, note: ""} : null;
	return rec._tag === "pick" && rec.pick !== answer.pick ? {pick: answer.pick, note: answer.note} : null;
};
