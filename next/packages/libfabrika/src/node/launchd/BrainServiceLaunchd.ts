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
    Effect.gen(function* () {
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
