import {JEV_ENDPOINT, type JevRequest} from "@demlik/tea/jev";
import {Clock, Config, Context, Effect, Layer, Option, type Redacted, Ref, Schema} from "effect";
import {HttpClient, HttpClientRequest} from "effect/http";
import {Jev, type JevCallFailed} from "./services.ts";

// The live `Jev`: one HTTP call to TypeSafe's Jev, with a spend cap and a receipt per call. The
// key stays in this Layer as a `Redacted` and goes out only in the request's header.
//
//   Layer.provide(jevFromConfig({calls: 500, usd: 0.5}), FetchHttpClient.layer)
//   // TYPESAFE_API_KEY unset: the Layer fails to build, with a ConfigError. Nothing is sent.
//   // set: every call is counted; once 500 calls or $0.50 are spent, the next is refused unsent,
//   // as a `jev_call_failed` whose cause is `{_tag: "over_cap", ...}`
//   yield* (yield* JevReceipts).spent
//   // {calls: 3, input: 5210, output: 9, usd: 0.000219, ms: 812}
//
// Spend limits live in code, in this one helper (docs/direction/jev-same-answer-cheaper.md). The
// cap is checked before each call, so a run of N calls at once may pass it by at most N - 1 calls:
// a fraction of a cent. A test never builds this Layer: it gives `Jev` a scripted reply instead.

/** Jev's price: $0.042 a million tokens, from the 2026-10-05 bill ($21.31 for 508M tokens). */
export const USD_PER_TOKEN = 0.042 / 1_000_000;

/** Where the key is read from. Never printed, logged or written. */
const KEY = "TYPESAFE_API_KEY";

/** One call's receipt: how long it took, how it went, what it cost. */
export const Receipt = Schema.Struct({
	/** When it was sent, in ms since 1970. */
	at: Schema.Finite,
	/** How long until the reply, in ms. */
	ms: Schema.Finite,
	/** The HTTP status; 0 when no reply came. */
	status: Schema.Int,
	/** Tokens, as the reply's `usage` says; 0 when it says nothing. */
	input: Schema.Int,
	output: Schema.Int,
	usd: Schema.Finite,
});
export type Receipt = typeof Receipt.Type;

/** What a run spent so far, summed over its receipts. */
export interface Spent {
	readonly calls: number;
	readonly input: number;
	readonly output: number;
	readonly usd: number;
	readonly ms: number;
}

/** The most one Layer spends: calls, and dollars by the token. */
export interface Cap {
	readonly calls: number;
	readonly usd: number;
}

/** A call refused before it was sent: the cap is spent. */
export interface OverCap {
	readonly _tag: "over_cap";
	readonly cap: Cap;
	readonly spent: Spent;
}

/** The receipts of one live `Jev`, for a run to read and print at its end. */
export class JevReceipts extends Context.Service<
	JevReceipts,
	{
		readonly receipts: Effect.Effect<readonly Receipt[]>;
		readonly spent: Effect.Effect<Spent>;
	}
>()("JevReceipts") {}

const Usage = Schema.Struct({
	usage: Schema.Struct({input_tokens: Schema.Finite, output_tokens: Schema.Finite}),
});
const usageOf = Schema.decodeUnknownOption(Usage);

/** The receipts summed. */
export const spentOf = (receipts: readonly Receipt[], reserved = 0): Spent => ({
	calls: receipts.length + reserved,
	input: receipts.reduce((n, r) => n + r.input, 0),
	output: receipts.reduce((n, r) => n + r.output, 0),
	usd: receipts.reduce((n, r) => n + r.usd, 0),
	ms: receipts.reduce((n, r) => n + r.ms, 0),
});

/** The receipt line a run prints at its end. */
export const receiptLine = (s: Spent): string =>
	`jev: ${s.calls} calls, ${s.input} input and ${s.output} output tokens, $${s.usd.toFixed(4)}, ${Math.round(s.ms / Math.max(1, s.calls))} ms a call`;

const failed = (cause: unknown): JevCallFailed => ({_tag: "jev_call_failed", cause});

/** Jev over HTTP, with `key`, capped at `cap`. */
export const liveJev = (
	key: Redacted.Redacted<string>,
	cap: Cap,
	endpoint: string = JEV_ENDPOINT,
): Layer.Layer<Jev | JevReceipts, never, HttpClient.HttpClient> =>
	Layer.effectContext(
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			const receipts = yield* Ref.make<readonly Receipt[]>([]);
			/** Calls sent and not back yet: counted against the cap at once. */
			const out = yield* Ref.make(0);

			/** Take one call off the cap, or say why not. */
			const reserve = Effect.gen(function* () {
				const done = yield* Ref.get(receipts);
				const sent = yield* Ref.get(out);
				const spent = spentOf(done, sent);
				if (spent.calls >= cap.calls || spent.usd >= cap.usd)
					return yield* Effect.fail(failed({_tag: "over_cap", cap, spent} satisfies OverCap));
				yield* Ref.update(out, (n) => n + 1);
			});

			const call = (request: JevRequest) =>
				Effect.gen(function* () {
					yield* reserve;
					const at = yield* Clock.currentTimeMillis;
					const keep = (status: number, body: unknown) =>
						Effect.gen(function* () {
							const ms = (yield* Clock.currentTimeMillis) - at;
							const usage = Option.getOrNull(usageOf(body))?.usage;
							const input = usage?.input_tokens ?? 0;
							const output = usage?.output_tokens ?? 0;
							const usd = (input + output) * USD_PER_TOKEN;
							yield* Ref.update(receipts, (rs) => [...rs, {at, ms, status, input, output, usd}]);
							yield* Ref.update(out, (n) => n - 1);
							yield* Effect.annotateCurrentSpan({status, ms, input, output, usd});
						});
					const sent = HttpClientRequest.post(endpoint).pipe(
						HttpClientRequest.bearerToken(key),
						HttpClientRequest.bodyJsonUnsafe(request),
					);
					const reply = yield* http.execute(sent).pipe(
						Effect.flatMap((res) =>
							res.json.pipe(
								Effect.orElseSucceed(() => ({})),
								Effect.map((body) => ({status: res.status, body})),
							),
						),
						Effect.tapError(() => keep(0, {})),
						Effect.mapError(failed),
					);
					yield* keep(reply.status, reply.body);
					return reply;
				}).pipe(Effect.withSpan("jev.call"));

			const spent = Effect.map(Ref.get(receipts), (rs) => spentOf(rs));
			return Context.make(Jev, {call}).pipe(
				Context.add(JevReceipts, {receipts: Ref.get(receipts), spent}),
			);
		}),
	);

/**
 * The live `Jev` on the key in `TYPESAFE_API_KEY`. With it unset the Layer fails to
 * build, loudly, and nothing is sent.
 */
export const jevFromConfig = (
	cap: Cap,
): Layer.Layer<Jev | JevReceipts, Config.ConfigError, HttpClient.HttpClient> =>
	Layer.unwrap(
		Effect.gen(function* () {
			return liveJev(yield* Config.Redacted(KEY), cap);
		}),
	);

/** The key in `TYPESAFE_API_KEY`, if one is set: for a host that runs without Jev when it is not. */
export const jevKey = Config.option(Config.Redacted(KEY));
