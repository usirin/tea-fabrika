// P17b slice 2, next/. Real runner storage. Each session opens new scoped connections.
import { DatabaseSync } from "node:sqlite"; // edge: Effect has no synchronous SQLite transaction handle
import { applyCell } from "@demlik/tea";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Path, Ref, Schema, type Scope, Stream, Tracer } from "effect";
import { Writer } from "../access/SessionManager.ts";
import * as Id from "../Id.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { Row } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import * as ProcessHistoryLedger from "../processes/ProcessHistoryLedger.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import {
  Alarm,
  CheckedWriter,
  type Handler,
  ProgramLoader,
  Recording,
  type Update,
  WatcherManager,
} from "../runtime/Entry.ts";
import { Nemesis } from "../runtime/Nemesis.ts";
import * as NemesisLedger from "../runtime/NemesisLedger.ts";
import { ProcessStore } from "../runtime/ProcessStore.ts";
import { ProgramRunner } from "../runtime/Runner.ts";
import { StepFault } from "../runtime/StepFault.ts";
import * as StepFaultNone from "../runtime/StepFaultNone.ts";
import type { Sql } from "../Sql.ts";
import { Archive } from "../telemetry/Archive.ts";
import { RecordManager } from "../telemetry/Records.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { Chain } from "../telemetry/Trace.ts";
import * as StepFaultTest from "./stepFault.test-support.ts";

const brain = "SHA256:test-brain";
const trace = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };
const build = "chaos-law";
const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

export const person = Writer.cases.person.make({ key: "SHA256:test-person", for: "test-person" });
export const agent = Writer.cases.agent.make({ key: "SHA256:test-agent", for: "test-agent" });

export const letter = (n: number, input: unknown, by: Writer = person) => ({
  id: `chaos-input-${n}`,
  envelope: {
    id: Schema.decodeUnknownSync(Id.Input)(`input_0000000000e008${n.toString(16).padStart(12, "0")}`),
    by,
    arrivedAt: n,
    input,
  },
  sentAt: "2026-11-12T00:00:00.000Z",
  seen: 0,
  span: trace,
});

const from = {
  by: brain,
  for: "test-person",
  sentAt: "2026-11-12T00:00:00.000Z",
  seen: 0,
  parent: null,
  traceId: trace.traceId,
  build,
};

const connection = (file: string): Effect.Effect<Sql, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const db = new DatabaseSync(file);
      // A test process never loses power, so it skips the sync and keeps the rollback journal in memory,
      // as Process.test-support does. Every byte a law reads stays in the file and survives reopen.
      db.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF");
      return db;
    }),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.map(nodeSql));

const ledgerLayer = (sql: Sql) => LedgerSql.layer(sql, { reader: "chaos-laws" }).pipe(Layer.provide(quiet));

const managerLayer = (sql: Sql) =>
  ProcessManager.layer(
    {
      by: brain,
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: "process_0000000000e008000000000003" }),
    },
    Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer), Effect.orDie),
  ).pipe(Layer.provide(LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet))));

const errors = { TypeError, RangeError, URIError };

const faultControl = Effect.fnUntraced(function* () {
  const state = yield* Ref.make(StepFaultTest.controller.init(null, {})[0]);
  const send = (msg: typeof StepFaultTest.Msg.Type) =>
    Ref.modify(state, (previous) => {
      const [next] = applyCell(StepFaultTest.controller, previous, msg);
      return [[previous, next] as const, next];
    });
  return {
    arm: (name: string, letter: string, classes: ReadonlyArray<typeof StepFaultTest.ErrorClass.Type>) =>
      send({ type: "arm", name, letter, errors: classes }).pipe(Effect.asVoid),
    before: Effect.fnUntraced(function* (input: typeof StepFaultTest.Before.Type) {
      const [previous, next] = yield* send({ type: "before", ...input });

      if (previous._tag === "armed" && next._tag === "armed" && next.attempts.length > previous.attempts.length) {
        const attempt = next.attempts.at(-1);

        if (attempt !== undefined) {
          return yield* Effect.die(new errors[attempt.error]("controlled private step failure"));
        }
      }
    }),
    saved: Ref.get(state),
  };
});

