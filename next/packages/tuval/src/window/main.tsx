// next/: page boot owns the run and socket scopes. React only reads and sends Msgs.
import { type EffectRun, run } from "@demlik/tea/effect";
import { useRuntime } from "@demlik/tea/react";
import { type AnyTile, ClientRow, Id, Sent, type WindowRegistration } from "@kampus/libfabrika";
import { ClientKey, type Identity } from "@kampus/libfabrika/transport/ClientKey";
import { ClientRows } from "@kampus/libfabrika/transport/ClientRows";
import { ClientSocket } from "@kampus/libfabrika/transport/ClientSocket";
import { helloText } from "@kampus/libfabrika/transport/Hello";
import { backoff, CAP } from "@kampus/libfabrika/transport/Link";
import { writeSshsig } from "@kampus/libfabrika/transport/Sshsig";
import { Button, useClipboard } from "@manti-ui/react";
import { Clock, DateTime, Deferred, Effect, Option, Queue, Random, Schema, Stream } from "effect";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { type WindowModel, type WindowMsg, type windowMachineFor, type write } from "./machine.ts";

type LiveWindow = EffectRun<WindowModel, WindowMsg>;
type TileWindow = WindowRegistration<any, ReactNode, AnyTile>;

type PageProps = {
  readonly run: LiveWindow;
  readonly origin: string;
  readonly windowFor: (name: string) => TileWindow | null;
};

const pickLink = (m: WindowModel) => m.link;
const pickTiles = (m: WindowModel) => m.tiles;

const refusalFor = (registration: TileWindow | null, refusal: WindowModel["tiles"][number]["refusal"]) => {
  if (refusal === null) {
    return null;
  }

  // Unknown free text never reaches the frame's fallback.
  const reason = /^[a-z_]{1,40}$/.test(refusal.reason) ? refusal.reason : "";
  return registration?.refused?.(refusal.m, reason) ?? (reason === "" ? "Not done." : `Not done (${reason}).`);
};

const Waiting = ({
  code,
  fingerprint,
  origin,
}: {
  readonly code: string;
  readonly fingerprint: string;
  readonly origin: string;
}) => {
  const command = `node next/apps/fabrika/grant.ts client ${origin} ${fingerprint} --code=${code} --key=<person-key-file>`;
  const clipboard = useClipboard({ value: command });
  return (
    <main className="screen" aria-labelledby="waiting-title">
      <h1 id="waiting-title">Let this window in</h1>
      <p>Run this on the computer that holds your person key. This window opens when it is granted.</p>
      <dl className="screen-facts">
        <dt>Code</dt>
        <dd data-testid="grant-code">{code}</dd>
        <dt>Window key</dt>
        <dd data-testid="fingerprint">{fingerprint}</dd>
      </dl>
      <div className="screen-command">
        <code data-testid="grant-command">{command}</code>
        <Button variant="secondary" size="sm" onClick={clipboard.copy}>
          {clipboard.copied ? "Copied" : "Copy command"}
        </Button>
      </div>
      <p>Waiting</p>
    </main>
  );
};

const Tile = ({
  run,
  id,
  windowFor,
}: {
  readonly run: LiveWindow;
  readonly id: string;
  readonly windowFor: PageProps["windowFor"];
}) => {
  const [tile, send] = useRuntime(run, (m) => m.tiles.find((t) => t.id === id));
  const [shown] = useRuntime(run, (m) => {
    const t = m.tiles.find((t) => t.id === id);
    return t?.last ? m.client.views[t.last] : undefined;
  });
  const [link] = useRuntime(run, pickLink);

  if (tile === undefined) {
    return null;
  }

  const registration = windowFor(tile.name);
  const data =
    registration && shown ? Option.getOrNull(Schema.decodeUnknownOption(registration.data)(shown.view)) : null;
  const offline = link._tag !== "online";
  const state = offline
    ? link._tag === "retrying"
      ? "Retrying"
      : "Connecting"
    : tile.reach._tag === "missing"
      ? "Missing"
      : tile.reach._tag === "open"
        ? "Online"
        : "Opening";
  const refusal = refusalFor(registration, tile.refusal);
  return (
    <section
      className={offline ? "tile disconnected" : "tile"}
      aria-label={tile.name}
      inert={offline || tile.reach._tag !== "open"}
    >
      <header className="titlebar">
        <span className="tile-mark" aria-hidden="true">
          ·
        </span>
        <span className="tile-name">{tile.name}</span>
        <span className="tile-state">{state}</span>
        <span className="tile-id">{tile.id}</span>
      </header>
      <div className="slot">
        {registration === null || data === null ? (
          <p>{tile.reach._tag === "missing" ? "Missing" : "Opening"}</p>
        ) : (
          <registration.View
            data={data}
            tile={tile.own}
            press={(m) => send({ type: "press", tile: tile.id, m, via: "button" })}
            send={(msg) => send({ type: "tile", id: tile.id, msg })}
            refusal={refusal}
          />
        )}
      </div>
    </section>
  );
};

