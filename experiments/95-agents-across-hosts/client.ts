// The one ledger a host uses, as an Effect service: experiment 94's client
// (../94-tea-host/ledger.ts), with one change. `append` takes `fenceOn`, the stream whose lease
// the fence is checked on (95's ledger, ./ledger/sql.ts), so a program can fence a write to
// another program's inbox on its own lease. And `send`: one message to an inbox, at its end,
// fenced, trying again on `stale`.
//
// A network error, a 500 or a timeout is `LedgerUnreachable`, which never says whether a write
// landed.
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
		/**
		 * Add one event at `expectedRev + 1`. With a fence, only while that fence holds a live lease
		 * on `fenceOn` (on `stream` when `fenceOn` is not given).
		 */
		readonly append: (
			stream: string,
			expectedRev: number,
			event: NewEvent,
			fence?: number | null,
			fenceOn?: string | null,
		) => Call<AppendResult>;
		readonly claim: (
			stream: string,
			holder: string,
			expectedRev: number,
			ttlMs: number,
		) => Call<ClaimResult>;
		readonly renew: (stream: string, fence: number, ttlMs: number) => Call<RenewResult>;
		readonly read: (fromPos: number, limit: number) => Call<readonly Row[]>;
		readonly readStream: (stream: string) => Call<readonly Row[]>;
		readonly lease: (stream: string) => Call<Lease | null>;
	}
>()("exp95/Ledger") {}

/** Each call gives up after this long: an answer that never comes is a network error. */
const TIMEOUT = Duration.seconds(3);

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
				append: (stream, expectedRev, event, fence, fenceOn) =>
					call("append", AppendResult, [
						stream,
						expectedRev,
						event,
						fence ?? null,
						fenceOn ?? null,
					]),
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

/** The names a program's streams live under: OTP's registered name, its mailbox. */
export const streams = (name: string) => ({
	/** The lease on it is who runs `name`; the fenced `state` events after each claim are its progress. */
	registry: `registry/${name}`,
	/** Every message to `name`: one event per send, a message id in each. */
	inbox: `${name}/inbox`,
});

/** How one `send` ended. `fenced`: the sender no longer holds its own name. */
export type Sent =
	| {readonly how: "sent"; readonly rev: number}
	| {readonly how: "fenced"}
	| {readonly how: "unreachable"};

/**
 * A sender of messages to inboxes, for one program under one fence: each message goes at the
 * inbox's end, fenced on the sender's own registry stream. The rev each inbox ends at is
 * remembered, and a `stale` answer gives the real one, so it tries again there. No answer: it
 * tries again, up to `tries` times. A message may then land twice; every mailbox here dedupes
 * by message id.
 */
export const sender = (
	ledger: Ledger["Service"],
	o: {readonly holder: string; readonly fence: number; readonly fenceOn: string},
	tries = 20,
) => {
	const ends = new Map<string, number>();
	return (inbox: string, kind: string, data: unknown): Effect.Effect<Sent> =>
		Effect.gen(function* () {
			for (let lost = 0; lost < tries;) {
				const r = yield* ledger
					.append(inbox, ends.get(inbox) ?? 0, {kind, writer: o.holder, data}, o.fence, o.fenceOn)
					.pipe(Effect.result);
				if (r._tag === "Failure") {
					lost++;
					yield* Effect.sleep(Duration.millis(50));
					continue;
				}
				const a = r.success;
				if (a.ok) {
					ends.set(inbox, a.rev);
					return {how: "sent", rev: a.rev} as const;
				}
				if (a.why === "fenced") return {how: "fenced"} as const;
				ends.set(inbox, a.rev);
			}
			return {how: "unreachable"} as const;
		});
};
