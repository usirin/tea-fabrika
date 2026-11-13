// P12, next/. Real box methods, execution adapters, runner, manager, receipts and SQLite.
import { Machine } from "@demlik/tea/effect";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { Mailbox, ProcessStore, Writer } from "../coordination/index.ts";
import { InputId } from "../ledger/Log.ts";
import { A, B, brain, data, first, from, ids, PIDS, read, storage } from "../processes/Process.test-support.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, Incoming, ProgramLoader, Recording, WatcherManager } from "../runtime/Entry.ts";
import { Declaration, workerExecution } from "../runtime/Execution.ts";
import { Program, ProgramDown } from "../runtime/Program.ts";
import { RecoveryStore, recoveryStore } from "../runtime/RecoveryStore.ts";
import { defaultPolicy, ProgramRunner, Supervision } from "../runtime/Runner.ts";
import { programBox } from "./box.ts";

// Only Cloudflare's base class is supplied. No execution or supervision method is replaced.
vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
const NAME = "counter:1";
const BUILD = "build-a";
const owner = Writer.cases.person.make({ key: "SHA256:fixture", for: from().for });
const Model = Schema.Struct({ count: Schema.Int });
const Msg = Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int });
type Move = "rpc" | "decode" | "throw";

const thrown = fc.oneof(
  fc
    .tuple(fc.constantFrom("Error", "TypeError", "RangeError", "SyntaxError", "custom"), fc.string())
    .map(([kind, message]) => {
      class ProgramError extends Error {}
      return kind === "TypeError"
        ? new TypeError(message)
        : kind === "RangeError"
          ? new RangeError(message)
          : kind === "SyntaxError"
            ? new SyntaxError(message)
            : kind === "custom"
              ? new ProgramError(message)
              : new Error(message);
    }),
  fc.jsonValue(),
  fc.constant(undefined),
  fc.bigInt(),
  fc.constant(Symbol("made-up-throw")),
  fc.func(fc.jsonValue()),
);

const failureClass = (value: unknown) =>
  value instanceof Error ? value.constructor.name : value === null ? "null" : typeof value;

type Policy = typeof Supervision.Type.policy;
type Policies = { program?: Policy; wiring?: Policy | null };

