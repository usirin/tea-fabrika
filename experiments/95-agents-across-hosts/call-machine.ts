// The asker's calls, as a tea machine: OTP's `gen_server:call` (send, reply-to, timeout) for
// many calls at once, with the retry OTP leaves to the caller. Pure: no clock, no ledger. The
// clock comes in as Msgs (`sent` says when a send landed, a deadline Sub says when it ran out).
//
//   call i       send {id: "q-i", corr: "asker:1#i", tries: 1}, then wait for a reply carrying corr
//   timed out    send the SAME id again (tries 2, 3, ...): the answerer dedupes on it
//   reply        the first reply for a pending corr answers the call; any later one changes nothing
//
// At most `window` calls are pending at once; when one is answered, the next question is
// asked. Every pending call is saved, so a host that restarts the asker resends exactly the
// calls still open, under the same ids (`resume`).
import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {isRight, questionOf} from "./question.ts";

export interface CallSettings {
	/** How many questions in all. */
	readonly total: number;
	/** How many calls may be pending at once. */
	readonly window: number;
	/** How long a call waits for its reply after its send landed, before sending again. */
	readonly timeoutMs: number;
	/** How long to wait after a send that did not land, before sending again. */
	readonly retryMs: number;
	/** Real mode: every question is the one fixed real question. */
	readonly real: boolean;
}

export interface Pending {
	readonly i: number;
	/** Sends so far, this one included. Every one carries the same message id. */
	readonly tries: number;
	/** When this try times out, or `null`: its send has not landed yet. */
	readonly due: number | null;
}

export interface Asker {
	/** The next question to ask, 1-based. */
	readonly next: number;
	readonly pending: readonly Pending[];
	readonly answered: number;
	/** Answers that were not the expected one. */
	readonly wrong: number;
	/** Replies for a call that was no longer pending: a second reply to a retried call. */
	readonly extra: number;
	/** The inbox rev of the last reply read. */
	readonly cursor: number;
	/** The call answered last and its answer: the saved states, in order, name every answer. */
	readonly last: {readonly i: number; readonly answer: string; readonly right: boolean} | null;
}

export const START: Asker = {
	next: 1,
	pending: [],
	answered: 0,
	wrong: 0,
	extra: 0,
	cursor: 0,
	last: null,
};

export type Reply = {
	readonly id: string;
	readonly corr: string;
	readonly answer: string;
	/** Its rev in the asker's inbox. */
	readonly rev: number;
};

export type CallMsg =
	/** The program started (or started again): send every pending call again, and fill the window. */
	| {readonly type: "resume"}
	| {readonly type: "sent"; readonly i: number; readonly tries: number; readonly at: number}
	| {readonly type: "send_failed"; readonly i: number; readonly tries: number; readonly at: number}
	| {readonly type: "timed_out"; readonly i: number; readonly tries: number}
	| ({readonly type: "reply"} & Reply);

export type CallCmd = {
	readonly type: "send";
	readonly i: number;
	readonly tries: number;
	readonly id: string;
	readonly corr: string;
};

/** One deadline a pending call waits on. */
export type Deadline = {readonly i: number; readonly tries: number; readonly at: number};
export type CallSub = Sub<"deadlines", {readonly list: readonly Deadline[]}>;

/** The send of try `tries` of call `i`: the message id and correlation id come from `i` alone. */
export const sendOf = (settings: CallSettings, i: number, tries: number): CallCmd => {
	const q = questionOf(i, settings.real);
	return {type: "send", i, tries, id: q.id, corr: q.corr};
};

/** Every pending call whose send landed, and when it times out. The laws read this same function. */
export const deadlinesOf = (s: Asker): readonly Deadline[] =>
	s.pending.flatMap((p) => (p.due === null ? [] : [{i: p.i, tries: p.tries, at: p.due}]));

export const isDone = (settings: CallSettings, s: Asker): boolean =>
	s.answered === settings.total && s.pending.length === 0;

type Step = readonly [Asker, readonly CallCmd[]];

/** Ask new questions until `window` are pending or none are left. */
const fill = (settings: CallSettings, s: Asker, cmds: readonly CallCmd[]): Step => {
	let next = s.next;
	const pending = [...s.pending];
	const sends = [...cmds];
	while (pending.length < settings.window && next <= settings.total) {
		pending.push({i: next, tries: 1, due: null});
		sends.push(sendOf(settings, next, 1));
		next++;
	}
	return [next === s.next && sends.length === cmds.length ? s : {...s, next, pending}, sends];
};

const setDue = (s: Asker, i: number, tries: number, due: number): Asker => {
	const p = s.pending.find((x) => x.i === i);
	if (p === undefined || p.tries !== tries || p.due !== null) return s;
	return {...s, pending: s.pending.map((x) => (x === p ? {...p, due} : x))};
};

export const callUpdate =
	(settings: CallSettings) =>
	(s: Asker, m: CallMsg): Step => {
		switch (m.type) {
			case "resume": {
				const again = s.pending.map((p) => ({i: p.i, tries: p.tries + 1, due: null}));
				return fill(
					settings,
					{...s, pending: again},
					again.map((p) => sendOf(settings, p.i, p.tries)),
				);
			}
			case "sent":
				return [setDue(s, m.i, m.tries, m.at + settings.timeoutMs), []];
			case "send_failed":
				return [setDue(s, m.i, m.tries, m.at + settings.retryMs), []];
			case "timed_out": {
				const p = s.pending.find((x) => x.i === m.i);
				if (p === undefined || p.tries !== m.tries || p.due === null) return [s, []];
				const again = {i: p.i, tries: p.tries + 1, due: null};
				return [
					{...s, pending: s.pending.map((x) => (x === p ? again : x))},
					[sendOf(settings, p.i, again.tries)],
				];
			}
			case "reply": {
				if (m.rev <= s.cursor) return [s, []];
				const p = s.pending.find((x) => questionOf(x.i, settings.real).corr === m.corr);
				if (p === undefined) return [{...s, cursor: m.rev, extra: s.extra + 1}, []];
				const right = isRight(questionOf(p.i, settings.real), m.answer);
				return fill(
					settings,
					{
						...s,
						cursor: m.rev,
						pending: s.pending.filter((x) => x !== p),
						answered: s.answered + 1,
						wrong: s.wrong + (right ? 0 : 1),
						last: {i: p.i, answer: m.answer, right},
					},
					[],
				);
			}
		}
	};

export const callSubs = () => [
	// The one cast: tea's `DepKeyedSub` is a conditional type that a literal cannot be checked against.
	{
		type: "deadlines",
		deps: (s: Asker) => {
			const list = deadlinesOf(s);
			return list.length === 0 ? null : {list};
		},
	} as DepKeyedSub<Asker, CallSub>,
];

export const createCalls = (settings: CallSettings) => {
	const step = callUpdate(settings);
	const cell = (s: Asker, m: CallMsg) => step(s, m);
	return defineMachine<Asker, CallMsg, CallCmd, CallSub, undefined>({
		types: {
			model: {} as Asker,
			msg: {} as CallMsg,
			cmd: {} as CallCmd,
			sub: {} as CallSub,
			ctx: undefined,
		},
		init: (loaded) => [loaded ?? START, []],
		update: {resume: cell, sent: cell, send_failed: cell, timed_out: cell, reply: cell},
		subs: callSubs(),
	});
};
