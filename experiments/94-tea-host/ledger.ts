// The one ledger a host uses, as an Effect service: experiment 93's Ledger Durable Object over
// its plain HTTP face (POST /<ledger>/<method>, the args as a JSON array), through one small
// connection pool. Every answer is decoded with a Schema; a network error, a 500 or a timeout is
// `LedgerUnreachable`, which never says whether a write landed.
//
// The rules themselves live in 93's `sql.ts`, run inside workerd. Nothing here changes them.
import {NodeHttpClient} from "@effect/platform-node";
import {Context, Duration, Effect, Layer, Schema} from "effect";
import {HttpClient, HttpClientRequest, HttpClientResponse} from "effect/http";

export class LedgerUnreachable extends Schema.TaggedError<LedgerUnreachable>()(
	"LedgerUnreachable",
	{method: Schema.String, message: Schema.String},
) {}

export const AppendResult = Schema.Union([
	Schema.Struct({ok: Schema.Literal(true), pos: Schema.Number, rev: Schema.Number}),
	Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("stale"), rev: Schema.Number}),
	Schema.Struct({ok: Schema.Literal(false), why: Schema.Literal("fenced")}),
]);
export type AppendResult = typeof AppendResult.Type;

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
}

type Call<A> = Effect.Effect<A, LedgerUnreachable>;

export class Ledger extends Context.Service<
	Ledger,
	{
		/** Add one event at `expectedRev + 1`; with a fence, only while that fence holds a live lease on `stream`. */
		readonly append: (
			stream: string,
			expectedRev: number,
			event: NewEvent,
			fence?: number | null,
		) => Call<AppendResult>;
		/** Take the lease on `stream` for `ttlMs`; the claim is an event at `expectedRev + 1`, its `pos` the fence. */
		readonly claim: (
			stream: string,
			holder: string,
			expectedRev: number,
			ttlMs: number,
		) => Call<ClaimResult>;
		/** Move the lease's end on; `lost` once the fence is not the live lease's. */
		readonly renew: (stream: string, fence: number, ttlMs: number) => Call<RenewResult>;
		/** The log after `fromPos`, in order: the tail every host reads. */
		readonly read: (fromPos: number, limit: number) => Call<readonly Row[]>;
		readonly readStream: (stream: string) => Call<readonly Row[]>;
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
				append: (stream, expectedRev, event, fence) =>
					call("append", AppendResult, [stream, expectedRev, event, fence ?? null]),
				claim: (stream, holder, expectedRev, ttlMs) =>
					call("claim", ClaimResult, [stream, holder, expectedRev, ttlMs]),
				renew: (stream, fence, ttlMs) => call("renew", RenewResult, [stream, fence, ttlMs]),
				read: (fromPos, limit) => call("read", Rows, [fromPos, limit]),
				readStream: (stream) => call("readStream", Rows, [stream]),
				lease: (stream) => call("lease", Schema.NullOr(Lease), [stream]),
			};
		}),
	).pipe(
		Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
		Layer.provide(NodeHttpClient.layerAgentOptions({keepAlive: true, maxSockets})),
	);

/** Every event of the log, page by page. */
export const readAll = (ledger: Ledger["Service"], page = 5000) =>
	Effect.gen(function* () {
		const all: Row[] = [];
		for (;;) {
			const rows = yield* ledger.read(all.at(-1)?.pos ?? 0, page);
			all.push(...rows);
			if (rows.length < page) return all;
		}
	});

/** The names a program's streams live under: OTP's registered name, its mailbox. */
export const streams = (name: string) => ({
	/** The lease on it is who runs `name`; the fenced `state` events after each claim are its progress. */
	registry: `registry/${name}`,
	/** Every send to `name`: one event per send, a message id in each. */
	inbox: `${name}/inbox`,
});
