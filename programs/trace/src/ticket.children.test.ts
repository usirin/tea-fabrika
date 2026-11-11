import type { JobTrace, Span } from "@kampus/fabrika-old";
import { LANE } from "@kampus/pipeline/stages/traced";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { T0 } from "./t117.ts";
import { childrenOf } from "./ticket.ts";
import { counted, OverCap } from "./work.test-support.ts";

// The spans under one long step, in a big record. Today's version. On 2026-11-03, with ticket 117's
// lane open in the trace window, the host sat at 100% of a core for 15 minutes: 78% of its time in
// `childrenOf`, 18% in garbage collection. Its index copies a parent's whole child list for each
// child, so a step with many children costs their number squared.
//
// Measured on the owner's laptop on 2026-11-03, with a live lane running beside it (best of 3):
//
//   children under one span    5,000      20,000     80,000
//   before ec39c211            11-13 ms   410-433 ms  (not run)
//   a linear sketch            0.8 ms     3.1 ms      12.9 ms
//
// The law first compared two clock readings, and on 2026-11-10 a shared CI runner gave the linear
// code 52.3 ms once against 17.1 ms four times, a false red (ticket 649). A clock on a noisy runner
// moves one side and not the other, and a test may not lean on the machine (0052). So the law now
// counts the work instead, through the built-ins (./work.test-support.ts): each iterator step, each
// linear Array method by its receiver's length, and `concat`, `flat` and `flatMap` by their result's
// length too, so `[].concat(list, [s])` and `[list, [s]].flat()` cost the list they copy. That sees the copies of the index's own
// arrays, which a record that counts its reads cannot. The count is the same on every run (0065).
//
// Counted on main and on ec39c211's parent, which copied a parent's list for each child:
//
//   children under the step     500        2,000       one at 2,000 / four at 500
//   main                        2,498      8,750       0.88
//   before ec39c211             133,145    2,016,803   3.79
//
// The same copy through `[].concat(list, [s])` counts as the spread does, 3.84 to 3.97 over the
// law's sizes, and through `[list, [s]].flat()` 3.81 to 3.97.
//
// Over the law's six sizes, main gives 0.79 to 0.96. The bar is 2x, and a cap of 100 units per span
// (main spends about 4) stops a squared walk early: L1b trips it at n = 250 already.
// Not counted, and accepted (0065): a hand `while` loop, an index loop that does arithmetic on `i`.
// `typescript/prefer-for-of` in .oxlintrc.json catches the plain index loop.

const RUN = "r-long";

/** A span of a lane's record, ending a millisecond after it starts. */
const span = (id: string, parent: string | null, name: string, tags: Record<string, string> = {}): Span => ({
  span: id,
  parent,
  name,
  service: "pipeline",
  start: 0,
  end: 0,
  status: "ok",
  tags,
  events: [],
  by: "agent:lane",
});

const idOf = (n: number): string => n.toString(16).padStart(16, "0");

/**
 * A record with one long step: `n` children under its span, every 50th with two of its own, and
 * one of those with one more. Beside it, another step with 100 children of its own, and a span
 * with no parent. Each span starts at its own time, in a shuffled order, so start order is not
 * record order. `under`: the spans under the long step, in start order, as built.
 */
const longStep = (n: number): { readonly record: JobTrace; readonly under: readonly Span[] } => {
  const built: { readonly s: Span; readonly under: boolean }[] = [];
  const add = (s: Span, under: boolean) => built.push({ s, under });
  const root = idOf(1);
  const other = idOf(2);
  add(span(root, null, "run a step", { [LANE.run]: RUN }), false);
  add(span(other, null, "run a step", { [LANE.run]: "r-other" }), false);
  add(span(idOf(3), null, "read the ticket"), false);
  let next = 16;

  for (let i = 0; i < 100; i++) {
    add(span(idOf(next++), other, "turn"), false);
  }

  for (let i = 0; i < n; i++) {
    const child = idOf(next++);
    add(span(child, root, "turn"), true);

    if (i % 50 !== 0) {
      continue;
    }

    const first = idOf(next++);
    add(span(first, child, "tool"), true);
    add(span(idOf(next++), child, "tool"), true);

    if (i % 500 === 0) {
      add(span(idOf(next++), first, "POST"), true);
    }
  }

  // Distinct starts, shuffled: a prime step through m places visits each once.
  const m = built.length;
  const STEP = 7919;

  if (m % STEP === 0) {
    throw new Error(`${m} spans: the step must not divide them`);
  }

  const spans = built.map(({ s }, j): Span => {
    const start = T0 + ((j * STEP) % m) * 10;
    return { ...s, start, end: start + 1 };
  });
  const under = spans.filter((_, j) => built[j]?.under).toSorted((a, b) => a.start - b.start);
  return {
    record: { trace: "d4".repeat(16), job: null, runs: [], spans, steps: [], opened: [] },
    under,
  };
};

