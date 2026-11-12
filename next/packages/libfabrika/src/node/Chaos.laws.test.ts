// next/, P17b. Pure laws for the test controller, independent of the not-yet-built hook.
import { applyCell } from "@demlik/tea";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { syncTest } from "../Testing.ts";
import * as StepFaultTest from "./stepFault.test-support.ts";

const moves = Arbitrary.array(
  Arbitrary.all({
    pick: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
    error: Arbitrary.schema(StepFaultTest.ErrorClass),
  }),
  { minLength: 8, maxLength: 60 },
);

it.prop(
  "the fault controller charges only fresh attempts of its stable letter and survives every saved cut",
  [moves],
  ([moves]) => {
    expect.hasAssertions();
    let [model] = StepFaultTest.controller.init(null, {});
    const msgs: Array<typeof StepFaultTest.Msg.Type> = [];

    for (const { pick, error } of moves) {
      const msg: typeof StepFaultTest.Msg.Type =
        model._tag === "off" || model.attempts.length === model.errors.length
          ? {
              type: "arm",
              name: "checklist:1",
              letter: `letter-${pick}`,
              errors: Array.from({ length: pick % 2 === 0 ? 1 : 3 }, () => error),
            }
          : {
              type: "before",
              name: pick % 7 === 0 ? "unrelated" : model.name,
              letter: pick % 5 === 0 ? "other-letter" : model.letter,
              process: `process-${pick}`,
              phase: pick % 3 === 0 ? "saved" : "fresh",
            };
      const previous = model;
      [model] = applyCell(StepFaultTest.controller, model, msg);
      msgs.push(msg);

      if (previous._tag === "armed" && model._tag === "armed" && msg.type === "before") {
        const charge =
          msg.phase === "fresh" &&
          msg.name === previous.name &&
          msg.letter === previous.letter &&
          previous.attempts.length < previous.errors.length;
        expect(model.attempts.length).toBe(previous.attempts.length + (charge ? 1 : 0));
        expect(model.attempts.slice(0, previous.attempts.length)).toEqual(previous.attempts);
      }
    }

    syncTest(
      StepFaultTest.controller,
      {},
      {
        msgs,
        encode: Schema.encodeSync(StepFaultTest.Model),
        decode: Schema.decodeUnknownSync(StepFaultTest.Model),
        equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        seed: 119120,
      },
    );
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
