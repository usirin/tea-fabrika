// The `Ledger` service: the one ledger a tea-host stands on, as an Effect service (Context tag +
// interface). Three implementations give it: the Durable Object over HTTP (`./http`, `./local`),
// node:sqlite (`./sqlite`) and plain memory (`./memory`). One law suite (`./laws`) runs on all.
//
// Lifted from experiment 97's service (experiments/97-one-ledger/service.ts). What is new:
//
//   - `register`: a name is registered before anything is written under it (see `rules.ts`).
//   - `UnknownName`: the refusal of any write under a name nobody registered.
//   - `cancel`, and `watch`: the doorbell of one stream. 97's tail opened a WebSocket by hand, so
//     it worked only over HTTP; here each implementation rings its own way, and `tail` reads.
//
// Every refusal is a tagged error, and each call names exactly the refusals it can meet.
//
// New in 99: OTP's process calls, each fenced on the caller's own lease: `exit`, `monitor`,
// `demonitor`, `link`, `unlink`, `trapExit`, `startChild`, and `processInfo` to read one. A claim
// says the name's `incarnation` (its run number), and a name that is down refuses it: `Down`.
//
// New in 100: `exitChild`, a parent's `shutdown` or `kill` of its child (a supervisor's `shutdown`
// option), the `killed` reason, and `to` on every EXIT.
//
// New in 102: limits. `startChild` takes the child's `limits`; `hold` before a turn and `charge`
// after it count spend up the tree; `setLimits` is the desk's raise; `usage` reads where a name
// stands. A limit says no with `OverLimit`, and a run it ends exits `limit:usd`, `limit:tokens` or
// `limit:wall`, with one `limit` record in `<name>/dead`.
import {Context, Effect, Schema, type Stream} from "effect";
import type {
	AppendResult,
	CancelResult,
	ChargeResult,
	ClaimResult,
	Cost,
	Event,
	ExitChildResult,
	ExitReason,
	ExitResult,
	FlagResult,
	HoldResult,
	Limits,
	LinkResult,
	MonitorResult,
	ProcessInfo,
	RegisterResult,
	RenewResult,
	SetLimitsResult,
	Signal,
	StartResult,
	Usage,
} from "./rules.ts";

// ---------------------------------------------------------------- the errors

/** No answer, a 500 or a timeout. Whether a write landed is unknown: send it again with its id. */
export class LedgerUnreachable extends Schema.TaggedError<LedgerUnreachable>()(
	"LedgerUnreachable",
	{method: Schema.String, message: Schema.String},
) {}
/** EventStoreDB's WrongExpectedVersion: the stream ends at `rev`, not where the write said. */
export class Stale extends Schema.TaggedError<Stale>()("Stale", {
	stream: Schema.String,
	rev: Schema.Number,
}) {}
/**
 * Kafka's ProducerFenced: the fence is not the newest claim of a name that may write this stream
 * (a newer claim took it, or it exited). Stop writing. Time alone never fences (151).
 */
export class Fenced extends Schema.TaggedError<Fenced>()("Fenced", {stream: Schema.String}) {}
/** EventStoreDB's AccessDenied: a registered name's stream with no fence; a name inside another. */
export class Denied extends Schema.TaggedError<Denied>()("Denied", {stream: Schema.String}) {}
/** Kafka's UNKNOWN_TOPIC_OR_PARTITION, OTP's `noproc`: nobody registered this name. */
export class UnknownName extends Schema.TaggedError<UnknownName>()("UnknownName", {
	stream: Schema.String,
}) {}
/** etcd's lock is held: someone else has a live lease on the name until `expiresAt`. */
export class Held extends Schema.TaggedError<Held>()("Held", {
	name: Schema.String,
	holder: Schema.String,
	expiresAt: Schema.Number,
}) {}
/** etcd's lease not found: a newer claim took the name, or it exited. A lease past its end is not lost. */
export class LeaseLost extends Schema.TaggedError<LeaseLost>()("LeaseLost", {
	name: Schema.String,
}) {}
/** The lease is live, but someone cancelled the work: stop. */
export class Cancelled extends Schema.TaggedError<Cancelled>()("Cancelled", {
	name: Schema.String,
}) {}
/** The name's program exited (at `pos`) and waits for its parent to restart it: no claim lands. */
export class Down extends Schema.TaggedError<Down>()("Down", {
	name: Schema.String,
	pos: Schema.Number,
}) {}
/** OTP's `noproc` for a link: there is no running process under `name` to link to. */
export class NoProc extends Schema.TaggedError<NoProc>()("NoProc", {name: Schema.String}) {}