const world = (adapter: "node" | "worker", limit: number | undefined, failure: unknown, policies?: Policies) => {
  const ledger = storage(),
    state = storage();
  const next = ids(...PIDS);
  let move: Move | "ok" = "ok",
    calls = 0,
    alarm: number | null = null;
  const recovery = RecoveryStore.layer(state.sql, { name: NAME, capacity: 1024 ** 3, schema: Supervision });
  const journal = recoveryStore(state.sql, { name: NAME, capacity: 1024 ** 3, schema: Supervision });
  let initialized = 0;
  const program = {
    name: "counter",
    ...(limit === undefined ? {} : { maxDeliveries: limit }),
    machine: Machine.make({
      model: Model,
      msg: Msg,
      cmds: [],
      init: (saved) => {
        initialized++;
        return [saved ?? { count: 0 }, []];
      },
      update: {
        add: (s, m) => {
          calls++;

          if (move === "throw") {
            throw failure;
          }

          return [{ count: s.count + m.n }, []];
        },
      },
    }),
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Msg,
    view: { data: Model, select: (s: typeof Model.Type) => s },
    refuse: () => null,
    inputs: { add: { _tag: "write", schema: Msg, description: "Add", personOnly: false } },
    outputs: {},
    writes: {},
    wake: () => null,
  } as const;
  const manager = ProcessManager.layer(brain(), next.next).pipe(Layer.provideMerge(data(ledger.sql)));
  const layer = () => {
    const declared = { ...program, ...(policies?.program === undefined ? {} : { policy: policies.program }) };
    const loader = Layer.effect(
      ProgramLoader,
      Effect.gen(function* () {
        const real = yield* ProgramLoader;
        const loaded = yield* real.load("counter", BUILD);
        const Box = programBox(declared, BUILD);
        const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
        const declaration =
          adapter === "node"
            ? loaded.declaration
            : Schema.decodeUnknownSync(Declaration)(
                yield* Effect.tryPromise({
                  try: () => box.describe(),
                  catch: (cause) => new ProgramDown({ reason: "load", cause }),
                }),
              );
        const execution =
          adapter === "node"
            ? loaded.execution
            : workerExecution({
                init: (s) => box.init(s),
                step: async (s, m) => {
                  if (move === "rpc") {
                    return Effect.runPromise(Effect.fail(new Error("transport failed before the program")));
                  }

                  if (move === "decode") {
                    return { unrecognized: true };
                  }

                  return box.step(s, m);
                },
                fold: (s, m) => box.fold(s, m),
                upgrade: (s) => box.upgrade(s),
                reply: (c, o) => box.reply(c, o),
                check: (k, f) => box.check(k, f),
                admit: (m) => box.admit(m),
              });
        return { load: () => Effect.succeed({ ...loaded, declaration, execution }) };
      }),
    ).pipe(Layer.provide(ProgramLoader.layer({ counter: declared }, {})));
    const checked = Layer.effect(
      CheckedWriter,
      Effect.map(Mailbox, (mailbox) => ({
        append: (i: Incoming) =>
          mailbox.send(
            NAME,
            i.id,
            i.envelope.input,
            from({ by: i.envelope.by.key, parent: i.envelope.id, sentAt: i.sentAt }),
          ),
        commit: () => Effect.die("no write declared"),
        own: () => Effect.die("no write declared"),
      })),
    ).pipe(Layer.provide(Mailbox.layer));
    return ProgramRunner.layer(
      { id: A, name: NAME, program: "counter", build: BUILD, owner },
      {
        ...(policies?.wiring === null
          ? {}
          : {
              policy: policies?.wiring ?? {
                maxDeliveries: limit ?? defaultPolicy.maxDeliveries,
                intensity: 32,
                periodMs: 100000,
                backoff: { minMs: 1, maxMs: 1, resetAfterMs: 100000 },
              },
            }),
        recovery: { sql: state.sql, name: NAME, capacity: 1024 ** 3 },
      },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          loader,
          checked,
          ProcessStore.layer(state.sql, { process: A }),
          Layer.succeed(Alarm, {
            set: (at) =>
              Effect.sync(() => {
                alarm = at;
              }),
          }),
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Recording, { flush: Effect.void }),
          Mailbox.layer,
        ).pipe(Layer.provideMerge(manager)),
      ),
    );
  };
  return {
    ledger,
    state,
    layer,
    move: (value: Move | "ok") => {
      move = value;
    },
    calls: () => calls,
    boot: ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager)),
    receipt: (letter: string) => RecoveryStore.use((s) => s.receipt(letter)).pipe(Effect.provide(recovery)),
    snapshot: journal.load,
    initialized: () => initialized,
    alarm: () => alarm,
    reopen: () => {
      ledger.reopen();
      state.reopen();
    },
    status: ProcessManager.use((p) => p.status(NAME)).pipe(Effect.provide(manager)),
    recover: Effect.gen(function* () {
      const saved = yield* journal.load;
      expect(saved).not.toBeNull();
      // The journal keeps the restart wait in its start until the restart brake trips (P34c slice 2).
      const at = saved?.journal;
      const until =
        at?._tag === "waiting_recovery" || at?._tag === "writing_down"
          ? at.recovery.until
          : at?._tag === "waiting_start" && at.timing._tag === "scheduled"
            ? at.timing.until
            : undefined;

      if (until !== undefined) {
        expect(alarm).toBe(until);
        yield* TestClock.setTime(until);
        yield* ProgramRunner.use((r) => r.due(until)).pipe(Effect.provide(layer()));
      }
    }),
    read: (stream: string) => read(stream).pipe(Effect.provide(data(ledger.sql))),
  };
};

const incoming = (letter: string, n: number): Incoming =>
  Incoming.make({
    id: letter,
    envelope: {
      id: Schema.decodeUnknownSync(InputId)("input_0000000000e008000000000001"),
      by: owner,
      arrivedAt: 0,
      input: { type: "add", n },
    },
    sentAt: from().sentAt,
    seen: 0,
    span: { traceId: from().traceId, spanId: "00f067aa0ba902b7" },
  });

const sequence = fc.record({
  limit: fc.integer({ min: 1, max: 4 }),
  moves: fc.array(fc.constantFrom<Move>("rpc", "decode", "throw"), { minLength: 1, maxLength: 8 }),
  n: fc.integer({ min: -1000, max: 1000 }),
  letter: fc.uuid(),
});

