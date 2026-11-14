/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
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
