// The window's React view and its boot, next/ (Tier 1, P14). The view reads the live run through
// tea's own hook and sends Msgs; it holds no state of its own and reads no clock. The run is booted
// outside React (`startWindow`, below), so Strict Mode's second mount starts nothing. Each reader
// picks an existing part of the model.
//
// The screens are the link's states: a waiting screen with the one next action (the grant command),
// the removed and blocked screens, and the desk. The desk folds the fixed layout to this tab's own
// size; the frame says, once, how the link is and how many presses wait.
import { type EffectRun, run } from "@demlik/tea/effect";
import { useRuntime } from "@demlik/tea/react";
import { ClientRow, Id, Keys, ProgramClient, Sent, type WindowRegistration } from "@kampus/libfabrika";
import {
  ClientKey,
  ClientRows,
  ClientSocket,
  helloText,
  type Identity,
  writeSshsig,
} from "@kampus/libfabrika/transport";
import { Button, useClipboard } from "@manti-ui/react";
import { Clock, DateTime, Deferred, Effect, Option, Queue, Result, Schema, type Scope, Stream } from "effect";
import { type ReactNode, StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { keyEvent } from "../desktop/keys.ts";
import { fold, type Layout, tilesIn } from "../desktop/layout.ts";
import {
  type WindowChecks,
  type WindowCtx,
  windowMachineFor,
  type WindowModel,
  type WindowMsg,
  type write,
} from "./machine.ts";

/** The live window run, as `startWindow` booted it. */
export type LiveWindow = EffectRun<WindowModel, WindowMsg>;

/** What draws one tile: its program's registered window. */
export type TileWindow = WindowRegistration<any, ReactNode>;

export type WindowProps = {
  readonly run: LiveWindow;
  /** The brain's origin, which the grant command names. */
  readonly origin: string;
  readonly layout: Layout;
  /** The registered window for a tile's process name, or null when none is registered. */
  readonly windowFor: (pid: string) => TileWindow | null;
};

const pickLink = (m: WindowModel) => m.link;
const pickViews = (m: WindowModel) => m.client.views;
const pickQueue = (m: WindowModel) => m.client.pending.length;
const pickTrouble = (m: WindowModel) => m.trouble;
const pickKeyError = (m: WindowModel) => m.keyError;
const pickSettings = (m: WindowModel) => m.settings;
const pickKeys = (m: WindowModel) => m.keys;
const pickFocus = (m: WindowModel) => m.focus;
const pickSize = (m: WindowModel) => m.size;
const pickDials = (m: WindowModel) => m.dials;
const pickFingerprint = (m: WindowModel) => m.rejected;

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
      <h1 id="waiting-title" className="screen-title">
        Let this window in
      </h1>
      <p className="screen-text">
        Run this on the computer that holds your person key. The window opens by itself once it is granted.
      </p>
      <div className="screen-command">
        <code data-testid="grant-command">{command}</code>
        <Button variant="secondary" size="sm" onClick={clipboard.copy}>
          {clipboard.copied ? "Copied" : "Copy command"}
        </Button>
      </div>
      <dl className="screen-facts">
        <dt>Code</dt>
        <dd data-testid="grant-code">{code}</dd>
        <dt>Window key</dt>
        <dd data-testid="fingerprint">{fingerprint}</dd>
      </dl>
      <p className="screen-quiet" role="status">
        Waiting for the grant
      </p>
    </main>
  );
};

const Removed = ({ run }: { readonly run: LiveWindow }) => {
  const [dials, send] = useRuntime(run, pickDials);
  const [rejected] = useRuntime(run, pickFingerprint);
  return (
    <main className="screen" aria-labelledby="removed-title">
      <h1 id="removed-title" className="screen-title">
        This window was removed
      </h1>
      <p className="screen-text">
        Its key {rejected === null ? "" : <code>{rejected}</code>} is no longer let in, so it stops reconnecting. Ask
        again to make a new key and wait for a new grant.
      </p>
      <div className="screen-command">
        <Button variant="primary" size="sm" onClick={() => send({ type: "ask_again", dial: dials + 1 })}>
          Ask again
        </Button>
      </div>
    </main>
  );
};

