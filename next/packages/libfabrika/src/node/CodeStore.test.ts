// P15 slice 1, next/. Runs runtime's CodeStore laws on a real SQLite file (0062). Each walk gets a
// fresh temporary folder; each open is a new connection to the same file, closed with its scope.
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the store's reads
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, type Scope } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as CodeStoreTest from "../runtime/CodeStoreTest.ts";
import type { Sql } from "../Sql.ts";

/** One connection to a database file, closed with its scope. */
const connection = (file: string): Effect.Effect<Sql, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.map(nodeSql));

/** A fresh folder; each run of the result opens its database again. */
const database = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p15-code-" });
  return connection(path.join(folder, "code.sqlite"));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

CodeStoreTest.suite(database);
