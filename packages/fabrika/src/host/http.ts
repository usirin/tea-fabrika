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
//
// A person's session ends (`SESSION_MS`), so a host that runs longer keeps one that renews
// (`renewing`), as an OAuth client keeps its access token fresh:
//
//   const session = yield* renewing(first, login)   // logs in again 5 minutes before the end
//   layerHttp({url, ledger, token: session})        // a 401 logs in once more and sends again
//
// The timer alone is not enough: a laptop that sleeps past the end wakes with an ended session
// and its timer late. So a 401 to a call, or a refused doorbell, logs in again too, once for
// every caller holding the same ended token. A door that refuses the login itself (401, 403: the
// person was removed) is kept as the answer, and every call fails with it from then on.
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import {
	Clock,
	Duration,
	Effect,
	Exit,
	Layer,
	Queue,
	Redacted,
	Schema,
	type Scope,
	Stream,
	SynchronizedRef,
} from "effect";
import {HttpClient, HttpClientRequest} from "effect/http";
import {Socket} from "effect/socket";
import {StorageBroken} from "../program/storage.ts";
import {fromRaw, Ledger, LedgerUnreachable, type Raw, rawOf} from "./ledger.ts";
import {type Moved, Progress, type Seal} from "./move.ts";
import {Signer} from "./signer.ts";
import {type JobCall, layerTraces, type RecordCalls} from "./traces.ts";
import {Agent, User} from "./writer.ts";

