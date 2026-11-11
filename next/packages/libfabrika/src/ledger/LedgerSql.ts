// The Ledger as the referee in this process, on any `Sql`: in the project object, and on
// node:sqlite in tests (0095). Tier 1, P6 (laws p18 to p20, p94 and p95).
import { Effect, Layer } from "effect";
import type { Sql } from "../Sql.ts";
import { pages } from "./internal/ledgerPages.ts";
import { type Doorbell, Ledger } from "./Ledger.ts";
import { Referee } from "./Referee.ts";

/** The referee in this process. `caller.reader` is the object's own name, such as
 *  `connection:t1`. */
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
  ).pipe(Layer.provide(Referee.layer(sql)));
