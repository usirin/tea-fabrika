// P13 slice 2, next/. Real SQLite files and ledger services for runtime's admission laws (0062).
import { DatabaseSync } from "node:sqlite"; // edge: Effect has no synchronous SQLite handle for referee transactions
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import * as RunnerAdmissionTest from "../runtime/RunnerAdmissionTest.ts";
import { BRAIN, type Harness } from "../runtime/RunnerRepliesTest.ts";

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const files = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p13-admission-" });
  return (name: string) =>
    Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(path.join(folder, `${name}.sqlite`))),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Effect.map(nodeSql));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

const services: Harness["services"] = (inbox, manager) =>
  Layer.mergeAll(
    Mailbox.layer.pipe(
      Layer.provideMerge(LedgerSql.layer(inbox, { reader: "admission-fixture" }).pipe(Layer.provide(quiet))),
    ),
    ProcessManager.layer(
      {
        by: BRAIN,
        owner: Owner.cases.brain.make({}),
        recipient: Recipient.cases.client.make({ client: "fixture", session: "process_0000000000e008000000000003" }),
      },
      Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer), Effect.orDie),
    ).pipe(Layer.provide(LedgerTransactionSql.layer(manager).pipe(Layer.provide(quiet)))),
  );

const register: RunnerAdmissionTest.Register = (name, tape, check, options, reached, required) => {
  it(
    name,
    async () => {
      await fc.assert(
        fc.asyncProperty(tape, (cells) =>
          Effect.runPromise(Effect.scoped(check(cells)).pipe(Effect.provide(TestClock.layer()))),
        ),
        options,
      );
      expect([...reached]).toEqual(expect.arrayContaining(required));
    },
    600_000,
  );
};

RunnerAdmissionTest.suite({ files, services }, register);
