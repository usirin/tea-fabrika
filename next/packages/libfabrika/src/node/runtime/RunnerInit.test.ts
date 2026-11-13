// Ticket 762 A-Merge, next/. Run runtime's init laws on scoped SQLite files (0062, 0061).
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the referee's transactions
import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, type Scope } from "effect";
import { nodeSql } from "../../ledger/NodeSqlite.ts";
import * as RunnerInitTest from "../../runtime/RunnerInitTest.ts";
import type { Sql, SqlValue } from "../../Sql.ts";

type Handle = { db: DatabaseSync; sql: Sql };

/** One Sql across reopens; the scope closes whichever handle is open. */
const database = (path: string): Effect.Effect<RunnerInitTest.Database, never, Scope.Scope> =>
  Effect.gen(function* () {
    const open = (): Handle => {
      const db = new DatabaseSync(path);
      db.exec("PRAGMA journal_mode=MEMORY; PRAGMA synchronous=OFF");
      return { db, sql: nodeSql(db) };
    };
    const held = yield* Effect.acquireRelease(Effect.sync(open), (handle: Handle) =>
      Effect.sync(() => handle.db.isOpen && handle.db.close()),
    );
    return {
      sql: {
        exec: (query: string, ...params: ReadonlyArray<SqlValue>) => held.sql.exec(query, ...params),
        transaction: <A>(step: () => A): A => held.sql.transaction(step),
        size: () => held.sql.size(),
      },
      reopen: () => {
        held.db.close();
        Object.assign(held, open());
      },
    };
  });

const files = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "t762-init-" });
  return (name: string) => database(path.join(folder, `${name}.db`));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

RunnerInitTest.suite(files);