const Page = (props: PageProps) => {
  const [link, send] = useRuntime(props.run, pickLink);
  const [tiles] = useRuntime(props.run, pickTiles);
  const [dials] = useRuntime(props.run, (m) => m.dials);
  const [views] = useRuntime(props.run, (m) => m.client.views);
  const [trouble] = useRuntime(props.run, (m) => m.trouble);
  const words = tiles
    .flatMap((t) => {
      const words = refusalFor(props.windowFor(t.name), t.refusal);
      return words ? [words] : [];
    })
    .join(" ");
  const content =
    link._tag === "waiting_grant" ? (
      <Waiting code={link.code} fingerprint={link.fingerprint} origin={props.origin} />
    ) : link._tag === "removed" ? (
      <main className="screen">
        <h1>Removed</h1>
        <p>This window was removed</p>
        <p>Ask again to make a new key and wait for a new grant.</p>
        <Button variant="primary" onClick={() => send({ type: "ask_again", dial: dials + 1 })}>
          Ask again
        </Button>
      </main>
    ) : link._tag === "blocked" ? (
      <main className="screen">
        <h1>Blocked</h1>
        <p>The browser could not keep or use this window's key. {link.reason}</p>
      </main>
    ) : link._tag !== "online" && Object.keys(views).length === 0 ? (
      <main className="screen">
        <p>Connecting</p>
      </main>
    ) : (
      <div className="frame">
        <header className="topbar">
          <span role="status">
            {link._tag === "online" ? "Online" : "Connection lost. Retrying."}
            {trouble ? ` ${trouble}` : ""}
          </span>
        </header>
        <main className="desk">
          {tiles.map((tile) => (
            <Tile key={tile.id} run={props.run} id={tile.id} windowFor={props.windowFor} />
          ))}
        </main>
      </div>
    );
  return (
    <>
      {content}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {words}
      </div>
      <div className="sr-only" role="alert" aria-atomic="true" />
    </>
  );
};

/** Mounting twice cannot start another runtime. Both mounts read the supplied run. */
export const mount = Effect.fn("Window.mount")(function* (element: HTMLElement, props: PageProps) {
  return yield* Effect.acquireRelease(
    Effect.sync(() => {
      const root = createRoot(element);
      root.render(
        <StrictMode>
          <Page {...props} />
        </StrictMode>,
      );
      return root;
    }),
    (root) => Effect.sync(() => root.unmount()),
  );
});

const RpcAnswer = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(
    Schema.Struct({ data: Schema.optionalKey(Schema.Struct({ reason: Schema.optionalKey(Schema.String) })) }),
  ),
});

const Notification = Schema.Struct({ method: Schema.String, params: Schema.optionalKey(Schema.Unknown) });
const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Union([RpcAnswer, Notification])));

const Admitted = Schema.Struct({
  version: Schema.Int,
  ping: Schema.Number,
  identity: Schema.Struct({ key: Schema.String, person: Schema.String, as: Schema.String }),
});

const WaitingCode = Schema.Struct({ code: Schema.String, until: Schema.Number });
const Nonce = Schema.Struct({ nonce: Schema.String });
const Opened = Schema.Struct({ rev: Schema.Int, view: Schema.Json });
const Entries = Schema.Struct({ entries: Schema.Array(Schema.Unknown) });
const ViewNotice = Schema.Struct({ pid: Schema.String, type: Schema.Literals(["whole", "patch"]) });

const Failure = Schema.TaggedUnion({
  unreachable: {},
  unknown: {},
  entropy: {},
  failed: {},
  unsupported: {},
  closed: {},
});

const F = Failure.cases;
type Write = ReturnType<typeof write>;

type Connection = {
  readonly write: (cmd: Write) => Effect.Effect<null, typeof F.unreachable.Type>;
  readonly text: (text: string) => boolean;
};

type WindowOptions = {
  readonly tiles: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly window: ReturnType<typeof windowMachineFor>;
  readonly build: string;
  readonly origin: string;
};

