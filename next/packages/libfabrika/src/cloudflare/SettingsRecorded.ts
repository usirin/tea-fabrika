/**
 * The layer that puts an instance start on record and hands it on as `RecordedStart`.
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import { Digest } from "effect/crypto";
import { RecordedStart } from "../settings/RecordedStart.ts";
import type * as Start from "../settings/Start.ts";
import { Decode, Starts, StartsError } from "../settings/Starts.ts";
import * as SettingsInput from "./SettingsInput.ts";

/**
 * Layer that provides `RecordedStart` for one start's input.
 *
 * **Details**
 *
 * It checks the input, records it through `Starts`, and checks that the receipt matches the input:
 * the same start, settings, build and repo, and the same origin when the input names one. Any
 * failure is a `StartsError`, and the layer does not build, so nothing that needs `RecordedStart`
 * runs.
 *
 * Recording the same start again answers the first receipt, so every object of one instance can
 * build this layer for the same input.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (input: Start.Input) =>
  Layer.effect(
    RecordedStart,
    Effect.gen(function* () {
      const checked = yield* SettingsInput.check(input).pipe(
        Effect.mapError((cause) => new StartsError({ reason: new Decode({ cause }) })),
      );
      const starts = yield* Starts;
      const receipt = yield* starts.record(checked.input);
      const saved = yield* SettingsInput.receipt(receipt, { ...checked.input, settings: checked.snapshot }).pipe(
        Effect.mapError((cause) => new StartsError({ reason: new Decode({ cause }) })),
      );

      return { ...checked, receipt: saved };
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );
