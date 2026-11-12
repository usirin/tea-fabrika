import { applyCell } from "@demlik/tea";
import { expect, it } from "@effect/vitest";
// next/, P17b. The app composes the real checklist and both suites (0062, amendment A2).
import * as RunnerTest from "@kampus/chaos/RunnerTest";
import * as TargetsTest from "@kampus/chaos/TargetsTest";
import { checklist } from "@kampus/checklist";
import * as ChaosTest from "@kampus/libfabrika/node/Chaos.test-support";
import { syncTest } from "@kampus/libfabrika/testing";
import { Arbitrary, Schema } from "effect";
import * as RevokeHold from "../e2e/chaos-revoke.test-support.ts";

RunnerTest.suite(ChaosTest.open, checklist);
TargetsTest.suite(ChaosTest.open, checklist);

it.prop(
  "the hold controller admits one matching request and preserves every saved cut",
  [
    Arbitrary.array(Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))), {
      minLength: 12,
      maxLength: 60,
    }),
  ],
  ([choices]) => {
    let [model] = RevokeHold.controller.init(null, {});
    const msgs: Array<typeof RevokeHold.Msg.Type> = [];
    let held = 0;

    for (const pick of choices) {
      const msg: typeof RevokeHold.Msg.Type =
        model._tag === "idle"
          ? { type: "arm", process: `process-${pick}` }
          : model._tag === "armed"
            ? pick % 7 === 0
              ? { type: "release" }
              : {
                  type: "arrive",
                  process: pick % 3 === 0 ? "unrelated" : model.process,
                }
            : model._tag === "held"
              ? pick % 2 === 0
                ? { type: "release" }
                : { type: "arrive", process: model.process }
              : { type: "arm", process: `later-${pick}` };
      const previous = model;
      [model] = applyCell(RevokeHold.controller, model, msg);
      msgs.push(msg);
      const enters = previous._tag === "armed" && msg.type === "arrive" && previous.process === msg.process;

      if (previous._tag !== "held" && model._tag === "held") {
        held++;
      }

      expect(held).toBeLessThanOrEqual(1);

      if (enters) {
        expect(model).toEqual(RevokeHold.Model.cases.held.make({ process: msg.process }));
      } else if (previous._tag === "idle" && msg.type === "arm") {
        expect(model).toEqual(RevokeHold.Model.cases.armed.make({ process: msg.process }));
      } else if (msg.type === "release" && (previous._tag === "armed" || previous._tag === "held")) {
        expect(model).toEqual(RevokeHold.Model.cases.released.make({ process: previous.process }));
      } else if (previous._tag !== "idle") {
        expect(model).toEqual(previous);
      }
    }

    syncTest(
      RevokeHold.controller,
      {},
      {
        msgs,
        encode: Schema.encodeSync(RevokeHold.Model),
        decode: Schema.decodeUnknownSync(RevokeHold.Model),
        equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        seed: 119120,
      },
    );
  },
  { arbitrary: { seed: 119120, runs: 100 } },
);
