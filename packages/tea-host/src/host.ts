// The host: serve a tea program under a registered name, on the ledger. OTP's node, with Erlang's
// registered names held by leases instead of by a cluster. Lifted from experiments 94 (the host
// machine, the counter host), 95 (`Serving`, the reply-to) and 97 (one ledger, `deliver`, the
// shared claim and renew Cmds), into one function:
//
//   yield* serve({name: "counter:1", holder: "host-a", program: counterProgram})
//
// Every host that serves a name runs the same machine (./host-machine.ts). Whoever holds the lease
// runs the program; any host takes over a name whose lease ended, so there is no supervisor host.
// On takeover the program replays: its journal is loaded from `<name>/state`, then its inbox is
// fed from the journal's cursor.
//
// What the program gets is `Self` (Erlang's `self()`): its name, its fence, its inbox, reads, a
// fenced `send`, and `run`, tea's own `run` with the two things a fenced run must have filled in by
// the host: the journal on `<name>/state` and the error sink. A program cannot get the journal
// without the sink, and cannot pass either (`store?: never`, `onError?: never`): tea's default sink
// rethrows a refused stop-save on a timer and kills the whole host process (demlik issue 728).
import type {Cmd, Machine, Sub} from "@demlik/tea";
import {
	type CellErrors,
	type EffectBootingRuntime,
	type EffectInterpret,
	type EffectRunOptions,
	type EffectSubscribe,
	type InterpretServices,
	run,
	type SubscribeServices,
} from "@demlik/tea/effect";
import {type Inputs, type Program, start} from "@tea-fabrika/tea-program";
import type {Input} from "@tea-fabrika/tea-program/shape";
import {
	Context,
	Deferred,
	Duration,
	Effect,
	Exit,
	Queue,
	Ref,
	Schedule,
	Schema,
	type Scope,
	Stream,
} from "effect";
import {createHost, type Host, type HostMsg, type HostSettings} from "./host-machine.ts";
import {journalStore, lastStateOf, type WriteNote} from "./journal.ts";
import {type Inbox, Ledger, type NewEvent, type Row, streams} from "./ledger.ts";
import {type Meter, meter, tail} from "./tail.ts";

export * from "./host-machine.ts";

// ---------------------------------------------------------------- the inbox

/** One message in a program's inbox, as the program reads it. */
export const envelope = <A>(body: Schema.Codec<A, A>) =>
	Schema.Struct({
		/** The message id the sender gave: the same on every retry of one send. */
		id: Schema.String,
		/** Its rev in the inbox: a program keeps the last one it handled as its cursor. */
		rev: Schema.Number,
		/** Who sent it: the writer the ledger recorded. */
		from: Schema.String,
		body,
	});
export type Envelope<A> = {
	readonly id: string;
	readonly rev: number;
	readonly from: string;
	readonly body: A;
};

/** How one send ended. `fenced`: this program's lease is gone, so it may not speak. */
export type Delivered =
	| {readonly how: "sent"; readonly rev: number; readonly dup: boolean}
	| {readonly how: "fenced"}
	| {readonly how: "denied"}
	| {readonly how: "unknown"}
	| {readonly how: "unreachable"};

const deliver = (
	ledger: Ledger["Service"],
	inbox: Inbox,
	id: string,
	event: Omit<NewEvent, "id">,
	fence: number | undefined,
	tries = 20,
): Effect.Effect<Delivered> =>
	Effect.gen(function* () {
		for (let lost = 0; lost < tries; lost++) {
			const r = yield* ledger.send(inbox, id, event, fence).pipe(Effect.result);
			if (r._tag === "Success") return {how: "sent", rev: r.success.rev, dup: r.success.dup};
			const e = r.failure;
			if (e._tag === "Fenced") return {how: "fenced"};
			if (e._tag === "Denied") return {how: "denied"};
			if (e._tag === "UnknownName") return {how: "unknown"};
			yield* Effect.sleep(Duration.millis(50));
		}
		return {how: "unreachable"};
	});

/**
 * gen_server:cast from outside any program: one message into `name`'s inbox, no lease needed,
 * sent again under the same id while the ledger does not answer. `unknown`: nobody registered it.
 */
export const cast = (name: string, id: string, body: unknown, writer: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		return yield* deliver(
			ledger,
			streams(name).inbox,
			id,
			{kind: "cast", writer, data: body},
			undefined,
		);
	});

// ---------------------------------------------------------------- what the program gets

/** The program's journal: its state's Schema, and where in its inbox that state has read to. */
export interface Journal<S> {
	readonly schema: Schema.Codec<S, unknown>;
	/** The rev of the last inbox message the state has taken in. The inbox is fed after it. */
	readonly cursor: (state: S) => number;
}

