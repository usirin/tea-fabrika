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
 * The trusted fault and history-check contract. Layers live in sibling files.
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Fire, Fired, Report, Target } from "./Chaos.ts";

/**
 * Chaos is disabled.
 *
 * @stability unstable
 * @category errors
 */
export class Off extends Schema.TaggedError<Off>()("Off", { cause: Schema.Defect() }) {}

/**
 * The requested target cannot be used.
 *
 * @stability unstable
 * @category errors
 */
export class BadTarget extends Schema.TaggedError<BadTarget>()("BadTarget", { cause: Schema.Defect() }) {}

/**
 * The caller lacks the required grant.
 *
 * @stability unstable
 * @category errors
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export class NotGranted extends Schema.TaggedError<NotGranted>()("NotGranted", { cause: Schema.Defect() }) {}

/**
 * The operation did not reach its destination.
 *
 * @stability unstable
 * @category errors
 */
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}

/**
 * History contained an undecodable known row or invalid position.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Storage failed while reading the check's snapshot.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * The service's own error, retaining the original cause in its reason.
 *
 * @stability unstable
 * @category errors
 */
export class NemesisError extends Schema.TaggedError<NemesisError>()("NemesisError", {
  reason: Schema.Union([Off, BadTarget, NotGranted, Unreachable, BadRow, Storage]),
}) {}

/**
 * Performs trusted faults and checks bounded history.
 *
 * @stability unstable
 * @category services
 */
export class Nemesis extends Context.Service<
  Nemesis,
  {
    readonly fire: (request: Fire) => Effect.Effect<Fired, NemesisError>;
    readonly check: (target: Target) => Effect.Effect<Report, NemesisError>;
  }
>()("@kampus/libfabrika/runtime/Nemesis") {}