// Bounded waits fit the valid period; corrupt commands exercise each numeric boundary.
const policySamples = fc
  .record({
    deliveries: fc.integer({ min: 1, max: 32 }),
    extra: fc.nat({ max: 4 }),
    wait: fc.integer({ min: 1, max: 10 }),
    period: fc.integer({ min: 1000, max: 120_000 }),
  })
  .map(({ deliveries, extra, wait, period }): Policy => ({
    maxDeliveries: deliveries,
    intensity: deliveries + extra,
    periodMs: period,
    backoff: { minMs: wait, maxMs: wait, resetAfterMs: period },
  }));

it("P1: the Worker description carries the checked policy and rejects corrupt RPC declarations", async () => {
  type Model = { policy: Policy | undefined; valid: boolean; checked: boolean };
  type Real = { raw: Record<string, unknown>; checked: unknown; described: unknown | null; calls: number };
  const checkPolicy = (value: unknown, policy: Policy | undefined) => {
    const fields = Schema.decodeUnknownSync(Schema.Struct({ policy: Schema.optionalKey(Schema.Unknown) }))(value);
    expect(fields).toEqual(policy === undefined ? {} : { policy });
  };
  const commands = fc.commands<Model, Real, false>(
    [
      fc.option(policySamples, { nil: undefined }).map((policy): fc.AsyncCommand<Model, Real> => ({
        check: () => true,
        run: async (m, r) => {
          delete r.raw.policy;

          if (policy !== undefined) {
            r.raw.policy = policy;
          }

          m.policy = policy;
          m.valid = true;
          m.checked = false;
          r.described = null;
        },
        toString: () => `declare(${JSON.stringify(policy)})`,
      })),
      fc.integer({ min: 0, max: 21 }).map((field): fc.AsyncCommand<Model, Real> => ({
        check: (m) => m.valid && m.policy !== undefined,
        run: async (m, r) => {
          const p = m.policy!;

          if (field < 18) {
            const key = ["maxDeliveries", "intensity", "periodMs", "minMs", "maxMs", "resetAfterMs"][
              Math.floor(field / 3)
            ]!;
            const value = field % 3 === 0 ? 0 : field % 3 === 1 ? -1 : 0.5;
            r.raw.policy = field < 9 ? { ...p, [key]: value } : { ...p, backoff: { ...p.backoff, [key]: value } };
          } else {
            r.raw.policy =
              field === 18
                ? { ...p, maxDeliveries: 33 }
                : field === 19
                  ? { ...p, intensity: p.maxDeliveries - 1 }
                  : field === 20
                    ? { ...p, backoff: { ...p.backoff, minMs: p.backoff.maxMs + 1 } }
                    : { ...p, periodMs: p.intensity * p.backoff.minMs };
          }

          m.valid = false;
          m.checked = false;
          r.described = null;
        },
        toString: () => `corrupt(${field})`,
      })),
      fc.constantFrom("make", "makeEffect", "decode", "describe").map((action): fc.AsyncCommand<Model, Real> => ({
        check: (m) => action !== "describe" || m.checked,
        run: async (m, r) => {
          if (action === "make") {
            const make = () => Reflect.apply(Program.make, Program, [r.raw]);

            if (!m.valid) {
              expect(make).toThrow();
            } else {
              r.checked = make();
              checkPolicy(r.checked, m.policy);
              m.checked = true;
            }
          } else if (action === "makeEffect") {
            const exit = await Effect.runPromiseExit(Reflect.apply(Program.makeEffect, Program, [r.raw]));
            expect(Exit.isSuccess(exit)).toBe(m.valid);

            if (Exit.isSuccess(exit)) {
              r.checked = exit.value;
              checkPolicy(r.checked, m.policy);
              m.checked = true;
            }
          } else if (action === "decode") {
            const raw = {
              name: "counter",
              v: 1,
              cmds: [],
              inputs: {},
              writes: {},
              ...(Object.hasOwn(r.raw, "policy") ? { policy: r.raw.policy } : {}),
            };
            const decoded = Schema.decodeUnknownOption(Declaration)(r.described ?? raw);
            expect(decoded._tag).toBe(m.valid ? "Some" : "None");

            if (decoded._tag === "Some") {
              checkPolicy(decoded.value, m.policy);
            }
          } else {
            const Box = programBox(r.checked, BUILD);
            const box: InstanceType<typeof Box> = Reflect.construct(Box, []);
            const raw = await box.describe();
            checkPolicy(raw, m.policy);
            checkPolicy(Schema.decodeUnknownSync(Declaration)(raw), m.policy);
            r.described = raw;
          }

          expect(r.calls).toBe(0);
        },
        toString: () => action,
      })),
    ],
    { maxCommands: 80, size: "max" },
  );
  await fc.assert(
    fc.asyncProperty(commands, async (moves) => {
      const real: Real = { raw: {}, checked: null, described: null, calls: 0 };
      real.raw = {
        name: "counter",
        machine: Machine.make({
          model: Model,
          msg: Msg,
          cmds: [],
          init: () => {
            real.calls++;
            return [{ count: 0 }, []];
          },
          update: { add: (s, m) => [{ count: s.count + m.n }, []] },
        }),
        state: { v: 1, upgrades: [] },
        view: (s: typeof Model.Type) => s,
        refuse: () => null,
        inputs: {},
        outputs: {},
        writes: {},
        wake: () => null,
      };
      await fc.asyncModelRun(() => ({ model: { policy: undefined, valid: true, checked: false }, real }), moves);
    }),
    { seed: 119120, numRuns: 100 },
  );
});

