// p23/p82: answerFrame(text, attachment, admit, route). A failed route stays retryable; a parked
// wait is data. Plants: answer a notification; route before initialize; turn a failure into err.
import { assert, describe, expect, it, vi } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import * as T from "./index.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

class Offline extends Schema.TaggedError<Offline>()("Offline", {}) {}

type Route = (method: string, params: unknown, who: typeof T.Who.Type) => Effect.Effect<typeof T.Answer.Type, Offline>;

const online = () =>
  T.Attached.cases.online.make({
    client: "c1",
    who: { key: "SHA256:checked", person: PERSON, as: "window" },
    version: 2,
    waits: [],
    watching: false,
    busy: false,
  });

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

// Method names the door and the ledger answer today, and two near misses of door.knock.
const METHODS = [
  "door.knock",
  "door.watch",
  "door.grant",
  "door.deny",
  "door.input",
  "door.initialize",
  "ledger.read",
  "ledger.append",
  "ledger.wait",
  "process.send",
  "process.start",
  "process.exit",
  "spans.read",
  // P14: a browser's record call before its hello is answered no_hello like every other method.
  "client.record",
  "session.end",
  "Door.knock",
  "door.knock ",
] as const;

const unauthenticated = fc.oneof(
  fc.record({ client: fc.string(), nonce: fc.string() }).map((a) => T.Attached.cases.new.make(a)),
  fc
    .record({
      client: fc.string(),
      key: fc.string(),
      nonce: fc.string(),
      hello: fc.record({
        versions: fc.array(fc.integer({ min: 1, max: 9 })),
        has: fc.array(fc.string()),
        ping: fc.string(),
        key: fc.string(),
        tab: fc.string(),
        nonce: fc.string(),
        platform: fc.constantFrom("browser", "electron", "headless"),
        os: fc.constantFrom("macos", "windows", "linux", "android", "ios", "unknown"),
        sentAt: fc.string(),
        signed: fc.string(),
      }),
    })
    .map((a) => T.Attached.cases.waiting.make(a)),
);

const admit = () => Effect.die("online routing must not repeat hello admission");

const frame = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: "r1",
    method: "ledger.read",
    params: { stream: "x", after: 0 },
    ...over,
  });

