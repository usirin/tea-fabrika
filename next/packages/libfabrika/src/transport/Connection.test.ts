// T703, next/. The connection driver keeps its save and callback order while a tea machine owns
// its busy state and waits (0037, 0046). Callbacks only: no database, no runtime. Each walk reads
// the saved attachment and the pending callbacks before it picks the next move (0093).
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Result, Schema, Tracer } from "effect";
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

type Frame = {
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: { readonly message: string; readonly data?: { readonly reason: string } };
};

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
  | { readonly _tag: "call"; readonly method: string; readonly params: unknown; readonly saved: Saved };

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

// A wait or call may fail with any value: the connection reads its reason by itself (T737 D3).
type Pending<A> = { readonly label: string; readonly reply: Deferred.Deferred<A, unknown> };

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
  const c = connection<unknown>({
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

        const reply = yield* Deferred.make<Waited, unknown>();
        waits.push({ label: key, stream, after, reply });
        return yield* Deferred.await(reply);
      }),
    call: (method, params) =>
      Effect.gen(function* () {
        log.push({ _tag: "call", method, params, saved });
        calling += 1;
        most = Math.max(most, calling);
        const reply = yield* Deferred.make<typeof Answer.Type, unknown>();
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

it.effect.prop(
  "0140 frame: only a reserved answer tags the enclosing frame for counting instead of saving",
  {
    kind: Schema.Literals(["reserved", "bad_input", "ok"]),
    id: Schema.String,
    params: Schema.Json,
  },
  ({ kind, id, params }) =>
    Effect.gen(function* () {
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const h = harness(online());
      yield* h
        .run(h.c.frame(JSON.stringify({ jsonrpc: "2.0", id, method: "process.send", params })))
        .pipe(Effect.withTracer(tracer));
      expect(h.calls).toHaveLength(1);
      const answer =
        kind === "ok" ? Answer.cases.ok.make({ result: params }) : Answer.cases.refused.make({ reason: kind });
      yield* Deferred.succeed(h.calls[0]!.reply, answer);
      yield* settle;
      expect(answers(h.log, 0)).toEqual([kind === "ok" ? { jsonrpc: "2.0", id, result: params } : no(id, kind).frame]);
      expect(h.saved()).toEqual(online());
      const frames = spans.filter((span) => span.name === "connection.frame");
      expect(frames).toHaveLength(1);
      expect(frames[0]!.status._tag).toBe("Ended");
      expect(frames[0]!.attributes.has("fab.gateway.refused")).toBe(kind === "reserved");

      if (kind === "reserved") {
        expect(frames[0]!.attributes.get("fab.gateway.refused")).toBe("reserved");
      }
    }),
  { arbitrary: { seed: SEED, runs: 100 } },
);

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
                    { _tag: "call", method, params: {}, saved: now },
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

// T737 D2 and D3, next/. Frames are decoded with Effect Schema now, and a failed wait's reason is
// read with Predicate. The oracles below are independent copies of the checks before that change:
// parse, then the Request schema; and the old object, `in` and string checks for the reason.
const OldRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union([Schema.String, Schema.Number]),
  method: Schema.String,
  params: Schema.Unknown,
});

const OldRead = Schema.Struct({ stream: Schema.String, after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) });

const oldFrame = (text: string) =>
  Result.flatMap(
    // oxlint-disable-next-line eslint/no-restricted-properties -- oracle: the old parse this law compares against
    Result.try({ try: (): unknown => JSON.parse(text), catch: () => null }),
    (parsed) => Result.mapError(Schema.decodeUnknownResult(OldRequest)(parsed), () => null),
  );

const oldReason = (error: unknown) =>
  typeof error === "object" && error !== null && "reason" in error && typeof error.reason === "string"
    ? error.reason
    : "unreachable";

const methods = ["process.send", "initialize", "ledger.read", "ledger.wait"] as const;