it("P2: runners select policy before init and retain policy, pending recovery and counts on reopen", async () => {
  type Model = {
    opened: boolean;
    now: number;
    pid: string;
    restarts: number[];
    crashes: number;
    streak: number;
    healthyAt: number;
    pending: { until: number; brake: boolean } | null;
    letter: string | null;
  };
  const commands = fc.commands<Model, { run: (action: string, m: Model, edge: number) => Promise<void> }, false>(
    [
      fc.constantFrom("open", "crash", "resend", "reopen", "due").chain((action) =>
        fc
          .nat({ max: 3 })
          .map((edge): fc.AsyncCommand<Model, { run: (action: string, m: Model, edge: number) => Promise<void> }> => ({
            check: (m) =>
              action === "open"
                ? !m.opened
                : m.opened &&
                  (action === "crash"
                    ? m.pending === null && m.crashes < 8
                    : action === "due" || action === "resend"
                      ? m.pending !== null
                      : true),
            run: (m, r) => r.run(action, m, edge),
            toString: () => `${action}(${edge})`,
          })),
      ),
    ],
    { maxCommands: 100, size: "max" },
  );
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom("program", "wiring", "default"),
      fc.integer({ min: 40, max: 100 }),
      fc.constantFrom("node", "worker"),
      commands,
      (source, period, adapter, moves) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const program: Policy = {
              maxDeliveries: 2,
              intensity: 2,
              periodMs: period,
              backoff: { minMs: 1, maxMs: 1, resetAfterMs: 100_000 },
            };
            const wiring: Policy = { ...program, periodMs: period * 4 };
            const policies: Policies = {
              ...(source === "program" ? { program } : {}),
              wiring: source === "default" ? null : wiring,
            };
            const expected = source === "program" ? program : source === "wiring" ? wiring : defaultPolicy;
            const w = yield* Effect.acquireRelease(
              Effect.sync(() => world(adapter, 1, new TypeError("program crash"), policies)),
              (w) =>
                Effect.sync(() => {
                  w.ledger.db().close();
                  w.state.db().close();
                }),
            );
            yield* TestClock.setTime(0);
            yield* w.boot;
            const context = yield* Effect.context<never>();
            const real = {
              run: (action: string, m: Model, edge: number) =>
                Effect.runPromise(
                  Effect.gen(function* () {
                    const invoke = <A, E>(f: (r: ProgramRunner["Service"]) => Effect.Effect<A, E>) =>
                      ProgramRunner.use(f).pipe(Effect.provide(w.layer()));
                    const before = yield* w.snapshot;

                    if (action === "open") {
                      yield* invoke((r) => r.open("policy"));
                      yield* invoke((r) => r.msg(incoming("healthy", 1)));
                      m.opened = true;
                    } else if (action === "crash") {
                      w.move("throw");
                      m.letter = `crash-${m.crashes}`;
                      yield* invoke((r) => r.msg(incoming(m.letter!, 1)));
                      m.crashes++;
                      m.streak++;
                      const wait = Math.min(expected.backoff.minMs * 2 ** (m.streak - 1), expected.backoff.maxMs);
                      const until = m.now + wait;
                      const times = m.restarts.filter((at) => at >= until - expected.periodMs);
                      const brake = times.length + 1 > expected.intensity;
                      m.pending = {
                        until: brake
                          ? Math.max(until, times[times.length - expected.intensity]! + expected.periodMs + 1)
                          : until,
                        brake,
                      };
                    } else if (action === "resend") {
                      const calls = w.calls();
                      yield* invoke((r) => r.msg(incoming(m.letter!, 1)));
                      expect(w.calls()).toBe(calls);
                      expect(yield* w.snapshot).toEqual(before);
                    } else if (action === "reopen") {
                      w.reopen();
                      policies.program = { ...program, periodMs: program.periodMs * 8 };
                      policies.wiring = { ...wiring, periodMs: wiring.periodMs * 8 };
                      yield* invoke((r) => r.due(m.now));
                      expect(yield* w.snapshot).toEqual(before);
                    } else {
                      const pending = m.pending!;
                      const at =
                        edge === 0
                          ? pending.until - 1
                          : edge === 1
                            ? pending.until
                            : edge === 2
                              ? (m.restarts[0] ?? m.now) + program.periodMs + 1
                              : (m.restarts[0] ?? m.now) + wiring.periodMs + 1;
                      m.now = Math.max(m.now, at);
                      yield* TestClock.setTime(m.now);
                      w.move("ok");
                      yield* invoke((r) => r.due(m.now));

                      if (m.now >= pending.until) {
                        m.restarts.push(m.now);
                        m.pid = PIDS[m.restarts.length]!;
                        m.healthyAt = m.now;
                        m.pending = null;
                      }
                    }

                    const saved = yield* w.snapshot;
                    expect(saved).not.toBeNull();
                    expect(saved?.policy).toEqual(expected);
                    expect(saved?.restarts).toEqual(m.restarts);
                    expect(saved?.observations).toHaveLength(m.crashes);
                    expect(saved?.maxDeliveries).toBe(1);

                    if (m.letter !== null) {
                      expect(yield* w.receipt(m.letter)).toMatchObject({
                        tries: 1,
                        result: { _tag: "refused", reason: "dead" },
                      });
                    }

                    if (m.pending !== null) {
                      expect(saved?.journal._tag).toBe(m.pending.brake ? "waiting_recovery" : "waiting_start");
                      expect(w.alarm()).toBe(m.pending.until);
                    } else {
                      if (m.now - m.healthyAt >= expected.backoff.resetAfterMs) {
                        m.streak = 0;
                        m.healthyAt = m.now;
                      }

                      expect(saved?.journal._tag).toBe("idle");
                      const status = yield* w.status;
                      expect(status.state.process).toBe(m.pid);
                      expect(saved?.journal).toMatchObject({ process: m.pid });
                    }

                    expect(saved?.crashes).toBe(m.streak);
                    expect(w.initialized()).toBeGreaterThan(0);
                  }).pipe(Effect.provide(context)),
                ),
            };
            yield* Effect.tryPromise({
              try: () =>
                fc.asyncModelRun(
                  () => ({
                    model: {
                      opened: false,
                      now: 0,
                      pid: A,
                      restarts: [],
                      crashes: 0,
                      streak: 0,
                      healthyAt: 0,
                      pending: null,
                      letter: null,
                    },
                    real,
                  }),
                  moves,
                ),
              catch: (cause) => new Cause.UnknownError(cause),
            });
          }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
        ),
    ),
    { seed: 119120, numRuns: 100 },
  );
});

