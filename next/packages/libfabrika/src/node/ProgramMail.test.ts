// P41 slice 1 (ticket 744): program mail's two shared suites on node:sqlite (0062). This module owns
// the driver, so it acquires every store and the alarm driver in a scope, and the scope gives each
// file and handle back (0061). The alarm driver saves an alarm in its own real database before it
// answers, so a reopen keeps it, as the platform keeps an object's alarm.
// Edge: Effect has no node:sqlite driver.
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as ProcessesProgramMailTest from "../processes/ProgramMailTest.ts";
import * as RuntimeProgramMailTest from "../runtime/ProgramMailTest.ts";
import type { Sql } from "../Sql.ts";

/** A folder in a scope: the scope removes it. */
const folder = FileSystem.FileSystem.use((fs) => fs.makeTempDirectoryScoped({ prefix: "p41-" })).pipe(
  Effect.provide(NodeServices.layer),
  Effect.orDie,
);

/** One database file per part, each opened on first use; `reopen` closes and reopens every one. */
const databases = Effect.gen(function* () {
  const path = yield* folder;
  const paths = yield* Path.Path.pipe(Effect.provide(NodeServices.layer));
  const held = new Map<string, { db: DatabaseSync; sql: Sql }>();
  const connect = (part: string) => {
    const db = new DatabaseSync(paths.join(path, `${part}.db`));
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF");
    return { db, sql: nodeSql(db) };
  };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const { db } of held.values()) {
        if (db.isOpen) {
          db.close();
        }
      }
    }),
  );
  const handle = (part: string) => {
    const found = held.get(part);

    if (found !== undefined) {
      return found;
    }

    const made = connect(part);
    held.set(part, made);
    return made;
  };
  // One Sql per part across reopens: each call goes to the database open now.
  const sqls = new Map<string, Sql>();
  const sql = (part: string): Sql => {
    const known = sqls.get(part);

    if (known !== undefined) {
      return known;
    }

    const made: Sql = {
      exec: (query, ...params) => handle(part).sql.exec(query, ...params),
      transaction: (step) => handle(part).sql.transaction(step),
      size: () => handle(part).sql.size(),
    };
    sqls.set(part, made);
    return made;
  };
  const reopen = Effect.sync(() => {
    for (const [part, { db }] of held) {
      db.close();
      held.set(part, connect(part));
    }
  });
  const open = () => [...held.values()].filter(({ db }) => db.isOpen).length;
  return { sql, reopen, open };
});

ProcessesProgramMailTest.suite(
  Effect.map(databases, ({ sql, reopen }) => ({ sql: sql("ledger"), reopen }) satisfies ProcessesProgramMailTest.Store),
);

RuntimeProgramMailTest.suite(
  Effect.gen(function* () {
    const { sql, reopen, open } = yield* databases;
    const state = { released: false, late: 0 };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        state.released = true;
      }),
    );
    const table = () => {
      const db = sql("alarms");
      db.exec(
        "CREATE TABLE IF NOT EXISTS alarms (name TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (name, kind))",
      );
      return db;
    };
    /** Anything that reaches the driver after its scope released it is a task that outlived it. */
    const guard = <A>(f: () => A, empty: A) =>
      Effect.sync(() => {
        if (state.released) {
          state.late++;
          return empty;
        }

        return f();
      });
    const alarms: RuntimeProgramMailTest.Alarms = {
      set: (name, kind, at) =>
        guard(() => {
          if (at === null) {
            table().exec("DELETE FROM alarms WHERE name = ? AND kind = ?", name, kind);
          } else {
            table().exec("INSERT OR REPLACE INTO alarms (name, kind, at) VALUES (?, ?, ?)", name, kind, at);
          }
        }, undefined),
      saved: guard(
        () =>
          table()
            .exec("SELECT name, kind, at FROM alarms ORDER BY at, name, kind")
            .map((row) => ({
              name: String(row.name),
              kind: row.kind === "mail" ? ("mail" as const) : ("alarm" as const),
              at: Number(row.at),
            })),
        [],
      ),
      take: (alarm) =>
        guard(() => {
          table().exec("DELETE FROM alarms WHERE name = ? AND kind = ? AND at = ?", alarm.name, alarm.kind, alarm.at);
        }, undefined),
    };
    return {
      sql,
      reopen,
      alarms,
      probe: { open, late: () => state.late },
    } satisfies RuntimeProgramMailTest.Store;
  }),
);