const Blocked = ({ reason }: { readonly reason: string }) => (
  <main className="screen" role="alert" aria-labelledby="blocked-title">
    <h1 id="blocked-title" className="screen-title">
      This window is blocked
    </h1>
    <p className="screen-text">
      {reason === "key_store"
        ? "The browser refused to keep this window's key, so it cannot sign in. Allow this site's storage, then reload."
        : `It cannot go on: ${reason}.`}
    </p>
  </main>
);

const Connecting = () => (
  <main className="screen" aria-labelledby="connecting-title">
    <h1 id="connecting-title" className="screen-quiet" role="status">
      Connecting to fabrika
    </h1>
  </main>
);

const Tile = ({
  run,
  tile,
  window,
  at,
  focused,
}: {
  readonly run: LiveWindow;
  readonly tile: { readonly id: string; readonly pid: string };
  readonly window: TileWindow | null;
  readonly at: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly focused: boolean;
}) => {
  const [shown, send] = useRuntime(run, (m) => m.client.views[tile.pid]);
  const [keys] = useRuntime(run, pickKeys);
  // The machine installed only a view the registration's schema passed; this decode gives it its type.
  const data =
    window === null || shown === undefined
      ? null
      : Option.getOrNull(Schema.decodeUnknownOption(window.data)(shown.view));
  const program = tile.pid.split(":")[0] ?? tile.pid;
  const name = `${tile.pid} · ${tile.id}`;
  return (
    <section
      className={focused ? "tile focused" : "tile"}
      aria-label={name}
      style={{ left: at.x, top: at.y, width: at.w, height: at.h }}
      onFocus={() => send({ type: "focus", tile: tile.id })}
      onPointerDown={() => send({ type: "focus", tile: tile.id })}
    >
      <header className="titlebar">
        <span>{program}</span>
        <span className="tid">{tile.pid}</span>
      </header>
      <div className="slot">
        {window === null || data === null ? (
          <p className="screen-quiet">Opening</p>
        ) : (
          <window.View
            data={data}
            press={(m) => send({ type: "press", pid: tile.pid, m, via: "button" })}
            hint={(command) => Keys.hintFor(keys, command)}
          />
        )}
      </div>
    </section>
  );
};

