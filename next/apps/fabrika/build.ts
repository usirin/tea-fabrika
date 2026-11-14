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
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Path } from "effect";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { build } from "./src/build.ts";

NodeRuntime.runMain(
  Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
    const path = yield* Path.Path;
    return yield* build({ out: path.resolve(process.argv[2] ?? "dist") });
  }).pipe(
    Effect.tap((built) =>
      Effect.sync(() => {
        process.stdout.write(`${built.build}\n`);
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
);
