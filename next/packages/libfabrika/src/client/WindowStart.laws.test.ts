// P18 slice 1, next/ (ticket 290): the window start's laws. P14 slice 2's laws of the page's run
// (ticket 828: L2 retry timing, L10 real runtime progress, L9 failure classes, L12 wire formats)
// moved here with the start, every assertion kept, on Effect's own socket through an injected
// `Socket.WebSocketConstructor` (P18 L1). Then P18's own: L4, one Effect socket per dial, and L5,
// no secret leaves in a row, a span, a URL or a failure.
//
// The shape these laws hold `client/WindowStart.ts` to, from the approved plan (the build may add more):
// - `start({ tiles, window, origin, build, client })`: boots the window machine (`window`, from
//   `windowMachineFor`) on tea's Effect engine, with its socket Sub, the dial's jitter and its Cmd
//   handlers, and returns tea's booting run, whose `ready` is the run. `client` is a `ClientInfo`:
//   the hello's `platform`, `os` and `has`, and the knock's `label`. It needs `ClientKey`,
//   `ClientRows`, `Id.Generator`, `Socket.WebSocketConstructor` and a `Scope`: closing the scope stops
//   the run, its sockets and every Sub.
// - Each dial is one constructor call, one `Socket.fromWebSocket` with one reader and one writer in
//   the dial's own scope. A constructor that throws is `socket_failure` (op `connect`) and a close
//   with code 1006, never a defect. A `write` or `ping` for a dial with no open writer answers its
//   error at once. Reconnects are the Link machine's: the start never dials again by itself.
// - The wire is P12's as built, the door's own: a `challenge` notice with a nonce, a signed
//   `initialize` answered {version, ping, identity}, text `ping` and `pong`, and JSON-RPC 2.0 calls
//   `ledger.read` ({entries}), `view.open` ({rev, view}) and `process.send` (accepted{rev, pos}).
//   View notices are `view.whole` and `view.patch` with the runner's update and its `pid`.
//
// The peer is the door as a script: it answers what the walk lets it answer and nothing else, on the
// real run under TestClock, so a Cmd that waits for an answer, or a timer that never fires, shows.
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Function, Layer, Option, Random, Schema, Scope, Tracer } from "effect";
import * as Clock from "effect/Clock";
import { Socket } from "effect/socket";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { ClientKey, ClientKeyError } from "../transport/ClientKey.ts";
import { ClientRow, ClientRows, ClientRowsError, ErrorClass } from "../transport/ClientRows.ts";
import { backoff, CAP, linkTimer, ping } from "../transport/Link.ts";
import { KeyLine } from "../transport/Sshsig.ts";
import { windowMachineFor, write } from "./WindowMachine.ts";
import { MemorySocket } from "./WindowStart.test-support.ts";
import { start } from "./WindowStart.ts";

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
/** The browser's facts, as the browser entry passes them. */
const BROWSER = { platform: "browser", os: "unknown", has: [], label: "Browser" } as const;

/** One JSON-RPC 2.0 call as the page frames it. */
const Call = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.Union([Schema.Number, Schema.String]),
    method: Schema.String,
    params: Schema.optionalKey(Schema.Unknown),
  }),
);

const decodeFrame = Schema.decodeUnknownOption(Call);

/** A notice that makes the page say hello: a nonce to sign, from the first challenge or a grant. */
const asksHello = Schema.is(
  Schema.Struct({
    method: Schema.Literals(["challenge", "client.granted"]),
    params: Schema.Struct({ nonce: Schema.String }),
  }),
);

