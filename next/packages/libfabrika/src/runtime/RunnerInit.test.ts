// Ticket 762, amendment A2, next/. A process's first turn is the runner's `init`, OTP's init/1:
// a start alone, or a restart alone, loads the program and arms the object's one alarm.
// Real runner, manager and ledger on SQLite, as RunnerSupervision.test.ts builds them; only the
// alarm is a recording double. Each generated world acquires its folder and files in its own scope,
// and the scope gives them back whether the run passed, failed or was cut (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { Mailbox, ProcessStore, SessionManager, Writer } from "../coordination/index.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { A, brain, data, first, from, ids, PIDS, read } from "../processes/Process.test-support.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import type { Sql } from "../Sql.ts";
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
const Model = Schema.Struct({ wake: Schema.NullOr(Schema.Number) });
type Model = typeof Model.Type;
const Msg = Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number });

/** Up to 10^12 ms, about 31 years of epoch time, or no wake at all. */
const wake = fc.option(fc.nat({ max: 1_000_000_000_000 }), { nil: null });

/** A folder in a scope: the scope removes it. */
const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "t762-init-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

/** One SQLite file in a scope. One Sql across reopens, each call to the handle open now; the scope
 *  closes whichever handle is open. */
const database = (path: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const open = () => {
        const db = new DatabaseSync(path);
        db.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF");
        return { db, sql: nodeSql(db) };
      };
      const held = { now: open() };
      const sql: Sql = {
        exec: (query, ...params) => held.now.sql.exec(query, ...params),
        transaction: (step) => held.now.sql.transaction(step),
        size: () => held.now.sql.size(),
      };
      return {
        held,
        sql,
        reopen: () => {
          held.now.db.close();
          held.now = open();
        },
      };
    }),
    ({ held }) => Effect.sync(() => held.now.db.isOpen && held.now.db.close()),
  );

/** One process name's world. Each build's `init` gives its own first wake and no Cmd: init's Cmds
 *  are ticket 292's (0253, amendment A3). */
const world = Effect.fnUntraced(function* (wakes: Readonly<Record<string, number | null>>) {
  const path = yield* folder;
  const ledger = yield* database(join(path, "ledger.db"));
  const state = yield* database(join(path, "state.db"));
  const authority = yield* database(join(path, "authority.db"));
  const next = ids(...PIDS);
  // `throws`: the program's init throws, as a program bug would; `loaded`: what each init was given.
  const controls = { build: BUILD, throws: false, loaded: [] as Array<Model | null> };
  const alarms: Array<number | null> = [];
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [],
    init: (loaded) => {
      controls.loaded.push(loaded ?? null);

      if (controls.throws) {
        throw new RangeError("init threw");
      }

      return [loaded ?? { wake: wakes[controls.build] ?? null }, []];
    },
    update: {
      timer: (s) => [s, []],
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
        commit: () => Effect.die("this program has no Cmd"),
        own: () => Effect.die("this program has no Cmd"),
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
          ProgramLoader.layer({ counter: program }, {}),
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
});

const lives = read(`processes/${NAME}`);

/** The object's alarm after the calls: the last one set, or none ever set. */
const lastAlarm = (alarms: ReadonlyArray<number | null>) => (alarms.length === 0 ? null : alarms.at(-1)!);

describe("ticket 762 A2: a process's first turn arms its alarm", () => {
  it("L8: a start alone, init called 1 to 3 times, arms the first model's wake", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          wake,
          calls: fc.integer({ min: 1, max: 3 }),
          // A resent configure may reach the same live object or a fresh wake of it.
          fresh: fc.boolean(),
        }),
        ({ wake, calls, fresh }) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const w = yield* world({ [BUILD]: wake });
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
            }).pipe(Effect.scoped),
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
            const w = yield* world({ [BUILD]: before, [SUCCESSOR]: wake });
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
          }).pipe(Effect.scoped),
        ),
      ),
      { seed: SEED, numRuns: 50 },
    );
  });

  // A2: a program that throws in its init is supervision's, as any step that throws. The start
  // still answers, and the crash is observed: the object arms supervision's wait, and the wait's
  // alarm starts a successor. Fresh: no saved model; restored: an earlier life saved one.
  it.effect.prop(
    "L8 init crash: a program that throws in init, fresh or restored, leaves init answering and a successor started",
    {
      restored: Schema.Boolean,
      wake: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1e12 }))),
    },
    ({ restored, wake }) =>
      Effect.gen(function* () {
        // A restored life's earlier model wakes at 0, so its due runs one timer step and saves it.
        const w = yield* world({ [BUILD]: restored ? 0 : wake });
        yield* w.boot;

        if (restored) {
          yield* ProgramRunner.use((r) => r.init()).pipe(Effect.provide(w.layer()));
          yield* ProgramRunner.use((r) => r.due(0)).pipe(Effect.provide(w.layer()));
          w.reopen();
        }

        w.controls.throws = true;
        w.controls.loaded.length = 0;
        yield* Effect.gen(function* () {
          const r = yield* ProgramRunner;
          const started = yield* Effect.exit(r.init());
          expect(w.controls.loaded.length, "the program's init ran").toBeGreaterThan(0);
          expect(
            w.controls.loaded.every((m) => (m !== null) === restored),
            restored ? "init was given the saved model" : "init was given no model",
          ).toBe(true);
          expect(Exit.isSuccess(started), "a start answers although its program's init threw").toBe(true);
          const deadline = lastAlarm(w.alarms);
          expect(deadline, "the crash is observed: supervision's wait is armed").toBeTypeOf("number");
          w.controls.throws = false;
          yield* TestClock.setTime(deadline!);
          yield* r.due(deadline!);
          expect((yield* lives).filter((row) => row._tag === "restarted")).toMatchObject([{ body: { after: A } }]);
        }).pipe(Effect.provide(w.layer()));
      }).pipe(Effect.scoped),
    { arbitrary: { seed: SEED, runs: 50 } },
  );
});