for (const source of ["rpc", "decode"] as const) {
  it(`supervised ${source} failures never change deliveries, receipt failures or dead events`, async () => {
    await fc.assert(
      fc.asyncProperty(sequence, (sample) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const w = world("worker", sample.limit, new TypeError("program failed"));
            yield* w.boot;
            const input = incoming(sample.letter, sample.n);
            let crashes = 0;

            for (const move of [source, ...sample.moves]) {
              if (crashes === sample.limit) {
                break;
              }

              w.move(move);
              const beforeCalls = w.calls();
              const exit = yield* ProgramRunner.use((r) => r.msg(input)).pipe(Effect.provide(w.layer()), Effect.exit);

              if (move === "throw") {
                crashes++;
              }

              const receipt = yield* w.receipt(input.id);
              // First assert the durable record, even when the caller was also given a false dead answer.
              expect(receipt).toMatchObject({
                tries: crashes,
                errors: Array.from({ length: crashes }, () => "TypeError"),
                result: crashes === sample.limit ? { _tag: "refused", reason: "dead" } : null,
              });

              if (move !== "throw") {
                expect(w.calls()).toBe(beforeCalls);
                expect(Exit.isFailure(exit)).toBe(true);
                const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
                expect(Cause.hasDies(cause)).toBe(false);
                expect(Cause.findErrorOption(cause)).toMatchObject({
                  _tag: "Some",
                  value: { _tag: "ProgramDown", source: move },
                });
                const saved = yield* w.snapshot;
                // No attempt is left open: the journal is not stepping.
                expect(saved?.journal._tag).not.toBe("stepping");
                expect(saved?.observations).toHaveLength(crashes);
              }

              const dead = (yield* Effect.forEach(PIDS, (p) => w.read(`${p}/dead`), {
                concurrency: 1,
              })).flat();
              expect(dead).toHaveLength(crashes === sample.limit ? 1 : 0);
              expect(yield* w.read(`${NAME}/inbox`)).toEqual([]);

              if (crashes < sample.limit) {
                w.move("ok");
                yield* w.recover;
              }
            }

            if (crashes < sample.limit) {
              w.move("ok");
              expect(yield* ProgramRunner.use((r) => r.msg(input)).pipe(Effect.provide(w.layer()))).toMatchObject({
                _tag: "accepted",
                pos: 1,
              });
              expect(yield* w.read(`${NAME}/inbox`)).toHaveLength(1);
            }
          }).pipe(Effect.provide(TestClock.layer())),
        ),
      ),
      {
        seed: 119120,
        numRuns: 25,
        // Review 6: one rejected or malformed RPC must not exhaust the allowed limit of one.
        examples: [
          [{ limit: 1, moves: ["rpc"], n: 1, letter: "rpc-limit-one" }],
          [{ limit: 1, moves: ["decode"], n: 1, letter: "decode-limit-one" }],
          [{ limit: 3, moves: ["rpc", "decode", "throw", "rpc", "throw"], n: 1, letter: "mixed" }],
        ],
      },
    );
  });
}

