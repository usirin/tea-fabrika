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
import { Effect, Layer, Schema } from "effect";
import type { Update } from "../runtime/Entry.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import { Gone, Publication, Unreachable, WatcherManager, WatcherManagerError } from "../runtime/WatcherManager.ts";

/** Decode the boundary before interpreting absence. Unknown replies never end a watch. */
export const layer = <E>(
  publish: (client: string, update: Update) => Effect.Effect<unknown, E>,
): Layer.Layer<WatcherManager> =>
  Layer.succeed(WatcherManager, {
    publish: Effect.fn("watchers.remote.publish")(function* (client: string, update: Update) {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      const outcome = yield* Effect.suspend(() => publish(client, update)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Publication)),
        Effect.mapError((cause) => new WatcherManagerError({ reason: new Unreachable({ cause }) })),
      );

      if (outcome._tag === "gone") {
        return yield* new WatcherManagerError({ reason: new Gone({ cause: outcome }) });
      }
    }),
  });
