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
 * Instance readiness and owned-resource checks.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Schema for a readiness answer about the expected instance: still waiting, or ready.
 *
 * @stability unstable
 * @category schemas
 */
export const Readiness = Schema.TaggedUnion({ waiting: {}, ready: {} });
/**
 * Schema for an owned-resource answer: still waiting, or every owned group and the listener gone.
 *
 * @stability unstable
 * @category schemas
 */
export const Children = Schema.TaggedUnion({ waiting: {}, gone: {} });
/**
 * Readiness could not be checked.
 *
 * @stability unstable
 * @category errors
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export class Unreachable extends Schema.TaggedError<Unreachable>()("Unreachable", { cause: Schema.Defect() }) {}
/**
 * Another instance owns the fixed address.
 *
 * @stability unstable
 * @category errors
 */
export class Foreign extends Schema.TaggedError<Foreign>()("Foreign", { cause: Schema.Defect() }) {}
/**
 * Owned resources could not be checked.
 *
 * @stability unstable
 * @category errors
 */
export class Cleanup extends Schema.TaggedError<Cleanup>()("Cleanup", { cause: Schema.Defect() }) {}

/**
 * Probe failure with its protected cause.
 *
 * @stability unstable
 * @category errors
 */
export class BrainProbeError extends Schema.TaggedError<BrainProbeError>()("BrainProbeError", {
  reason: Schema.Union([Unreachable, Foreign, Cleanup]),
}) {}

/**
 * Probes supplied by the client that owns the instance.
 *
 * @stability unstable
 * @category services
 */
export class BrainProbe extends Context.Service<
  BrainProbe,
  {
    readonly ready: Effect.Effect<typeof Readiness.Type, BrainProbeError>;
    readonly cleanup: Effect.Effect<typeof Children.Type, BrainProbeError>;
  }
>()("@kampus/libfabrika/desktop/BrainProbe") {}
