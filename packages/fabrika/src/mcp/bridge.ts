import {
	asRng,
	type DurationRetryPolicy,
	initRetry,
	nextDelayMs,
	recordFailure,
	retryElapsedMs,
	shouldRetry,
	type TimedRetryState,
} from "@demlik/tea/retry-backoff";
import {
	type Cause,
	Clock,
	Data,
	Deferred,
	Duration,
	Effect,
	Fiber,
	Option,
	Queue,
	Random,
	Schema,
	Stdio,
	Stream,
} from "effect";
import {Ndjson} from "effect/encoding";
import {Socket} from "effect/socket";
import {AGENTS_PROTOCOL, HostAnswer, MAX_LINE} from "./handshake.ts";

// The stdio bridge: what an MCP client starts (`claude mcp add ... -- fabrika mcp --as claude`).
// It says the agent's handshake on the host's agents' socket, then passes each line of stdin to
// the socket and each line of the socket to stdout, as they are. It holds no MCP of its own: the
// host serves it (./serve.ts). Its own words go to stderr, never to stdout, which is the client's.
//
// It outlives the host (tracker 185b, PR 4). The window's restart and `fabrika connect` end the
// host; the client keeps this bridge, so the bridge dials again on the wait it is handed, and
// the client keeps its tools:
//
//   yield* bridge(NodeSocket.makeNet({path}), "claude", POLICY)   on Stdio, until stdin ends
//   // socket  {"type":"handshake","version":1,"agent":"claude"}
//   // host    {"type":"handshake","version":1}
//   // stdin   {"jsonrpc":"2.0","id":0,"method":"initialize",...}   on to the host, line by line
//   // the host ends
//   // stdin   {"jsonrpc":"2.0","id":2,"method":"tools/call",...}
//   // stdout  {"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"the host is restarting: ..."}}
//   // a new host listens: the handshake, then the client's initialize (id 0), as it said it
//   // host    {"jsonrpc":"2.0","id":0,"result":...}     dropped: the client had its answer
//   // socket  {"jsonrpc":"2.0","method":"notifications/initialized"}, as the client said it
//   // stdout  {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}
//
// What it does in the gap comes from the spec the installed SDK speaks (@modelcontextprotocol
// 2.4.0, LATEST_PROTOCOL_VERSION 2025-11-25, the era of an `initialize` first, as Claude Code
// sends). "Lifecycle" has a client send `initialize` once and `notifications/initialized` after
// its answer, so a new host hears both again, in that order, and the client is never answered
// twice. "Tools", Error Handling, puts a server's errors under protocol errors, a standard
// JSON-RPC error: a call while no host answers gets one at once, never silence, as a client that
// hears nothing waits out its timeout ("Lifecycle", Timeouts; the SDK's 60 s). It is never sent
// on to the next host: the client was answered. "Tools", List Changed Notification: a server
// that declared `listChanged` (./serve.ts does) SHOULD say when its tools change, and a new host
// may serve other tools, the read-only door or the other way.
//
// It answers only ids the client sent, and passes on only answers to ids the other side sent on
// this connection. No platform is named: the socket and Stdio are Effect's, which the app's
// command makes on Node.

/** The host refused the bridge, went before its handshake, or did not come back within the wait. */
export class BridgeStopped extends Schema.TaggedError<BridgeStopped>()("BridgeStopped", {
	why: Schema.String,
}) {}

/**
 * The code of the error a call gets while no host answers: -32000, the first of JSON-RPC 2.0's
 * own range for a server's errors (-32000 to -32099, "reserved for implementation-defined
 * server-errors"). MCP 2025-11-25 takes none of the range for itself (its own codes are -32002
 * and -32042), and the MCP SDK's first version said "connection closed" with this same code.
 */
const RESTARTING = -32000;

/** What a call in the gap is told: it never reached a host. */
const NOT_SENT = "the host is restarting: this call did not reach it. Call again in a moment.";
/** What a call is told that the host had when it ended: it may have run. */
const LOST = "the host is restarting: it ended before it answered, so this call may have run.";

const LIST_CHANGED = {jsonrpc: "2.0", method: "notifications/tools/list_changed"};

/** The socket closed cleanly: the host closed it. */
const CLOSED = "the host closed the socket";