const mutations = [
  "none",
  "none",
  "none",
  "none",
  "drop:jsonrpc",
  "drop:id",
  "drop:method",
  "jsonrpc:1.0",
  "id:true",
  "id:null",
  "method:7",
  "truncate",
  "garbage",
  "empty",
  "array",
  "string",
] as const;

const FrameRecipe = fc.record({
  id: fc.oneof(fc.string({ maxLength: 4 }), fc.integer({ min: -3, max: 40 }), fc.double({ noNaN: true })),
  method: fc.constantFrom(...methods),
  params: fc.oneof(
    {
      arbitrary: fc.record({ stream: fc.constantFrom(...streams), after: fc.integer({ min: -1, max: 6 }) }),
      weight: 4,
    },
    { arbitrary: fc.jsonValue({ maxDepth: 2 }), weight: 1 },
    {
      arbitrary: fc.record({
        stream: fc.oneof(fc.constant(1), fc.string()),
        after: fc.oneof(fc.double(), fc.string()),
      }),
      weight: 1,
    },
  ),
  presence: fc.constantFrom("given", "given", "missing", "null"),
  extra: fc.option(fc.dictionary(fc.string({ maxLength: 4 }), fc.jsonValue({ maxDepth: 1 }), { maxKeys: 2 }), {
    nil: undefined,
  }),
  mutation: fc.oneof(
    { arbitrary: fc.constant("none" as const), weight: 2 },
    { arbitrary: fc.constantFrom(...mutations), weight: 1 },
  ),
});
type FrameRecipe = typeof FrameRecipe extends fc.Arbitrary<infer A> ? A : never;

/** A frame's text: a Request, maybe with extras, then one mutation of it. */
const frameText = (r: FrameRecipe, state: { readonly held: ReadonlyArray<W>; readonly pick: number }) => {
  // State-guided: a wait may name a saved wait's id or stream, so the refusals are reachable.
  const reuse = r.method === "ledger.wait" && state.held.length > 0 && state.pick % 2 === 0;
  const held = reuse ? at(state.held, state.pick) : undefined;
  const id = held?.id ?? r.id;
  const params =
    held !== undefined && Math.floor(state.pick / 2) % 2 === 0
      ? { stream: held.stream, after: held.after + 1 }
      : r.params;
  const base: Record<string, unknown> = {
    ...r.extra,
    jsonrpc: "2.0",
    id,
    method: r.method,
    ...(r.presence === "missing" ? {} : { params: r.presence === "null" ? null : params }),
  };
  const [change, value] = r.mutation.split(":");

  if (change === "drop") {
    delete base[value!];
  } else if (change === "jsonrpc") {
    base.jsonrpc = value;
  } else if (change === "id") {
    base.id = value === "true" ? true : null;
  } else if (change === "method") {
    base.method = 7;
  }

  const text = JSON.stringify(base);

  switch (r.mutation) {
    case "truncate":
      return text.slice(0, -1);
    case "garbage":
      return `${text}}`;
    case "empty":
      return "";
    case "array":
      return JSON.stringify([base]);
    case "string":
      return JSON.stringify(text);
    default:
      return text;
  }
};

/** How a generated failure reads its reason: what each field read does. */
const Failure = fc.record({
  kind: fc.constantFrom(
    "plain",
    "inherited",
    "array",
    "function",
    "instance",
    "null",
    "undefined",
    "string",
    "number",
    "boolean",
    "bigint",
    "symbol",
  ),
  reason: fc.oneof(
    { arbitrary: fc.string({ maxLength: 6 }), weight: 6 },
    { arbitrary: fc.constant(""), weight: 2 },
    { arbitrary: fc.constantFrom<unknown>(0, null, undefined, {}, "absent"), weight: 3 },
  ),
  extra: fc.option(fc.string({ maxLength: 3 }), { nil: undefined }),
  proxy: fc.boolean(),
  throwOn: fc.constantFrom("none", "none", "has", "get"),
});
type Failure = typeof Failure extends fc.Arbitrary<infer A> ? A : never;

