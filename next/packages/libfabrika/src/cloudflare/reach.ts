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
import { RpcCallError } from "alchemy/Rpc";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { Effect, Schema } from "effect";

export const reach = Effect.fn("brain.reach")(function* <A, E, R, X>(
  call: Effect.Effect<A, E, R>,
  unreachable: (cause: RpcCallError) => X,
) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const widened: Effect.Effect<A, E | RpcCallError, R> = call;
  return yield* widened.pipe(
    Effect.catchIf(Schema.is(Schema.instanceOf(RpcCallError)), (cause) => Effect.fail(unreachable(cause))),
  );
});
