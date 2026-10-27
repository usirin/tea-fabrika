import {defineMachine, type Sub, type TimerSub} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {
	type DurationRetryPolicy,
	initRetry,
	type RetryState,
	recordFailure,
	shouldRetry,
	type TimedRetryState,
} from "@demlik/tea/retry-backoff";
import {Schema} from "effect";
import type {ToPage} from "./messages.ts";

// When the app attaches to the host again: a tea machine, pure, run by main.ts. The link
// (link.ts) is one socket's handshake, and a link that closed stays closed. This machine sits
// above it, as a parent: when the link ends, it waits, then makes a new one (`attach`, which is
// attach.ts: reach the socket, or start a host and wait for it, then the handshake).
//
//   [s] = init(null)                                {at: "attaching", ...}, attach
//   update(s, attach_ok {kind: "up"})               {at: "up"}: the link sub watches its end
//   update(s, {type: "ended", why, at: 0})          {at: "waiting", wait: null, ...}, jitter {attempt: 1}
//   update(s, jitter_ok 312)                        {at: "waiting", wait: 312}: the timer is set
//   update(s, {type: "due", attempt: 1})            {at: "attaching", ...}, attach
//   update(s, attach_ok {kind: "lost", why})        {at: "waiting", ...}, jitter {attempt: 2}
//   ... five minutes after the link ended, a try that fails:
//   update(s, attach_ok {kind: "lost", why})        {at: "stopped", why}: no more tries
//   update(s, {type: "again"})                      {at: "attaching", ...}, attach: five more minutes
//
// The wait is AWS's "full jitter" (Brooker, "Exponential Backoff And Jitter", 2015): a random
// time between 0 and min(cap, base * 2^attempt). tea's own retry-backoff module does the sums
// and keeps the clock and the random number out of this machine: the clock comes in on each
// Msg's `at`, and the random wait comes back from the `jitter` Cmd, as Elm's `Random.generate`.
//
// A host of another version is never tried again (`refused`): what to offer then is ticket 12.

/**
 * How the app tries again. The first wait after the link ends is at most half a second, as the
 * host is usually still there and only the socket broke. The longest is 30 seconds, VS Code's
 * longest wait between its own reconnect tries. Five minutes after the link ended, it stops and
 * asks a person: VS Code's short grace time. A host on the same laptop that has not come back by
 * then needs a person to look.
 */
export const POLICY: DurationRetryPolicy = {
	baseMs: 250,
	factor: 2,
	capMs: 30_000,
	maxElapsedMs: 5 * 60_000,
	jitter: "full",
};

/** The link to the host, as the app has it. */
export type Reconnect =
	/**
	 * One try is out. `why` is what ended the link before, or `null` on the app's first try. `retry`
	 * counts the tries since the link was last up.
	 */
	| {readonly at: "attaching"; readonly retry: RetryState; readonly why: string | null}
	/** Attached: the host answers. */
	| {readonly at: "up"}
	/** Not attached: the next try waits `wait` ms, once `jitter` has picked it. */
	| {
			readonly at: "waiting";
			readonly retry: TimedRetryState;
			readonly why: string;
			readonly wait: number | null;
	  }
	/** Five minutes of tries failed: none more, until a person asks (`again`). */
	| {readonly at: "stopped"; readonly why: string}
	/** The host speaks another version of the link: never tried again. */
	| {readonly at: "refused"; readonly theirs: number; readonly ours: number};

export type ReconnectMsg =
	/** The link that was up ended, at `at`. */
	| {readonly type: "ended"; readonly why: string; readonly at: number}
	/** The wait before try `attempt` is over: the timer's. */
	| {readonly type: "due"; readonly attempt: number}
	/** A person pressed Try again. */
	| {readonly type: "again"};

/** What one try came to: attached, refused for another version, or not attached, and why. */
export const Tried = Schema.Union([
	Schema.Struct({kind: Schema.Literal("up")}),
	Schema.Struct({kind: Schema.Literal("refused"), theirs: Schema.Int, ours: Schema.Int}),
	Schema.Struct({kind: Schema.Literal("lost"), why: Schema.String}),
]);
export type Tried = typeof Tried.Type;

