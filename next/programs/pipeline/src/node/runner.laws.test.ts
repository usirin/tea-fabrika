// edge: Effect has no node:sqlite driver for the Sql contract
import { DatabaseSync } from "node:sqlite";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import type { Sql } from "@kampus/libfabrika/Sql";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, Exit, FileSystem, Layer, Path, Scope } from "effect";
import * as RunnerTest from "../RunnerTest.ts";

RunnerTest.suite(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folder = yield* fs.makeTempDirectoryScoped({ prefix: "merger-laws-" });
    const parent = yield* Scope.Scope;
    let scope = yield* Scope.fork(parent, "sequential");
    const opened = new Map<string, Sql>();
    const connect = Effect.fnUntraced(function* (part: string) {
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(path.join(folder, `${part}.db`))),
        (handle) => Effect.sync(() => handle.close()),
      ).pipe(Scope.provide(scope));
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
      opened.set(part, nodeSql(db));
    });
    const parts = ["ledger", "process", "recovery", "alarms"];
    yield* Effect.forEach(parts, connect, { discard: true, concurrency: 1 });
    const sqls = new Map<string, Sql>();
    const sql = (part: string): Sql => {
      const known = sqls.get(part);

      if (known !== undefined) {
        return known;
      }

      const handle = () => {
        const current = opened.get(part);

        if (current === undefined) {
          // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- edge: Sql is synchronous; an unknown harness part is a programming defect
          throw new Error(`unknown database part: ${part}`);
        }

        return current;
      };
      const adapter: Sql = {
        exec: (query, ...params) => handle().exec(query, ...params),
        transaction: (f) => handle().transaction(f),
        size: () => handle().size(),
      };
      sqls.set(part, adapter);
      return adapter;
    };
    const table = () => {
      const db = sql("alarms");
      db.exec("CREATE TABLE IF NOT EXISTS alarms (name TEXT PRIMARY KEY, at INTEGER NOT NULL)");
      return db;
    };
    return {
      sql,
      reopen: Effect.gen(function* () {
        yield* Scope.close(scope, Exit.void);
        scope = yield* Scope.fork(parent, "sequential");
        yield* Effect.forEach(parts, connect, { discard: true, concurrency: 1 });
      }),
      alarms: {
        set: (name, at) =>
          Effect.sync(() => {
            if (at === null) {
              table().exec("DELETE FROM alarms WHERE name = ?", name);
            } else {
              table().exec("INSERT OR REPLACE INTO alarms (name, at) VALUES (?, ?)", name, at);
            }
          }),
        saved: Effect.sync(() =>
          table()
            .exec("SELECT name, at FROM alarms ORDER BY at, name")
            .map((row) => ({ name: String(row.name), at: Number(row.at) })),
        ),
        take: (alarm) =>
          Effect.sync(() => {
            table().exec("DELETE FROM alarms WHERE name = ? AND at = ?", alarm.name, alarm.at);
          }),
      },
    } satisfies RunnerTest.Store;
  }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)), Effect.orDie),
);
