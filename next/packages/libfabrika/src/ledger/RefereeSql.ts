// The Referee on any `Sql`: the project object's SQLite, and node:sqlite in tests (0095).
import { Effect, Layer, Option } from "effect";
import type { Sql } from "../Sql.ts";
import { committedEntries, ledgerStore } from "./internal/ledgerStore.ts";
import { Doorbell } from "./Ledger.ts";
import { Referee } from "./Referee.ts";
import { WritePolicy } from "./WritePolicy.ts";

/** Read committed entries for first-install accounting inside the caller's transaction.
 * @stability unstable
 * @category constructors
 */
export const accountingEntries = (sql: Sql) => committedEntries(sql);

export const layer = (sql: Sql): Layer.Layer<Referee, never, Doorbell> =>
  Layer.effect(
    Referee,
    Effect.gen(function* () {
      return ledgerStore(sql, yield* Doorbell, Option.getOrUndefined(yield* Effect.serviceOption(WritePolicy)));
    }),
  );
