// P19 next/. The real reducer is walked from init; driver laws also hold each native reply.
import { applyCell } from "@demlik/tea";
import { arbGuidedSequence, propertyInvariant, propertyTrace, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { syncTest } from "../Testing.ts";
import * as Outside from "./BrainControl.test-support.ts";
import * as BrainLife from "./BrainLife.ts";
import { Readiness, Children } from "./BrainProbe.ts";
import * as ServiceTest from "./BrainServiceTest.ts";

const options = { seed: 119120, numRuns: 150 };
const ctx = stubCtxThrowingProxy<unknown>();
const Failure = Schema.TaggedUnion({ Operation: {} });
const oldId = Schema.decodeUnknownSync(Id.Cmd)("cmd_01m6v5270hf3c8x2q7w9z4k5mn");

const walks = (machine: ReturnType<typeof BrainLife.machine>) => {
  const settled = <A>(value: fc.Arbitrary<A>) => fc.record({ value, failed: fc.integer({ min: 0, max: 9 }) });
  const reply = <T extends BrainLife.Command["type"], A>(
    cmd: Extract<BrainLife.Command, { type: T }>,
    answer: { value: A; failed: number },
  ): BrainLife.Msg =>
    (answer.failed === 0
      ? { type: `${cmd.type}_err`, cmd, error: Failure.cases.Operation.make({}), at: 0 }
      : { type: `${cmd.type}_ok`, cmd, value: answer.value, at: 0 }) as BrainLife.Msg;
  const guided = arbGuidedSequence(
    machine,
    ctx,
    {
      outside: {
        up: fc.constant({ type: "up" as const, at: 0 }),
        stop: fc.constant({ type: "stop" as const, at: 0 }),
        tick: fc.record({ type: fc.constant("tick" as const), at: fc.integer({ min: 0, max: 30 }) }),
      },
      answers: {
        inspect: {
          draw: settled(
            fc.constantFrom(Outside.absent, Outside.loaded(), Outside.loaded(Outside.spec, null), Outside.foreign),
          ),
          make: reply,
        },
        install: { draw: settled(fc.constant(null)), make: reply },
        start: { draw: settled(fc.constant(null)), make: reply },
        stop: { draw: settled(fc.constant(null)), make: reply },
        ready: {
          draw: settled(fc.constantFrom(Readiness.cases.waiting.make({}), Readiness.cases.ready.make({}))),
          make: reply,
        },
        cleanup: {
          draw: settled(fc.constantFrom(Children.cases.waiting.make({}), Children.cases.gone.make({}))),
          make: reply,
        },
        remove: { draw: settled(fc.constant(null)), make: reply },
      },
    },
    { maxLength: 240, size: "max" },
  );
  return guided.map((msgs) => {
    let [state] = machine.init(null, ctx);
    const history: Array<Extract<BrainLife.Msg, { cmd: unknown }>> = [];
    const walk: Array<BrainLife.Msg> = [];

    for (const msg of msgs) {
      const id = "pending" in state ? state.pending?.id : undefined;
      const stale = id === undefined ? undefined : history.findLast((old) => old.cmd.id !== id);

      if (stale !== undefined) {
        walk.push(stale);
        [state] = applyCell(machine, state, stale);
      }

      walk.push(msg);
      [state] = applyCell(machine, state, msg);

      if ("cmd" in msg) {
        history.push(msg);
      }
    }

    return walk;
  });
};

describe("P19 lifecycle", () => {
  it.effect("L8 every reached save/load cut preserves later Model and Cmd decisions", () =>
    Effect.gen(function* () {
      const machine = BrainLife.machine({ spec: Outside.spec, settings: yield* ServiceTest.timing() });
      const reached = new Set<string>();
      propertyTrace(
        machine,
        ctx,
        walks(machine),
        (steps) => {
          for (const step of steps) {
            reached.add(step.next._tag);
          }

          syncTest(machine, ctx, {
            msgs: steps.map((step) => step.msg),
            encode: Schema.encodeSync(BrainLife.Model),
            decode: Schema.decodeUnknownSync(BrainLife.Model),
            equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
            seed: 119120,
          });
          return true;
        },
        options,
      );

      for (const state of [
        "confirming_absence",
        "checking_children",
        "removing",
        "stopped",
        "waiting_ready",
        "online",
        "failed_up",
        "failed_stop",
      ]) {
        expect(reached.has(state), `walks reach ${state}`).toBe(true);
      }
    }),
  );

  it.effect("L4 old replies cannot settle a newer pending command, including during stop", () =>
    Effect.gen(function* () {
      const machine = BrainLife.machine({ spec: Outside.spec, settings: yield* ServiceTest.timing() });
      let checked = 0;
      let replayed = 0;
      const staleStates = new Set<string>();
      propertyTrace(
        machine,
        ctx,
        walks(machine),
        (steps) => {
          const earlier: Array<Extract<BrainLife.Msg, { cmd: unknown }>> = [];

          for (const { prev, msg } of steps) {
            const id = "pending" in prev ? prev.pending?.id : undefined;
            const stale = id === undefined ? [] : earlier.filter((old) => old.cmd.id !== id);

            if (id !== undefined && "cmd" in msg) {
              stale.push({ ...msg, cmd: { ...msg.cmd, id: oldId } });
            }

            for (const old of stale) {
              checked++;
              const pending = "pending" in prev ? prev.pending : null;
              replayed += Number(pending !== null && old.cmd.type === pending.type && old.cmd.id !== oldId);
              staleStates.add(prev._tag);
              const [after, cmds] = applyCell(machine, prev, old);
              expect(after).toEqual(prev);
              expect(cmds).toEqual([]);
            }

            if ("cmd" in msg) {
              earlier.push(msg);
            }
          }

          return true;
        },
        options,
      );
      expect(checked).toBeGreaterThan(0);
      expect(replayed).toBeGreaterThan(0);
      expect(staleStates.has("confirming_absence")).toBe(true);
    }),
  );

  it.effect("L2 stop requires confirmed absence, gone children and successful removal", () =>
    Effect.gen(function* () {
      const machine = BrainLife.machine({ spec: Outside.spec, settings: yield* ServiceTest.timing() });
      let removals = 0;
      propertyInvariant(
        machine,
        ctx,
        walks(machine),
        ({ prev, next, msg, cmds }) => {
          const removes = cmds.some((cmd) => cmd.type === "remove");
          const checksChildren = cmds.some((cmd) => cmd.type === "cleanup");
          removals += Number(removes);
          expect(
            !removes || (prev._tag === "checking_children" && msg.type === "cleanup_ok" && msg.value._tag === "gone"),
          ).toBe(true);
          expect(
            !checksChildren ||
              prev._tag === "checking_children" ||
              ((prev._tag === "inspecting" || prev._tag === "confirming_absence") &&
                msg.type === "inspect_ok" &&
                msg.value._tag === "absent"),
          ).toBe(true);
          expect(
            next._tag !== "stopped" ||
              prev._tag === "stopped" ||
              (prev._tag === "removing" && msg.type === "remove_ok"),
          ).toBe(true);

          return true;
        },
        { ...options, numRuns: 200 },
      );
      expect(removals).toBeGreaterThan(0);
    }),
  );
});

it.effect.prop(
  "L10 [secrets] reached Model and saved bytes never copy output-bearing reply fields",
  [Schema.NonEmptyString, Schema.Int],
  ([word, seed]) =>
    Effect.gen(function* () {
      const secret = `sentinel-${word}/+&`;
      const encoded = encodeURIComponent(secret.toWellFormed());
      const machine = BrainLife.machine({ spec: Outside.spec, settings: yield* ServiceTest.timing() });
      propertyInvariant(
        machine,
        ctx,
        walks(machine),
        ({ prev, msg }) => {
          const poisoned = { ...msg, cause: secret, stderr: secret, url: `${Outside.spec.url}?secret=${encoded}` };
          const [next] = applyCell(machine, prev, poisoned);
          const outputs = [JSON.stringify(next), JSON.stringify(Schema.encodeSync(BrainLife.Model)(next))];
          return outputs.every((output) =>
            [secret, encoded, JSON.stringify(secret).slice(1, -1)].every((form) => !output.includes(form)),
          );
        },
        { seed, numRuns: 1 },
      );
    }),
  { arbitrary: { seed: 119120, runs: 100 } },
);