const Desk = ({ run, layout, windowFor }: WindowProps) => {
  const [focus, send] = useRuntime(run, pickFocus);
  const [size] = useRuntime(run, pickSize);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = area.current;

    if (element === null) {
      return;
    }

    const measure = () => send({ type: "resized", w: element.clientWidth, h: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [send]);
  const tiles = tilesIn(layout);
  const folded = size === null ? { shown: [], folded: [] } : fold(layout, size, focus);
  return (
    <div className="desk" ref={area}>
      {folded.shown.map((rect) => {
        const tile = tiles.find((t) => t.id === rect.id);
        return tile === undefined ? null : (
          <Tile
            key={tile.id}
            run={run}
            tile={tile}
            window={windowFor(tile.pid)}
            at={rect}
            focused={focus === tile.id}
          />
        );
      })}
      {folded.folded.length === 0 ? null : (
        <nav className="strips" aria-label="Folded tiles">
          {folded.folded.map((id) => {
            const tile = tiles.find((t) => t.id === id);
            return (
              <button key={id} type="button" className="strip" onClick={() => send({ type: "focus", tile: id })}>
                {tile === undefined ? id : `${tile.pid} · ${tile.id}`}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};

/** The frame's one word for the link, beside the presses still waiting. */
const Status = ({ run }: { readonly run: LiveWindow }) => {
  const [link] = useRuntime(run, pickLink);
  const [queue] = useRuntime(run, pickQueue);
  const [trouble] = useRuntime(run, pickTrouble);
  const [keyError] = useRuntime(run, pickKeyError);
  const [settings] = useRuntime(run, pickSettings);
  const state = link._tag === "online" ? "online" : "reconnecting";
  return (
    <footer className="bottomline" role="status">
      <span data-testid="connection" className={state === "online" ? "" : "broken"}>
        {state}
      </span>
      <span className="sep">·</span>
      <span data-testid="queue">{queue} waiting</span>
      {trouble === null ? null : (
        <>
          <span className="sep">·</span>
          <span className="broken">{trouble.replaceAll("_", " ")}</span>
        </>
      )}
      {keyError === null ? null : (
        <>
          <span className="sep">·</span>
          <span className="broken">
            keybindings.toml{keyError.line > 0 ? ` line ${keyError.line}` : ""}: {keyError.reason.replaceAll("_", " ")}
          </span>
        </>
      )}
      {settings._tag === "failed" ? (
        <>
          <span className="sep">·</span>
          <span className="broken" data-testid="settings">
            key settings not read: {settings.reason.replaceAll("_", " ")}
          </span>
        </>
      ) : null}
    </footer>
  );
};

/** The whole window: the screen the link is in, or the desk inside its frame. */
export const Window = (props: WindowProps) => {
  const [link, send] = useRuntime(props.run, pickLink);
  const [views] = useRuntime(props.run, pickViews);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => send({ type: "key", event: keyEvent(event) });
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  if (link._tag === "blocked") {
    return <Blocked reason={link.reason} />;
  }

  if (link._tag === "removed") {
    return <Removed run={props.run} />;
  }

  if (link._tag === "waiting_grant") {
    return <Waiting code={link.code} fingerprint={link.fingerprint} origin={props.origin} />;
  }

  const pids = [...new Set(tilesIn(props.layout).map((t) => t.pid))];
  const ready = pids.every((pid) => views[pid] !== undefined);

  if (!ready && (link._tag === "online" || Object.keys(views).length === 0)) {
    return <Connecting />;
  }

  return (
    <div className="frame">
      <header className="topbar">
        <span>fabrika</span>
        <span className="sep">·</span>
        <span className="quiet">window</span>
      </header>
      <Desk {...props} />
      <Status run={props.run} />
    </div>
  );
};

/** Renders the window into `element` under Strict Mode, for as long as the scope. */
export const mount = (element: HTMLElement, props: WindowProps) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const root = createRoot(element);
      root.render(
        <StrictMode>
          <Window {...props} />
        </StrictMode>,
      );
      return root;
    }),
    (root) => Effect.sync(() => root.unmount()),
  );

// --- Booting the window -------------------------------------------------------------------------
//
// The wire is P12's as built: a `challenge`, a signed `initialize`, `door.knock` while not granted,
// `client.granted` to sign a fresh hello on the same socket, text `ping` and `pong`, and JSON-RPC
// calls for `ledger.read`, `ledger.wait`, `view.open`, `process.send` and `client.record`. A tile
// names a process by its registered name; each dial resolves it to the live process id. The
// platform comes in through transport's contracts: the socket, the key and the rows store.

/** One JSON-RPC answer as the door sends it: a result, or an error with its reason. */
const RpcAnswer = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Number]),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(
    Schema.Struct({
      data: Schema.optionalKey(Schema.Struct({ reason: Schema.optionalKey(Schema.String) })),
    }),
  ),
});

const Notification = Schema.Struct({
  method: Schema.String,
  params: Schema.optionalKey(Schema.Unknown),
});

const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Union([RpcAnswer, Notification])));

const Admitted = Schema.Struct({
  ping: Schema.Number,
  who: Schema.Struct({ person: Schema.String }),
});

const WaitingCode = Schema.Struct({ code: Schema.String, until: Schema.Number });
const Nonce = Schema.Struct({ nonce: Schema.String });
const Opened = Schema.Struct({ rev: Schema.Int, view: Schema.Json });
const Entries = Schema.Struct({ entries: Schema.Array(Schema.Unknown) });
const Rev = Schema.Struct({ rev: Schema.Int });
const Acknowledged = Schema.Struct({ acknowledged: Schema.Array(Schema.String) });
const isRow = Schema.is(ClientRow);

