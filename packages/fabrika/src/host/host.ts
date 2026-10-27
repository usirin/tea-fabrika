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
//
// New in 99: OTP's process calls on `Self` (`monitor`, `link`, `trapExit`, `exit`, `startChild`),
// each fenced on the program's own lease, and the program's end as an exit. A program whose `main`
// returns exits `normal`; one that crashes exits `crash`, naming the inbox message it was likely
// on (the first one past its last saved state). A program that lost its lease does not exit: the
// name lives on, and another host takes it over. The inbox feed skips `<name>/dead`, the messages
// the ledger set aside after crashing the program too many times in a row.
//
// New in 102: `hold` and `charge` on `Self`, a turn's spend before and after, and the child's
// `limits` on `startChild`. A run its limit ended is down like any exit: the host sees `exited`.
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
import {
	type Cause,
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
import {type Inputs, type Program, start} from "../program/program.ts";
import type {Input} from "../program/shape.ts";
import {
	createHost,
	type ExitWord,
	HOST_GRACE_MS,
	type Host,
	type HostMsg,
	type HostSettings,
	type ProgramEnd,
} from "./host-machine.ts";
import {backoff, journalStore, lastStateOf, type WriteNote} from "./journal.ts";
import {
	type Inbox,
	Ledger,
	type LedgerUnreachable,
	type NewEvent,
	type Over,
	type Row,
	streams,
} from "./ledger.ts";
import type {Cost, ExitReason, Limits, Signal} from "./rules.ts";
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
		/** Who sent it: the writer the ledger recorded (`ledger` for a DOWN or an EXIT). */
		from: Schema.String,
		/** The event's kind: `cast`, `message`, or (only from the ledger) `DOWN` and `EXIT`. */
		kind: Schema.String,
		body,
	});
export type Envelope<A> = {
	readonly id: string;
	readonly rev: number;
	readonly from: string;
	readonly kind: string;
	readonly body: A;
};

/** How one send ended. `fenced`: this program's lease is gone, so it may not speak. */
export type Delivered =
	| {readonly how: "sent"; readonly rev: number; readonly dup: boolean}
	| {readonly how: "fenced"}
	| {readonly how: "denied"}
	| {readonly how: "unknown"}
	| {readonly how: "unreachable"};

/**
 * One send, again under the same id while the ledger does not answer: 20 tries 50 ms apart, or,
 * `patient` (151: a program's own fenced send), with no limit, a second apart at most, until it
 * lands, is refused, or the program stops. The ledger fences only on a newer claim, so waiting
 * out a wifi drop costs nothing.
 */
