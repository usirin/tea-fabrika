// next/. The driver owns SQLite; runtime's suite owns the laws (0062).
// edge: node:sqlite is the driver under test, with synchronous transactions
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Context, Effect, Exit, FileSystem, Layer, Path, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { ProcessReplies } from "../cloudflare/bindings.ts";
import { workerLoader } from "../cloudflare/index.ts";
import {
  processRuntime,
  ProcessService,
  projectLayer,
  ProjectService,
  type Env,
  type ProjectOptions,
} from "../cloudflare/runtime.ts";
import { tail } from "../cloudflare/tail.ts";
import { InputId, Writer } from "../coordination/index.ts";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import * as Audit from "../runtime/Audit.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "../runtime/Entry.ts";
import { nodeExecution } from "../runtime/Execution.ts";
import * as IsolateUsage from "../runtime/IsolateUsage.ts";
import * as IsolateUsageTest from "../runtime/IsolateUsageTest.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import { ProgramRunner } from "../runtime/Runner.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { Sql } from "../Sql.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager, Written } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { REFUSED, SpanRow } from "../telemetry/Trace.ts";

const PID = "process_0000000000e008000000000001";
const NAME = "checklist:1";

const CODE = {
  hash: "f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d",
  source: "fixture",
};

const FROM = {
  by: "SHA256:fixture",
  for: "person-test",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: CODE.hash,
};

// T753: each object reads its start from INSTANCE and confirms it with its Project.
const START = StartsTest.fixture(
  {
    name: "project-test",
    person: FROM.for,
    founder: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    window: null,
    port: 18787,
    build: CODE.hash,
  },
  (algorithm, data) => createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
);

const settingsStart = () => Promise.resolve(StartsTest.reply(START));

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
    name: "test/usage-fixture",
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
    const loaded = yield* ProgramLoader.use((loader) => loader.load("test/usage-fixture", CODE.hash)).pipe(
      Effect.provide(ProgramLoader.layer({ "test/usage-fixture": fixture(() => {}) }, {})),
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
      fresh: (model: unknown, msg: unknown) => Effect.runPromise(execution.fresh(model, msg)),
      update: (model: unknown, msg: unknown) => Effect.runPromise(execution.update(model, msg)),
      audit: (msg: unknown) =>
        Effect.runPromise(
          execution.audit(msg).pipe(
            Effect.match({
              onSuccess: (value: Schema.Json) => Audit.Answer.cases.ok.make({ value }),
              onFailure: Audit.failure,
            }),
          ),
        ),
      fold: (model: unknown, msg: unknown) => Effect.runPromise(execution.fold(model, msg)),
      upgrade: (saved: unknown) => Effect.runPromise(execution.upgrade(saved)),
      reply: (cmd: unknown, outcome: unknown) => Effect.runPromise(execution.reply(cmd, outcome)),
      check: (kind: string, event: unknown) => Effect.runPromise(execution.check(kind, event)),
      admit: (msg: unknown) => Effect.runPromise(execution.admit(msg)),
    };
    // oxlint-disable-next-line fabrika/no-type-assertions -- only the platform loader and opaque tail fetcher are doubled
    const platform = { get: () => ({ getEntrypoint: () => rpc }) } as unknown as Parameters<typeof workerLoader>[0];
    const loader = workerLoader(platform, { "test/usage-fixture": CODE });
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
        Start.cases.first.make({ id: "boot", name: NAME, code: { program: "test/usage-fixture", hash: CODE.hash } }),
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
        { id: PID, name: NAME, program: "test/usage-fixture", build: CODE.hash, owner: OWNER },
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

const telemetry: IsolateUsageTest.Rig["telemetry"] = (sql, object) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      Layer.mergeAll(SpanSink.layer(sql, { object }), RecordManager.memory(1_000_000_000), Archive.memory),
    );
    return {
      record: (usage) =>
        SpanSink.use((sink) => sink.batch(IsolateUsage.record(usage))).pipe(Effect.provideContext(context)),
      flush: SpanSink.use((sink) => sink.flush).pipe(Effect.provideContext(context)),
    } satisfies IsolateUsageTest.Recording;
  });

const rows: IsolateUsageTest.Rig["rows"] = (sql) =>
  sql.exec("SELECT name FROM sqlite_master WHERE name='unsent'").length === 0
    ? []
    : sql
        .exec("SELECT row FROM unsent ORDER BY rowid")
        .map((r) => Schema.decodeUnknownSync(Schema.fromJsonString(SpanRow))(r.row));

