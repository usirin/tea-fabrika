// T953 slice 1, next/: the relations store's suite (L8) on node:sqlite (0062). This module owns the
// driver, so it opens each store in a scope, and the scope closes it (0061). Each run opens a fresh
// store in memory, so no run sees another's rows.
// Edge: Effect has no node:sqlite driver.
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as RelationsTest from "../permissions/RelationsTest.ts";

const store = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
).pipe(Effect.map((db) => ({ sql: nodeSql(db) }) satisfies RelationsTest.Store));

RelationsTest.suite(store);