class Refused {
  readonly extra = "x";
}

/** A fresh failure value from its recipe; a proxy logs each read of `reason` in `trace`. */
const failure = (f: Failure, trace: Array<string>): unknown => {
  const fields: Record<string, unknown> = f.reason === "absent" ? {} : { reason: f.reason };
  const extra = f.extra === undefined ? {} : { extra: f.extra };
  const target: unknown = (() => {
    switch (f.kind) {
      case "plain":
        return { ...extra, ...fields };
      case "inherited":
        return Object.assign(Object.create(fields), extra);
      case "array":
        return Object.assign([1, 2], extra, fields);
      case "function":
        return Object.assign(() => 0, extra, fields);
      case "instance":
        return Object.assign(new Refused(), fields);
      case "null":
        return null;
      case "undefined":
        return undefined;
      case "string":
        return f.extra ?? "";
      case "number":
        return f.extra?.length ?? 0;
      case "boolean":
        return f.extra !== undefined;
      case "bigint":
        return BigInt(f.extra?.length ?? 0);
      case "symbol":
        return Symbol(f.extra);
    }
  })();

  if (!f.proxy || (typeof target !== "object" && typeof target !== "function") || target === null) {
    return target;
  }

  return new Proxy(target, {
    has: (t, key) => {
      if (key === "reason") {
        trace.push("has");

        if (f.throwOn === "has") {
          throw new Error("planted has trap");
        }
      }

      return Reflect.has(t, key);
    },
    get: (t, key, receiver) => {
      if (key === "reason") {
        trace.push("get");

        if (f.throwOn === "get") {
          throw new Error("planted get trap");
        }
      }

      return Reflect.get(t, key, receiver);
    },
  });
};

/** The old guard's answer on a twin of the failure, with its reads, or `thrown`. */
const oldAnswer = (f: Failure) => {
  const trace: Array<string> = [];
  const answer = Result.try({ try: () => oldReason(failure(f, trace)), catch: () => "thrown" as const });
  return { reason: Result.isSuccess(answer) ? answer.success : ("thrown" as const), trace };
};

const Move737 = fc.record({
  move: fc.nat({ max: 99 }),
  pick: fc.nat(),
  frame: FrameRecipe,
  failure: Failure,
  rev: fc.integer({ min: 1, max: 9 }),
});

