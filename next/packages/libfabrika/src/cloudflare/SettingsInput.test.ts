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
    "L3 the shared reader accepts exactly integer ports from 1 through 65535",
    // Push both sides of the declaration's range, including fractions, infinities and NaN.
    fc.oneof(fc.integer({ min: 1, max: 65535 }), fc.integer(), fc.double()),
    (port) =>
      Effect.gen(function* () {
        const valid = Number.isInteger(port) && port >= 1 && port <= 65535;
        const input = yield* StartsTest.input({
          port: valid ? port : 18787,
          start: "port-boundary",
          build: "port-build",
          revision: null,
          origin: "flag",
        });
        const raw = valid
          ? input
          : { ...input, settings: { ...input.settings, values: { ...input.settings.values, "instance.port": port } } };
        const exit = yield* Effect.exit(
          SettingsInput.read.pipe(Effect.provideService(WorkerEnvironment, { INSTANCE: JSON.stringify(raw) })),
        );
        expect(Exit.isSuccess(exit)).toBe(valid);

        if (Exit.isSuccess(exit)) {
          expect(exit.value.values.port).toBe(port);
        }
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
    // vector: the port protocol's inclusive endpoints and their immediate neighbours.
    [[1], [65535], [0], [65536]],
  );

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
