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
 * The layer that puts an instance start on record and hands it on as `RecordedStart`.
 *
 * @stability unstable
 */
import { Effect, Layer } from "effect";
import { Digest } from "effect/crypto";
import { RecordedStart } from "../settings/RecordedStart.ts";
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
    Effect.gen(function* () {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
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