/** tea's `run`, with the journal and the error sink the host's. Once per serving. */
export type RunUnder = <
	S,
	M extends {type: string},
	C extends Cmd,
	U extends Sub,
	Ctx,
	I extends EffectInterpret<M, C> = EffectInterpret<M, C, never>,
	B extends EffectSubscribe<M, U> = EffectSubscribe<M, U, never>,
	E extends {type: string} = never,
>(
	machine: Machine<S, M, C, U, Ctx>,
	journal: Journal<S>,
	opts: EffectRunOptions<S, M, C, U, Ctx, E, I, B> & {
		readonly store?: never;
		readonly onError?: never;
	},
) => Effect.Effect<
	EffectBootingRuntime<S, M, E, CellErrors<C, I>>,
	never,
	Scope.Scope | InterpretServices<I> | SubscribeServices<B>
>;

export class Self extends Context.Service<
	Self,
	{
		/** The registered name this program runs under. */
		readonly name: string;
		/** The fence of the claim this host won: every write the program makes carries it. */
		readonly fence: number;
		/** This host's name in the ledger. */
		readonly holder: string;
		/** Its own inbox: the reply-to it hands out. */
		readonly inbox: Inbox;
		/** Reads, open to all. The program writes only through `run` and `send`. */
		readonly reads: Pick<Ledger["Service"], "read" | "readStream" | "readLast" | "lease">;
		/**
		 * One message into `to`, fenced on this program's own lease, under the message id `id`. With
		 * no answer it is sent again under the same id; the ledger answers a landed one `dup`.
		 */
		readonly send: (to: Inbox, id: string, body: unknown) => Effect.Effect<Delivered>;
		readonly run: RunUnder;
	}
>()("@tea-fabrika/tea-host/Self") {}

// ---------------------------------------------------------------- what the host says

export type HostEvent =
	| {readonly ev: "up"; readonly ttlMs: number; readonly renewEveryMs: number}
	| {
			readonly ev: "phase";
			readonly from: Host["phase"];
			readonly to: Host["phase"];
			readonly fence: number | null;
			readonly by: HostMsg["type"];
	  }
	| {
			readonly ev: "claim";
			readonly answer: "claimed" | "unknown" | "denied" | "unreachable" | "stale";
			readonly fence: number | null;
	  }
	| {readonly ev: "renew"; readonly fence: number; readonly answer: "lost" | "stop" | "unknown"}
	| {
			readonly ev: "program";
			readonly phase: "started";
			readonly fence: number;
			readonly cursor: number;
			readonly backlog: number;
			readonly replayMs: number;
	  }
	| {
			readonly ev: "program";
			readonly phase: "ended";
			readonly fence: number;
			readonly how: "ended" | "stopped" | "failed";
			readonly why: string | null;
	  }
	| {readonly ev: "program"; readonly phase: "stopped"; readonly fence: number}
	| {readonly ev: "lease_end"; readonly fence: number; readonly until: number}
	| WriteNote
	| {readonly ev: "bad_shape"; readonly fence: number; readonly rev: number}
	| {
			readonly ev: "tea_error";
			readonly fence: number;
			readonly phase: string;
			readonly error: string;
	  };

// ---------------------------------------------------------------- serve

/** A program a host can serve: no machines of its own to keep, and an `inbox` input of envelopes. */
type Servable<I extends Inputs, E, R> = Program<
	Record<never, never>,
	I,
	any,
	Record<never, never>,
	E,
	R
>;

export interface ServeOptions<P> {
	/** The registered name. Someone registers it first: `Ledger.register`. */
	readonly name: string;
	/** This host's name in the ledger: unique per process start. */
	readonly holder: string;
	readonly program: P;
	/** The lease's length. Default 1000 ms. */
	readonly ttlMs?: number;
	/** Default 250 ms. */
	readonly renewEveryMs?: number;
	/** Default 50 ms. */
	readonly retryMs?: number;
	/** Hears every event. Default: nobody. */
	readonly listen?: (e: HostEvent) => void;
	/** What the tails read, for a caller that measures it. */
	readonly meters?: {readonly registry: Meter; readonly inbox: Meter};
}

/** What `serve` answers: the host machine's state, read when asked. */
export interface Serving {
	readonly state: () => Host;
}

const Expired = Schema.fromJsonString(Schema.Struct({fence: Schema.Number}));
const expiredFence = (r: Row): number | null => {
	const exit = Schema.decodeUnknownExit(Expired)(r.data);
	return Exit.isSuccess(exit) ? exit.value.fence : null;
};
const bodyOf = (r: Row): unknown => {
	const exit = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown))(r.data);
	return Exit.isSuccess(exit) ? exit.value : null;
};

