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
// The module a brain imports its built tables from. `build.ts` generates it: each selected
// program's compiled source with its hash, and each window file under its route, all as text.
declare module "virtual:fabrika-built" {
  export const programs: Readonly<Record<string, import("../../runtime/Built.ts").BuiltProgram>>;
  export const assets: Readonly<Record<string, import("../../runtime/Built.ts").Asset>>;
}
