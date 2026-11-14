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
import type { Selection } from "@kampus/libfabrika/build";

// The programs this app runs. Each package's pure `.` entry holds the declaration; a window, when a
// program has one, stays on its package's `./window`. The build embeds both in the brain file. Each
// name is `pack/program` (0083), and the shipped programs are the core pack, `fabrika`.
export const programs: ReadonlyArray<Selection> = [
  { name: "fabrika/counter", package: "@kampus/counter", export: "counter" },
  { name: "fabrika/checklist", package: "@kampus/checklist", export: "checklist" },
];
