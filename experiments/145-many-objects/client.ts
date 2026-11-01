// The app's side of experiment 145's server: one `Ledger` per object, and the door's own steps.
//
// An object's address is the server's origin and the object's name: `<origin>/person/<id>`. A
// program is handed the `Ledger` of one address (`layerObject`) and never sees the address: the
// same program runs on a project's object or on a person's.
//
// Like the package's `layerHttp` (`@kampus/fabrika-old/http`), with two changes: every call carries a
// session (`Authorization: Bearer`), and the doorbell's WebSocket carries it too, in its handshake
// headers, which the `ws` client can set and Node's global WebSocket cannot.
import {NodeHttpClient, NodeSocket} from "@effect/platform-node";
import {fromRaw, Ledger, LedgerUnreachable, type Raw, rawOf} from "@kampus/fabrika-old";
import {Duration, Effect, Layer, Queue, Stream} from "effect";
import {HttpClient, HttpClientRequest} from "effect/http";
import {Socket} from "effect/socket";

/** Where a server is, and who is calling it. */
export interface Server {
	/** The server's origin: `http://127.0.0.1:<port>` here, a `workers.dev` URL on Cloudflare. */
	readonly url: string;
	/** A session (`session.ts`): the person, or the agent, calling. */
	readonly token: string;
	/** Each call gives up after this long. Default 3 s. */
	readonly timeout?: Duration.Duration;
}

/** What the server said: its status and its JSON. */
export interface Answer {
	readonly status: number;
	readonly body: unknown;
}

/** The pool every call shares: keep-alive, at most 8 connections (as `layerHttp`). */
export const httpLayer = NodeHttpClient.layerNodeHttpOptions({keepAlive: true, maxSockets: 8});

/** One request to a path under the server. Any status is an answer; only no answer fails. */
export const ask = (
	server: Server,
	path: string,
	body?: unknown,
): Effect.Effect<Answer, LedgerUnreachable, HttpClient.HttpClient> =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		const url = `${server.url}/${path}`;
		const req =
			body === undefined
				? HttpClientRequest.get(url)
				: HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body));
		// No session: no header at all.
		const res = yield* http.execute(
			server.token === "" ? req : req.pipe(HttpClientRequest.bearerToken(server.token)),
		);
		const json: unknown = yield* res.json;
		return {status: res.status, body: json};
	}).pipe(
		Effect.scoped,
		Effect.timeout(server.timeout ?? Duration.seconds(3)),
		Effect.mapError((e) => {
			const cause: unknown = e instanceof Error ? e.cause : undefined;
			const why = cause instanceof Error ? `: ${cause.message}` : "";
			return new LedgerUnreachable({method: path, message: `${String(e)}${why}`});
		}),
	);

/** One of the door's own steps on an object: `create`, `invite`, `members`, `export`... */
export const door = (server: Server, object: string, step: string, body?: unknown) =>
	ask(server, `${object}/door/${step}`, body);

/** The doorbell of one stream, as `layerHttp`'s, with the session in the handshake. */
const doorbell = (url: string, token: string): Stream.Stream<void> =>
	Stream.callback<void>((out) =>
		Effect.gen(function* () {
			const socket = yield* Socket.makeWebSocket(url, {
				openTimeout: Duration.seconds(2),
				headers: {authorization: `Bearer ${token}`},
			});
			const pull = yield* Socket.readerString(socket);
			yield* Queue.offer(out, undefined);
			for (;;) {
				yield* pull;
				yield* Queue.offer(out, undefined);
			}
		}).pipe(
			Effect.scoped,
			Effect.provide(NodeSocket.layerWebSocketConstructorWS),
			Effect.catchCause(() => Effect.void),
			Effect.andThen(Effect.sleep(Duration.millis(100))),
			Effect.forever,
		),
	);

/** The raw face of one object: every method a POST under its address. A refusal is unreachable. */
export const rawObject = (server: Server, object: string, http: HttpClient.HttpClient): Raw =>
	rawOf(
		(method, args) =>
			ask(server, `${object}/${method}`, args).pipe(
				Effect.provideService(HttpClient.HttpClient, http),
				Effect.flatMap((a) =>
					a.status === 200
						? Effect.succeed(a.body)
						: Effect.fail(
								new LedgerUnreachable({method, message: `${a.status} ${JSON.stringify(a.body)}`}),
							),
				),
			),
		(stream) =>
			doorbell(
				`${server.url.replace(/^http/, "ws")}/${object}/tail?stream=${encodeURIComponent(stream)}`,
				server.token,
			),
	);

/** The `Ledger` of one object. What runs on it sees one ledger, and not which object it is. */
export const layerObject = (server: Server, object: string) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			return fromRaw(rawObject(server, object, yield* HttpClient.HttpClient));
		}),
	).pipe(Layer.provide(httpLayer));