/** Moves TestClock in steps, reading the run's link after each. */
const tick = (ms: number) => TestClock.adjust(ms).pipe(Effect.andThen(Effect.yieldNow));

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
const peer = (script: Script, pong: () => void = () => {}, nonce = (n: number) => `nonce_${n}`) => {
  const sent: Array<string> = [];
  const dials: Array<string> = [];
  const resources = { sockets: 0, released: 0, streams: 0, ended: 0 };
  const ids = new Map<string, number | string>(); // the last id of each method the page called
  let knocks = 0;
  let open: MemorySocket | null = null;
  // The page signs each hello with real WebCrypto, which TestClock does not move. So the door counts,
  // for each socket still open, the nonces it gave that no `initialize` has answered yet, and a walk
  // waits on `quiet` before it moves the clock: no virtual time passes while real work is running.
  const owed = new Map<MemorySocket, number>();
  let waiting: Deferred.Deferred<void> | null = null;
  const settled = () => [...owed.values()].every((n) => n === 0);
  const wake = () => {
    if (waiting !== null && settled()) {
      Deferred.doneUnsafe(waiting, Effect.void);
      waiting = null;
    }
  };
  const owe = (events: MemorySocket, n: number) => {
    const before = owed.get(events);

    // A socket already released owes nothing.
    if (before !== undefined) {
      owed.set(events, before + n);
      wake();
    }
  };
  const quiet = Effect.suspend(() => {
    if (settled()) {
      return Effect.void;
    }

    waiting ??= Deferred.makeUnsafe<void>();
    return Deferred.await(waiting);
  });
  const message = (frame: unknown) => {
    if (asksHello(frame)) {
      owe(open!, 1);
    }

    open!.receive(JSON.stringify(frame));
    return true;
  };

  const answer = (text: string, events: MemorySocket): boolean => {
    sent.push(text);

    if (text === "ping") {
      if (script.pong) {
        pong();
        open!.receive("pong");
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
      owe(events, -1);

      if (script.waiting) {
        message({ jsonrpc: "2.0", id: frame.id, error: { data: { reason: "not_granted" } } });
        return true;
      }

      // The door's admission as it answers `initialize`: the version, the beat and the checked identity.
      result({ version: 1, ping: 5_000, identity: { key: "SHA256:test", person: "person_test", as: "window" } });

      for (const junk of script.junk) {
        open!.receive(junk(ids));
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

  // One constructed socket per dial, opened at once with the door's challenge waiting in it. The
  // start's release closes it; a reader is its `message` listener, attached and removed.
  const socket = Layer.succeed(Socket.WebSocketConstructor, (url: string) => {
    dials.push(url);
    resources.sockets++;
    const events: MemorySocket = new MemorySocket(url, {
      send: (text, from) => void answer(text, from),
      closed: (from) => {
        resources.released++;
        open = open === from ? null : open;
        owed.delete(from);
        wake();
      },
    });
    const listen = events.addEventListener.bind(events);
    const unlisten = events.removeEventListener.bind(events);
    events.addEventListener = (type, listener, options) => {
      resources.streams += type === "message" ? 1 : 0;
      listen(type, listener, options);
    };
    events.removeEventListener = (type, listener) => {
      resources.ended += type === "message" ? 1 : 0;
      unlisten(type, listener);
    };
    open = events;
    owed.set(events, 0);
    events.open();
    message({ jsonrpc: "2.0", method: "challenge", params: { nonce: nonce(dials.length) } });
    return events;
  });
  return {
    socket,
    sent,
    dials,
    resources,
    knocks: () => knocks,
    message: (frame: unknown) => open !== null && message(frame),
    /** The door closes the open socket with `code`. */
    drop: (code: number) => open?.drop(code),
    /** Moves TestClock once every hello the door asked for is sent, or its socket is gone. */
    tick: (ms: number) => quiet.pipe(Effect.andThen(tick(ms))),
  };
};

/** WebCrypto refused to make or export the test key: the test's own failure, never the product's. */
class TestKeyError extends Schema.TaggedError<TestKeyError>()("TestKeyError", {}) {}

/** A constructor's refusal, as a browser's `new WebSocket` throws one: a DOMException of a platform class. */
const refuse = (message: string, name: string): never => {
  throw new DOMException(message, name);
};

/** A real Ed25519 key in WebCrypto, as the browser layer makes one, with its ssh key line. */
const identity = Effect.gen(function* () {
  const pair = yield* Effect.tryPromise({
    try: () => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]),
    catch: () => new TestKeyError({}),
  });
  const raw = new Uint8Array(
    yield* Effect.tryPromise({
      try: () => crypto.subtle.exportKey("raw", pair.publicKey),
      catch: () => new TestKeyError({}),
    }),
  );
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
      Effect.tryPromise({
        try: () => crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(bytes)),
        catch: () => new ClientKeyError({ op: "sign", error: "OperationError" }),
      }).pipe(Effect.map((b) => new Uint8Array(b))),
  };
});