/** 102: a limit's kind. `children` refuses a start; the others end a run. */
export const LimitKind = Schema.Literals(["usd", "tokens", "wall", "children"]);
/** 102: a limit hit: its kind, whose limit (`at`), what was used (with what was asked) and its max. */
export const Over = Schema.Struct({
	kind: LimitKind,
	at: Schema.String,
	used: Schema.Number,
	max: Schema.Number,
});
export type Over = typeof Over.Type;
/**
 * 102: a limit says no (OTP's `{error, max_children}`, Kubernetes' `exceeded quota`). For
 * `children`, nothing ended. For any other kind the run under `over.at` has ended, `limit:<kind>`.
 */
export class OverLimit extends Schema.TaggedError<OverLimit>()("OverLimit", {
	name: Schema.String,
	over: Over,
}) {}

// ---------------------------------------------------------------- what comes back

/** Where a write landed. `dup`: this message id was there already, and nothing was written. */
export const Appended = Schema.Struct({
	pos: Schema.Number,
	rev: Schema.Number,
	dup: Schema.Boolean,
});
export type Appended = typeof Appended.Type;
/** A registration. `created: false`: it was registered already, and nothing was written. */
export const Registered = Schema.Struct({
	created: Schema.Boolean,
	pos: Schema.Number,
	rev: Schema.Number,
});
export type Registered = typeof Registered.Type;
/**
 * A won claim: the fence every write under the name must carry, the lease's end, and the name's
 * incarnation (its run number: a restart starts a new one, a takeover keeps it).
 */
export const Claimed = Schema.Struct({
	fence: Schema.Number,
	rev: Schema.Number,
	expiresAt: Schema.Number,
	incarnation: Schema.Number,
});
export type Claimed = typeof Claimed.Type;
/** An exit that landed: its `exited` event. `dup`: it had landed already under this fence. */
export const Exited = Schema.Struct({
	pos: Schema.Number,
	incarnation: Schema.Number,
	dup: Schema.Boolean,
});
export type Exited = typeof Exited.Type;
/** A monitor: the incarnation it watches, or null: the name was not running, and DOWN `noproc` is in the inbox. */
export const Monitored = Schema.Struct({incarnation: Schema.NullOr(Schema.Number)});
export type Monitored = typeof Monitored.Type;
/** A start: the child's incarnation now; `started: false`: it was up already. */
export const Started = Schema.Struct({incarnation: Schema.Number, started: Schema.Boolean});
export type Started = typeof Started.Type;
export const Process = Schema.Struct({
	name: Schema.String,
	parent: Schema.NullOr(Schema.String),
	incarnation: Schema.Number,
	down: Schema.Number,
	trapExit: Schema.Boolean,
});
/** 102: a name's limits, each left out for none: what a child spec carries. */
export const LimitsSchema = Schema.Struct({
	usd: Schema.optionalKey(Schema.Number),
	tokens: Schema.optionalKey(Schema.Number),
	wallMs: Schema.optionalKey(Schema.Number),
	children: Schema.optionalKey(Schema.Number),
});
/** 102: a charge that landed; `over`: the limit it crossed, whose run has ended now. */
export const Charged = Schema.Struct({dup: Schema.Boolean, over: Schema.NullOr(Over)});
export type Charged = typeof Charged.Type;
/** 102: where a name stands: its limits, its subtree's spend (holds in), the names under it. */
export const UsageSchema = Schema.Struct({
	name: Schema.String,
	limits: LimitsSchema,
	used: Schema.Struct({usd: Schema.Number, tokens: Schema.Number}),
	children: Schema.Number,
	since: Schema.Number,
	deadline: Schema.NullOr(Schema.Number),
});

/** One event, as the ledger keeps it. `data` is the event's JSON, as text. */
export const Row = Schema.Struct({
	pos: Schema.Number,
	stream: Schema.String,
	rev: Schema.Number,
	writer: Schema.String,
	kind: Schema.String,
	at: Schema.Number,
	data: Schema.String,
	id: Schema.NullOr(Schema.String),
});
export type Row = typeof Row.Type;
export const Rows = Schema.Array(Row);

export const Lease = Schema.Struct({
	stream: Schema.String,
	holder: Schema.String,
	expires_at: Schema.Number,
	fence: Schema.Number,
	stop: Schema.Number,
});
export type Lease = typeof Lease.Type;

