import type { JobTrace, Span } from "@kampus/fabrika-old";
import { LANE } from "@kampus/pipeline/stages/traced";
import { describe, expect, it } from "vitest";
import { T0 } from "./t117.ts";
import { childrenOf } from "./ticket.ts";

// The spans under one long step, in a big record. Today's version. On 2026-11-03, with ticket 117's
// lane open in the trace window, the host sat at 100% of a core for 15 minutes: 78% of its time in
// `childrenOf`, 18% in garbage collection. Its index copies a parent's whole child list for each
// child, so a step with many children costs their number squared.
//
// Measured on the owner's laptop on 2026-11-03, with a live lane running beside it (best of 3):
//
//   children under one span    5,000      20,000     80,000
//   today's childrenOf         11-13 ms   410-433 ms  (not run)
//   a linear sketch            0.8 ms     3.1 ms      12.9 ms
//
// Wall-clock budgets break on slow or busy CI runners, and counting work cannot see this cost: the
// copies are of the index's own arrays, never of the record, so a record that counts its reads
// reads the same n either way. So the law compares growth inside one run on one machine: one call
// on 20,000 children against four calls on 5,000, the same number of spans in all. A linear walk
// takes about as long for both (the sort adds about 1.2x); today's takes about 9x as long for the
// one big call. The bar is 3x: a linear version clears it by more than 2x, today's misses it by
// about 3x. A slower runner slows both sides alike.

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

/** The fastest of `times` runs of `f`, each on records made before the clock starts. */
const fastest = (times: number, make: () => readonly JobTrace[]): number => {
  let best = Infinity;

  for (let k = 0; k < times; k++) {
    const records = make();
    const t = performance.now();

    for (const r of records) {
      childrenOf(r, RUN, 0, 1);
    }

    best = Math.min(best, performance.now() - t);
  }

  return best;
};

describe("the spans under a long step (childrenOf)", () => {
  const quarter = longStep(5_000);
  const whole = longStep(20_000);

  it("finds every span under a step of 20,000 children, nested ones too, in start order", () => {
    const got = childrenOf(whole.record, RUN, 0, 1);
    expect(got.length).toBe(whole.under.length);
    expect(got.map((s) => s.span)).toEqual(whole.under.map((s) => s.span));
  });

  it("takes about as long for 20,000 children once as for 5,000 four times: linear, not squared", () => {
    // Warm the JIT on both sizes first, so the first call's compiling is not on either side.
    fastest(1, () => [fresh(quarter.record), fresh(whole.record)]);
    const four = fastest(5, () => [1, 2, 3, 4].map(() => fresh(quarter.record)));
    const once = fastest(5, () => [fresh(whole.record)]);
    expect(once, `20,000 once: ${once.toFixed(1)} ms; 5,000 four times: ${four.toFixed(1)} ms`).toBeLessThan(3 * four);
  }, 60_000);
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