/**
 * Why a socket ended, in words. Effect's socket (effect 4.1.1, `Socket.ts`) never ends a read
 * cleanly: "every termination, clean close included, fails with a `SocketError` wrapping the
 * close reason", and "consumers that treat a close as normal catch it". A clean close is
 * `SocketCloseError` with code 1000, the code its reader gives when the stream ends, so that one
 * is the host closing the socket. Anything else is the socket's own error.
 */
const endedWhy = (e: Socket.SocketError): string =>
	e.reason._tag === "SocketCloseError" && e.reason.code === 1000
		? CLOSED
		: `the socket ended: ${e.message}`;

const Id = Schema.Union([Schema.String, Schema.Number]);
type Id = typeof Id.Type;

/** A JSON-RPC message, as far as the bridge reads it: a request has both, an answer only `id`. */
const Envelope = Schema.Struct({
	id: Schema.optionalKey(Schema.NullOr(Id)),
	method: Schema.optionalKey(Schema.String),
});
type Envelope = typeof Envelope.Type;
const decodeEnvelope = Schema.decodeUnknownOption(Envelope);
const envelope = (line: unknown): Envelope => Option.getOrElse(decodeEnvelope(line), () => ({}));

/** The id of a request, which waits for an answer; `null` for anything else. */
const askedId = (m: Envelope): Id | null =>
	m.method !== undefined && m.id !== undefined && m.id !== null ? m.id : null;

/** The id an answer is to; `null` for anything else. */
const answeredId = (m: Envelope): Id | null =>
	m.method === undefined && m.id !== undefined && m.id !== null ? m.id : null;

const InitError = Schema.Struct({error: Schema.Struct({message: Schema.String})});
const decodeInitError = Schema.decodeUnknownOption(InitError);

const decodeAnswer = Schema.decodeUnknownOption(HostAnswer);

/** A call answered at once, as a JSON-RPC error: the host is restarting. */
const restarting = (id: Id, message: string) => ({
	jsonrpc: "2.0",
	id,
	error: {code: RESTARTING, message},
});

/** One connection to a host: the lines for it, and each side's requests not answered on it yet. */
interface Conn {
	readonly toHost: Queue.Queue<unknown, Cause.Done>;
	/** The client's requests the host has not answered. */
	readonly clientAsked: Set<Id>;
	/** The host's requests the client has not answered. */
	readonly hostAsked: Set<Id>;
}

/** Where the bridge's link to a host is. */
type Link = Data.TaggedEnum<{
	/** The first host, before its handshake: the client's lines wait in its queue, as always. */
	Opening: {readonly conn: Conn};
	/** A host answers: lines pass both ways. */
	Open: {readonly conn: Conn};
	/** No host answers, since `streak`'s first failure: a request is told the host is restarting. */
	Reconnecting: {readonly streak: TimedRetryState};
	/**
	 * A new host said its handshake and was sent the client's `initialize` again. Until it answers,
	 * the client's lines wait in `queued`. It is still a try of `streak`: a host that ends before it
	 * answers is one more failure, so a build that crashes in its start never begins a fresh streak
	 * (tracker 220).
	 */
	Replaying: {readonly conn: Conn; readonly queued: unknown[]; readonly streak: TimedRetryState};
}>;

const Link = Data.taggedEnum<Link>();

/**
 * Bridge stdin and stdout to a host, as agent `agent`. `dial` opens a socket to the host, once at
 * the start and again each time it ends; between tries the bridge waits as `wait` says, and past
 * its `maxElapsedMs` it stops. The library names no number of its own: the app hands it its own.
 */
