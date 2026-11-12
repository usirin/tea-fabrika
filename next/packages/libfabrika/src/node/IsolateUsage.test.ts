// next/. The driver owns SQLite; runtime's suite owns the laws (0062).
// edge: node:sqlite is the driver under test, with synchronous transactions
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { workerLoader } from "../cloudflare/index.ts";
import type { Env } from "../cloudflare/runtime.ts";
import { tail } from "../cloudflare/tail.ts";
import { InputId, Writer } from "../coordination/index.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "../runtime/Entry.ts";
import { nodeExecution } from "../runtime/Execution.ts";
import * as IsolateUsageTest from "../runtime/IsolateUsageTest.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import { ProgramRunner } from "../runtime/Runner.ts";
import type { Sql } from "../Sql.ts";

const PID = "process_0000000000e008000000000001";
const NAME = "checklist:1";

const FROM = {
  by: "SHA256:fixture",
  for: "person-test",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "fixture-build",
};

const OWNER = Writer.cases.person.make({ key: FROM.by, for: FROM.for });
const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "isolate-usage-" }).pipe(Effect.orDie);
  const file = path.join(folder, "store.db");
  const handle = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const db = new DatabaseSync(file);
      return { db, sql: nodeSql(db) };
    }),
    (held) =>
      Effect.sync(() => {
        if (held.db.isOpen) {
          held.db.close();
        }
      }),
  );
  const sql: Sql = {
    exec: (query, ...params) => handle.sql.exec(query, ...params),
    transaction: (body) => handle.sql.transaction(body),
    size: () => handle.sql.size(),
  };
  return {
    sql,
    reopen: Effect.sync(() => {
      handle.db.close();
      handle.db = new DatabaseSync(file);
      handle.sql = nodeSql(handle.db);
    }),
  } satisfies IsolateUsageTest.Store;
}).pipe(Effect.provide(NodeServices.layer));

const deliver: IsolateUsageTest.Deliver = (props, events, receive) => {
  return Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) => {
      // oxlint-disable-next-line fabrika/no-type-assertions -- fake platform namespace routes to the real recorder under the receiving object's tracer
      const env = {
        PROCESS: {
          getByName: (object: string) => ({
            // edge: platform RPC returns a Promise; cancellation releases a hung receiver too
            usage: (rows: Parameters<typeof receive>[1]) =>
              Effect.runPromise(receive(object, rows), { signal: controller.signal }),
          }),
        },
      } as unknown as Env;
      // oxlint-disable-next-line fabrika/no-type-assertions -- only the platform timing fields are needed; no platform type is named outside cloudflare/
      return tail(env, props, events as unknown as Parameters<typeof tail>[2]);
    },
    (controller) => Effect.sync(() => controller.abort()),
  );
};

const fixture = (executed: () => void) => {
  const Model = Schema.Struct({ sum: Schema.Int });
  const Msg = Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int });
  return {
    name: "usage-fixture",
    machine: Machine.make({
      model: Model,
      msg: Msg,
      cmds: [],
      init: (saved) => [saved ?? { sum: 0 }, []],
      update: {
        add: (model, msg) => {
          executed();
          return [{ sum: model.sum + msg.n }, []];
        },
      },
    }),
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Msg,
    view: { data: Model, select: (model: typeof Model.Type) => model },
    refuse: () => null,
    inputs: { add: { _tag: "write", schema: Msg, description: "Add", personOnly: false } },
    outputs: {},
    writes: {},
    wake: () => null,
  } as const;
};

const invoke = (process: string) =>
  Effect.gen(function* () {
    const loaded = yield* ProgramLoader.use((loader) => loader.load("usage-fixture", "fixture-build")).pipe(
      Effect.provide(ProgramLoader.layer({ "usage-fixture": fixture(() => {}) }, {})),
    );
    yield* loaded.execution
      .step({ sum: 0 }, { type: "add", n: 1 })
      .pipe(Effect.annotateSpans({ "fab.process": process }));
  });

