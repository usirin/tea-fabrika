// Shared Effect patch: today's version and next/.
import { createHash } from "node:crypto";
import { Arbitrary, Effect, Exit, Schema } from "effect";
import fc from "fast-check";
import { expect, it } from "vitest";

const text = Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(4096));
const strings = Arbitrary.schema(text);
const seed = fc.integer();
const options = { seed: 119120, runs: 300, size: 4096, concurrency: 1 };
const outer = { seed: 119120, numRuns: 10 };

const CodeCases = Arbitrary.all({
  lines: Arbitrary.array(Arbitrary.schema(text), { minLength: 0, maxLength: 8 }),
  suffix: Arbitrary.schema(Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(96))),
});

const counter = Effect.acquireRelease(
  Effect.sync(() => {
    const saved = String.fromCharCode;
    const count = { calls: 0, saved };
    String.fromCharCode = (...codes) => {
      count.calls++;
      return saved(...codes);
    };
    return count;
  }),
  (count) =>
    Effect.sync(() => {
      String.fromCharCode = count.saved;
    }),
);

// Plant L1: stock Effect eagerly builds candidates (lead runs outside the box).
it("L1 passing checks build no shrink candidates", () =>
  fc.assert(
    fc.property(seed, (seed) =>
      Effect.runSync(
        Effect.gen(function* () {
          const count = yield* counter;
          let units = 0;
          const result = yield* Arbitrary.checkEffect(
            strings,
            (s) => {
              units += s.length;
              return true;
            },
            { ...options, seed, runs: 20 },
          );
          expect(result._tag).toBe("Passed");
          expect(count.calls).toBeLessThanOrEqual(units);
        }).pipe(Effect.scoped),
      ),
    ),
    outer,
  ));

// Plant L1b: wrap String.raw instead, leaving the counter dead for this generator.
it("L1b the shrink counter is live", () =>
  fc.assert(
    fc.property(seed, (seed) =>
      Effect.runSync(
        Effect.gen(function* () {
          const count = yield* counter;
          const result = yield* Arbitrary.checkEffect(
            Arbitrary.schema(Schema.String.check(Schema.isMinLength(64), Schema.isMaxLength(512))),
            (s) => s.length < 64,
            { ...options, seed },
          );
          expect(result._tag).toBe("Falsified");

          if (result._tag === "Falsified") {
            expect(count.calls).toBeGreaterThan(result.initialInput.length);
          }
        }).pipe(Effect.scoped),
      ),
    ),
    outer,
  ));

// Plant L2: return undefined from the lazy shrink closure (lead runs outside the box).
it("L2 shrinking reaches the failing length", () =>
  fc.assert(
    fc.property(seed, fc.integer({ min: 1, max: 64 }), (seed, k) =>
      Effect.runSync(
        Effect.gen(function* () {
          const result = yield* Arbitrary.checkEffect(strings, (s) => s.length < k, { ...options, seed });
          expect(result._tag).toBe("Falsified");

          if (result._tag === "Falsified") {
            expect(result.shrunkInput.length).toBe(k);
          }
        }),
      ),
    ),
    outer,
  ));

// Plant L3: replace the generated value with its first shrink (lead runs outside the box).
// vector: stock and patched Effect 4.1.2 measured identically; re-pin only when dropping the patch.
it("vector: L3 generated cases and shrink paths stay unchanged", () =>
  Effect.runSync(
    Effect.gen(function* () {
      const values: Array<{ lines: Array<string>; suffix: string }> = [];
      const result = yield* Arbitrary.checkEffect(
        CodeCases,
        (c) => {
          values.push(c);
          return true;
        },
        options,
      );
      expect(result._tag).toBe("Passed");
      expect(values).toHaveLength(300);
      expect(values.reduce((n, c) => n + c.lines.reduce((n, s) => n + s.length, 0) + c.suffix.length, 0)).toBe(955431);
      expect(
        createHash("sha256")
          .update(JSON.stringify(values.map((c) => ({ c }))))
          .digest("hex")
          .slice(0, 16),
      ).toBe("ed2eda1836897dbf");

      for (const [k, shrinks] of [
        [1, 5],
        [5, 8],
        [17, 27],
        [64, 28],
      ] as const) {
        const result = yield* Arbitrary.checkEffect(strings, (s) => s.length < k, options);
        expect(result._tag).toBe("Falsified");

        if (result._tag === "Falsified") {
          expect(result.shrunkInput.length).toBe(k);
          expect(result.shrinks).toBe(shrinks);
        }
      }
    }),
  ));

// Plant L4: remove release and restore only after the throwing run, which is unreachable.
// scenario: an assertion throws inside a wrapped property; the scope must still restore the global.
it("scenario: L4 throwing properties restore the global", () =>
  Effect.runSync(
    Effect.gen(function* () {
      const saved = String.fromCharCode;
      const exit = yield* Effect.gen(function* () {
        yield* counter;
        const result = yield* Arbitrary.checkEffect(
          strings,
          () => {
            // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- scenario deliberately tests a throwing property and scope release.
            throw new Error("planted property failure");
          },
          options,
        );
        expect(result._tag).toBe("Passed");
      }).pipe(Effect.scoped, Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(String.fromCharCode).toBe(saved);
    }),
  ));
