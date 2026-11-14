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
 * The `Referee` on any `Sql`: the project object's SQLite, and `node:sqlite` in tests (0095).
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import type { Sql } from "../Sql.ts";
import { ledgerStore } from "./internal/ledgerStore.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { Doorbell } from "./Ledger.ts";
import { Referee } from "./Referee.ts";

/**
 * Layer that provides `Referee` on the given `Sql`. An append is decided and written in one SQL
 * transaction, so nothing runs between giving an entry its number and writing it.
 *
 * **Details**
 *
 * The tables are made on the first call. A parked wait leaves a row behind, never a fiber or a
 * timer, so the object can sleep under it. It asks for a `Doorbell`, to ring the waiters an append
 * wakes.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (sql: Sql): Layer.Layer<Referee, never, Doorbell> =>
  Layer.effect(
    Referee,
    Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      return ledgerStore(sql, yield* Doorbell);
    }),
  );
