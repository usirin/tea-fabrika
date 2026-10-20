// The one `Ledger` service a tea-host gives its programs (experiment 97). It merges the two Effect
// clients that grew apart, experiment 95's (../95-agents-across-hosts/client.ts: `fenceOn` and a
// `sender` that retried on `stale`) and experiment 96's (../96-ledger-mailbox/service.ts: append
// "any" with a message id, `send`, `readStream`, `readLast`, a prefix `read`), over the one merged
// ledger (`sql.ts`).
//
// What changed from both:
//
//   - Every refusal is a tagged error in the error channel, never an `ok: false` to check and never
//     a throw: `Stale` (EventStoreDB's WrongExpectedVersion), `Fenced` (Kafka's ProducerFenced),
//     `Denied` (EventStoreDB's AccessDenied), `Held` (etcd: the lock is taken), `LeaseLost` (etcd:
//     the lease is gone), `Cancelled` (someone asked the holder to stop), and `LedgerUnreachable`,
//     which never says whether a write landed.
//   - Each call's error type names exactly the refusals it can meet: `send` cannot be `Stale`.
//   - `fenceOn` is gone: the fence names its lease (see `sql.ts`). A reply into another program's
//     inbox is `send(inbox, id, event, fence)`.
//   - `send` takes an `Inbox`, which only `streams(name).inbox` or `inboxOf` makes.
//
// 94's notes still hold: one keep-alive pool, every answer decoded with a Schema, a 3 s timeout.
import {NodeHttpClient} from "@effect/platform-node";
import {Context, Duration, Effect, Layer, Schema} from "effect";
import {HttpClient, HttpClientRequest, HttpClientResponse} from "effect/http";

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
/** EventStoreDB's AccessDenied: a claimed name's stream, written with no fence; or a claim inside one. */
export class Denied extends Schema.TaggedError<Denied>()("Denied", {stream: Schema.String}) {}
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
const Rows = Schema.Array(Row);

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

/** A mailbox address: the one kind of stream anyone may append to. */
export type Inbox = string & {readonly kind: "inbox"};
/** An address read from a message (a reply-to) becomes an `Inbox` only if it is one. */
export const inboxOf = (stream: string): Inbox | null =>
	stream.endsWith("/inbox") ? (stream as Inbox) : null;

// ---------------------------------------------------------------- the wire

const Wire = {
	append: Schema.Union([
		Schema.Struct({
			ok: Schema.Literal(true),
			pos: Schema.Number,
			rev: Schema.Number,
			dup: Schema.Boolean,
		}),
		Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("stale"), rev: Schema.Number}),
		Schema.Struct({ok: Schema.Literal(false), why: Schema.Literals(["fenced", "denied"])}),
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
		Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("denied")}),
	]),
	renew: Schema.Union([
		Schema.Struct({ok: Schema.Literal(true), expiresAt: Schema.Number}),
		Schema.Struct({ok: Schema.Literal(false), why: Schema.Literals(["lost", "stop"])}),
	]),
};

type Call<A, E = never> = Effect.Effect<A, E | LedgerUnreachable>;

// ---------------------------------------------------------------- the service

export class Ledger extends Context.Service<
	Ledger,
	{
		/**
		 * One event: at `expected + 1`, or at the end with "any". With a fence, only while its lease is
		 * live and may write here (its name's streams, and any inbox). With none, only where no claimed
		 * name guards the stream.
		 */
		readonly append: (
			stream: string,
			expected: number | "any",
			event: NewEvent,
			fence?: number,
		) => Call<Appended, Stale | Fenced | Denied>;
		/** A message to a mailbox, at its end, deduped by `id`. Fenced on the sender's own lease if given. */
		readonly send: (
			inbox: Inbox,
			id: string,
			event: Omit<NewEvent, "id">,
			fence?: number,
		) => Call<Appended, Fenced | Denied>;
		/** Take the lease on `name` for `ttlMs`; the claim is an event at `expectedRev + 1`. */
		readonly claim: (
			name: string,
			holder: string,
			expectedRev: number,
			ttlMs: number,
		) => Call<Claimed, Held | Stale | Denied>;
		/** Move the lease's end on. */
		readonly renew: (
			name: string,
			fence: number,
			ttlMs: number,
		) => Call<{readonly expiresAt: number}, LeaseLost | Cancelled>;
		/** The log after `fromPos`, in order; with a prefix, only the streams under it. */
		readonly read: (fromPos: number, limit: number, prefix?: string) => Call<readonly Row[]>;
		/** One stream after `fromRev`, at most `limit` events (-1: all). */
		readonly readStream: (stream: string, fromRev?: number, limit?: number) => Call<readonly Row[]>;
		/** A stream's last `count` events, in order. */
		readonly readLast: (stream: string, count: number) => Call<readonly Row[]>;
		readonly lease: (name: string) => Call<Lease | null>;
	}
