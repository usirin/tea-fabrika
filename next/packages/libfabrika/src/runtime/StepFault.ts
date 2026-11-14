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
 * The trusted hook before a supervised program step.
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/**
 * Identifies the letter and whether this attempt folds saved history.
 *
 * @stability unstable
 * @category models
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export type Before = {
  readonly name: string;
  readonly process: string;
  readonly letter: string;
  readonly phase: "fresh" | "saved";
};

/**
 * Allows trusted wiring to fail a step with its original defect.
 *
 * @stability unstable
 * @category services
 */
export class StepFault extends Context.Service<
  StepFault,
  { readonly before: (input: Before) => Effect.Effect<void> }
>()("@kampus/libfabrika/runtime/StepFault") {}
