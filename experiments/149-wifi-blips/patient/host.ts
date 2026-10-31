// Experiment 149's copy of `serve` from packages/fabrika/src/host/host.ts, with the changed host
// machine (./host-machine.ts) and journal (./journal.ts). `Self`, the envelope and the event types
// are the package's own, so one program runs under either `serve`. What changed here, marked "149":
// the two new settings, `graceMs` and `retryRenewMs`, passed to the machine. Everything else is
// the original's code, cut to `serve` and the two helpers it uses.
import {run} from "@demlik/tea/effect";
import {
	type Cost,
	type Delivered,
	type ExitReason,
	type HostEvent,
	type Inbox,
	type Input,
	type Inputs,
	Ledger,
	type LedgerUnreachable,
	type Limits,
	type Meter,
	meter,
	type NewEvent,
	type Program,
	type Row,
	type RunUnder,
	Self,
	type Signal,
	start,
	streams,
	tail,
} from "@kampus/fabrika";
import {
	type Cause,
	Deferred,
	Duration,
	Effect,
	Exit,
	Queue,
	Ref,
	Schedule,
	Schema,
	Stream,
} from "effect";
import {
	createHost,
	type ExitWord,
	type Host,
	type HostMsg,
	type HostSettings,
	type ProgramEnd,
} from "./host-machine.ts";
import {journalStore, lastStateOf} from "./journal.ts";

type Monitoring = Effect.Success<ReturnType<Self["Service"]["monitor"]>>;
type Starting = Effect.Success<ReturnType<Self["Service"]["startChild"]>>;
type Holding = Effect.Success<ReturnType<Self["Service"]["hold"]>>;
type Charging = Effect.Success<ReturnType<Self["Service"]["charge"]>>;

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

/**
 * One ledger call, sent again while the ledger does not answer (each call is idempotent), its
 * refusals turned into words. Never fails: `unreachable` after `tries`.
 */
const answered = <A, E, W>(
	call: Effect.Effect<A, E | LedgerUnreachable>,
	ok: (a: A) => W,
	refused: (e: E) => W,
	unreachable: W,
): Effect.Effect<W> =>
	call.pipe(
		Effect.map(ok),
		Effect.retry({
			times: 19,
			schedule: Schedule.spaced(Duration.millis(50)),
			while: (e) => isUnreachable(e),
		}),
		Effect.catchTag("LedgerUnreachable", () => Effect.succeed(unreachable)),
		Effect.catch((e) => Effect.succeed(refused(e))),
	);
const isUnreachable = (e: unknown): boolean =>
	typeof e === "object" && e !== null && "_tag" in e && e._tag === "LedgerUnreachable";

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
	/** The registered name. Someone registers it first: `Ledger.register`, or its parent's `startChild`. */
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
	/** 149: how long past the lease's end an owner that heard nothing keeps its program. Default 10 min. */
	readonly graceMs?: number;
	/** 149: the next renew after one with no answer. Default 1000 ms. */
	readonly retryRenewMs?: number;
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
const DeadRev = Schema.fromJsonString(Schema.Struct({rev: Schema.Number}));
const deadRevOf = (r: Row): number | null => {
	const exit = Schema.decodeUnknownExit(DeadRev)(r.data);
	return Exit.isSuccess(exit) ? exit.value.rev : null;
};