const health: IsolateUsageTest.Rig["health"] = (sql) =>
  sql.exec("SELECT name FROM sqlite_master WHERE name='measurements'").length === 0
    ? []
    : sql.exec("SELECT * FROM measurements WHERE piece='isolate.cpu' ORDER BY rowid");

IsolateUsageTest.suite({ open, deliver, runner, invoke, telemetry, rows, health });

for (const accepted of [true, false]) {
  it.effect.prop(
    `U7 ProcessService.usage flushes ${accepted ? "successful" : "rejected"} calls before returning, without opening the runner`,
    {
      batch: Schema.Array(
        Schema.Struct({
          ...IsolateUsage.Usage.fields,
          process: Schema.Literal(PID),
          cpuMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30_000 })),
          wallMs: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 30_000 })),
        }),
      ).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
    },
    ({ batch }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const state = yield* open;
          const written: Array<SpanRow> = [];
          const saved = { id: PID, name: NAME, program: "test/usage-fixture", build: CODE.hash, owner: OWNER };
          // oxlint-disable-next-line fabrika/no-type-assertions -- native storage handles only; the Process service and telemetry sink are real
          const ctx = {
            id: { name: JSON.stringify(["project-test", NAME]) },
            storage: {
              sql: {
                exec: state.sql.exec,
                get databaseSize() {
                  return state.sql.size();
                },
              },
              transactionSync: state.sql.transaction,
              get: () => Promise.resolve(saved),
            },
          } as unknown as Parameters<typeof processRuntime>[0];
          // oxlint-disable-next-line fabrika/no-type-assertions -- record RPC is captured at the platform edge; program execution must remain unopened
          const env = {
            INSTANCE: JSON.stringify(START),
            PROJECT: { getByName: () => ({ settingsStart }) },
            RECORD: {
              getByName: () => ({
                write: (_chain: unknown, _part: number, sent: ReadonlyArray<{ span: SpanRow }>) => {
                  written.push(...sent.map(({ span }) => span));
                  return Promise.resolve(Written.cases.written.make({}));
                },
              }),
            },
          } as unknown as Env;
          const runtime = yield* Effect.acquireRelease(
            Effect.sync(() => processRuntime(ctx, env, {})),
            (held) => Effect.promise(() => held.dispose()),
          );
          // Initialize first, so no startup flush can accidentally satisfy the wake's obligation.
          yield* Effect.promise(() => runtime.runPromise(ProcessService));
          written.length = 0;
          const input = accepted ? batch : batch.map((row) => ({ ...row, cpuMs: -row.cpuMs - 1 }));
          const result = yield* Effect.promise(() =>
            runtime.runPromise(ProcessService.use((service) => Effect.exit(service.usage(input)))),
          );
          expect(Exit.isSuccess(result)).toBe(accepted);
          // Inspect delivery now, before disposal or any other service call can flush it.
          const calls = written.filter((row) => row.name === "process.usage");
          expect(calls, "the ended usage span must reach the record during this wake").toHaveLength(1);
          expect(calls[0]?.ok).toBe(accepted);
          expect(written.filter((row) => row.name === "isolate.cpu")).toHaveLength(accepted ? batch.length : 0);
          expect(rows(state.sql), "the wake must leave no telemetry awaiting a later runner call").toHaveLength(0);
        }),
      ),
    { arbitrary: { seed: 119120, runs: 40 } },
  );
}