/** The retry timer already waited the backoff. Only the socket adds jitter. */
const dialWait = Effect.fn("Window.dialWait")(function* (tries: number) {
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

/** Runs every Cmd to hand-off; socket answers arrive separately as Msgs. */
export const startWindow = Effect.fn("Window.start")(function* (options: WindowOptions) {
  const keys = yield* ClientKey;
  const sockets = yield* ClientSocket;
  const rows = yield* ClientRows;
  const ids = yield* Id.Generator;
  const tab = yield* ids.next(Id.Tab).pipe(Effect.orDie);
  const sentAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const connections = new Map<number, Connection>();
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

  const socket = (dial: number, rejected: string | null, tries: number): Stream.Stream<WindowMsg> =>
    Stream.callback<WindowMsg>((queue) =>
      Effect.gen(function* () {
        const emit = (m: WindowMsg): void => {
          Queue.offerUnsafe(queue, m);
        };
        const key = yield* Deferred.await(identityFor(rejected));
        yield* dialWait(tries);
        const since = yield* Clock.currentTimeMillis;
        const url = `${options.origin.replace(/^http/, "ws")}/client/${encodeURIComponent(key.fingerprint)}/${encodeURIComponent(tab)}`;
        const ws = yield* sockets.dial(url).pipe(
          Effect.catchTag("ClientSocketError", () => {
            emit({ type: "closed", dial, code: 1006, fingerprint: key.fingerprint, ms: 0 });
            return Effect.never;
          }),
        );
        const written = new Map<number, { readonly call: Write["call"]["_tag"]; readonly at: number }>();
        const own = new Map<string, "initialize" | "knock">();
        let serial = 0;
        let started = since;
        const request = (method: "initialize" | "knock", params: unknown) => {
          const id = `s${++serial}`;
          own.set(id, method);
          return ws.send(
            JSON.stringify({ jsonrpc: "2.0", id, method: method === "knock" ? "gateway.knock" : method, params }),
          );
        };
        const hello = Effect.fnUntraced(function* (nonce: string) {
          const signed = yield* writeSshsig({
            text: helloText({ url: options.origin, tab, nonce }),
            space: "fabrika-client",
            line: key.line,
            sign: key.sign,
          });
          request("initialize", {
            versions: [1],
            has: [],
            ping: "5s",
            key: key.raw,
            tab,
            nonce,
            platform: "browser",
            os: "unknown",
            sentAt: yield* sentAt,
            signed,
          });
        });
        const work = yield* Queue.unbounded<Effect.Effect<void>>();
        yield* Effect.addFinalizer(() => Queue.shutdown(work));
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            connections.set(dial, {
              text: ws.send,
              write: Effect.fnUntraced(function* (cmd: Write) {
                const call = cmd.call;
                const message =
                  call._tag === "read"
                    ? { method: "ledger.read", params: { stream: call.stream, after: call.after } }
                    : call._tag === "open"
                      ? { method: "view.open", params: { pid: call.pid } }
                      : call._tag === "knock"
                        ? { method: "gateway.knock", params: { label: "Browser" } }
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
                written.set(cmd.id, { call: call._tag, at: yield* Clock.currentTimeMillis });

                if (!ws.send(JSON.stringify({ jsonrpc: "2.0", id: cmd.id, ...message }))) {
                  written.delete(cmd.id);
                  return yield* Effect.fail(F.unreachable.make({}));
                }

                return null;
              }),
            });
          }),
          () =>
            Effect.sync(() => {
              connections.delete(dial);
              written.clear();
              own.clear();
            }),
        );

        const answer = (id: number, frame: typeof RpcAnswer.Type, at: number): void => {
          const f = written.get(id);

          if (!f) {
            return;
          }

          const ms = Math.max(0, at - f.at);
          const on = { id, dial };

          if (frame.error) {
            written.delete(id);
            const reason = frame.error.data?.reason;
            const error =
              reason !== undefined && ["unreachable", "not_granted", "no_hello", "storage"].includes(reason)
                ? F.unreachable.make({})
                : F.unknown.make({});
            emit(
              f.call === "send"
                ? { type: "send_err", ...on, error }
                : f.call === "open"
                  ? { type: "open_err", ...on, error }
                  : f.call === "read"
                    ? { type: "read_err", ...on, error }
                    : { type: "knock_err", ...on, error },
            );
            return;
          }

          if (f.call === "send") {
            const sent = Option.getOrNull(Schema.decodeUnknownOption(Sent)(frame.result));

            if (sent) {
              written.delete(id);
              emit({ type: "send_ok", ...on, value: sent, ms });
            }
          } else if (f.call === "open") {
            const view = Option.getOrNull(Schema.decodeUnknownOption(Opened)(frame.result));

            if (view) {
              written.delete(id);
              emit({ type: "open_ok", ...on, value: view, ms });
            }
          } else if (f.call === "read") {
            const read = Option.getOrNull(Schema.decodeUnknownOption(Entries)(frame.result));

            if (read) {
              written.delete(id);
              emit({ type: "read_ok", ...on, value: read.entries, ms });
            }
          } else {
            const waiting = Option.getOrNull(Schema.decodeUnknownOption(WaitingCode)(frame.result));
            written.delete(id);

            if (waiting) {
              emit({
                type: "not_granted",
                dial,
                fingerprint: key.fingerprint,
                ...waiting,
                ms: Math.max(0, at - started),
              });
            }

            emit({ type: "knock_ok", ...on, value: null, ms });
          }
        };
        const message = (data: unknown, at: number): void => {
          if (data === "pong") {
            return emit({ type: "pong", dial });
          }

          const frame = Option.getOrNull(decodeFrame(data));

          if (frame === null) {
            return;
          }

          if ("id" in frame) {
            if (typeof frame.id === "number") {
              return answer(frame.id, frame, at);
            }

            const method = own.get(frame.id);

            if (!method) {
              return;
            }

            own.delete(frame.id);

            if (method === "initialize") {
              const admitted = Option.getOrNull(Schema.decodeUnknownOption(Admitted)(frame.result));

              if (admitted) {
                return emit({ type: "admitted", dial, ping: admitted.ping, ms: Math.max(0, at - started) });
              }

              if (frame.error?.data?.reason === "not_granted") {
                request("knock", { label: "Browser" });
              }
            } else {
              const waiting = Option.getOrNull(Schema.decodeUnknownOption(WaitingCode)(frame.result));

              if (waiting) {
                emit({
                  type: "not_granted",
                  dial,
                  fingerprint: key.fingerprint,
                  ...waiting,
                  ms: Math.max(0, at - started),
                });
              }
            }

            return;
          }

          if (frame.method === "challenge" || frame.method === "client.granted") {
            const nonce = Option.getOrNull(Schema.decodeUnknownOption(Nonce)(frame.params));

            if (!nonce) {
              return;
            }

            if (frame.method === "client.granted") {
              started = at;
              emit({ type: "granted", dial });
            }

            Queue.offerUnsafe(
              work,
              hello(nonce.nonce).pipe(
                Effect.catch((error) => Effect.sync(() => emit({ type: "blocked", reason: error.error }))),
              ),
            );
          } else if (frame.method === "gateway.waiting") {
            const waiting = Option.getOrNull(Schema.decodeUnknownOption(WaitingCode)(frame.params));

            if (waiting) {
              emit({
                type: "not_granted",
                dial,
                fingerprint: key.fingerprint,
                ...waiting,
                ms: Math.max(0, at - started),
              });
            }
          } else if (frame.method === "view.whole" || frame.method === "view.patch") {
            const notice = Option.getOrNull(Schema.decodeUnknownOption(ViewNotice)(frame.params));

            if (notice) {
              emit({ type: "view", pid: notice.pid, note: frame.params });
            }
          }
        };
        yield* Stream.fromQueue(work).pipe(
          Stream.runForEach((task) => task),
          Effect.forkScoped,
        );
        yield* ws.events.pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              const at = yield* Clock.currentTimeMillis;

              if (event.event === "message") {
                message(event.data, at);
              }

              if (event.event === "close") {
                emit({
                  type: "closed",
                  dial,
                  code: event.code,
                  fingerprint: key.fingerprint,
                  ms: Math.max(0, at - started),
                });
              }
            }),
          ),
          Effect.forkScoped,
        );
        return yield* Effect.never;
      }),
    );

  return yield* run(options.window, {
    ctx: { tiles: options.tiles },
    interpret: {
      key: Effect.fn("ClientKey.current")(function* (cmd) {
        const key = yield* keys.current(cmd.rejected);
        yield* Deferred.succeed(identityFor(cmd.rejected), key);
        return { found: key.found };
      }),
      now: Effect.fn("Client.now")(function* () {
        const letter = yield* ids.next(Id.Letter).pipe(Effect.mapError(() => F.entropy.make({})));
        return { letter, sentAt: yield* sentAt };
      }),
      write: Effect.fn("Client.write")(function* (cmd) {
        const connection = connections.get(cmd.dial);
        return connection ? yield* connection.write(cmd) : yield* Effect.fail(F.unreachable.make({}));
      }),
      ping: Effect.fn("Client.ping")(function* (cmd) {
        return connections.get(cmd.dial)?.text("ping") ? null : yield* Effect.fail(F.closed.make({}));
      }),
      persist: Effect.fn("Client.persist")(function* () {
        const claimed = yield* keys.claimPersist.pipe(Effect.mapError(() => F.failed.make({})));

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
          .pipe(Effect.mapError(() => F.failed.make({})));
        return null;
      }),
    },
    subscribe: { socket: (sub) => socket(sub.deps.dial, sub.deps.rejected, sub.deps.tries) },
  });
});