describe("P10 JSON-RPC", () => {
  it.effect("p23: numeric reply id zero is preserved, not mistaken for a notification", () =>
    Effect.gen(function* () {
      const result = yield* T.answerFrame(frame({ id: 0 }), online(), admit, () =>
        Effect.succeed(T.Answer.cases.ok.make({ result: null })),
      );
      expect(JSON.parse(result.send!)).toEqual({ jsonrpc: "2.0", id: 0, result: null });
    }),
  );

  for (const mode of ["ok", "refused"] as const) {
    it.effect.prop(
      `p23: ${mode} has one matching reply`,
      { generated: T.Answer.cases.refused },
      ({ generated }) =>
        Effect.forEach(
          [T.Answer.cases.refused.make({ reason: "stale" }), generated],
          (value) =>
            Effect.gen(function* () {
              const answer = mode === "ok" ? T.Answer.cases.ok.make({ result: { rows: [1] } }) : value;
              const route = vi.fn(() => Effect.succeed(answer));
              const result = yield* T.answerFrame(frame(), online(), admit, route);
              expect(result.send).not.toBeNull();
              const reply = JSON.parse(result.send!);
              expect(reply).toMatchObject({ jsonrpc: "2.0", id: "r1" });
              expect(mode === "ok" ? reply.result : reply.error.data).toEqual(
                mode === "ok" ? { rows: [1] } : { reason: value.reason },
              );
              expect(route).toHaveBeenCalledOnce();
              assert(result.attached._tag === "online");
              expect(result.attached.waits).toEqual([]);
            }),
          { concurrency: 1, discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  for (const mode of ["failure", "defect"] as const) {
    it.effect(`p23: ${mode} sends nothing and permits a real retry`, () =>
      Effect.gen(function* () {
        const attached = online();
        const first = mode === "failure" ? Effect.fail(new Offline({})) : Effect.die("route crashed");
        const route = vi
          .fn<Route>()
          .mockReturnValueOnce(first)
          .mockReturnValueOnce(Effect.succeed(T.Answer.cases.ok.make({ result: "recovered" })));
        const failed = yield* T.answerFrame(frame(), attached, admit, route);
        expect(failed).toEqual({ send: null, attached });
        const retried = yield* T.answerFrame(frame(), failed.attached, admit, route);
        expect(JSON.parse(retried.send!)).toMatchObject({ id: "r1", result: "recovered" });
        expect(route).toHaveBeenCalledTimes(2);
      }),
    );
  }

  for (const text of [
    "{",
    "null",
    "[]",
    JSON.stringify({ jsonrpc: "2.0", id: "r1", result: 7 }),
    JSON.stringify({ jsonrpc: "2.0", method: "news", params: {} }),
  ]) {
    it.effect(`p23: no reply for junk, response or notification ${text}`, () =>
      Effect.gen(function* () {
        const route = vi.fn(() => Effect.succeed(T.Answer.cases.ok.make({ result: null })));
        expect((yield* T.answerFrame(text, online(), admit, route)).send).toBeNull();
      }),
    );
  }

  // d2/p23: a connection that is not online never reaches a route. Every request gets one
  // no_hello error with its own id, and the attachment stays as it was. The one way through
  // is a waiting client's door.knock: its handler runs once with the params, and its answer is
  // the one reply. Plants: drop the request silently; let waiting reach any method; answer
  // no_hello to a waiting knock; pass a third argument to the knock handler.
  it("d2: for any unauthenticated state, method and id, only a waiting door.knock is routed", async () => {
    await fc.assert(
      fc.asyncProperty(
        unauthenticated,
        fc.oneof(fc.constant("door.knock"), fc.constantFrom(...METHODS), fc.string()),
        fc.oneof(fc.string(), fc.integer()),
        fc.jsonValue(),
        fc.jsonValue(),
        (attached, method, id, params, answer) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const route = vi.fn((..._: ReadonlyArray<unknown>) =>
                Effect.succeed(T.Answer.cases.ok.make({ result: answer })),
              );
              const result = yield* T.answerFrame(frame({ id, method, params }), attached, admit, route);
              expect(result.send).not.toBeNull();
              expect(result.attached).toEqual(attached);
              const wire = <A>(value: A): A => JSON.parse(JSON.stringify(value));

              if (attached._tag === "waiting" && method === "door.knock") {
                expect(route.mock.calls).toEqual([["door.knock", wire(params)]]);
                expect(JSON.parse(result.send!)).toEqual({
                  jsonrpc: "2.0",
                  id,
                  result: wire(answer),
                });
              } else {
                expect(route).not.toHaveBeenCalled();
                expect(JSON.parse(result.send!)).toEqual({
                  jsonrpc: "2.0",
                  id,
                  error: { code: -32000, message: "no_hello", data: { reason: "no_hello" } },
                });
              }
            }),
          ),
      ),
      { seed: SEED, endOnFailure: true, numRuns: 300 },
    );
  });
  // d2: a waiting knock whose handler parks sends nothing and the client stays waiting, as it
  // was. Only an online client keeps a parked wait. Plant: treat every parked answer as online.
  it("d2: for any waiting state, a knock that parks sends nothing and leaves it waiting", async () => {
    await fc.assert(
      fc.asyncProperty(
        unauthenticated.filter((a) => a._tag === "waiting"),
        fc.oneof(fc.string(), fc.integer()),
        fc.string(),
        fc.nat(),
        (attached, id, stream, after) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const result = yield* T.answerFrame(frame({ id, method: "door.knock" }), attached, admit, () =>
                Effect.succeed(T.Answer.cases.parked.make({ stream, after })),
              );
              expect(result).toEqual({ send: null, attached });
            }),
          ),
      ),
      { seed: SEED, endOnFailure: true, numRuns: 100 },
    );
  });

  for (const id of ["r1", 0]) {
    it.effect(`p23: parked wait retains reply id ${id} and cursor, with no unresolved work`, () =>
      Effect.gen(function* () {
        const result = yield* T.answerFrame(frame({ id }), online(), admit, () =>
          Effect.succeed(T.Answer.cases.parked.make({ stream: "x", after: 8 })),
        );
        expect(result.send).toBeNull();
        assert(result.attached._tag === "online");
        expect(result.attached.waits).toEqual([{ id, stream: "x", after: 8 }]);
        expect(JSON.parse(JSON.stringify(result.attached))).toEqual(result.attached);
      }),
    );
  }

  it.effect("p82: additive request fields leave the reply id and checked writer alone", () =>
    Effect.gen(function* () {
      const route = vi.fn((_method: string, _params: unknown, _who: typeof T.Who.Type) =>
        Effect.succeed(T.Answer.cases.ok.make({ result: null })),
      );
      const attached = online();
      const result = yield* T.answerFrame(frame({ future: { by: "forged" } }), attached, admit, route);
      expect(JSON.parse(result.send!)).toMatchObject({ id: "r1", result: null });
      expect(route.mock.calls[0]?.[2]).toEqual(attached.who);
    }),
  );
});