it.effect("U3 batched refused spans keep only hourly counts, including batches with no accepted span", () =>
  Effect.gen(function* () {
    const once = (batches: ReadonlyArray<{ refused: ReadonlyArray<string>; accepted: number }>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* open;
          const context = yield* Layer.build(
            Layer.mergeAll(
              SpanSink.layer(store.sql, { object: NAME }),
              RecordManager.memory(1_000_000_000),
              Archive.memory,
            ),
          );
          const sink = yield* SpanSink.pipe(Effect.provideContext(context));
          const counts = new Map<string, number>();
          let accepted = 0;

          for (const batch of batches) {
            // First commit only refusals. A later accepted span must not be needed to land counts.
            for (const keep of [0, batch.accepted]) {
              yield* TestClock.setTime(0);
              yield* sink.batch(
                Effect.gen(function* () {
                  for (const reason of batch.refused) {
                    const span = yield* Effect.makeSpan("gateway.route", { attributes: { [REFUSED]: reason } });
                    span.end(span.status.startTime, Exit.void);
                    counts.set(reason, (counts.get(reason) ?? 0) + 1);
                  }

                  for (let n = 0; n < keep; n++) {
                    const span = yield* Effect.makeSpan("gateway.route");
                    span.end(span.status.startTime, Exit.void);
                  }
                }),
              );
              accepted += keep;
              expect(rows(store.sql)).toHaveLength(accepted);
              expect(store.sql.exec("SELECT * FROM measurements WHERE piece='gateway.route'")).toHaveLength(accepted);
              expect(rows(store.sql).every((row) => row.attributes[REFUSED] === undefined)).toBe(true);
              // Read the sampled hour only after it closes; each batch above samples that same hour.
              yield* TestClock.setTime(3_600_000);
              const sums = yield* sink.sums("gateway.route", 0, 3_600_000);
              expect(sums.map(({ refused, count }) => [refused, count])).toEqual([...counts].sort());
              expect(store.sql.exec("SELECT * FROM sums")).toHaveLength(counts.size);
            }
          }

          yield* store.reopen;
          expect(rows(store.sql)).toHaveLength(accepted);
          expect(store.sql.exec("SELECT * FROM sums")).toHaveLength(counts.size);
        }),
      ).pipe(Effect.provide(TestClock.layer()));
    const batches = fc.array(
      fc.record({
        refused: fc.array(fc.constantFrom("reserved", "other"), { minLength: 1, maxLength: 32 }),
        accepted: fc.integer({ min: 1, max: 32 }),
      }),
      { minLength: 1, maxLength: 12 },
    );
    const property = fc.asyncProperty(batches, (tape) => Effect.runPromise(once(tape)));
    yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 40 }));
  }),
);

// 100 runs took 50.4 s and 58.4 s in CI (runs 43324397786 and 43323883004), and passed 60 s once
// (43321257103, ticket 889). Budget 2 s per run, 3.4 times the slowest passing run.
const u8Runs = { seed: 119120, numRuns: 100 };

