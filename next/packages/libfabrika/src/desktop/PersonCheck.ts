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
 * Person confirmation, without a platform handle or an implementation.
 *
 * @stability unstable
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Schema for a person check's answer: `checked`, by touch or by click, or `declined`.
 *
 * @stability unstable
 * @category schemas
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const Answer = Schema.TaggedUnion({
  checked: { check: Schema.Literals(["touch", "click"]) },
  declined: {},
});

/**
 * Error for a person check that could not run. It keeps the underlying cause.
 *
 * @stability unstable
 * @category errors
 */
export class Unavailable extends Schema.TaggedError<Unavailable>()("Unavailable", {
  cause: Schema.Defect(),
}) {}

/**
 * Error that a person check fails with. Its `reason` names the failure.
 *
 * @stability unstable
 * @category errors
 */
export class PersonCheckError extends Schema.TaggedError<PersonCheckError>()("PersonCheckError", {
  reason: Schema.Union([Unavailable]),
}) {}

/**
 * Service that asks a person to confirm the action `reason` describes, and answers `checked` or `declined`.
 *
 * @stability unstable
 * @category services
 */
export class PersonCheck extends Context.Service<
  PersonCheck,
  {
    readonly ask: (reason: string) => Effect.Effect<typeof Answer.Type, PersonCheckError>;
  }
>()("@kampus/libfabrika/desktop/PersonCheck") {}
