// P34c slice 1: the processes module's exit reason laws on node:sqlite (0062). This module owns the
// driver, so it acquires each store in a scope and the scope gives the file back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as ExitReasonTest from "../processes/ExitReasonTest.ts";
import type { Sql } from "../Sql.ts";

const database = (path: string) => {
  const db = new DatabaseSync(path);
  // A test process never loses power, so it skips the sync and keeps the rollback journal in memory,
  // as Process.test-support does. Every byte a law reads stays in the file and survives reopen.
  db.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF");
  return db;
};

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p34c-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const path = join(folder, "ledger.db");
  const handle = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const db = database(path);
      return { db, sql: nodeSql(db) };
    }),
    (held) => Effect.sync(() => held.db.isOpen && held.db.close()),
  );
  // One Sql across reopens: each call goes to the database open now.
  const sql: Sql = {
    exec: (query, ...params) => handle.sql.exec(query, ...params),
    transaction: (step) => handle.sql.transaction(step),
    size: () => handle.sql.size(),
  };
  const reopen = Effect.sync(() => {
    handle.db.close();
    handle.db = database(path);
    handle.sql = nodeSql(handle.db);
  });
  return { sql, reopen } satisfies ExitReasonTest.Store;
});

ExitReasonTest.suite(open);
