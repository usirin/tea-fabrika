// P15 slice 1, next/. A-Watcher: an ended install attempt advances the phase,
// whatever its answer. Rebuilds remember failed inputs without advancing the phase.
import { arbGuidedSequence, propertyTrace } from "@demlik/tea/pbt";
import { expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";

it("A-Watcher: rebuilds keep the phase and failed inputs; only an install attempt advances boot to watch", async () => {
  const { watcher } = await import("./watcher.ts");
  type Model =
    | { readonly _tag: "booting"; readonly failedInputs?: string | null }
    | { readonly _tag: "watching"; readonly failedInputs?: string | null };
  type Msg = { readonly type: "attempted" } | { readonly type: "rebuilt"; readonly failedInputs: string | null };
  expectTypeOf<Model>().toEqualTypeOf<typeof watcher.model.Type>();
  expectTypeOf<Msg>().toEqualTypeOf<typeof watcher.msg.Type>();
  const json = Schema.fromJsonString(Schema.toType(watcher.model));

  // tea's guided generator accepts fast-check data, not Effect Arbitrary.
  // Successful and failed attempt results both send the same payload-free Msg.
  const attempted = fc.boolean().map((): Extract<Msg, { type: "attempted" }> => ({ type: "attempted" }));
  const rebuilt = fc
    .option(fc.string(), { nil: null })
    .map((failedInputs): Extract<Msg, { type: "rebuilt" }> => ({ type: "rebuilt", failedInputs }));
  const attempts = arbGuidedSequence(watcher, {}, { outside: { attempted, rebuilt } }, { maxLength: 60, size: "max" });
  const rebuildsSeen = new Set<string>();
  const run = propertyTrace(
    watcher,
    {},
    attempts,
    (steps, final, initCmds) => {
      expect(initCmds).toEqual([]);
      expect((steps[0]?.prev ?? final)._tag, "a fresh watcher has not attempted an install").toBe("booting");
      expect((steps[0]?.prev ?? final).failedInputs ?? null, "a fresh watcher has no failed inputs").toBeNull();

      let attemptedCount = 0;

      for (const step of steps) {
        if (step.msg.type === "attempted") {
          expect(
            step.prev._tag,
            attemptedCount === 0 ? "the first attempt uses boot" : "later attempts use watch",
          ).toBe(attemptedCount === 0 ? "booting" : "watching");
          expect(step.next._tag, "every ended attempt leaves the watcher watching").toBe("watching");
          expect(step.next.failedInputs ?? null, "an install attempt keeps the last rebuild's failed inputs").toBe(
            step.prev.failedInputs ?? null,
          );
          attemptedCount += 1;
        } else {
          expect(step.next._tag, "a rebuild alone does not advance the install phase").toBe(step.prev._tag);
          expect(step.next.failedInputs, "the latest rebuild replaces or clears failed inputs").toBe(
            step.msg.failedInputs,
          );
          rebuildsSeen.add(`${step.prev._tag}:${step.msg.failedInputs === null ? "cleared" : "failed"}`);
        }

        expect(step.cmds).toEqual([]);
        expect(Schema.decodeUnknownSync(json)(Schema.encodeSync(json)(step.next))).toEqual(step.next);
      }

      expect(final._tag).toBe(attemptedCount === 0 ? "booting" : "watching");
      return true;
    },
    { seed: 119120, numRuns: 100, failOnNeverActed: true },
  );
  const attemptsSeen = run.msgCounts.get("attempted");
  expect(attemptsSeen?.acted, "the walk reaches the first attempt").toBeGreaterThan(0);
  expect(attemptsSeen?.drawn, "the walk also reaches later attempts").toBeGreaterThan(attemptsSeen?.acted ?? 0);
  expect(run.msgCounts.get("rebuilt")?.acted, "the walk changes failed inputs").toBeGreaterThan(0);
  expect(rebuildsSeen, "success and failure rebuilds reach both install phases").toEqual(
    new Set(["booting:cleared", "booting:failed", "watching:cleared", "watching:failed"]),
  );
});
