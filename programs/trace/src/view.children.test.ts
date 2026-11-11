import { foldEvents, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import type { JobTrace, Span, Writer } from "@kampus/fabrika-old";
import { LANE } from "@kampus/pipeline/stages/traced";
import type { Entry, Fact } from "@kampus/pipeline/tickets/ticket";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Model, type TraceMsg, trace } from "./machine.ts";
import { MIN, T0 } from "./t117.ts";
import { shownOf, type TicketRow } from "./view.ts";
import { counted } from "./work.test-support.ts";

// The ticket view finds the spans under its steps from an index of its lane's record, built once
// for that record: never once for each step row, never again on each redraw. Today's version. On
// 2026-11-03 the view called `childrenOf` for each step row on every redraw, and each call walked
// the whole record (./ticket.children.test.ts has the numbers).
//
// What the view can be seen to do: read the record's spans. The record here counts each read of
// one of its spans, so a law can say how many passes over the record a redraw makes. The index may
// be built when the record is read (in `update`, kept in the model) or on the first redraw that
// needs it (a cache keyed on the record, as Elm's Html.Lazy keys on its arguments). Either passes;
// a walk of the record per row, or per redraw, does not.

const ctx = stubCtxThrowingProxy<undefined>();
const NUMBER = 117;
const LANE_A = "d4".repeat(16);
const ROWS = 16;
const CHILDREN = 200;

const laneWriter: Writer = { kind: "agent", id: "lane", for: "owner" };
const owner: Writer = { kind: "user", id: "owner" };

const runOf = (i: number): string => `r-build-${i + 1}`;

/** A ticket of `rows` steps in one lane, one minute each, filed an hour before. */
const ticketOf = (rows: number): readonly Entry[] => {
  const facts: Fact[] = [{ type: "filed", title: "A made-up ticket", body: "" }];
  const at: number[] = [T0 - 60 * MIN];

  for (let i = 0; i < rows; i++) {
    const run = runOf(i);
    facts.push(
      { type: "started", run, stage: "build", task: null, log: null, trace: LANE_A },
      {
        type: "ended",
        run,
        stage: "build",
        outcome: { kind: "done", part: false },
        usd: 0,
        input: 1_000,
        output: 100,
        turns: 1,
        cached: 0,
      },
    );
    at.push(T0 + 2 * i * MIN, T0 + (2 * i + 1) * MIN);
  }

  return facts.map((fact, i) => ({
    pos: i + 1,
    ticket: NUMBER,
    by: fact.type === "filed" ? owner : laneWriter,
    at: at[i] ?? T0,
    fact,
  }));
};

/**
 * The lane's record: a "run a step" span for each of `ROWS` runs, each with `CHILDREN` spans
 * under it, whatever the ticket's rows. Its spans count each read of one of them into `reads`.
 */
const countingRecord = (): { readonly record: JobTrace; readonly reads: { n: number } } => {
  const spans: Span[] = [];
  const idOf = (n: number) => n.toString(16).padStart(16, "0");
  let next = 1;

  for (let i = 0; i < ROWS; i++) {
    const from = T0 + 2 * i * MIN;
    const root = idOf(next++);
    const base = { service: "pipeline", status: "ok" as const, events: [], by: "agent:lane" };
    spans.push({
      ...base,
      span: root,
      parent: null,
      name: "run a step",
      start: from,
      end: from + MIN,
      tags: { [LANE.run]: runOf(i) },
    });

    for (let c = 0; c < CHILDREN; c++) {
      spans.push({
        ...base,
        span: idOf(next++),
        parent: root,
        name: "turn",
        start: from + c,
        end: from + c + 1,
        tags: {},
      });
    }
  }

  const reads = { n: 0 };
  const counted = new Proxy(spans, {
    get: (target, key, receiver) => {
      if (typeof key === "string" && /^\d+$/.test(key)) {
        reads.n++;
      }

      return Reflect.get(target, key, receiver);
    },
  });
  return {
    record: { trace: LANE_A, job: null, runs: [], spans: counted, steps: [], opened: [] },
    reads,
  };
};

const SPANS = ROWS * (CHILDREN + 1);

/**
 * A ticket of `rows` steps with its lane's record read, and the record's reads. The first read of
 * the facts opens the newest lane, so its step rows are drawn.
 */
const opened = (rows: number): { readonly s: Model; readonly reads: { n: number } } => {
  const { record, reads } = countingRecord();
  const s = foldEvents(trace, ctx, null, [
    { type: "ticket", number: NUMBER },
    { type: "facts", number: NUMBER, timeline: ticketOf(rows) },
    { type: "got", trace: record },
  ]).finalState;
  expect(s.open).toEqual([`lane:${LANE_A}`]);
  return { s, reads };
};

