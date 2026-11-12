// P42 slice 1 (ticket 770): the start piece's suite on node:sqlite (0062). This module owns the
// driver, so it acquires the store's folder and handle in a scope, and the scope gives both back
// (0061). `probe.open` counts the handles still open, for L13.
// Edge: Effect has no node:sqlite driver.
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as ChildrenTest from "../processes/ChildrenTest.ts";
import type { Sql } from "../Sql.ts";

/** A folder in a scope: the scope removes it. */
const folder = FileSystem.FileSystem.use((fs) => fs.makeTempDirectoryScoped({ prefix: "p42-" })).pipe(
  Effect.provide(NodeServices.layer),
  Effect.orDie,
);

/** One database file, opened in the scope; `reopen` closes it and opens the same file again. */
const store = Effect.gen(function* () {
  const path = yield* folder;
  const paths = yield* Path.Path.pipe(Effect.provide(NodeServices.layer));
  const handles: Array<DatabaseSync> = [];
  const connect = () => {
    const db = new DatabaseSync(paths.join(path, "ledger.db"));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
    handles.push(db);
    return { db, sql: nodeSql(db) };
  };
  let current = yield* Effect.acquireRelease(Effect.sync(connect), () =>
    Effect.sync(() => {
      for (const db of handles) {
        if (db.isOpen) {
          db.close();
        }
      }
    }),
  );
  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => current.sql.exec(query, ...params),
    transaction: (step) => current.sql.transaction(step),
    size: () => current.sql.size(),
  };
  const reopen = Effect.sync(() => {
    current.db.close();
    current = connect();
  });
  const open = () => handles.filter((db) => db.isOpen).length;
  return { sql, reopen, probe: { open } } satisfies ChildrenTest.Store;
});

ChildrenTest.suite(store);
