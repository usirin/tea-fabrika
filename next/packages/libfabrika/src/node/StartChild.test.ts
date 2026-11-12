// P42 slice 1 (ticket 770): `start_child` and `exit` on real runners, on node:sqlite (0062). This
// module owns the driver, so it acquires the folder and every database in a scope, and the scope
// gives each file and handle back (0061). `probe.open` counts the handles still open, for L13.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as StartChildTest from "../runtime/StartChildTest.ts";
import type { Sql } from "../Sql.ts";

/** A folder in a scope: the scope removes it. */
const folder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "p42r-"))),
  (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
);

/** One database file per part, each opened on first use; `reopen` closes and reopens every one. */
const databases = Effect.gen(function* () {
  const path = yield* folder;
  const held = new Map<string, { db: DatabaseSync; sql: Sql }>();
  const connect = (part: string) => {
    const db = new DatabaseSync(join(path, `${part}.db`));
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
  return { sql, reopen, probe: { open } } satisfies StartChildTest.Store;
});

StartChildTest.suite(databases);
