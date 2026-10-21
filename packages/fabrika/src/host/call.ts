// gen_server:call between programs on the ledger: send, reply-to, deadline, and the retry OTP
// leaves to the caller. An Elm module, not a machine: a parent program keeps `Calls` in its own
// state and hands its Msgs to `update`, as Elm parents do (docs/direction/elm-first.md).
//
//   call(s, "q-17", req)       pending q-17, try 1: send {id: "q-17", tries: 1}
//   sent q-17 1 at t           its deadline is t + timeoutMs
//   timed_out q-17 1           send it again: try 2, the SAME call id; the callee dedupes on it
//   reply q-17 rev 40          the first reply answers the call; any later one changes nothing
//   resume                     the program started again: send every pending call again
//
// Lifted from experiment 95 (experiments/95-agents-across-hosts/call-machine.ts), where it was
// the asker's whole machine, with its window and its questions. Here it is only the calls; the
// window and what to ask stay with the parent. Pure: the clock comes in as Msgs (`sent` says when
// a send landed; `deadlines` says when one ran out). The message id of each try is
// `<call id>#<try>`, so every retry lands in the callee's inbox and a resend after a lost answer
// is `dup`.
import {Duration, Effect, Stream} from "effect";

export interface CallSettings {
	/** How long a call waits for its reply after its send landed, before sending again. */
	readonly timeoutMs: number;
	/** How long to wait after a send that did not land, before sending again. */
	readonly retryMs: number;
}

export interface Pending<Req> {
	/** The call id: the callee's idempotency key and the reply's correlation id. */
	readonly id: string;
	readonly req: Req;
	/** Sends so far, this one included. */
	readonly tries: number;
	/** When this try times out, or `null`: its send has not landed yet. */
	readonly due: number | null;
}

export interface Calls<Req> {
	readonly pending: readonly Pending<Req>[];
	/** The inbox rev of the last reply read: one at or behind it was read before. */
	readonly cursor: number;
}

export const noCalls = <Req>(): Calls<Req> => ({pending: [], cursor: 0});

export type CallMsg<Res> =
	/** The program started (or started again): send every pending call again. */
	| {readonly type: "resume"}
	| {readonly type: "sent"; readonly id: string; readonly tries: number; readonly at: number}
	| {readonly type: "send_failed"; readonly id: string; readonly tries: number; readonly at: number}
	| {readonly type: "timed_out"; readonly id: string; readonly tries: number}
	| {readonly type: "reply"; readonly id: string; readonly rev: number; readonly res: Res};

export type CallCmd<Req> = {
	readonly type: "send";
	readonly id: string;
	readonly tries: number;
	readonly req: Req;
};

/** The message id of one try: every try lands; a resend of one try is `dup`. */
export const messageIdOf = (cmd: CallCmd<unknown>) => `${cmd.id}#${cmd.tries}`;

const sendOf = <Req>(p: Pending<Req>): CallCmd<Req> => ({
	type: "send",
	id: p.id,
	tries: p.tries,
	req: p.req,
});

/** What one Msg did beside the new state and the sends. */
export type Outcome<Req, Res> =
	| {readonly kind: "answered"; readonly id: string; readonly req: Req; readonly res: Res}
	/** A reply for a call no longer pending: a second reply to a retried call. */
	| {readonly kind: "extra"; readonly id: string}
	| null;

export interface Stepped<Req, Res> {
	readonly calls: Calls<Req>;
	readonly cmds: readonly CallCmd<Req>[];
	readonly outcome: Outcome<Req, Res>;
}

/** Make a call. An id already pending is not called twice. */
export const call = <Req>(s: Calls<Req>, id: string, req: Req): Stepped<Req, never> => {
	if (s.pending.some((p) => p.id === id)) return {calls: s, cmds: [], outcome: null};
	const p: Pending<Req> = {id, req, tries: 1, due: null};
	return {calls: {...s, pending: [...s.pending, p]}, cmds: [sendOf(p)], outcome: null};
};

const setDue = <Req>(s: Calls<Req>, id: string, tries: number, due: number): Calls<Req> => {
	const p = s.pending.find((x) => x.id === id);
	if (p === undefined || p.tries !== tries || p.due !== null) return s;
	return {...s, pending: s.pending.map((x) => (x === p ? {...p, due} : x))};
};

export const update =
	(settings: CallSettings) =>
	<Req, Res>(s: Calls<Req>, m: CallMsg<Res>): Stepped<Req, Res> => {
		const none = (calls: Calls<Req>): Stepped<Req, Res> => ({calls, cmds: [], outcome: null});
		switch (m.type) {
			case "resume": {
				const again = s.pending.map((p) => ({...p, tries: p.tries + 1, due: null}));
				return {calls: {...s, pending: again}, cmds: again.map(sendOf), outcome: null};
			}
			case "sent":
				return none(setDue(s, m.id, m.tries, m.at + settings.timeoutMs));
			case "send_failed":
				return none(setDue(s, m.id, m.tries, m.at + settings.retryMs));
			case "timed_out": {
				const p = s.pending.find((x) => x.id === m.id);
				if (p === undefined || p.tries !== m.tries || p.due === null) return none(s);
				const again = {...p, tries: p.tries + 1, due: null};
				return {
					calls: {...s, pending: s.pending.map((x) => (x === p ? again : x))},
					cmds: [sendOf(again)],
					outcome: null,
				};
			}
			case "reply": {
				if (m.rev <= s.cursor) return none(s);
				const p = s.pending.find((x) => x.id === m.id);
				if (p === undefined)
					return {calls: {...s, cursor: m.rev}, cmds: [], outcome: {kind: "extra", id: m.id}};
				return {
					calls: {cursor: m.rev, pending: s.pending.filter((x) => x !== p)},
					cmds: [],
					outcome: {kind: "answered", id: p.id, req: p.req, res: m.res},
				};
			}
		}
	};

/** One deadline a pending call waits on. */
export type Deadline = {readonly id: string; readonly tries: number; readonly at: number};

/** Every pending call whose send landed, and when it times out. */
export const deadlinesOf = <Req>(s: Calls<Req>): readonly Deadline[] =>
	s.pending.flatMap((p) => (p.due === null ? [] : [{id: p.id, tries: p.tries, at: p.due}]));

/** The deadlines Sub's runner: one `timed_out` per deadline, at its time. Times are absolute. */
export const deadlines = (list: readonly Deadline[]): Stream.Stream<CallMsg<never>> =>
	Stream.fromIterable([...list].sort((a, b) => a.at - b.at)).pipe(
		Stream.mapEffect((d) =>
			Effect.sleep(Duration.millis(Math.max(0, d.at - Date.now()))).pipe(
				Effect.as<CallMsg<never>>({type: "timed_out", id: d.id, tries: d.tries}),
			),
		),
	);