const services = (socket: Layer.Layer<Socket.WebSocketConstructor>, rows: Array<unknown>) =>
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
    let events: MemorySocket | undefined;
    // Each dial's socket opens at once and the door never speaks, so the link stays dialing until
    // the walk drops it or its stall timer fires.
    const socket = Layer.succeed(Socket.WebSocketConstructor, (url: string) => {
      opened.push(clock.currentTimeMillisUnsafe());
      const made = new MemorySocket(url);
      events = made;
      made.open();
      return made;
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
    const booting = yield* start({ tiles, window, build: BUILD, origin: ORIGIN, client: BROWSER }).pipe(
      Effect.provide(layers),
    );
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
        events!.drop(1006);
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
  it("L2 scenario: a retry dial opens no earlier than backoff(tries), no later than the jitter bound, and never past 30 s", async () => {
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
    "L10 scenario: with unanswered sends, opens and knocks, every Cmd finishes and the tab leaves online within 10 s of its last pong",
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
        const booting = yield* start({ tiles, window, build: BUILD, origin: ORIGIN, client: BROWSER }).pipe(
          Effect.provide(services(door.socket, rows)),
          Scope.provide(scope),
        );
        const run = yield* booting.ready;
        const idleNow = Effect.gen(function* () {
          const idle = yield* Effect.forkChild(run.idle());
          yield* door.tick(1);
          expect(idle.pollUnsafe() !== undefined, "a Cmd is still running").toBe(true);
          yield* Fiber.interrupt(idle);
        });

        for (const pick of plan.moves) {
          const state = run.getState();

          if (state.link._tag === "waiting_grant") {
            if (door.knocks() < 2 || pick % 3 === 0) {
              yield* door.tick(30_000);
              yield* idleNow;
            } else {
              script.waiting = false;
              door.message({ jsonrpc: "2.0", method: "client.granted", params: { nonce: "grant_nonce" } });
              yield* door.tick(500);
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

            yield* door.tick(500);
            yield* idleNow;
          } else {
            yield* door.tick(500);
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
          yield* door.tick(500);
          yield* idleNow;
        }

        expect(lastPong, "the current online dial received a pong").toBeGreaterThan(previousPong);
        expect(run.getState().link).toMatchObject({ _tag: "online", pings: 0 });

        // Stop answering pings on the current dial. A later successful dial is allowed.
        script.pong = false;
        const link = run.getState().link;

        while (clock.currentTimeMillisUnsafe() < lastPong + 10_000 && run.getState().link._tag === "online") {
          yield* door.tick(500);
        }

        expect(run.getState().link, "the silent dial left online within 10 s").not.toEqual(link);
        expect(run.getState().link._tag).not.toBe("online");
        // Every Cmd finished: the run goes idle once its Cmds settle, unanswered calls and all.
        const idle = yield* Effect.forkChild(run.idle());
        yield* door.tick(1_000);
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
        // L11: closing the owner must stop the runtime itself, not just its page.
        expect(door.resources.sockets, "the real run acquired a socket").toBeGreaterThan(0);
        expect(door.resources.streams, "the socket Sub consumed its events").toBeGreaterThan(0);
        expect(door.resources.released, "every acquired socket was released").toBe(door.resources.sockets);
        expect(door.resources.ended, "every socket event stream ended").toBe(door.resources.streams);
        const stopped = run.getState();
        const outputs = { dials: door.dials.length, sent: door.sent.length, rows: rows.length };
        // Outlive both the beat and the retry cap. A surviving timer or Sub would do work.
        yield* door.tick(60_000);
        expect(run.getState(), "no timer folds after the owner closes").toEqual(stopped);
        expect({ dials: door.dials.length, sent: door.sent.length, rows: rows.length }).toEqual(outputs);
        expect(
          door.message({
            jsonrpc: "2.0",
            method: "view.whole",
            params: { pid: PID, type: "whole", rev: 99, view: list(9) },
          }),
          "no socket consumer survives",
        ).toBe(false);
        const rejected = yield* run.dispatch(press).pipe(Effect.flip);
        expect(rejected._tag, "a stopped runtime refuses a new press").toBe("Stopped");
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
});

describe("L9: failure classes through the real runtime", () => {
  // Each service fails at an operation the real run reaches. Later moves are chosen from the
  // current link and open tiles, so shortened walks cannot press an unopened process.
  for (const operation of ["connect", "sign", "claim", "record"] as const) {
    it.effect.prop(
      `L9 scenario: ${operation} keeps the platform failure class in one failure record, without recursive row writes`,
      {
        error: ErrorClass,
        skip: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 })),
        moves: Schema.Array(Schema.Int).check(Schema.isMinLength(20), Schema.isMaxLength(60)),
      },
      ({ error, skip, moves }) =>
        Effect.gen(function* () {
          const script: Script = { pong: true, open: true, send: true, waiting: operation === "claim", junk: [] };
          const door = peer(script);
          const normalSocket = yield* Socket.WebSocketConstructor.pipe(Effect.provide(door.socket));
          const key = yield* identity;
          const rows: Array<ClientRow> = [];
          let injected = 0;
          let writes = 0;
          let failedRecord: ClientRow["record"] | undefined;
          const op = operation === "sign" ? "key" : operation === "claim" ? "persist" : operation;
          const provided = Layer.mergeAll(
            // The first dial's constructor throws, as a browser's refuses a URL, with the platform's class.
            Layer.succeed(Socket.WebSocketConstructor, (url: string) => {
              if (operation === "connect" && injected++ === 0) {
                return refuse("refused", error);
              }

              return normalSocket(url);
            }),
            Layer.succeed(ClientKey, {
              current: () =>
                Effect.succeed({
                  ...key,
                  sign: (bytes: Uint8Array) =>
                    Effect.suspend(() => {
                      if (operation === "sign") {
                        injected++;
                        return Effect.fail(new ClientKeyError({ op: "sign", error }));
                      }

                      return key.sign(bytes);
                    }),
                }),
              claimPersist: Effect.suspend(() => {
                if (operation === "claim") {
                  injected++;
                  return Effect.fail(new ClientKeyError({ op: "write", error }));
                }

                return Effect.succeed(false);
              }),
              persist: Effect.succeed(true),
            }),
            Layer.succeed(ClientRows, {
              put: (row: ClientRow) =>
                Effect.suspend(() => {
                  rows.push(row);

                  if (operation === "record" && (row.record._tag === "failure" || writes++ === skip)) {
                    injected++;
                    failedRecord ??= row.record;
                    return Effect.fail(new ClientRowsError({ op: "write", error }));
                  }

                  return Effect.void;
                }),
            }),
            Id.Generator.layer,
          );
          const booting = yield* start({ tiles, window, build: BUILD, origin: ORIGIN, client: BROWSER }).pipe(
            Effect.provide(provided),
          );
          const run = yield* booting.ready;

          for (const pick of moves) {
            yield* door.tick(500);
            const state = run.getState();

            if (state.link._tag === "waiting_grant") {
              script.waiting = false;
              door.message({ jsonrpc: "2.0", method: "client.granted", params: { nonce: `grant_${pick}` } });
            } else if (state.link._tag === "online") {
              const open = state.tiles.find((tile) => tile.reach._tag === "open");

              if (open !== undefined) {
                yield* run.dispatch({
                  ...press,
                  tile: open.id,
                  m: { type: "check", name: `item ${Math.abs(pick) % 4}` },
                });
              }
            }
          }

          yield* door.tick(1);
          yield* run.idle();
          expect(injected, "the real service reached the failing operation").toBeGreaterThan(0);
          const failures = rows.filter((row) => row.record._tag === "failure" && row.record.op === op);
          expect(
            failures.map((row) => row.record),
            "one attempt keeps the original platform class",
          ).toEqual([{ _tag: "failure", op, error }]);

          for (const row of rows) {
            expect(Schema.is(ClientRow)(row)).toBe(true);
            expect(row.build).toBe(BUILD);
            expect(row.sentAt.length).toBeGreaterThan(0);
          }

          expect(new Set(rows.map((row) => row.tab)).size).toBe(1);

          if (operation === "record") {
            expect(failedRecord?._tag, "a normal row failed before its failure row").not.toBe("failure");
            expect(injected, "the failed failure row is attempted once and never retries").toBe(2);
            expect(run.getState().link._tag, "row storage cannot stop the window").toBe("online");
          }
        }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
      { arbitrary: { seed: SEED, runs: 300 } },
    );
  }
});

describe("L12: wire formats are refused as typed values", () => {
  it.effect(
    "L12 format: a malformed open_ok.value, a view notice without pid, a refused answer without a string reason, an answer to an unknown id and a broken frame install nothing and stop nothing",
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
        const booting = yield* start({ tiles, window, build: BUILD, origin: ORIGIN, client: BROWSER }).pipe(
          Effect.provide(services(door.socket, [])),
          Scope.provide(scope),
        );
        const run = yield* booting.ready;

        for (let n = 0; n < 6; n++) {
          yield* door.tick(500);
        }

        expect(run.getState().link._tag).toBe("online");
        const opened = door.sent.flatMap((t) => Option.toArray(decodeFrame(t))).find((f) => f.method === "view.open");
        expect(opened, "the page opened its tile").toBeDefined();
        const beforeMalformed = run.getState();
        // The open's answer arrives malformed: an empty struct, then a view of the wrong type.
        door.message({ jsonrpc: "2.0", id: opened?.id, result: {} });
        yield* door.tick(500);
        expect(run.getState().flight, "a malformed open answer settled a flight").toEqual(beforeMalformed.flight);
        door.message({ jsonrpc: "2.0", id: opened?.id, result: { rev: 1, view: { items: "one", left: 1 } } });
        yield* door.tick(500);
        expect(run.getState().client.views, "nothing malformed was installed").toEqual({});
        // The run still folds: a well-formed notice with its pid installs.
        door.message({
          jsonrpc: "2.0",
          method: "view.whole",
          params: { pid: PID, type: "whole", rev: 4, view: list(4) },
        });
        yield* door.tick(500);
        expect(run.getState().client.views[PID]).toEqual({ rev: 4, view: list(4) });
        expect(run.getState().link._tag).toBe("online");
        // A press goes out; its answer comes back refused with no reason, then with a reason that is
        // not a string. Neither is an answer: the letter stays out and no tile shows a refusal.
        script.send = false;
        yield* run.dispatch(press);
        yield* door.tick(500);
        const sends = door.sent
          .flatMap((t) => Option.toArray(decodeFrame(t)))
          .filter((f) => f.method === "process.send");
        expect(sends.length, "the press went out").toBeGreaterThan(0);
        const id = sends.at(-1)!.id;
        door.message({ jsonrpc: "2.0", id, result: { _tag: "refused" } });
        door.message({ jsonrpc: "2.0", id, result: { _tag: "refused", reason: 7 } });
        yield* door.tick(500);
        expect(run.getState().client.pending, "a malformed refusal removed the letter").toHaveLength(1);
        expect(run.getState().tiles.map((t) => t.refusal)).toEqual([null]);
        expect(run.getState().link._tag).toBe("online");
        yield* Scope.close(scope, Exit.void);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );
});

// --- P18 L4: one Effect socket per dial ------------------------------------------------------------

/** The link's socket dial, as the window's model says. */
const socketDialIn = (link: { readonly _tag: string; readonly dial?: number }): number | null =>
  link._tag === "dialing" || link._tag === "waiting_grant" || link._tag === "online" ? (link.dial ?? null) : null;

/** One thing the door, the network or a person does next. A move whose state does not allow it is skipped. */
const Act = Schema.Union([
  Schema.TaggedStruct("open", {}),
  Schema.TaggedStruct("admit", {}),
  Schema.TaggedStruct("beat", {}),
  Schema.TaggedStruct("frame", { text: Schema.Literals(["pong", "{ not json", "[]", "ping"]) }),
  Schema.TaggedStruct("close", {
    code: Schema.Union([
      Schema.Literals([1000, 1001, 1006, 1011, 4003]),
      Schema.Int.check(Schema.isBetween({ minimum: 3000, maximum: 4999 })),
    ]),
  }),
  Schema.TaggedStruct("throw", {}),
  Schema.TaggedStruct("again", {}),
  Schema.TaggedStruct("wait", { ms: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 20_000 })) }),
  // A beat that names a past dial while a newer one is open: the scripted window below answers it
  // with a ping and a write for that past dial, which only that dial's own writer may take.
  Schema.TaggedStruct("stale", {}),
  // The door answers every call written on the live socket and not answered yet, then answers each
  // one again: the second answer shows whether the start still holds the call's write time.
  Schema.TaggedStruct("answer", {}),
]);

