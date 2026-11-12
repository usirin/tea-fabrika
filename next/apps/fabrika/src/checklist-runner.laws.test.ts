// Ticket 806, slice 1, next/: runs the checklist's runner laws (L9, L10) on real SQLite files
// (0062, plan amendment A2). A library test may not import a program, so the app runs it. Each run
// gets a fresh temporary folder; each open is a new connection to the same file, closed with its scope.
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the referee's transactions
import { NodeServices } from "@effect/platform-node";
import * as RunnerTest from "@kampus/checklist/RunnerTest";
import type { Sql } from "@kampus/libfabrika/Sql";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, FileSystem, Path, type Scope } from "effect";

/** One connection to a database file, closed with its scope. */
const connection = (file: string): Effect.Effect<Sql, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.map(nodeSql));

/** A fresh folder; each run of the result opens the named database in it again. */
const open = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "t806-checklist-" });
  return (name: string) => connection(path.join(folder, `${name}.sqlite`));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

RunnerTest.suite(open);