/** The ledger's refusals, and tea's refused save: a program that met one lost its lease. */
const LEASE_WORDS = new Set([
	"store_conflict",
	"Fenced",
	"LeaseLost",
	"LedgerUnreachable",
	"Denied",
	"Stale",
	"UnknownName",
]);
/** Does this failure come from the lease (a refused save or write), not from the program? */
const isLeaseLoss = (cause: Cause.Cause<unknown>): boolean => {
	const tagged = (x: unknown, depth: number): boolean => {
		if (depth > 6 || typeof x !== "object" || x === null) return false;
		const tag = "_tag" in x ? x._tag : undefined;
		const name = "name" in x ? x.name : undefined;
		if ((typeof tag === "string" && LEASE_WORDS.has(tag)) || name === "StoreConflictError")
			return true;
		return "cause" in x && tagged(x.cause, depth + 1);
	};
	return cause.reasons.some((r) =>
		r._tag === "Fail" ? tagged(r.error, 0) : r._tag === "Die" ? tagged(r.defect, 0) : false,
	);
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

		// ------------------------------------------------------------ claim, renew and exit

		/** The registry stream's rev as last seen: a claim names it, and `Stale` gives the new one. */
		let rev = 0;
		const claim = Effect.gen(function* () {
			for (let tries = 0; tries < 10; tries++) {
				const sentAt = Date.now();
				const r = yield* ledger.claim(name, holder, rev, ttlMs).pipe(Effect.result);
				if (r._tag === "Success") {
					const {fence, incarnation} = r.success;
					rev = r.success.rev;
					say({ev: "claim", answer: "claimed", fence, incarnation});
					const won: HostMsg = {type: "claimed", fence, until: sentAt + ttlMs, incarnation};
					return won;
				}
				const e = r.failure;
				if (e._tag === "Held") {
					const held: HostMsg = {type: "held", waitMs: Math.max(0, e.expiresAt - Date.now()) + 1};
					return held;
				}
				if (e._tag === "Down") {
					say({ev: "claim", answer: "down", fence: null, incarnation: null});
					const down: HostMsg = {type: "is_down", pos: e.pos};
					return down;
				}
				if (e._tag !== "Stale") {
					const answer =
						e._tag === "UnknownName" ? "unknown" : e._tag === "Denied" ? "denied" : "unreachable";
					say({ev: "claim", answer, fence: null, incarnation: null});
					// A name nobody registered (yet): wait a lease's length, not `retryMs`.
					const failed: HostMsg =
						answer === "unknown" ? {type: "held", waitMs: ttlMs} : {type: "claim_failed"};
					return failed;
				}
				rev = e.rev;
			}
			say({ev: "claim", answer: "stale", fence: null, incarnation: null});
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

		const exit = (fence: number, w: ExitWord) =>
			answered(
				ledger.exit(name, fence, w.reason, w.why, w.suspect, holder),
				(x): HostMsg => {
					say({ev: "exit", fence, ...w, answer: x.dup ? "dup" : "exited", pos: x.pos});
					return {type: "exited", fence, pos: x.pos};
				},
				(): HostMsg => {
					say({ev: "exit", fence, ...w, answer: "refused", pos: null});
					return {type: "exit_refused", fence};
				},
				{type: "exit_refused", fence} satisfies HostMsg,
			);

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
				if (r.kind === "exited") return Stream.make({type: "seen_exit", pos: r.pos});
				if (r.kind === "restarted") return Stream.make({type: "seen_restart", pos: r.pos});
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

		/** The calls a program makes on itself and other names, fenced on its lease. */
		const calls = (fence: number) => ({
			monitor: (ref: string, target: string) =>
				answered(
					ledger.monitor(fence, ref, target),
					(m): Monitoring =>
						m.incarnation === null ? {how: "noproc"} : {how: "on", incarnation: m.incarnation},
					(): Monitoring => ({how: "fenced"}),
					{how: "unreachable"} satisfies Monitoring,
				),
			demonitor: (ref: string) =>
				answered(
					ledger.demonitor(fence, ref),
					() => "ok" as const,
					() => "fenced" as const,
					"unreachable" as const,
				),
			link: (other: string) =>
				answered(
					ledger.link(fence, other),
					() => "ok" as const,
					(e) => (e._tag === "NoProc" ? ("noproc" as const) : ("fenced" as const)),
					"unreachable" as const,
				),
			unlink: (other: string) =>
				answered(
					ledger.unlink(fence, other),
					() => "ok" as const,
					() => "fenced" as const,
					"unreachable" as const,
				),
			trapExit: (on: boolean) =>
				answered(
					ledger.trapExit(fence, on),
					() => "ok" as const,
					() => "fenced" as const,
					"unreachable" as const,
				),
			exit: (reason: ExitReason, why: string) =>
				answered(
					ledger.exit(name, fence, reason, why, null, holder),
					() => "exited" as const,
					() => "fenced" as const,
					"unreachable" as const,
				),
			startChild: (child: string, after: number | null, limits?: Limits) =>
				answered(
					ledger.startChild(fence, child, after, limits),
					(x): Starting => ({how: "ok", incarnation: x.incarnation, started: x.started}),
					(e): Starting =>
						e._tag === "OverLimit"
							? {how: "limit", over: e.over}
							: e._tag === "Denied"
								? {how: "denied"}
								: {how: "fenced"},
					{how: "unreachable"} satisfies Starting,
				),
			hold: (turn: string, cost: Cost) =>
				answered(
					ledger.hold(fence, turn, cost),
					(x): Holding => ({how: "ok", dup: x.dup}),
					(e): Holding =>
						e._tag === "OverLimit"
							? {how: "limit", over: e.over}
							: e._tag === "Denied"
								? {how: "denied"}
								: {how: "fenced"},
					{how: "unreachable"} satisfies Holding,
				),
			// Spent money is never dropped: sent again until the ledger answers (each send is one charge),
			// and not cut by a stop either: in experiment 102 a host woke from a freeze, its lease gone,
			// and stopped its program while the charge for the turn the freeze cut was still being sent.
			charge: (turn: string, cost: Cost) =>
				ledger.charge(fence, turn, cost).pipe(
					Effect.map((x): Charging => ({how: "ok", dup: x.dup, over: x.over})),
					Effect.retry({schedule: Schedule.spaced(Duration.millis(100)), while: isUnreachable}),
					Effect.catchTag("LedgerUnreachable", () => Effect.die("charge: retry ended")),
					Effect.catch((e): Effect.Effect<Charging> =>
						Effect.succeed(e._tag === "Denied" ? {how: "denied"} : {how: "fenced"}),
					),
					Effect.uninterruptible,
				),
			exitChild: (child: string, incarnation: number, signal: Signal, why: string) =>
				answered(
					ledger.exitChild(fence, child, incarnation, signal, why),
					(how) => how,
					(e) => (e._tag === "Denied" ? ("denied" as const) : ("fenced" as const)),
					"unreachable" as const,
				),
		});

		const program = (fence: number, incarnation: number) =>
			Stream.callback<HostMsg, never, Exclude<R, Self>>((out) =>
				Effect.gen(function* () {
					const t0 = Date.now();
					const ready = yield* Deferred.make<number>();
					const used = yield* Ref.make(false);
					/** The cursor of the last saved state, read again when the program crashes. */
					const cursorNow = yield* Ref.make<Effect.Effect<number | null> | null>(null);
					/** A save under this fence was refused: the lease is gone, whatever the cause says. */
					let refused = false;
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
								note: (n) => {
									if (!n.ok) refused = true;
									say(n);
								},
							});
							const last = lastStateOf(journal.schema);
							yield* Ref.set(
								cursorNow,
								ledger.readLast(S.state, 1).pipe(
									Effect.map((rows) => {
										const s = last(rows).state;
										return s === null ? 0 : journal.cursor(s);
									}),
									Effect.orElseSucceed(() => null),
								),
							);
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
						incarnation,
						holder,
						inbox: S.inbox,
						reads: {
							read: ledger.read,
							readStream: ledger.readStream,
							readLast: ledger.readLast,
							lease: ledger.lease,
							processInfo: ledger.processInfo,
						},
						send: (to, id, body) =>
							deliver(ledger, to, id, {kind: "message", writer: holder, data: body}, fence),
						run: runUnder,
						...calls(fence),
					});
					const started = yield* start(o.program, {}).pipe(Effect.provideService(Self, self));
					if (started.kind !== "running")
						return yield* Effect.die(`${name} refused its flags: ${started.why}`);
					const r = started.run;

					// The messages set aside: read once, at the start. A message is set aside only at an
					// exit, and an exit ends this run, so the set cannot grow while it runs.
					const dead = new Set<number>();
					// The program is running once its journal is loaded: then the inbox, from its cursor.
					const first = yield* Effect.raceFirst(
						Effect.map(Deferred.await(ready), (cursor) => ({kind: "ready" as const, cursor})),
						Effect.map(r.ended, (how) => ({kind: "ended" as const, how})),
					);
					if (first.kind === "ready") {
						for (const row of yield* again(ledger.readStream(S.dead))) {
							const d = deadRevOf(row);
							if (d !== null) dead.add(d);
						}
						const inboxEnd = yield* again(ledger.readLast(S.inbox, 1));
						say({
							ev: "program",
							phase: "started",
							fence,
							incarnation,
							cursor: first.cursor,
							backlog: Math.max(0, (inboxEnd.at(-1)?.rev ?? 0) - first.cursor),
							replayMs: Date.now() - t0,
							dead: dead.size,
						});
						yield* Queue.offer(out, {type: "program_started", fence});
						const hand = (row: Row) =>
							dead.has(row.rev)
								? Effect.void
								: r
										.offer("inbox", {
											id: row.id ?? `@${row.rev}`,
											rev: row.rev,
											from: row.writer,
											kind: row.kind,
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

					/** The first inbox message past the last saved state, not set aside: what it was on. */
					const suspect = Effect.gen(function* () {
						const read = yield* Ref.get(cursorNow);
						if (first.kind !== "ready" || read === null) return null;
						const cursor = yield* read;
						if (cursor === null) return null;
						const next = yield* ledger
							.readStream(S.inbox, cursor, dead.size + 1)
							.pipe(Effect.orElseSucceed(() => []));
						return next.find((row) => !dead.has(row.rev))?.rev ?? null;
					});
					const end: ProgramEnd =
						how.kind === "ended"
							? {how: "ended"}
							: how.kind === "stopped"
								? {how: "stopped"}
								: refused || isLeaseLoss(how.cause)
									? {how: "lost"}
									: {how: "crashed", why: String(how.cause).slice(0, 300), suspect: yield* suspect};
					say({ev: "program", phase: "ended", fence, ...end});
					yield* Queue.offer(out, {type: "program_ended", fence, ...end});
					return yield* Effect.never;
				}).pipe(
					Effect.onInterrupt(() =>
						Effect.sync(() => say({ev: "program", phase: "stopped", fence})),
					),
				),
			);

		// ------------------------------------------------------------ the machine

		const settings: HostSettings = {
			renewEveryMs,
			retryMs,
			graceMs: o.graceMs ?? 600_000,
			retryRenewMs: o.retryRenewMs ?? 1000,
		};
		const handle = yield* run(createHost(settings), {
			ctx: undefined,
			interpret: {
				claim: () => claim,
				renew: (cmd) => renew(cmd.fence),
				exit: (cmd) => exit(cmd.fence, cmd),
			},
			subscribe: {
				registry_tail: () => registryTail,
				program: (sub) => program(sub.deps.fence, sub.deps.incarnation),
				lease_clock: (sub) => leaseClock(sub.deps.fence, sub.deps.until),
			},
		});
		const host = yield* handle.ready;
		let was: Host = host.getState();
		const fenceOf = (s: Host) => (s.phase === "owning" || s.phase === "exiting" ? s.fence : null);
		const said = new Set<Host["phase"]>(["owning", "exiting", "down"]);
		host.observe((msg, now) => {
			if (now.phase !== was.phase && (said.has(now.phase) || said.has(was.phase)))
				say({
					ev: "phase",
					from: was.phase,
					to: now.phase,
					fence: fenceOf(now) ?? fenceOf(was),
					by: msg.type,
				});
			was = now;
		});
		say({ev: "up", ttlMs, renewEveryMs});
		const serving: Serving = {state: () => host.getState()};
		return serving;
	});
