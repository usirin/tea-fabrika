/**
 * The start of a window client: it boots the window parent on tea's Effect engine and does its
 * input and output. Each Cmd becomes a write on its dial's socket or a call to a service, and each
 * socket event becomes a Msg. It decides nothing: the parent's Model says which dial is current.
 * The same start runs in a browser tab and in a program with no DOM.
 *
 * @stability unstable
 */
import { run } from "@demlik/tea/effect";
import { Clock, DateTime, Deferred, Effect, Option, Predicate, Queue, Random, Schema, Stream } from "effect";
import { Socket } from "effect/socket";
import * as Id from "../Id.ts";
import { ClientKey, type Identity } from "../transport/ClientKey.ts";
import { ClientRow, ClientRows, ErrorClass } from "../transport/ClientRows.ts";
import { helloText } from "../transport/Hello.ts";
import { backoff, CAP } from "../transport/Link.ts";
import { writeSshsig } from "../transport/Sshsig.ts";
import { Hello } from "../transport/Wire.ts";
import type { WindowMsg, windowMachineFor, write } from "./WindowMachine.ts";

/**
 * Schema for the facts a client states about itself: the hello's `platform`, `os` and `has`, and
 * the `label` its knock shows the person who grants it.
 *
 * @stability unstable
 * @category models
 */
export const ClientInfo = Schema.Struct({
  platform: Hello.fields.platform,
  os: Hello.fields.os,
  has: Hello.fields.has,
  label: Schema.String,
});

/**
 * What a start is given: the tiles to show, the window parent, the brain's origin, the build that
 * runs and the client's own facts. Plain data and the machine, so any client can pass it.
 *
 * @stability unstable
 * @category models
 */
export type StartOptions = {
  readonly tiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly window: ReturnType<typeof windowMachineFor>;
  readonly origin: string;
  readonly build: string;
  readonly client: typeof ClientInfo.Type;
};

const Failure = Schema.TaggedUnion({
  unreachable: {},
  unknown: {},
  entropy: {},
  failed: {},
  unsupported: {},
  closed: {},
  key: { error: ErrorClass },
});

const F = Failure.cases;
type Write = ReturnType<typeof write>;

/** One dial's open socket: its writer, the key it dialed with, and when each call id was written. */
type Handle = {
  readonly writer: Socket.Writer;
  readonly key: Identity;
  readonly written: Map<number, number>;
};

/** The id of a frame that answers a call, read only to time the answer. */
const answerId = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ id: Schema.Number })));

/** The class of a socket that failed to open: the thrown error's own class, or a network failure. */
const openFailure = (error: Socket.SocketError): ErrorClass => {
  const reason = error.reason;

  if (reason._tag === "SocketOpenError" && reason.kind === "Timeout") {
    return "TimeoutError";
  }

  const cause = "cause" in reason ? reason.cause : undefined;
  const name = Predicate.hasProperty(cause, "name") ? cause.name : null;
  return Schema.is(ErrorClass)(name) ? name : "NetworkError";
};

/** The close code a reader's failure carries, or 1006 when the socket ended without one. */
const closeCode = (error: Socket.SocketError): number =>
  error.reason._tag === "SocketCloseError" ? error.reason.code : 1006;

/** One socket for `url`, from the platform's constructor. A throwing constructor is an open failure. */
const acquire = (make: Socket.WebSocketConstructor["Service"], url: string) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => make(url),
      catch: (cause) => new Socket.SocketError({ reason: new Socket.SocketOpenError({ kind: "Unknown", cause }) }),
    }),
    (ws) => Effect.sync(() => ws.close(1000)),
  );

/** The retry timer already waited the backoff. Only the socket adds jitter. */
const dialWait = Effect.fn("WindowStart.dialWait")(function* (tries: number) {
  if (tries === 0) {
    return;
  }

  const base = backoff(tries);
  const bound = Math.min(1000, base / 2, CAP - base);

  if (bound > 0) {
    const ms = yield* Random.nextIntBetween(0, bound);
    yield* Effect.sleep(ms);
  }
});