describe("T737 decodes keep the connection's acceptance, refusals and order, next/", () => {
  it("D2 D3: frames act as parse-then-decode did, and a failed wait keeps the old guard's reason and reads", async () => {
    const seen = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.array(Move737, { minLength: 1, maxLength: 50, size: "max" }), (moves) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const h = harness(online());
            // Ordinary calls the old decode accepted, in the order they must reach `call`.
            const queued: Array<{ readonly id: string | number; readonly method: string; readonly params: unknown }> =
              [];
            const check = (from: number) => {
              const calls = h.log
                .slice(from)
                .flatMap((e) => (e._tag === "call" ? [{ method: e.method, params: e.params }] : []));
              // The calls the old decode accepted, in order, and no other.
              expect(calls).toEqual(queued.splice(0, calls.length).map(({ method, params }) => ({ method, params })));
            };

            for (const { move, pick, frame, failure: f, rev } of moves) {
              const now = h.saved();
              const held = now._tag === "online" ? now.waits : [];
              const from = h.log.length;

              if (move < 50 || (h.calls.length === 0 && h.waits.length === 0)) {
                const text = frameText(frame, { held, pick });
                const old = oldFrame(text);
                yield* h.run(h.c.frame(text));
                const after = h.log.slice(from);

                if (Result.isFailure(old)) {
                  // Ignored: no call, no wait, no send and no save.
                  expect(after).toEqual([]);
                  seen.add(`ignored:${frame.mutation}${frame.mutation === "none" ? `:${frame.presence}` : ""}`);
                } else if (old.success.method === "ledger.wait") {
                  const request = old.success;
                  const read = Schema.decodeUnknownResult(OldRead)(request.params);

                  if (Result.isFailure(read)) {
                    expect(after).toEqual([no(request.id, "bad_input")]);
                    seen.add("wait:bad_input");
                  } else {
                    const wait = Wait.make({ id: request.id, ...read.success });

                    if (admits(now, wait)) {
                      expect(after[0]).toMatchObject({ _tag: "save" });
                      expect(after[1]).toMatchObject({ _tag: "wait", stream: wait.stream, after: wait.after });
                      seen.add("wait:admitted");
                    } else {
                      expect(after).toEqual([no(request.id, "too_many_waits")]);
                      seen.add("wait:too_many_waits");
                    }
                  }
                } else {
                  queued.push({ id: old.success.id, method: old.success.method, params: old.success.params });
                  seen.add(`call:${frame.presence}:${frame.extra === undefined ? "exact" : "extra"}`);
                }
              } else if (move < 70 && h.calls.length > 0) {
                const [call] = h.calls.splice(pick % h.calls.length, 1);
                yield* Deferred.succeed(call!.reply, Answer.cases.ok.make({ result: null }));
                yield* settle;
              } else if (move < 92 && h.waits.length > 0) {
                const [pending] = h.waits.splice(pick % h.waits.length, 1);
                const trace: Array<string> = [];
                const value = failure(f, trace);
                const before = h.saved();
                const id = (before._tag === "online" ? before.waits : []).find(
                  (w) => `${w.stream}|${w.after}` === pending!.label,
                )?.id;
                yield* Deferred.fail(pending!.reply, value);
                yield* settle;
                const old = oldAnswer(f);
                const sent = answers(h.log, from);
                // The same reads of `reason`, in the same order, as the old guard made.
                expect(trace).toEqual(old.trace);

                if (old.reason === "thrown") {
                  // The read threw: the enclosing fiber fails before anything is sent or saved.
                  expect(h.log.slice(from)).toEqual([]);
                  seen.add("failed:thrown");
                } else if (id !== undefined) {
                  expect(sent.filter((s) => s.id === id).map((s) => s.error?.data?.reason)).toEqual([old.reason]);
                  seen.add(`failed:${f.kind}:${old.reason === "unreachable" ? "fallback" : "reason"}`);

                  if (old.reason === "") {
                    seen.add("failed:empty");
                  }
                }
              } else if (h.waits.length > 0) {
                const [pending] = h.waits.splice(pick % h.waits.length, 1);
                yield* Deferred.succeed(pending!.reply, { _tag: "ready", rev: pending!.after + rev });
                yield* settle;
              }

              check(from);
            }

            for (const wait of h.waits.splice(0)) {
              yield* Deferred.succeed(wait.reply, { _tag: "parked" });
            }

            while (h.calls.length > 0) {
              const from = h.log.length;
              yield* Deferred.succeed(h.calls.shift()!.reply, Answer.cases.ok.make({ result: null }));
              yield* settle;
              check(from);
            }

            // Every call the old decode accepted was made, and no other.
            expect(queued).toEqual([]);
          }),
        ),
      ),
      { seed: SEED, numRuns: RUNS },
    );

    for (const side of [
      "ignored:none:missing",
      "ignored:truncate",
      "ignored:empty",
      "ignored:drop:id",
      "wait:bad_input",
      "wait:admitted",
      "wait:too_many_waits",
      "call:given:extra",
      "call:given:exact",
      "call:null:exact",
      "failed:thrown",
      "failed:array:reason",
      "failed:inherited:reason",
      "failed:function:fallback",
      "failed:plain:reason",
      "failed:empty",
    ]) {
      expect(seen, side).toContain(side);
    }
  });
});
