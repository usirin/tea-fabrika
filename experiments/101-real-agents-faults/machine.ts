// The answerer's machine for real agents: experiment 95's answer machine
// (../95-agents-across-hosts/answer-machine.ts) plus a record of the agent run in flight.
//
//   started  {id: "q-7", rev: 12, session: "5f..", from: null}   a run begins: saved BEFORE the run
//   turned   {id: "q-7", session: "5f..", turn: {turn: 1, ...}}   a turn's result, before the next
//   progress {id: "q-7", session: "5f..", entries: [...]}         the run's transcript, as it grows
//   answered {id: "q-7", rev: 12, answer: "115", ...}             count it, reply, forget the run
//   repeat   {id: "q-7", rev: 30, answer: "115", ...}             a retried call: reply from the record
//
// The record is Temporal's activity heartbeat details: what a new owner needs to go on with a
// question the dead owner had started. `planFor` reads it:
//
//   recover  a run finished every turn but its answer was never saved: take that answer, no new run
//   resume   a run finished some turns and its transcript is here: fork it, send only the rest
//   fresh    nothing usable (or resume is off): start over
//
// Every save is fenced on the writer's lease (tea-host's `self.run`), so a host that lost the name
// cannot add to the record, not even its transcript.
import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";

/** One transcript line, opaque: the Agent SDK's `SessionStoreEntry` (a `type`, mostly a `uuid`). */
const EntrySchema = Schema.Record(Schema.String, Schema.Unknown);
export type Entry = typeof EntrySchema.Type;

export interface Turn {
	/** The turn's number in the question's whole conversation, 1-based. */
	readonly turn: number;
	readonly ok: boolean;
	readonly text: string;
	/** The running total Claude Code reported for its query() at this turn. */
	readonly totalUsd: number;
}

/** One agent run for the question in flight: one Claude session. */
export interface AgentRun {
	readonly session: string;
	/** The session it was forked from, or null for a fresh run. */
	readonly from: string | null;
	/** Turns already done when it started: the forked run's turns, 0 for a fresh one. */
	readonly base: number;
	readonly turns: readonly Turn[];
	readonly entries: readonly Entry[];
}

export interface InFlight {
	readonly id: string;
	readonly rev: number;
	readonly runs: readonly AgentRun[];
}

export interface Answerer {
	readonly cursor: number;
	readonly answered: number;
	readonly repeats: number;
	readonly last: {readonly id: string; readonly corr: string; readonly answer: string} | null;
	/** The question whose agent run has started and has no answer on record yet. */
	readonly inflight: InFlight | null;
}

export const START: Answerer = {cursor: 0, answered: 0, repeats: 0, last: null, inflight: null};

const TurnSchema = Schema.Struct({
	turn: Schema.Number,
	ok: Schema.Boolean,
	text: Schema.String,
	totalUsd: Schema.Number,
});
export const AnswererState = Schema.Struct({
	cursor: Schema.Number,
	answered: Schema.Number,
	repeats: Schema.Number,
	last: Schema.NullOr(
		Schema.Struct({id: Schema.String, corr: Schema.String, answer: Schema.String}),
	),
	inflight: Schema.NullOr(
		Schema.Struct({
			id: Schema.String,
			rev: Schema.Number,
			runs: Schema.Array(
				Schema.Struct({
					session: Schema.String,
					from: Schema.NullOr(Schema.String),
					base: Schema.Number,
					turns: Schema.Array(TurnSchema),
					entries: Schema.Array(EntrySchema),
				}),
			),
		}),
	),
});

export type Asked = {
	readonly id: string;
	readonly corr: string;
	readonly replyTo: string;
	readonly rev: number;
	readonly answer: string;
};

export type AnswerMsg =
	| ({readonly type: "answered"} & Asked)
	| ({readonly type: "repeat"} & Asked)
	| {
			readonly type: "started";
			readonly id: string;
			readonly rev: number;
			readonly session: string;
			readonly from: string | null;
	  }
	| {readonly type: "turned"; readonly id: string; readonly session: string; readonly turn: Turn}
	| {
			readonly type: "progress";
			readonly id: string;
			readonly session: string;
			readonly entries: readonly Entry[];
	  };

export type AnswerCmd = {
	readonly type: "reply";
	readonly to: string;
	readonly id: string;
	readonly corr: string;
	readonly answer: string;
};

type Step = readonly [Answerer, readonly AnswerCmd[]];
type Of<T extends AnswerMsg["type"]> = Extract<AnswerMsg, {readonly type: T}>;

/** Turns done in a row from the start, counting the turns of the run it was forked from. */
export const turnsDone = (r: AgentRun): number => {
	let done = r.base;
	for (const t of r.turns) {
		if (!t.ok || t.turn !== done + 1) break;
		done = t.turn;
	}
	return done;
};

