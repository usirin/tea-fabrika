// Ticket 762, amendment A2, next/. A process's first turn is the runner's `init`, OTP's init/1:
// a start alone, or a restart alone, loads the program and arms the object's one alarm.
// Real runner, manager and ledger on SQLite, as RunnerSupervision.test.ts builds them; only the
// alarm is a recording double.
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as fc from "fast-check";
import { Mailbox, ProcessStore, SessionManager, Writer } from "../coordination/index.ts";
import { A, brain, data, first, from, ids, PIDS, storage } from "../processes/Process.test-support.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { Program } from "./Program.ts";
import { ProgramRunner } from "./Runner.ts";

const SEED = 119120;
const NAME = "counter:1";
const BUILD = "build-a";
const SUCCESSOR = "build-b";

const policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

const person = Writer.cases.person.make({ key: "SHA256:person", for: from().for });
const Model = Schema.Struct({ wake: Schema.NullOr(Schema.Number), answers: Schema.Int });
type Model = typeof Model.Type;
const Msg = Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number });
const work = Cmd.make("work", { input: Schema.Struct({ n: Schema.Int }), ok: Schema.Null, err: ["failed"] });

/** Up to 10^12 ms, about 31 years of epoch time, or no wake at all. */
const wake = fc.option(fc.nat({ max: 1_000_000_000_000 }), { nil: null });

/** One process name's world. Each build's `init` gives its own first wake, and `cmds` work Cmds. */
const world = (wakes: Readonly<Record<string, number | null>>, cmds: number) => {
  const ledger = storage(),
    state = storage(),
    authority = storage();
  const next = ids(...PIDS);
  const controls = { build: BUILD, handled: 0 };
  const alarms: Array<number | null> = [];
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [work],
    init: (loaded) => [
      loaded ?? { wake: wakes[controls.build] ?? null, answers: 0 },
      Array.from({ length: cmds }, (_, n) => work({ n })),
    ],
    update: {
      timer: (s) => [s, []],
      // An answer leaves the wake as init set it, so the last alarm is init's own.
      work_ok: (s) => [{ ...s, answers: s.answers + 1 }, []],
      work_err: (s) => [{ ...s, answers: s.answers + 1 }, []],
    },
  });
  const program = Program.make({
    name: "counter",
    machine,
    state: { v: 1, upgrades: [] },
    view: (s: Model) => s,
    refuse: () => null,
    inputs: {},
    outputs: {},
    writes: {},
    wake: (s: Model) => s.wake,
  });
  const base = () =>
    Layer.mergeAll(
      data(ledger.sql),
      SessionManager.layer(authority.sql, () => Effect.succeed(person), { input: () => false, event: () => false }),
    );
  const manager = () => ProcessManager.layer(brain(), next.next).pipe(Layer.provideMerge(base()));
  const checked = Layer.effect(
    CheckedWriter,
    Effect.gen(function* () {
      const mailbox = yield* Mailbox;
      return {
        append: (i: Incoming) =>
          mailbox.send(NAME, i.id, i.envelope.input, from({ by: i.envelope.by.key, parent: i.envelope.id })),
        commit: () => Effect.die("this program has no write Cmd"),
        own: () => Effect.die("this program has no write Cmd"),
      };
    }),
  ).pipe(Layer.provide(Mailbox.layer));
  // One built layer is one life of the object; building it again is a wake with no memory.
  const layer = () =>
    ProgramRunner.layer(
      { id: A, name: NAME, program: "counter", build: controls.build, owner: person },
      { policy, recovery: { sql: state.sql, name: NAME, capacity: 1024 ** 3 } },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ProgramLoader.layer(
            { counter: program },
            {
              work: () =>
                Effect.sync(() => {
                  controls.handled++;
                  return Outcome.ok(null);
                }),
            },
          ),
          ProcessStore.layer(state.sql, { process: A }),
          checked,
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Alarm, { set: (at) => Effect.sync(() => void alarms.push(at)) }),
          Layer.succeed(Recording, { flush: Effect.void }),
          ProcessManager.layer(brain(), next.next),
          Mailbox.layer,
        ).pipe(Layer.provideMerge(base())),
      ),
    );
  return {
    controls,
    alarms,
    layer,
    boot: ProcessManager.use((p) => p.start(first(), from())).pipe(Effect.provide(manager())),
    reopen: () => {
      ledger.reopen();
      state.reopen();
      authority.reopen();
    },
  };
};

/** The object's alarm after the calls: the last one set, or none ever set. */
const lastAlarm = (alarms: ReadonlyArray<number | null>) => (alarms.length === 0 ? null : alarms.at(-1)!);

describe("ticket 762 A2: a process's first turn arms its alarm", () => {
  it("L8: a start alone, init called 1 to 3 times, arms the first model's wake and runs init's Cmds once", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          wake,
          calls: fc.integer({ min: 1, max: 3 }),
          cmds: fc.integer({ min: 0, max: 2 }),
          // A resent configure may reach the same live object or a fresh wake of it.
          fresh: fc.boolean(),
        }),
        ({ wake, calls, cmds, fresh }) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const w = world({ [BUILD]: wake }, cmds);
              yield* w.boot;
              const init = ProgramRunner.use((r) => {
                expect(r.init, "A2's ProgramRunner.init is missing").toBeTypeOf("function");
                return r.init();
              });

              if (fresh) {
                for (let n = 0; n < calls; n++) {
                  w.reopen();
                  yield* init.pipe(Effect.provide(w.layer()));
                }
              } else {
                yield* Effect.repeat(init, { times: calls - 1 }).pipe(Effect.provide(w.layer()));
              }

              expect(lastAlarm(w.alarms), "the start's alarm is its first model's wake").toBe(wake);
              expect(w.controls.handled, "init's Cmds run once per process start (0253)").toBe(cmds);
            }),
          ),
      ),
      { seed: SEED, numRuns: 150 },
    );
  });

  it("L9: a restart alone, with no later open, msg or due, arms the successor's first wake", async () => {
    await fc.assert(
      fc.asyncProperty(fc.record({ wake, id: fc.uuid() }), ({ wake, id }) =>
        Effect.runPromise(
          Effect.gen(function* () {
            // The first life wakes elsewhere, so an alarm left from it cannot pass for the successor's.
            const before = wake === null ? 1 : wake + 1;
            const w = world({ [BUILD]: before, [SUCCESSOR]: wake }, 0);
            yield* w.boot;
            yield* Effect.gen(function* () {
              const r = yield* ProgramRunner;
              expect(r.init, "A2's ProgramRunner.init is missing").toBeTypeOf("function");
              yield* r.init();
              expect(lastAlarm(w.alarms), "the first life armed its own wake").toBe(before);
              w.controls.build = SUCCESSOR;
              yield* r.restart({ id: `restart-${id}`, build: SUCCESSOR });
            }).pipe(Effect.provide(w.layer()));
            expect(lastAlarm(w.alarms), "the successor's alarm is its first model's wake").toBe(wake);
          }),
        ),
      ),
      { seed: SEED, numRuns: 50 },
    );
  });
});
