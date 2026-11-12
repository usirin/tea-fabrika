import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Sql } from "@kampus/libfabrika/Sql";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect } from "effect";
import * as RunnerTest from "../RunnerTest.ts";

const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "merger-laws-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

RunnerTest.suite(
  Effect.gen(function* () {
    const path = yield* folder;
    const opened = new Map<string, DatabaseSync>();
    const sqls = new Map<string, Sql>();
    const connect = (part: string) => {
      const db = new DatabaseSync(join(path, `${part}.db`));
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
      opened.set(part, db);
      return db;
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const db of opened.values()) {
          if (db.isOpen) {
            db.close();
          }
        }
      }),
    );
    const sql = (part: string): Sql => {
      const known = sqls.get(part);

      if (known !== undefined) {
        return known;
      }

      const handle = () => nodeSql(opened.get(part) ?? connect(part));
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
      reopen: Effect.sync(() => {
        for (const [part, db] of opened) {
          db.close();
          connect(part);
        }
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
  }),
);
