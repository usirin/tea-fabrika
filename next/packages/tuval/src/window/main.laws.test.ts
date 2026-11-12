// P14 slice 2, next/ (ticket 828): the page's run, laws L2 (retry timing), L10 (real runtime progress)
// and L12 (wire formats) of the approved plan. Written before `window/main.tsx`.
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
import { backoff, CAP, linkTimer } from "@kampus/libfabrika/transport/Link";
import { KeyLine } from "@kampus/libfabrika/transport/Sshsig";
import { Effect, Exit, Fiber, Layer, Option, Queue, Random, Schema, Scope, Stream } from "effect";
import * as Clock from "effect/Clock";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { windowMachineFor } from "./machine.ts";
import { startWindow } from "./main.tsx";

const SEED = 119120;
const BUILD = "build_test";
const ORIGIN = "http://127.0.0.1:18787";
const PID = "process_01m6v5270hf3c8x2q7w9z4k5mn";

/** A list view, the checklist's shape cut to what these laws read. Tuval may not import a program. */
const ListView = Schema.Struct({
  items: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.String })),
  left: Schema.Int,
});

const list = (n: number) => ({
  items: Array.from({ length: n }, (_, i) => ({ name: `item ${i}`, state: "open" })),
  left: n,
});

const window = windowMachineFor({ decode: () => Schema.decodeUnknownSync(ListView), tile: () => undefined });
const tiles = [{ id: "tile_1", name: "checklist:1" }];

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
  waiting?: boolean;
  /** The malformed frames L12 sends once the page is online, in order. */
  junk: ReadonlyArray<(ids: ReadonlyMap<string, number | string>) => string>;
};

/** The door as a script on one in-memory socket per dial, and every frame the page sent. */
const peer = (script: Script, pong: () => void = () => {}) => {
  const sent: Array<string> = [];
  const dials: Array<string> = [];
  const ids = new Map<string, number | string>(); // the last id of each method the page called
  let knocks = 0;
  let open: Queue.Queue<SocketEvent> | null = null;
  const message = (frame: unknown) => Queue.offerUnsafe(open!, { event: "message", data: JSON.stringify(frame) });

  const answer = (text: string): boolean => {
    sent.push(text);

    if (text === "ping") {
      if (script.pong) {
        pong();
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
      if (script.waiting) {
        message({ jsonrpc: "2.0", id: frame.id, error: { data: { reason: "not_granted" } } });
        return true;
      }

      // The door's admission as it answers `initialize`: the version, the beat and the checked identity.
      result({ version: 1, ping: 5_000, identity: { key: "SHA256:test", person: "person_test", as: "window" } });

      for (const junk of script.junk) {
        Queue.offerUnsafe(open!, { event: "message", data: junk(ids) });
      }
    } else if (frame.method === "gateway.knock") {
      if (++knocks === 1) {
        result({ code: "TEST", until: 300_000 });
      }
    } else if (frame.method === "ledger.read") {
      result({
        entries: [{ _tag: "started", by: "brain", body: { process: PID, name: "checklist:1" }, rev: 1, pos: 1 }],
      });
    } else if (frame.method === "view.open" && script.open) {
      result({ rev: 0, view: list(0) });
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
  return { socket, sent, dials, knocks: () => knocks, message: (frame: unknown) => open !== null && message(frame) };
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

const press = { type: "press", tile: "tile_1", m: { type: "check", name: "item 0" }, via: "button" } as const;

const choice = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  code: fc.nat(),
  ping: fc.integer({ min: 0, max: 60_000 }),
  ms: fc.integer({ min: 0, max: 20_000 }),
  word: fc.stringMatching(/^[A-Z0-9]{4}$/),
});

type Choice = typeof choice extends fc.Arbitrary<infer C> ? C : never;

// Measure the real socket acquisition, including the Link timer and the private dial jitter.
// The same choice generator and shortened prefixes rebuild each failure from the current link.
const retryTiming = (list: ReadonlyArray<Choice>, seed: number, seen: Map<number, Set<number>>) =>
  Effect.gen(function* () {
    const key = yield* identity;
    const clock = yield* Clock.Clock;
    const opened: Array<number> = [];
    let events: Queue.Queue<SocketEvent> | undefined;
    const socket = Layer.succeed(ClientSocket, {
      dial: () =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            opened.push(clock.currentTimeMillisUnsafe());
            const queue = yield* Queue.unbounded<SocketEvent>();
            events = queue;
            return {
              events: Stream.fromQueue(queue),
              send: () => true,
              close: (code: number) => void Queue.offerUnsafe(queue, { event: "close", code }),
            };
          }),
          (socket) => Effect.sync(() => socket.close(1000)),
        ),
    });
    const layers = Layer.mergeAll(
      socket,
      Layer.succeed(ClientKey, {
        current: () => Effect.succeed(key),
        claimPersist: Effect.succeed(false),
        persist: Effect.succeed(true),
      }),
      Layer.succeed(ClientRows, { put: () => Effect.void }),
      Id.Generator.layer,
    );
    const started = clock.currentTimeMillisUnsafe();
    const booting = yield* startWindow({ tiles, window, build: BUILD, origin: ORIGIN }).pipe(Effect.provide(layers));
    const run = yield* booting.ready;
    yield* run.idle();
    yield* tick(0);
    expect(opened, "the first dial opens at once").toEqual([started]);
    let dialingAt = started;

    for (const c of list) {
      const link = run.getState().link;
      expect(link._tag).toBe("dialing");

      if (link._tag !== "dialing") {
        return;
      }

      if (c.move % 2 === 0) {
        Queue.offerUnsafe(events!, { event: "close", code: 1006 });
        yield* tick(0);
      } else {
        yield* tick(dialingAt + linkTimer(link)!.after - clock.currentTimeMillisUnsafe());
      }

      const retrying = run.getState().link;
      expect(retrying._tag).toBe("retrying");

      if (retrying._tag !== "retrying") {
        return;
      }

      const failedAt = clock.currentTimeMillisUnsafe();
      const before = backoff(retrying.tries);
      const count = opened.length;
      const bound = Math.min(1000, before / 2, CAP - before);
      expect(linkTimer(retrying)?.after, "the machine's timer stays backoff(tries)").toBe(before);
      yield* tick(before - 1);
      expect(opened.length, "the retry cannot open before its backoff").toBe(count);
      yield* tick(1 + bound);
      expect(opened.length, "one socket opens within the jitter bound").toBe(count + 1);
      const total = opened[count]! - failedAt;
      const wait = total - before;
      expect(wait).toBeGreaterThanOrEqual(0);
      expect(wait, `tries ${retrying.tries}`).toBeLessThanOrEqual(bound);
      expect(total).toBeLessThanOrEqual(CAP);
      seen.set(retrying.tries, (seen.get(retrying.tries) ?? new Set()).add(wait));
      dialingAt = failedAt + before;
    }
  }).pipe(Effect.scoped, Random.withSeed(seed), Effect.provide(TestClock.layer()));

