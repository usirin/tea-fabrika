// The `asker` tea program, and how a host serves it while it owns `asker:1`.
//
// The program runs the call machine (./call-machine.ts): it asks `total` questions of
// `answerer:1`, at most `window` at a time, each one a call. A call's send is one fenced append
// to `answerer:1/inbox` with a message id, a correlation id and the reply-to address
// `asker:1/inbox`. A reply is an event in that inbox; the host feeds them to the program in
// order. The deadlines Sub turns a call that waited too long into `timed_out`, and the
// machine sends it again under the same message id.
import type {OnError} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {defineProgram, input, offer, output, start} from "@kampus/fabrika";
import {Context, Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";
import {
	type Asker,
	type CallCmd,
	type CallMsg,
	type CallSettings,
	createCalls,
	type Deadline,
	isDone,
	START,
} from "./call-machine.ts";
import {type Row, sender, streams} from "./client.ts";
import {questionOf} from "./question.ts";
import type {Serving} from "./serving.ts";
import {lastStateOf, ledgerStore} from "./store.ts";

export const AskerState = Schema.Struct({
	next: Schema.Number,
	pending: Schema.Array(
		Schema.Struct({i: Schema.Number, tries: Schema.Number, due: Schema.NullOr(Schema.Number)}),
	),
	answered: Schema.Number,
	wrong: Schema.Number,
	extra: Schema.Number,
	cursor: Schema.Number,
	last: Schema.NullOr(
		Schema.Struct({i: Schema.Number, answer: Schema.String, right: Schema.Boolean}),
	),
});

export const ReplyIn = Schema.Struct({
	id: Schema.String,
	corr: Schema.String,
	answer: Schema.String,
	rev: Schema.Int,
});
type ReplyIn = typeof ReplyIn.Type;
const ReplyData = Schema.Struct({id: Schema.String, corr: Schema.String, answer: Schema.String});
const decodeReply = Schema.decodeUnknownExit(Schema.fromJsonString(ReplyData));

/** What the asker's host gives it. */
export class Caller extends Context.Service<
	Caller,
	{
		readonly settings: CallSettings;
		readonly store: ReturnType<typeof ledgerStore<Asker>>;
		readonly onError: OnError;
		/** One send of one call: what the Cmd does. */
		readonly send: (cmd: CallCmd) => Effect.Effect<CallMsg>;
		readonly line: (o: object) => Effect.Effect<void>;
	}
>()("exp95/Caller") {}

/** The deadlines Sub: one `timed_out` per deadline, at its time. A new list restarts it; times are absolute. */
const deadlines = (list: readonly Deadline[]) =>
	Stream.fromIterable([...list].sort((a, b) => a.at - b.at)).pipe(
		Stream.mapEffect((d) =>
			Effect.sleep(Duration.millis(Math.max(0, d.at - Date.now()))).pipe(
				Effect.as<CallMsg>({type: "timed_out", i: d.i, tries: d.tries}),
			),
		),
	);

export const askerProgram = defineProgram({
	name: "asker",
	description:
		"Asks its questions of another program, each as a call with a timeout, and sends a call again under the same message id when its reply is late.",
	inputs: {
		reply: input(ReplyIn, "One reply in its inbox: message id, correlation id, answer, rev."),
	},
	outputs: {answered: output(Schema.Int, "Calls answered so far.")},
	main: ({inputs, send}) =>
		Effect.gen(function* () {
			const c = yield* Caller;
			const handle = yield* run(createCalls(c.settings), {
				ctx: undefined,
				store: c.store,
				onError: c.onError,
				interpret: {send: (cmd) => c.send(cmd)},
				subscribe: {deadlines: (sub) => deadlines(sub.deps.list)},
			});
			const machine = yield* handle.ready;
			yield* machine.dispatch({type: "resume"});
			yield* inputs.reply.pipe(
				Stream.runForEach((r) =>
					machine.dispatch({type: "reply", ...r}).pipe(
						Effect.andThen(() => send("answered", machine.getState().answered)),
						Effect.andThen(() =>
							isDone(c.settings, machine.getState())
								? c.line({ev: "done", answered: machine.getState().answered})
								: Effect.void,
						),
					),
				),
			);
		}).pipe(Effect.scoped),
});

export const serveAsker = (o: Serving, settings: CallSettings, to: string) =>
	Effect.gen(function* () {
		const {ledger, name, fence, holder, line} = o;
		const S = streams(name);
		const target = streams(to).inbox;
		const t0 = Date.now();
		const again = <A, E>(read: Effect.Effect<A, E>) =>
			read.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);
		const saved =
			lastStateOf(AskerState)(yield* again(ledger.readStream(S.registry))).state ?? START;
		const inbox = yield* again(ledger.readStream(S.inbox));
		let pos = 0;
		let lastRev = 0;
		const heard = (r: Row): ReplyIn | null => {
			pos = Math.max(pos, r.pos);
			lastRev = r.rev;
			if (r.rev <= saved.cursor) return null;
			const exit = decodeReply(r.data);
			return Exit.isSuccess(exit) ? {...exit.value, rev: r.rev} : null;
		};
		const backlog = inbox.flatMap((r) => {
			const h = heard(r);
			return h === null ? [] : [h];
		});
		const tell = sender(ledger, {holder, fence, fenceOn: S.registry});
		const sendCall = (cmd: CallCmd) =>
			Effect.gen(function* () {
				const q = questionOf(cmd.i, settings.real);
				const began = Date.now();
				const sent = yield* tell(target, "ask", {
					id: cmd.id,
					corr: cmd.corr,
					replyTo: S.inbox,
					text: q.text,
					fence,
				});
				const at = Date.now();
				yield* line({ev: "send", i: cmd.i, tries: cmd.tries, began, at, how: sent.how});
				return sent.how === "sent"
					? ({type: "sent", i: cmd.i, tries: cmd.tries, at} as const)
					: ({type: "send_failed", i: cmd.i, tries: cmd.tries, at} as const);
			});
		const store = ledgerStore(ledger, {
			schema: AskerState,
			stream: S.registry,
			fence,
			holder,
			note: (n, s) =>
				Effect.runSync(line({...n, answered: s.answered, pending: s.pending.length, next: s.next})),
		});
		const started = yield* start(askerProgram, {}, {}).pipe(
			Effect.provideService(Caller, {settings, store, onError: o.onError, send: sendCall, line}),
		);
		if (started.kind !== "running") return yield* Effect.die(`asker refused: ${started.why}`);
		yield* line({
			ev: "program",
			phase: "started",
			fence,
			answered: saved.answered,
			pending: saved.pending.length,
			next: saved.next,
			backlog: backlog.length,
			replayMs: Date.now() - t0,
		});
		yield* o.started;

		const feed = Effect.gen(function* () {
			for (const r of backlog) yield* offer(started.run, "reply", r);
			for (;;) {
				const rows = yield* ledger.read(pos, 1000).pipe(Effect.orElseSucceed(() => []));
				for (const r of rows) {
					if (r.stream !== S.inbox || r.rev <= lastRev) {
						pos = r.pos;
						continue;
					}
					const h = heard(r);
					if (h === null) continue;
					yield* line({ev: "heard", id: h.id, rev: h.rev, from: r.writer});
					yield* offer(started.run, "reply", h);
				}
				if (rows.length < 1000) yield* Effect.sleep(Duration.millis(5));
			}
		});
		yield* Effect.forkScoped(feed);
		return yield* started.run.ended;
	});