/** The spans of the record read while drawing `s`, a ticket of `rows` steps, once. */
const readsDrawing = (s: Model, reads: { n: number }, rows: number): number => {
  const before = reads.n;
  const lanes = shownOf(s).ticket?.lanes ?? [];
  // Not a vacuous pass: every step row is drawn, and each finds its spans.
  const steps = lanes.flatMap((l) => l.rows.filter((r) => r.kind === "step"));
  expect(steps.map((r) => (r.kind === "step" ? [r.run, r.opens] : null))).toEqual(
    Array.from({ length: rows }, (_, i) => [runOf(i), true]),
  );
  return reads.n - before;
};

describe("the ticket view's spans under its steps", () => {
  it(`reads the record no more for ${ROWS} step rows than for 1: the index is built once per record, not per row`, () => {
    const one = opened(1);
    const many = opened(ROWS);
    const oneRow = readsDrawing(one.s, one.reads, 1);
    const manyRows = readsDrawing(many.s, many.reads, ROWS);
    // Each row past the first may look up a span or two, never walk the record's 3,216.
    expect(manyRows, `${ROWS} rows read ${manyRows} spans; 1 row read ${oneRow}`).toBeLessThanOrEqual(
      oneRow + 2 * (ROWS - 1),
    );
  });

  it("reads none of the record again on a second redraw of the same state", () => {
    const { s, reads } = opened(ROWS);
    readsDrawing(s, reads, ROWS);
    const again = readsDrawing(s, reads, ROWS);
    expect(again, `a second redraw read ${again} of ${SPANS} spans`).toBeLessThanOrEqual(2 * ROWS);
  });
});

// Test writer, round 2 (ticket 182). Today's version. The tests below go through the `trace`
// machine and `shownOf` as they are, and name no index: the index may sit in the model or in a
// cache keyed on the record's spans, and both must pass.

const BASE = { service: "pipeline", status: "ok" as const, events: [], by: "agent:lane" };
const STEP_ID = "5".repeat(16);
/** A parent no span in the record has: its spans were written before it was. */
const GONE = "f".repeat(16);

/** A span id: `n` in 16 hex digits. */
const hexId = (n: number): string => n.toString(16).padStart(16, "0");

/** A span of the lane's record, a millisecond long. */
const spanAt = (id: string, parent: string | null, name: string, start: number, tags: Span["tags"] = {}): Span => ({
  ...BASE,
  span: id,
  parent,
  name,
  start,
  end: start + 1,
  tags,
});

/** The lane's record: the first step's span, with these spans beside it. A new spans array. */
const recordWith = (others: readonly Span[]): JobTrace => ({
  trace: LANE_A,
  job: null,
  runs: [],
  spans: [{ ...spanAt(STEP_ID, null, "run a step", T0, { [LANE.run]: runOf(0) }), end: T0 + MIN }, ...others],
  steps: [],
  opened: [],
});

/** `n` HTTP calls straight under the first step's span, each at its own time. */
const callsUnder = (n: number): readonly Span[] =>
  Array.from({ length: n }, (_, i) =>
    spanAt(hexId(16 + i), STEP_ID, "POST", T0 + i, {
      "http.request.method": "POST",
    }),
  );

/** A ticket of one step, its lane's record read, then these Msgs. */
const readThen = (record: JobTrace, more: readonly TraceMsg[] = [], timeline: readonly Entry[] = ticketOf(1)): Model =>
  foldEvents(trace, ctx, null, [
    { type: "ticket", number: NUMBER },
    { type: "facts", number: NUMBER, timeline },
    { type: "got", trace: record },
    ...more,
  ]).finalState;

/** The rows of the newest lane, as drawn. */
const rowsOf = (s: Model): readonly TicketRow[] => shownOf(s).ticket?.lanes.at(-1)?.rows ?? [];

describe("a lane's record read again", () => {
  it("with spans under a step that had none, the step row opens: a second got is indexed anew", () => {
    const five = Array.from({ length: 5 }, (_, i) => spanAt(hexId(16 + i), STEP_ID, "turn", T0 + i));
    const { steps } = foldEvents(trace, ctx, null, [
      { type: "ticket", number: NUMBER },
      { type: "facts", number: NUMBER, timeline: ticketOf(1) },
      { type: "got", trace: recordWith([]) },
      { type: "got", trace: recordWith(five) },
    ]);
    const stepOf = (s: Model | undefined) => (s === undefined ? undefined : rowsOf(s).find((r) => r.kind === "step"));
    expect(stepOf(steps[2]?.next)).toMatchObject({ run: runOf(0), opens: false });
    expect(stepOf(steps[3]?.next)).toMatchObject({ run: runOf(0), opens: true });
  });
});