describe("L2: retry jitter in the dial", () => {
  it("a retry dial opens no earlier than backoff(tries), no later than the jitter bound, and never past 30 s", async () => {
    const seen = new Map<number, Set<number>>();
    await fc.assert(
      fc.asyncProperty(fc.array(choice, { minLength: 1, maxLength: 40 }), fc.integer(), async (list, seed) => {
        await Effect.runPromise(retryTiming(list, seed, seen));
      }),
      { seed: SEED, numRuns: 100 },
    );
    expect(seen.get(1)?.size ?? 0, "Random spreads the first retry's wait").toBeGreaterThan(1);
  });
});

describe("L10: real runtime progress", () => {
  it.effect.prop(
    "with unanswered sends, opens and knocks, every Cmd finishes and the tab leaves online within 10 s of its last pong",
    {
      plan: Schema.Struct({
        open: Schema.Boolean,
        waiting: Schema.Boolean,
        moves: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))).check(
          Schema.isMinLength(20),
          Schema.isMaxLength(60),
        ),
      }),
    },
    ({ plan }) =>
      Effect.gen(function* () {
        const script: Script = { pong: true, open: plan.open, waiting: plan.waiting, send: false, junk: [] };
        const clock = yield* Clock.Clock;
        let lastPong = clock.currentTimeMillisUnsafe();
        const door = peer(script, () => {
          lastPong = clock.currentTimeMillisUnsafe();
        });
        const rows: Array<unknown> = [];
        const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
        const booting = yield* startWindow({ tiles, window, build: BUILD, origin: ORIGIN }).pipe(
          Effect.provide(services(door.socket, rows)),
          Scope.provide(scope),
        );
        const run = yield* booting.ready;
        const idleNow = Effect.gen(function* () {
          const idle = yield* Effect.forkChild(run.idle());
          yield* tick(1);
          expect(idle.pollUnsafe() !== undefined, "a Cmd is still running").toBe(true);
          yield* Fiber.interrupt(idle);
        });

        for (const pick of plan.moves) {
          const state = run.getState();

          if (state.link._tag === "waiting_grant") {
            if (door.knocks() < 2 || pick % 3 === 0) {
              yield* tick(30_000);
              yield* idleNow;
            } else {
              script.waiting = false;
              door.message({ jsonrpc: "2.0", method: "client.granted", params: { nonce: "grant_nonce" } });
              yield* tick(500);
            }
          } else if (state.link._tag === "online") {
            const open = state.tiles.find((t) => t.reach._tag === "open");
            const opening = state.flight.find((f) => f.call._tag === "open");

            if (open !== undefined && pick % 3 !== 0) {
              yield* run.dispatch({ ...press, tile: open.id });
            } else if (opening?.call._tag === "open") {
              // A notice may beat an unanswered open. It also enables sends in that walk.
              door.message({
                jsonrpc: "2.0",
                method: "view.whole",
                params: {
                  pid: opening.call.pid,
                  type: "whole",
                  rev: 1,
                  view: list(pick % 4),
                },
              });
            }

            yield* tick(500);
            yield* idleNow;
          } else {
            yield* tick(500);
          }
        }

        expect(run.getState().link._tag, "the page went online").toBe("online");

        if (plan.waiting) {
          expect(door.knocks(), "a renewal went unanswered").toBeGreaterThan(1);
        }

        // A long grant wait may have ended only on the walk's last move. Establish an actual pong
        // on this online dial before measuring silence, rather than dating it from the page's boot.
        const previousPong = lastPong;

        for (let n = 0; n < 20 && lastPong === previousPong; n++) {
          yield* tick(500);
          yield* idleNow;
        }

        expect(lastPong, "the current online dial received a pong").toBeGreaterThan(previousPong);
        expect(run.getState().link).toMatchObject({ _tag: "online", pings: 0 });

        // Stop answering pings on the current dial. A later successful dial is allowed.
        script.pong = false;
        const link = run.getState().link;

        while (clock.currentTimeMillisUnsafe() < lastPong + 10_000 && run.getState().link._tag === "online") {
          yield* tick(500);
        }

        expect(run.getState().link, "the silent dial left online within 10 s").not.toEqual(link);
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
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
});

