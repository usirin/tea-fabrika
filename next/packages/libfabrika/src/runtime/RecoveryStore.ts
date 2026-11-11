import { Context, Effect, Layer, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { type Sql } from "../Sql.ts";
import { Receipt, Supervision } from "./internal/recovery.ts";

// The journal row keeps its receipts apart, so it is read whole only once they are merged back.
const Row = Schema.fromJsonString(Schema.Struct(Supervision.fields));
const decode = Schema.decodeUnknownSync(Row);
const encode = Schema.encodeUnknownSync(Row);
const check = Schema.decodeUnknownSync(Supervision);
const decodeReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(Receipt));
const encodeReceipt = Schema.encodeSync(Schema.fromJsonString(Receipt));

const receiptFor = (value: unknown, letter: unknown) => {
  const saved = decodeReceipt(value);

  if (saved.letter !== letter) {
    throw new LedgerError({ reason: "bad_row" });
  }

  return saved;
};

const TABLES = [
  "CREATE TABLE IF NOT EXISTS process_recovery (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS process_receipts (name TEXT NOT NULL, letter TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (name, letter))",
];

const bytes = (text: string) => new TextEncoder().encode(text).length;

export class RecoveryStore extends Context.Service<
  RecoveryStore,
  {
    readonly load: Effect.Effect<Supervision | null, LedgerError>;
    readonly save: (value: unknown) => Effect.Effect<void, LedgerError>;
    readonly input: (letter: string) => Effect.Effect<Schema.Json | null, LedgerError>;
    readonly receipt: (letter: string) => Effect.Effect<Supervision["receipts"][number] | null, LedgerError>;
  }
>()("@kampus/libfabrika/RecoveryStore") {
  static readonly layer = (
    sql: Sql,
    who: { readonly name: string; readonly capacity: number },
  ): Layer.Layer<RecoveryStore> => {
    const stored = <A>(f: () => A) =>
      Effect.try({
        try: () => {
          for (const query of TABLES) {
            sql.exec(query);
          }

          return f();
        },
        catch: (error) =>
          error instanceof LedgerError
            ? error
            : new LedgerError({ reason: Schema.isSchemaError(error) ? "bad_row" : "storage" }),
      });
    const snapshot = () => {
      const [row] = sql.exec("SELECT value FROM process_recovery WHERE name=?", who.name);

      if (row === undefined) {
        return null;
      }

      const saved = decode(row.value);

      if (saved.name !== who.name) {
        throw new LedgerError({ reason: "bad_row" });
      }

      return saved;
    };
    const load = stored(() => {
      const saved = snapshot();

      if (saved === null) {
        return null;
      }

      const receipts = new Map(saved.receipts.map((r) => [r.letter, r]));

      for (const row of sql.exec("SELECT letter, value FROM process_receipts WHERE name=? ORDER BY rowid", who.name)) {
        const receipt = receiptFor(row.value, row.letter);
        receipts.set(receipt.letter, receipt);
      }

      return check({ ...saved, receipts: [...receipts.values()] });
    });
    const receipt = Effect.fn("recovery.receipt")(function* (letter: string) {
      return yield* stored(() => {
        const [row] = sql.exec("SELECT value FROM process_receipts WHERE name=? AND letter=?", who.name, letter);

        // Read old single-row snapshots until their next atomic save splits the receipts.
        if (row === undefined) {
          return snapshot()?.receipts.find((r) => r.letter === letter) ?? null;
        }

        return receiptFor(row.value, letter);
      });
    });
    const save = (value: unknown) =>
      stored(() => {
        const saved = check(value);

        if (saved.name !== who.name) {
          throw new LedgerError({ reason: "bad_row" });
        }

        const text = encode({ ...saved, receipts: [] });
        sql.transaction(() => {
          const old = sql.exec("SELECT value FROM process_recovery WHERE name=?", who.name)[0];
          let growth = bytes(text) - (typeof old?.value === "string" ? bytes(old.value) : 0);
          const changed: Array<{ letter: string; text: string }> = [];
          // Omitted receipts are retained, including during migration from the old snapshot.
          const receipts = new Map((old === undefined ? [] : decode(old.value).receipts).map((r) => [r.letter, r]));

          for (const receipt of saved.receipts) {
            receipts.set(receipt.letter, receipt);
          }

          for (const receipt of receipts.values()) {
            const next = encodeReceipt(receipt);
            const [prior] = sql.exec(
              "SELECT value FROM process_receipts WHERE name=? AND letter=?",
              who.name,
              receipt.letter,
            );

            if (prior?.value === next) {
              continue;
            }

            growth += bytes(next) - (typeof prior?.value === "string" ? bytes(prior.value) : 0);

            if (prior === undefined) {
              growth += bytes(who.name) + bytes(receipt.letter);
            }

            changed.push({ letter: receipt.letter, text: next });
          }

          if (sql.size() + growth > who.capacity) {
            throw new LedgerError({ reason: "storage" });
          }

          for (const receipt of changed) {
            sql.exec(
              "INSERT INTO process_receipts (name,letter,value) VALUES (?,?,?) ON CONFLICT(name,letter) DO UPDATE SET value=excluded.value",
              who.name,
              receipt.letter,
              receipt.text,
            );
          }

          if (old?.value !== text) {
            sql.exec(
              "INSERT INTO process_recovery (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
              who.name,
              text,
            );
          }
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
