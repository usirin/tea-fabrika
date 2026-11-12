import { Effect, Layer } from "effect";
import { Digest } from "effect/crypto";
import { RecordedStart } from "../settings/RecordedStart.ts";
import type * as Start from "../settings/Start.ts";
import { Decode, Starts, StartsError } from "../settings/Starts.ts";
import * as SettingsInput from "./SettingsInput.ts";

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
