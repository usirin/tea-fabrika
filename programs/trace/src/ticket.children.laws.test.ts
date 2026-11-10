import type { JobTrace, Span } from "@kampus/fabrika-old";
import { LANE } from "@kampus/pipeline/stages/traced";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { childrenOf } from "./ticket.ts";

// The spans under a step, as a law: for any forest of spans, `childrenOf` says what a plain walk
// says. Today's version. The walk is slow on purpose: it filters the whole record for each span's
// children, so nothing in it can be wrong in the way a fast index can. Starts come from a small
// range, so ties are common: the law also holds the order of spans that start together (each
// below its parent, siblings in record order), as today's code gives it.
//
// Green today. It guards the rewrite: a faster `childrenOf` must give the same spans in the same
// order, and pick the same step span (the first tagged with the run, else the first of the
// untagged "run a step" spans that overlaps the step most).

const OPTS = { numRuns: 300, seed: 119120 };
const STEP_SPAN = "run a step";
const RUNS = ["r-plan-1", "r-exam-2", "r-build-3"] as const;

/** The step's span, as the record says: tagged with the run, else the best untagged overlap. */
const rootOf = (record: JobTrace, run: string, from: number, to: number): Span | undefined => {
  const tagged = record.spans.find((s) => s.tags[LANE.run] === run);

  if (tagged !== undefined) {
    return tagged;
  }

  let best: Span | undefined;
  let most = 0;

  for (const s of record.spans) {
    if (s.name !== STEP_SPAN || s.tags[LANE.run] !== undefined) {
      continue;
    }

    const shared = Math.min(s.end, to) - Math.max(s.start, from);

    if (shared > most) {
      best = s;
      most = shared;
    }
  }

  return best;
};

/** Every span under `id`, each followed by its own, siblings in record order. */
const below = (spans: readonly Span[], id: string): readonly Span[] =>
  spans.flatMap((s) => (s.parent === id ? [s, ...below(spans, s.span)] : []));

const reference = (record: JobTrace, run: string, from: number, to: number): readonly Span[] => {
  const root = rootOf(record, run, from, to);
  return root === undefined ? [] : below(record.spans, root.span).toSorted((a, b) => a.start - b.start);
};

/**
 * A forest of up to 40 spans. Each span's parent is most often an earlier span, else none, else a
 * span not in the record. Some are "run a step", some tagged with a run (a run may be on two).
 * Starts and lengths come from 0 to 8, so many spans start together. No cycles: a parent is
 * always earlier.
 */
const forest: fc.Arbitrary<JobTrace> = fc
  .array(
    fc.record({
      parent: fc.oneof(
        { arbitrary: fc.constant<"none" | "gone" | number>("none"), weight: 1 },
        { arbitrary: fc.constant<"none" | "gone" | number>("gone"), weight: 1 },
        { arbitrary: fc.nat({ max: 39 }), weight: 6 },
      ),
      step: fc.boolean(),
      run: fc.option(fc.constantFrom(...RUNS), { nil: null }),
      start: fc.nat({ max: 8 }),
      length: fc.nat({ max: 8 }),
    }),
    { maxLength: 40 },
  )
  .map((drawn) => {
    const id = (i: number) => (i + 1).toString(16).padStart(16, "0");
    const spans = drawn.map((d, i): Span => ({
      span: id(i),
      parent: d.parent === "none" ? null : d.parent === "gone" ? "f".repeat(16) : i === 0 ? null : id(d.parent % i),
      name: d.step ? STEP_SPAN : "turn",
      service: "pipeline",
      start: d.start,
      end: d.start + d.length,
      status: "ok",
      tags: d.run === null ? {} : { [LANE.run]: d.run },
      events: [],
      by: "agent:lane",
    }));
    return { trace: "d4".repeat(16), job: null, runs: [], spans, steps: [], opened: [] };
  });

const query = fc.record({
  run: fc.constantFrom(...RUNS, "r-ship-4"),
  from: fc.nat({ max: 16 }),
  length: fc.nat({ max: 16 }),
});

describe("the spans under a step, as a law (childrenOf)", () => {
  it("for any forest of spans, gives what a plain walk gives, in the same order", () => {
    fc.assert(
      fc.property(forest, query, (record, q) => {
        const to = q.from + q.length;
        const got = childrenOf(record, q.run, q.from, to).map((s) => s.span);
        expect(got).toEqual(reference(record, q.run, q.from, to).map((s) => s.span));
      }),
      OPTS,
    );
  });
});

/**
 * The same forests, with about a third of the spans' run tags a number or a boolean: `SpanTag`
 * allows both. Such a span is neither tagged with a run nor untagged, in the plain walk and in
 * `childrenOf` alike. Kills the mutation step's survivor at ./ticket.ts:238 (PR 351).
 */
const oddTags: fc.Arbitrary<JobTrace> = forest.chain((record) =>
  fc
    .array(
      fc.oneof(
        { arbitrary: fc.constant(null), weight: 2 },
        { arbitrary: fc.constantFrom<number | boolean>(3, 0, true, false), weight: 1 },
      ),
      { minLength: record.spans.length, maxLength: record.spans.length },
    )
    .map((odd): JobTrace => ({
      ...record,
      spans: record.spans.map((s, i) => {
        const tag = odd[i];
        return tag === null || tag === undefined ? s : { ...s, tags: { [LANE.run]: tag } };
      }),
    })),
);

describe("the spans under a step, with run tags that are not strings (childrenOf)", () => {
  it("for any forest whose run tags may be numbers or booleans, gives what a plain walk gives", () => {
    fc.assert(
      fc.property(oddTags, query, (record, q) => {
        const to = q.from + q.length;
        const got = childrenOf(record, q.run, q.from, to).map((s) => s.span);
        expect(got).toEqual(reference(record, q.run, q.from, to).map((s) => s.span));
      }),
      OPTS,
    );
  });
});
