// The LedgerTransaction on any `Sql`: the project object's SQLite, and node:sqlite in tests (0095).
import { Effect, Layer, Option } from "effect";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./internal/ledgerStore.ts";
import { Doorbell } from "./Ledger.ts";
import { LedgerTransaction } from "./LedgerTransaction.ts";
import { WritePolicy } from "./WritePolicy.ts";

export const layer = (sql: Sql): Layer.Layer<LedgerTransaction, never, Doorbell> =>
  Layer.effect(
    LedgerTransaction,
    Effect.gen(function* () {
      return {
        transact: ledgerStore(sql, yield* Doorbell, Option.getOrUndefined(yield* Effect.serviceOption(WritePolicy)))
          .transact,
      };
    }),
  );