const replyTo = (m: Asked): AnswerCmd => ({
	type: "reply",
	to: m.replyTo,
	id: m.id,
	corr: m.corr,
	answer: m.answer,
});

const answered = (s: Answerer, m: Of<"answered">): Step =>
	m.rev <= s.cursor
		? [s, []]
		: [
				{
					...s,
					cursor: m.rev,
					answered: s.answered + 1,
					last: {id: m.id, corr: m.corr, answer: m.answer},
					inflight: s.inflight?.id === m.id ? null : s.inflight,
				},
				[replyTo(m)],
			];

const repeat = (s: Answerer, m: Of<"repeat">): Step =>
	m.rev <= s.cursor ? [s, []] : [{...s, cursor: m.rev, repeats: s.repeats + 1}, [replyTo(m)]];

/**
 * A run starts. Never drops the run of another question still in flight (the program takes the
 * inbox in order, so another one here is a mistake), and a session starts once.
 */
const started = (s: Answerer, m: Of<"started">): Step => {
	if (m.rev <= s.cursor) return [s, []];
	const f = s.inflight;
	if (f !== null && (f.id !== m.id || f.rev !== m.rev)) return [s, []];
	if (f?.runs.some((r) => r.session === m.session)) return [s, []];
	const parent = m.from === null ? undefined : f?.runs.find((r) => r.session === m.from);
	if (m.from !== null && parent === undefined) return [s, []];
	const run: AgentRun = {
		session: m.session,
		from: m.from,
		base: parent === undefined ? 0 : turnsDone(parent),
		turns: [],
		entries: [],
	};
	return [{...s, inflight: {id: m.id, rev: m.rev, runs: [...(f?.runs ?? []), run]}}, []];
};

/** Change one run of the question in flight; anything else changes nothing. */
const onRun = (
	s: Answerer,
	id: string,
	session: string,
	change: (r: AgentRun) => AgentRun | null,
): Step => {
	const f = s.inflight;
	if (f === null || f.id !== id) return [s, []];
	const i = f.runs.findIndex((r) => r.session === session);
	const run = f.runs[i];
	if (run === undefined) return [s, []];
	const next = change(run);
	if (next === null) return [s, []];
	const runs = f.runs.map((r, j) => (j === i ? next : r));
	return [{...s, inflight: {...f, runs}}, []];
};

/** A turn is recorded once, in order. */
const turned = (s: Answerer, m: Of<"turned">): Step =>
	onRun(s, m.id, m.session, (r) =>
		m.turn.turn === r.base + r.turns.length + 1 ? {...r, turns: [...r.turns, m.turn]} : null,
	);

/** Transcript lines; a line's `uuid` is its idempotency key, as the SDK asks of a store. */
const progress = (s: Answerer, m: Of<"progress">): Step =>
	onRun(s, m.id, m.session, (r) => {
		const have = new Set(r.entries.flatMap((e) => (typeof e.uuid === "string" ? [e.uuid] : [])));
		const added = m.entries.filter((e) => typeof e.uuid !== "string" || !have.has(e.uuid));
		return added.length === 0 ? null : {...r, entries: [...r.entries, ...added]};
	});

export const answerUpdate = {answered, repeat, started, turned, progress} as const;

export const answerer = defineMachine<Answerer, AnswerMsg, AnswerCmd, never, undefined>({
	types: {
		model: {} as Answerer,
		msg: {} as AnswerMsg,
		cmd: {} as AnswerCmd,
		sub: {} as never,
		ctx: undefined,
	},
	init: (loaded) => [loaded ?? START, []],
	update: answerUpdate,
});

// ---------------------------------------------------------------- what a new owner does

export type Plan =
	| {readonly how: "fresh"}
	| {readonly how: "recover"; readonly answer: string; readonly session: string}
	| {readonly how: "resume"; readonly from: string; readonly done: number};

/**
 * What to do with question `id`, given the record. `turns`: how many turns a whole run has.
 * `resume` off: always fresh (today's behaviour, experiment 98). A run to resume needs a turn done
 * and its transcript; of those, the one with the most turns done, the latest on a tie. A forked run
 * killed before its copy of the history landed has none, so its parent is picked instead.
 */
export const planFor = (s: Answerer, id: string, resume: boolean, turns: number): Plan => {
	const f = s.inflight;
	if (!resume || f === null || f.id !== id) return {how: "fresh"};
	for (const r of f.runs) {
		const last = r.turns.find((t) => t.turn === turns);
		if (turnsDone(r) >= turns && last !== undefined)
			return {how: "recover", answer: last.text, session: r.session};
	}
	let best: AgentRun | undefined;
	for (const r of f.runs)
		if (turnsDone(r) >= 1 && r.entries.length > 0)
			if (best === undefined || turnsDone(r) >= turnsDone(best)) best = r;
	return best === undefined
		? {how: "fresh"}
		: {how: "resume", from: best.session, done: turnsDone(best)};
};