const KeysBody = Schema.Struct({
  body: Schema.Struct({ rows: Schema.Record(Schema.String, Schema.Array(Schema.String)) }),
});

const FailedBody = Schema.Struct({ body: Keys.KeyProblem });

/** An entry's case, read from what `ledger.read` sent. */
const caseName = (entry: unknown): unknown =>
  typeof entry === "object" && entry !== null && "_tag" in entry ? entry._tag : null;

/**
 * How a call or a Cmd's handler fails. `unreachable`: the socket or the brain is gone for now, so a
 * later write retries. `unknown`: an answer this client cannot use, with the door's reason.
 * `entropy`: the random source failed while dating a press. `failed` and `unsupported`: the storage
 * persistence ask, or a record the tab could not keep. `closed`: the dial's socket is not open.
 */
const Failure = Schema.TaggedUnion({
  unreachable: {},
  unknown: { reason: Schema.String },
  entropy: {},
  failed: {},
  unsupported: {},
  closed: {},
});

const F = Failure.cases;
type CallError = typeof F.unreachable.Type | typeof F.unknown.Type;
const unreachable = F.unreachable.make({});

/** Door reasons that mean "not now": the socket or the brain will be back. */
const RETRYABLE: ReadonlySet<string> = new Set(["unreachable", "not_granted", "no_hello", "storage"]);

/** A door error's reason as a call's failure: "not now" reasons are retryable. */
const failure = (reason: string): CallError => (RETRYABLE.has(reason) ? unreachable : F.unknown.make({ reason }));

/** One write the window machine asked, as its Cmd carries it. */
type Write = ReturnType<typeof write>;

/** One of the socket's own calls, which waits in its Sub for the door's answer. */
type Call = (method: string, params: unknown) => Effect.Effect<unknown, CallError>;

/** One dial's socket as the Cmd handlers use it. */
type Connection = {
  /** Hands one write's frame to the socket, or fails at once; its answer comes on the socket Sub. */
  readonly write: (cmd: Write) => Effect.Effect<void, typeof F.unreachable.Type>;
  readonly text: (text: string) => boolean;
};

const osName = (): "macos" | "windows" | "linux" | "android" | "ios" | "unknown" => {
  const agent = navigator.userAgent.toLowerCase();

  if (agent.includes("iphone") || agent.includes("ipad")) {
    return "ios";
  }

  if (agent.includes("android")) {
    return "android";
  }

  if (agent.includes("mac")) {
    return "macos";
  }

  if (agent.includes("win")) {
    return "windows";
  }

  if (agent.includes("linux")) {
    return "linux";
  }

  return "unknown";
};

export type WindowOptions = {
  readonly layout: Layout;
  readonly ctx: Omit<WindowCtx, "layout">;
  readonly checks: WindowChecks;
  /** The label a knock shows in the waiting list, such as "Browser". */
  readonly label: string;
  /** The page's build, which every row this tab records names. */
  readonly build: string;
  /** The brain's origin, which the socket dials and every hello names. */
  readonly origin: string;
};

/** The highest page `ledger.read` answers; a shorter page is the end. */
const PAGE = 100;
/** How long kept rows wait before they are offered to the door again, at most. */
const RECORD_RETRY = "5 seconds";

/**
 * Starts the window machine with the platform's services: the socket Sub, the profile key, the
 * rows store and the Cmd handlers. The run lives as long as the scope; React only reads it.
 */