/** The number id of a call the start wrote, read from the text it sent. */
const callId = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ id: Schema.Number })));

type FrameMsg = { readonly type: "frame"; readonly dial: number; readonly text: string; readonly ms?: number };

/** The id of the scripted window's write for a past dial, past any id the real window names. */
const STALE = 1_000_000;

/**
 * The real window, except that a beat for a dial its link is not on hands the start a ping and a
 * write for that dial, as a Cmd made before a redial and run after it would. Each one's answer is
 * kept in `answers` before the real window takes it, and each frame the start hands it in `frames`.
 */
const scripted = (
  answers: Array<{ readonly type: string; readonly dial: number }>,
  frames: Array<FrameMsg>,
): typeof window => {
  const real = window.update;
  const kept = (m: { readonly type: string; readonly cmd: { readonly dial: number } }) => {
    answers.push({ type: m.type, dial: m.cmd.dial });
  };
  return {
    ...window,
    update: {
      ...real,
      frame: (s, m) => {
        frames.push(m);
        return real.frame(s, m);
      },
      beat: (s, m) =>
        socketDialIn(s.link) === m.dial
          ? real.beat(s, m)
          : [s, [ping({ dial: m.dial }), write({ call: { _tag: "knock" }, id: STALE, dial: m.dial })]],
      ping_ok: (s, m) => {
        kept(m);
        return real.ping_ok(s, m);
      },
      ping_err: (s, m) => {
        kept(m);
        return real.ping_err(s, m);
      },
      write_ok: (s, m) => {
        kept(m);
        return real.write_ok(s, m);
      },
      write_err: (s, m) => {
        kept(m);
        return real.write_err(s, m);
      },
    },
  };
};

