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
/**
 * The gateway's tables in the project's Sql. Only checked connection state and input metadata
 * belong here. Input bodies stay out.
 *
 * @stability unstable
 */
import { Effect, Result, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
export const gatewayStore = (sql: Sql) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
