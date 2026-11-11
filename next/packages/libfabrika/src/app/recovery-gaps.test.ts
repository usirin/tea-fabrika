// P34, next/. Cuts are injected through trusted wiring, never a public fault endpoint.
// fault(cut) runs after the named durable operation and can lose its reply. The real operation
// must already have happened. Retry uses the saved action ID, then survives another SQLite reopen.
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  Activity,
  Mailbox,
  ProcessManager,
  ProcessStore,
  SessionManager,
  type Session,
  Writer,
} from "../coordination/index.ts";
import {
  A,
  B,
  W,
  X,
  brain,
  data,
  first,
  from,
  ids,
  PIDS,
  read,
  storage,
} from "../coordination/process.test-support.ts";
import { Ledger, LedgerError } from "../data/ledger.ts";
import { InputId, lineFor } from "../data/log.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Event, type Incoming, ProgramLoader, Recording, WatcherManager } from "./entry.ts";
import { type Descriptor, ProgramRunner } from "./runner.ts";

const NAME = "counter:1";

const policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

const owner = Writer.cases.person.make({ key: "SHA256:caller", for: from().for });

const Model = Schema.Struct({
  count: Schema.Int,
  replies: Schema.Int,
  queue: Schema.NullOr(Schema.String),
});
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("poison") }),
  Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("wait") }),
  Schema.Struct({ type: Schema.Literal("queue"), parent: Schema.String }),
]);

const wait = Cmd.make("wait", { input: Schema.Struct({}), ok: Schema.Null, err: [] });

const write = Cmd.make("write", {
  input: Schema.Struct({ stream: Schema.String, write: Schema.Json }),
  ok: Schema.Json,
  err: ["not_delivered", "ended", "spent"],
});

type Wiring = {
  policy: typeof policy;
  recovery: { sql: Sql; name: string; capacity: number };
  fault: (cut: string) => Effect.Effect<void, LedgerError>;
};

const runnerLayer: (p: Descriptor, options: Wiring) => ReturnType<typeof ProgramRunner.layer> = ProgramRunner.layer;

