// T703, next/. The connection driver keeps its save and callback order while a tea machine owns
// its busy state and waits (0037, 0046). Callbacks only: no database, no runtime. Each walk reads
// the saved attachment and the pending callbacks before it picks the next move (0093).
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Schema } from "effect";
import * as fc from "fast-check";
import { connection } from "./Connection.ts";
import { Answer, Attached, Wait } from "./Wire.ts";

const SEED = 119120;
const RUNS = 100;
const READER = "gateway/session-1";
const SESSION = "session-1";
const PING = 42;

type Saved = typeof Attached.Type;
type W = typeof Wait.Type;
type Waited = { readonly _tag: "ready"; readonly rev: number } | { readonly _tag: "parked" };
type Frame = { readonly id: string | number; readonly result?: unknown; readonly error?: { readonly message: string } };

type Event =
  | { readonly _tag: "save"; readonly saved: Saved }
  | { readonly _tag: "send"; readonly frame: Frame }
  | { readonly _tag: "close"; readonly code: number }
  | {
      readonly _tag: "wait";
      readonly stream: string;
      readonly after: number;
      readonly reader: string;
      readonly saved: Saved;
    }
  | { readonly _tag: "call"; readonly method: string; readonly saved: Saved };

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const at = <A>(list: ReadonlyArray<A>, pick: number) => list[pick % list.length]!;
const restored = (saved: Saved) => Schema.decodeUnknownSync(Attached)(JSON.parse(JSON.stringify(saved)));

const online = (busy = false, waits: ReadonlyArray<W> = []) =>
  Attached.cases.online.make({
    client: READER,
    identity: { key: "SHA256:test", person: "person-test", as: "window" },
    version: 1,
    waits,
    watching: false,
    busy,
  });

const waitFrame = (id: string | number, params: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "ledger.wait", params });

const callFrame = (id: string | number, method: string) => JSON.stringify({ jsonrpc: "2.0", id, method, params: {} });

/** Let every forked fiber run until it waits on a callback the walk has not released. */
const settle = Effect.gen(function* () {
  for (let n = 0; n < 64; n++) {
    yield* Effect.yieldNow;
  }
});

type Pending<A> = { readonly label: string; readonly reply: Deferred.Deferred<A, { readonly reason?: string }> };

/** One driver over callbacks that record each save, send and call in order. */
const harness = (first: Saved) => {
  let saved = first;
  let calling = 0;
  let most = 0;
  const log: Array<Event> = [];
  const waits: Array<Pending<Waited> & { readonly stream: string; readonly after: number }> = [];
  const calls: Array<Pending<typeof Answer.Type>> = [];
  const reentrant = new Set<string>();
  let ring: (stream: string, rev: number) => Effect.Effect<void> = () => Effect.void;
  const c = connection<{ readonly reason?: string }>({
    reader: READER,
    session: SESSION,
    ping: () => PING,
    read: () => saved,
    save: (a) => {
      saved = a;
      log.push({ _tag: "save", saved: a });
    },
    send: (text) => {
      log.push({ _tag: "send", frame: JSON.parse(text) });
    },
    close: (code) => {
      log.push({ _tag: "close", code });
    },
    wait: (stream, after, reader) =>
      Effect.gen(function* () {
        log.push({ _tag: "wait", stream, after, reader, saved });
        const key = `${stream}|${after}`;

        if (reentrant.delete(key)) {
          // A ring that arrives over RPC before registration returns.
          yield* ring(stream, after + 1);
          return { _tag: "parked" } as const;
        }

        const reply = yield* Deferred.make<Waited, { readonly reason?: string }>();
        waits.push({ label: key, stream, after, reply });
        return yield* Deferred.await(reply);
      }),
    call: (method) =>
      Effect.gen(function* () {
        log.push({ _tag: "call", method, saved });
        calling += 1;
        most = Math.max(most, calling);
        const reply = yield* Deferred.make<typeof Answer.Type, { readonly reason?: string }>();
        calls.push({ label: method, reply });
        const answer = yield* Deferred.await(reply);
        calling -= 1;
        return answer;
      }),
  });
  ring = c.ring;
  const run = (effect: Effect.Effect<unknown, unknown>) =>
    Effect.gen(function* () {
      yield* Effect.forkChild(effect);
      yield* settle;
    });
  return { c, log, waits, calls, reentrant, run, saved: () => saved, most: () => most };
};

