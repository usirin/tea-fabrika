// The `Ledger` over the Durable Object's HTTP face (`durable-object.ts`): POST /<ledger>/<method>
// with the arguments as a JSON array, and the doorbell as a WebSocket on /<ledger>/tail. Every
// request carries a credential, and the door (`door.ts`) says who it is.
//
// Lifted from experiment 97 (experiments/97-one-ledger/service.ts, tail.ts). Its notes still hold:
// one keep-alive pool of at most `maxSockets` connections (experiment 93 saw 200 new connections at
// once get reset), every answer decoded with a Schema, a 3 s timeout. New: the doorbell lives here,
// behind `watch`, and reconnects on its own; every (re)connect rings once, so a write between the
// tail's last read and the new socket is not missed.
//
// Who wrote a row never leaves this process. The `Ledger` service still takes a writer (and a
// claim a holder), because the ledgers in this process need one; `onTheWire` drops the writer, and
// a claim's holder goes as the host's own tag. The door puts the credential's writer in its place.
//
// `doorOf` is the door's own steps: a challenge, a login signed by the `Signer`, an agent's login
// with its grant, and a person's invite, remove and (on a local ledger) agent token.
import {NodeHttpClient} from "@effect/platform-node";
import {Duration, Effect, Layer, Queue, Redacted, Schema, Stream} from "effect";
import {HttpClient, HttpClientRequest} from "effect/http";
import {Socket} from "effect/socket";
import {fromRaw, Ledger, LedgerUnreachable, type Raw, rawOf} from "./ledger.ts";
import {Signer} from "./signer.ts";
import {Agent, User} from "./writer.ts";

export interface HttpOptions {
	/** The ledger's base URL: workerd's direct socket, e.g. `http://127.0.0.1:8787`. */
	readonly url: string;
	/** The ledger's name: one Durable Object per name. */
	readonly ledger: string;
	/** What the door lets in: a session, an agent's token, or a local ledger's secret. */
	readonly token: Redacted.Redacted<string>;
	/** The pool's size. Default 8. */
	readonly maxSockets?: number;
	/** Each call gives up after this long. Default 3 s. */
	readonly timeout?: Duration.Duration;
}

/** What leaves this process for one call: its arguments, with no writer in them. */
export const onTheWire = (method: string, args: readonly unknown[]): readonly unknown[] => {
	switch (method) {
		case "register":
		case "cancel":
			return args.slice(0, 1);
		case "setLimits":
			return args.slice(0, 2);
		case "exit":
			return args.slice(0, 5);
		case "append": {
			const [stream, expected, event, fence] = args;
			const {writer: _, ...rest} = event as {readonly writer?: unknown};
			return [stream, expected, rest, fence];
		}
		default:
			return args;
	}
};

/** The doorbell of one stream: every notice and every (re)connect is one ring. Never fails. */
const doorbell = (url: string, token: Redacted.Redacted<string>): Stream.Stream<void> =>
	Stream.callback<void>((out) =>
		Effect.gen(function* () {
			// A browser's WebSocket sends no Authorization header, so the token rides as a subprotocol.
			const socket = yield* Socket.makeWebSocket(url, {
				openTimeout: Duration.seconds(2),
				protocols: ["fabrika", `bearer.${Redacted.value(token)}`],
			});
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

const clients = (maxSockets: number) =>
	NodeHttpClient.layerNodeHttpNoAgent.pipe(
		Layer.provide(NodeHttpClient.layerAgentOptions({keepAlive: true, maxSockets})),
	);

export const layerHttp = (o: HttpOptions) =>
	Layer.effect(
		Ledger,
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			const timeout = o.timeout ?? Duration.seconds(3);
			const call = (method: string, args: readonly unknown[]) =>
				HttpClientRequest.post(`${o.url}/${o.ledger}/${method}`).pipe(
					HttpClientRequest.bearerToken(o.token),
					HttpClientRequest.bodyJsonUnsafe(onTheWire(method, args)),
					http.execute,
					Effect.flatMap((res) =>
						res.status >= 200 && res.status < 300
							? res.json
							: Effect.flatMap(res.text, (text) =>
									Effect.fail(new Error(`the ledger answered ${res.status}: ${text}`)),
								),
					),
					Effect.scoped,
					Effect.timeout(timeout),
					Effect.mapError(
						(e) =>
							new LedgerUnreachable({method, message: e instanceof Error ? e.message : String(e)}),
					),
				);
			const ws = o.url.replace(/^http/, "ws");
			const watch: Raw["watch"] = (stream) =>
				doorbell(`${ws}/${o.ledger}/tail?stream=${encodeURIComponent(stream)}`, o.token);
			return fromRaw(rawOf(call, watch));
		}),
	).pipe(Layer.provide(clients(o.maxSockets ?? 8)));

/** Does anything answer HTTP on `url`: a ledger's door answers even with no credential. */
export const answers = (url: string): Effect.Effect<boolean> =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		yield* http.get(`${url}/`).pipe(Effect.scoped);
		return true;
	}).pipe(
		Effect.timeout(Duration.seconds(1)),
		Effect.orElseSucceed(() => false),
		Effect.provide(clients(1)),
	);

