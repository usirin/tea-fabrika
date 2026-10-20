// Copied from experiments/94-tea-host/ledger.ts (the host's ledger client). What changed:
//
//   - `append` takes "any" for the rev and an event `id`; `send` is the mailbox's own call: an
//     append at the end that must carry a message id, so a sender cannot forget the one thing that
//     makes a resend safe. Its answer is `ok` or `dup`, never `stale`.
//   - `readStream` reads from a rev, with a limit; `readLast` reads a stream's last events; `read`
//     takes a prefix.
//   - `streams(name)`: the lease is on the name itself, and the program's streams sit under it
//     (`counter:1/state`, `counter:1/inbox`), so the lease's fence guards them.
//
// 94's notes still hold: one keep-alive pool, every answer decoded with a Schema, a 3 s timeout,
// and a network error is `LedgerUnreachable`, which never says whether a write landed.
import {NodeHttpClient} from "@effect/platform-node";
import {Context, Duration, Effect, Layer, Schema} from "effect";
import {HttpClient, HttpClientRequest, HttpClientResponse} from "effect/http";

export class LedgerUnreachable extends Schema.TaggedError<LedgerUnreachable>()(
	"LedgerUnreachable",
	{method: Schema.String, message: Schema.String},
) {}

export const AppendResult = Schema.Union([
	Schema.Struct({
		ok: Schema.Literal(true),
		pos: Schema.Number,
		rev: Schema.Number,
		dup: Schema.Boolean,
	}),
	Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("stale"), rev: Schema.Number}),
	Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("fenced")}),
]);
export type AppendResult = typeof AppendResult.Type;

/** A send's answer: it is in the inbox, now (`dup` false) or from an earlier send of this id. */
export const SendResult = Schema.Struct({
	ok: Schema.Literal(true),
	pos: Schema.Number,
	rev: Schema.Number,
	dup: Schema.Boolean,
});
export type SendResult = typeof SendResult.Type;

export const ClaimResult = Schema.Union([
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
]);
export type ClaimResult = typeof ClaimResult.Type;

export const RenewResult = Schema.Union([
	Schema.Struct({ok: Schema.Literal(true), expiresAt: Schema.Number}),
	Schema.Struct({ok: Schema.Literal(false), why: Schema.Literals(["lost", "stop"])}),
]);
export type RenewResult = typeof RenewResult.Type;

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

type Call<A> = Effect.Effect<A, LedgerUnreachable>;

export class Ledger extends Context.Service<
	Ledger,
	{
		/**
		 * Add one event: at `expected + 1`, or at the end with "any". With a fence, only while that
		 * fence holds a live lease on `stream` or on a prefix of it (`a` guards `a/*`).
		 */
		readonly append: (
			stream: string,
			expected: number | "any",
			event: NewEvent,
			fence?: number | null,
		) => Call<AppendResult>;
		/** A send to a mailbox: at the end, deduped by `id`. Never `stale`, never fenced. */
		readonly send: (stream: string, id: string, event: Omit<NewEvent, "id">) => Call<SendResult>;
		/** Take the lease on `stream` for `ttlMs`; the claim is an event at `expectedRev + 1`, its `pos` the fence. */
		readonly claim: (
			stream: string,
			holder: string,
			expectedRev: number,
			ttlMs: number,
		) => Call<ClaimResult>;
		/** Move the lease's end on; `lost` once the fence is not the live lease's. */
		readonly renew: (stream: string, fence: number, ttlMs: number) => Call<RenewResult>;
		/** The log after `fromPos`, in order; with a prefix, only the streams under it. */
		readonly read: (fromPos: number, limit: number, prefix?: string) => Call<readonly Row[]>;
		/** One stream after `fromRev`, at most `limit` events (-1: all). */
		readonly readStream: (stream: string, fromRev?: number, limit?: number) => Call<readonly Row[]>;
		/** A stream's last `count` events, in order. */
		readonly readLast: (stream: string, count: number) => Call<readonly Row[]>;
		readonly lease: (stream: string) => Call<Lease | null>;
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
			return {
				append: (stream, expected, event, fence) =>
					call("append", AppendResult, [stream, expected, event, fence ?? null]),
				send: (stream, id, event) => call("append", SendResult, [stream, "any", {...event, id}]),
				claim: (stream, holder, expectedRev, ttlMs) =>
					call("claim", ClaimResult, [stream, holder, expectedRev, ttlMs]),
				renew: (stream, fence, ttlMs) => call("renew", RenewResult, [stream, fence, ttlMs]),
				read: (fromPos, limit, prefix) => call("read", Rows, [fromPos, limit, prefix ?? null]),
				readStream: (stream, fromRev, limit) =>
					call("readStream", Rows, [stream, fromRev ?? 0, limit ?? -1]),
				readLast: (stream, count) => call("readLast", Rows, [stream, count]),
				lease: (stream) => call("lease", Schema.NullOr(Lease), [stream]),
			};
		}),
	).pipe(
		Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
		Layer.provide(NodeHttpClient.layerAgentOptions({keepAlive: true, maxSockets})),
	);

/** The names a program's streams live under: OTP's registered name, its state, its mailbox. */
export const streams = (name: string) => ({
	/** The lease on it is who runs `name`. Only claims, expiries and cancels: no traffic per message. */
	registry: name,
	/** The program's saved states, each written under the registry lease's fence. */
	state: `${name}/state`,
	/** Every send to `name`: one event per message id. */
	inbox: `${name}/inbox`,
});
