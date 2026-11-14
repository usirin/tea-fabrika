// Ticket 921 slice 1, next/. Runs access's session laws on real node:sqlite files (0062). This
// module owns the driver, so it acquires each database in a scope, and the scope closes the
// connection and gives the folder back (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import * as SessionManagerTest from "../../access/SessionManagerTest.ts";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import type { Sql } from "../../Sql.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p10-session-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const path = join(folder, "session.db");
  const handle = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const db = new DatabaseSync(path);
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
    handle.db = new DatabaseSync(path);
    handle.sql = nodeSql(handle.db);
  });
  return { sql, reopen } satisfies SessionManagerTest.Store;
});

SessionManagerTest.suite(open);
