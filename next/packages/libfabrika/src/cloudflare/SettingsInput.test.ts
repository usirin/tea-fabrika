// T753, next/, L3 and L10 [secrets]. The Worker reads only INSTANCE through Alchemy.
import { WorkerEnvironment } from "@alchemy.run/cloudflare/Workers/WorkerRuntime";
import { describe, expect } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import * as StartsTest from "../settings/StartsTest.ts";
import * as SettingsInput from "./SettingsInput.ts";

describe("shared Worker settings reader, next/", () => {
  StartsTest.law(
    "L3 deployment, corruption and repeat delivery check complete snapshots every time",
    fc.tuple(StartsTest.recipe, fc.array(fc.nat(), { minLength: 10, maxLength: 50 }), StartsTest.sentinel),
    ([initial, choices, secret]) =>
      Effect.gen(function* () {
        let current = yield* StartsTest.input(initial);

        for (const [index, choice] of choices.entries()) {
          const moves = ["valid", "corrupt", "deploy", "repeat"];
          const move = moves[choice % moves.length];

          if (move === "deploy") {
            current = yield* StartsTest.input({
              ...initial,
              start: `${initial.start}-${index}`,
              port: (choice % 65535) + 1,
            });
            continue;
          }

          const raw =
            move === "corrupt" ? StartsTest.corrupt(current, Math.floor(choice / moves.length), secret) : current;
          const exit = yield* Effect.exit(
            SettingsInput.read.pipe(
              Effect.provideService(WorkerEnvironment, {
                INSTANCE: JSON.stringify(raw),
                UNRELATED_PASSWORD: secret,
              }),
            ),
          );
          expect(Exit.isSuccess(exit)).toBe(move !== "corrupt");

          if (Exit.isSuccess(exit)) {
            expect(exit.value.snapshot).toEqual(current.settings);
            expect(exit.value.values).toEqual({ port: current.settings.values["instance.port"], version: "0.0.0" });
            StartsTest.exclude(exit.value, secret);
          }
        }
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );
});
