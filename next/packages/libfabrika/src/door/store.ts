import {Effect, Result, Schema} from "effect";
import {LedgerError, type Sql} from "../data/index.ts";

// Only checked connection state and input metadata belong here. Input bodies stay out.
export const doorStore = (sql: Sql) => {
	const ensure = () => {
		sql.exec("CREATE TABLE IF NOT EXISTS door_state (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
		sql.exec("CREATE TABLE IF NOT EXISTS door_starts (id TEXT PRIMARY KEY)");
		sql.exec(
			"CREATE TABLE IF NOT EXISTS door_pending (client TEXT PRIMARY KEY, until REAL NOT NULL)",
		);
		sql.exec("CREATE TABLE IF NOT EXISTS door_spent (nonce TEXT PRIMARY KEY, until REAL NOT NULL)");
		sql.exec("CREATE INDEX IF NOT EXISTS door_spent_until ON door_spent (until)");
		sql.exec(
			"CREATE TABLE IF NOT EXISTS door_bindings (id TEXT PRIMARY KEY, letter TEXT UNIQUE, value TEXT NOT NULL)",
		);
		sql.exec(
			"CREATE INDEX IF NOT EXISTS door_delivered_trace ON door_bindings (json_extract(value, '$.process'), json_extract(value, '$.span.traceId')) WHERE json_extract(value, '$.state._tag')='delivered'",
		);
	};
	const atomic = Effect.fnUntraced(function* <A>(step: () => A) {
		return yield* Effect.try({
			try: () =>
				sql.transaction(() => {
					ensure();
					return step();
				}),
			catch: () => new LedgerError({reason: "storage"}),
		});
	});
	const get = <A>(name: string, schema: Schema.Codec<A>) => {
		const [row] = sql.exec("SELECT value FROM door_state WHERE name=?", name);

		if (row === undefined) {
			return null;
		}

		const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(schema))(row.value);

		if (Result.isFailure(decoded)) {
			throw new LedgerError({reason: "bad_row"});
		}

		return decoded.success;
	};
	const set = <A>(name: string, schema: Schema.Codec<A>, value: A) => {
		sql.exec(
			"INSERT INTO door_state (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
			name,
			Schema.encodeSync(Schema.fromJsonString(schema))(value),
		);
	};
	return {atomic, get, set, sql};
};
