import {Context, Effect, Layer, Schema} from "effect";
import {LedgerError} from "../data/ledger.ts";
import {type Sql} from "../data/referee.ts";
import {Supervision} from "./recovery.ts";

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Supervision));
const encode = Schema.encodeUnknownSync(Schema.fromJsonString(Supervision));

export class RecoveryStore extends Context.Service<
	RecoveryStore,
	{
		readonly load: Effect.Effect<Supervision | null, LedgerError>;
		readonly save: (value: unknown) => Effect.Effect<void, LedgerError>;
		readonly input: (letter: string) => Effect.Effect<Schema.Json | null, LedgerError>;
		readonly receipt: (
			letter: string,
		) => Effect.Effect<Supervision["receipts"][number] | null, LedgerError>;
	}
>()("@kampus/libfabrika/RecoveryStore") {
	static readonly layer = (
		sql: Sql,
		who: {readonly name: string; readonly capacity: number},
	): Layer.Layer<RecoveryStore> => {
		const stored = <A>(f: () => A) =>
			Effect.try({
				try: () => {
					sql.exec(
						"CREATE TABLE IF NOT EXISTS process_recovery (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
					);
					return f();
				},
				catch: (error) =>
					error instanceof LedgerError
						? error
						: new LedgerError({why: Schema.isSchemaError(error) ? "bad_row" : "storage"}),
			});
		const load = stored(() => {
			const [row] = sql.exec("SELECT value FROM process_recovery WHERE name=?", who.name);
			if (row === undefined) return null;
			const saved = decode(row.value);
			if (saved.name !== who.name) throw new LedgerError({why: "bad_row"});
			return saved;
		});
		const receipt = Effect.fn("recovery.receipt")(function* (letter: string) {
			return (yield* load)?.receipts.find((r) => r.letter === letter) ?? null;
		});
		const save = (value: unknown) =>
			stored(() => {
				const text = encode(value);
				if (decode(text).name !== who.name) throw new LedgerError({why: "bad_row"});
				sql.transaction(() => {
					const old = sql.exec(
						"SELECT length(CAST(value AS BLOB)) AS bytes FROM process_recovery WHERE name=?",
						who.name,
					)[0];
					const bytes = new TextEncoder().encode(text).length;
					if (sql.size() - Number(old?.bytes ?? 0) + bytes > who.capacity)
						throw new LedgerError({why: "storage"});
					sql.exec(
						"INSERT INTO process_recovery (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
						who.name,
						text,
					);
				});
			});
		return Layer.succeed(RecoveryStore, {
			load,
			save: Effect.fn("recovery.save")(save),
			receipt,
			input: Effect.fn("recovery.input")(function* (letter: string) {
				return (yield* receipt(letter))?.input ?? null;
			}),
		});
	};
}
