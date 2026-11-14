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
import { ErrorClass } from "@kampus/libfabrika/transport/ClientRows";
import { Predicate, Schema } from "effect";

export { browserKey } from "./key.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export { browserSocket } from "./socket.ts";
export { browserRows } from "./rows.ts";

/** Keep only a fixed platform class, never an error's text or data. */
export function errorClass(error: unknown): ErrorClass {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const name = Predicate.isObject(error) && Predicate.hasProperty(error, "name") ? error.name : null;
  return Schema.is(ErrorClass)(name) ? name : "other";
}