const runner = (usage: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const ledger = yield* open;
    const state = yield* open;
    let executions = 0;
    const program = fixture(() => {
      executions++;
    });
    const execution = nodeExecution(program);
    // Only Worker Loader transport is doubled; the runner uses the real loader and RPC decoder.
    const rpc = {
      describe: () =>
        Promise.resolve({
          name: program.name,
          v: 1,
          writes: {},
          inputs: { add: { write: true, personOnly: false } },
          cmds: [],
        }),
      init: (saved: unknown) => Effect.runPromise(execution.init(saved)),
      step: (model: unknown, msg: unknown) => Effect.runPromise(execution.step(model, msg)),
      fold: (model: unknown, msg: unknown) => Effect.runPromise(execution.fold(model, msg)),
      upgrade: (saved: unknown) => Effect.runPromise(execution.upgrade(saved)),
      reply: (cmd: unknown, outcome: unknown) => Effect.runPromise(execution.reply(cmd, outcome)),
      check: (kind: string, event: unknown) => Effect.runPromise(execution.check(kind, event)),
      admit: (msg: unknown) => Effect.runPromise(execution.admit(msg)),
    };
    // oxlint-disable-next-line fabrika/no-type-assertions -- only the platform loader and opaque tail fetcher are doubled
    const platform = { get: () => ({ getEntrypoint: () => rpc }) } as unknown as Parameters<typeof workerLoader>[0];
    const loader = workerLoader(platform, { "usage-fixture": { hash: "fixture-build", source: "fixture" } });
    const controller = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (held) => Effect.sync(() => held.abort()),
    );
    // oxlint-disable-next-line fabrika/no-type-assertions -- an opaque platform tail represents this runner's independent usage invocation
    const bound = {
      fetch: () => Effect.runPromise(usage.pipe(Effect.as(new Response())), { signal: controller.signal }),
    } as unknown as NonNullable<Parameters<typeof loader.load>[2]>;
    const data = Layer.mergeAll(
      LedgerSql.layer(ledger.sql, { reader: PID }),
      LedgerTransactionSql.layer(ledger.sql),
    ).pipe(Layer.provide(quiet));
    const coordination = ProcessManager.layer(
      {
        owner: Owner.cases.brain.make({}),
        recipient: Recipient.cases.client.make({ client: "fixture", session: PID }),
        by: FROM.by,
      },
      Effect.succeed(PID),
    ).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data))));
    const base = yield* Layer.build(coordination);
    yield* ProcessManager.use((manager) =>
      manager.start(
        Start.cases.first.make({ id: "boot", name: NAME, code: { program: "usage-fixture", hash: "fixture-build" } }),
        FROM,
      ),
    ).pipe(Effect.provideContext(base));
    const dependencies = Layer.mergeAll(
      ProcessStore.layer(state.sql, { process: PID }),
      Layer.effect(
        CheckedWriter,
        Effect.map(Mailbox, (mailbox) => ({
          append: (input: Incoming) => mailbox.send(NAME, input.id, input.envelope.input, FROM),
          commit: () => Effect.die("no write declared"),
          own: () => Effect.die("no write declared"),
        })),
      ),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Alarm, { set: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
    ).pipe(Layer.provideMerge(Layer.succeedContext(base)));
    const context = yield* Layer.build(
      ProgramRunner.withLoader(
        { id: PID, name: NAME, program: "usage-fixture", build: "fixture-build", owner: OWNER },
        { load: (name) => loader.load(name, PID, bound) },
        {
          recovery: { sql: state.sql, name: NAME, capacity: 1024 ** 3 },
        },
      ).pipe(Layer.provideMerge(dependencies)),
    );
    const service = yield* ProgramRunner.pipe(Effect.provideContext(context));
    yield* service.open("fixture");
    const snapshot = Effect.sync(() =>
      Object.fromEntries(
        ["process_state", "process_letters", "process_recovery", "process_receipts"].map((table) => [
          table,
          state.sql.exec(`SELECT * FROM ${table} ORDER BY rowid`),
        ]),
      ),
    );
    return {
      step: (id: string, n: number) =>
        service.msg({
          id,
          envelope: {
            id: Schema.decodeUnknownSync(InputId)("input_0000000000e008000000000001"),
            by: OWNER,
            arrivedAt: 0,
            input: { type: "add", n },
          },
          sentAt: FROM.sentAt,
          seen: 0,
          span: { traceId: FROM.traceId, spanId: "00f067aa0ba902b7" },
        }),
      snapshot,
      executions: () => executions,
    } satisfies IsolateUsageTest.World;
  });

IsolateUsageTest.suite({ open, deliver, runner, invoke });