export interface NewEvent {
	readonly kind: string;
	readonly writer: string;
	readonly data?: unknown;
	/** The message id: a second append of it to the same stream is answered, not written. */
	readonly id?: string;
}

/** A mailbox address: the one stream under a registered name anyone may append to. */
export type Inbox = string & {readonly kind: "inbox"};
/** An address read from a message (a reply-to) becomes an `Inbox` only if it is one. */
export const inboxOf = (stream: string): Inbox | null =>
	stream.endsWith("/inbox") && stream.length > "/inbox".length ? (stream as Inbox) : null;

/** The streams of a registered name: OTP's registered name, its saved state, its mailbox. */
export const streams = (name: string) => ({
	/** Registrations, claims, expiries and cancels: who runs `name`. No traffic per message. */
	registry: name,
	/** The program's saved states. Only the lease's fence writes here. */
	state: `${name}/state`,
	/** Every message to `name`, one event per message id. Open to anyone. */
	inbox: `${name}/inbox` as Inbox,
	/** The inbox messages that crashed the program too many times in a row: hosts feed past them. */
	dead: `${name}/dead`,
});

/** The data of the ledger's `DOWN` message (OTP's `{'DOWN', Ref, process, Name, Reason}`). */
export const DownMessage = Schema.Struct({
	ref: Schema.String,
	target: Schema.String,
	incarnation: Schema.Number,
	reason: Schema.Literals([
		"normal",
		"shutdown",
		"crash",
		"killed",
		"limit:usd",
		"limit:tokens",
		"limit:wall",
		"noproc",
	]),
	why: Schema.String,
	/** When the ledger wrote it, by the ledger's clock. */
	at: Schema.Number,
});
export type DownMessage = typeof DownMessage.Type;
/**
 * How a run ended, as a DOWN or an EXIT says it (100 adds `killed`: its parent killed it; 102 the
 * limits: its own limit ended it, as Kubernetes says `OOMKilled`). Only the ledger ends a run for a
 * limit; a program's own `exit` cannot say it.
 */
export const EndReason = Schema.Literals([
	"normal",
	"shutdown",
	"crash",
	"killed",
	"limit:usd",
	"limit:tokens",
	"limit:wall",
]);
/**
 * The data of the ledger's `EXIT` message to a name that traps exits (OTP's `{'EXIT', From,
 * Reason}`): a linked name's exit, or (100) its parent's `shutdown` signal. `to`: the incarnation
 * of the receiver it is for. A run that starts again ignores one meant for an earlier run.
 */
export const ExitMessage = Schema.Struct({
	from: Schema.String,
	incarnation: Schema.Number,
	reason: EndReason,
	why: Schema.String,
	at: Schema.Number,
	to: Schema.Number,
});
export type ExitMessage = typeof ExitMessage.Type;
/** The data of a `dead_letter` event: the inbox rev set aside. */
export const DeadLetter = Schema.Struct({
	rev: Schema.Number,
	strikes: Schema.Number,
	why: Schema.String,
	at: Schema.Number,
});
export type DeadLetter = typeof DeadLetter.Type;
/** 102: the data of a `limit` event in `<name>/dead`: the run a limit ended, and whose limit it was. */
export const LimitRecord = Schema.Struct({
	limit: LimitKind,
	of: Schema.String,
	used: Schema.Number,
	max: Schema.Number,
	why: Schema.String,
	incarnation: Schema.Number,
	at: Schema.Number,
});
export type LimitRecord = typeof LimitRecord.Type;

// ---------------------------------------------------------------- the service

type Call<A, E = never> = Effect.Effect<A, E | LedgerUnreachable>;

