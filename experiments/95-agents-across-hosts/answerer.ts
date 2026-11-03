// The `answerer` tea program, and how a host serves it while it owns `answerer:1`.
//
// The program: for each question in its inbox, in order, either a new answer (ask the agent,
// then tell the machine `answered`) or, for a message id answered before, the answer on record
// (tell it `repeat`; the agent is not asked). That is an idempotency key: the caller retries
// under the same id and gets the same answer back, and the work is done once. The machine
// (./answer-machine.ts) saves each step under the host's fence before it sends the reply.
//
// Serving it (OTP's `handle_call` loop): replay the last saved state and every answer on
// record from the registry stream, start the program, and feed it the inbox from its cursor on.
// Every reply is one fenced append to the caller's inbox, fenced on `registry/answerer:1`, so
// a host that lost the name cannot reply, even into another program's inbox.
import type {OnError} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {defineProgram, input, offer, output, start} from "@kampus/fabrika-old";
import {Context, Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";
import {Agent} from "./agent.ts";
import {type AnswerCmd, type Answerer, answerer, START} from "./answer-machine.ts";
import {type Row, sender, streams} from "./client.ts";
import type {Serving} from "./serving.ts";
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
>()("exp95/Desk") {}

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

/** Every answer on record in a registry stream: each saved state names the answer produced last. */
const knownOf = (rows: readonly Row[]) => {
	const one = lastStateOf(AnswererState);
	const known = new Map<string, string>();
	for (const r of rows) {
		const s = r.kind === "state" ? one([r]).state : null;
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
		const registry = yield* again(ledger.readStream(S.registry));
		const saved = lastStateOf(AnswererState)(registry).state ?? START;
		const known = knownOf(registry);
		const inbox = yield* again(ledger.readStream(S.inbox));
		const backlog: Asked[] = [];
		let pos = 0;
		let lastRev = 0;
		const asked = (r: Row): Asked | null => {
			pos = Math.max(pos, r.pos);
			lastRev = r.rev;
			if (r.rev <= saved.cursor) return null;
			const exit = decodeSent(r.data);
			return Exit.isSuccess(exit) ? {...exit.value, rev: r.rev} : null;
		};
		for (const r of inbox) {
			const q = asked(r);
			if (q !== null) backlog.push(q);
		}
		const tell = sender(ledger, {holder, fence, fenceOn: S.registry});
		const store = ledgerStore(ledger, {
			schema: AnswererState,
			stream: S.registry,
			fence,
			holder,
			note: (n, s) =>
				Effect.runSync(line({...n, answered: s.answered, repeats: s.repeats, cursor: s.cursor})),
		});
		const reply = (cmd: AnswerCmd) =>
			Effect.gen(function* () {
				const sent = yield* tell(cmd.to, "reply", {
					id: cmd.id,
					corr: cmd.corr,
					answer: cmd.answer,
					fence,
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
			backlog: backlog.length,
			replayMs: Date.now() - t0,
		});
		yield* o.started;

		const feed = Effect.gen(function* () {
			for (const q of backlog) yield* offer(started.run, "question", q);
			for (;;) {
				const rows = yield* ledger.read(pos, 1000).pipe(Effect.orElseSucceed(() => []));
				for (const r of rows) {
					if (r.stream !== S.inbox || r.rev <= lastRev) {
						pos = r.pos;
						continue;
					}
					const q = asked(r);
					if (q !== null) yield* offer(started.run, "question", q);
				}
				if (rows.length < 1000) yield* Effect.sleep(Duration.millis(5));
			}
		});
		yield* Effect.forkScoped(feed);
		return yield* started.run.ended;
	});
