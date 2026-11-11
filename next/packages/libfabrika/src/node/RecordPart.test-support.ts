// T641 slice 1: the stores `RecordPartTest.suite` runs on, over node:sqlite (0061, 0062). This module
// owns the driver, so the raw handle stays here: the suite sees only `Sql`, and each handle and
// folder is acquired in a scope that gives it back.
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the referee's transactions
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import type * as RecordPartTest from "../telemetry/RecordPartTest.ts";

/** What the support did, in order, for its lifecycle laws. A watch that throws fails that step. */
export type Event =
  | { readonly step: "folder"; readonly path: string }
  | { readonly step: "opening"; readonly file: string }
  | { readonly step: "opened"; readonly file: string; readonly db: DatabaseSync }
  | { readonly step: "closed"; readonly file: string; readonly db: DatabaseSync };

export type Watch = (event: Event) => void;

const handle = (file: string, watch: Watch) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      watch({ step: "opening", file });
      const db = new DatabaseSync(file);
      watch({ step: "opened", file, db });
      return db;
    }),
    (db) =>
      Effect.sync(() => {
        db.close();
        watch({ step: "closed", file, db });
      }),
  );

const store = (file: string, watch: Watch): RecordPartTest.Store => ({
  use: (body) => Effect.scoped(Effect.flatMap(handle(file, watch), (db) => body(nodeSql(db)))),
});

/** An `open` that reports each step to `watch`. */
export const make =
  (watch: Watch): RecordPartTest.Open =>
  (mode) =>
    mode === "memory"
      ? Effect.succeed(store(":memory:", watch))
      : Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const folder = yield* fs.makeTempDirectoryScoped({ prefix: "t641-" });
          watch({ step: "folder", path: folder });
          return store(path.join(folder, "part.sqlite"), watch);
        }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

export const open: RecordPartTest.Open = make(() => {});
