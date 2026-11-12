// P34c, next/. Only the Node runner imports the driver; all policy and recovery are real code.
import { Outcome } from "@demlik/tea";
import { Cmd, Machine } from "@demlik/tea/effect";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Writer } from "../access/SessionManager.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { Row } from "../ledger/Log.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Quotas } from "../processes/Quotas.ts";
import * as QuotasSql from "../processes/QuotasSql.ts";
import { Alarm, CheckedWriter, ProgramLoader, Recording, WatcherManager } from "../runtime/Entry.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import * as QuotaRunner from "../runtime/QuotaRunner.ts";
import * as QuotaRunnerTest from "../runtime/QuotaRunnerTest.ts";
import { recoveryStore } from "../runtime/RecoveryStore.ts";
import { ProgramRunner } from "../runtime/Runner.ts";
import type { Sql } from "../Sql.ts";
import * as ProgramMailTestSupport from "./ProgramMail.test-support.ts";

const NAMES = ["alpha:1", "alpha:2", "beta:1"];
const identity = (name: string) => (name.startsWith("alpha:") ? "sample/alpha" : "sample/beta");
const BRAIN = "SHA256:brain";

const from = () => ({
  by: "SHA256:input",
  for: "test-person",
  sentAt: "2099-01-01T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "test",
});

const person = Writer.cases.person.make({ key: "SHA256:input", for: "test-person" });
const Model = Schema.Struct({ count: Schema.Int, replies: Schema.Int, wake: Schema.NullOr(Schema.Number) });

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("throw") }),
  Schema.Struct({ type: Schema.Literal("work") }),
  Schema.Struct({ type: Schema.Literal("schedule"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number }),
]);

const work = Cmd.make("work", { input: Schema.Struct({}), ok: Schema.Null, err: ["failed"] });

const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [work],
  init: (saved) => [saved ?? { count: 0, replies: 0, wake: null }, []],
  update: {
    inc: (s) => [{ ...s, count: s.count + 1 }, []],
    throw: () => {
      throw new TypeError("quota recovery fixture");
    },
    work: (s) => [s, [work({})]],
    schedule: (s, m) => [{ ...s, wake: m.at }, []],
    timer: (s) => [{ ...s, count: s.count + 1, wake: null }, []],
    work_ok: (s) => [{ ...s, replies: s.replies + 1 }, []],
    work_err: (s) => [{ ...s, replies: s.replies + 1 }, []],
  },
});

const program = (name: string) => ({
  name,
  machine,
  maxDeliveries: 3,
  state: { v: 1, schema: Model, upgrades: [] },
  msg: Msg,
  view: { data: Model, select: (s: typeof Model.Type) => s },
  refuse: () => null,
  inputs: Object.fromEntries(
    ["inc", "throw", "work", "schedule"].map((key) => [
      key,
      {
        ...Schema.TaggedStruct("write", {}).make({}),
        schema: Msg,
        personOnly: false,
        description: key,
      },
    ]),
  ),
  outputs: {},
  writes: {},
  wake: (s: typeof Model.Type) => s.wake,
});

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

const snapshot = (sql: Sql) =>
  Object.fromEntries(
    sql
      .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map(({ name }) => [String(name), sql.exec(`SELECT * FROM ${quote(String(name))}`)]),
  );

