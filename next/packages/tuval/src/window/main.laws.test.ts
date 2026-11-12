// P14 slice 2, next/ (ticket 828): the page's run, laws L10 (real runtime progress) and L12 (wire
// formats) of the approved plan. Written before `window/main.tsx`.
//
// The shape these laws hold `main.tsx` to, from the plan (the build may add more):
// - `startWindow({ tiles, window, build, origin })`: boots the window machine (`window`, from
//   `windowMachineFor`) on tea's Effect engine outside React, with its socket Sub, the dial's jitter
//   and its Cmd handlers, and returns tea's booting run, whose `ready` is the run. It needs libfabrika's
//   three contracts, `ClientKey`, `ClientSocket` and `ClientRows`, `Id.Generator` and a `Scope`: closing
//   the scope stops the run, its socket and every Sub.
// - `ClientSocket.dial(url)`: one dial's socket in a scope, `{events, send, close}`. `events` is a
//   Stream of {event: "open"} | {event: "message", data} | {event: "close", code}; `send(text)` is
//   false when the socket is not open.
// - `ClientKey.current(rejected)`: the profile's identity {fingerprint, raw, line, found, sign}.
// - `ClientRows.put(row)`: keeps one `ClientRow` {id, tab, build, sentAt, record}.
// - The wire is P12's as built, the door's own: a `challenge` notice with a nonce, a signed
//   `initialize` answered {version, ping, identity}, text `ping` and `pong`, and JSON-RPC 2.0 calls `ledger.read`
//   ({entries}), `view.open` ({rev, view}) and `process.send` (accepted{rev, pos}). View notices are
//   `view.whole` and `view.patch` with the runner's update and its `pid`.
//
// The peer is the door as a script: it answers what the walk lets it answer and nothing else, on the
// real run under TestClock, so a Cmd that waits for an answer, or a timer that never fires, shows.
import { describe, expect, it } from "@effect/vitest";
import { ClientRow, Id } from "@kampus/libfabrika";
import { ClientKey } from "@kampus/libfabrika/transport/ClientKey";
import { ClientRows } from "@kampus/libfabrika/transport/ClientRows";
import { ClientSocket } from "@kampus/libfabrika/transport/ClientSocket";
import { KeyLine } from "@kampus/libfabrika/transport/Sshsig";
import { Effect, Exit, Fiber, Layer, Option, Queue, Schema, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { windowMachineFor } from "./machine.ts";
import { startWindow } from "./main.tsx";

const SEED = 119120;
const BUILD = "build_test";
const ORIGIN = "http://127.0.0.1:18787";
const PID = "process_01m6v5270hf3c8x2q7w9z4k5mn";
const CountView = Schema.Struct({ count: Schema.Int });
const window = windowMachineFor({ decode: () => Schema.decodeUnknownSync(CountView) });
const tiles = [{ id: "tile_1", name: "counter:1" }];

type SocketEvent =
  | { readonly event: "open" }
  | { readonly event: "message"; readonly data: unknown }
  | { readonly event: "close"; readonly code: number };

/** One JSON-RPC 2.0 call as the page frames it. */
const Call = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Union([Schema.Number, Schema.String]),
    method: Schema.String,
    params: Schema.optionalKey(Schema.Unknown),
  }),
);

const decodeFrame = Schema.decodeUnknownOption(Call);

/** What the scripted door answers: the walk turns these off one by one. */
type Script = {
  pong: boolean;
  open: boolean;
  send: boolean;
  /** The malformed frames L12 sends once the page is online, in order. */
  junk: ReadonlyArray<(ids: ReadonlyMap<string, number | string>) => string>;
};

