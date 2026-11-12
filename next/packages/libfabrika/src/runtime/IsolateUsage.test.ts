// next/, U2 and U10. U4/U5's unknown platform words are exercised at the tail entrypoint.
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Schema, Tracer } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import * as IsolateUsage from "./IsolateUsage.ts";

const PROCESS = "process_0000000000e008000000000001";
const methods = ["describe", "init", "step", "fold", "upgrade", "reply", "admit", "check", "other"] as const;
const outcomes = ["ok", "exception", "exceededCpu", "exceededMemory", "canceled", "other"] as const;

// Deliberately different and independently drawn: copying either clock into the other must fail.
const times = fc
  .tuple(
    fc.oneof(fc.constant(0), fc.double({ min: 0, max: 30_000, noNaN: true })),
    fc.double({ min: 0, max: 30_000, noNaN: true }),
  )
  .filter(([cpu, wall]) => cpu !== wall);

// fast-check draws the unequal clocks and invalid wire values beyond the domain Schema.
it("U2 a usage span lasts its CPU time and keeps wall time separately, including zero CPU", () =>
  fc.assert(
    fc.asyncProperty(
      fc.record({
        times,
        method: fc.constantFrom(...methods),
        outcome: fc.constantFrom(...outcomes),
      }),
      ({ times: [cpuMs, wallMs], method, outcome }) =>
        // edge: fast-check awaits each scoped Effect property
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const spans: Array<Tracer.NativeSpan> = [];
              const tracer = Tracer.make({
                span: (options) => {
                  const span = new Tracer.NativeSpan(options);
                  spans.push(span);
                  return span;
                },
              });
              const usage = Schema.decodeUnknownSync(IsolateUsage.Usage)({
                process: PROCESS,
                method,
                cpuMs,
                wallMs,
                outcome,
              });
              yield* IsolateUsage.record([usage]).pipe(Effect.withTracer(tracer));
              expect(spans).toHaveLength(1);
              const span = spans[0];
              expect(span?.name).toBe("isolate.cpu");
              expect(span?.status._tag).toBe("Ended");

              if (span?.status._tag !== "Ended") {
                return yield* Effect.die("the usage span never ended");
              }

              expect(Number(span.status.endTime - span.status.startTime) / 1_000_000).toBeCloseTo(cpuMs, 5);
              expect(Exit.isSuccess(span.status.exit)).toBe(true);
              expect(Object.fromEntries(span.attributes)).toEqual({
                "fab.process": PROCESS,
                "fab.isolate.method": method,
                "fab.isolate.wall_ms": wallMs,
                "fab.isolate.outcome": outcome,
              });
            }),
          ),
        ),
    ),
    { seed: 119120 },
  ));

it("U10 schemas reject unknown words, negative and nonfinite times", () =>
  fc.assert(
    fc.property(
      fc.record({
        word: fc
          .string()
          .filter((word) => !methods.some((known) => known === word) && !outcomes.some((known) => known === word)),
        invalid: fc.oneof(
          fc.double({ max: -Number.MIN_VALUE, noNaN: true }),
          fc.constantFrom(Number.NaN, Infinity, -Infinity),
        ),
      }),
      ({ word, invalid }) => {
        expect(Schema.is(IsolateUsage.Method)(word)).toBe(false);
        expect(Schema.is(IsolateUsage.Outcome)(word)).toBe(false);
        const valid = { process: PROCESS, method: "step", outcome: "ok", cpuMs: 0, wallMs: 0 };
        expect(Schema.is(IsolateUsage.Usage)(valid)).toBe(true);
        expect(Schema.is(IsolateUsage.Usage)({ ...valid, method: word })).toBe(false);
        expect(Schema.is(IsolateUsage.Usage)({ ...valid, outcome: word })).toBe(false);
        expect(Schema.is(IsolateUsage.Usage)({ ...valid, cpuMs: invalid })).toBe(false);
        expect(Schema.is(IsolateUsage.Usage)({ ...valid, wallMs: invalid })).toBe(false);
      },
    ),
    { seed: 119120 },
  ));

// format: these exact closed wire types are checked by CI, even if no test executes.
it("format: U10 Method, Outcome and Usage keep their closed wire types", () => {
  expectTypeOf<typeof IsolateUsage.Method.Type>().toEqualTypeOf<(typeof methods)[number]>();
  expectTypeOf<typeof IsolateUsage.Outcome.Type>().toEqualTypeOf<(typeof outcomes)[number]>();
  expectTypeOf<typeof IsolateUsage.Usage.Type>().toEqualTypeOf<{
    readonly process: string;
    readonly method: (typeof methods)[number];
    readonly outcome: (typeof outcomes)[number];
    readonly cpuMs: number;
    readonly wallMs: number;
  }>();
});