export const startWindow = Effect.fn("window.start")(function* (options: WindowOptions) {
  const keys = yield* ClientKey;
  const sockets = yield* ClientSocket;
  const rows = yield* ClientRows;
  const ids = yield* Id.Generator;
  const tab = yield* ids.next(Id.Tab).pipe(Effect.orDie);
  const origin = options.origin;
  const connections = new Map<number, Connection>();
  const connection = (dial: number) =>
    Effect.fromNullishOr(connections.get(dial)).pipe(Effect.mapError(() => unreachable));
  /** Wakes the online dial's row delivery when a new row is kept. */
  const kept = yield* Queue.sliding<true>(1);
  const sentAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  /** Offers every kept row to the door, and forgets each one it acknowledges, for the dial. */
  const deliver = Effect.fnUntraced(function* (call: Call) {
    for (;;) {
      const waiting = (yield* rows.all.pipe(Effect.orElseSucceed(() => []))).filter(isRow);

      if (waiting.length > 0) {
        const answer = yield* call("client.record", { rows: waiting }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Acknowledged)),
          Effect.option,
        );

        if (Option.isSome(answer) && answer.value.acknowledged.length > 0) {
          yield* rows.remove(answer.value.acknowledged).pipe(Effect.ignore);
        }
      }

      yield* Queue.take(kept).pipe(Effect.timeoutOption(RECORD_RETRY));
    }
  });

  /** The socket for one dial: its Msgs, from open to close. Closing the stream closes it. */
  const socket = (dial: number, rejected: string | null): Stream.Stream<WindowMsg> =>
    Stream.callback<WindowMsg>((queue) =>
      Effect.gen(function* () {
        const emit = (m: WindowMsg) => Queue.offerUnsafe(queue, m);
        const key = yield* Effect.result(keys.current(rejected));

        if (Result.isFailure(key)) {
          return emit({ type: "blocked", reason: "key_store" });
        }

        emit({ type: "identity", found: key.success.found });
        yield* open(dial, key.success, emit);
        // The socket lives in this scope: it closes when tea stops the Sub, not before.
        return yield* Effect.never;
      }),
    );

  const open = Effect.fnUntraced(function* (
    dial: number,
    key: Identity,
    emit: (m: WindowMsg) => void,
  ): Effect.fn.Return<void, never, Scope.Scope> {
    const url = `${origin.replace(/^http/, "ws")}/client/${encodeURIComponent(key.fingerprint)}/${encodeURIComponent(tab)}`;
    // The socket's own calls (hello, reads, waits, records) carry string ids and wait here, in the
    // Sub; the window's writes carry its numeric ids and are answered as Msgs, timed from the write.
    const pending = new Map<string, Deferred.Deferred<unknown, CallError>>();
    const written = new Map<number, { readonly call: Write["call"]["_tag"]; readonly at: number }>();
    const names = new Map<string, string>();
    const back = new Map<string, string>();
    const work = yield* Queue.unbounded<Effect.Effect<void>>();
    let serial = 0;
    let isOpen = false;
    /** When the link last entered `dialing` on this socket: the dial's start, or the grant that has
     *  it sign again. A link outcome's `ms` is the time since, on Effect's Clock. */
    let since = yield* Clock.currentTimeMillis;
    const took = (at: number): number => Math.max(0, at - since);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        connections.delete(dial);

        for (const waiting of pending.values()) {
          Deferred.doneUnsafe(waiting, Effect.fail(unreachable));
        }
      }),
    );
    const ws = yield* sockets.dial(url);
    const opened = yield* Deferred.make<void>();
    const call = Effect.fn("client.request")(function* (method: string, params: unknown) {
      yield* Effect.annotateCurrentSpan("fab.method", method);
      yield* Deferred.await(opened);
      const id = `s${++serial}`;
      const answer = yield* Deferred.make<unknown, CallError>();
      pending.set(id, answer);

      if (!ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))) {
        pending.delete(id);
        return yield* Effect.fail(unreachable);
      }

      return yield* Deferred.await(answer);
    });
    const readAll = Effect.fnUntraced(function* (stream: string, after: number) {
      const out: Array<unknown> = [];
      let cursor = after;

      for (;;) {
        // A failed call keeps its own reason; a page that does not decode is an answer this client
        // cannot use.
        const page = yield* call("ledger.read", { stream, after: cursor }).pipe(
          Effect.flatMap((r) =>
            Schema.decodeUnknownEffect(Entries)(r).pipe(Effect.mapError(() => F.unknown.make({ reason: "bad_page" }))),
          ),
        );
        out.push(...page.entries);
        const last = Option.getOrNull(Schema.decodeUnknownOption(Rev)(page.entries.at(-1)));

        if (last === null || page.entries.length < PAGE) {
          return { entries: out, cursor: last?.rev ?? cursor };
        }

        cursor = last.rev;
      }
    });
    const resolve = Effect.fnUntraced(function* (name: string) {
      if (name.startsWith("process_")) {
        return name;
      }

      const known = names.get(name);

      if (known !== undefined) {
        return known;
      }

      const { entries } = yield* readAll(`processes/${name}`, 0);
      const pid = ProgramClient.resolveName(entries, name, (by) => by.startsWith("brain:"));

      if (pid === null) {
        return yield* Effect.fail(F.unknown.make({ reason: "no_process" }));
      }

      names.set(name, pid);
      back.set(pid, name);
      return pid;
    });
    /** The frame of one write: its call as the door's method, with the tile's live process id. */
    const frameFor = (cmd: Write): string | null => {
      const c = cmd.call;
      const message =
        c._tag === "knock"
          ? { method: "door.knock", params: { label: options.label } }
          : c._tag === "open"
            ? { method: "view.open", params: { pid: names.get(c.pid) ?? c.pid } }
            : {
                method: "process.send",
                params: {
                  pid: names.get(c.pid) ?? c.pid,
                  letter: c.letter,
                  m: c.m,
                  sentAt: c.sentAt,
                  seen: c.seen,
                  ...(c.traceId === undefined ? {} : { traceId: c.traceId }),
                },
              };
      const named = c._tag === "knock" || c.pid.startsWith("process_") || names.has(c.pid);
      return named ? JSON.stringify({ jsonrpc: "2.0", id: cmd.id, ...message }) : null;
    };
    const writeFrame = Effect.fn("client.write")(function* (cmd: Write) {
      yield* Effect.annotateCurrentSpan("fab.call", cmd.call._tag);
      const frame = frameFor(cmd);

      if (!isOpen || frame === null) {
        return yield* Effect.fail(unreachable);
      }

      written.set(cmd.id, { call: cmd.call._tag, at: yield* Clock.currentTimeMillis });

      if (!ws.send(frame)) {
        written.delete(cmd.id);
        return yield* Effect.fail(unreachable);
      }
    });
    connections.set(dial, { write: writeFrame, text: ws.send });

    /** The person's key settings: every page, then a wait past the cursor, for as long as the dial. */
    const settings = Effect.fnUntraced(function* (person: string) {
      const stream = `person/${person}/settings`;
      let cursor = 0;

      for (;;) {
        const read = yield* readAll(stream, cursor);
        const good = read.entries
          .filter((e) => caseName(e) === "keys")
          .flatMap((e) => Option.toArray(Schema.decodeUnknownOption(KeysBody)(e)))
          .at(-1);

        if (good !== undefined) {
          emit({ type: "keys", rows: good.body.rows });
        }

        const last = read.entries.at(-1);
        const failed =
          caseName(last) === "keys_failed" ? Option.getOrNull(Schema.decodeUnknownOption(FailedBody)(last)) : null;

        if (failed !== null) {
          emit({ type: "keys_failed", error: failed.body });
        }

        if (read.cursor > cursor) {
          emit({ type: "seen", rev: read.cursor });
        }

        cursor = read.cursor;
        yield* call("ledger.wait", { stream, after: cursor });
      }
    });

    const hello = Effect.fnUntraced(function* (nonce: string) {
      const text = helloText({ url: origin, tab, nonce });
      const signed = yield* writeSshsig({
        text,
        space: "fabrika-client",
        line: key.line,
        sign: key.sign,
      });
      const answer = yield* Effect.result(
        call("initialize", {
          versions: [1],
          has: [],
          ping: "5s",
          key: key.raw,
          tab,
          nonce,
          platform: "browser",
          os: osName(),
          sentAt: yield* sentAt,
          signed,
        }),
      );

      if (Result.isSuccess(answer)) {
        const admitted = Option.getOrNull(Schema.decodeUnknownOption(Admitted)(answer.success));

        if (admitted === null) {
          return ws.close(4000, "bad answer");
        }

        // Each tile's name is resolved here, on the socket, so a write never waits for a read. A
        // name that does not resolve leaves its writes unreachable until a later dial.
        yield* Effect.forEach(
          [...new Set(tilesIn(options.layout).map((t) => t.pid))],
          (name) => resolve(name).pipe(Effect.ignore),
          { concurrency: 1, discard: true },
        );
        emit({ type: "admitted", dial, ping: admitted.ping, ms: took(yield* Clock.currentTimeMillis) });
        // Online: the person's key settings, and the rows this tab kept, for as long as the dial.
        // A failed read or wait is the Model's to decide (A15): it is reported with the call's own
        // reason, and reading stops on this dial. It is never retried here.
        const reported = settings(admitted.who.person).pipe(
          Effect.catch((e: CallError) =>
            Effect.sync(() =>
              emit({ type: "settings_failed", dial, reason: e._tag === "unknown" ? e.reason : "unreachable" }),
            ),
          ),
        );
        return yield* Effect.all([reported, deliver(call)], {
          concurrency: 2,
          discard: true,
        });
      }

      if (answer.failure._tag !== "unknown" || answer.failure.reason !== "not_granted") {
        return ws.close(4000, "not admitted");
      }

      const knocked = yield* call("door.knock", { label: options.label }).pipe(
        Effect.flatMap((r) => Schema.decodeUnknownEffect(WaitingCode)(r)),
        Effect.option,
      );

      if (Option.isSome(knocked)) {
        emit({
          type: "not_granted",
          dial,
          fingerprint: key.fingerprint,
          ...knocked.value,
          ms: took(yield* Clock.currentTimeMillis),
        });
      }
    });

    /** One notification, at `at` on the Clock. */
    const notice = (method: string, params: unknown, at: number): void => {
      if (method === "challenge" || method === "client.granted") {
        const nonce = Option.getOrNull(Schema.decodeUnknownOption(Nonce)(params));

        if (nonce === null) {
          return;
        }

        if (method === "client.granted") {
          since = at;
          emit({ type: "granted", dial });
        }

        Queue.offerUnsafe(work, hello(nonce.nonce).pipe(Effect.ignore));
      } else if (method === "door.waiting") {
        const waiting = Option.getOrNull(Schema.decodeUnknownOption(WaitingCode)(params));

        if (waiting !== null) {
          emit({ type: "not_granted", dial, fingerprint: key.fingerprint, ...waiting, ms: took(at) });
        }
      } else if (
        (method === "view.whole" || method === "view.patch") &&
        typeof params === "object" &&
        params !== null &&
        "pid" in params
      ) {
        const { pid, ...note } = params;
        const name = typeof pid === "string" ? (back.get(pid) ?? pid) : null;

        if (name !== null) {
          emit({ type: "view", pid: name, note });
        }
      }
    };

    /** The answer to one write, as the window machine's Msg, by its id and this dial. */
    const answer = (id: number, call: Write["call"]["_tag"], frame: typeof RpcAnswer.Type, ms: number): void => {
      const error = frame.error === undefined ? null : failure(frame.error.data?.reason ?? "error");

      if (call === "knock") {
        return emit(
          error === null
            ? { type: "knock_ok", id, dial, value: null, ms }
            : { type: "knock_err", id, dial, error: F.closed.make({}) },
        );
      }

      if (call === "open") {
        const view = error === null ? Option.getOrNull(Schema.decodeUnknownOption(Opened)(frame.result)) : null;
        return emit(
          view === null
            ? { type: "open_err", id, dial, error: error ?? F.unknown.make({ reason: "bad_view" }) }
            : { type: "open_ok", id, dial, value: view, ms },
        );
      }

      const sent = error === null ? Option.getOrNull(Schema.decodeUnknownOption(Sent)(frame.result)) : null;
      emit(
        sent === null
          ? { type: "send_err", id, dial, error: error ?? F.unknown.make({ reason: "bad_answer" }) }
          : { type: "send_ok", id, dial, value: sent, ms },
      );
    };

    const opening = (): void => {
      isOpen = true;
      Deferred.doneUnsafe(opened, Effect.void);
    };
    const message = (data: unknown, at: number): void => {
      if (data === "pong") {
        return emit({ type: "pong", dial });
      }

      const frame = Option.getOrNull(decodeFrame(String(data)));

      if (frame === null) {
        return;
      }

      if ("id" in frame) {
        if (typeof frame.id === "number") {
          const write = written.get(frame.id);

          if (write !== undefined) {
            written.delete(frame.id);
            answer(frame.id, write.call, frame, Math.max(0, at - write.at));
          }

          return;
        }

        const waiting = pending.get(frame.id);

        if (waiting === undefined) {
          return;
        }

        pending.delete(frame.id);
        const reason = frame.error?.data?.reason;
        Deferred.doneUnsafe(
          waiting,
          frame.error === undefined
            ? Effect.succeed(frame.result ?? null)
            : Effect.fail<CallError>(F.unknown.make({ reason: reason ?? "error" })),
        );
      } else {
        notice(frame.method, frame.params, at);
      }
    };
    const closed = (code: number, at: number): void => {
      for (const waiting of pending.values()) {
        Deferred.doneUnsafe(waiting, Effect.fail(unreachable));
      }

      pending.clear();
      // The window's writes on this dial are never answered: the dial's end drops them.
      written.clear();
      emit({ type: "closed", dial, code, fingerprint: key.fingerprint, ms: took(at) });
    };
    yield* ws.events.pipe(
      Stream.runForEach((e) =>
        Effect.flatMap(Clock.currentTimeMillis, (at) =>
          Effect.sync(() =>
            e.event === "open" ? opening() : e.event === "message" ? message(e.data, at) : closed(e.code, at),
          ),
        ),
      ),
      Effect.forkScoped,
    );
    yield* Stream.fromQueue(work).pipe(
      Stream.runForEach((task) => Effect.forkScoped(task)),
      Effect.forkScoped,
    );
  });

  const traceId = Effect.sync(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""),
  );

  return yield* run(windowMachineFor(options.checks), {
    ctx: { ...options.ctx, layout: options.layout },
    interpret: {
      now: Effect.fn("client.now")(function* () {
        const letter = yield* ids.next(Id.Letter).pipe(Effect.mapError(() => F.entropy.make({})));
        return { letter, sentAt: yield* sentAt, traceId: yield* traceId };
      }),
      // A write settles once its frame is handed to the dial's socket, never waiting for the brain:
      // its answer is the socket Sub's Msg (plan A13).
      write: (cmd) =>
        Effect.flatMap(connection(cmd.dial), (conn) => conn.write(cmd)).pipe(
          Effect.as(null),
          Effect.mapError(() => unreachable),
        ),
      persist: Effect.fn("client.persist")(function* () {
        const claimed = yield* keys.claimPersist.pipe(Effect.mapError(() => F.failed.make({})));

        if (!claimed) {
          return false;
        }

        return yield* keys.persist.pipe(
          Effect.mapError((reason) => (reason === "unsupported" ? F.unsupported.make({}) : F.failed.make({}))),
        );
      }),
      // Kept durably before it resolves: a send listed after it in the same step starts later.
      record: Effect.fn("client.record")(function* (cmd) {
        const id = yield* ids.next(Id.Entry).pipe(Effect.mapError(() => F.failed.make({})));
        const row = ClientRow.make({
          id,
          tab,
          build: options.build,
          sentAt: yield* sentAt,
          record: cmd.record,
        });
        yield* rows.put(row).pipe(Effect.mapError(() => F.failed.make({})));
        yield* Queue.offer(kept, true);
        return null;
      }),
      ping: (cmd) =>
        Effect.flatMap(connection(cmd.dial), (conn) =>
          conn.text("ping") ? Effect.succeed(null) : Effect.fail(F.closed.make({})),
        ).pipe(Effect.mapError(() => F.closed.make({}))),
    },
    subscribe: { socket: (sub) => socket(sub.deps.dial, sub.deps.rejected) },
  });
});
