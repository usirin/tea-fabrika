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
 * Public lifecycle for a home-owned brain.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * A lower operation failed; its cause is protected by the driver.
 *
 * @stability unstable
 * @category errors
 */
export class Operation extends Schema.TaggedError<Operation>()("Operation", {
  action: Schema.Literals(["inspect", "install", "start", "stop", "cleanup"]),
  cause: Schema.Defect(),
}) {}

/**
 * A bounded lifecycle attempt expired.
 *
 * @stability unstable
 * @category errors
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export class Timeout extends Schema.TaggedError<Timeout>()("Timeout", {
  action: Schema.Literals(["up", "start", "stop"]),
  cause: Schema.Defect(),
}) {}

/**
 * Another job, file or listener owns the requested resource.
 *
 * @stability unstable
 * @category errors
 */
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", { cause: Schema.Defect() }) {}

/**
 * Lifecycle failure with a checked reason.
 *
 * @stability unstable
 * @category errors
 */
export class BrainServiceError extends Schema.TaggedError<BrainServiceError>()("BrainServiceError", {
  reason: Schema.Union([Operation, Timeout, Conflict]),
}) {}

/**
 * Starts or reuses a brain, or awaits its confirmed shutdown.
 *
 * @stability unstable
 * @category services
 */
export class BrainService extends Context.Service<
  BrainService,
  {
    readonly up: Effect.Effect<{ readonly url: string }, BrainServiceError>;
    readonly stop: Effect.Effect<void, BrainServiceError>;
  }
>()("@kampus/libfabrika/desktop/BrainService") {}
