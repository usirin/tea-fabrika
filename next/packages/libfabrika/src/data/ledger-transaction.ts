import { Context, Effect, Layer } from "effect";
import type { Rev } from "../Rev.ts";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./ledger-store.ts";
import { Doorbell, type LedgerError } from "./ledger.ts";
import { type Entry, type Line } from "./log.ts";

/** Available only inside the synchronous callback. Refusal aborts the whole turn. */
export interface LedgerTurn {
  readonly read: (stream: string, after: Rev) => Iterable<Entry>;
  readonly append: (stream: string, id: string, line: Line) => { readonly rev: Rev; readonly pos: Rev };
}

export class LedgerTransaction extends Context.Service<
  LedgerTransaction,
  { readonly transact: <A>(step: (turn: LedgerTurn) => A) => Effect.Effect<A, LedgerError> }
>()("@kampus/libfabrika/LedgerTransaction") {
  static readonly layer = (sql: Sql): Layer.Layer<LedgerTransaction, never, Doorbell> =>
    Layer.effect(
      LedgerTransaction,
      Effect.gen(function* () {
        return { transact: ledgerStore(sql, yield* Doorbell).transact };
      }),
    );
}