it.effect(
  "U8 Process and rebuilt Project runtimes bind every load to its own process",
  () =>
    Effect.gen(function* () {
      const once = (tape: ReadonlyArray<boolean>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const log = yield* open;
            const state = yield* open;
            let next = 1;
            const data = Layer.mergeAll(
              LedgerSql.layer(log.sql, { reader: "project-test" }),
              LedgerTransactionSql.layer(log.sql),
            ).pipe(Layer.provide(quiet));
            const context = yield* Layer.build(
              ProcessManager.layer(
                {
                  owner: Owner.cases.brain.make({}),
                  recipient: Recipient.cases.client.make({ client: "test", session: PID }),
                  by: FROM.by,
                },
                Effect.sync(() => `process_0000000000e00800${String(++next).padStart(10, "0")}`),
              ).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data)))),
            );
            const manager = Context.get(context, ProcessManager);
            const ledger = Context.get(context, Ledger);
            yield* manager
              .start(
                Start.cases.first.make({
                  id: "boot",
                  name: NAME,
                  code: { program: "test/usage-fixture", hash: CODE.hash },
                }),
                FROM,
              )
              .pipe(Effect.provideContext(context));
            const rpc = <A, E>(work: Effect.Effect<A, E>) =>
              Effect.runPromise(work.pipe(Effect.provideContext(context)));
            const ok = <A, E>(work: Effect.Effect<A, E>) =>
              rpc(Effect.map(work, (value) => ProcessReplies.cases.ok.make({ value })));
            const project = {
              read: (stream: string, after: number) => rpc(Stream.runCollect(ledger.read(stream, after))),
              append: (...args: Parameters<typeof ledger.append>) => rpc(ledger.append(...args)),
              processStatus: (...args: Parameters<typeof manager.status>) => ok(manager.status(...args)),
              processStart: (...args: Parameters<typeof manager.start>) => ok(manager.start(...args)),
              processExit: (...args: Parameters<typeof manager.exit>) => ok(manager.exit(...args)),
              processIsLive: (...args: Parameters<typeof manager.isLive>) => rpc(manager.isLive(...args)),
              publish: () => Promise.resolve(),
              settingsStart,
            };
            const saved = { id: PID, name: NAME, program: "test/usage-fixture", build: CODE.hash, owner: OWNER };
            const values = new Map<string, unknown>([["descriptor", saved]]);
            const bound = new Map<object, IsolateUsageTest.Props>();
            const seen: Array<{ key: string; tails: ReadonlyArray<object> | undefined }> = [];
            const execution = nodeExecution(fixture(() => {}));
            const loopbacks = {
              IsolateTail: ({ props }: { props: IsolateUsageTest.Props }) => {
                const tail = { fetch: () => Promise.resolve(new Response()) };
                bound.set(tail, props);
                return tail;
              },
            };
            // oxlint-disable-next-line fabrika/no-type-assertions -- only native object handles are supplied; processRuntime and its loader are real
            const ctx = {
              id: { name: JSON.stringify(["project-test", NAME]) },
              storage: {
                sql: {
                  exec: state.sql.exec,
                  get databaseSize() {
                    return state.sql.size();
                  },
                },
                transactionSync: state.sql.transaction,
                get: (key: string) => Promise.resolve(values.get(key)),
                put: (key: string, value: unknown) => {
                  values.set(key, value);
                  return Promise.resolve();
                },
                delete: (key: string) => Promise.resolve(values.delete(key)),
                sync: () => Promise.resolve(),
                setAlarm: () => Promise.resolve(),
                deleteAlarm: () => Promise.resolve(),
              },
              exports: loopbacks,
            } as unknown as Parameters<typeof processRuntime>[0];
            // oxlint-disable-next-line fabrika/no-type-assertions -- native RPC handles and loader transport only; ledger, manager, runner and bindings stay real
            const env = {
              INSTANCE: JSON.stringify(START),
              PROJECT: { getByName: () => project },
              RECORD: { getByName: () => ({ write: () => Promise.resolve(Written.cases.written.make({})) }) },
              LOADER: {
                get: (key: string, code: () => { tails?: ReadonlyArray<object> }) => {
                  seen.push({ key, tails: code().tails });
                  return {
                    getEntrypoint: () => ({
                      describe: () =>
                        Promise.resolve({
                          name: "test/usage-fixture",
                          v: 1,
                          inputs: { add: { write: true, personOnly: false } },
                          writes: {},
                          cmds: [],
                        }),
                      init: (saved: unknown) => rpc(execution.init(saved)),
                      fold: (model: unknown, msg: unknown) => rpc(execution.fold(model, msg)),
                    }),
                  };
                },
              },
            } as unknown as Env;
            const runtime = yield* Effect.acquireRelease(
              Effect.sync(() => processRuntime(ctx, env, { "test/usage-fixture": CODE })),
              (held) => Effect.promise(() => held.dispose()),
            );
            const service = yield* Effect.promise(() => runtime.runPromise(ProcessService));
            yield* service.open("first");

            for (const [n, replace] of tape.entries()) {
              if (replace) {
                yield* service.restart({ id: `restart-${n}`, build: CODE.hash });
              }

              yield* service.open(`client-${n}`);
              const status = yield* manager.status(NAME).pipe(Effect.provideContext(context));
              expect(status.state._tag).toBe("live");

              if (status.state._tag === "live") {
                expect(seen.at(-1)?.key).toBe(`${CODE.hash}/${status.state.process}`);
              }
            }

            expect(seen.length).toBeGreaterThan(0);

            for (const load of seen) {
              expect(load.tails).toHaveLength(1);
              expect(load.tails?.map((tail) => bound.get(tail))).toEqual([
                { project: "project-test", name: NAME, process: load.key.slice(`${CODE.hash}/`.length) },
              ]);
            }

            // The Project also loads policies for a name started outside its own cached start path.
            const projectStore = yield* open;
            const projectValues = new Map<string, unknown>();
            // oxlint-disable-next-line fabrika/no-type-assertions -- the Project receives only native SQL, storage and loopback handles
            const projectCtx = {
              id: { name: "project-test" },
              storage: {
                sql: {
                  exec: projectStore.sql.exec,
                  get databaseSize() {
                    return projectStore.sql.size();
                  },
                },
                transactionSync: projectStore.sql.transaction,
                get: (key: string) => Promise.resolve(projectValues.get(key)),
                put: (key: string, value: unknown) => {
                  projectValues.set(key, value);
                  return Promise.resolve();
                },
              },
              exports: loopbacks,
            } as unknown as Parameters<typeof projectLayer>[0];
            const descriptors = new Map<string, typeof saved>();
            // oxlint-disable-next-line fabrika/no-type-assertions -- native Process RPC handles only; descriptors come from the processes started below
            const projectEnv = {
              ...env,
              PROCESS: {
                getByName: (object: string) => ({
                  configure: (descriptor: typeof saved) => {
                    descriptors.set(object, descriptor);
                    return Promise.resolve();
                  },
                  descriptor: () => Promise.resolve(descriptors.get(object)),
                  swap: () => Promise.resolve({ _tag: "same" }),
                }),
              },
            } as unknown as Env;
            let policy: Parameters<ProjectOptions["door"]>[0]["policy"] = () =>
              Effect.die("Project door not initialized");
            const beforeProject = seen.length;
            const projectOptions: ProjectOptions = {
              programs: { "test/usage-fixture": CODE },
              bootstrap: [{ name: "bootstrap:1", id: "bootstrap", program: "test/usage-fixture" }],
              door: (options) =>
                Effect.sync(() => {
                  policy = options.policy;
                  const unused = () => Effect.die("Unexpected door call in loader law");
                  return {
                    connect: unused,
                    challenge: unused,
                    initialize: unused,
                    target: unused,
                    route: unused,
                    knock: unused,
                    grant: unused,
                    disconnect: unused,
                    sign: unused,
                    append: unused,
                    retire: () => Effect.void,
                    checkDelivery: unused,
                  };
                }),
            };
            const projectServices = yield* Layer.build(projectLayer(projectCtx, projectEnv, projectOptions));
            const p = Context.get(projectServices, ProjectService);
            const bootstrap = seen.slice(beforeProject);
            expect(bootstrap.length).toBeGreaterThan(0);

            for (const load of bootstrap) {
              expect(load.key.startsWith(`${CODE.hash}/project:`)).toBe(true);
              expect(load.tails).toBeUndefined();
            }

            // An independent manager writes to the real Project log, like another starter.
            const starters = yield* Layer.build(
              ProcessManager.layer(
                {
                  owner: Owner.cases.brain.make({}),
                  recipient: Recipient.cases.client.make({ client: "starter", session: PID }),
                  by: "brain:project-test",
                },
                Effect.sync(() => `process_0000000000e00800${String(++next).padStart(10, "0")}`),
              ).pipe(Layer.provide(LedgerTransactionSql.layer(projectStore.sql).pipe(Layer.provide(quiet)))),
            );
            const starter = Context.get(starters, ProcessManager);

            for (const [n] of tape.entries()) {
              const name = `policy:${n}`;
              const first = yield* starter.start(
                Start.cases.first.make({
                  id: `first-${n}`,
                  name,
                  code: { program: "test/usage-fixture", hash: CODE.hash },
                }),
                FROM,
              );
              const restarted = yield* p.processExit(first.process, ExitReason.cases.normal.make({}), FROM);
              expect(restarted._tag).toBe("ok");
              const successor = yield* starter.start(
                Start.cases.again.make({
                  id: `again-${n}`,
                  name,
                  after: first.process,
                  reason: "restart",
                  code: { program: "test/usage-fixture", hash: CODE.hash },
                }),
                FROM,
              );
              const after = successor.process;
              descriptors.set(JSON.stringify(["project-test", name]), { ...saved, id: after, name });
              yield* policy(after);
              const load = seen.at(-1);
              expect(load?.key).toBe(`${CODE.hash}/${after}`);
              expect(load?.tails).toHaveLength(1);
              expect(load?.tails?.map((tail) => bound.get(tail))).toEqual([
                { project: "project-test", name, process: after },
              ]);
            }

            // Rebuild with an empty policy cache over the populated, reopened Project log.
            const live = yield* p.info;
            expect(live).toHaveLength(tape.length + 1);
            yield* projectStore.reopen;
            const beforeRestore = seen.length;
            const restored = yield* Layer.build(projectLayer(projectCtx, projectEnv, projectOptions));
            expect(yield* Context.get(restored, ProjectService).info).toEqual(live);
            const restoredLoads = seen.slice(beforeRestore);
            const bootstrapLoads = restoredLoads.filter((load) => load.key.startsWith(`${CODE.hash}/project:`));
            expect(bootstrapLoads).toHaveLength(1);
            expect(bootstrapLoads[0]?.tails).toBeUndefined();
            const programLoads = restoredLoads.filter((load) => !load.key.startsWith(`${CODE.hash}/project:`));
            expect(programLoads.map((load) => load.key).sort()).toEqual(
              live.map((process) => `${CODE.hash}/${process.process}`).sort(),
            );

            for (const process of live) {
              const load = programLoads.find((load) => load.key === `${CODE.hash}/${process.process}`);
              expect(load?.tails).toHaveLength(1);
              expect(load?.tails?.map((tail) => bound.get(tail))).toEqual([
                { project: "project-test", name: process.name, process: process.process },
              ]);
            }
          }),
        );
      // Every tape exercises a successor; later moves reload the live process or replace it.
      const tape = fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }).map((moves) => [true, ...moves]);
      const property = fc.asyncProperty(tape, (moves) => Effect.runPromise(once(moves)));
      yield* Effect.promise(() => fc.assert(property, u8Runs));
    }),
  { timeout: u8Runs.numRuns * 2_000 },
);
