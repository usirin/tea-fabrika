// Experiment 95's answerer as a program the package serves. The machine is 95's
// (../95-agents-across-hosts/answer-machine.ts), unchanged; the program is 97's
// (../97-one-ledger/answerer.ts) without its host half. It reads the answers on record from its
// own state stream (`self.reads`), runs the machine with `self.run`, and replies with `self.send`,
// fenced on its own lease: a host that lost `answerer:1` cannot reply, into any inbox.
//
// A reply's message id is the call id, the fence and the reply's count for that id in this
// serving (`q-17@41#1`): each retried call gets its reply, and a resend after a lost answer is `dup`.
import {defineProgram, envelope, inboxOf, input, Self, streams} from "@kampus/fabrika";
import {Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";
import {type AnswerCmd, answerer} from "../95-agents-across-hosts/answer-machine.ts";

export const AnswererState = Schema.Struct({
	cursor: Schema.Number,
	answered: Schema.Number,
	repeats: Schema.Number,
	last: Schema.NullOr(
		Schema.Struct({id: Schema.String, corr: Schema.String, answer: Schema.String}),
	),
});

/** A question as the asker sends it. */
export const Question = Schema.Struct({
	id: Schema.String,
	corr: Schema.String,
	replyTo: Schema.String,
	text: Schema.String,
	fence: Schema.Number,
});

export interface Agent {
	readonly name: string;
	readonly ask: (text: string) => Effect.Effect<{readonly answer: string; readonly usd: number}>;
}

const Saved = Schema.fromJsonString(Schema.Struct({state: AnswererState}));
const decodeSaved = Schema.decodeUnknownExit(Saved);

export const answererProgram = (agent: Agent, line: (o: object) => Effect.Effect<void>) =>
	defineProgram({
		name: "answerer",
		description:
			"Answers each question it is sent, once per call id: a retried call gets the answer on record, and the agent is not asked again.",
		inputs: {inbox: input(envelope(Question), "One question: call id, reply-to, text.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				// The answers on record: each saved state names the answer produced last.
				const states = yield* self.reads
					.readStream(streams(self.name).state)
					.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);
				const known = new Map<string, string>();
				for (const r of states) {
					const exit = decodeSaved(r.data);
					const last = Exit.isSuccess(exit) ? exit.value.state.last : null;
					if (last !== null) known.set(last.id, last.answer);
				}
				const replies = new Map<string, number>();
				const reply = (cmd: AnswerCmd) =>
					Effect.gen(function* () {
						const to = inboxOf(cmd.to);
						if (to === null) return yield* line({ev: "reply", id: cmd.id, how: "not an inbox"});
						const k = (replies.get(cmd.id) ?? 0) + 1;
						replies.set(cmd.id, k);
						const sent = yield* self.send(to, `${cmd.id}@${self.fence}#${k}`, {
							id: cmd.id,
							corr: cmd.corr,
							answer: cmd.answer,
							fence: self.fence,
						});
						yield* line({ev: "reply", id: cmd.id, how: sent.how});
					});
				const handle = yield* self.run(
					answerer,
					{schema: AnswererState, cursor: (s) => s.cursor},
					{ctx: undefined, interpret: {reply}},
				);
				const machine = yield* handle.ready;
				yield* line({ev: "known", known: known.size});
				yield* inputs.inbox.pipe(
					Stream.runForEach((e) =>
						Effect.gen(function* () {
							if (e.rev <= machine.getState().cursor) return;
							const q = e.body;
							const asked = {id: q.id, corr: q.corr, replyTo: q.replyTo, rev: e.rev};
							const had = known.get(q.id);
							if (had !== undefined) {
								yield* line({ev: "repeat", id: q.id, rev: e.rev});
								return yield* machine.dispatch({type: "repeat", ...asked, answer: had});
							}
							const t0 = Date.now();
							const thought = yield* agent.ask(q.text);
							yield* line({
								ev: "think",
								id: q.id,
								rev: e.rev,
								ms: Date.now() - t0,
								usd: thought.usd,
								agent: agent.name,
							});
							yield* machine.dispatch({type: "answered", ...asked, answer: thought.answer});
							known.set(q.id, thought.answer);
						}),
					),
				);
			}).pipe(Effect.scoped),
	});