/**
 * Serve `program` under `name` until the scope closes. Returns once the host machine is up; the
 * program runs whenever this host holds the name's lease.
 */
export const serve = <I extends Inputs & {readonly inbox: Input<any>}, E, R>(
	o: ServeOptions<Servable<I, E, R>>,
) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const {name, holder} = o;
		const ttlMs = o.ttlMs ?? 1000;
		const renewEveryMs = o.renewEveryMs ?? 250;
		const retryMs = o.retryMs ?? 50;
		const say = o.listen ?? (() => {});
		const meters = o.meters ?? {registry: meter(), inbox: meter()};
		const S = streams(name);

		// ------------------------------------------------------------ claim and renew

		/** The registry stream's rev as last seen: a claim names it, and `Stale` gives the new one. */
		let rev = 0;
		const claim = Effect.gen(function* () {
			for (let tries = 0; tries < 10; tries++) {
				const sentAt = Date.now();
				const r = yield* ledger.claim(name, holder, rev, ttlMs).pipe(Effect.result);
				if (r._tag === "Success") {
					rev = r.success.rev;
					say({ev: "claim", answer: "claimed", fence: r.success.fence});
					const won: HostMsg = {type: "claimed", fence: r.success.fence, until: sentAt + ttlMs};
					return won;
				}
				const e = r.failure;
				if (e._tag === "Held") {
					const held: HostMsg = {type: "held", waitMs: Math.max(0, e.expiresAt - Date.now()) + 1};
					return held;
				}
				if (e._tag !== "Stale") {
					const answer =
						e._tag === "UnknownName" ? "unknown" : e._tag === "Denied" ? "denied" : "unreachable";
					say({ev: "claim", answer, fence: null});
					// A name nobody registered (yet): wait a lease's length, not `retryMs`.
					const failed: HostMsg =
						answer === "unknown" ? {type: "held", waitMs: ttlMs} : {type: "claim_failed"};
					return failed;
				}
				rev = e.rev;
			}
			say({ev: "claim", answer: "stale", fence: null});
			const failed: HostMsg = {type: "claim_failed"};
			return failed;
		});

		const renew = (fence: number) =>
			Effect.gen(function* () {
				const sentAt = Date.now();
				const r = yield* ledger.renew(name, fence, ttlMs).pipe(Effect.result);
				if (r._tag === "Success") {
					const renewed: HostMsg = {type: "renewed", fence, until: sentAt + ttlMs};
					return renewed;
				}
				const tag = r.failure._tag;
				const answer = tag === "LeaseLost" ? "lost" : tag === "Cancelled" ? "stop" : "unknown";
				say({ev: "renew", fence, answer});
				const said: HostMsg =
					answer === "unknown" ? {type: "renew_unknown", fence} : {type: "renew_lost", fence};
				return said;
			});

		// From the current claim on (or from the stream's end when nobody holds it).
		const registryTail = Stream.unwrap(
			Effect.gen(function* () {
				const lease = yield* ledger.lease(name).pipe(Effect.orElseSucceed(() => null));
				const rows = yield* ledger.readStream(name).pipe(Effect.orElseSucceed(() => []));
				const claimRow = lease === null ? undefined : rows.find((r) => r.pos === lease.fence);
				const fromRev = claimRow === undefined ? (rows.at(-1)?.rev ?? 0) : claimRow.rev - 1;
				return tail(ledger, {stream: name, fromRev, meter: meters.registry});
			}),
		).pipe(
			Stream.flatMap((r): Stream.Stream<HostMsg> => {
				if (r.kind === "claimed") return Stream.make({type: "seen_claim", fence: r.pos});
				const fence = r.kind === "lease_expired" ? expiredFence(r) : null;
				return fence === null ? Stream.empty : Stream.make({type: "seen_expiry", fence});
			}),
		);

		const leaseClock = (fence: number, until: number): Stream.Stream<HostMsg> =>
			Stream.fromEffect(
				Effect.sleep(Duration.millis(Math.max(0, until - Date.now()))).pipe(
					Effect.andThen(Effect.sync(() => say({ev: "lease_end", fence, until}))),
					Effect.as<HostMsg>({type: "lease_due", fence, until}),
				),
			);

		// ------------------------------------------------------------ the program, while owning

		const again = <A, Er>(read: Effect.Effect<A, Er>) =>
			read.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);

		const program = (fence: number) =>
			Stream.callback<HostMsg, never, Exclude<R, Self>>((out) =>
				Effect.gen(function* () {
					const t0 = Date.now();
					const ready = yield* Deferred.make<number>();
					const used = yield* Ref.make(false);
					// Where the run's failures with no caller go: said, and the host goes on.
					const sink = (error: unknown, context: {readonly phase: string}) =>
						say({
							ev: "tea_error",
							fence,
							phase: context.phase,
							error: error instanceof Error ? error.message : String(error),
						});
					const runUnder: RunUnder = (machine, journal, opts) =>
						Effect.gen(function* () {
							if (yield* Ref.getAndSet(used, true))
								return yield* Effect.die(`${name}: Self.run is called once per serving`);
							const store = journalStore(ledger, {
								schema: journal.schema,
								stream: S.state,
								fence,
								holder,
								note: say,
							});
							const handle = yield* run(machine, {...opts, store, onError: sink});
							yield* handle.ready.pipe(
								Effect.flatMap((rt) => Deferred.succeed(ready, journal.cursor(rt.getState()))),
								Effect.ignore,
								Effect.forkScoped,
							);
							return handle;
						});
					const self = Self.of({
						name,
						fence,
						holder,
						inbox: S.inbox,
						reads: {
							read: ledger.read,
							readStream: ledger.readStream,
							readLast: ledger.readLast,
							lease: ledger.lease,
						},
						send: (to, id, body) =>
							deliver(ledger, to, id, {kind: "message", writer: holder, data: body}, fence),
						run: runUnder,
					});
					const started = yield* start(o.program, {}).pipe(Effect.provideService(Self, self));
					if (started.kind !== "running")
						return yield* Effect.die(`${name} refused its flags: ${started.why}`);
					const r = started.run;

					// The program is running once its journal is loaded: then the inbox, from its cursor.
					const first = yield* Effect.raceFirst(
						Effect.map(Deferred.await(ready), (cursor) => ({kind: "ready" as const, cursor})),
						Effect.map(r.ended, (how) => ({kind: "ended" as const, how})),
					);
					if (first.kind === "ready") {
						const inboxEnd = yield* again(ledger.readLast(S.inbox, 1));
						say({
							ev: "program",
							phase: "started",
							fence,
							cursor: first.cursor,
							backlog: Math.max(0, (inboxEnd.at(-1)?.rev ?? 0) - first.cursor),
							replayMs: Date.now() - t0,
						});
						yield* Queue.offer(out, {type: "program_started", fence});
						const hand = (row: Row) =>
							r
								.offer("inbox", {
									id: row.id ?? `@${row.rev}`,
									rev: row.rev,
									from: row.writer,
									body: bodyOf(row),
								})
								.pipe(
									Effect.flatMap((word) =>
										word === "bad_shape"
											? Effect.sync(() => say({ev: "bad_shape", fence, rev: row.rev}))
											: Effect.void,
									),
								);
						yield* tail(ledger, {stream: S.inbox, fromRev: first.cursor, meter: meters.inbox}).pipe(
							Stream.runForEach(hand),
							Effect.forkScoped,
						);
					}
					const how = first.kind === "ended" ? first.how : yield* r.ended;
					say({
						ev: "program",
						phase: "ended",
						fence,
						how: how.kind,
						why: how.kind === "failed" ? String(how.cause).slice(0, 300) : null,
					});
					yield* Queue.offer(out, {type: "program_ended", fence, how: how.kind});
					return yield* Effect.never;
				}).pipe(
					Effect.onInterrupt(() =>
						Effect.sync(() => say({ev: "program", phase: "stopped", fence})),
					),
				),
			);

		// ------------------------------------------------------------ the machine

		const settings: HostSettings = {renewEveryMs, retryMs};
		const handle = yield* run(createHost(settings), {
			ctx: undefined,
			interpret: {claim: () => claim, renew: (cmd) => renew(cmd.fence)},
			subscribe: {
				registry_tail: () => registryTail,
				program: (sub) => program(sub.deps.fence),
				lease_clock: (sub) => leaseClock(sub.deps.fence, sub.deps.until),
			},
		});
		const host = yield* handle.ready;
		let was: Host = host.getState();
		host.observe((msg, now) => {
			if (now.phase !== was.phase && (now.phase === "owning" || was.phase === "owning"))
				say({
					ev: "phase",
					from: was.phase,
					to: now.phase,
					fence: now.phase === "owning" ? now.fence : was.phase === "owning" ? was.fence : null,
					by: msg.type,
				});
			was = now;
		});
		say({ev: "up", ttlMs, renewEveryMs});
		const serving: Serving = {state: () => host.getState()};
		return serving;
	});

/** The last saved state of `name`, decoded: for a reader that is not the program. */
export const savedState = <S>(name: string, schema: Schema.Codec<S, unknown>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		return lastStateOf(schema)(yield* ledger.readLast(streams(name).state, 1));
	});