const world = Effect.fnUntraced(function* () {
  const ledger = storage(),
    state = storage(),
    authority = storage();
  const next = ids(...PIDS);
  const gate = yield* Deferred.make<void>();
  const entered = yield* Deferred.make<void>();
  const controls = {
    cut: "",
    hits: [] as string[],
    steps: 0,
    commands: 0,
    owns: 0,
    commits: 0,
    saved: false,
    flush: false,
    save: false,
  };
  const alarms: Array<number | null> = [];
  const machine = Machine.make({
    model: Model,
    msg: Msg,
    cmds: [wait, write],
    init: (s) => [s ?? { count: 0, replies: 0, queue: null }, []],
    update: {
      poison: () => {
        controls.steps++;
        throw new TypeError("private gap failure");
      },
      add: (s, m) => {
        if (controls.saved) {
          throw new RangeError("private saved failure");
        }

        return [
          { ...s, count: s.count + m.n, queue: null },
          s.queue === null
            ? []
            : [
                write({
                  stream: "facts",
                  write: {
                    _tag: "caused",
                    parent: s.queue,
                    event: { _tag: "saved", count: s.count + m.n },
                  },
                }),
              ],
        ];
      },
      wait: (s) => [s, [wait({})]],
      wait_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
      wait_err: (s) => [s, []],
      queue: (s, m) => [{ ...s, queue: m.parent }, []],
      write_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
      write_err: (s) => [{ ...s, replies: s.replies + 1 }, []],
    },
  });
  const p = {
    name: "counter",
    machine,
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Msg,
    view: { data: Model, select: (s: Model) => s },
    refuse: () => null,
    inputs: {
      poison: { _tag: "write", schema: Msg, description: "Poison", personOnly: false },
      add: { _tag: "write", schema: Msg, description: "Add", personOnly: false },
      wait: { _tag: "write", schema: Msg, description: "Wait", personOnly: false },
      queue: { _tag: "write", schema: Msg, description: "Queue", personOnly: false },
    },
    outputs: {},
    writes: { saved: { schema: Schema.TaggedStruct("saved", { count: Schema.Int }), personOnly: false } },
    wake: () => null,
  };
  const input = (id: string, m: unknown = { type: "poison" }): Incoming => ({
    id,
    envelope: {
      id: Schema.decodeUnknownSync(InputId)("input_0000000000e008000000000001"),
      by: owner,
      arrivedAt: 0,
      input: m,
    },
    sentAt: from().sentAt,
    seen: 0,
    span: { traceId: from().traceId, spanId: "00f067aa0ba902b7" },
  });
  const base = () =>
    Layer.mergeAll(
      data(ledger.sql),
      SessionManager.layer(authority.sql, () => Effect.succeed(owner), {
        input: () => false,
        event: () => false,
      }),
    );
  const manager = () => ProcessManager.layer(brain(), next.next).pipe(Layer.provideMerge(base()));
  const processSql: Sql = {
    ...state.sql,
    exec: (q, ...args) => {
      if (controls.save && /^\s*(INSERT|UPDATE|REPLACE)/i.test(q)) {
        throw new Error("SQLITE_FULL");
      }

      return state.sql.exec(q, ...args);
    },
  };
  const layer = () =>
    runnerLayer(
      { id: A, name: NAME, program: p.name, build: "build-a", owner },
      {
        policy,
        recovery: { sql: processSql, name: NAME, capacity: 1024 ** 3 },
        fault: (cut) =>
          Effect.suspend(() => {
            if (cut !== controls.cut) {
              return Effect.void;
            }

            controls.hits.push(cut);
            controls.cut = "";
            return Effect.fail(new LedgerError({ reason: "unreachable" }));
          }),
      },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ProgramLoader.layer(
            { counter: p },
            {
              wait: () =>
                Effect.gen(function* () {
                  controls.commands++;
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(gate);
                  return Outcome.ok(null);
                }),
            },
          ),
          ProcessStore.layer(processSql, { process: A }),
          Layer.effect(
            CheckedWriter,
            Effect.gen(function* () {
              const m = yield* Mailbox;
              const sessions = yield* SessionManager;
              const ledger = yield* Ledger;
              const p = yield* ProcessManager;
              return {
                append: (i: Incoming) => m.send(NAME, i.id, i.envelope.input, from({ parent: i.envelope.id })),
                commit: (id: string, session: Session, stream: string, event: Event) =>
                  Effect.gen(function* () {
                    controls.commits++;
                    const current = (yield* p.info)[0]!.process;
                    const signed = yield* sessions.receipt(id, session.parent, current, event._tag);
                    return yield* ledger.append(
                      stream,
                      id,
                      lineFor(from({ by: signed.by.key, parent: signed.parent }), event),
                    );
                  }),
                own: (id: string, stream: string, event: Event) =>
                  Effect.sync(() => {
                    controls.owns++;
                  }).pipe(Effect.andThen(ledger.append(stream, id, lineFor(from({ by: owner.key }), event)))),
              };
            }),
          ).pipe(Layer.provide(Layer.mergeAll(Mailbox.layer, ProcessManager.layer(brain(), next.next)))),
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Alarm, {
            set: (at) =>
              Effect.sync(() => {
                alarms.push(at);
              }),
          }),
          Layer.succeed(Recording, {
            flush: Effect.suspend(() =>
              controls.flush ? Effect.fail(new LedgerError({ reason: "storage" })) : Effect.void,
            ),
          }),
          ProcessManager.layer(brain(), next.next),
          Mailbox.layer,
        ).pipe(Layer.provideMerge(base())),
      ),
    );
  return {
    ledger,
    state,
    authority,
    next,
    controls,
    alarms,
    input,
    layer,
    manager,
    gate,
    entered,
    boot: ProcessManager.use((m) => m.start(first(), from())).pipe(Effect.provide(manager())),
    reopen: () => {
      ledger.reopen();
      state.reopen();
      authority.reopen();
    },
  };
});

const lives = read(`processes/${NAME}`);
const inbox = read(`${NAME}/inbox`);
const exitBody = Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }));
const restartBody = Schema.decodeUnknownSync(Schema.Struct({ after: Schema.String }));

const restart = (r: (typeof ProgramRunner)["Service"], id: string, build: string) =>
  Effect.gen(function* () {
    expect(r.restart, "P34 trusted Restart operation is missing").toBeTypeOf("function");
    return yield* r.restart({ id, build });
  });