/** The door as a script on one in-memory socket per dial, and every frame the page sent. */
const peer = (script: Script) => {
  const sent: Array<string> = [];
  const dials: Array<string> = [];
  const ids = new Map<string, number | string>(); // the last id of each method the page called
  let open: Queue.Queue<SocketEvent> | null = null;
  const message = (frame: unknown) => Queue.offerUnsafe(open!, { event: "message", data: JSON.stringify(frame) });

  const answer = (text: string): boolean => {
    sent.push(text);

    if (text === "ping") {
      if (script.pong) {
        Queue.offerUnsafe(open!, { event: "message", data: "pong" });
      }

      return true;
    }

    const decoded = decodeFrame(text);

    if (Option.isNone(decoded)) {
      return true;
    }

    const frame = decoded.value;

    ids.set(frame.method, frame.id);
    const result = (value: unknown) => message({ jsonrpc: "2.0", id: frame.id, result: value });

    if (frame.method === "initialize") {
      // The door's admission as it answers `initialize`: the version, the beat and the checked identity.
      result({ version: 1, ping: 5_000, identity: { key: "SHA256:test", person: "person_test", as: "window" } });

      for (const junk of script.junk) {
        Queue.offerUnsafe(open!, { event: "message", data: junk(ids) });
      }
    } else if (frame.method === "ledger.read") {
      result({
        entries: [{ _tag: "started", by: "brain", body: { process: PID, name: "counter:1" }, rev: 1, pos: 1 }],
      });
    } else if (frame.method === "view.open" && script.open) {
      result({ rev: 0, view: { count: 0 } });
    } else if (frame.method === "process.send" && script.send) {
      result({ _tag: "accepted", rev: 2, pos: 1 });
    }

    return true;
  };

  const socket = Layer.succeed(ClientSocket, {
    dial: (url: string) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          dials.push(url);
          const events = yield* Queue.unbounded<SocketEvent>();
          open = events;
          Queue.offerUnsafe(events, { event: "open" });
          Queue.offerUnsafe(events, {
            event: "message",
            data: JSON.stringify({ jsonrpc: "2.0", method: "challenge", params: { nonce: `nonce_${dials.length}` } }),
          });
          return {
            events: Stream.fromQueue(events),
            send: answer,
            close: (code: number) => {
              Queue.offerUnsafe(events, { event: "close", code });
            },
          };
        }),
        () => Effect.sync(() => (open = null)),
      ),
  });
  return { socket, sent, dials, message: (frame: unknown) => open !== null && message(frame) };
};

/** A real Ed25519 key in WebCrypto, as the browser layer makes one, with its ssh key line. */
const identity = Effect.gen(function* () {
  const pair = yield* Effect.promise(() => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]));
  const raw = new Uint8Array(yield* Effect.promise(() => crypto.subtle.exportKey("raw", pair.publicKey)));
  const field = (bytes: Uint8Array) => [...new Uint8Array(new Uint32Array([bytes.length]).buffer).reverse(), ...bytes];
  const blob = new Uint8Array([...field(new TextEncoder().encode("ssh-ed25519")), ...field(raw)]);
  const line = Schema.decodeUnknownSync(KeyLine)(`ssh-ed25519 ${btoa(String.fromCharCode(...blob))}`);
  return {
    fingerprint: "SHA256:test",
    raw: btoa(String.fromCharCode(...raw))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
    line,
    found: "reused" as const,
    sign: (bytes: Uint8Array) =>
      Effect.promise(() => crypto.subtle.sign("Ed25519", pair.privateKey, bytes)).pipe(
        Effect.map((b) => new Uint8Array(b)),
      ),
  };
});

const services = (socket: Layer.Layer<ClientSocket>, rows: Array<unknown>) =>
  Layer.mergeAll(
    socket,
    Layer.effect(
      ClientKey,
      Effect.map(identity, (key) => ({
        current: () => Effect.succeed(key),
        claimPersist: Effect.succeed(true),
        persist: Effect.succeed(true),
      })),
    ),
    Layer.succeed(ClientRows, { put: (row: unknown) => Effect.sync(() => void rows.push(row)) }),
    Id.Generator.layer,
  );

/** Moves TestClock in steps, reading the run's link after each. */
const tick = (ms: number) => TestClock.adjust(ms).pipe(Effect.andThen(Effect.yieldNow));

const press = { type: "press", tile: "tile_1", m: { type: "inc" }, via: "button" } as const;