const deliver = (
	ledger: Ledger["Service"],
	inbox: Inbox,
	id: string,
	event: Omit<NewEvent, "id">,
	fence: number | undefined,
	patient = false,
): Effect.Effect<Delivered> =>
	Effect.gen(function* () {
		for (let lost = 1; patient || lost <= 20; lost++) {
			const r = yield* ledger.send(inbox, id, event, fence).pipe(Effect.result);
			if (r._tag === "Success") return {how: "sent", rev: r.success.rev, dup: r.success.dup};
			const e = r.failure;
			if (e._tag === "Fenced") return {how: "fenced"};
			if (e._tag === "Denied") return {how: "denied"};
			if (e._tag === "UnknownName") return {how: "unknown"};
			yield* Effect.sleep(patient ? backoff(lost) : Duration.millis(50));
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

/** A fenced call's word: `fenced` means this program's lease is gone, so it may not act. */
export type Fenced = "fenced" | "unreachable";
export type Monitoring =
	/** The monitor is on, on this incarnation of the target. */
	| {readonly how: "on"; readonly incarnation: number}
	/** The target was not running: a DOWN `noproc` is in this program's inbox already. */
	| {readonly how: "noproc"}
	| {readonly how: Fenced};
export type Starting =
	/** `started: false`: it was up already. */
	| {readonly how: "ok"; readonly incarnation: number; readonly started: boolean}
	/** Another name is its parent, or it is no name a register may take, or bad limits. */
	| {readonly how: "denied"}
	/**
	 * 102: a limit says no. `children`: one more is too many, try later (OTP's `max_children`).
	 * Any other kind: this tree is spent, or the child's last run was ended by a limit.
	 */
	| {readonly how: "limit"; readonly over: Over}
	| {readonly how: Fenced};
/** 102: a hold before a turn. `limit`: it does not fit, and the run under `over.at` has ended. */
export type Holding =
	| {readonly how: "ok"; readonly dup: boolean}
	| {readonly how: "limit"; readonly over: Over}
	| {readonly how: "denied"}
	| {readonly how: Fenced};
/** 102: a charge after a turn. `over`: it crossed this limit, and that run has ended. */
export type Charging =
	| {readonly how: "ok"; readonly dup: boolean; readonly over: Over | null}
	| {readonly how: "denied"}
	| {readonly how: "fenced"};

export class Self extends Context.Service<
	Self,
	{
		/** The registered name this program runs under. */
		readonly name: string;
		/** The fence of the claim this host won: every write the program makes carries it. */
		readonly fence: number;
		/** The name's run number (OTP's pid): a restart starts a new one, a takeover keeps it. */
		readonly incarnation: number;
		/** This host's name in the ledger. */
		readonly holder: string;
		/** Its own inbox: the reply-to it hands out. */
		readonly inbox: Inbox;
		/** Reads, open to all. The program writes only through `run`, `send` and the calls below. */
		readonly reads: Pick<
			Ledger["Service"],
			"read" | "readStream" | "readLast" | "lease" | "processInfo"
		>;
		/**
		 * One message into `to`, fenced on this program's own lease, under the message id `id`. With
		 * no answer it is sent again under the same id, with no limit on tries (151), until the
		 * program stops; the ledger answers a landed one `dup`.
		 */
		readonly send: (to: Inbox, id: string, body: unknown) => Effect.Effect<Delivered>;
		readonly run: RunUnder;
		/** OTP's `erlang:monitor`, under this program's own `ref`: one DOWN comes to its inbox. */
		readonly monitor: (ref: string, target: string) => Effect.Effect<Monitoring>;
		readonly demonitor: (ref: string) => Effect.Effect<"ok" | Fenced>;
		/** OTP's `link/1`, both ways. */
		readonly link: (other: string) => Effect.Effect<"ok" | "noproc" | Fenced>;
		readonly unlink: (other: string) => Effect.Effect<"ok" | Fenced>;
		/** OTP's `process_flag(trap_exit, on)`: a linked name's exit comes as an EXIT message. */
		readonly trapExit: (on: boolean) => Effect.Effect<"ok" | Fenced>;
		/** OTP's `exit/1` of itself: this name is down from now on, and its program stops. */
		readonly exit: (reason: ExitReason, why: string) => Effect.Effect<"exited" | Fenced>;
		/**
		 * OTP's `supervisor:start_child`, and the restart of a child that is down at `after`. 102:
		 * `limits`, the child's own, kept from its first start (a pod spec's `resources.limits`).
		 */
		readonly startChild: (
			child: string,
			after: number | null,
			limits?: Limits,
		) => Effect.Effect<Starting>;
		/**
		 * 102: admission before a turn: hold `cost`, an upper bound on what turn `turn` may spend,
		 * against every limit up the tree. One hold per turn per lease: a resend is `dup`, and the
		 * same turn under a new lease (a takeover) is a new hold, as it is new spend.
		 */
		readonly hold: (turn: string, cost: Cost) => Effect.Effect<Holding>;
		/**
		 * 102: what turn `turn` spent. It replaces its hold. Sent until the ledger answers, even
		 * after the lease is lost: the money is spent either way.
		 */
		readonly charge: (turn: string, cost: Cost) => Effect.Effect<Charging>;
		/**
		 * 100: OTP's `exit(Child, shutdown | kill)` to its own child's run `incarnation`. `shutdown`
		 * to a child that traps exits is an EXIT in its inbox (`signalled`); otherwise, and always
		 * for `kill`, the child is down (`exited`). `noproc`: that run had ended already.
		 */
		readonly exitChild: (
			child: string,
			incarnation: number,
			signal: Signal,
			why: string,
		) => Effect.Effect<"signalled" | "exited" | "noproc" | "denied" | Fenced>;
	}
>()("@kampus/fabrika/Self") {}

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
			readonly answer: "claimed" | "unknown" | "denied" | "unreachable" | "stale" | "down";
			readonly fence: number | null;
			readonly incarnation: number | null;
	  }
	| {readonly ev: "renew"; readonly fence: number; readonly answer: "lost" | "stop" | "unknown"}
	| {
			readonly ev: "program";
			readonly phase: "started";
			readonly fence: number;
			readonly incarnation: number;
			readonly cursor: number;
			readonly backlog: number;
			readonly replayMs: number;
			/** The inbox revs set aside in `<name>/dead`, skipped. */
			readonly dead: number;
	  }
	| ({
			readonly ev: "program";
			readonly phase: "ended";
			readonly fence: number;
	  } & ProgramEnd)
	| {readonly ev: "program"; readonly phase: "stopped"; readonly fence: number}
	| ({
			readonly ev: "exit";
			readonly fence: number;
			readonly answer: "exited" | "dup" | "refused" | "unreachable";
			readonly pos: number | null;
	  } & ExitWord)
	/**
	 * The lease clock ran out: no renew came back for `graceMs` past the lease's end `until`, and
	 * the program stops. 151: a person should see this one; a short drop never comes this far.
	 */
	| {
			readonly ev: "lease_end";
			readonly fence: number;
			readonly until: number;
			readonly graceMs: number;
	  }
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
	/**
	 * 151: how long past its lease's end the program runs while no renew comes back. The ledger
	 * fences the program's writes once a newer claim takes the name, so a wifi drop is waited
	 * out, not treated as a lost lease. Default 10 minutes.
	 */
	readonly graceMs?: number;
	/** 151: how often a renew is sent once one had no answer. Default 1 s, or `renewEveryMs` if less. */
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
		const graceMs = o.graceMs ?? HOST_GRACE_MS;
		const retryRenewMs = o.retryRenewMs ?? Math.min(1000, renewEveryMs);
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

		/** `lease_due` at `at`: the lease's end plus the grace, as the machine's Sub asks. */
		const leaseClock = (fence: number, at: number): Stream.Stream<HostMsg> =>
			Stream.fromEffect(
				Effect.sleep(Duration.millis(Math.max(0, at - Date.now()))).pipe(
					Effect.andThen(
						Effect.sync(() => say({ev: "lease_end", fence, until: at - graceMs, graceMs})),
					),
					Effect.andThen(
						graceMs > 0
							? Effect.logWarning(
									`${name}: no word from the ledger for ${Math.round(graceMs / 1000)} s past the lease's end; the program stops`,
								)
							: Effect.void,
					),
					Effect.as<HostMsg>({type: "lease_due", fence, until: at}),
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
					Effect.catch(
						(e): Effect.Effect<Charging> =>
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
					// 151: a save or a send still waiting on the ledger stops with the program.
					const stop = new AbortController();
					yield* Effect.addFinalizer(() => Effect.sync(() => stop.abort()));
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
									// A save that waits on the ledger is not refused: it goes on.
									if (!n.ok && n.why !== "unreachable") refused = true;
									say(n);
								},
								signal: stop.signal,
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
							deliver(ledger, to, id, {kind: "message", writer: holder, data: body}, fence, true),
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

		const settings: HostSettings = {renewEveryMs, retryMs, graceMs, retryRenewMs};
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

/** The last saved state of `name`, decoded: for a reader that is not the program. */
export const savedState = <S>(name: string, schema: Schema.Codec<S, unknown>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		return lastStateOf(schema)(yield* ledger.readLast(streams(name).state, 1));
	});
