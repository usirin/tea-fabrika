// P15 slice 1, next/. A-Watcher: an ended install attempt advances the phase,
// whatever its answer. Build failures before an attempt send no Msg.
import { arbGuidedSequence, propertyTrace } from "@demlik/tea/pbt";
import { expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";

it("A-Watcher: the first install attempt reads boot and every later attempt reads watch", async () => {
  // The builder adds this machine and uses it in watch.ts, replacing index.
  const { watcher } = await import("./watcher.ts");
  type Model = { readonly _tag: "booting" } | { readonly _tag: "watching" };
  type Msg = { readonly type: "attempted" };
  expectTypeOf<Model>().toEqualTypeOf<typeof watcher.model.Type>();
  expectTypeOf<Msg>().toEqualTypeOf<typeof watcher.msg.Type>();
  const json = Schema.fromJsonString(watcher.model);

  // tea's guided generator accepts fast-check data, not Effect Arbitrary.
  // Successful and failed attempt results both send the same payload-free Msg.
  const attempted = fc.boolean().map((): Msg => ({ type: "attempted" }));
  const attempts = arbGuidedSequence(watcher, {}, { outside: { attempted } }, { maxLength: 60, size: "max" });
  const run = propertyTrace(
    watcher,
    {},
    attempts,
    (steps, final, initCmds) => {
      expect(initCmds).toEqual([]);
      expect((steps[0]?.prev ?? final)._tag, "a fresh watcher has not attempted an install").toBe("booting");

      for (const [index, step] of steps.entries()) {
        expect(step.prev._tag, index === 0 ? "the first attempt uses boot" : "later attempts use watch").toBe(
          index === 0 ? "booting" : "watching",
        );
        expect(step.next._tag, "every ended attempt leaves the watcher watching").toBe("watching");
        expect(step.cmds).toEqual([]);
        expect(Schema.decodeUnknownSync(json)(Schema.encodeSync(json)(step.next))).toEqual(step.next);
      }

      expect(final._tag).toBe(steps.length === 0 ? "booting" : "watching");
      return true;
    },
    { seed: 119120, numRuns: 100, failOnNeverActed: true },
  );
  const attemptsSeen = run.msgCounts.get("attempted");
  expect(attemptsSeen?.acted, "the walk reaches the first attempt").toBeGreaterThan(0);
  expect(attemptsSeen?.drawn, "the walk also reaches later attempts").toBeGreaterThan(attemptsSeen?.acted ?? 0);
});
