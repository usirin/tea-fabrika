// P42 slice 1 (ticket 770): the start piece's suite on node:sqlite (0062). This module owns the
// driver, so it acquires the store's folder and handle in a scope, and the scope gives both back
// (0061). `probe.open` counts the handles still open, for L13.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as ChildrenTest from "../processes/ChildrenTest.ts";
import type { Sql } from "../Sql.ts";

/** A folder in a scope: the scope removes it. */
const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "p42-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

/** One database file, opened in the scope; `reopen` closes it and opens the same file again. */
const store = Effect.gen(function* () {
  const path = yield* folder;
  const handles: Array<DatabaseSync> = [];
  const connect = () => {
    const db = new DatabaseSync(join(path, "ledger.db"));
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
