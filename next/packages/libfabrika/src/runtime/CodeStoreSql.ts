import { Effect, Layer, Option, Schema } from "effect";
import type { Sql } from "../Sql.ts";
import { BuiltProgram } from "./Built.ts";
import { CodeStore, CodeStoreError } from "./CodeStore.ts";

const stored = <A>(step: () => A) =>
  Effect.try({ try: step, catch: (cause) => new CodeStoreError({ reason: "storage", cause }) });

export const layer = (sql: Sql): Layer.Layer<CodeStore> =>
  Layer.succeed(CodeStore, {
    put: Effect.fn("code.put")(function* (code: BuiltProgram) {
      yield* stored(() => {
        sql.exec("CREATE TABLE IF NOT EXISTS code (hash TEXT PRIMARY KEY, source TEXT NOT NULL)");
        sql.exec("INSERT OR IGNORE INTO code (hash,source) VALUES (?,?)", code.hash, code.source);
      });
    }),
    get: Effect.fn("code.get")(function* (hash: string) {
      const row = yield* stored(() => {
        sql.exec("CREATE TABLE IF NOT EXISTS code (hash TEXT PRIMARY KEY, source TEXT NOT NULL)");
        return sql.exec("SELECT hash,source FROM code WHERE hash=?", hash)[0];
      });

      if (row === undefined) {
        return Option.none();
      }

      const code = yield* Schema.decodeUnknownEffect(BuiltProgram)(row).pipe(
        Effect.mapError((cause) => new CodeStoreError({ reason: "bad_row", cause })),
      );
      return Option.some(code);
    }),
  });