>()("tea-host/Ledger") {}

/** Each call gives up after this long: an answer that never comes is a network error. */
const TIMEOUT = Duration.seconds(3);

/**
 * The ledger at `base` (a direct socket of workerd), named `name`. One pool of at most
 * `maxSockets` connections: experiment 93 saw 200 new connections at once get reset.
 */
export const ledgerLayer = (base: string, name: string, maxSockets = 8) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			const call = <S extends Schema.Constraint>(
				method: string,
				schema: S,
				args: readonly unknown[],
			): Effect.Effect<S["Type"], LedgerUnreachable, S["DecodingServices"]> =>
				HttpClientRequest.post(`${base}/${name}/${method}`).pipe(
					HttpClientRequest.bodyJsonUnsafe(args),
					http.execute,
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
					Effect.scoped,
					Effect.timeout(TIMEOUT),
					Effect.mapError(
						(e) =>
							new LedgerUnreachable({method, message: e instanceof Error ? e.message : String(e)}),
					),
				);
			const append = (
				stream: string,
				expected: number | "any",
				event: NewEvent,
				fence: number | undefined,
			): Call<Appended, Stale | Fenced | Denied> =>
				call("append", Wire.append, [stream, expected, event, fence ?? null]).pipe(
					Effect.flatMap(
						(r): Effect.Effect<Appended, Stale | Fenced | Denied> =>
							r.ok
								? Effect.succeed<Appended>({pos: r.pos, rev: r.rev, dup: r.dup})
								: r.why === "stale"
									? Effect.fail(new Stale({stream, rev: r.rev}))
									: r.why === "fenced"
										? Effect.fail(new Fenced({stream}))
										: Effect.fail(new Denied({stream})),
					),
				);
			return {
				append,
				send: (inbox, id, event, fence) =>
					append(inbox, "any", {...event, id}, fence).pipe(
						// An append at the end is never stale; if the wire says so, the ledger is broken.
						Effect.catchTag("Stale", (e) => Effect.die(`send to ${e.stream} answered stale`)),
					),
				claim: (n, holder, expectedRev, ttlMs) =>
					call("claim", Wire.claim, [n, holder, expectedRev, ttlMs]).pipe(
						Effect.flatMap(
							(r): Effect.Effect<Claimed, Held | Stale | Denied> =>
								r.ok
									? Effect.succeed<Claimed>({fence: r.fence, rev: r.rev, expiresAt: r.expiresAt})
									: r.why === "held"
										? Effect.fail(new Held({name: n, holder: r.holder, expiresAt: r.expiresAt}))
										: r.why === "stale"
											? Effect.fail(new Stale({stream: n, rev: r.rev}))
											: Effect.fail(new Denied({stream: n})),
						),
					),
				renew: (n, fence, ttlMs) =>
					call("renew", Wire.renew, [n, fence, ttlMs]).pipe(
						Effect.flatMap(
							(r): Effect.Effect<{readonly expiresAt: number}, LeaseLost | Cancelled> =>
								r.ok
									? Effect.succeed({expiresAt: r.expiresAt})
									: r.why === "lost"
										? Effect.fail(new LeaseLost({name: n}))
										: Effect.fail(new Cancelled({name: n})),
						),
					),
				read: (fromPos, limit, prefix) => call("read", Rows, [fromPos, limit, prefix ?? null]),
				readStream: (stream, fromRev, limit) =>
					call("readStream", Rows, [stream, fromRev ?? 0, limit ?? -1]),
				readLast: (stream, count) => call("readLast", Rows, [stream, count]),
				lease: (n) => call("lease", Schema.NullOr(Lease), [n]),
			};
		}),
	).pipe(
		Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
		Layer.provide(NodeHttpClient.layerAgentOptions({keepAlive: true, maxSockets})),
	);

/** The streams of a registered name: OTP's registered name, its state, its mailbox. */
export const streams = (name: string) => ({
	/** The lease on it is who runs `name`. Only claims, expiries and cancels: no traffic per message. */
	registry: name,
	/** The program's saved states. Only the lease's fence writes here: the ledger denies anything else. */
	state: `${name}/state`,
	/** Every message to `name`, one event per message id. Open to anyone. */
	inbox: `${name}/inbox` as Inbox,
});