/**
 * The listeners an ended dial's socket still has. Effect 4.1.2's `fromWebSocket` release adds one
 * do-nothing `error` listener on purpose, so a late error of a handshake its release cut stays
 * handled (`effect/src/socket/Socket.ts`, the `fromWebSocket` finalizer). That guard is Effect's
 * own and is counted apart: every other listener of an ended dial is a reader that outlived it.
 */
const leftOn = (ws: MemorySocket) => ({
  readers: (["message", "close", "open", "error"] as const).map(
    (kind) => ws.attached(kind).filter((fn) => fn !== Function.constVoid).length,
  ),
  guards: ws.attached("error").filter((fn) => fn === Function.constVoid).length,
});

describe("P18 L4: one dial is one constructed socket, one reader and one writer", () => {
  it.effect.prop(
    "the start dials once per dialing the link emits, never again by itself; an ended dial's reader and writer are gone; a write or ping with no open writer answers at once; a throw and every close code reach the window as they happened",
    { acts: Schema.Array(Act).check(Schema.isMinLength(10), Schema.isMaxLength(60)) },
    ({ acts }) =>
      Effect.gen(function* () {
        const key = yield* identity;
        const rows: Array<ClientRow> = [];
        const made: Array<{ readonly ws: MemorySocket; readonly dial: number | null; sentBefore: number | null }> = [];
        const answers: Array<{ readonly type: string; readonly dial: number }> = [];
        const frames: Array<FrameMsg> = [];
        // The call ids the door has answered, per socket.
        const replied = new Map<MemorySocket, Set<number>>();
        let read: () => { readonly link: { readonly _tag: string; readonly dial?: number } } = () => ({
          link: { _tag: "dialing", dial: 1 },
        });
        let armed = false;
        let thrown: number | null = null;
        // A hello is signed with real WebCrypto, which TestClock does not move: wait for each one, or
        // for its socket to go, before the virtual clock moves. Two real seconds bound the wait.
        let owed = 0;
        let woken: Deferred.Deferred<void> | null = null;
        const live = () => made.at(-1)?.ws;
        const lower = () => {
          if (woken !== null && (owed <= 0 || live()?.readyState !== 1)) {
            Deferred.doneUnsafe(woken, Effect.void);
            woken = null;
          }
        };
        const quiet = Effect.suspend(() =>
          owed <= 0 || live()?.readyState !== 1
            ? Effect.void
            : Deferred.await((woken ??= Deferred.makeUnsafe<void>())).pipe(
                Effect.raceFirst(TestClock.withLive(Effect.sleep("2 seconds"))),
              ),
        );
        const socket = Layer.succeed(Socket.WebSocketConstructor, (url: string) => {
          const dial = socketDialIn(read().link);

          for (const older of made) {
            older.sentBefore ??= older.ws.sent.length;
          }

          const ws = new MemorySocket(url, {
            send: (text) => {
              owed -= text.includes('"initialize"') ? 1 : 0;
              lower();
            },
            closed: lower,
          });
          owed = 0;
          made.push({ ws, dial, sentBefore: null });

          if (armed) {
            armed = false;
            thrown = dial;
            return refuse("refused", "NetworkError");
          }

          return ws;
        });
        const layers = Layer.mergeAll(
          socket,
          Layer.succeed(ClientKey, {
            current: () => Effect.succeed(key),
            claimPersist: Effect.succeed(false),
            persist: Effect.succeed(true),
          }),
          Layer.succeed(ClientRows, { put: (row: ClientRow) => Effect.sync(() => void rows.push(row)) }),
          Id.Generator.layer,
        );
        const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
        const booting = yield* start({
          tiles,
          window: scripted(answers, frames),
          build: BUILD,
          origin: ORIGIN,
          client: BROWSER,
        }).pipe(Effect.provide(layers), Scope.provide(scope));
        const run = yield* booting.ready;
        read = () => run.getState();
        const settle = Effect.gen(function* () {
          yield* quiet;

          for (let n = 0; n < 5; n++) {
            yield* TestClock.adjust(0);
            yield* Effect.yieldNow;
          }
        });
        yield* settle;

        for (const act of acts) {
          const state = run.getState();
          const dial = socketDialIn(state.link);
          const ws = live();
          let closed: { readonly dial: number; readonly code: number } | null = null;
          let stale: { readonly dial: number; readonly newer: MemorySocket; readonly before: number } | null = null;
          let probe: { readonly ids: ReadonlyArray<number>; readonly first: ReadonlyArray<FrameMsg> } | null = null;
          const past = made.find((m) => m.dial !== null && m.dial !== dial);

          if (act._tag === "open" && ws !== undefined && ws.readyState === 0) {
            ws.open();
            owed++;
            ws.receive(JSON.stringify({ jsonrpc: "2.0", method: "challenge", params: { nonce: "n" } }));
          } else if (act._tag === "admit" && state.link._tag === "dialing" && dial !== null) {
            yield* run.dispatch({ type: "admitted", dial, ping: 30_000, ms: 0 });
          } else if (act._tag === "beat" && state.link._tag === "online" && dial !== null) {
            yield* run.dispatch({ type: "beat", dial });
          } else if (act._tag === "frame" && ws?.readyState === 1) {
            ws.receive(act.text);
          } else if (act._tag === "close" && ws !== undefined && ws.readyState < 2 && dial !== null) {
            closed = { dial, code: act.code };
            ws.drop(act.code);
            lower();
          } else if (act._tag === "throw") {
            armed = true;
          } else if (act._tag === "again" && state.link._tag === "removed") {
            yield* run.dispatch({ type: "ask_again", dial: state.dials + 1 });
          } else if (act._tag === "wait") {
            yield* TestClock.adjust(act.ms);
          } else if (
            act._tag === "stale" &&
            ws !== undefined &&
            ws.readyState < 2 &&
            dial !== null &&
            past !== undefined &&
            past.dial !== null
          ) {
            // A newer dial still connecting opens first, as the door would, so a past dial's Cmd
            // meets a newer writer that could take its bytes.
            if (ws.readyState === 0) {
              ws.open();
              owed++;
              ws.receive(JSON.stringify({ jsonrpc: "2.0", method: "challenge", params: { nonce: "n" } }));
              yield* settle;
            }

            stale = { dial: past.dial, newer: ws, before: ws.sent.length };
            answers.length = 0;
            yield* run.dispatch({ type: "beat", dial: past.dial });
          } else if (act._tag === "answer" && ws?.readyState === 1) {
            const done = replied.get(ws) ?? new Set<number>();
            replied.set(ws, done);
            const ids = ws.sent
              .flatMap((text) => Option.toArray(callId(text)).map((c) => c.id))
              .filter((id) => !done.has(id));
            const replyAll = () => {
              for (const id of ids) {
                ws.receive(JSON.stringify({ jsonrpc: "2.0", id, result: null }));
                done.add(id);
              }
            };
            frames.length = 0;
            replyAll();
            yield* settle;
            const first = frames.splice(0);
            replyAll();
            probe = { ids, first };
          }

          // Every Cmd finishes: a write or ping on a dial with no open writer fails at once.
          const idle = yield* Effect.forkChild(run.idle());
          yield* settle;
          expect(idle.pollUnsafe() !== undefined, `after ${act._tag} a Cmd is still waiting`).toBe(true);
          yield* Fiber.interrupt(idle);
          const after = run.getState();
          const current = socketDialIn(after.link);

          // One constructor call per dial the link is dialing; the start never dials again itself.
          const dials = made.map((m) => m.dial);
          expect(dials.includes(null), "a socket was made with no dial to make it for").toBe(false);
          expect(new Set(dials).size, `dials made ${JSON.stringify(dials)}`).toBe(dials.length);

          for (const m of made) {
            expect(m.ws.readers, `dial ${m.dial} has more than one reader`).toBeLessThanOrEqual(1);

            if (m.sentBefore !== null) {
              expect(m.ws.sent.length, `dial ${m.dial} took a write after a newer dial`).toBe(m.sentBefore);
            }

            if (m.dial !== current) {
              const left = leftOn(m.ws);
              expect(left.readers, `dial ${m.dial}'s reader outlived it`).toEqual([0, 0, 0, 0]);
              expect(left.guards, `dial ${m.dial} has more than Effect's one error guard`).toBeLessThanOrEqual(1);
            }
          }

          // A ping and a write for a past dial fail at once, and no byte of theirs reaches the newer dial.
          if (stale !== null) {
            expect(answers, `the ping and the write for past dial ${stale.dial}`).toEqual([
              { type: "ping_err", dial: stale.dial },
              { type: "write_err", dial: stale.dial },
            ]);
            expect(stale.newer.sent.slice(stale.before), "the newer dial took a past dial's bytes").toEqual([]);
          }

          // A written call's time lives until its answer: the first answer is timed, and once every
          // written call is answered the start holds no write time, so a second answer is untimed.
          if (probe !== null) {
            const timed = (list: ReadonlyArray<FrameMsg>) =>
              list.map((f) => [Option.getOrUndefined(callId(f.text))?.id, f.ms !== undefined]);
            expect(timed(probe.first), "each first answer is timed from its write").toEqual(
              probe.ids.map((id) => [id, true]),
            );
            expect(timed(frames), "the start still holds an answered call's write time").toEqual(
              probe.ids.map((id) => [id, false]),
            );
          }

          if (closed !== null) {
            const connect = rows.filter((r) => r.record._tag === "connect" && r.record.dial === closed.dial).at(-1);
            expect(connect?.record, `close ${closed.code} on dial ${closed.dial}`).toMatchObject({
              _tag: "connect",
              result: closed.code === 4003 ? "removed" : "closed",
              code: closed.code,
            });
          }

          if (thrown !== null) {
            const failures = rows.filter((r) => r.record._tag === "failure" && r.record.op === "connect");
            expect(failures.length, "the throw left no failure row").toBeGreaterThan(0);
            expect(Schema.is(ErrorClass)(Reflect.get(failures.at(-1)!.record, "error"))).toBe(true);
            expect(
              rows.find((r) => r.record._tag === "connect" && r.record.dial === thrown)?.record,
              "the throw did not close its dial with 1006",
            ).toMatchObject({ result: "closed", code: 1006 });
            thrown = null;
          }
        }

        yield* Scope.close(scope, Exit.void);
        yield* settle;

        for (const m of made) {
          const left = leftOn(m.ws);
          expect(left.readers, `dial ${m.dial} kept a listener past the scope`).toEqual([0, 0, 0, 0]);
          expect(left.guards, `dial ${m.dial} has more than Effect's one error guard`).toBeLessThanOrEqual(1);
        }

        const refused = yield* run.dispatch(press).pipe(Effect.flip);
        expect(refused._tag, "a stopped start refuses a press").toBe("Stopped");
      }).pipe(Effect.scoped, Random.withSeed(SEED), Effect.provide(TestClock.layer())),
    // A red walk may leave a Cmd that never ends, and each shrink waits two real seconds on it.
    { arbitrary: { seed: SEED, runs: 100, maxShrinks: 10 } },
  );
});

