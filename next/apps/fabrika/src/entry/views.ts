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
import type { checklist } from "@kampus/checklist";
import { checklistWindow } from "@kampus/checklist/window";
import { windowMachineFor } from "@kampus/tuval";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { Schema } from "effect";

export const tiles = [{ id: "tile_1", name: "checklist:1" }];
export const windowFor = (name: string) => (name === "checklist:1" ? checklistWindow : null);

export const window = windowMachineFor<typeof checklist>({
  decode: () => Schema.decodeUnknownSync(checklistWindow.data),
  tile: (name) => windowFor(name)?.tile,
});
