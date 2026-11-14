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
 * Schemas for a sender's gateway budget and its decision.
 *
 * @stability unstable
 */
import * as Schema from "effect/Schema";
import { gatewayLimit, gatewayWindow } from "../settings/Declarations.ts";

/**
 * Schema for the instance operator's fixed-window budget, read at trusted startup.
 *
 * @stability unstable
 * @category models
 */
export const Policy = Schema.Struct({ limit: gatewayLimit.schema, window: gatewayWindow.schema });
/**
 * The instance operator's resolved gateway budget.
 *
 * @stability unstable
 * @category models
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export type Policy = typeof Policy.Type;

const Positive = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));

/**
 * Schema for one attempt's result. Refusals do not consume more saved budget.
 *
 * @stability unstable
 * @category models
 */
export const Decision = Schema.TaggedUnion({
  allowed: { count: Positive, ttl: Positive },
  refused: { retryAfter: Positive },
  invalid: { cause: Schema.Defect() },
});
