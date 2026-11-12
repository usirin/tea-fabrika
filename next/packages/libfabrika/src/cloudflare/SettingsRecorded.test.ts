// T753, next/, L4 and L14. RecordedStart is granted only after the checked append succeeds.
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import { RecordedStart } from "../settings/RecordedStart.ts";
import * as Starts from "../settings/Starts.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { recordingLayer } from "./runtime.ts";
import * as SettingsRecorded from "./SettingsRecorded.ts";

class Consumer extends Context.Service<Consumer, { readonly port: number }>()(
  "@kampus/libfabrika/cloudflare/SettingsRecorded.test.Consumer",
) {}

describe("recorded settings dependency, next/", () => {
  StartsTest.law(
    "L4 a refused or failed append never supplies consumers, including concurrent entries",
    fc.tuple(StartsTest.recipe, fc.array(fc.nat(), { minLength: 8, maxLength: 30 }), Schema.Json),
    ([recipe, choices, detail]) =>
      Effect.gen(function* () {
        const input = yield* StartsTest.input(recipe);
        let constructed = 0;
        let called = 0;
        let reason: Starts.Refused | Starts.Storage | Starts.Unreachable = new Starts.Refused({ cause: detail });
        const starts = Layer.succeed(Starts.Starts, {
          record: () =>
            Effect.suspend(() => {
              called++;
              return Effect.fail(new Starts.StartsError({ reason }));
            }),
          read: () =>
            Effect.fail(
              new Starts.StartsError({
                reason: new Starts.Missing({
                  target: Starts.MissingTarget.cases.instance.make({ start: input.start }),
                }),
              }),
            ),
        });
        const recorded = SettingsRecorded.layer(input).pipe(Layer.provide(starts));
        const consumer = Layer.effect(
          Consumer,
          Effect.gen(function* () {
            const checked = yield* RecordedStart;
            constructed++;
            return { port: checked.values.port };
          }),
        ).pipe(Layer.provide(recorded));

        for (const choice of choices) {
          // Each new build is an attempted entry; failure cuts target its next record call.
          reason =
            choice % 3 === 0
              ? new Starts.Refused({ cause: detail })
              : choice % 3 === 1
                ? new Starts.Storage({ cause: detail })
                : new Starts.Unreachable({ cause: detail });
          const exits = yield* Effect.forEach(
            Array.from({ length: 1 + (choice % 5) }),
            () => Effect.scoped(Effect.exit(Layer.build(consumer))),
            { concurrency: "unbounded" },
          );
          expect(exits.every(Exit.isFailure)).toBe(true);
          expect(constructed).toBe(0);
          expect(called).toBeGreaterThan(0);
        }
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );

  StartsTest.law(
    "L4 withholding the ledger answer withholds both RecordedStart and consumer construction",
    fc.tuple(StartsTest.recipe, fc.integer({ min: 2, max: 8 })),
    ([recipe, total]) =>
      Effect.gen(function* () {
        const input = yield* StartsTest.input(recipe);
        const reached = yield* Deferred.make<void>();
        const acknowledgement = yield* Deferred.make<never, Starts.StartsError>();
        let constructed = 0;
        const starts = Layer.succeed(Starts.Starts, {
          record: () => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Deferred.await(acknowledgement))),
          read: () => Deferred.await(acknowledgement),
        });
        const recorded = SettingsRecorded.layer(input).pipe(Layer.provide(starts));
        const ready = Layer.effect(
          Consumer,
          Effect.gen(function* () {
            const checked = yield* RecordedStart;
            constructed++;
            return { port: checked.values.port };
          }),
        ).pipe(Layer.provide(recorded));
        const fibers = yield* Effect.forEach(
          Array.from({ length: total }),
          () => Effect.scoped(Layer.build(ready)).pipe(Effect.forkChild),
          { concurrency: 1 },
        );
        yield* Deferred.await(reached);
        expect(constructed).toBe(0);

        for (const fiber of fibers) {
          expect(fiber.pollUnsafe()).toBeUndefined();
        }

        yield* Deferred.fail(
          acknowledgement,
          new Starts.StartsError({ reason: new Starts.Refused({ cause: "append not placed" }) }),
        );
        const exits = yield* Effect.forEach(fibers, Fiber.await, { concurrency: "unbounded" });
        expect(exits.every(Exit.isFailure)).toBe(true);
        expect(constructed).toBe(0);
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );

  it("format: L14 consumer Layer requirements and declared value types are compiler checked", () => {
    // Type law: the lead's typecheck catches removal of RecordedStart even if no consumer is run.
    expectTypeOf<
      Extract<Layer.Services<ReturnType<typeof recordingLayer>>, RecordedStart>
    >().toEqualTypeOf<RecordedStart>();
    expectTypeOf<RecordedStart["Service"]["values"]["port"]>().toEqualTypeOf<number>();
    expectTypeOf<RecordedStart["Service"]["values"]["version"]>().toEqualTypeOf<string>();
  });
});
