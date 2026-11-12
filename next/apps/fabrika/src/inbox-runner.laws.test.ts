// Ticket 884, next/: runs the inbox program's suite on SQLite, as checklist-runner does (0062).
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous handle for ledger transactions
import { NodeServices } from "@effect/platform-node";
import type { inbox } from "@kampus/inbox";
import * as RunnerTest from "@kampus/inbox/RunnerTest";
import { Alarm, CheckedWriter, Id, ProgramLoader, ProgramRunner, Recording, WatcherManager } from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { noticeId } from "@kampus/libfabrika/coordination";
import { Doorbell } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import { LedgerTransaction } from "@kampus/libfabrika/ledger/LedgerTransaction";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { letterLine, Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { ProcessStore } from "@kampus/libfabrika/runtime/ProcessStore";
import type { Sql } from "@kampus/libfabrika/Sql";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, FileSystem, Layer, Path, type Scope, Stream } from "effect";

const NAME = "inbox:1";
const BUILD = "inbox-build";
const BRAIN = "SHA256:brain";
const person = Writer.cases.person.make({ key: "SHA256:person", for: "person" });
const agent = Writer.cases.agent.make({ key: "SHA256:agent", for: "agent" });
const recovered = Writer.cases.person.make({ key: "SHA256:recovered", for: "person" });

const brainFrom = {
  by: BRAIN,
  for: "brain",
  sentAt: "2026-11-12T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: BUILD,
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const nextProcess = Id.Generator.use((ids) => ids.next(Id.Process)).pipe(
  Effect.provide(Id.Generator.layer),
  Effect.orDie,
);

const managerLayer = (sql: Sql) =>
  ProcessManager.layer(
    {
      by: BRAIN,
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: "process_0000000000e008000000000003" }),
    },
    nextProcess,
  ).pipe(Layer.provide(LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet))));

const connection = (file: string): Effect.Effect<Sql, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.map(nodeSql));

const session = Effect.fnUntraced(function* (
  files: (name: string) => Effect.Effect<Sql, never, Scope.Scope>,
  program: typeof inbox,
  initial: typeof inbox.msg.Type,
) {
  const ledger = yield* files("ledger");
  const store = yield* files("process");
  const manager = yield* files("manager");
  const process = yield* ProcessManager.use((m) =>
    Effect.gen(function* () {
      yield* m.start(
        Start.cases.first.make({ id: `boot:${NAME}`, name: NAME, code: { program: program.name, hash: BUILD } }),
        brainFrom,
      );
      return (yield* m.status(NAME)).state.process;
    }),
  ).pipe(Effect.provide(managerLayer(manager)), Effect.orDie);
  const mail = Mailbox.layer.pipe(
    Layer.provideMerge(LedgerSql.layer(ledger, { reader: "inbox-law" }).pipe(Layer.provide(quiet))),
  );
  yield* LedgerTransaction.use((l) =>
    l.transact((turn) => turn.append(`${NAME}/inbox`, noticeId(initial.id), letterLine(brainFrom, initial))),
  ).pipe(Effect.provide(LedgerTransactionSql.layer(ledger).pipe(Layer.provide(quiet))), Effect.orDie);
  const checked = Layer.effect(
    CheckedWriter,
    Effect.gen(function* () {
      const mailbox = yield* Mailbox;
      return CheckedWriter.of({
        append: (i) =>
          mailbox.send(NAME, i.id, i.envelope.input, {
            by: i.envelope.by.key,
            for: i.envelope.by.for,
            sentAt: i.sentAt,
            seen: i.seen,
            parent: i.envelope.id,
            traceId: i.span.traceId,
            build: BUILD,
          }),
        commit: () => Effect.die("the inbox program declares no write"),
        own: () => Effect.die("the inbox program declares no write"),
      });
    }),
  );
  return ProgramRunner.layer(
    { id: process, name: NAME, program: program.name, build: BUILD, owner: person },
    { recovery: { sql: store, name: NAME, capacity: 1024 ** 3 } },
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        managerLayer(manager),
        ProgramLoader.layer({ [program.name]: program }, {}),
        ProcessStore.layer(store, { process }),
        checked,
        Layer.succeed(WatcherManager, { publish: () => Effect.void }),
        Layer.succeed(Alarm, { set: () => Effect.void }),
        Layer.succeed(Recording, { flush: Effect.void }),
      ).pipe(Layer.provideMerge(mail)),
    ),
  );
});

const open: RunnerTest.Open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "t884-inbox-" });
  const files = (name: string) => connection(path.join(folder, `${name}.sqlite`));
  return {
    start: (program: typeof inbox, initial: typeof inbox.msg.Type) =>
      Effect.flatMap(session(files, program, initial), (layer) => ProgramRunner.pipe(Effect.provide(layer))),
    person,
    agent,
    recovered,
    letters: Effect.scoped(
      Effect.flatMap(files("ledger"), (sql) =>
        Mailbox.use((m) => Stream.runCollect(m.read(NAME, 0))).pipe(
          Effect.provide(
            Mailbox.layer.pipe(Layer.provide(LedgerSql.layer(sql, { reader: "inbox-law" }).pipe(Layer.provide(quiet)))),
          ),
        ),
      ),
    ).pipe(Effect.orDie),
  };
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

RunnerTest.suite(open);
