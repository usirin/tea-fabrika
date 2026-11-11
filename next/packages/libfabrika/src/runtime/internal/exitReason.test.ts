// P34c slice 1, L4's producer half: each failure the runner already captured maps to one crash
// phase, keeping its captured class whole. The expected reason comes from the fixture's own schema.
import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { fcProcessIds } from "../../Id.test-support.ts";
import { ERROR_CLASS_MAX, ExitReason, fcErrorClass } from "../../processes/Process.test-support.ts";
import { fromFailure } from "./exitReason.ts";
import { Failure } from "./recovery.ts";

const attempt = fc.record({
  process: fcProcessIds,
  letter: fc.string({ minLength: 1, maxLength: 40 }),
  build: fc.string({ minLength: 1, maxLength: 40 }),
  seq: fc.integer({ min: 1, max: 1_000 }),
});

const error = fc.oneof(
  fcErrorClass,
  fc.integer({ min: 1, max: ERROR_CLASS_MAX + 64 }).map((n) => "E".repeat(n)),
);

const failure = fc.oneof(
  fc.tuple(attempt, error).map(([fields, error]) => Failure.cases.fresh.make({ ...fields, error })),
  fc.tuple(attempt, error).map(([fields, error]) => Failure.cases.saved.make({ ...fields, error })),
  attempt.map((fields) => Failure.cases.interrupted.make(fields)),
);

const valid = Schema.is(ExitReason);

describe("P34c slice 1: a captured failure becomes one exit reason", () => {
  it("L4: fresh is step, saved is saved_letter, interrupted has no class; a class is kept whole, never cut to fit", () => {
    fc.assert(
      fc.property(failure, (failure) => {
        const expected =
          failure._tag === "interrupted"
            ? { _tag: "crashed", phase: "interrupted" }
            : { _tag: "crashed", phase: failure._tag === "fresh" ? "step" : "saved_letter", error: failure.error };
        const reason = Result.try(() => fromFailure(failure));
        const inBound = failure._tag === "interrupted" || failure.error.length <= ERROR_CLASS_MAX;
        // Inside the bound the reason is exact. Past it, the class is refused here or kept whole for
        // the exit boundary to refuse; it is never cut to a valid reason.
        expect(Result.isSuccess(reason) || !inBound, "a class inside the bound maps").toBe(true);
        expect(Result.isSuccess(reason) ? reason.success : expected).toEqual(expected);
        expect(Result.isSuccess(reason) && valid(reason.success)).toBe(inBound);
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
});