describe("P34 interrupted recovery", () => {
  for (const cut of [
    "after_observation",
    "after_dead",
    "after_exit",
    "after_down",
    "after_start",
    "after_checkpoint",
  ]) {
    it.effect.prop(
      `failure gaps plant, clear before answer: ${cut} resumes one durable action`,
      { generated: Schema.Int },
      ({ generated }) =>
        Effect.forEach(
          [7, generated],
          (value) =>
            Effect.gen(function* () {
              const w = yield* world();
              yield* w.boot;
              w.controls.cut = cut;

              if (cut === "after_down") {
                w.controls.saved = true;
                // Accepted before the saved model, as P11 marks one: sent and indexed as placed.
                yield* Effect.gen(function* () {
                  const sent = yield* Mailbox.use((m) => m.send(NAME, "saved", { type: "add", n: value }, from()));

                  if (sent._tag === "placed") {
                    yield* ProcessStore.use((s) =>
                      s.save(
                        {
                          saved: {
                            v: 1,
                            build: "build-a",
                            model: { count: 0, replies: 0, queue: null },
                            after: 0,
                          },
                          turn: null,
                          cmds: [],
                        },
                        [{ id: "saved", rev: sent.rev, pos: sent.pos }],
                      ),
                    );
                  }
                }).pipe(Effect.provide(w.layer()));
                yield* ProgramRunner.use((r) => Effect.exit(r.open("wake"))).pipe(Effect.provide(w.layer()));

                // P34 amendment: down is written only when the brake trips, so each successor
                // folds the same saved letter and crashes again until the restart budget is spent.
                for (let n = 0; n < 8 && w.controls.hits.length === 0; n++) {
                  const deadline = w.alarms.at(-1);

                  if (typeof deadline !== "number") {
                    break;
                  }

                  yield* TestClock.setTime(deadline);
                  yield* ProgramRunner.use((r) => Effect.exit(r.due(deadline))).pipe(Effect.provide(w.layer()));
                }
              } else if (cut === "after_checkpoint") {
                yield* Effect.gen(function* () {
                  const r = yield* ProgramRunner;
                  yield* r.msg(w.input("good", { type: "add", n: value }));
                  yield* Effect.exit(restart(r, "handoff", "build-b"));
                }).pipe(Effect.provide(w.layer()));
              } else {
                for (let n = 0; n < 3 && w.controls.hits.length === 0; n++) {
                  yield* ProgramRunner.use((r) => Effect.exit(r.msg(w.input("poison")))).pipe(
                    Effect.provide(w.layer()),
                  );
                  const deadline = w.alarms.at(-1);

                  if (typeof deadline === "number") {
                    yield* TestClock.setTime(deadline);
                    yield* ProgramRunner.use((r) => Effect.exit(r.due(deadline))).pipe(Effect.provide(w.layer()));
                  }
                }
              }

              expect(w.controls.hits, "the real recovery path must reach the injected cut").toEqual([cut]);
              w.reopen();
              yield* Effect.gen(function* () {
                const r = yield* ProgramRunner;

                for (let n = 0; n < 2; n++) {
                  const at = w.alarms.at(-1);

                  if (typeof at !== "number") {
                    break;
                  }

                  yield* TestClock.setTime(at);
                  yield* Effect.exit(r.due(at));
                }

                const rows = yield* lives;
                const exits = rows.filter((row) => row._tag === "exited");
                expect(new Set(exits.map((row) => exitBody(row.body).process)).size).toBe(exits.length);
                const restarts = rows.filter((row) => row._tag === "restarted");
                expect(new Set(restarts.map((row) => restartBody(row.body).after)).size).toBe(restarts.length);

                if (cut === "after_start") {
                  expect(restarts).toHaveLength(1);
                }

                if (cut === "after_checkpoint") {
                  expect((yield* r.open("new")).view).toMatchObject({ count: value });
                  expect((yield* inbox).map((row) => row.id)).toEqual(["good"]);
                }

                if (cut === "after_dead") {
                  const records = yield* Effect.forEach([A, B, W, X], (p) => read(`${p}/dead`), {
                    concurrency: 1,
                  });
                  expect(records.flat()).toMatchObject([
                    { body: { tries: 3, errors: ["TypeError", "TypeError", "TypeError"] } },
                  ]);
                  expect(yield* r.msg(w.input("poison"))).toMatchObject({
                    _tag: "refused",
                    reason: "dead",
                  });
                  expect(w.controls.steps).toBe(3);
                }
              }).pipe(Effect.provide(w.layer()));
            }),
          { discard: true },
        ),
      { arbitrary: { seed: 119120, runs: 12 } },
    );
  }

  it.effect(
    "wake probe plant, idle before observation: unfinished durable step recovers once without inventing a throw",
    () =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* w.boot;
        yield* ProcessStore.use((s) =>
          s.activity(Activity.cases.stepping.make({ process: A, letter: "interrupted", build: "build-a" })),
        ).pipe(Effect.provide(w.layer()));
        w.reopen();

        for (let n = 0; n < 2; n++) {
          yield* Effect.gen(function* () {
            yield* Effect.exit(ProgramRunner.use((r) => r.open("wake")));
            expect((yield* lives).filter((row) => row._tag === "exited")).toHaveLength(1);
            expect(yield* read(`${A}/dead`)).toEqual([]);
            expect(w.controls.steps).toBe(0);
          }).pipe(Effect.provide(w.layer()));
          w.reopen();
        }
      }),
  );

  it.effect("wake probe plant, corrupt marker means idle: runner fails closed before loading or stepping", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* w.boot;
      yield* ProcessStore.use((s) => s.activity(Activity.cases.idle.make({ process: A }))).pipe(
        Effect.provide(w.layer()),
      );
      w.state.sql.exec("UPDATE process_activity SET activity=?", '{"_tag":"stepping","process":"bad"}');
      w.reopen();
      yield* Effect.gen(function* () {
        const answer = yield* Effect.exit(ProgramRunner.use((r) => r.msg(w.input("good", { type: "add", n: 1 }))));
        expect(Exit.isFailure(answer)).toBe(true);
        expect(yield* inbox).toEqual([]);
        expect((yield* lives).filter((row) => row._tag === "restarted")).toEqual([]);
      }).pipe(Effect.provide(w.layer()));
    }),
  );

  it.effect("p35 plant, late old answer drives successor: record the old result without changing the new model", () =>
    Effect.gen(function* () {
      const w = yield* world();
      yield* w.boot;
      yield* Effect.gen(function* () {
        const r = yield* ProgramRunner;
        const pending = yield* r.msg(w.input("wait", { type: "wait" })).pipe(Effect.forkChild);
        yield* Deferred.await(w.entered);
        expect(r.restart, "P34 replacement operation is missing").toBeTypeOf("function");
        yield* r.restart({ id: "replace-wait", build: "build-b" });
        yield* Deferred.succeed(w.gate, undefined);
        yield* Fiber.join(pending);
        expect((yield* r.open("new")).view).toMatchObject({ replies: 0 });
        expect(w.controls.commands).toBe(1);
        const answers = [...(yield* read(A)), ...(yield* inbox)].filter((row) =>
          JSON.stringify(row.body).includes('"type":"wait_ok"'),
        );
        expect(answers).toHaveLength(1);
        expect(answers[0]!.id).toBe(`${A}/1/0/answer`);
      }).pipe(Effect.provide(w.layer()));
    }),
  );

  it.effect.prop(
    "p69 plant, copy old receipts or fall back to own: a saved queued parent cannot authorize the successor's write",
    { generated: Schema.Int },
    ({ generated }) =>
      Effect.forEach(
        [1, generated],
        (value) =>
          Effect.gen(function* () {
            const w = yield* world();
            yield* w.boot;
            yield* Effect.gen(function* () {
              const r = yield* ProgramRunner;
              const sessions = yield* SessionManager;
              const input = w.input("queued", { type: "queue" });
              yield* sessions.record({
                id: input.envelope.id,
                by: owner,
                client: "caller",
                process: A,
                name: "queue",
                personOnly: false,
                digest: JSON.stringify(input.envelope.input),
                traceId: from().traceId,
                span: input.span,
                arrivedAt: 0,
              });
              yield* sessions.delivered(input.envelope.id, A);
              yield* r.msg(input);
              yield* restart(r, "queued-replacement", "build-b");
              expect(yield* r.msg(w.input("release", { type: "add", n: value }))).toMatchObject({
                _tag: "accepted",
              });
              expect(yield* read("facts")).toEqual([]);
              expect(w.controls.owns).toBe(0);
              expect(w.controls.commits).toBe(0);
              expect(
                (yield* inbox).filter((row) => JSON.stringify(row.body).includes('"type":"write_err"')),
              ).toMatchObject([{ body: { m: { reason: "not_delivered" } } }]);
            }).pipe(Effect.provide(w.layer()));
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );

  for (const part of ["save", "flush"] as const) {
    it.effect(`storage plant, success before required ${part}: no terminal answer or further work`, () =>
      Effect.gen(function* () {
        const w = yield* world();
        yield* w.boot;
        w.controls[part] = true;
        yield* Effect.gen(function* () {
          const r = yield* ProgramRunner;
          const answer = yield* Effect.exit(r.msg(w.input("poison")));
          expect(Exit.isFailure(answer)).toBe(true);
          const steps = w.controls.steps;
          yield* Effect.exit(r.msg(w.input("another", { type: "add", n: 1 })));
          expect(yield* inbox).toEqual([]);
          expect(w.controls.commands).toBe(0);
          expect(w.controls.steps).toBe(steps);
        }).pipe(Effect.provide(w.layer()));
      }),
    );
  }

  // P12 supplies its real local-stage test driver. This file stays in the tests role's paths.
  // Set P34_STAGE_DRIVER to that module's file URL on the lead's machine. Its open function
  // installs P34's trusted failure hook, never a public fault endpoint. waitForRecovery waits
  // for the real object's alarm; evict reconstructs the actual object with its durable storage.
  // scenario: the optional P12 driver runs real object alarms and reconstruction on the local stage.
  it.skipIf(!process.env.P34_STAGE_DRIVER)(
    "scenario: p80 real stage: durable poison, down resends and duplicate alarms survive object reconstruction",
    async () => {
      type Status = { process: string; state: string; until: number | null };
      type Stage = {
        send: (id: string, m: unknown) => Effect.Effect<{ _tag: string; reason?: string }, unknown>;
        status: Effect.Effect<Status, unknown>;
        evict: Effect.Effect<void, unknown>;
        waitForRecovery: Effect.Effect<void, unknown>;
        duplicateAlarm: Effect.Effect<void, unknown>;
        dead: Effect.Effect<ReadonlyArray<unknown>, unknown>;
        input: (id: string) => Effect.Effect<unknown, unknown>;
        executions: Effect.Effect<number, unknown>;
        close: Effect.Effect<void>;
      };
      const modulePath = process.env.P34_STAGE_DRIVER!;
      const driver: { open: (errors: ReadonlyArray<string>) => Effect.Effect<Stage, unknown> } = await import(
        modulePath
      );
      await Effect.runPromise(
        Effect.acquireUseRelease(
          driver.open(["TypeError", "RangeError", "TypeError"]),
          (s) =>
            Effect.gen(function* () {
              const original = { type: "poison" };

              for (let n = 1; n <= 3; n++) {
                const answer = yield* Effect.exit(s.send("poison", original));
                expect(answer).toMatchObject(
                  n < 3 ? { _tag: "Failure" } : { _tag: "Success", value: { _tag: "refused", reason: "dead" } },
                );
                const down = yield* s.status;
                // P34 amendment: three crashes stay inside the restart budget, so no down event.
                expect(down.state).toBe("ended");
                yield* Effect.exit(s.send("poison", original));
                expect(yield* s.status).toEqual(down);
                expect(yield* s.executions).toBe(n);
                yield* s.evict;
                expect(yield* s.status).toEqual(down);
                yield* s.waitForRecovery;
                const next = yield* s.status;
                expect(next.process).not.toBe(down.process);
                yield* s.duplicateAlarm;
                expect(yield* s.status).toEqual(next);
              }

              expect(yield* s.send("poison", original)).toMatchObject({
                _tag: "refused",
                reason: "dead",
              });
              expect(yield* s.executions).toBe(3);
              expect(yield* s.dead).toMatchObject([
                { tries: 3, limit: 3, m: "poison", errors: ["TypeError", "RangeError", "TypeError"] },
              ]);
              expect(yield* s.input("poison")).toMatchObject({ envelope: { input: original } });
              expect(yield* s.send("good", { type: "add", n: 1 })).toMatchObject({ _tag: "accepted" });
            }),
          (s) => s.close,
        ),
      );
    },
  );
});
