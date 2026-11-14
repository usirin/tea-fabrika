// T753, next/. Port bounds are held at the shared reader in SettingsInput.test.ts.
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import { Effect, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import { expect } from "vitest";
import { Settings } from "./settings.ts";

StartsTest.law(
  "the app transport accepts the shared start envelope without a second port",
  fc.tuple(StartsTest.recipe),
  ([recipe]) =>
    Effect.gen(function* () {
      const input = yield* StartsTest.input(recipe);
      const decoded = yield* Schema.decodeUnknownEffect(Settings)(input, { onExcessProperty: "error" });
      expect(decoded).toEqual(input);
      expect(Object.hasOwn(decoded, "port")).toBe(false);
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
);
