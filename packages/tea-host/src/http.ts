// The `Ledger` over the Durable Object's HTTP face (`durable-object.ts`): POST /<ledger>/<method>
// with the arguments as a JSON array, and the doorbell as a WebSocket on /<ledger>/tail.
//
// Lifted from experiment 97 (experiments/97-one-ledger/service.ts, tail.ts). Its notes still hold:
// one keep-alive pool of at most `maxSockets` connections (experiment 93 saw 200 new connections at
// once get reset), every answer decoded with a Schema, a 3 s timeout. New: the doorbell lives here,
// behind `watch`, and reconnects on its own; every (re)connect rings once, so a write between the
// tail's last read and the new socket is not missed.
import {NodeHttpClient} from "@effect/platform-node";
import {Duration, Effect, Layer, Queue, Stream} from "effect";
import {HttpClient, HttpClientRequest, HttpClientResponse} from "effect/http";
import {Socket} from "effect/socket";
import {fromRaw, Ledger, LedgerUnreachable, type Raw, rawOf} from "./ledger.ts";

export interface HttpOptions {
	/** The ledger's base URL: workerd's direct socket, e.g. `http://127.0.0.1:8787`. */
	readonly url: string;
	/** The ledger's name: one Durable Object per name. */
	readonly ledger: string;
	/** The pool's size. Default 8. */
	readonly maxSockets?: number;
	/** Each call gives up after this long. Default 3 s. */
	readonly timeout?: Duration.Duration;
}

/** The doorbell of one stream: every notice and every (re)connect is one ring. Never fails. */
const doorbell = (url: string): Stream.Stream<void> =>
	Stream.callback<void>((out) =>
		Effect.gen(function* () {
			const socket = yield* Socket.makeWebSocket(url, {openTimeout: Duration.seconds(2)});
			const pull = yield* Socket.readerString(socket);
			yield* Queue.offer(out, undefined);
			for (;;) {
				yield* pull;
				yield* Queue.offer(out, undefined);
			}
		}).pipe(
			Effect.scoped,
			// Node at the edge: Node's own global WebSocket, through Effect's Socket.
			Effect.provide(Socket.layerWebSocketConstructorGlobal),
			Effect.catchCause(() => Effect.void),
			Effect.andThen(Effect.sleep(Duration.millis(100))),
			Effect.forever,
		),
	);

export const layerHttp = (o: HttpOptions) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			const timeout = o.timeout ?? Duration.seconds(3);
			const call = (method: string, args: readonly unknown[]) =>
				HttpClientRequest.post(`${o.url}/${o.ledger}/${method}`).pipe(
					HttpClientRequest.bodyJsonUnsafe(args),
					http.execute,
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap((res) => res.json),
					Effect.scoped,
					Effect.timeout(timeout),
					Effect.mapError(
						(e) =>
							new LedgerUnreachable({method, message: e instanceof Error ? e.message : String(e)}),
					),
				);
			const ws = o.url.replace(/^http/, "ws");
			const watch: Raw["watch"] = (stream) =>
				doorbell(`${ws}/${o.ledger}/tail?stream=${encodeURIComponent(stream)}`);
			return fromRaw(rawOf(call, watch));
		}),
	).pipe(
		Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
		Layer.provide(
			NodeHttpClient.layerAgentOptions({keepAlive: true, maxSockets: o.maxSockets ?? 8}),
		),
	);
