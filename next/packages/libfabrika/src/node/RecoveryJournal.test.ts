// P34c slice 2: the runtime module's recovery journal laws on node:sqlite (0062). This module owns the
// driver, so it acquires each store in a scope and the scope gives the file back (0061). It also owns
// the ledger wiring the laws run over, and reads committed entries back for them.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect, Layer, Schema } from "effect";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { Row } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import * as RecoveryJournalTest from "../runtime/RecoveryJournalTest.ts";
import type { Sql } from "../Sql.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p34c2-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const path = join(folder, "store.db");
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
  return { sql, reopen } satisfies RecoveryJournalTest.Store;
});

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const coordination = (sql: Sql, next: Effect.Effect<string>) =>
  ProcessManager.layer(
    {
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "window-a", session: "process_0000000000e008000000000003" }),
      by: "SHA256:brain",
    },
    next,
  ).pipe(
    Layer.provideMerge(
      Mailbox.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(LedgerSql.layer(sql, { reader: "connection:test" }), LedgerTransactionSql.layer(sql)).pipe(
            Layer.provide(quiet),
          ),
        ),
      ),
    ),
  );

const decodeRow = Schema.decodeUnknownSync(Row);

const rows = (sql: Sql): ReadonlyArray<RecoveryJournalTest.Row> =>
  sql.exec("SELECT name FROM sqlite_master WHERE name='entries'").length === 0
    ? []
    : sql.exec("SELECT * FROM entries ORDER BY rev").map((raw) => {
        const row = decodeRow(raw);
        return { stream: row.stream, id: row.id, event: row._tag, body: row.body };
      });

RecoveryJournalTest.suite({ open, coordination, rows });