export class Ledger extends Context.Service<
	Ledger,
	{
		/** Register `name`: from now on writes under it are guarded, and its inbox is open. */
		readonly register: (name: string, writer: string) => Call<Registered, Denied>;
		/**
		 * One event: at `expected + 1`, or at the end with "any". With a fence, only while it is its
		 * name's newest claim, live or past its end (151), and may write here (its name's streams,
		 * and any inbox). With none, only an inbox.
		 */
		readonly append: (
			stream: string,
			expected: number | "any",
			event: NewEvent,
			fence?: number,
		) => Call<Appended, Stale | Fenced | Denied | UnknownName>;
		/** A message to a mailbox, at its end, deduped by `id`. Fenced on the sender's own lease if given. */
		readonly send: (
			inbox: Inbox,
			id: string,
			event: Omit<NewEvent, "id">,
			fence?: number,
		) => Call<Appended, Fenced | Denied | UnknownName>;
		/** Take the lease on a registered name for `ttlMs`; the claim is an event at `expectedRev + 1`. */
		readonly claim: (
			name: string,
			holder: string,
			expectedRev: number,
			ttlMs: number,
		) => Call<Claimed, Held | Stale | Denied | UnknownName | Down>;
		/**
		 * Move the lease's end on: while `fence` is the name's newest claim, past the lease's end too
		 * (151). After the lease's `lease_expired`, it writes `lease_resumed`.
		 */
		readonly renew: (
			name: string,
			fence: number,
			ttlMs: number,
		) => Call<{readonly expiresAt: number}, LeaseLost | Cancelled>;
		/** Tell the holder of `name` to stop: its next renew is `Cancelled`. */
		readonly cancel: (name: string, writer: string) => Call<Appended, UnknownName>;
		/**
		 * OTP's `exit`: the holder of `name`'s lease says its program ended. The name is down, its
		 * monitors get DOWN and its links EXIT (or exit too), in one transaction. `suspect`: the
		 * inbox rev a crash was likely on.
		 */
		readonly exit: (
			name: string,
			fence: number,
			reason: ExitReason,
			why: string,
			suspect: number | null,
			writer: string,
		) => Call<Exited, Fenced>;
		/** OTP's `erlang:monitor`, under the caller's own `ref`: one DOWN in its inbox when `target` exits. */
		readonly monitor: (fence: number, ref: string, target: string) => Call<Monitored, Fenced>;
		readonly demonitor: (fence: number, ref: string) => Call<void, Fenced>;
		/** OTP's `link/1`, both ways. */
		readonly link: (fence: number, other: string) => Call<void, Fenced | NoProc>;
		readonly unlink: (fence: number, other: string) => Call<void, Fenced>;
		/** OTP's `process_flag(trap_exit, on)`: a linked exit comes as an EXIT message. */
		readonly trapExit: (fence: number, on: boolean) => Call<void, Fenced>;
		/**
		 * OTP's `supervisor:start_child` and restart: register `child` under the caller as parent and
		 * link them, or start a down child again if it is down at `after` (or `after` is null).
		 */
		readonly startChild: (
			fence: number,
			child: string,
			after: number | null,
			/** 102: the child's limits, kept from its first start on (`setLimits` changes them). */
			limits?: Limits,
		) => Call<Started, Fenced | Denied | OverLimit>;
		/**
		 * 102: admission, before a turn: hold `cost`, an upper bound, against every limit up the
		 * tree. Under the live lease only; one hold per `(fence, id)`. `OverLimit`: it does not fit,
		 * nothing is held, and the run under that limit has ended.
		 */
		readonly hold: (
			fence: number,
			id: string,
			cost: Cost,
		) => Call<{readonly dup: boolean}, Fenced | Denied | OverLimit>;
		/**
		 * 102: what a turn spent. It replaces the hold of the same `(fence, id)`. Any fence the
		 * name ever had may charge (the money is spent even when the lease is lost); one charge per
		 * `(fence, id)`. Past a limit, that limit's run ends and `over` names it.
		 */
		readonly charge: (fence: number, id: string, cost: Cost) => Call<Charged, Fenced | Denied>;
		/** 102: the desk's call: set a name's limits. It clears a limit's end, so it may start again. */
		readonly setLimits: (
			name: string,
			limits: Limits,
			writer: string,
		) => Call<Appended, Denied | UnknownName>;
		/** 102: where a name stands, or null: nobody registered it. */
		readonly usage: (name: string) => Call<Usage | null>;
		/**
		 * 100: OTP's `exit(Child, shutdown | kill)`, from the child's parent, to its run
		 * `incarnation`: what a supervisor's `shutdown` option sends. `signalled`: it traps exits and
		 * has an EXIT in its inbox; `exited`: it is down; `noproc`: that run had ended already.
		 */
		readonly exitChild: (
			fence: number,
			child: string,
			incarnation: number,
			signal: Signal,
			why: string,
		) => Call<"signalled" | "exited" | "noproc", Fenced | Denied>;
		/** OTP's `process_info`: the process behind a name, or null: nobody registered it. */
		readonly processInfo: (name: string) => Call<ProcessInfo | null>;
		/** The log after `fromPos`, in order; with a prefix, only the streams under it. */
		readonly read: (fromPos: number, limit: number, prefix?: string) => Call<readonly Row[]>;
		/** One stream after `fromRev`, at most `limit` events (-1: all). */
		readonly readStream: (stream: string, fromRev?: number, limit?: number) => Call<readonly Row[]>;
		/** A stream's last `count` events, in order. */
		readonly readLast: (stream: string, count: number) => Call<readonly Row[]>;
		readonly lease: (name: string) => Call<Lease | null>;
		/**
		 * The doorbell of one stream: it rings at least once after each write to it, and may ring more
		 * (a reconnect, a poll). No event comes with it: `tail` reads from its own cursor.
		 */
		readonly watch: (stream: string) => Stream.Stream<void>;
	}
