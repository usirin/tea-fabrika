// T695, next/. The ID generator keeps the failure behind an `entropy` IdError (decision 0043 rule
// 12). Audit site: `Id.ts:198`, a throw while drawing random bits. `Id.ts:183` decodes an ID the
// generator built from its own registered prefix, which no generated input can make fail.
import { describe, expect, it, vi } from "@effect/vitest";
import { Duration, Effect } from "effect";
import * as fc from "fast-check";
import * as Id from "./Id.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats

const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new DOMException(message, "QuotaExceededError")),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

const prefixes = fc.constantFrom("process", "input", "letter", "chaos");

/** The random source throws `failure`, as a platform with no entropy left does. */
const randomThrows = (failure: unknown) =>
  vi.spyOn(crypto, "getRandomValues").mockImplementation(() => {
    throw failure;
  });

describe("T695, Id.Generator keeps why it could not draw an ID", () => {
  // C1, Id.ts:198. Plant: `catch: (error) => error instanceof IdError ? error : new IdError({ reason: "entropy" })`.
  it("C1: a generated throw from the random source is `entropy` with the thrown value as its cause", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({ failure: failures, prefix: prefixes, before: fc.nat({ max: 3 }) }),
        ({ failure, prefix, before }) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const schema = Id.make(prefix);
              const ids = yield* Id.Generator;

              // A few good IDs first, so the failure meets a generator already in use.
              for (let n = 0; n < before; n++) {
                yield* ids.next(schema);
              }

              yield* Effect.sleep(Duration.millis(1));
              const error = yield* Effect.flip(
                Effect.acquireUseRelease(
                  Effect.sync(() => randomThrows(failure)),
                  () => ids.next(schema),
                  (spy) => Effect.sync(() => spy.mockRestore()),
                ),
              );
              expect(error).toBeInstanceOf(Id.IdError);
              expect(error.reason).toBe("entropy");
              expect(error.cause).toBe(failure);
            }).pipe(Effect.provide(Id.Generator.layer)),
          ),
      ),
      { seed: SEED, numRuns: 100 },
    );
  });
});
