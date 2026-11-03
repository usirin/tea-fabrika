// Experiment 95's asker as a program the package serves, its calls on the package's call module
// (`Call` in `@kampus/fabrika-old`, gen_server:call). 95's call machine was the whole asker: window,
// questions and calls in one. Here the calls are the package's Elm module, and this parent keeps
// only what is the asker's own: which question is next, how many are pending at once (the
// window), and what the answers were. Elm's way: the parent holds the child's state and hands it
// the child's Msgs (docs/direction/elm-first.md).
//
//   resume          the call module sends every pending call again; the parent fills the window
//   reply q-17      the call module answers q-17; the parent counts it and asks the next question
//   timed_out q-17  the call module sends q-17 again, same call id, next try
import {type DepKeyedSub, defineMachine, type Sub} from "@demlik/tea";
import {Call, defineProgram, envelope, type Inbox, input, Self, streams} from "@kampus/fabrika-old";
import {Effect, Schema, Stream} from "effect";
import {isRight, questionOf} from "../95-agents-across-hosts/question.ts";

export const AskerState = Schema.Struct({
	/** The next question to ask, 1-based. */
	next: Schema.Number,
	/** The call module's state: the calls pending, and the inbox rev of the last reply read. */
	calls: Schema.Struct({
		pending: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				req: Schema.Number,
				tries: Schema.Number,
				due: Schema.NullOr(Schema.Number),
			}),
		),
		cursor: Schema.Number,
	}),
	answered: Schema.Number,
	wrong: Schema.Number,
	/** Replies for a call no longer pending: a second reply to a retried call. */
	extra: Schema.Number,
	last: Schema.NullOr(
		Schema.Struct({i: Schema.Number, answer: Schema.String, right: Schema.Boolean}),
	),
});
export type AskerState = typeof AskerState.Type;

const START: AskerState = {
	next: 1,
	calls: Call.noCalls<number>(),
	answered: 0,
	wrong: 0,
	extra: 0,
	last: null,
};

export interface AskerSettings extends Call.CallSettings {
	/** How many questions in all. */
	readonly total: number;
	/** How many calls may be pending at once. */
	readonly window: number;
}

type Msg = Call.CallMsg<string>;
type Cmd = Call.CallCmd<number>;
type CallSub = Sub<"deadlines", {readonly list: readonly Call.Deadline[]}>;
type Step = readonly [AskerState, readonly Cmd[]];

/** Ask new questions until `window` are pending or none are left. */
const fill = (settings: AskerSettings, s: AskerState, cmds: readonly Cmd[]): Step => {
	let calls = s.calls;
	let next = s.next;
	const sends = [...cmds];
	while (calls.pending.length < settings.window && next <= settings.total) {
		const stepped = Call.call(calls, questionOf(next).id, next);
		calls = stepped.calls;
		sends.push(...stepped.cmds);
		next++;
	}
	return [next === s.next ? s : {...s, calls, next}, sends];
};

export const askerUpdate = (settings: AskerSettings) => {
	const calls = Call.update(settings);
	return (s: AskerState, m: Msg): Step => {
		const stepped = calls<number, string>(s.calls, m);
		const o = stepped.outcome;
		const after: AskerState =
			o === null
				? {...s, calls: stepped.calls}
				: o.kind === "extra"
					? {...s, calls: stepped.calls, extra: s.extra + 1}
					: (() => {
							const right = isRight(questionOf(o.req), o.res);
							return {
								...s,
								calls: stepped.calls,
								answered: s.answered + 1,
								wrong: s.wrong + (right ? 0 : 1),
								last: {i: o.req, answer: o.res, right},
							};
						})();
		return m.type === "resume" || o?.kind === "answered"
			? fill(settings, after, stepped.cmds)
			: [after, stepped.cmds];
	};
};

export const createAsker = (settings: AskerSettings) => {
	const step = askerUpdate(settings);
	return defineMachine<AskerState, Msg, Cmd, CallSub, undefined>({
		types: {
			model: {} as AskerState,
			msg: {} as Msg,
			cmd: {} as Cmd,
			sub: {} as CallSub,
			ctx: undefined,
		},
		init: (loaded) => [loaded ?? START, []],
		update: {resume: step, sent: step, send_failed: step, timed_out: step, reply: step},
		subs: [
			// The one cast: tea's `DepKeyedSub` is a conditional type a literal cannot be checked against.
			{
				type: "deadlines",
				deps: (s: AskerState) => {
					const list = Call.deadlinesOf(s.calls);
					return list.length === 0 ? null : {list};
				},
			} as DepKeyedSub<AskerState, CallSub>,
		],
	});
};

/** A reply as the answerer sends it. */
export const Reply = Schema.Struct({
	id: Schema.String,
	corr: Schema.String,
	answer: Schema.String,
	fence: Schema.Number,
});

export const askerProgram = (
	settings: AskerSettings,
	to: string,
	line: (o: object) => Effect.Effect<void>,
) =>
	defineProgram({
		name: "asker",
		description:
			"Asks its questions of another program, each as a call with a deadline, and sends a call again under the same call id when its reply is late.",
		inputs: {inbox: input(envelope(Reply), "One reply: the call id, the answer.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				const target: Inbox = streams(to).inbox;
				const send = (cmd: Cmd) =>
					Effect.gen(function* () {
						const q = questionOf(cmd.req);
						const began = Date.now();
						const sent = yield* self.send(target, Call.messageIdOf(cmd), {
							id: cmd.id,
							corr: q.corr,
							replyTo: self.inbox,
							text: q.text,
							fence: self.fence,
						});
						const at = Date.now();
						yield* line({ev: "send", i: cmd.req, tries: cmd.tries, began, at, how: sent.how});
						const landed: Msg =
							sent.how === "sent"
								? {type: "sent", id: cmd.id, tries: cmd.tries, at}
								: {type: "send_failed", id: cmd.id, tries: cmd.tries, at};
						return landed;
					});
				const handle = yield* self.run(
					createAsker(settings),
					{schema: AskerState, cursor: (s) => s.calls.cursor},
					{
						ctx: undefined,
						interpret: {send},
						subscribe: {deadlines: (sub) => Call.deadlines(sub.deps.list)},
					},
				);
				const machine = yield* handle.ready;
				yield* machine.dispatch({type: "resume"});
				yield* inputs.inbox.pipe(
					Stream.runForEach((e) =>
						line({ev: "heard", id: e.body.id, rev: e.rev, from: e.from}).pipe(
							Effect.andThen(
								machine.dispatch({type: "reply", id: e.body.id, rev: e.rev, res: e.body.answer}),
							),
							Effect.andThen(() => {
								const s = machine.getState();
								return s.answered === settings.total && s.calls.pending.length === 0
									? line({ev: "done", answered: s.answered})
									: Effect.void;
							}),
						),
					),
				);
			}).pipe(Effect.scoped),
	});
