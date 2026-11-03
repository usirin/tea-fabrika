// Way (c) as a tea machine: the box never signs in. The person's own app holds the sign-in and
// its refresh token on the person's machine, and lends the box one short pass at a time, sealed
// to the box's key (./seal.ts). The box asks again before each pass runs out. It never sees a
// renewal key, so there is nothing of the person's that outlives the box by more than one pass.
//
//   asking   asked the app for pass `turn`; waits at most `waitMs`. Holds the last pass, if any.
//   opening  opens the sealed pass into the vault
//   holding  holds pass `turn`; a timer asks for the next one a margin before it ends
//   ending   clears the vault and tells the person (there is no refresh token to revoke)
//   ended    why
//
//   replay(lent, {ctx: undefined, msgs: []})
//   // state {at: "asking", turn: 0, waitMs: null}, cmds [ask {turn: 0}]
import {type DepKeyedSub, defineMachine, type TimerSub} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import type {InboxSub} from "./machine.ts";

/** Ask the person's app for pass `turn`, sealed to this box's key. */
export const ask = Cmd.define("ask", {
	input: Schema.Struct({turn: Schema.Int}),
	ok: Schema.Struct({waitMs: Schema.Number}),
	err: ["unreachable"],
});

/** Open the sealed pass into the vault. The machine never sees it opened. */
export const open = Cmd.define("open", {
	input: Schema.Struct({turn: Schema.Int, sealed: Schema.String, expires_in: Schema.Number}),
	ok: Schema.Struct({renewInMs: Schema.Number}),
	err: ["unsealed", "closed"],
});

/** Clear the vault and tell the person. */
export const drop = Cmd.define("drop", {
	input: Schema.Struct({why: Schema.String}),
	ok: Schema.Null,
	err: ["unreachable"],
});

export const LentWhy = Schema.Literals(["done", "timed_out", "refused", "unsealed", "unreachable"]);
export type LentWhy = typeof LentWhy.Type;

export type Lent =
	| {readonly at: "asking"; readonly turn: number; readonly waitMs: number | null}
	| {readonly at: "opening"; readonly turn: number}
	| {readonly at: "holding"; readonly turn: number; readonly renewInMs: number}
	| {readonly at: "ending"; readonly why: LentWhy}
	| {readonly at: "ended"; readonly why: LentWhy};

export type LentMsg =
	| {
			readonly type: "pass";
			readonly turn: number;
			readonly sealed: string;
			readonly expires_in: number;
			readonly scopes: readonly string[];
	  }
	| {readonly type: "no_pass"; readonly turn: number; readonly why: string}
	| {readonly type: "renew_due"; readonly turn: number}
	| {readonly type: "timed_out"; readonly turn: number}
	| {readonly type: "end"};

type Cmds = ReturnType<typeof ask> | ReturnType<typeof open> | ReturnType<typeof drop>;
type Step = readonly [Lent, readonly Cmds[]];

const ending = (why: LentWhy): Step => [{at: "ending", why}, [drop({why})]];
const live = (s: Lent) => s.at !== "ending" && s.at !== "ended";
const same = (s: Lent): Step => [s, []];

export const lent = defineMachine({
	types: {
		model: {} as Lent,
		msg: {} as LentMsg,
		sub: {} as InboxSub | TimerSub<LentMsg>,
		ctx: undefined,
	},
	cmds: [ask, open, drop],
	init: (): Step => [{at: "asking", turn: 0, waitMs: null}, [ask({turn: 0})]],
	update: {
		ask_ok: (s, m): Step =>
			s.at === "asking" && m.cmd.turn === s.turn ? [{...s, waitMs: m.value.waitMs}, []] : same(s),
		ask_err: (s): Step => (live(s) ? ending("unreachable") : same(s)),
		// Only the pass asked for: an old turn's pass, or one that comes twice, is dropped.
		pass: (s, m): Step =>
			s.at === "asking" && m.turn === s.turn
				? [
						{at: "opening", turn: s.turn},
						[open({turn: m.turn, sealed: m.sealed, expires_in: m.expires_in})],
					]
				: same(s),
		no_pass: (s, m): Step => (s.at === "asking" && m.turn === s.turn ? ending("refused") : same(s)),
		timed_out: (s, m): Step =>
			s.at === "asking" && m.turn === s.turn ? ending("timed_out") : same(s),
		open_ok: (s, m): Step =>
			s.at === "opening"
				? [{at: "holding", turn: s.turn, renewInMs: m.value.renewInMs}, []]
				: same(s),
		open_err: (s, m): Step =>
			s.at === "opening" ? ending(m.error._tag === "unsealed" ? "unsealed" : "done") : same(s),
		renew_due: (s, m): Step =>
			s.at === "holding" && m.turn === s.turn
				? [{at: "asking", turn: s.turn + 1, waitMs: null}, [ask({turn: s.turn + 1})]]
				: same(s),
		end: (s): Step => (live(s) ? ending("done") : same(s)),
		drop_ok: (s): Step => (s.at === "ending" ? [{at: "ended", why: s.why}, []] : same(s)),
		drop_err: (s): Step => (s.at === "ending" ? [{at: "ended", why: s.why}, []] : same(s)),
	},
	subs: [
		{type: "inbox", deps: (s) => (live(s) ? {} : null)} satisfies DepKeyedSub<Lent, InboxSub>,
		{
			type: "timer",
			deps: (s) =>
				s.at === "asking" && s.waitMs !== null
					? {ms: s.waitMs, msg: {type: "timed_out", turn: s.turn}}
					: s.at === "holding"
						? {ms: s.renewInMs, msg: {type: "renew_due", turn: s.turn}}
						: null,
		} satisfies DepKeyedSub<Lent, TimerSub<LentMsg>>,
	],
});

export const lentOver = (s: Lent) => s.at === "ended";