export interface HttpOptions {
	/** The ledger's base URL: workerd's direct socket, e.g. `http://127.0.0.1:8787`. */
	readonly url: string;
	/** The ledger's name: one Durable Object per name. */
	readonly ledger: string;
	/**
	 * What the door lets in: a fixed token (an agent's, a local ledger's secret, one session), or
	 * a person's session that renews (`renewing`).
	 */
	readonly token: Redacted.Redacted<string> | Renewing;
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

/**
 * The doorbell of one stream: every notice and every (re)connect is one ring. Never fails. Each
 * connect sends the token as it is then; when a socket fails, `lost` is told the token it used.
 */
const doorbell = (
	url: string,
	token: Effect.Effect<Redacted.Redacted<string>, DoorRefused>,
	lost: (used: Redacted.Redacted<string>) => Effect.Effect<void>,
): Stream.Stream<void> =>
	Stream.callback<void>((out) =>
		Effect.gen(function* () {
			const used = yield* token;
			yield* Effect.gen(function* () {
				// A browser's WebSocket sends no Authorization header, so the token rides as a subprotocol.
				const socket = yield* Socket.makeWebSocket(url, {
					openTimeout: Duration.seconds(2),
					protocols: ["fabrika", `bearer.${Redacted.value(used)}`],
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
				Effect.catch(() => lost(used)),
			);
		}).pipe(
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
			const given = o.token;
			const current = Redacted.isRedacted(given) ? Effect.succeed(given) : given.current;
			const renew = Redacted.isRedacted(given) ? null : given.renew;
			/** One request: its status and its body, as text. */
			const send = (method: string, args: readonly unknown[], token: Redacted.Redacted<string>) =>
				HttpClientRequest.post(`${o.url}/${o.ledger}/${method}`).pipe(
					HttpClientRequest.bearerToken(token),
					HttpClientRequest.bodyJsonUnsafe(onTheWire(method, args)),
					http.execute,
					Effect.flatMap((res) => Effect.map(res.text, (text) => ({status: res.status, text}))),
					Effect.scoped,
					Effect.timeout(timeout),
				);
			const call = (method: string, args: readonly unknown[]) =>
				Effect.gen(function* () {
					const token = yield* current;
					const first = yield* send(method, args, token);
					const res =
						first.status === 401 && renew !== null
							? yield* send(method, args, yield* renew(token))
							: first;
					if (res.status < 200 || res.status >= 300)
						return yield* Effect.fail(new Error(`the ledger answered ${res.status}: ${res.text}`));
					return yield* Effect.try(() => JSON.parse(res.text) as unknown);
				}).pipe(
					Effect.mapError(
						(e) =>
							new LedgerUnreachable({
								method,
								message:
									e instanceof DoorRefused
										? `the door gave no new session (${e.status}): ${e.why}`
										: e instanceof Error
											? e.message
											: String(e),
							}),
					),
				);
			// A doorbell refused may be an ended session: the door's `who` says, and a 401 renews.
			const door = doorOf(o);
			const lost = (used: Redacted.Redacted<string>) =>
				renew === null
					? Effect.void
					: door.who(used).pipe(
							Effect.catch((e) => (e.status === 401 ? renew(used) : Effect.void)),
							Effect.ignore,
						);
			const ws = o.url.replace(/^http/, "ws");
			const watch: Raw["watch"] = (stream) =>
				doorbell(`${ws}/${o.ledger}/tail?stream=${encodeURIComponent(stream)}`, current, lost);
			return fromRaw(rawOf(call, watch));
		}),
	).pipe(Layer.provide(clients(o.maxSockets ?? 8)));

/**
 * Calls to the jobs' records of a running ledger, through its door: `POST /<ledger>/job/<trace>`.
 * What `jobStorage` and `layerTraces` (./traces.ts) take. The door stamps each write.
 */
export const recordsHttp = (o: HttpOptions): Effect.Effect<RecordCalls, never, Scope.Scope> =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient;
		const timeout = o.timeout ?? Duration.seconds(3);
		const given = o.token;
		const current = Redacted.isRedacted(given) ? Effect.succeed(given) : given.current;
		const renew = Redacted.isRedacted(given) ? null : given.renew;
		const send = (trace: string, call: JobCall, token: Redacted.Redacted<string>) =>
			HttpClientRequest.post(`${o.url}/${o.ledger}/job/${trace}`).pipe(
				HttpClientRequest.bearerToken(token),
				HttpClientRequest.bodyJsonUnsafe(call),
				http.execute,
				Effect.flatMap((res) => Effect.map(res.text, (text) => ({status: res.status, text}))),
				Effect.scoped,
				Effect.timeout(timeout),
				// A record's own writes are no part of the job's trace: traced, every save and step
				// would come back to the record as a span of its own (25 of 31 in `seq --to 3 | tally`).
				Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
				Effect.provideService(HttpClient.TracerPropagationEnabled, false),
			);
		const calls: RecordCalls = (trace, call) =>
			Effect.gen(function* () {
				const token = yield* current;
				const first = yield* send(trace, call, token);
				const res =
					first.status === 401 && renew !== null
						? yield* send(trace, call, yield* renew(token))
						: first;
				if (res.status < 200 || res.status >= 300)
					return yield* Effect.fail(new Error(`the record answered ${res.status}: ${res.text}`));
				return yield* Effect.try(() => JSON.parse(res.text) as unknown);
			}).pipe(
				Effect.mapError(
					(e) => new StorageBroken({message: `the record of ${trace} (${call.op})`, cause: e}),
				),
			);
		return calls;
	}).pipe(Effect.provide(clients(o.maxSockets ?? 8)));

/** `Traces` over a running ledger's records, through its door. */
export const layerTracesHttp = (o: HttpOptions) =>
	Layer.unwrap(Effect.map(recordsHttp(o), layerTraces));

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

/**
 * A session the door gave: its token, who it is, and when it ends. Read from the wire only: its
 * encoding is refused, so no save or log through this schema writes the token's text.
 */
export const Session = Schema.Struct({
	token: Schema.RedactedFromValue(Schema.String, {disallowEncode: true}),
	who: Schema.Union([User, Agent]),
	expires: Schema.Number,
});
export type Session = typeof Session.Type;

/** A person on a shared ledger: their id (`github:<n>`), and the name they went by when they came. */
const Member = Schema.Struct({id: Schema.String, name: Schema.String});
const Members = Schema.Struct({members: Schema.Array(Member), invited: Schema.Array(Member)});
const Challenge = Schema.Struct({text: Schema.String});
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
		/**
		 * A person's login by `name` (on GitHub's keys, their login): this ledger's challenge, signed
		 * by the `Signer`, a key the ledger's keys service lists for them.
		 */
		login: (name: string) =>
			Effect.gen(function* () {
				const signer = yield* Signer;
				const text = yield* challenge;
				return yield* step(Session, "login", {
					name,
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
		invite: (token: Redacted.Redacted<string>, name: string) =>
			step(Member, "invite", {name}, token),
		remove: (token: Redacted.Redacted<string>, id: string) =>
			step(Schema.Struct({id: Schema.String}), "remove", {id}, token),
		/** On a local ledger: a token for one of the person's agents. */
		addAgent: (token: Redacted.Redacted<string>, name: string) =>
			step(Session, "agent", {name}, token),
		/** Where a move into this ledger stands (move.ts). */
		moveProgress: (token: Redacted.Redacted<string>) => step(Progress, "move", {}, token),
		/** One chunk of a move: the founder only, before the ledger opens. */
		importChunk: (token: Redacted.Redacted<string>, events: readonly Moved[]) =>
			step(Progress, "import", {events}, token),
		/** The move's seal: this ledger's own hash of what it holds must match `seal`. */
		seal: (token: Redacted.Redacted<string>, seal: Seal) => step(Progress, "seal", seal, token),
	};
};

// ---------------------------------------------------------------- a session that renews

/** A person's session that renews: what `layerHttp` sends as it is now, and after a 401. */
export interface Renewing {
	/** The token to send now. Fails once the door refused this person a new session. */
	readonly current: Effect.Effect<Redacted.Redacted<string>, DoorRefused>;
	/**
	 * The door said 401 to `stale`: a token to send again with. One login however many callers ask
	 * with the same stale token; one that was renewed already answers the newer token.
	 */
	readonly renew: (
		stale: Redacted.Redacted<string>,
	) => Effect.Effect<Redacted.Redacted<string>, DoorRefused>;
}

/**
 * How long before its end a session is renewed: 5 minutes, as AWS's and Google's SDKs refresh a
 * credential, or half of what is left when that is less.
 */
const EARLY_MS = 5 * 60_000;
/** Timed logins come at most once a minute, whatever the two clocks say. */
const LEAST_MS = 60_000;

/** The door said no to the person, so asking again cannot help: 401 or 403. */
const isFinal = (e: DoorRefused) => e.status === 401 || e.status === 403;

type Held =
	| {readonly kind: "live"; readonly session: Session}
	| {readonly kind: "refused"; readonly refused: DoorRefused};

/**
 * Keep `first` renewed with `login`, until the scope closes: again shortly before its end, and on
 * a 401 (`Renewing.renew`). A login the network failed leaves the old session in place, to try
 * again; one the door refused is kept, and `current` fails with it.
 */
export const renewing = (
	first: Session,
	login: Effect.Effect<Session, DoorRefused>,
): Effect.Effect<Renewing, never, Scope.Scope> =>
	Effect.gen(function* () {
		const held = yield* SynchronizedRef.make<Held>({kind: "live", session: first});
		/** A new session, unless the one held is no longer `stale`: under the lock, so once. */
		const renew = (stale: Redacted.Redacted<string>) =>
			SynchronizedRef.modifyEffect(
				held,
				(h): Effect.Effect<readonly [Exit.Exit<Redacted.Redacted<string>, DoorRefused>, Held]> => {
					if (h.kind === "refused") return Effect.succeed([Exit.fail(h.refused), h]);
					if (h.session.token !== stale) return Effect.succeed([Exit.succeed(h.session.token), h]);
					return login.pipe(
						Effect.map((s) => [Exit.succeed(s.token), {kind: "live", session: s}] as const),
						Effect.catch((e) => {
							const next: Held = isFinal(e) ? {kind: "refused", refused: e} : h;
							return Effect.succeed([Exit.fail(e), next] as const);
						}),
					);
				},
			).pipe(Effect.flatten);
		const ahead = Effect.gen(function* () {
			for (;;) {
				const h = yield* SynchronizedRef.get(held);
				if (h.kind === "refused") return;
				const left = h.session.expires - (yield* Clock.currentTimeMillis);
				yield* Effect.sleep(Math.max(LEAST_MS, left - Math.min(EARLY_MS, left / 2)));
				yield* Effect.ignore(renew(h.session.token));
			}
		});
		yield* Effect.forkScoped(ahead);
		return {
			current: Effect.flatMap(SynchronizedRef.get(held), (h) =>
				h.kind === "live" ? Effect.succeed(h.session.token) : Effect.fail(h.refused),
			),
			renew,
		};
	});
