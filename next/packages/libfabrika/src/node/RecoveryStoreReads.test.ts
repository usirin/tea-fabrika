// T936 slice 2, next/: L5 and L6 on node:sqlite files (0062). This module owns the driver, so it
// acquires each database in a scope, and the scope closes the file and removes its folder (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as RecoveryStoreReadsTest from "../runtime/RecoveryStoreReadsTest.ts";

const open = Effect.gen(function* () {
  const folder = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "t936-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const opened = new DatabaseSync(join(folder, "store.db"));
      // A test process never loses power, so it skips the sync (ticket 585, decision 0052).
      opened.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF");
      return opened;
    }),
    (opened) => Effect.sync(() => opened.isOpen && opened.close()),
  );
  return nodeSql(db);
});

RecoveryStoreReadsTest.suite(open);
