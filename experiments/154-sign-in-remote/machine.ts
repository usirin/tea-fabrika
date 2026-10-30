// Experiment 154's sign-in, as a tea machine: one box signs in to its person's own ChatGPT plan,
// keeps the pass while it works, refreshes it, and forgets it at the end. Pure: the cells that
// talk to the ledger and the sign-in server are in ./cells.ts.
//
// The pass is never in the state. The state holds where the sign-in is, the `state` value of the
// OAuth request (it is in the sign-in URL anyway), the scopes and the times. The tokens and the
// PKCE verifier sit in the box's `Vault` (./vault.ts), in memory only, so a saved or traced
// state can never carry one.
//
//   asking      told the person's app a sign-in is wanted; waits for its loopback port
//   waiting     the sign-in URL is out; waits for the code, at most `waitMs`
//   trading     trades the code, with the verifier, for the pass (RFC 7636 section 4.6)
//   signed      holds the pass; a timer refreshes it a margin before it ends
//   refreshing  trades the refresh token for a new pass and a new refresh token; with no refresh
//               token (way b, no offline_access), back to asking, one round on
//   ending      revokes the refresh token (RFC 7009) and clears the vault
//   ended       why, and whether the revoke was confirmed
//
//   replay(signIn, {ctx: undefined, msgs: [{type: "catcher", port: 1455}]})
//   // state {at: "asking", round: 0, port: 1455}, cmds [want {round: 0}, offer {port: 1455, round: 0}]
import {type DepKeyedSub, defineMachine, type Sub, type TimerSub} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";

/** A pass as the machine may know it: never the tokens, only what they allow and when to renew. */
const Pass = Schema.Struct({
	expires_in: Schema.Number,
	scopes: Schema.Array(Schema.String),
	/** When to refresh, from now: the box's margin before `expires_in`, at most half of it. */
	refreshInMs: Schema.Number,
});

/** Tell the person's app a sign-in is wanted. */
export const want = Cmd.define("want", {
	input: Schema.Struct({round: Schema.Int}),
	ok: Schema.Null,
	err: ["unreachable"],
});

/** Make the verifier, the state and the URL for the app's port, and send the URL out. */
export const offer = Cmd.define("offer", {
	input: Schema.Struct({port: Schema.Int, round: Schema.Int}),
	ok: Schema.Struct({state: Schema.String, waitMs: Schema.Number}),
	err: ["unreachable"],
});

/** Trade the code for the pass. `refused`: the server said invalid_grant (used, old, wrong verifier). */
export const trade = Cmd.define("trade", {
	input: Schema.Struct({code: Schema.String, client: Schema.NullOr(Schema.String)}),
	ok: Pass,
	err: ["refused", "no_scope", "unreachable", "closed"],
});

/** Trade the refresh token for a new pair. `no_renewal`: the pass came with no refresh token. */
export const refresh = Cmd.define("refresh", {
	input: Schema.Struct({turn: Schema.Int}),
	ok: Pass,
	err: ["refused", "no_scope", "unreachable", "closed", "no_renewal"],
});

/** Revoke, clear the vault, and tell the person. It always clears; `revoked` says if the server agreed. */
export const forget = Cmd.define("forget", {
	input: Schema.Struct({why: Schema.String}),
	ok: Schema.Struct({revoked: Schema.Boolean}),
	err: ["unreachable"],
});

export const Why = Schema.Literals([
	"done",
	"denied",
	"timed_out",
	"state_mismatch",
	"code_refused",
	"no_scope",
	"refresh_refused",
	"unreachable",
]);
export type Why = typeof Why.Type;

/**
 * `round` counts the person's sign-ins for this box: 0 at the start, one more each time a pass
 * with no renewal key runs out and the person is asked again (way b). `turn` counts refreshes.
 */
export type SignIn =
	| {readonly at: "asking"; readonly round: number; readonly port: number | null}
	| {
			readonly at: "waiting";
			readonly round: number;
			readonly state: string;
			readonly waitMs: number;
	  }
	| {readonly at: "trading"; readonly round: number}
	| {
			readonly at: "signed";
			readonly round: number;
			readonly scopes: readonly string[];
			readonly refreshInMs: number;
			readonly turn: number;
	  }
	| {readonly at: "refreshing"; readonly round: number; readonly turn: number}
	| {readonly at: "ending"; readonly why: Why}
	| {readonly at: "ended"; readonly why: Why; readonly revoked: boolean};

export type SignInMsg =
	| {readonly type: "catcher"; readonly port: number}
	| {
			readonly type: "code";
			readonly state: string;
			readonly code: string;
			readonly client: string | null;
	  }
	| {readonly type: "denied"; readonly state: string; readonly error: string}
	| {readonly type: "timed_out"}
	| {readonly type: "refresh_due"; readonly turn: number}
	| {readonly type: "end"};