export const bridge = (
	dial: Effect.Effect<Socket.Socket, Socket.SocketError>,
	agent: string,
	wait: DurationRetryPolicy,
) =>
	Effect.gen(function* () {
		const stdio = yield* Stdio.Stdio;
		const toClient = yield* Queue.make<unknown, Cause.Done>();
		const stdinEnded = yield* Deferred.make<void>();
		/** The client's opening, kept to say again to each new host. */
		const kept: {
			initialize: {readonly id: Id; readonly line: unknown} | null;
			initialized: unknown;
		} = {initialize: null, initialized: null};

		const freshConn = Effect.gen(function* () {
			const toHost = yield* Queue.make<unknown, Cause.Done>();
			Queue.offerUnsafe(toHost, {type: "handshake", version: AGENTS_PROTOCOL, agent});
			const conn: Conn = {toHost, clientAsked: new Set(), hostAsked: new Set()};
			return conn;
		});
		let current = yield* freshConn;
		let link: Link = Link.Opening({conn: current});
		let over = false;

		/** A client's line on to the host, keeping what each side asked. */
		const toHost = (conn: Conn, line: unknown) => {
			const m = envelope(line);
			const asked = askedId(m);

			if (asked !== null) {
				conn.clientAsked.add(asked);
			}

			const answered = answeredId(m);

			// An answer to a request of a host that is gone: no host on this connection asked it.
			if (answered !== null && !conn.hostAsked.delete(answered)) {
				return;
			}

			Queue.offerUnsafe(conn.toHost, line);
		};

		const fromClient = (line: unknown) => {
			const m = envelope(line);
			const asked = askedId(m);

			if (m.method === "initialize" && asked !== null && kept.initialize === null) {
				kept.initialize = {id: asked, line};
			}

			if (m.method === "notifications/initialized" && kept.initialized === null) {
				kept.initialized = line;
			}

			switch (link._tag) {
				case "Opening":
				case "Open":
					return toHost(link.conn, line);
				case "Replaying":
					// Not pinned by a test: a line after the new host's handshake, before it answered the
					// replayed initialize. It waits, and goes once the host is ready for it.
					link.queued.push(line);
					return;
				case "Reconnecting":
					if (asked !== null) {
						Queue.offerUnsafe(toClient, restarting(asked, NOT_SENT));
					}

					return;
			}
		};

		/** A host's line on to the client, keeping what each side asked. */
		const toClientFrom = (conn: Conn, line: unknown) => {
			const m = envelope(line);
			const answered = answeredId(m);

			// Only an answer to an id the client sent on this connection reaches it.
			if (answered !== null && !conn.clientAsked.delete(answered)) {
				return;
			}

			const asked = askedId(m);

			if (asked !== null) {
				conn.hostAsked.add(asked);
			}

			Queue.offerUnsafe(toClient, line);
		};

		const fromHost = (conn: Conn, line: unknown): Effect.Effect<void, BridgeStopped> => {
			const replayed = kept.initialize;

			if (
				link._tag !== "Replaying" ||
				replayed === null ||
				answeredId(envelope(line)) !== replayed.id
			) {
				return Effect.sync(() => toClientFrom(conn, line));
			}

			// The new host's answer to the client's initialize: the client had its own, so it goes no
			// further. One that refuses leaves the client nothing to go on with.
			const refused = decodeInitError(line);

			if (refused._tag === "Some") {
				return Effect.fail(
					new BridgeStopped({
						why: `the new host refused the client's initialize: ${refused.value.error.message}`,
					}),
				);
			}

			const {queued} = link;

			if (kept.initialized !== null) {
				Queue.offerUnsafe(conn.toHost, kept.initialized);
			}

			Queue.offerUnsafe(toClient, LIST_CHANGED);
			link = Link.Open({conn});

			for (const waiting of queued) {
				fromClient(waiting);
			}

			return Effect.void;
		};

		/** The host's handshake answer on `conn`, its first line. */
		const shake = (conn: Conn, line: unknown) =>
			Effect.gen(function* () {
				const answer = decodeAnswer(line);

				if (answer._tag === "None") {
					return yield* new BridgeStopped({why: "the host sent no handshake"});
				}

				if (answer.value.type === "refused") {
					return yield* new BridgeStopped({why: answer.value.why});
				}

				if (link._tag === "Opening") {
					link = Link.Open({conn});
					return;
				}

				if (link._tag !== "Reconnecting") {
					return;
				}

				const now = yield* Clock.currentTimeMillis;
				yield* Effect.logInfo("host_back").pipe(
					Effect.annotateLogs({
						agent,
						after_ms: retryElapsedMs(link.streak, now),
						tries: link.streak.attempt,
					}),
				);

				if (kept.initialize === null) {
					// A client that sent no initialize (2026-07-28) has nothing to say again.
					link = Link.Open({conn});
					Queue.offerUnsafe(toClient, LIST_CHANGED);
					return;
				}

				link = Link.Replaying({conn, queued: [], streak: link.streak});
				Queue.offerUnsafe(conn.toHost, kept.initialize.line);
			});

		/** Run one connection until its socket ends: why it ended. */
		const run = (conn: Conn) => {
			let shook = false;
			return dial.pipe(
				Effect.flatMap((socket) =>
					Stream.fromQueue(conn.toHost).pipe(
						Stream.pipeThroughChannel(
							Ndjson.duplex({maxLineBytes: MAX_LINE})(Socket.toChannel(socket)),
						),
						Stream.runForEach((line) => {
							if (shook) {
								return fromHost(conn, line);
							}

							shook = true;
							return shake(conn, line);
						}),
					),
				),
				Effect.as(CLOSED),
				Effect.catchTag("SocketError", (e) => Effect.succeed(endedWhy(e))),
				Effect.catchTag("NdjsonError", (e) =>
					Effect.fail(new BridgeStopped({why: `a line that does not read: ${e.message}`})),
				),
			);
		};

		/**
		 * The socket ended, `why`: every call it held and every line waiting is answered, and the
		 * streak of failed tries goes on, or begins. It begins only after a host that was `Open`: one
		 * that went while `Replaying` never answered the replayed initialize, so its try failed too.
		 * The first host, gone before its handshake, ends the bridge, as it always did: there was
		 * never a host to outlive.
		 */
		const ended = (why: string, now: number): Effect.Effect<TimedRetryState, BridgeStopped> => {
			switch (link._tag) {
				case "Opening":
					return Effect.fail(
						new BridgeStopped({
							why: why === CLOSED ? "the host closed the socket before its handshake" : why,
						}),
					);
				case "Reconnecting":
					return Effect.succeed(recordFailure(link.streak, why, now));
				case "Open":
				case "Replaying": {
					for (const id of link.conn.clientAsked) {
						Queue.offerUnsafe(toClient, restarting(id, LOST));
					}

					if (link._tag === "Replaying") {
						for (const waiting of link.queued) {
							const asked = askedId(envelope(waiting));

							if (asked !== null) {
								Queue.offerUnsafe(toClient, restarting(asked, NOT_SENT));
							}
						}
					}

					return Effect.logInfo("host_lost").pipe(
						Effect.annotateLogs({agent, why}),
						Effect.as(
							recordFailure(link._tag === "Replaying" ? link.streak : initRetry(), why, now),
						),
					);
				}
			}
		};

		const writer = yield* Stream.fromQueue(toClient).pipe(
			Stream.map((line) => `${JSON.stringify(line)}\n`),
			Stream.run(stdio.stdout({endOnDone: false})),
			Effect.forkScoped,
		);

		// stdin, line by line. Its end is the bridge's end.
		yield* stdio.stdin.pipe(
			Stream.pipeThroughChannel(Ndjson.decode({ignoreEmptyLines: true, maxLineBytes: MAX_LINE})),
			Stream.runForEach((line) => Effect.sync(() => fromClient(line))),
			Effect.ignore,
			Effect.ensuring(
				Effect.sync(() => {
					over = true;
					Queue.endUnsafe(current.toHost);
				}),
			),
			Effect.ensuring(Deferred.succeed(stdinEnded, undefined)),
			Effect.forkScoped,
		);

		while (true) {
			const why = yield* run(current);

			if (over) {
				if (link._tag === "Opening") {
					return yield* new BridgeStopped({why: "the host closed the socket before its handshake"});
				}

				break;
			}

			const now = yield* Clock.currentTimeMillis;
			const streak = yield* ended(why, now);
			link = Link.Reconnecting({streak});

			if (!shouldRetry(streak, wait, now)) {
				return yield* new BridgeStopped({
					why: `the host did not come back within ${Duration.format(Duration.millis(wait.maxElapsedMs))}: ${why}`,
				});
			}

			const pick = yield* Random.next;
			yield* Effect.sleep(
				Duration.millis(
					nextDelayMs(
						streak,
						wait,
						asRng(() => pick),
					),
				),
			).pipe(Effect.raceFirst(Deferred.await(stdinEnded)));

			if (over) {
				break;
			}

			current = yield* freshConn;
		}

		Queue.endUnsafe(toClient);
		yield* Fiber.join(writer);
	}).pipe(Effect.scoped);