const open = Effect.fnUntraced(function* (initial: QuotaRunnerTest.Limits) {
  const store = yield* ProgramMailTestSupport.runtime;
  let limits = initial;
  let cut: number | null = null;
  let sequence = 0;
  const sqls = new Map<string, Sql>();
  const sql = (part: string): Sql => {
    const known = sqls.get(part);

    if (known !== undefined) {
      return known;
    }

    const raw = store.sql(part);
    const wrapped: Sql = {
      exec: (query, ...params) => {
        if (cut !== null && /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query)) {
          if (cut-- === 0) {
            cut = null;
            throw new Error("SQLITE_FULL at a real write boundary");
          }
        }

        return raw.exec(query, ...params);
      },
      transaction: (f) => raw.transaction(f),
      size: () => raw.size(),
    };
    sqls.set(part, wrapped);
    return wrapped;
  };
  const project = sql("project");
  const pid = Effect.sync(() => `process_0000000000e008${(++sequence).toString(16).padStart(12, "0")}`);
  const caller = {
    by: BRAIN,
    owner: Owner.cases.brain.make({}),
    recipient: Recipient.cases.client.make({ client: "test", session: "process_0000000000e008000000000099" }),
  };
  const data = () =>
    Layer.mergeAll(LedgerSql.layer(project, { reader: "quota-test" }), LedgerTransactionSql.layer(project)).pipe(
      Layer.provideMerge(QuotasSql.layer(project, { brain: BRAIN, limits })),
      Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
    );
  const manager = () => ProcessManager.layer(caller, pid).pipe(Layer.provideMerge(data()));

  for (const name of NAMES) {
    yield* ProcessManager.use((m) =>
      m.start(Start.cases.first.make({ id: `start:${name}`, name, code: { program: identity(name), hash: "test" } }), {
        ...from(),
        by: BRAIN,
      }),
    ).pipe(Effect.provide(manager()));
  }

  // These are synchronous ports over the real name-local SQL, recreated from saved accounting.
  const accounting = (name: string) => QuotasSql.accounting(sql(name), { name, limits: limits.recovery.process });
  const base = () => Layer.mergeAll(Mailbox.layer, ProcessManager.layer(caller, pid)).pipe(Layer.provideMerge(data()));
  const runner = Effect.fnUntraced(function* (name: string) {
    const status = yield* ProcessManager.use((m) => m.status(name)).pipe(Effect.provide(manager()));
    const process = status.state.process;
    const local = accounting(name);
    const descriptor = { id: process, name, program: identity(name), build: "test", owner: person };
    const checked = Layer.effect(
      CheckedWriter,
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        return {
          append: (incoming) =>
            mailbox.send(name, incoming.id, incoming.envelope.input, {
              ...from(),
              parent: incoming.envelope.id,
              by: incoming.envelope.by.key,
            }),
          sign: () => Effect.die("no program write"),
          commit: () => Effect.die("no program write"),
          own: () => Effect.die("no program write"),
        };
      }),
    );
    const layer = ProgramRunner.layer(descriptor, {
      recovery: { sql: sql(name), name, capacity: 1_000_000_000, accounting: local },
    }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          ProgramLoader.layer(
            { "sample/alpha": program("sample/alpha"), "sample/beta": program("sample/beta") },
            { work: () => Effect.succeed(Outcome.ok(null)) },
          ),
          ProcessStore.layer(sql(name), { process, accounting: local }),
          checked,
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Recording, { flush: Effect.void }),
          Layer.succeed(Alarm, { set: (at) => store.alarms.set(name, at) }),
        ).pipe(Layer.provideMerge(base())),
      ),
    );
    return QuotaRunner.guard(yield* ProgramRunner.pipe(Effect.provide(layer)), local);
  });
  const checkpoint = Effect.fnUntraced(function* (name: string) {
    const status = yield* ProcessManager.use((m) => m.status(name)).pipe(Effect.provide(manager()));
    return yield* ProcessStore.use((s) => s.load).pipe(
      Effect.provide(
        ProcessStore.layer(sql(name), {
          process: status.state.process,
          accounting: accounting(name),
        }),
      ),
      Effect.provide(data()),
    );
  });
  return {
    runner,
    input: Effect.fnUntraced(function* (name, id, m) {
      // Admission only, so laws can inspect charges before the real step starts.
      return yield* Mailbox.use((mailbox) => mailbox.send(name, id, m, { ...from(), parent: null })).pipe(
        Effect.provide(base()),
      );
    }),
    program: (program) => Quotas.use((q) => q.program(program)).pipe(Effect.provide(data())),
    local: (name) => accounting(name).status,
    projectRecovery: (name) => Quotas.use((q) => q.recovery(name)).pipe(Effect.provide(data())),
    checkpoint,
    replace: Effect.fnUntraced(function* (name, saved) {
      const status = yield* ProcessManager.use((m) => m.status(name)).pipe(Effect.provide(manager()));
      return yield* ProcessStore.use((s) => s.save(saved)).pipe(
        Effect.provide(
          ProcessStore.layer(sql(name), {
            process: status.state.process,
            accounting: accounting(name),
          }),
        ),
        Effect.provide(data()),
      );
    }),
    journal: (name) =>
      recoveryStore(sql(name), {
        name,
        capacity: 1_000_000_000,
        schema: QuotaRunnerTest.supervision,
        accounting: accounting(name),
      }).load,
    entries: Effect.sync(() => project.exec("SELECT * FROM entries ORDER BY rev").map(Schema.decodeUnknownSync(Row))),
    snapshot: Effect.sync(() => Object.fromEntries([...sqls].map(([name, db]) => [name, snapshot(db)]))),
    reopen: store.reopen,
    cut: (at) => {
      cut = at;
    },
    limits: (next) => {
      limits = next;
    },
    restart: Effect.fnUntraced(function* (name, id, person) {
      // The public adapter checks the caller; an agent cannot clear a reserve fault.
      return yield* QuotaRunner.restart(yield* runner(name), accounting(name), {
        id,
        build: "test",
        by: Writer.cases[person ? "person" : "agent"].make({ key: "SHA256:caller", for: "test-person" }),
      });
    }),
    drain: Effect.fnUntraced(function* (name) {
      yield* (yield* runner(name)).open("test");

      // Move only to alarms the product saved. No sleep and no independent quota timer.
      for (let n = 0; n < 16; n++) {
        const alarm = (yield* store.alarms.saved).find((a) => a.name === name);

        if (alarm === undefined) {
          break;
        }

        const saved = yield* recoveryStore(sql(name), {
          name,
          capacity: 1_000_000_000,
          schema: QuotaRunnerTest.supervision,
          accounting: accounting(name),
        }).load;

        if (saved?.journal._tag === "idle") {
          break;
        }

        yield* store.alarms.take(alarm);
        yield* TestClock.setTime(alarm.at);
        yield* (yield* runner(name)).due(alarm.at);
      }
    }),
  } satisfies QuotaRunnerTest.World;
});

QuotaRunnerTest.suite(open);