/** A fresh folder of real databases. Closing a session closes all its connections before reopen. */
export const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p17b-runner-" });
  const files = (name: string) => connection(path.join(folder, `${name}.sqlite`));
  const fault = yield* faultControl();

  const session = Effect.fnUntraced(function* (
    name: string,
    programName: string,
    program: unknown,
    handlers: Readonly<Record<string, Handler<never>>>,
    observe: (update: Update) => Effect.Effect<void> = () => Effect.void,
    before?: (input: typeof StepFaultTest.Before.Type) => Effect.Effect<void>,
  ) {
    const ledger = yield* files("ledger");
    const store = yield* files(`store-${name}`);
    const manager = yield* files("manager");
    const processes = yield* ProcessManager.pipe(Effect.provide(managerLayer(manager)));
    yield* processes
      .status(name)
      .pipe(
        Effect.catch(() =>
          processes.start(
            Start.cases.first.make({ id: `boot:${name}`, name, code: { program: programName, hash: build } }),
            from,
          ),
        ),
      );
    const status = yield* processes.status(name);
    const process = status.state.process;
    const spans = yield* files(`spans-${name}`);
    const records = yield* files(`records-${name}`);
    const telemetry = yield* Layer.build(SpanSink.layer(spans, { object: name }));
    const sink = Context.get(telemetry, SpanSink);
    const tracer = Context.get(telemetry, Tracer.Tracer);
    const recordLayer = RecordManager.sql(() => records, 1024 ** 3);
    const flush = sink.flush.pipe(Effect.provide(Layer.merge(recordLayer, Archive.memory)));
    const alarms: Array<number | null> = [];
    const watches: Array<Update> = [];
    const checked = Layer.effect(
      CheckedWriter,
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        return CheckedWriter.of({
          append: (i) =>
            mailbox.send(name, i.id, i.envelope.input, {
              by: i.envelope.by.key,
              for: i.envelope.by.for,
              sentAt: i.sentAt,
              seen: i.seen,
              parent: i.envelope.id,
              traceId: i.span.traceId,
              build,
            }),
          commit: () => Effect.die("these programs declare no writes"),
          own: () => Effect.die("these programs declare no writes"),
        });
      }),
    );
    const services = Layer.mergeAll(
      Layer.succeed(ProcessManager, processes),
      ProgramLoader.layer({ [programName]: program }, handlers),
      ProcessStore.layer(store, { process }),
      checked,
      Layer.succeed(WatcherManager, {
        publish: (_client, update) =>
          Effect.gen(function* () {
            watches.push(update);
            yield* observe(update);
          }),
      }),
      Layer.succeed(Alarm, { set: (at) => Effect.sync(() => void alarms.push(at)) }),
      Layer.succeed(Recording, { flush }),
      before === undefined ? StepFaultNone.layer : Layer.succeed(StepFault, { before }),
    ).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(ledgerLayer(ledger)))));
    const context = yield* Layer.build(
      ProgramRunner.layer(
        { id: process, name, program: programName, build, owner: person },
        { recovery: { sql: store, name, capacity: 1024 ** 3 } },
      ).pipe(Layer.provide(services)),
    );
    const live = Context.get(context, ProgramRunner);
    const runner = ProgramRunner.of({
      init: () => live.init().pipe(Effect.withTracer(tracer)),
      open: (client) => live.open(client).pipe(Effect.withTracer(tracer)),
      msg: (input) => live.msg(input).pipe(Effect.withTracer(tracer)),
      due: (at) => live.due(at).pipe(Effect.withTracer(tracer)),
      restart: (request) => live.restart(request).pipe(Effect.withTracer(tracer)),
      swap: (request) => live.swap(request).pipe(Effect.withTracer(tracer)),
      mailed: live.mailed.pipe(Effect.withTracer(tracer)),
    });
    const recorded = Effect.gen(function* () {
      yield* flush;
      const rows = yield* RecordManager.use((manager) =>
        Stream.runCollect(manager.read(Chain.cases.job.make({ process }))),
      ).pipe(Effect.provide(recordLayer));
      const health = spans.exec("SELECT * FROM measurements");
      return { rows, health };
    }).pipe(Effect.orDie);
    return { runner, process, alarms, watches, recorded };
  }, Effect.orDie);

  const snapshot = (name: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* files(`store-${name}`);
        const ledger = yield* files("ledger");
        const manager = yield* files("manager");
        const status = yield* ProcessManager.use((processes) => processes.status(name)).pipe(
          Effect.provide(managerLayer(manager)),
          Effect.orDie,
        );
        const checkpoint = yield* ProcessStore.use((store) => store.load).pipe(
          Effect.provide(ProcessStore.layer(sql, { process: status.state.process })),
          Effect.provide(ledgerLayer(ledger)),
          Effect.orDie,
        );

        if (checkpoint === null) {
          return yield* Effect.die(new Error("runner has no saved checkpoint"));
        }

        return { model: checkpoint.saved.model, after: checkpoint.saved.after, cmds: checkpoint.cmds };
      }),
    );

  const letters = (name: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* files("ledger");
        return yield* Mailbox.use((mailbox) => Stream.runCollect(mailbox.read(name, 0))).pipe(
          Effect.provide(Mailbox.layer.pipe(Layer.provide(ledgerLayer(sql)))),
          Effect.map((rows) => Array.from(rows)),
          Effect.orDie,
        );
      }),
    );

  const check = Effect.fnUntraced(function* (target: Parameters<Nemesis["Service"]["check"]>[0]) {
    const sql = yield* files("ledger");
    return yield* Nemesis.use((nemesis) => nemesis.check(target)).pipe(
      Effect.provide(
        NemesisLedger.layer(() => Effect.die("check never fires")).pipe(
          Layer.provide(ProcessHistoryLedger.layer),
          Layer.provide(ledgerLayer(sql)),
        ),
      ),
    );
  }, Effect.scoped);

  const history = (name: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* files("manager");
        return sql
          .exec("SELECT * FROM entries WHERE stream=? ORDER BY rev", `processes/${name}`)
          .map((row) => Schema.decodeUnknownSync(Row)(row));
      }),
    );
  const dead = Effect.scoped(
    Effect.gen(function* () {
      const sql = yield* files("manager");
      return sql
        .exec("SELECT * FROM entries WHERE _tag='dead' ORDER BY rev")
        .map((row) => Schema.decodeUnknownSync(Row)(row));
    }),
  );

  return { session, snapshot, letters, check, person, agent, letter, fault, history, dead };
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);
