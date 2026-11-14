// The Referee on any `Sql`: the project object's SQLite, and node:sqlite in tests (0095).
import { Effect, Layer, Option } from "effect";
import type { Sql } from "../Sql.ts";
import { committedEntries, ledgerStore } from "./internal/ledgerStore.ts";
import { Doorbell } from "./Ledger.ts";
import { Referee } from "./Referee.ts";
import { WritePolicy, RuntimeWrite } from "./WritePolicy.ts";

/**
 * Returns the committed entries in `sql`, oldest first, or none before the ledger's table exists.
 * Accounting reads them to find each entry's owner.
 *
 * **Details**
 *
 * `scope.after` keeps only entries past that revision, and `scope.stream` only one stream's, so a
 * reader that knows what it needs does not decode the whole ledger.
 *
 * @stability unstable
 * @category getters
 */
export const accountingEntries = (sql: Sql, scope?: { readonly stream?: string; readonly after?: number }) =>
  committedEntries(sql, scope);

export const layer = (sql: Sql): Layer.Layer<Referee, never, Doorbell> =>
  Layer.effect(
    Referee,
    Effect.gen(function* () {
      const bell = yield* Doorbell;
      const policy = Option.getOrUndefined(yield* Effect.serviceOption(WritePolicy));
      const store = ledgerStore(sql, bell, policy);
      return {
        ...store,
        append: Effect.fnUntraced(function* (stream: string, id: string, line: unknown) {
          const runtime = Option.getOrUndefined(yield* Effect.serviceOption(RuntimeWrite));

          if (runtime === undefined) {
            return yield* store.append(stream, id, line);
          }

          return yield* ledgerStore(
            sql,
            bell,
            policy === undefined
              ? undefined
              : {
                  admit: (entry) => policy.admit(entry, runtime),
                },
          ).append(stream, id, line);
        }),
      };
    }),
  );