// --- P18 L5 [secrets]: nothing secret leaves --------------------------------------------------------

/** A recording tracer: every span the start makes, with its attributes and events. */
const recording = (spans: Array<Tracer.AnySpan>) =>
  Effect.map(Effect.tracer, (native) =>
    Tracer.make({
      span: (options) => {
        const span = native.span(options);
        spans.push(span);
        return span;
      },
    }),
  );

/** The ways a secret can be written out: as it is, URL-encoded, and JSON-escaped. */
const forms = (secret: string) => [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)];

const Secret = Schema.String.check(Schema.isMinLength(4), Schema.isMaxLength(24));

describe("P18 L5 [secrets]: no row, span, URL or failure holds a secret", () => {
  it.effect.prop(
    "nonces, input bodies, signatures, frame texts and key bytes never reach a row, a span or a dial's URL, which holds only the fingerprint and the tab",
    { nonce: Secret, body: Secret, signature: Secret, frame: Secret, failure: Secret },
    (generated) =>
      Effect.gen(function* () {
        // Marked, so a secret is never a word the start writes anyway.
        const s = Object.fromEntries(
          Object.entries(generated).map(([k, v]) => [k, `Q9X${k}${v}Z`]),
        ) as typeof generated;
        const spans: Array<Tracer.AnySpan> = [];
        const tracer = yield* recording(spans);
        const script: Script = {
          pong: true,
          open: true,
          send: true,
          junk: [
            () => `{ not json ${s.frame}`,
            () =>
              JSON.stringify({
                jsonrpc: "2.0",
                method: "view.whole",
                params: { pid: PID, type: "whole", rev: 1, view: list(1), note: s.frame },
              }),
            () =>
              JSON.stringify({ jsonrpc: "2.0", id: 999_999, error: { message: s.frame, data: { reason: s.frame } } }),
          ],
        };
        const door = peer(
          script,
          () => {},
          (n) => `${s.nonce}${n}`,
        );
        const key = yield* identity;
        const rows: Array<ClientRow> = [];
        const urls: Array<string> = [];
        let first = true;
        const normal = yield* Socket.WebSocketConstructor.pipe(Effect.provide(door.socket));
        const layers = Layer.mergeAll(
          // The first dial's constructor throws with a secret in its message; the retry dials as usual.
          Layer.succeed(Socket.WebSocketConstructor, (url: string) => {
            urls.push(url);

            if (first) {
              first = false;
              return refuse(s.failure, "SecurityError");
            }

            return normal(url);
          }),
          Layer.succeed(ClientKey, {
            current: () =>
              Effect.succeed({
                ...key,
                sign: () => Effect.succeed(new TextEncoder().encode(s.signature)),
              }),
            claimPersist: Effect.succeed(false),
            persist: Effect.succeed(true),
          }),
          Layer.succeed(ClientRows, { put: (row: ClientRow) => Effect.sync(() => void rows.push(row)) }),
          Id.Generator.layer,
        );
        const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
        const booting = yield* start({ tiles, window, build: BUILD, origin: ORIGIN, client: BROWSER }).pipe(
          Effect.provide(layers),
          Scope.provide(scope),
          Effect.withTracer(tracer),
        );
        const run = yield* booting.ready;

        for (let n = 0; n < 12 && run.getState().tiles[0]?.reach._tag !== "open"; n++) {
          yield* door.tick(1_000);
        }

        expect(run.getState().tiles[0]?.reach._tag, "the tile opened").toBe("open");
        yield* run.dispatch({ type: "press", tile: "tile_1", m: { type: "add", name: s.body }, via: "button" });

        for (let n = 0; n < 4; n++) {
          yield* door.tick(1_000);
        }

        // The door drops the dial after its challenge and hello, so the start dials again with a
        // nonce already seen: a later URL could carry it.
        expect(urls, "the throw, then its retry").toHaveLength(2);
        door.drop(1006);

        for (let n = 0; n < 30 && (urls.length < 3 || run.getState().link._tag !== "online"); n++) {
          yield* door.tick(1_000);
        }

        expect(run.getState().link._tag, "the third dial went online").toBe("online");
        // The walk's last frame carries a secret too, so a copy of only the last frame shows.
        door.message({ jsonrpc: "2.0", method: "view.patch", params: { pid: PID, type: "patch", note: s.frame } });
        yield* door.tick(0);
        yield* Scope.close(scope, Exit.void);
        const hello = door.sent.flatMap((t) => Option.toArray(decodeFrame(t))).find((f) => f.method === "initialize");
        const signed = String(Reflect.get(Object(hello?.params), "signed") ?? "");
        const tab = String(Reflect.get(Object(hello?.params), "tab") ?? "");
        expect(signed.length, "the hello was signed").toBeGreaterThan(0);
        expect(
          door.sent.some((t) => forms(s.body).some((form) => t.includes(form))),
          "the press reached the door",
        ).toBe(true);
        // Every span the start made is its own, a `Span` with a name: an external one is a parent
        // passed in, which this run never had.
        const own = spans.filter((span): span is Tracer.Span => span._tag === "Span");
        expect(own.length, "a span the start made is not its own").toBe(spans.length);
        const outputs = {
          rows: JSON.stringify(rows),
          spans: JSON.stringify(
            own.map((span) => ({
              name: span.name,
              attributes: [...span.attributes],
              events: Reflect.get(span, "events") ?? [],
            })),
          ),
          urls: JSON.stringify([...urls, ...urls.map((u) => decodeURIComponent(u))]),
        };
        const secrets = [...Object.values(s).flatMap(forms), ...forms(signed), ...forms(key.raw)];

        for (const [output, text] of Object.entries(outputs)) {
          expect(
            secrets.filter((secret) => text.includes(secret)),
            `${output} holds a secret`,
          ).toEqual([]);
        }

        // A dial's URL is the origin's socket path, the fingerprint and the tab, and nothing else.
        const ws = ORIGIN.replace(/^http/, "ws");
        expect(
          urls.length,
          "the start dialed three times: the throw, its retry, and after the drop",
        ).toBeGreaterThanOrEqual(3);

        for (const url of urls) {
          expect(url).toBe(`${ws}/client/${encodeURIComponent(key.fingerprint)}/${encodeURIComponent(tab)}`);
        }

        expect(
          rows.filter((r) => r.record._tag === "failure" && r.record.op === "connect").length,
          "the throw wrote its failure row",
        ).toBe(1);
      }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
    { arbitrary: { seed: SEED, runs: 100 } },
  );
});