/** One try: reach the host on its socket, or start one and wait for it, then the handshake. */
export const attach = Cmd.define("attach", {input: Schema.Struct({}), ok: Tried, err: []});
/** Pick the wait before try `attempt`: full jitter, between 0 and the policy's bound for it. */
export const jitter = Cmd.define("jitter", {
	input: Schema.Struct({attempt: Schema.Int}),
	ok: Schema.Number.check(Schema.isBetween({minimum: 0, maximum: POLICY.capMs})),
	err: [],
});

export type ReconnectCmd = ReturnType<typeof attach> | ReturnType<typeof jitter>;

/** Watch the link while it is up: its end comes back as `ended`. */
export type LinkSub = Sub<"link", {readonly up: true}>;

type Step = readonly [Reconnect, readonly ReconnectCmd[]];

const trying = (retry: RetryState, why: string | null): Step => [
	{at: "attaching", retry, why},
	[attach({})],
];

/** A try failed, or the link ended: wait and try again, or stop after five minutes of it. */
const failed = (retry: RetryState, why: string, at: number): Step => {
	const next = recordFailure(retry, why, at);
	if (!shouldRetry(next, POLICY, at)) return [{at: "stopped", why}, []];
	return [{at: "waiting", retry: next, why, wait: null}, [jitter({attempt: next.attempt})]];
};

type Waiting = Extract<Reconnect, {readonly at: "waiting"}>;

/** Is this the pick asked for now? Any other is an old wait's, and changes nothing. */
const picking = (s: Reconnect, attempt: number): s is Waiting =>
	s.at === "waiting" && s.wait === null && s.retry.attempt === attempt;

export const reconnectMachine = defineMachine({
	types: {
		model: {} as Reconnect,
		msg: {} as ReconnectMsg,
		sub: {} as LinkSub | TimerSub<ReconnectMsg>,
	},
	cmds: [attach, jitter],
	init: (loaded) => (loaded === null ? trying(initRetry(), null) : [loaded, []]),
	update: {
		ended: (s, m): Step => (s.at === "up" ? failed(initRetry(), m.why, m.at) : [s, []]),
		due: (s, m): Step =>
			s.at === "waiting" && s.wait !== null && s.retry.attempt === m.attempt
				? trying(s.retry, s.why)
				: [s, []],
		again: (s): Step => (s.at === "stopped" ? trying(initRetry(), s.why) : [s, []]),
		attach_ok: (s, m): Step => {
			if (s.at !== "attaching") return [s, []];
			const tried = m.value;
			if (tried.kind === "up") return [{at: "up"}, []];
			if (tried.kind === "refused")
				return [{at: "refused", theirs: tried.theirs, ours: tried.ours}, []];
			return failed(s.retry, tried.why, m.at);
		},
		attach_err: (s, m): Step =>
			s.at === "attaching" ? failed(s.retry, "the try's answer did not read", m.at) : [s, []],
		jitter_ok: (s, m): Step => (picking(s, m.cmd.attempt) ? [{...s, wait: m.value}, []] : [s, []]),
		// A pick that did not read waits the longest, so a broken pick never makes the tries faster.
		jitter_err: (s, m): Step =>
			picking(s, m.cmd.attempt) ? [{...s, wait: POLICY.capMs}, []] : [s, []],
	},
	subs: [
		{type: "link", deps: (s) => (s.at === "up" ? {up: true} : null)},
		{
			type: "timer",
			deps: (s) =>
				s.at === "waiting" && s.wait !== null
					? {ms: s.wait, msg: {type: "due", attempt: s.retry.attempt}}
					: null,
		},
	],
});

/** What the window is told of the link, while it is down. */
export type Note = Extract<ToPage, {readonly type: "down"}>;

/** What the window says of the link now: nothing while it is up, or on the app's first try. */
export const noteOf = (s: Reconnect): Note | null => {
	switch (s.at) {
		case "up":
			return null;
		case "attaching":
			return s.why === null ? null : {type: "down", why: s.why, now: "reconnecting"};
		case "waiting":
			return {type: "down", why: s.why, now: "reconnecting"};
		case "stopped":
			return {type: "down", why: s.why, now: "stopped"};
		case "refused":
			return {
				type: "down",
				why: `The host that runs speaks version ${s.theirs} of the link, and this app speaks ${s.ours}. The app did not attach. That host runs on, with its jobs.`,
				now: "refused",
			};
	}
};
