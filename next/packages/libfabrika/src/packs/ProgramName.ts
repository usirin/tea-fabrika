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
 * A program's identity (0083): its pack and its name in that pack, as `pack/program`. Pure data, no
 * platform, so the Node builder, the built tables and a browser client read one schema.
 *
 * @stability unstable
 */
import { Schema } from "effect";

/**
 * Schema for a program's name, `pack/program`: two segments that each start with a letter or an
 * underscore and go on with letters, digits, underscores or dashes. At most 256 characters in all,
 * the cap a process's `code.program` has.
 *
 * @stability unstable
 * @category schemas
 */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export const ProgramName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z_][\w-]*\/[A-Za-z_][\w-]*$/),
  Schema.isMaxLength(256),
);
/**
 * A program's name, `pack/program`.
 *
 * @stability unstable
 * @category models
 */
export type ProgramName = typeof ProgramName.Type;