// The calls row, open. On e3dc0b85 `spanRowsOf` (./view.ts:547-550) filters every span under the
// step once for each span row, so opening a step's calls row draws one row per call and each row
// walks all of them. The review on PR 351 measured 188 ms per redraw at 8,000 calls and 1.3 s at
// 20,000, on the owner's laptop under load. Ticket 117's real record has 76,164 POST spans, so the
// window pegs a core once that row is open.
//
// The law once compared two clock readings, as ./ticket.children.test.ts did, and for the same
// reason it now counts the work through the built-ins instead (ticket 649, 0052, 0065): one redraw
// at 4n calls against four redraws at n, with a bar of 2x. Counted, the first redraw of each state:
//
//   calls under the step     500       2,000      one at 2,000 / four at 500
//   main                     6,059     24,059     0.99
//   e3dc0b85's spanRowsOf    256,059   4,024,059  3.93

/** A ticket whose step has `n` calls under it, read, with the step and its calls row open. */
const callsOpen = (n: number): Model =>
  readThen(recordWith(callsUnder(n)), [
    { type: "toggle", row: `run:${runOf(0)}` },
    { type: "toggle", row: `calls:${STEP_ID}` },
  ]);

/** The work of the first redraw of each state, made before the count starts. */
const drawing = (states: readonly Model[], cap: number): number =>
  counted(
    () =>
      states.forEach((s) => {
        shownOf(s);
      }),
    cap,
  ).work;

describe("a step's calls row, open", () => {
  it("draws one row per call, each once", () => {
    const rows = rowsOf(callsOpen(2_000));
    expect(rows.filter((r) => r.kind === "calls")).toMatchObject([{ count: 2_000, open: true }]);
    expect(rows.filter((r) => r.kind === "span").length).toBe(2_000);
  });

  // Plant L4: e3dc0b85's spanRowsOf, a `filter` of every span under the step for each row.
  it("does under 2x the counted work drawing 4n calls once as n calls four times: linear, not squared (L4)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 250, max: 2_000 }), (n) => {
        // A cap far above linear's few units per call, so a squared redraw still shows its ratio.
        const cap = 20_000 * 4 * n;
        const once = drawing([callsOpen(4 * n)], cap);
        const four = drawing(
          [1, 2, 3, 4].map(() => callsOpen(n)),
          cap,
        );
        expect(once, `${4 * n} once: ${once} units; ${n} four times: ${four} units`).toBeLessThan(2 * four);
      }),
      { seed: 119120, numRuns: 6 },
    );
  });
});

// Ticket 117's real shape. The review on PR 351 read its record on the owner's laptop on
// 2026-11-03: 76,185 spans, 76,164 of them under one parent that is not in the record, which was
// the old index's worst case (one list copied for each of 76,164 children). This record has the
// same counts: the step's span, 20 spans under it, and 76,164 calls under a parent that is gone.
//
// Measured on the owner's laptop on 2026-11-03, under load from a live lane and two agents: a read
// and two redraws, the step open, took 6 ms on e3dc0b85 (the index built on got) and 16,547 ms on
// 5f426e11 (childrenOf per row, copying). The law had a budget of 1,000 ms; it now counts the work
// instead (ticket 649, 0052, 0065), with a bound of 4 units per span. Counted: main spends 76,668
// units, about 1.0 per span, every run. 5f426e11's copying walk passes the bound within its
// first few hundred children, so OverCap stops it early.
//
// pinned: ticket 117's real counts, 20 spans under the step and 76,164 under a gone parent, the
// record that held the host at 100% of a core; a generated size would not be that bug.

const ORPHANS = 76_164;
const PER_SPAN = 4;

const t117Record = (): JobTrace =>
  recordWith([
    ...Array.from({ length: 20 }, (_, i) => spanAt(hexId(16 + i), STEP_ID, "turn", T0 + i)),
    ...Array.from({ length: ORPHANS }, (_, i) =>
      spanAt(hexId(64 + i), GONE, "POST", T0 + i, {
        "http.request.method": "POST",
      }),
    ),
  ]);

describe("ticket 117's record: 76,185 spans, almost all under a parent that is gone", () => {
  // Plant L5: 5f426e11's childrenOf per row, a copy of a parent's list for each child.
  it(`pinned: is read and drawn twice, the step open, within ${PER_SPAN} units of work per span (L5)`, () => {
    const record = t117Record();
    const timeline = ticketOf(1);
    const toggle: readonly TraceMsg[] = [{ type: "toggle", row: `run:${runOf(0)}` }];
    expect(record.spans.length).toBe(76_185);
    const { value: rows, work } = counted(() => {
      const s = readThen(record, toggle, timeline);
      shownOf(s);
      return rowsOf(s);
    }, PER_SPAN * record.spans.length);
    // Not a vacuous pass: the step opens, and its 20 spans are drawn, none of the orphans.
    expect(rows.filter((r) => r.kind === "span").length).toBe(20);
    expect(work, `a read and two redraws: ${work} units for ${record.spans.length} spans`).toBeLessThanOrEqual(
      PER_SPAN * record.spans.length,
    );
  }, 120_000);
});
