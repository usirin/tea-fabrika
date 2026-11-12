// P17b slice 1, next/. Runtime's suite on real SQLite; every connection and folder is scoped.
import { DatabaseSync } from "node:sqlite"; // edge: Effect has no synchronous SQLite handle for the referee's transactions
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { Doorbell, Ledger, LedgerError } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { lineFor, PAGE } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { inbox } from "../processes/Mailbox.ts";
import * as NemesisTest from "../runtime/NemesisTest.ts";

const database: NemesisTest.Database = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p17b-history-" });
  const file = path.join(folder, "history.sqlite");
  return Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.map(nodeSql));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

NemesisTest.suite({
  database,
  ledger: Ledger,
  ledgerLayer: (sql) =>
    LedgerSql.layer(sql, { reader: "process_0000000000e008000000000000" }).pipe(
      Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
    ),
  lineFor,
  page: PAGE,
  error: (reason, cause) => new LedgerError({ reason, cause }),
  damage: (sql, key, kind) => {
    if (kind === "json" || kind === "body") {
      sql.exec(
        "UPDATE entries SET body=? WHERE stream=? AND id=?",
        kind === "json" ? "{" : JSON.stringify({ missing: true }),
        inbox("checklist:1"),
        key,
      );
    } else {
      sql.exec(
        "UPDATE entries SET pos=? WHERE stream=? AND id=?",
        kind === "zero" ? 0 : kind === "negative" ? -1 : 1.5,
        inbox("checklist:1"),
        key,
      );
    }
  },
});
