// T878, next/, L5/L6 on real SQLite. The packs module owns the laws, this module owns the driver.
import { DatabaseSync } from "node:sqlite"; // edge: the referee needs synchronous SQLite transactions
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import * as RepositoryTrustTest from "../../packs/RepositoryTrustTest.ts";
import type { Sql } from "../../Sql.ts";

const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t878-trust-" });
  const file = path.join(root, "ledger.db");
  const held = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const db = new DatabaseSync(file);
      return { db, sql: nodeSql(db) };
    }),
    (handle) =>
      Effect.sync(() => {
        if (handle.db.isOpen) {
          handle.db.close();
        }
      }),
  );
  const sql: Sql = {
    exec: (query, ...params) => held.sql.exec(query, ...params),
    transaction: (step) => held.sql.transaction(step),
    size: () => held.sql.size(),
  };
  const reopen = Effect.sync(() => {
    held.db.close();
    held.db = new DatabaseSync(file);
    held.sql = nodeSql(held.db);
  });
  return { sql, reopen } satisfies RepositoryTrustTest.Store;
}).pipe(Effect.orDie, Effect.provide(NodeServices.layer));

RepositoryTrustTest.suite(open);
