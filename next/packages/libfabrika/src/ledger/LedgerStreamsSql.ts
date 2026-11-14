/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
/**
 * Paged stream discovery on the ledger's SQL tables.
 *
 * @stability unstable
 */
import { Effect, Layer, Option, Stream } from "effect";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./internal/ledgerStore.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { BadRow, LedgerStreams, LedgerStreamsError, Storage } from "./LedgerStreams.ts";
import { PAGE } from "./Log.ts";

/**
 * Supplies discovery using the ledger's table setup and page size.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (sql: Sql): Layer.Layer<LedgerStreams> =>
  Layer.sync(LedgerStreams, () => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
