/**
 * The gateway's tables in the project's Sql. Only checked connection state and input metadata
 * belong here. Input bodies stay out.
 *
 * @stability unstable
 */
import { Effect, Result, Schema } from "effect";
import { type Sql } from "../Sql.ts";
import { BadRow, GatewayError, Storage } from "./GatewayError.ts";

/**
 * Creates the gateway's store over a Sql: `atomic`, `get`, `set` and the Sql itself.
 *
 * **Details**
 *
 * `atomic` runs one synchronous step in a transaction, creating the tables first. When the step
 * throws, it fails with that `GatewayError` as it is, or with reason `Storage` for any other
 * throw. `get` and `set` read and write a named state value through a schema. `get` answers null
 * when the name is absent and throws a `GatewayError` with reason `BadRow` when the saved text does
 * not decode, so call it inside `atomic`.
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
      catch: (cause) => (Schema.is(GatewayError)(cause) ? cause : new GatewayError({ reason: new Storage({ cause }) })),
    });
  });
  const get = <A>(name: string, schema: Schema.Codec<A>) => {
    const [row] = sql.exec("SELECT value FROM gateway_state WHERE name=?", name);

    if (row === undefined) {
      return null;
    }

    const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(schema))(row.value);

    if (Result.isFailure(decoded)) {
      throw new GatewayError({ reason: new BadRow({ cause: decoded.failure }) });
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