describe("L12: wire formats are refused as typed values", () => {
  it.effect(
    "format: a malformed open_ok.value, a view notice without pid, a refused answer without a string reason, an answer to an unknown id and a broken frame install nothing and stop nothing",
    () =>
      Effect.gen(function* () {
        // The parent also validates this public protocol value before its reducer sees it.
        const openAnswer = { type: "open_ok", id: 1, dial: 1, ms: 0 };

        for (const value of [{}, { rev: "one", view: list(1) }, { rev: 1 }]) {
          expect(Schema.is(window.msg)({ ...openAnswer, value }), "an invalid open_ok.value passed").toBe(false);
        }

        const script: Script = {
          pong: true,
          open: false,
          send: true,
          junk: [
            // JSON-RPC 2.0 answers as the door sends them, with a wrong shape, an unknown id or no frame.
            () => JSON.stringify({ jsonrpc: "2.0", id: 999_999, result: { rev: 5, view: list(5) } }),
            () =>
              JSON.stringify({
                jsonrpc: "2.0",
                method: "view.whole",
                params: { type: "whole", rev: 3, view: list(3) },
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
        const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
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
        const beforeMalformed = run.getState();
        // The open's answer arrives malformed: an empty struct, then a view of the wrong type.
        door.message({ jsonrpc: "2.0", id: opened?.id, result: {} });
        yield* tick(500);
        expect(run.getState().flight, "a malformed open answer settled a flight").toEqual(beforeMalformed.flight);
        door.message({ jsonrpc: "2.0", id: opened?.id, result: { rev: 1, view: { items: "one", left: 1 } } });
        yield* tick(500);
        expect(run.getState().client.views, "nothing malformed was installed").toEqual({});
        // The run still folds: a well-formed notice with its pid installs.
        door.message({
          jsonrpc: "2.0",
          method: "view.whole",
          params: { pid: PID, type: "whole", rev: 4, view: list(4) },
        });
        yield* tick(500);
        expect(run.getState().client.views[PID]).toEqual({ rev: 4, view: list(4) });
        expect(run.getState().link._tag).toBe("online");
        // A press goes out; its answer comes back refused with no reason, then with a reason that is
        // not a string. Neither is an answer: the letter stays out and no tile shows a refusal.
        script.send = false;
        yield* run.dispatch(press);
        yield* tick(500);
        const sends = door.sent
          .flatMap((t) => Option.toArray(decodeFrame(t)))
          .filter((f) => f.method === "process.send");
        expect(sends.length, "the press went out").toBeGreaterThan(0);
        const id = sends.at(-1)!.id;
        door.message({ jsonrpc: "2.0", id, result: { _tag: "refused" } });
        door.message({ jsonrpc: "2.0", id, result: { _tag: "refused", reason: 7 } });
        yield* tick(500);
        expect(run.getState().client.pending, "a malformed refusal removed the letter").toHaveLength(1);
        expect(run.getState().tiles.map((t) => t.refusal)).toEqual([null]);
        expect(run.getState().link._tag).toBe("online");
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
});