const streams = ["events", "counter:1/inbox", "ünï/流"];

const Choice = fc.record({
  move: fc.nat({ max: 99 }),
  pick: fc.nat(),
  id: fc.oneof(fc.string({ maxLength: 3 }), fc.integer({ min: 0, max: 40 })),
  stream: fc.constantFrom(...streams),
  after: fc.nat({ max: 6 }),
  rev: fc.integer({ min: 1, max: 9 }),
  reason: fc.option(fc.constantFrom("unreachable", "closed", "bad_stream"), { nil: undefined }),
});
type Choice = typeof Choice extends fc.Arbitrary<infer A> ? A : never;
const Walk = fc.array(Choice, { minLength: 1, maxLength: 60, size: "max" });

/** Did a saved attachment admit this wait, by the limits the driver had before the machine. */
const admits = (saved: Saved, wait: W) => {
  if (saved._tag !== "online") {
    return false;
  }

  const next = { ...saved, waits: [...saved.waits, wait] };
  return !saved.waits.some((w) => w.id === wait.id) && next.waits.length <= 64 && bytes(next) <= 16_384;
};

const answers = (log: ReadonlyArray<Event>, from: number) =>
  log.slice(from).flatMap((e) => (e._tag === "send" ? [e.frame] : []));

describe("T703 connection driver laws", () => {
  it("save and callback order survives reentrant rings and delayed ordinary calls", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(Walk, (choices) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const h = harness(online());

            for (const choice of choices) {
              const now = h.saved();
              const held = now._tag === "online" ? now.waits : [];
              const { move, pick } = choice;
              const from = h.log.length;

              if (move < 30) {
                // A wait: a fresh id, a saved id again, or one already answered.
                const id = move < 8 && held.length > 0 ? at(held, pick).id : choice.id;
                const wait = Wait.make({ id, stream: choice.stream, after: choice.after });
                const ok = admits(now, wait);

                if (ok && move % 3 === 0) {
                  h.reentrant.add(`${wait.stream}|${wait.after}`);
                  seen.add("reentrant");
                }

                yield* h.run(h.c.frame(waitFrame(id, { stream: wait.stream, after: wait.after })));
                const refused = answers(h.log, from).filter(
                  (f) => f.id === id && f.error?.message === "too_many_waits",
                );
                expect(refused).toHaveLength(ok ? 0 : 1);
                const registered = h.log.slice(from).find((e) => e._tag === "wait");

                if (ok) {
                  seen.add("admitted");
                  // Saved before registration: the callback already reads the new wait.
                  expect(registered).toMatchObject({
                    _tag: "wait",
                    reader: READER,
                    stream: wait.stream,
                    after: wait.after,
                  });
                  expect(
                    registered?._tag === "wait" && registered.saved._tag === "online" && registered.saved.waits,
                  ).toContainEqual(wait);
                } else {
                  seen.add("refused");
                  expect(registered).toBeUndefined();
                }
              } else if (move < 45) {
                // An ordinary call, delayed until the walk releases it.
                yield* h.run(h.c.frame(callFrame(`call:${choice.id}`, "process.send")));
                seen.add("call");
              } else if (move < 60 && h.calls.length > 0) {
                const [call] = h.calls.splice(pick % h.calls.length, 1);
                const answer =
                  move % 2 === 0 ? Answer.cases.ok.make({ result: null }) : Answer.cases.refused.make({ reason: "x" });
                yield* Deferred.succeed(call!.reply, answer);
                yield* settle;
                const after = h.log.slice(from);
                const sent = after.findIndex((e) => e._tag === "send");
                const idle = after.findIndex((e) => e._tag === "save" && e.saved._tag === "online" && !e.saved.busy);
                // The response goes out first; only then is busy cleared.
                expect(sent).toBeGreaterThanOrEqual(0);
                expect(idle).toBeGreaterThan(sent);
                seen.add("released");
              } else if (move < 78 && h.waits.length > 0) {
                const [wait] = h.waits.splice(pick % h.waits.length, 1);

                if (move < 64) {
                  yield* Deferred.fail(wait!.reply, choice.reason === undefined ? {} : { reason: choice.reason });
                  seen.add("failed");
                } else if (move < 71) {
                  yield* Deferred.succeed(wait!.reply, { _tag: "ready", rev: wait!.after + choice.rev });
                  seen.add("ready");
                } else {
                  yield* Deferred.succeed(wait!.reply, { _tag: "parked" });
                }

                yield* settle;
              } else {
                const stream = held.length > 0 && move % 2 === 0 ? at(held, pick).stream : choice.stream;
                const rev = choice.rev;
                yield* h.run(h.c.ring(stream, rev));
                const left = h.saved();
                // Every wait the ring could answer is answered.
                expect(
                  left._tag === "online" && left.waits.filter((w) => w.stream === stream && rev > w.after),
                ).toEqual([]);
                seen.add("ring");
              }

              // Ordinary calls never overlap; a call starts only after busy is saved.
              expect(h.most()).toBeLessThanOrEqual(1);

              for (const e of h.log.slice(from)) {
                if (e._tag === "call") {
                  expect(e.saved).toMatchObject({ _tag: "online", busy: true });
                }
              }
            }

            // Park every registration left, then check that no admitted wait was lost or answered twice.
            for (const wait of h.waits.splice(0)) {
              yield* Deferred.succeed(wait.reply, { _tag: "parked" });
            }

            while (h.calls.length > 0) {
              yield* Deferred.succeed(h.calls.shift()!.reply, Answer.cases.ok.make({ result: null }));
              yield* settle;
            }

            const end = h.saved();
            const replies = new Map<string | number, number>();

            for (const e of h.log) {
              if (
                e._tag === "send" &&
                e.frame.error?.message !== "too_many_waits" &&
                (e.frame.error !== undefined || isRev(e.frame.result))
              ) {
                replies.set(e.frame.id, (replies.get(e.frame.id) ?? 0) + 1);
              }
            }

            const waiting = new Map<string | number, number>();

            for (const w of end._tag === "online" ? end.waits : []) {
              waiting.set(w.id, (waiting.get(w.id) ?? 0) + 1);
            }

            for (const [id, n] of admittedTotals(h.log)) {
              expect((replies.get(id) ?? 0) + (waiting.get(id) ?? 0), `wait ${String(id)}`).toBe(n);
            }

            expect(end).toMatchObject({ busy: false });
          }),
        ),
      ),
      { seed: SEED, numRuns: RUNS },
    );

    for (const side of ["admitted", "refused", "reentrant", "call", "released", "failed", "ready", "ring"]) {
      expect(seen, side).toContain(side);
    }
  });

  it("wake, probe and pre-hello frames keep their results on every observed attachment", async () => {
    const seen = new Set<string>();
    const observation = fc.oneof(
      fc.constant(Attached.cases.new.make({ client: READER, nonce: "fresh" })),
      fc.constant(
        Attached.cases.waiting.make({
          client: READER,
          key: "SHA256:test",
          nonce: "fresh",
          hello: {
            versions: [1],
            has: [],
            ping: "p",
            key: "SHA256:test",
            tab: "t",
            nonce: "fresh",
            platform: "browser",
            os: "macos",
            sentAt: "2026-11-11T00:00:00Z",
            signed: "s",
          },
        }),
      ),
      fc.boolean().map((busy) => online(busy, [Wait.make({ id: "w", stream: "events", after: 1 })])),
    );
    const Step = fc.record({
      move: fc.nat({ max: 99 }),
      observation,
      other: fc.uuid(),
      id: fc.oneof(fc.string(), fc.integer()),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(Step, { minLength: 1, maxLength: 40, size: "max" }), (steps) =>
        Effect.runPromise(
          Effect.gen(function* () {
            let h = harness(online());

            for (const { move, observation, other, id } of steps) {
              const now = h.saved();
              const from = h.log.length;

              if (move < 20) {
                // A restart: the saved attachment, through JSON, read by a new connection.
                h = harness(restored(move < 10 ? observation : now));
                seen.add(`restored:${h.saved()._tag}`);
              } else if (move < 35) {
                yield* h.c.wake();
                const closed = h.log.slice(from).filter((e) => e._tag === "close");
                expect(closed).toEqual(now._tag === "online" && now.busy ? [{ _tag: "close", code: 1012 }] : []);
                seen.add(`wake:${closed.length}`);
              } else if (move < 50) {
                const session = move % 2 === 0 ? SESSION : other;
                const ping = yield* h.c.probe(session);
                expect(ping).toBe(session === SESSION && now._tag === "online" ? PING : null);
                seen.add(`probe:${ping}`);
              } else if (move < 65) {
                const method = at(["initialize", "gateway.knock", "process.send"], move);
                yield* h.run(h.c.frame(callFrame(id, method)));

                for (const call of h.calls.splice(0)) {
                  yield* Deferred.succeed(call.reply, Answer.cases.ok.make({ result: { method } }));
                }

                yield* settle;
                const after = h.log.slice(from);
                const handshake = method !== "process.send";

                if (now._tag === "online") {
                  expect(after.map((e) => e._tag)).toEqual(["save", "call", "send", "save"]);
                  expect(h.saved()).toEqual({ ...now, busy: false });
                } else if (handshake) {
                  // Before hello only the handshake reaches the call, and nothing is saved.
                  expect(after).toEqual([
                    { _tag: "call", method, saved: now },
                    { _tag: "send", frame: { jsonrpc: "2.0", id, result: { method } } },
                  ]);
                } else {
                  expect(after).toEqual([no(id, "no_hello")]);
                }

                seen.add(`call:${now._tag}:${handshake}`);
              } else if (move < 80) {
                const bad = move % 3 === 0;
                yield* h.run(h.c.frame(waitFrame(id, bad ? { stream: 1, after: -1 } : { stream: "s", after: 0 })));

                if (now._tag !== "online") {
                  expect(h.log.slice(from)).toEqual([no(id, "no_hello")]);
                } else if (bad) {
                  expect(h.log.slice(from)).toEqual([no(id, "bad_input")]);
                }

                for (const wait of h.waits.splice(0)) {
                  yield* Deferred.succeed(wait.reply, { _tag: "parked" });
                }

                yield* settle;
                seen.add(`wait:${now._tag}:${bad}`);
              } else {
                // Frames that are not requests are dropped without a reply.
                yield* h.run(h.c.frame(move % 2 === 0 ? "{" : JSON.stringify({ id, method: 7 })));
                expect(h.log.slice(from)).toEqual([]);
                seen.add("junk");
              }

              // Only a restart changes which state the attachment is in.
              expect(move < 20 || h.saved()._tag === now._tag).toBe(true);
            }
          }),
        ),
      ),
      { seed: SEED, numRuns: RUNS },
    );

    for (const side of [
      "restored:new",
      "restored:waiting",
      "restored:online",
      "wake:0",
      "wake:1",
      "probe:42",
      "probe:null",
      "call:online:false",
      "call:new:true",
      "call:waiting:false",
      "wait:new:false",
      "wait:online:true",
      "junk",
    ]) {
      expect(seen, side).toContain(side);
    }
  });
});

const isRev = (result: unknown) => typeof result === "object" && result !== null && "rev" in result;

const no = (id: string | number, reason: string) => ({
  _tag: "send",
  frame: { jsonrpc: "2.0", id, error: { code: -32000, message: reason, data: { reason } } },
});

/** Admitted waits per id: each save that grew the waits by one added that wait. */
const admittedTotals = (log: ReadonlyArray<Event>) => {
  const totals = new Map<string | number, number>();
  let before: ReadonlyArray<W> = [];

  for (const e of log) {
    if (e._tag !== "save" || e.saved._tag !== "online") {
      continue;
    }

    const now = e.saved.waits;

    if (now.length === before.length + 1) {
      const added = now[now.length - 1]!;
      totals.set(added.id, (totals.get(added.id) ?? 0) + 1);
    }

    before = now;
  }

  return totals;
};
