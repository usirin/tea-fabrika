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
// One of the shared names of 0043, on layer 0 (0091): a value every module may import, with no service
// and no error.
export type SqlValue = string | number | null;

/** workerd's SQLite and node:sqlite supply the same synchronous operations. */
export interface Sql {
  readonly exec: (query: string, ...params: ReadonlyArray<SqlValue>) => ReadonlyArray<Record<string, SqlValue>>;
  readonly transaction: <A>(step: () => A) => A;
  readonly size: () => number;
}