/** The box's inbox, read while the sign-in is live. */
export type InboxSub = Sub<"inbox", Record<string, never>>;

type Cmds =
	| ReturnType<typeof want>
	| ReturnType<typeof offer>
	| ReturnType<typeof trade>
	| ReturnType<typeof refresh>
	| ReturnType<typeof forget>;
type Step = readonly [SignIn, readonly Cmds[]];

const ending = (why: Why): Step => [{at: "ending", why}, [forget({why})]];
const live = (s: SignIn) => s.at !== "ending" && s.at !== "ended";
const same = (s: SignIn): Step => [s, []];

const whyOf = (tag: string): Why =>
	tag === "refused" ? "code_refused" : tag === "no_scope" ? "no_scope" : "unreachable";

export const signIn = defineMachine({
	types: {
		model: {} as SignIn,
		msg: {} as SignInMsg,
		sub: {} as InboxSub | TimerSub<SignInMsg>,
		ctx: undefined,
	},
	cmds: [want, offer, trade, refresh, forget],
	init: (): Step => [{at: "asking", round: 0, port: null}, [want({round: 0})]],
	update: {
		// The app's port: the URL is made for it. A second port is not asked for, so it is dropped.
		catcher: (s, m): Step =>
			s.at === "asking" && s.port === null
				? [{...s, port: m.port}, [offer({port: m.port, round: s.round})]]
				: same(s),
		want_ok: same,
		want_err: (s): Step => (live(s) ? ending("unreachable") : same(s)),
		offer_ok: (s, m): Step =>
			s.at === "asking"
				? [{at: "waiting", round: s.round, state: m.value.state, waitMs: m.value.waitMs}, []]
				: same(s),
		offer_err: (s): Step => (live(s) ? ending("unreachable") : same(s)),

		// Only while waiting, and only once: a code after that is dropped, so one box trades once.
		code: (s, m): Step => {
			if (s.at !== "waiting") return same(s);
			if (m.state !== s.state) return ending("state_mismatch");
			return [{at: "trading", round: s.round}, [trade({code: m.code, client: m.client})]];
		},
		// A denial with a state that is not ours is not ours to act on.
		denied: (s, m): Step =>
			s.at === "waiting" && m.state === s.state ? ending("denied") : same(s),
		timed_out: (s): Step => (s.at === "waiting" ? ending("timed_out") : same(s)),

		trade_ok: (s, m): Step =>
			s.at === "trading"
				? [
						{
							at: "signed",
							round: s.round,
							scopes: m.value.scopes,
							refreshInMs: m.value.refreshInMs,
							turn: 0,
						},
						[],
					]
				: same(s),
		trade_err: (s, m): Step => (s.at === "trading" ? ending(whyOf(m.error._tag)) : same(s)),

		refresh_due: (s, m): Step =>
			s.at === "signed" && m.turn === s.turn
				? [{at: "refreshing", round: s.round, turn: s.turn}, [refresh({turn: s.turn})]]
				: same(s),
		refresh_ok: (s, m): Step =>
			s.at === "refreshing"
				? [
						{
							at: "signed",
							round: s.round,
							scopes: m.value.scopes,
							refreshInMs: m.value.refreshInMs,
							turn: s.turn + 1,
						},
						[],
					]
				: same(s),
		// Way (b): a pass with no renewal key. The person is asked again, as at the start; the old
		// pass is kept until the new one comes or it runs out.
		refresh_err: (s, m): Step =>
			s.at !== "refreshing"
				? same(s)
				: m.error._tag === "no_renewal"
					? [{at: "asking", round: s.round + 1, port: null}, [want({round: s.round + 1})]]
					: ending("refresh_refused"),

		end: (s): Step => (live(s) ? ending("done") : same(s)),
		forget_ok: (s, m): Step =>
			s.at === "ending" ? [{at: "ended", why: s.why, revoked: m.value.revoked}, []] : same(s),
		forget_err: (s): Step =>
			s.at === "ending" ? [{at: "ended", why: s.why, revoked: false}, []] : same(s),
	},
	subs: [
		{type: "inbox", deps: (s) => (live(s) ? {} : null)} satisfies DepKeyedSub<SignIn, InboxSub>,
		{
			type: "timer",
			deps: (s) =>
				s.at === "waiting"
					? {ms: s.waitMs, msg: {type: "timed_out"}}
					: s.at === "signed"
						? {ms: s.refreshInMs, msg: {type: "refresh_due", turn: s.turn}}
						: null,
		} satisfies DepKeyedSub<SignIn, TimerSub<SignInMsg>>,
	],
});

export const over = (s: SignIn) => s.at === "ended";