>()("@kampus/fabrika-old/Ledger") {}

// ---------------------------------------------------------------- one mapping for every driver

/**
 * What every implementation gives, in the rules' own words (`ok: false, why`). `fromRaw` turns it
 * into the service, so the words become tagged errors in one place for all three.
 */
export interface Raw {
	readonly register: (name: string, writer: string) => Call<RegisterResult>;
	readonly append: (
		stream: string,
		expected: number | "any",
		event: Event,
		fence: number | null,
	) => Call<AppendResult>;
	readonly claim: (
		name: string,
		holder: string,
		expectedRev: number,
		ttlMs: number,
	) => Call<ClaimResult>;
	readonly renew: (name: string, fence: number, ttlMs: number) => Call<RenewResult>;
	readonly cancel: (name: string, writer: string) => Call<CancelResult>;
	readonly exit: (
		name: string,
		fence: number,
		reason: ExitReason,
		why: string,
		suspect: number | null,
		writer: string,
	) => Call<ExitResult>;
	readonly monitor: (fence: number, ref: string, target: string) => Call<MonitorResult>;
	readonly demonitor: (fence: number, ref: string) => Call<FlagResult>;
	readonly link: (fence: number, other: string) => Call<LinkResult>;
	readonly unlink: (fence: number, other: string) => Call<FlagResult>;
	readonly trapExit: (fence: number, on: boolean) => Call<FlagResult>;
	readonly startChild: (
		fence: number,
		child: string,
		after: number | null,
		limits: Limits | null,
	) => Call<StartResult>;
	readonly exitChild: (
		fence: number,
		child: string,
		incarnation: number,
		signal: Signal,
		why: string,
	) => Call<ExitChildResult>;
	readonly processInfo: (name: string) => Call<ProcessInfo | null>;
	readonly hold: (fence: number, id: string, cost: Cost) => Call<HoldResult>;
	readonly charge: (fence: number, id: string, cost: Cost) => Call<ChargeResult>;
	readonly setLimits: (name: string, limits: Limits, writer: string) => Call<SetLimitsResult>;
	readonly usage: (name: string) => Call<Usage | null>;
	readonly read: (fromPos: number, limit: number, prefix: string | null) => Call<readonly Row[]>;
	readonly readStream: (stream: string, fromRev: number, limit: number) => Call<readonly Row[]>;
	readonly readLast: (stream: string, count: number) => Call<readonly Row[]>;
	readonly lease: (name: string) => Call<Lease | null>;
	readonly watch: (stream: string) => Stream.Stream<void>;
}

const claimed =
	(name: string) =>
	(r: ClaimResult): Effect.Effect<Claimed, Held | Stale | Denied | UnknownName | Down> => {
		if (r.ok)
			return Effect.succeed({
				fence: r.fence,
				rev: r.rev,
				expiresAt: r.expiresAt,
				incarnation: r.incarnation,
			});
		switch (r.why) {
			case "down":
				return Effect.fail(new Down({name, pos: r.pos}));
			case "held":
				return Effect.fail(new Held({name, holder: r.holder, expiresAt: r.expiresAt}));
			case "stale":
				return Effect.fail(new Stale({stream: name, rev: r.rev}));
			case "denied":
				return Effect.fail(new Denied({stream: name}));
			case "unknown":
				return Effect.fail(new UnknownName({stream: name}));
		}
	};

const renewed =
	(name: string) =>
	(r: RenewResult): Effect.Effect<{readonly expiresAt: number}, LeaseLost | Cancelled> =>
		r.ok
			? Effect.succeed({expiresAt: r.expiresAt})
			: r.why === "lost"
				? Effect.fail(new LeaseLost({name}))
				: Effect.fail(new Cancelled({name}));

