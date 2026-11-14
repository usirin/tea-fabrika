/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
// T641 slice 1: the stores `RecordPartTest.suite` runs on, over node:sqlite (0061, 0062). This module
// owns the driver, so the raw handle stays here: the suite sees only `Sql`, and each handle and
// folder is acquired in a scope that gives it back.
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the referee's transactions
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import type * as RecordPartTest from "../telemetry/RecordPartTest.ts";

/** What the support did, in order, for its lifecycle laws. A watch that throws fails that step. */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export type Event =
  | { readonly step: "folder"; readonly path: string }
  | { readonly step: "opening"; readonly file: string }
  | { readonly step: "opened"; readonly file: string; readonly db: DatabaseSync }
  | { readonly step: "closed"; readonly file: string; readonly db: DatabaseSync };

export type Watch = (event: Event) => void;

const handle = (file: string, watch: Watch) =>
  Effect.acquireRelease(
    Effect.sync(() => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
