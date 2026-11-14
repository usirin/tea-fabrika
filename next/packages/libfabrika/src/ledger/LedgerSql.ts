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
 * The `Ledger` as the referee in this process, on any `Sql`: in the project object, and on
 * `node:sqlite` in tests (0095).
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import type { Sql } from "../Sql.ts";
import { pages } from "./internal/ledgerPages.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
    Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      const referee = yield* Referee;
      return {
        append: referee.append,
        read: (stream, after) => pages(after, (from) => referee.read(stream, from, caller.reader)),
        wait: (stream, after) => referee.wait(stream, after, caller.reader),
      };
    }),
  ).pipe(Layer.provide(RefereeSql.layer(sql)));
