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
import {Context, Effect, Schema, type Stream} from "effect";
import type {
	AppendResult,
	CancelResult,
	ClaimResult,
	Event,
	RegisterResult,
	RenewResult,
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
/** Kafka's ProducerFenced: the fence names no live lease that may write this stream. Stop writing. */
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
/** etcd's lease not found: this fence's lease ran out or was taken over. */
export class LeaseLost extends Schema.TaggedError<LeaseLost>()("LeaseLost", {
	name: Schema.String,
}) {}
/** The lease is live, but someone cancelled the work: stop. */
export class Cancelled extends Schema.TaggedError<Cancelled>()("Cancelled", {
	name: Schema.String,
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
/** A won claim: the fence every write under the name must carry, and the lease's end. */
export const Claimed = Schema.Struct({
	fence: Schema.Number,
	rev: Schema.Number,
	expiresAt: Schema.Number,
});
export type Claimed = typeof Claimed.Type;

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
});

// ---------------------------------------------------------------- the service

type Call<A, E = never> = Effect.Effect<A, E | LedgerUnreachable>;

export class Ledger extends Context.Service<
	Ledger,
	{
		/** Register `name`: from now on writes under it are guarded, and its inbox is open. */
		readonly register: (name: string, writer: string) => Call<Registered, Denied>;
		/**
		 * One event: at `expected + 1`, or at the end with "any". With a fence, only while its lease is
		 * live and may write here (its name's streams, and any inbox). With none, only an inbox.
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
		) => Call<Claimed, Held | Stale | Denied | UnknownName>;
		/** Move the lease's end on. */
		readonly renew: (
			name: string,
			fence: number,
			ttlMs: number,
		) => Call<{readonly expiresAt: number}, LeaseLost | Cancelled>;
		/** Tell the holder of `name` to stop: its next renew is `Cancelled`. */
		readonly cancel: (name: string, writer: string) => Call<Appended, UnknownName>;
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
>()("@tea-fabrika/tea-host/Ledger") {}

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
	readonly read: (fromPos: number, limit: number, prefix: string | null) => Call<readonly Row[]>;
	readonly readStream: (stream: string, fromRev: number, limit: number) => Call<readonly Row[]>;
	readonly readLast: (stream: string, count: number) => Call<readonly Row[]>;
	readonly lease: (name: string) => Call<Lease | null>;
	readonly watch: (stream: string) => Stream.Stream<void>;
}

const claimed =
	(name: string) =>
	(r: ClaimResult): Effect.Effect<Claimed, Held | Stale | Denied | UnknownName> => {
		if (r.ok) return Effect.succeed({fence: r.fence, rev: r.rev, expiresAt: r.expiresAt});
		switch (r.why) {
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
	]),
	renew: Schema.Union([
		Schema.Struct({ok: Schema.Literal(true), expiresAt: Schema.Number}),
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
		read: (fromPos, limit, prefix) => decoded(Wire.rows)("read", [fromPos, limit, prefix]),
		readStream: (stream, fromRev, limit) =>
			decoded(Wire.rows)("readStream", [stream, fromRev, limit]),
		readLast: (stream, count) => decoded(Wire.rows)("readLast", [stream, count]),
		lease: (name) => decoded(Wire.lease)("lease", [name]),
		watch,
	};
};