const appendError = (stream: string, r: Exclude<AppendResult, {ok: true}>) =>
	r.why === "stale"
		? new Stale({stream, rev: r.rev})
		: r.why === "fenced"
			? new Fenced({stream})
			: r.why === "denied"
				? new Denied({stream})
				: new UnknownName({stream});

/** A fenced call's refusal: the fence is no name's newest claim. */
const flag =
	(what: string) =>
	(r: FlagResult): Effect.Effect<void, Fenced> =>
		r.ok ? Effect.void : Effect.fail(new Fenced({stream: what}));

export const fromRaw = (raw: Raw): Ledger["Service"] => {
	const append = (stream: string, expected: number | "any", event: NewEvent, fence?: number) =>
		raw
			.append(stream, expected, {...event, id: event.id ?? null}, fence ?? null)
			.pipe(
				Effect.flatMap((r) =>
					r.ok
						? Effect.succeed<Appended>({pos: r.pos, rev: r.rev, dup: r.dup})
						: Effect.fail(appendError(stream, r)),
				),
			);
	return {
		register: (name, writer) =>
			raw
				.register(name, writer)
				.pipe(
					Effect.flatMap((r) =>
						r.ok
							? Effect.succeed<Registered>({created: r.created, pos: r.pos, rev: r.rev})
							: Effect.fail(new Denied({stream: name})),
					),
				),
		append,
		send: (inbox, id, event, fence) =>
			append(inbox, "any", {...event, id}, fence).pipe(
				// An append at the end is never stale; if the ledger says so, it is broken.
				Effect.catchTag("Stale", (e) => Effect.die(`send to ${e.stream} answered stale`)),
			),
		claim: (name, holder, expectedRev, ttlMs) =>
			raw.claim(name, holder, expectedRev, ttlMs).pipe(Effect.flatMap(claimed(name))),
		renew: (name, fence, ttlMs) =>
			raw.renew(name, fence, ttlMs).pipe(Effect.flatMap(renewed(name))),
		cancel: (name, writer) =>
			raw
				.cancel(name, writer)
				.pipe(
					Effect.flatMap((r) =>
						r.ok
							? Effect.succeed<Appended>({pos: r.pos, rev: r.rev, dup: false})
							: Effect.fail(new UnknownName({stream: name})),
					),
				),
		exit: (name, fence, reason, why, suspect, writer) =>
			raw
				.exit(name, fence, reason, why, suspect, writer)
				.pipe(
					Effect.flatMap((r) =>
						r.ok
							? Effect.succeed<Exited>({pos: r.pos, incarnation: r.incarnation, dup: r.dup})
							: Effect.fail(new Fenced({stream: name})),
					),
				),
		monitor: (fence, ref, target) =>
			raw
				.monitor(fence, ref, target)
				.pipe(
					Effect.flatMap((r) =>
						r.ok
							? Effect.succeed<Monitored>({incarnation: r.incarnation})
							: Effect.fail(new Fenced({stream: target})),
					),
				),
		demonitor: (fence, ref) => raw.demonitor(fence, ref).pipe(Effect.flatMap(flag(ref))),
		link: (fence, other) =>
			raw
				.link(fence, other)
				.pipe(
					Effect.flatMap((r): Effect.Effect<void, Fenced | NoProc> =>
						r.ok
							? Effect.void
							: r.why === "noproc"
								? Effect.fail(new NoProc({name: other}))
								: Effect.fail(new Fenced({stream: other})),
					),
				),
		unlink: (fence, other) => raw.unlink(fence, other).pipe(Effect.flatMap(flag(other))),
		trapExit: (fence, on) => raw.trapExit(fence, on).pipe(Effect.flatMap(flag("trap_exit"))),
		startChild: (fence, child, after, limits) =>
			raw
				.startChild(fence, child, after, limits ?? null)
				.pipe(
					Effect.flatMap((r): Effect.Effect<Started, Fenced | Denied | OverLimit> =>
						r.ok
							? Effect.succeed({incarnation: r.incarnation, started: r.started})
							: r.why === "limit"
								? Effect.fail(new OverLimit({name: child, over: r.over}))
								: r.why === "denied"
									? Effect.fail(new Denied({stream: child}))
									: Effect.fail(new Fenced({stream: child})),
					),
				),
		hold: (fence, id, cost) =>
			raw
				.hold(fence, id, cost)
				.pipe(
					Effect.flatMap((r): Effect.Effect<{readonly dup: boolean}, Fenced | Denied | OverLimit> =>
						r.ok
							? Effect.succeed({dup: r.dup})
							: r.why === "limit"
								? Effect.fail(new OverLimit({name: r.over.at, over: r.over}))
								: r.why === "denied"
									? Effect.fail(new Denied({stream: id}))
									: Effect.fail(new Fenced({stream: id})),
					),
				),
		charge: (fence, id, cost) =>
			raw
				.charge(fence, id, cost)
				.pipe(
					Effect.flatMap((r): Effect.Effect<Charged, Fenced | Denied> =>
						r.ok
							? Effect.succeed({dup: r.dup, over: r.over})
							: r.why === "denied"
								? Effect.fail(new Denied({stream: id}))
								: Effect.fail(new Fenced({stream: id})),
					),
				),
		setLimits: (name, limits, writer) =>
			raw
				.setLimits(name, limits, writer)
				.pipe(
					Effect.flatMap((r): Effect.Effect<Appended, Denied | UnknownName> =>
						r.ok
							? Effect.succeed({pos: r.pos, rev: r.rev, dup: false})
							: r.why === "denied"
								? Effect.fail(new Denied({stream: name}))
								: Effect.fail(new UnknownName({stream: name})),
					),
				),
		usage: raw.usage,
		exitChild: (fence, child, incarnation, signal, why) =>
			raw
				.exitChild(fence, child, incarnation, signal, why)
				.pipe(
					Effect.flatMap((r): Effect.Effect<"signalled" | "exited" | "noproc", Fenced | Denied> =>
						r.ok
							? Effect.succeed(r.how)
							: r.why === "denied"
								? Effect.fail(new Denied({stream: child}))
								: Effect.fail(new Fenced({stream: child})),
					),
				),
		processInfo: raw.processInfo,
		read: (fromPos, limit, prefix) => raw.read(fromPos, limit, prefix ?? null),
		readStream: (stream, fromRev, limit) => raw.readStream(stream, fromRev ?? 0, limit ?? -1),
		readLast: raw.readLast,
		lease: raw.lease,
		watch: raw.watch,
	};
};

