/**
 * The `Ledger` as the referee in this process, on any `Sql`: in the project object, and on
 * `node:sqlite` in tests (0095).
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import type { Sql } from "../Sql.ts";
import { pages } from "./internal/ledgerPages.ts";
import { type Doorbell, Ledger } from "./Ledger.ts";
import { Referee } from "./Referee.ts";
import * as RefereeSql from "./RefereeSql.ts";

/**
 * Layer that provides `Ledger` as the referee in this process, on the given `Sql`.
 *
 * **Details**
 *
 * It builds its own `Referee` over `sql` and asks only for a `Doorbell`. `read` pulls the
 * referee's pages one after another as the Stream runs. `caller.reader` is the object's own name,
 * such as `project:main`: the name a parked wait is rung under.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (sql: Sql, caller: { readonly reader: string }): Layer.Layer<Ledger, never, Doorbell> =>
  Layer.effect(
    Ledger,
    Effect.gen(function* () {
      const referee = yield* Referee;
      return {
        append: referee.append,
        read: (stream, after) => pages(after, (from) => referee.read(stream, from, caller.reader)),
        wait: (stream, after) => referee.wait(stream, after, caller.reader),
      };
    }),
  ).pipe(Layer.provide(RefereeSql.layer(sql)));
