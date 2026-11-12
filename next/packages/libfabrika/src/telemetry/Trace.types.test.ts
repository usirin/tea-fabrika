import { expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Trace from "./Trace.ts";

const types = () => {
  expectTypeOf<Trace.SumPoint["refused"]>().toEqualTypeOf<"reserved" | "other">();
  expectTypeOf<Trace.Refused>().toEqualTypeOf<"reserved" | "other">();
  const invalid: Trace.SumPoint = {
    _tag: "sum",
    piece: "gateway.route",
    hour: 0,
    count: 1,
    // @ts-expect-error the refusal split is closed, so arbitrary strings cannot create rows
    refused: "unbounded",
  };
  return invalid;
};

it.prop(
  "SumPoint accepts only the two closed refusal values",
  { value: Schema.String },
  ({ value }) => {
    expectTypeOf(types).toBeFunction(); // CI checks the uncalled type law.
    expect(Trace.SumPoint).toBeDefined();
    expect(Schema.is(Trace.SumPoint)({ _tag: "sum", piece: "gateway.route", hour: 0, count: 1, refused: value })).toBe(
      value === "reserved" || value === "other",
    );
    expect(Schema.is(Trace.Refused)("reserved")).toBe(true);
    expect(Schema.is(Trace.Refused)("other")).toBe(true);
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