// ---------------------------------------------------------------- the wire

/** The rules' answers, as they cross a wire (HTTP, a worker thread): decoded, never cast. */
const Refused = <W extends string>(why: W) =>
	Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal(why)});
const Written = Schema.Array(
	Schema.Struct({stream: Schema.String, rev: Schema.Number, pos: Schema.Number}),
);
const Flag = Schema.Union([Schema.Struct({ok: Schema.Literal(true)}), Refused("fenced")]);
const OverWire = Schema.Struct({
	ok: Schema.Literal(false),
	why: Schema.Literal("limit"),
	over: Over,
	written: Written,
});
export const Wire = {
	register: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			created: Schema.Boolean,
			pos: Schema.Number,
			rev: Schema.Number,
		}),
		Refused("denied"),
	]),
	append: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			pos: Schema.Number,
			rev: Schema.Number,
			dup: Schema.Boolean,
		}),
		Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("stale"), rev: Schema.Number}),
		Refused("fenced"),
		Refused("denied"),
		Refused("unknown"),
	]),
	claim: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			fence: Schema.Number,
			rev: Schema.Number,
			expiresAt: Schema.Number,
			incarnation: Schema.Number,
		}),
		Schema.Struct({
			ok: Schema.Literal(false),
			why: Schema.Literal("held"),
			holder: Schema.String,
			expiresAt: Schema.Number,
		}),
		Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("stale"), rev: Schema.Number}),
		Refused("denied"),
		Refused("unknown"),
		Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("down"), pos: Schema.Number}),
	]),
	exit: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			pos: Schema.Number,
			incarnation: Schema.Number,
			dup: Schema.Boolean,
			written: Written,
		}),
		Refused("fenced"),
	]),
	monitor: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			incarnation: Schema.NullOr(Schema.Number),
			written: Written,
		}),
		Refused("fenced"),
	]),
	flag: Flag,
	link: Schema.Union([
		Schema.Struct({ok: Schema.Literal(true)}),
		Refused("fenced"),
		Refused("noproc"),
	]),
	exitChild: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			how: Schema.Literals(["signalled", "exited", "noproc"]),
			written: Written,
		}),
		Refused("fenced"),
		Refused("denied"),
	]),
	startChild: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			incarnation: Schema.Number,
			started: Schema.Boolean,
			written: Written,
		}),
		Refused("fenced"),
		Refused("denied"),
		OverWire,
	]),
	hold: Schema.Union([
		Schema.Struct({ok: Schema.Literal(true), dup: Schema.Boolean, written: Written}),
		Refused("fenced"),
		Refused("denied"),
		OverWire,
	]),
	charge: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			dup: Schema.Boolean,
			over: Schema.NullOr(Over),
			written: Written,
		}),
		Refused("fenced"),
		Refused("denied"),
	]),
	setLimits: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			pos: Schema.Number,
			rev: Schema.Number,
			written: Written,
		}),
		Refused("unknown"),
		Refused("denied"),
	]),
	usage: Schema.NullOr(UsageSchema),
	process: Schema.NullOr(Process),
	renew: Schema.Union([
		Schema.Struct({ok: Schema.Literal(true), expiresAt: Schema.Number, written: Written}),
		Refused("lost"),
		Refused("stop"),
	]),
	cancel: Schema.Union([
		Schema.Struct({ok: Schema.Literal(true), pos: Schema.Number, rev: Schema.Number}),
		Refused("unknown"),
	]),
	rows: Rows,
	lease: Schema.NullOr(Lease),
};

