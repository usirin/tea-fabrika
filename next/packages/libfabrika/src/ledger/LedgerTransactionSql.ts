/**
 * The `LedgerTransaction` on any `Sql`: the project object's SQLite, and `node:sqlite` in tests
 * (0095).
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./internal/ledgerStore.ts";
import { Doorbell } from "./Ledger.ts";
import { LedgerTransaction } from "./LedgerTransaction.ts";

/**
 * Layer that provides `LedgerTransaction` on the given `Sql`, where one turn is one SQL
 * transaction. It asks for a `Doorbell`, to ring the waiters a turn's appends wake.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (sql: Sql): Layer.Layer<LedgerTransaction, never, Doorbell> =>
  Layer.effect(
    LedgerTransaction,
    Effect.gen(function* () {
      return { transact: ledgerStore(sql, yield* Doorbell).transact };
    }),
  );