/**
 * Boots a window parent and runs every Cmd to hand-off; the door's answers arrive as Msgs.
 *
 * **Details**
 *
 * It needs `ClientKey`, `ClientRows`, `Id.Generator`, `Socket.WebSocketConstructor` and a `Scope`:
 * closing the scope stops the run, its sockets, its timers and every Sub. Each dial the Link asks
 * for is one constructor call, one reader and one writer in the dial's own scope. The start never
 * dials again by itself: reconnects are the Link machine's. A write, a ping or a hello for a dial
 * with no open socket fails at once.
 *
 * @stability unstable
 * @category constructors
 */
export const start = Effect.fn("WindowStart.start")(function* (options: StartOptions) {
  const keys = yield* ClientKey;
  const rows = yield* ClientRows;
  const sockets = yield* Socket.WebSocketConstructor;
  const ids = yield* Id.Generator;
  const tab = yield* ids.next(Id.Tab).pipe(Effect.orDie);
  const sentAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const handles = new Map<number, Handle>();
  const identities = new Map<string | null, Deferred.Deferred<Identity>>();
  const identityFor = (rejected: string | null) => {
    const found = identities.get(rejected);

    if (found) {
      return found;
    }

    const waiting = Deferred.makeUnsafe<Identity>();
    identities.set(rejected, waiting);
    return waiting;
  };

  /** Writes one text on the dial's open socket, or fails at once when it has none. */
  const send = (dial: number, text: string): Effect.Effect<void, "none" | Socket.SocketError> =>
    Effect.suspend((): Effect.Effect<void, "none" | Socket.SocketError> => {
      const handle = handles.get(dial);
      return handle === undefined ? Effect.fail("none" as const) : handle.writer.write(text);
    });

  const socket = (dial: number, rejected: string | null, tries: number): Stream.Stream<WindowMsg> =>
    Stream.callback<WindowMsg>((queue) =>
      Effect.gen(function* () {
        const emit = (m: WindowMsg): void => {
          Queue.offerUnsafe(queue, m);
        };
        const key = yield* Deferred.await(identityFor(rejected));
        yield* dialWait(tries);
        const url = `${options.origin.replace(/^http/, "ws")}/client/${encodeURIComponent(key.fingerprint)}/${encodeURIComponent(tab)}`;
        const connection = yield* Socket.fromWebSocket(acquire(sockets, url));
        const pull = yield* Socket.readerString(connection).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const at = yield* Clock.currentTimeMillis;

              if (error.reason._tag !== "SocketCloseError") {
                emit({ type: "socket_failure", dial, op: "connect", error: openFailure(error) });
              }

              emit({ type: "socket_closed", dial, code: closeCode(error), at });
              return yield* Effect.never;
            }),
          ),
        );
        const writer = yield* connection.writer;
        const written = new Map<number, number>();
        yield* Effect.acquireRelease(
          Effect.sync(() => handles.set(dial, { writer, key, written })),
          () => Effect.sync(() => handles.delete(dial)),
        );
        emit({ type: "socket_opened", dial, at: yield* Clock.currentTimeMillis });
        return yield* pull.pipe(
          Effect.flatMap((texts) =>
            Effect.map(Clock.currentTimeMillis, (at) => {
              for (const text of texts) {
                // A call's write time lives until its answer comes, so the map only holds calls in
                // flight.
                const sent = Option.flatMap(answerId(text), ({ id }) => {
                  const at = Option.fromUndefinedOr(written.get(id));
                  written.delete(id);
                  return at;
                });
                emit({
                  type: "frame",
                  dial,
                  text,
                  at,
                  ...Option.match(sent, { onNone: () => ({}), onSome: (t) => ({ ms: Math.max(0, at - t) }) }),
                });
              }
            }),
          ),
          Effect.forever,
          Effect.catch((error) =>
            Effect.gen(function* () {
              handles.delete(dial);
              emit({ type: "socket_closed", dial, code: closeCode(error), at: yield* Clock.currentTimeMillis });
              return yield* Effect.never;
            }),
          ),
        );
      }),
    );

  return yield* run(options.window, {
    ctx: { tiles: options.tiles },
    interpret: {
      key: Effect.fn("ClientKey.current")(function* (cmd) {
        const key = yield* keys.current(cmd.rejected).pipe(Effect.mapError((error) => ({ ...error })));
        yield* Deferred.succeed(identityFor(cmd.rejected), key);
        return { found: key.found, fingerprint: key.fingerprint };
      }),
      now: Effect.fn("Client.now")(function* () {
        const letter = yield* ids.next(Id.Letter).pipe(Effect.mapError(() => F.entropy.make({})));
        return { letter, sentAt: yield* sentAt };
      }),
      write: Effect.fn("Client.write")(function* (cmd: Write) {
        const call = cmd.call;
        const message =
          call._tag === "read"
            ? { method: "ledger.read", params: { stream: call.stream, after: call.after } }
            : call._tag === "open"
              ? { method: "view.open", params: { pid: call.pid } }
              : call._tag === "knock"
                ? { method: "gateway.knock", params: { label: options.client.label } }
                : {
                    method: "process.send",
                    params: {
                      pid: call.pid,
                      letter: call.letter,
                      m: call.m,
                      sentAt: call.sentAt,
                      seen: call.seen,
                      ...(call.traceId ? { traceId: call.traceId } : {}),
                    },
                  };
        const written = handles.get(cmd.dial)?.written;
        written?.set(cmd.id, yield* Clock.currentTimeMillis);
        yield* send(cmd.dial, JSON.stringify({ jsonrpc: "2.0", id: cmd.id, ...message })).pipe(
          Effect.mapError(() => {
            written?.delete(cmd.id);
            return F.unreachable.make({});
          }),
        );
        return null;
      }),
      ping: Effect.fn("Client.ping")(function* (cmd) {
        yield* send(cmd.dial, "ping").pipe(Effect.mapError(() => F.closed.make({})));
        return null;
      }),
      hello: Effect.fn("Client.hello")(function* (cmd) {
        const handle = handles.get(cmd.dial);

        if (handle === undefined) {
          return yield* Effect.fail(F.closed.make({}));
        }

        const signed = yield* writeSshsig({
          text: helloText({ url: options.origin, tab, nonce: cmd.nonce }),
          space: "fabrika-client",
          line: handle.key.line,
          sign: handle.key.sign,
        }).pipe(Effect.mapError((error) => F.key.make({ error: error.error })));
        const params = {
          versions: [1],
          has: options.client.has,
          ping: "5s",
          key: handle.key.raw,
          tab,
          nonce: cmd.nonce,
          platform: options.client.platform,
          os: options.client.os,
          sentAt: yield* sentAt,
          signed,
        };
        yield* send(cmd.dial, JSON.stringify({ jsonrpc: "2.0", id: cmd.id, method: "initialize", params })).pipe(
          Effect.mapError(() => F.closed.make({})),
        );
        return null;
      }),
      enroll: Effect.fn("Client.enroll")(function* (cmd) {
        const knock = { jsonrpc: "2.0", id: cmd.id, method: "gateway.knock", params: { label: options.client.label } };
        yield* send(cmd.dial, JSON.stringify(knock)).pipe(Effect.mapError(() => F.closed.make({})));
        return null;
      }),
      persist: Effect.fn("Client.persist")(function* () {
        const claimed = yield* keys.claimPersist.pipe(Effect.mapError((error) => ({ ...error })));

        if (!claimed) {
          return false;
        }

        return yield* keys.persist.pipe(
          Effect.mapError((error) => (error === "unsupported" ? F.unsupported.make({}) : F.failed.make({}))),
        );
      }),
      record: Effect.fn("ClientRows.record")(function* (cmd) {
        const id = yield* ids.next(Id.Entry).pipe(Effect.mapError(() => F.failed.make({})));
        yield* rows
          .put(ClientRow.make({ id, tab, build: options.build, sentAt: yield* sentAt, record: cmd.record }))
          .pipe(Effect.mapError((error) => ({ ...error })));
        return null;
      }),
    },
    subscribe: { socket: (sub) => socket(sub.deps.dial, sub.deps.rejected, sub.deps.tries) },
  });
});