/** The same record, as a new object with a new spans array: no cache keyed on either hits. */
const fresh = (r: JobTrace): JobTrace => ({ ...r, spans: [...r.spans] });

/** The spans of a record, a count of work may spend up to `per` units on each. */
const capOf = (records: readonly JobTrace[], per: number): number =>
  per * records.reduce((sum, r) => sum + r.spans.length, 0);

/** The work of one call on 4n children, and of four calls on n, each on records it has not seen. */
const workAt = (n: number, per: number): { readonly once: number; readonly four: number } => {
  const big = [fresh(longStep(4 * n).record)];
  const quarters = [1, 2, 3, 4].map(() => fresh(longStep(n).record));
  const once = counted(
    () =>
      big.forEach((r) => {
        childrenOf(r, RUN, 0, 1);
      }),
    capOf(big, per),
  ).work;
  const four = counted(
    () =>
      quarters.forEach((r) => {
        childrenOf(r, RUN, 0, 1);
      }),
    capOf(quarters, per),
  ).work;
  return { once, four };
};

const sizes = fc.integer({ min: 250, max: 2_000 });
const runs = { seed: 119120, numRuns: 6 };

describe("the spans under a long step (childrenOf)", () => {
  const whole = longStep(20_000);

  it("finds every span under a step of 20,000 children, nested ones too, in start order", () => {
    const got = childrenOf(whole.record, RUN, 0, 1);
    expect(got.length).toBe(whole.under.length);
    expect(got.map((s) => s.span)).toEqual(whole.under.map((s) => s.span));
  });

  // Plant L1: ec39c211's parent's childrenOf, a spread copy of the parent's list for each child; the
  // same copy through `([] as Span[]).concat(list, [s])`; and through `[list, [s]].flat()`.
  it("does under 2x the counted work for 4n children once as for n four times: linear, not squared (L1)", () => {
    fc.assert(
      fc.property(sizes, (n) => {
        // A cap far above linear's few units per span, so a squared walk still shows its ratio; L1b
        // holds the tight one.
        const { once, four } = workAt(n, 10_000);
        expect(once, `${4 * n} once: ${once} units; ${n} four times: ${four} units`).toBeLessThan(2 * four);
      }),
      runs,
    );
  });

  // Plant L1b: the same; it trips OverCap.
  it("spends under 100 units of work per span in the record (L1b)", () => {
    fc.assert(
      fc.property(sizes, (n) => {
        let over: OverCap | null = null;

        try {
          workAt(n, 100);
        } catch (e) {
          if (!(e instanceof OverCap)) {
            throw e;
          }

          over = e;
        }

        expect(over, `${over?.work} units passed the cap of ${over?.cap}`).toBeNull();
      }),
      runs,
    );
  });
});

describe("a record whose parents loop (childrenOf)", () => {
  // Before e3dc0b85 a loop recursed until the stack ran out. The walk now stops at a span already
  // on its path. Kills the mutation step's survivors at ./ticket.ts:246 and :249 (PR 351).
  it("ends, and gives each span on the loop once: a step a under b under a gives [b, a]", () => {
    const a = span("a".repeat(16), "b".repeat(16), "run a step", { [LANE.run]: RUN });
    const b = span("b".repeat(16), a.span, "turn");
    const record: JobTrace = {
      trace: "d4".repeat(16),
      job: null,
      runs: [],
      spans: [a, b],
      steps: [],
      opened: [],
    };
    expect(childrenOf(record, RUN, 0, 1).map((s) => s.span)).toEqual([b.span, a.span]);
  });
});
