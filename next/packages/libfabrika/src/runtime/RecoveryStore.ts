import { Context, Effect, Layer, Schema } from "effect";
import { LedgerError } from "../ledger/Ledger.ts";
import { QuotasError, type Accounting } from "../processes/Quotas.ts";
import { type Sql } from "../Sql.ts";
import { Receipt } from "./internal/recovery.ts";
import { Supervision } from "./internal/supervisor.ts";

/** What the store reads of a saved journal: whose it is, and the receipts it keeps apart. */
const Kept = Schema.Struct({ name: Schema.String, receipts: Schema.Array(Receipt) });
type Kept = typeof Kept.Type;
const kept = Schema.decodeUnknownSync(Kept);

/** The saved journal's own schema, given by its caller: the runner passes the machine's. */
type Journal<S extends Kept> = Schema.Codec<S, unknown> & {
  readonly fields: { readonly [x: PropertyKey]: Schema.ConstraintCodec<unknown, unknown> };
};

type Store<S extends Kept> = {
  readonly load: Effect.Effect<S | null, LedgerError>;
  readonly save: (value: unknown) => Effect.Effect<void, LedgerError | QuotasError>;
  readonly input: (letter: string) => Effect.Effect<Schema.Json | null, LedgerError>;
  readonly receipt: (letter: string) => Effect.Effect<Receipt | null, LedgerError>;
};

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

/** One name's saved journal in `sql`, checked whole against its caller's schema on every load and save. */
export const recoveryStore = <S extends Kept>(
  sql: Sql,
  options: {
    readonly name: string;
    readonly capacity: number;
    readonly schema: Journal<S>;
    readonly accounting?: Accounting;
  },
): Store<S> => {
  // The journal row keeps its receipts apart, so it is checked whole only once they are merged back.
  const Row = Schema.fromJsonString(Schema.Struct(options.schema.fields));
  const decodeRow = Schema.decodeUnknownSync(Row);
  const decode = (text: unknown) => {
    const row = decodeRow(text);
    return { ...row, ...kept(row) };
  };
  const encode = Schema.encodeUnknownSync(Row);
  const check = Schema.decodeUnknownSync(options.schema);
  const tables = () => {
    for (const query of TABLES) {
      sql.exec(query);
    }
  };
  const failed = (error: unknown) =>
    error instanceof LedgerError
      ? error
      : new LedgerError({ reason: Schema.isSchemaError(error) ? "bad_row" : "storage", cause: error });
  // A read changes no row, so it is charged nothing and fails only as the ledger does.
  const read = <A>(f: () => A) =>
    Effect.try({
      try: () => {
        tables();
        return f();
      },
      catch: failed,
    });
  const stored = <A>(f: () => A) =>
    Effect.try({
      try: () => {
        tables();
        return options.accounting === undefined ? f() : options.accounting.protect(f);
      },
      catch: (error) => (error instanceof QuotasError ? error : failed(error)),
    });
  const snapshot = () => {
    const [row] = sql.exec("SELECT value FROM process_recovery WHERE name=?", options.name);

    if (row === undefined) {
      return null;
    }

    const saved = decode(row.value);

    if (saved.name !== options.name) {
      throw new LedgerError({ reason: "bad_row" });
    }

    return saved;
  };
  const load = read(() => {
    const saved = snapshot();

    if (saved === null) {
      return null;
    }

    const receipts = new Map(saved.receipts.map((r) => [r.letter, r]));

    for (const row of sql.exec(
      "SELECT letter, value FROM process_receipts WHERE name=? ORDER BY rowid",
      options.name,
    )) {
      const receipt = receiptFor(row.value, row.letter);
      receipts.set(receipt.letter, receipt);
    }

    return check({ ...saved, receipts: [...receipts.values()] });
  });
  const receipt = Effect.fn("recovery.receipt")(function* (letter: string) {
    return yield* read(() => {
      const [row] = sql.exec("SELECT value FROM process_receipts WHERE name=? AND letter=?", options.name, letter);

      // Read old single-row snapshots until their next atomic save splits the receipts.
      if (row === undefined) {
        return snapshot()?.receipts.find((r) => r.letter === letter) ?? null;
      }

      return receiptFor(row.value, letter);
    });
  });
  const save = (value: unknown) =>
    Effect.clockWith((clock) =>
      stored(() => {
        const saved = check(value);

        if (saved.name !== options.name) {
          throw new LedgerError({ reason: "bad_row" });
        }

        const text = encode({ ...saved, receipts: [] });
        sql.transaction(() => {
          const old = sql.exec("SELECT value FROM process_recovery WHERE name=?", options.name)[0];
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
              options.name,
              receipt.letter,
            );

            if (prior?.value === next) {
              continue;
            }

            growth += bytes(next) - (typeof prior?.value === "string" ? bytes(prior.value) : 0);

            if (prior === undefined) {
              growth += bytes(options.name) + bytes(receipt.letter);
            }

            changed.push({ letter: receipt.letter, text: next });
          }

          if (sql.size() + growth > options.capacity) {
            throw new LedgerError({ reason: "storage" });
          }

          const previous = old === undefined ? null : decode(old.value);
          const isRecovery = recoveryState(saved) || recoveryState(previous);
          options.accounting?.change(
            "journal",
            changed.length + (old?.value === text ? 0 : 1),
            growth,
            clock.currentTimeMillisUnsafe(),
            isRecovery,
          );

          for (const receipt of changed) {
            sql.exec(
              "INSERT INTO process_receipts (name,letter,value) VALUES (?,?,?) ON CONFLICT(name,letter) DO UPDATE SET value=excluded.value",
              options.name,
              receipt.letter,
              receipt.text,
            );
          }

          if (old?.value !== text) {
            sql.exec(
              "INSERT INTO process_recovery (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
              options.name,
              text,
            );
          }
        });
      }),
    );
  return {
    load,
    save: Effect.fn("recovery.save")(save),
    receipt,
    input: Effect.fn("recovery.input")(function* (letter: string) {
      return (yield* receipt(letter))?.input ?? null;
    }),
  };
};

export class RecoveryStore extends Context.Service<RecoveryStore, Store<Kept>>()(
  "@kampus/libfabrika/runtime/RecoveryStore",
) {
  static readonly layer = <S extends Kept>(
    sql: Sql,
    options: {
      readonly name: string;
      readonly capacity: number;
      readonly schema: Journal<S>;
      readonly accounting?: Accounting;
    },
  ): Layer.Layer<RecoveryStore> => Layer.succeed(RecoveryStore, recoveryStore(sql, options));
}

/** Read only the saved journal's control fields; receipts are stored separately.
 * @stability unstable
 * @category predicates
 */
export const recoveryState = (value: unknown): boolean => {
  const decoded = Schema.decodeUnknownOption(Schema.Struct(Supervision.fields))(value);

  if (decoded._tag === "None") {
    return false;
  }

  const journal = decoded.value.journal;
  return journal._tag !== "idle" && journal._tag !== "stepping";
};

/** The store's committed recovery position, read inside the data transaction.
 * @stability unstable
 * @category predicates
 */
export const recovering = (sql: Sql): boolean => {
  if (sql.exec("SELECT name FROM sqlite_master WHERE name='process_recovery'").length === 0) {
    return false;
  }

  const [row] = sql.exec("SELECT value FROM process_recovery LIMIT 1");
  return row === undefined
    ? false
    : recoveryState(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(row.value));
};
