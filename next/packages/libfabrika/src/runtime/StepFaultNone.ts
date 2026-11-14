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
 * The disabled step hook, with no live fault dependencies.
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { StepFault } from "./StepFault.ts";

/**
 * Leaves every supervised step unchanged.
 *
 * @stability unstable
 * @category layers
 */
export const layer: Layer.Layer<StepFault> = Layer.succeed(StepFault, {
  before: Effect.fn("StepFaultNone.before")(() => Effect.void),
});
