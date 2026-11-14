// T753, next/, L16. Exercise the scoped holder, including another entry on the same owner.
import { describe, expect } from "@effect/vitest";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope, ScopedCache } from "effect";
import * as fc from "fast-check";
import * as StartsTest from "../settings/StartsTest.ts";
import * as SettingsRuntime from "./SettingsRuntime.ts";

class Consumer extends Context.Service<Consumer, { readonly build: number }>()(
  "@kampus/libfabrika/cloudflare/SettingsRuntime.test.Consumer",
) {}

describe("L16 shared settings context, next/", () => {
  StartsTest.law(
    "reachable entries share successes, retry failed construction and release each attempt",
    fc.tuple(fc.array(fc.nat(), { minLength: 10, maxLength: 60 })),
    ([choices]) =>
      Effect.gen(function* () {
        let acquired = 0;
        let released = 0;
        let attempts = 0;
        let consumers = 0;
        let refuse = false;
        const ready = Layer.effect(
          Consumer,
          Effect.gen(function* () {
            const build = ++attempts;
            yield* Effect.acquireRelease(
              Effect.sync(() => ++acquired),
              () =>
                Effect.sync(() => {
                  released++;
                }),
            );

            if (refuse) {
              return yield* Effect.fail("append refused");
            }

            consumers++;
            return { build };
          }),
        );
        const open = Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
        let owner = yield* open;
        let holder = yield* SettingsRuntime.make(ready).pipe(Effect.provideService(Scope.Scope, owner));
        let saved: Context.Context<Consumer> | undefined;
        let expectedAttempts = 0;
        let expectedConsumers = 0;

        for (const choice of choices) {
          // A failure is reachable only before this owner's first successful construction.
          const moves =
            saved === undefined
              ? ["fail", "enter", "concurrent", "reopen"]
              : ["enter", "concurrent", "work-fails", "reopen"];
          const move = moves[choice % moves.length];

          if (move === "reopen") {
            yield* Scope.close(owner, Exit.void);
            expect(released).toBe(acquired);
            owner = yield* open;
            holder = yield* SettingsRuntime.make(ready).pipe(Effect.provideService(Scope.Scope, owner));
            saved = undefined;
            continue;
          }

          refuse = move === "fail";
          const before = attempts;
          const entries = move === "concurrent" ? 2 + (choice % 7) : 1;
          const results = yield* Effect.forEach(
            Array.from({ length: entries }),
            () => Effect.exit(ScopedCache.get(holder, undefined)),
            { concurrency: "unbounded" },
          );

          if (saved === undefined) {
            expectedAttempts++;
          }

          if (refuse) {
            expect(results.every(Exit.isFailure)).toBe(true);
            expect(consumers).toBe(expectedConsumers);
            expect(released).toBe(acquired);
          } else {
            if (saved === undefined) {
              expectedConsumers++;
            }

            for (const result of results) {
              expect(Exit.isSuccess(result)).toBe(true);

              if (Exit.isSuccess(result)) {
                saved ??= result.value;
                expect(result.value).toBe(saved);
                expect(Context.get(result.value, Consumer).build).toBe(before + (attempts > before ? 1 : 0));
              }
            }

            if (move === "work-fails") {
              yield* Effect.exit(Effect.fail("later operation failed").pipe(Effect.provideContext(saved!)));
              expect(yield* ScopedCache.get(holder, undefined)).toBe(saved);
            }
          }

          expect(attempts).toBe(expectedAttempts);
          expect(consumers).toBe(expectedConsumers);
        }

        yield* Scope.close(owner, Exit.void);
        expect(released).toBe(acquired);
      }),
  );

  StartsTest.law(
    "concurrent first entries wait for acknowledgement and do not capture an event scope",
    fc.tuple(fc.integer({ min: 2, max: 12 })),
    ([total]) =>
      Effect.gen(function* () {
        const pending = yield* Deferred.make<void>();
        const entered = yield* Deferred.make<void>();
        let builds = 0;
        let released = 0;
        const owner = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void));
        const ready = Layer.effect(
          Consumer,
          Effect.gen(function* () {
            builds++;
            yield* Effect.acquireRelease(Effect.void, () =>
              Effect.sync(() => {
                released++;
              }),
            );
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(pending);
            return { build: builds };
          }),
        );
        const holder = yield* SettingsRuntime.make(ready).pipe(Effect.provideService(Scope.Scope, owner));
        const fibers = yield* Effect.forEach(
          Array.from({ length: total }),
          () => Effect.scoped(ScopedCache.get(holder, undefined)).pipe(Effect.forkChild),
          { concurrency: 1 },
        );
        yield* Deferred.await(entered);

        for (const fiber of fibers) {
          expect(fiber.pollUnsafe()).toBeUndefined();
        }

        expect(builds).toBe(1);
        yield* Deferred.succeed(pending, undefined);
        const contexts = yield* Effect.forEach(fibers, Fiber.join, { concurrency: "unbounded" });

        for (const context of contexts) {
          expect(context).toBe(contexts[0]);
        }

        expect(released).toBe(0);
        expect(yield* ScopedCache.get(holder, undefined)).toBe(contexts[0]);
        yield* Scope.close(owner, Exit.void);
        expect(released).toBe(1);
      }),
  );
});
