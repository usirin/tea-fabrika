// Ticket 806, slice 1, next/: runs the checklist's runner laws (L9, L10) on real SQLite files
// (0062, plan amendment A2). A library test may not import a program, and a program may not import
// the library's inner pieces, so the app owns the runner's wiring and runs the suite. Each run
// gets a fresh temporary folder; each open is a new connection to the same file, closed with its scope,
// and each restart loads the program module again. Ticket 839: `letters` reads the inbox back on a
// connection of its own, so L16 and L17 can count rows and read a saved note and writer.
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the referee's transactions
import { NodeServices } from "@effect/platform-node";
import type { checklist } from "@kampus/checklist";
import * as RunnerTest from "@kampus/checklist/RunnerTest";
import { Alarm, CheckedWriter, Id, ProgramLoader, ProgramRunner, Recording, WatcherManager } from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { Doorbell } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import * as LedgerTransactionSql from "@kampus/libfabrika/ledger/LedgerTransactionSql";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { ProcessStore } from "@kampus/libfabrika/runtime/ProcessStore";
import type { Sql } from "@kampus/libfabrika/Sql";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, FileSystem, Layer, Path, type Scope, Stream } from "effect";

const NAME = "checklist:1";
const BUILD = "checklist-build";
const BRAIN = "SHA256:brain";
const TRACE = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" };

const person = Writer.cases.person.make({ key: "SHA256:person", for: "person" });
const agent = Writer.cases.agent.make({ key: "SHA256:agent", for: "agent" });

const brainFrom = {
  by: BRAIN,
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE.traceId,
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

/** One session of the runner over the folder's three files. `alarms` keeps every time it sets. */
const session = (
  files: (name: string) => Effect.Effect<Sql, never, Scope.Scope>,
  alarms: Array<number | null>,
  program: typeof checklist,
) =>
  Effect.gen(function* () {
    const ledger = yield* files("ledger");
    const store = yield* files("process");
    const manager = yield* files("manager");
    const started = Layer.effectDiscard(
      ProcessManager.use((m) =>
        m.status(NAME).pipe(
          Effect.catch(() =>
            m.start(
              Start.cases.first.make({
                id: `boot:${NAME}`,
                name: NAME,
                code: { program: program.name, hash: BUILD },
              }),
              brainFrom,
            ),
          ),
        ),
      ).pipe(Effect.orDie),
    ).pipe(Layer.provideMerge(managerLayer(manager)));
    const process = yield* ProcessManager.use((m) => m.status(NAME)).pipe(
      Effect.map((s) => s.state.process),
      Effect.provide(started),
      Effect.orDie,
    );
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
          commit: () => Effect.die("the checklist declares no write"),
          own: () => Effect.die("the checklist declares no write"),
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
          Layer.succeed(Alarm, { set: (at: number | null) => Effect.sync(() => void alarms.push(at)) }),
          Layer.succeed(Recording, { flush: Effect.void }),
        ).pipe(
          Layer.provideMerge(
            Mailbox.layer.pipe(
              Layer.provideMerge(LedgerSql.layer(ledger, { reader: "checklist-law" }).pipe(Layer.provide(quiet))),
            ),
          ),
        ),
      ),
    );
  });

/** One connection to a database file, closed with its scope. */
const connection = (file: string): Effect.Effect<Sql, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.map(nodeSql));

/** A fresh folder; each start opens its three databases again and runs one session over them. */
const open: RunnerTest.Open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "t806-checklist-" });
  const files = (name: string) => connection(path.join(folder, `${name}.sqlite`));
  return {
    start: (program: typeof checklist, alarms: Array<number | null>) =>
      Effect.flatMap(session(files, alarms, program), (layer) => ProgramRunner.pipe(Effect.provide(layer))),
    person,
    agent,
    key: (writer: unknown) => (writer === agent ? agent.key : person.key),
    letters: Effect.scoped(
      Effect.flatMap(files("ledger"), (sql) =>
        Mailbox.use((m) => Stream.runCollect(m.read(NAME, 0))).pipe(
          Effect.provide(
            Mailbox.layer.pipe(
              Layer.provide(LedgerSql.layer(sql, { reader: "checklist-law" }).pipe(Layer.provide(quiet))),
            ),
          ),
          Effect.map((all) => Array.from(all, ({ id, m, by, sentAt }) => ({ id, m, by, sentAt }))),
        ),
      ),
    ).pipe(Effect.orDie),
  };
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

let restarts = 0;

/** The program loaded again from its module, under a new name each time, as a restarted process
 *  loads it: whatever its module kept in memory is gone. */
const fresh = Effect.promise(
  () =>
    import(/* @vite-ignore */ `${import.meta.resolve("@kampus/checklist")}?restart=${++restarts}`) as Promise<
      typeof import("@kampus/checklist")
    >,
).pipe(Effect.map((m) => m.checklist));

RunnerTest.suite(open, fresh);
