/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * Paged stream discovery on the ledger's SQL tables.
 *
 * @stability unstable
 */
import { Effect, Layer, Option, Stream } from "effect";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./internal/ledgerStore.ts";
import { BadRow, LedgerStreams, LedgerStreamsError, Storage } from "./LedgerStreams.ts";
import { PAGE } from "./Log.ts";

/**
 * Supplies discovery using the ledger's table setup and page size.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (sql: Sql): Layer.Layer<LedgerStreams> =>
  Layer.sync(LedgerStreams, () => {
    const store = ledgerStore(sql, { ring: () => Effect.void });
    return {
      list: (prefix: string) =>
        Stream.paginate(null as string | null, (after) =>
          store.streams(prefix, after).pipe(
            Effect.mapError(
              (error) =>
                new LedgerStreamsError({
                  reason:
                    error.reason === "bad_row"
                      ? new BadRow({ cause: error.cause })
                      : new Storage({ cause: error.cause }),
                }),
            ),
            Effect.map(
              (names) => [names, names.length < PAGE ? Option.none() : Option.fromUndefinedOr(names.at(-1))] as const,
            ),
          ),
        ),
    };
  });