// ---------------------------------------------------------------- the door's own steps

/** The door said no: `status` as HTTP says it (401 who are you, 403 not you), `why` in words. */
export class DoorRefused extends Schema.TaggedError<DoorRefused>()("DoorRefused", {
	status: Schema.Number,
	why: Schema.String,
}) {}

/** A session the door gave: its token, who it is, and when it ends. */
export const Session = Schema.Struct({
	token: Schema.RedactedFromValue(Schema.String),
	who: Schema.Union([User, Agent]),
	expires: Schema.Number,
});
export type Session = typeof Session.Type;

const Member = Schema.Struct({id: Schema.String, login: Schema.String});
const Members = Schema.Struct({members: Schema.Array(Member), invited: Schema.Array(Member)});
const Challenge = Schema.Struct({text: Schema.String});
const Invited = Schema.Struct({id: Schema.Number, login: Schema.String});
const Who = Schema.Struct({who: Schema.Union([User, Agent])});

/** The door of one ledger, at `url` (its base) and `ledger` (its name). */
export const doorOf = (o: {readonly url: string; readonly ledger: string}) => {
	const step = <A>(
		schema: Schema.Codec<A, unknown>,
		name: string,
		body: unknown,
		token?: Redacted.Redacted<string>,
	): Effect.Effect<A, DoorRefused> =>
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient;
			const base = HttpClientRequest.post(`${o.url}/${o.ledger}/door/${name}`).pipe(
				HttpClientRequest.bodyJsonUnsafe(body),
			);
			const req = token === undefined ? base : HttpClientRequest.bearerToken(base, token);
			const res = yield* http.execute(req);
			const json: unknown = yield* res.json;
			if (res.status < 200 || res.status >= 300) {
				const why = (json as {error?: unknown})?.error;
				return yield* new DoorRefused({status: res.status, why: String(why ?? "")});
			}
			return yield* Schema.decodeUnknownEffect(schema)(json);
		}).pipe(
			Effect.scoped,
			Effect.timeout(Duration.seconds(10)),
			Effect.catch((e) =>
				e instanceof DoorRefused
					? Effect.fail(e)
					: Effect.fail(
							new DoorRefused({status: 0, why: e instanceof Error ? e.message : String(e)}),
						),
			),
			Effect.provide(clients(1)),
		);
	const challenge = step(Challenge, "challenge", {}).pipe(Effect.map((c) => c.text));
	return {
		/** A person's login: this ledger's challenge, signed by the `Signer` (a key GitHub lists). */
		login: (login: string) =>
			Effect.gen(function* () {
				const signer = yield* Signer;
				const text = yield* challenge;
				return yield* step(Session, "login", {
					login,
					challenge: text,
					signature: yield* signer.sign(text),
				});
			}),
		/** An agent's login: its person's grant, and this ledger's challenge signed by the agent's key. */
		agentLogin: (g: {readonly text: string; readonly signature: string}) =>
			Effect.gen(function* () {
				const signer = yield* Signer;
				const text = yield* challenge;
				return yield* step(Session, "agent-login", {
					grant: g.text,
					granted: g.signature,
					challenge: text,
					signature: yield* signer.sign(text),
				});
			}),
		who: (token: Redacted.Redacted<string>) =>
			step(Who, "who", {}, token).pipe(Effect.map((w) => w.who)),
		members: (token: Redacted.Redacted<string>) => step(Members, "members", {}, token),
		invite: (token: Redacted.Redacted<string>, login: string) =>
			step(Invited, "invite", {login}, token),
		remove: (token: Redacted.Redacted<string>, id: string) =>
			step(Schema.Struct({id: Schema.String}), "remove", {id}, token),
		/** On a local ledger: a token for one of the person's agents. */
		addAgent: (token: Redacted.Redacted<string>, name: string) =>
			step(Session, "agent", {name}, token),
	};
};
