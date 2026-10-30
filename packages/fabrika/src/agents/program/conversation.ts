import {defineMachine} from "@demlik/tea";
import {Schema} from "effect";
import {Counted, Stop, Tokens, ToolStatus, type Update} from "../agent/turn.ts";
import type {Spend} from "../claude/draft.ts";

// What one `claude` or `codex` run keeps (experiment 169): the provider, our
// session id, and every turn, each with what was said, the tools it called,
// the asks it made and how it ended. It is kept, so a person who attaches
// later, or a start after a kill, sees the whole conversation, and a turn a
// kill cut off is sent again: nobody types it twice. It is the window's view
// too: a chat window draws this and nothing else.
//
//   opened claude claude/7       provider: "claude", session: "claude/7"
//   told "what is 2+3?"          turns: [{n: 1, prompt: "what is 2+3?", end: null}]
//   began 1                      turn 1 starts (again): what it said so far is dropped
//   heard 1 said "5"             turns: [{n: 1, said: ["5"], ...}]
//   ended 1 {stop: "end_turn"}   turns: [{n: 1, ..., end: {stop: "end_turn", answer: {n: 5}}}]
//
// The same for both providers: it folds the `Agents` service's updates
// (../agent/turn.ts), never a provider's own events.

/** The providers this program is built for, together. */
export const PROVIDERS = ["claude", "codex"] as const;
export const Provider = Schema.Literals(PROVIDERS);
export type Provider = typeof Provider.Type;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** How a turn ended: the service's stop, or `failed` when the service failed the turn. */
export const EndStop = Schema.Union([Stop, Schema.Literal("failed")]);
export type EndStop = typeof EndStop.Type;

export const ToolSeen = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	status: ToolStatus,
});
export const AskSeen = Schema.Struct({id: Schema.String, title: Schema.String});

/** A turn's end, the same for both providers. `usd` and `requests` are `null` where the provider does not say. */
export class End extends Schema.Opaque<End>()(
	Schema.Struct({
		stop: EndStop,
		/** The answer, read by the turn's schema. `null`: it did not fit, or the turn did not end on its own. */
		answer: Schema.NullOr(Schema.Unknown),
		tokens: Tokens,
		counted: Counted,
		usd: Schema.NullOr(Schema.Finite),
		requests: Schema.NullOr(Count),
		ms: Count,
		/** Why the service failed the turn, in its words: `why: message`. */
		error: Schema.NullOr(Schema.String),
	}),
) {
	/** What a Draft counts as spent. Tokens are input and output; a provider that gives no dollars spent none. */
	static toSpend(end: End): Spend {
		return {
			costUsd: end.usd ?? 0,
			tokens: end.tokens.input + end.tokens.output,
			context: 0,
			turns: end.requests ?? 0,
			minutes: end.ms / 60_000,
		};
	}
}

export const TurnSeen = Schema.Struct({
	n: Count,
	prompt: Schema.String,
	said: Schema.Array(Schema.String),
	tools: Schema.Array(ToolSeen),
	asks: Schema.Array(AskSeen),
	/** `null`: not ended yet, so sent again at the next start. */
	end: Schema.NullOr(End),
});
export type TurnSeen = typeof TurnSeen.Type;

export class Conversation extends Schema.Opaque<Conversation>()(
	Schema.Struct({
		/** The provider it was opened on: a run cannot move to the other one. */
		provider: Schema.NullOr(Provider),
		/** Ours, never the provider's: the service maps it to the provider's own (../agent/sessions.ts). */
		session: Schema.NullOr(Schema.String),
		/** Prompts told so far: the next one is `told + 1`. */
		told: Count,
		turns: Schema.Array(TurnSeen),
	}),
) {
	/** The turns told and not ended: the first is the one running, or next. */
	static waiting(s: Conversation): readonly TurnSeen[] {
		return s.turns.filter((t) => t.end === null);
	}

	/** The status line: which provider, how many turns ended, how many wait. */
	static status(s: Conversation): string {
		const waiting = Conversation.waiting(s).length;
		return `${s.provider ?? "no session yet"} · ${s.turns.length - waiting} turns · ${waiting} waiting`;
	}
}

export type ConversationMsg =
	| {readonly type: "opened"; readonly provider: Provider; readonly session: string}
	| {readonly type: "told"; readonly prompt: string}
	| {readonly type: "began"; readonly n: number}
	| {readonly type: "heard"; readonly n: number; readonly update: Update}
	| {readonly type: "ended"; readonly n: number; readonly end: End};

export const NONE: Conversation = {provider: null, session: null, told: 0, turns: []};

const onTurn = (s: Conversation, n: number, change: (t: TurnSeen) => TurnSeen): Conversation => ({
	...s,
	turns: s.turns.map((t) => (t.n === n && t.end === null ? change(t) : t)),
});

/** One update of the service, folded into its turn. `started` and `tokens` change nothing: the end carries them. */
const fold = (t: TurnSeen, update: Update): TurnSeen => {
	switch (update._tag) {
		case "said":
			return {...t, said: [...t.said, update.text]};
		case "tool": {
			const known = t.tools.some((x) => x.id === update.id);
			const seen = {id: update.id, title: update.title, status: update.status};
			return known
				? {
						...t,
						tools: t.tools.map((x) =>
							// A tool's later update may carry no title: keep the one it began with.
							x.id === update.id
								? {...seen, title: update.title === "" ? x.title : update.title}
								: x,
						),
					}
				: {...t, tools: [...t.tools, seen]};
		}
		case "asked":
			return {...t, asks: [...t.asks, {id: update.id, title: update.title}]};
		case "started":
		case "tokens":
			return t;
	}
};

export const conversation = defineMachine({
	types: {model: {} as Conversation, msg: {} as ConversationMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? NONE, []],
	update: {
		// Once only: a run never moves to another provider or another session.
		opened: (s, m) => [
			s.session === null ? {...s, provider: m.provider, session: m.session} : s,
			[],
		],
		told: (s, m) => [
			{
				...s,
				told: s.told + 1,
				turns: [
					...s.turns,
					{n: s.told + 1, prompt: m.prompt, said: [], tools: [], asks: [], end: null},
				],
			},
			[],
		],
		began: (s, m) => [onTurn(s, m.n, (t) => ({...t, said: [], tools: [], asks: []})), []],
		heard: (s, m) => [onTurn(s, m.n, (t) => fold(t, m.update)), []],
		ended: (s, m) => [onTurn(s, m.n, (t) => ({...t, end: m.end})), []],
	},
});
