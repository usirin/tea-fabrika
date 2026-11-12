// P19 next/. L1/L2 policy is checked at the driver; these laws own pure correlation and saved cuts.
// The public factory takes { spec, settings }; Cmd replies follow tea's settled reply protocol.
import { applyCell } from "@demlik/tea";
import { arbGuidedSequence, propertyInvariant, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { syncTest } from "../Testing.ts";
import * as Outside from "./BrainControl.test-support.ts";
import { Status } from "./BrainControl.ts";
import * as BrainLife from "./BrainLife.ts";
import { Readiness, Children } from "./BrainProbe.ts";
import * as ServiceTest from "./BrainServiceTest.ts";

const options = { seed: 119120, numRuns: 150 };
const ctx = stubCtxThrowingProxy<unknown>();

const walks = (
  machine: ReturnType<typeof BrainLife.machine>,
  status: typeof Status.Type,
  ready: typeof Readiness.Type,
  cleanup: typeof Children.Type,
) =>
  arbGuidedSequence(
    machine,
    ctx,
    {
      outside: {
        up: fc.constant({ type: "up" as const, at: 0 }),
        stop: fc.constant({ type: "stop" as const, at: 0 }),
        tick: fc.record({ type: fc.constant("tick" as const), at: fc.integer({ min: 0, max: 100_000 }) }),
      },
      answers: {
        inspect: {
          draw: fc.constant(status),
          make: (cmd, value) => ({ type: "inspect_ok" as const, cmd, value, at: 0 }),
        },
        install: {
          draw: fc.constant(null),
          make: (cmd, value) => ({ type: "install_ok" as const, cmd, value, at: 0 }),
        },
        start: { draw: fc.constant(null), make: (cmd, value) => ({ type: "start_ok" as const, cmd, value, at: 0 }) },
        stop: { draw: fc.constant(null), make: (cmd, value) => ({ type: "stop_ok" as const, cmd, value, at: 0 }) },
        ready: { draw: fc.constant(ready), make: (cmd, value) => ({ type: "ready_ok" as const, cmd, value, at: 0 }) },
        cleanup: {
          draw: fc.constant(cleanup),
          make: (cmd, value) => ({ type: "cleanup_ok" as const, cmd, value, at: 0 }),
        },
        remove: { draw: fc.constant(null), make: (cmd, value) => ({ type: "remove_ok" as const, cmd, value, at: 0 }) },
      },
    },
    { maxLength: 80, size: "max" },
  );

describe("P19 lifecycle", () => {
  it.effect.prop(
    "L8 every reached save/load cut preserves later Model and Cmd decisions",
    [Status, Readiness, Children],
    ([status, ready, cleanup]) =>
      Effect.gen(function* () {
        const settings = yield* ServiceTest.timing();
        const machine = BrainLife.machine({ spec: Outside.spec, settings });
        fc.assert(
          fc.property(walks(machine, status, ready, cleanup), (msgs) => {
            syncTest(machine, ctx, {
              msgs,
              encode: Schema.encodeSync(BrainLife.Model),
              decode: Schema.decodeUnknownSync(BrainLife.Model),
              equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
              seed: 119120,
            });
          }),
          { ...options, numRuns: 1 },
        );
      }),
    { arbitrary: options },
  );

  it.effect.prop(
    "L4 an older command identity cannot change any reached pending state",
    [Status, Readiness, Children],
    ([status, ready, cleanup]) =>
      Effect.gen(function* () {
        const settings = yield* ServiceTest.timing();
        const machine = BrainLife.machine({ spec: Outside.spec, settings });
        propertyInvariant(
          machine,
          ctx,
          walks(machine, status, ready, cleanup),
          ({ next, msg }) => {
            if (!("cmd" in msg)) {
              return true;
            }

            const stale = {
              ...msg,
              cmd: { ...msg.cmd, id: Schema.decodeUnknownSync(Id.Cmd)("cmd_01m6v5270hf3c8x2q7w9z4k5mn") },
            };
            const [after, cmds] = applyCell(machine, next, stale);
            return JSON.stringify(after) === JSON.stringify(next) && cmds.length === 0;
          },
          { ...options, numRuns: 1 },
        );
      }),
    { arbitrary: options },
  );

  it.effect.prop(
    "L2 no stop walk removes a plist before confirmed absence and children",
    [Status, Readiness, Children],
    ([status, ready, cleanup]) =>
      Effect.gen(function* () {
        const settings = yield* ServiceTest.timing();
        const machine = BrainLife.machine({ spec: Outside.spec, settings });
        propertyInvariant(
          machine,
          ctx,
          walks(machine, status, ready, cleanup),
          ({ prev, cmds }) => cmds.every((cmd) => cmd.type !== "remove" || prev._tag === "checking_children"),
          { ...options, numRuns: 1 },
        );
      }),
    { arbitrary: options },
  );
});

it.effect.prop(
  "L10 [secrets] reached Model and saved bytes never copy output-bearing reply fields",
  [Status, Readiness, Children, Schema.NonEmptyString],
  ([status, ready, cleanup, word]) =>
    Effect.gen(function* () {
      const secret = `sentinel-${word}/+&`;
      const machine = BrainLife.machine({ spec: Outside.spec, settings: yield* ServiceTest.timing() });
      propertyInvariant(
        machine,
        ctx,
        walks(machine, status, ready, cleanup),
        ({ prev, msg }) => {
          // Unknown native fields may accompany a settled reply. The reducer keeps only its checked facts.
          const poisoned = {
            ...msg,
            cause: secret,
            stderr: secret,
            url: `${Outside.spec.url}?secret=${encodeURIComponent(secret)}`,
          };
          const [next] = applyCell(machine, prev, poisoned);
          const outputs = [JSON.stringify(next), JSON.stringify(Schema.encodeSync(BrainLife.Model)(next))];
          return outputs.every((output) =>
            [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)].every(
              (form) => !output.includes(form),
            ),
          );
        },
        { seed: 119120, numRuns: 1 },
      );
    }),
  { arbitrary: { seed: 119120, numRuns: 100 } },
);