describe("L10: real runtime progress", () => {
  it.effect.prop(
    "with a peer that never answers a send or an open, every Cmd finishes and the tab leaves online within 10 s of its last pong",
    {
      plan: fc.record({
        open: fc.boolean(),
        send: fc.boolean(),
        silentAt: fc.integer({ min: 0, max: 40 }), // in half seconds after online: the peer stops ponging
        presses: fc.array(fc.integer({ min: 0, max: 40 }), { maxLength: 4 }),
      }),
    },
    ({ plan }) =>
      Effect.gen(function* () {
        const script: Script = { pong: true, open: plan.open, send: plan.send, junk: [] };
        const door = peer(script);
        const rows: Array<unknown> = [];
        const scope = yield* Scope.make();
        const booting = yield* startWindow({ tiles, window, build: BUILD, origin: ORIGIN }).pipe(
          Effect.provide(services(door.socket, rows)),
          Scope.provide(scope),
        );
        const run = yield* booting.ready;
        let lastPong = 0,
          now = 0,
          online = false;

        for (let half = 0; half < 120; half++) {
          if (online && plan.presses.includes(half)) {
            yield* run.dispatch(press);
          }

          if (online && half === plan.silentAt) {
            script.pong = false;
          }

          yield* tick(500);
          now += 500;
          const link = run.getState().link;

          if (!online && link._tag === "online") {
            online = true;
            plan.silentAt += half;
            plan.presses = plan.presses.map((p) => p + half);
          }

          if (script.pong && link._tag === "online") {
            lastPong = now;
          }

          if (online && !script.pong) {
            expect(
              link._tag !== "online" || now <= lastPong + 10_000,
              `still online ${now - lastPong} ms after the last pong`,
            ).toBe(true);
          }
        }

        expect(online, "the page went online").toBe(true);
        expect(run.getState().link._tag).not.toBe("online");
        // Every Cmd finished: the run goes idle once its Cmds settle, unanswered calls and all.
        const idle = yield* Effect.forkChild(run.idle());
        yield* tick(1_000);
        expect(idle.pollUnsafe() !== undefined, "a Cmd is still running").toBe(true);
        yield* Fiber.interrupt(idle);
        // Every row the run kept carries the tab, the build and its own time from a Cmd.
        expect(rows.length).toBeGreaterThan(0);

        for (const row of rows) {
          expect(Schema.is(ClientRow)(row), JSON.stringify(row)).toBe(true);
          expect(row).toMatchObject({ build: BUILD });
        }

        expect(new Set(rows.filter(Schema.is(ClientRow)).map((r) => r.tab)).size).toBe(1);
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.provide(TestClock.layer())),
    { fastCheck: { seed: SEED, numRuns: 50 } },
  );
});

describe("L12: wire formats are refused as typed values", () => {
  it.effect(
    "format: a malformed open_ok.value, a view notice without pid, an answer to an unknown id and a broken frame install nothing and stop nothing",
    () =>
      Effect.gen(function* () {
        const script: Script = {
          pong: true,
          open: false,
          send: true,
          junk: [
            // JSON-RPC 2.0 answers as the door sends them, with a wrong shape, an unknown id or no frame.
            () => JSON.stringify({ jsonrpc: "2.0", id: 999_999, result: { rev: 5, view: { count: 5 } } }),
            () =>
              JSON.stringify({
                jsonrpc: "2.0",
                method: "view.whole",
                params: { type: "whole", rev: 3, view: { count: 3 } },
              }),
            () =>
              JSON.stringify({
                jsonrpc: "2.0",
                method: "view.patch",
                params: { type: "patch", base: 0, rev: 1, patch: [] },
              }),
            () => "{ not json",
            () =>
              JSON.stringify({
                jsonrpc: "2.0",
                id: "x",
                error: { code: -32000, message: "no", data: { reason: "nope" } },
              }),
          ],
        };
        const door = peer(script);
        const scope = yield* Scope.make();
        const booting = yield* startWindow({ tiles, window, build: BUILD, origin: ORIGIN }).pipe(
          Effect.provide(services(door.socket, [])),
          Scope.provide(scope),
        );
        const run = yield* booting.ready;

        for (let n = 0; n < 6; n++) {
          yield* tick(500);
        }

        expect(run.getState().link._tag).toBe("online");
        const opened = door.sent.flatMap((t) => Option.toArray(decodeFrame(t))).find((f) => f.method === "view.open");
        expect(opened, "the page opened its tile").toBeDefined();
        // The open's answer arrives malformed: an empty struct, then a view of the wrong type.
        door.message({ jsonrpc: "2.0", id: opened?.id, result: {} });
        door.message({ jsonrpc: "2.0", id: opened?.id, result: { rev: 1, view: { count: "one" } } });
        yield* tick(500);
        expect(run.getState().client.views, "nothing malformed was installed").toEqual({});
        // The run still folds: a well-formed notice with its pid installs.
        door.message({
          jsonrpc: "2.0",
          method: "view.whole",
          params: { pid: PID, type: "whole", rev: 4, view: { count: 4 } },
        });
        yield* tick(500);
        expect(run.getState().client.views[PID]).toEqual({ rev: 4, view: { count: 4 } });
        expect(run.getState().link._tag).toBe("online");
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.provide(TestClock.layer())),
  );
});
