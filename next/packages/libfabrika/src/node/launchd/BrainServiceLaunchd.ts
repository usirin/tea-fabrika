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
 * Native brain lifecycle with the durable recording queue.
 *
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import type { BrainProbe } from "../../desktop/BrainProbe.ts";
import { BrainServiceError, Operation } from "../../desktop/BrainService.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
import * as Managed from "../../desktop/BrainServiceManaged.ts";
import type { BrainSpec } from "../../desktop/BrainSpec.ts";
import type * as Snapshot from "../../settings/Snapshot.ts";
import { devRecording } from "../dev/dev-recording.ts";
import * as Control from "./BrainControlLaunchd.ts";

/**
 * Selects launchd and an isolated durable queue, leaving readiness to the caller.
 *
 * @stability unstable
 * @category layers
 */
export const layer = <E, R>(
  spec: BrainSpec,
  settings: Snapshot.Snapshot,
  probe: Layer.Layer<BrainProbe, E, R>,
  forward: (
    target: "record" | "bucket",
    name: string,
    method: string,
    args: ReadonlyArray<unknown>,
  ) => Effect.Effect<unknown, E>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      const path = yield* Path.Path;
      const recording = yield* devRecording(path.join(spec.home, "records", "desktop"), "desktop", forward).pipe(
        Effect.mapError(
          (cause) =>
            new BrainServiceError({ reason: new Operation({ action: "install", cause: Redacted.make(cause) }) }),
        ),
        Effect.catchDefect((cause) =>
          Effect.fail(
            new BrainServiceError({ reason: new Operation({ action: "install", cause: Redacted.make(cause) }) }),
          ),
        ),
      );
      return Managed.layer(spec, settings).pipe(
        Layer.provide(Layer.mergeAll(Control.layer(spec, settings), probe, Layer.succeedContext(recording))),
      );
    }),
  );
