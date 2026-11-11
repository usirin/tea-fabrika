// P39 slice 1, L1 and L8 on the job's own schemas. L1: every fact a request, an executor, a result
// and a writer's record carry comes back from its JSON form, field for field. L8: one field made
// invalid, or left out, is refused at decoding. The values are generated; the database half of both
// laws is in `JobsTest.ts`.
import { describe, expect, it } from "@effect/vitest";
import { Result as R, Schema } from "effect";
import * as fc from "fast-check";
import { Executor, Recorded, Request, Result } from "./Job.ts";
import {
  BAD_EXECUTOR,
  BAD_RECORDED,
  BAD_REQUEST,
  broken,
  brokenResult,
  fcExecutor,
  fcFingerprint,
  fcRecorded,
  fcRequest,
  fcResult,
} from "./JobsTest.ts";

const RUNS = { seed: 119120, numRuns: 100 };

/** Encode, write as JSON text, read it back and decode, as a value crosses a store or a wire. */
const through = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: S["Type"]) =>
  Schema.decodeUnknownResult(schema)(JSON.parse(JSON.stringify(Schema.encodeSync(schema)(value))));

const Values = fc.uniqueArray(fcFingerprint, { minLength: 2, maxLength: 3 }).chain((keys) =>
  fc.record({
    request: fcRequest(keys),
    executor: fcExecutor(keys),
    result: fcResult,
    recorded: fcRecorded.chain((said) => fc.nat().map((seen) => ({ ...said, seen }))),
    pick: fc.nat(),
  }),
);

describe("P39 slice 1: the job's schemas", () => {
  it("L1: a request, an executor, a result and a writer's record keep every field through JSON", () => {
    fc.assert(
      fc.property(Values, ({ request, executor, result, recorded }) => {
        for (const [schema, value] of [
          [Request, request],
          [Executor, executor],
          [Result, result],
          [Recorded, recorded],
        ] as const) {
          const back = through(schema as Schema.Codec<unknown, unknown>, value);
          expect(R.isSuccess(back), `decodes: ${JSON.stringify(value)}`).toBe(true);
          // Every key the caller gave comes back with its value: none dropped, none renamed.
          expect(R.getOrThrow(back)).toEqual(value);
          expect(Object.keys(R.getOrThrow(back) as object).sort()).toEqual(Object.keys(value).sort());
        }
      }),
      RUNS,
    );
  });

  it("L8: one invalid or missing field of a request, an executor, a result or a record is refused", () => {
    fc.assert(
      fc.property(Values, ({ request, executor, result, recorded, pick }) => {
        const cases: ReadonlyArray<readonly [Schema.Codec<unknown, unknown>, unknown]> = [
          [Request as Schema.Codec<unknown, unknown>, broken(request, pick, BAD_REQUEST)],
          [Executor as Schema.Codec<unknown, unknown>, broken(executor, pick, BAD_EXECUTOR)],
          [Result as Schema.Codec<unknown, unknown>, brokenResult(result, pick)],
          [Recorded as Schema.Codec<unknown, unknown>, broken(recorded, pick, BAD_RECORDED)],
        ];

        for (const [schema, bad] of cases) {
          expect(R.isFailure(Schema.decodeUnknownResult(schema)(bad)), `refused: ${JSON.stringify(bad)}`).toBe(true);
        }
      }),
      RUNS,
    );
  });
});
