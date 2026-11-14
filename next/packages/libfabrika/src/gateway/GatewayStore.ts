/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * The gateway's tables in the project's Sql. Only checked connection state and input metadata
 * belong here. Input bodies stay out.
 *
 * @stability unstable
 */
import { Effect, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { type Sql } from "../Sql.ts";

/**
 * Creates the gateway's store over a Sql: `atomic`, `get`, `set` and the Sql itself.
 *
 * **Details**
 *
 * `atomic` runs one synchronous step in a transaction, creating the tables first, and fails with
 * a storage error if the step throws. `get` and `set` read and write a named state value through a
 * schema. `get` answers null when the name is absent and throws a bad-row error when the saved text
 * does not decode, so call it inside `atomic`.
 *
 * @stability unstable
 * @category constructors
 */
export const gatewayStore = (sql: Sql) => {
  const ensure = () => {
    sql.exec("CREATE TABLE IF NOT EXISTS gateway_state (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS gateway_starts (id TEXT PRIMARY KEY)");
    sql.exec("CREATE TABLE IF NOT EXISTS gateway_pending (client TEXT PRIMARY KEY, until REAL NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS gateway_spent (nonce TEXT PRIMARY KEY, until REAL NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS gateway_spent_until ON gateway_spent (until)");
    sql.exec(
      "CREATE TABLE IF NOT EXISTS gateway_bindings (id TEXT PRIMARY KEY, letter TEXT UNIQUE, value TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE INDEX IF NOT EXISTS gateway_delivered_trace ON gateway_bindings (json_extract(value, '$.process'), json_extract(value, '$.span.traceId')) WHERE json_extract(value, '$.state._tag')='delivered'",
    );
  };
  const atomic = Effect.fnUntraced(function* <A>(step: () => A) {
    return yield* Effect.try({
      try: () =>
        sql.transaction(() => {
          ensure();
          return step();
        }),
      catch: (cause) => new LedgerError({ reason: "storage", cause }),
    });
  });
  const get = <A>(name: string, schema: Schema.Codec<A>) => {
    const [row] = sql.exec("SELECT value FROM gateway_state WHERE name=?", name);

    if (row === undefined) {
      return null;
    }

    const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(schema))(row.value);

    if (Result.isFailure(decoded)) {
      throw new LedgerError({ reason: "bad_row", cause: decoded.failure });
    }

    return decoded.success;
  };
  const set = <A>(name: string, schema: Schema.Codec<A>, value: A) => {
    sql.exec(
      "INSERT INTO gateway_state (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
      name,
      Schema.encodeSync(Schema.fromJsonString(schema))(value),
    );
  };
  return { atomic, get, set, sql };
};
