// Experiment 97's port of experiment 95's answerer (../95-agents-across-hosts/answerer.ts) onto the
// one ledger. The program and its machine are 95's, unchanged. What changed is how the host
// serves it:
//
//   - State lives on `answerer:1/state`; each save's id is the rev it expects. Replay reads that
//     one stream for the last state and every answer on record, not the registry stream.
//   - A reply is one append at the end of the asker's inbox, fenced on the answerer's own lease:
//     95's `fenceOn: registry/answerer:1` is gone, because the fence names its lease. A host that
//     lost `answerer:1` cannot reply, into any inbox. The reply-to address is taken only if it is
//     an inbox (`inboxOf`); anything else is not sent.
//   - The message id of a reply is the question's id, the fence and the reply's count for that id
//     in this serving (`q-17#2@41#1`): each retried call gets its reply, as in 95, and a resend
//     after a lost answer is `dup`.
//   - Questions come by a live tail of `answerer:1/inbox` from the saved cursor.
import type {OnError} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {Context, Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";
import {defineProgram, offer, start} from "../../packages/tea-program/src/program.ts";
import {input, output} from "../../packages/tea-program/src/shape.ts";
import {Agent} from "../95-agents-across-hosts/agent.ts";
import {
	type AnswerCmd,
	type Answerer,
	answerer,
	START,
} from "../95-agents-across-hosts/answer-machine.ts";
import {inboxOf, type Row, streams} from "./service.ts";
import {deliver, type Serving} from "./serving.ts";
import {lastStateOf, ledgerStore} from "./store.ts";

export const AnswererState = Schema.Struct({
	cursor: Schema.Number,
	answered: Schema.Number,
	repeats: Schema.Number,
	last: Schema.NullOr(
		Schema.Struct({id: Schema.String, corr: Schema.String, answer: Schema.String}),
	),
});

/** One question as the program reads it: the send, and its place in the inbox. */
export const Asked = Schema.Struct({
	id: Schema.String,
	corr: Schema.String,
	replyTo: Schema.String,
	text: Schema.String,
	rev: Schema.Int,
});
export type Asked = typeof Asked.Type;
const Sent = Schema.Struct({
	id: Schema.String,
	corr: Schema.String,
	replyTo: Schema.String,
	text: Schema.String,
});
const decodeSent = Schema.decodeUnknownExit(Schema.fromJsonString(Sent));

/** What the answerer's host gives it: its journal, where failures with no caller go, how to reply, the answers on record. */
export class Desk extends Context.Service<
	Desk,
	{
		readonly store: ReturnType<typeof ledgerStore<Answerer>>;
		readonly onError: OnError;
		/** One reply, sent. It tells the machine nothing back: how it went is logged, and a lost one is a retried call. */
		readonly reply: (cmd: AnswerCmd) => Effect.Effect<void>;
		/** Every answer on record, by message id: the idempotency keys and their saved results. */
		readonly known: Map<string, string>;
		readonly line: (o: object) => Effect.Effect<void>;
	}
>()("exp97/Desk") {}

export const answererProgram = defineProgram({
	name: "answerer",
	description:
		"Answers each question it is sent, once per message id: a retried call gets the answer on record, and the agent is not asked again.",
	inputs: {question: input(Asked, "One question: its message id, reply-to, text and inbox rev.")},
	outputs: {answered: output(Schema.Int, "Answers produced so far.")},
	main: ({inputs, send}) =>
		Effect.gen(function* () {
			const desk = yield* Desk;
			const agent = yield* Agent;
			const handle = yield* run(answerer, {
				ctx: undefined,
				store: desk.store,
				onError: desk.onError,
				interpret: {reply: (cmd) => desk.reply(cmd)},
			});
			const machine = yield* handle.ready;
			yield* inputs.question.pipe(
				Stream.runForEach((q) =>
					Effect.gen(function* () {
						if (q.rev <= machine.getState().cursor) return;
						const known = desk.known.get(q.id);
						const asked = {id: q.id, corr: q.corr, replyTo: q.replyTo, rev: q.rev};
						if (known !== undefined) {
							yield* desk.line({ev: "repeat", id: q.id, rev: q.rev});
							return yield* machine.dispatch({type: "repeat", ...asked, answer: known});
						}
						const t0 = Date.now();
						const thought = yield* agent.ask(q.text);
						yield* desk.line({
							ev: "think",
							id: q.id,
							rev: q.rev,
							ms: Date.now() - t0,
							usd: thought.usd,
							agent: agent.name,
						});
						yield* machine.dispatch({type: "answered", ...asked, answer: thought.answer});
						desk.known.set(q.id, thought.answer);
						yield* send("answered", machine.getState().answered);
					}),
				),
			);
		}).pipe(Effect.scoped),
});

/** Every answer on record in a state stream: each saved state names the answer produced last. */
const knownOf = (rows: readonly Row[]) => {
	const one = lastStateOf(AnswererState);
	const known = new Map<string, string>();
	for (const r of rows) {
		const s = one([r]).state;
		if (s?.last != null) known.set(s.last.id, s.last.answer);
	}
	return known;
};

export const serveAnswerer = (o: Serving) =>
	Effect.gen(function* () {
		const {ledger, name, fence, holder, line} = o;
		const S = streams(name);
		const t0 = Date.now();
		const again = <A, E>(read: Effect.Effect<A, E>) =>
			read.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);
		const states = yield* again(ledger.readStream(S.state));
		const saved = lastStateOf(AnswererState)(states).state ?? START;
		const known = knownOf(states);
		const inboxEnd = yield* again(ledger.readLast(S.inbox, 1));
		const asked = (r: Row): Asked | null => {
			if (r.rev <= saved.cursor) return null;
			const exit = decodeSent(r.data);
			return Exit.isSuccess(exit) ? {...exit.value, rev: r.rev} : null;
		};
		const store = ledgerStore(ledger, {
			schema: AnswererState,
			stream: S.state,
			fence,
			holder,
			saveId: (_, expected) => String(expected),
			note: (n, s) =>
				Effect.runSync(line({...n, answered: s.answered, repeats: s.repeats, cursor: s.cursor})),
		});
		/** Replies sent per question id in this serving: the last part of each reply's message id. */
		const replies = new Map<string, number>();
		const reply = (cmd: AnswerCmd) =>
			Effect.gen(function* () {
				const to = inboxOf(cmd.to);
				if (to === null) return yield* line({ev: "reply", id: cmd.id, how: "not an inbox"});
				const k = (replies.get(cmd.id) ?? 0) + 1;
				replies.set(cmd.id, k);
				const sent = yield* deliver(o, to, `${cmd.id}@${fence}#${k}`, {
					kind: "reply",
					data: {id: cmd.id, corr: cmd.corr, answer: cmd.answer, fence},
				});
				yield* line({ev: "reply", id: cmd.id, how: sent.how});
			});
		const started = yield* start(answererProgram, {}, {}).pipe(
			Effect.provideService(Desk, {store, onError: o.onError, reply, known, line}),
		);
		if (started.kind !== "running") return yield* Effect.die(`answerer refused: ${started.why}`);
		yield* line({
			ev: "program",
			phase: "started",
			fence,
			answered: saved.answered,
			cursor: saved.cursor,
			known: known.size,
			backlog: Math.max(0, (inboxEnd.at(-1)?.rev ?? 0) - saved.cursor),
			replayMs: Date.now() - t0,
		});
		yield* o.started;

		const feed = o.tail(S.inbox, saved.cursor).pipe(
			Stream.runForEach((r) => {
				const q = asked(r);
				return q === null ? Effect.void : offer(started.run, "question", q);
			}),
		);
		yield* Effect.forkScoped(feed);
		return yield* started.run.ended;
	});