it("Node records the actual class for generated Error and non-Error throws", async () => {
  await fc.assert(
    fc.asyncProperty(thrown, fc.uuid(), (failure, letter) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const w = world("node", 1, failure);
          yield* w.boot;
          w.move("throw");
          expect(
            yield* ProgramRunner.use((r) => r.msg(incoming(letter, 1))).pipe(Effect.provide(w.layer())),
          ).toMatchObject({ _tag: "refused", reason: "dead" });
          expect(yield* w.receipt(letter)).toMatchObject({
            tries: 1,
            errors: [failureClass(failure)],
          });
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    ),
    {
      seed: 119120,
      numRuns: 25,
      examples: [
        [undefined, "undefined-throw"],
        [null, "null-throw"],
        [Symbol("made-up"), "symbol-throw"],
      ],
    },
  );
});

it("the real Worker box records the same thrown class as Node under supervision", async () => {
  await fc.assert(
    fc.asyncProperty(thrown, fc.uuid(), (failure, letter) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const receipts = [],
            dead = [];

          for (const adapter of ["node", "worker"] as const) {
            const w = world(adapter, 1, failure);
            yield* w.boot;
            w.move("throw");
            const exit = yield* ProgramRunner.use((r) => r.msg(incoming(letter, 1))).pipe(
              Effect.provide(w.layer()),
              Effect.exit,
            );
            expect(exit).toMatchObject({ _tag: "Success", value: { _tag: "refused", reason: "dead" } });
            receipts.push(yield* w.receipt(letter));
            dead.push(
              (yield* Effect.forEach([A, B], (p) => w.read(`${p}/dead`), { concurrency: 1 })).flat().map((r) => r.body),
            );
          }

          const expected = failureClass(failure);
          expect(receipts[0]).toMatchObject({ errors: [expected], tries: 1 });
          expect(dead[0]).toMatchObject([{ errors: [expected], tries: 1 }]);
          expect(receipts[1]).toMatchObject({ errors: [expected], tries: 1 });
          expect(dead[1]).toMatchObject([{ errors: [expected], tries: 1 }]);
        }).pipe(Effect.provide(TestClock.layer())),
      ),
    ),
    {
      seed: 119120,
      numRuns: 25,
      // Review 6: the box used to record ProgramDown in place of this TypeError.
      examples: [[new TypeError("private program text"), "worker-class"]],
    },
  );
});