/** One call over a wire: the method's name and its arguments, the answer as JSON. */
export type WireCall = (
	method: string,
	args: readonly unknown[],
) => Effect.Effect<unknown, LedgerUnreachable>;

/** The `Raw` face of a ledger behind a wire: every answer decoded; one that does not decode is unreachable. */
export const rawOf = (call: WireCall, watch: Raw["watch"]): Raw => {
	const decoded =
		<A>(schema: Schema.ConstraintDecoder<A>) =>
		(method: string, args: readonly unknown[]): Call<A> =>
			call(method, args).pipe(
				Effect.flatMap((json) =>
					Schema.decodeUnknownEffect(schema)(json).pipe(
						Effect.mapError((e) => new LedgerUnreachable({method, message: e.message})),
					),
				),
			);
	return {
		register: (name, writer) => decoded(Wire.register)("register", [name, writer]),
		append: (stream, expected, event, fence) =>
			decoded(Wire.append)("append", [stream, expected, event, fence]),
		claim: (name, holder, expectedRev, ttlMs) =>
			decoded(Wire.claim)("claim", [name, holder, expectedRev, ttlMs]),
		renew: (name, fence, ttlMs) => decoded(Wire.renew)("renew", [name, fence, ttlMs]),
		cancel: (name, writer) => decoded(Wire.cancel)("cancel", [name, writer]),
		exit: (name, fence, reason, why, suspect, writer) =>
			decoded(Wire.exit)("exit", [name, fence, reason, why, suspect, writer]),
		monitor: (fence, ref, target) => decoded(Wire.monitor)("monitor", [fence, ref, target]),
		demonitor: (fence, ref) => decoded(Wire.flag)("demonitor", [fence, ref]),
		link: (fence, other) => decoded(Wire.link)("link", [fence, other]),
		unlink: (fence, other) => decoded(Wire.flag)("unlink", [fence, other]),
		trapExit: (fence, on) => decoded(Wire.flag)("trapExit", [fence, on]),
		startChild: (fence, child, after, limits) =>
			decoded(Wire.startChild)("startChild", [fence, child, after, limits]),
		exitChild: (fence, child, incarnation, signal, why) =>
			decoded(Wire.exitChild)("exitChild", [fence, child, incarnation, signal, why]),
		processInfo: (name) => decoded(Wire.process)("processInfo", [name]),
		hold: (fence, id, cost) => decoded(Wire.hold)("hold", [fence, id, cost]),
		charge: (fence, id, cost) => decoded(Wire.charge)("charge", [fence, id, cost]),
		setLimits: (name, limits, writer) =>
			decoded(Wire.setLimits)("setLimits", [name, limits, writer]),
		usage: (name) => decoded(Wire.usage)("usage", [name]),
		read: (fromPos, limit, prefix) => decoded(Wire.rows)("read", [fromPos, limit, prefix]),
		readStream: (stream, fromRev, limit) =>
			decoded(Wire.rows)("readStream", [stream, fromRev, limit]),
		readLast: (stream, count) => decoded(Wire.rows)("readLast", [stream, count]),
		lease: (name) => decoded(Wire.lease)("lease", [name]),
		watch,
	};
};
