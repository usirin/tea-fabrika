// node:sqlite is the edge: Effect has no synchronous SQLite database handle.
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import * as RateLimitTest from "../../gateway/RateLimitTest.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";

const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t843-" });
  let db: DatabaseSync = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(path.join(dir, "limits.db"))),
    () =>
      Effect.sync(() => {
        db.close();
      }),
  );
  const sql: Sql = {
    exec: (query, ...params) => nodeSql(db).exec(query, ...params),
    transaction: (step) => nodeSql(db).transaction(step),
    size: () => nodeSql(db).size(),
  };
  const reopen = Effect.sync(() => {
    db.close();
    db = new DatabaseSync(path.join(dir, "limits.db"));
  });
  return { sql, reopen };
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

RateLimitTest.suite({ open });
