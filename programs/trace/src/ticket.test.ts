import type { JobTrace, Span } from "@kampus/fabrika-old";
import { LANE } from "@kampus/pipeline/stages/traced";
import { describe, expect, it } from "vitest";
import { ASTRA_LANE_1, ASTRA_LANE_2, astra, LANE_1, LANE_2, LANE_3, MIN, SEC, T0, T117, T117_MADE_UP } from "./t117.ts";
import { childrenOf, lanesOf, type Price, summaryOf } from "./ticket.ts";

// The ticket view's fold on one ticket, by example (ticket 141, plan section 4, E1). Today's
// version. Ticket 117's shape, made up (./t117.ts): 3 lanes, 10 steps, 3 waits, 4 min 49 s on you;
// every step priced once gpt-6-astra is in the list-price table, and 5 unknown with a model in its
// place that no table knows.

describe("ticket 117's shape (E1)", () => {
  it("gives 3 lanes, oldest first, of 7, 5 and 1 rows, none open", () => {
    const { timeline, now } = T117;
    const lanes = lanesOf(timeline, now, Infinity);
    expect(lanes.map((l) => [l.trace, l.rows.length, l.open])).toEqual([
      [LANE_1, 7, false],
      [LANE_2, 5, false],
      [LANE_3, 1, false],
    ]);
  });

  it("draws lane 1 over its own 47 min 14 s, never from the ticket's filing days before", () => {
    const { timeline, now, lane1End } = T117;
    const [first] = lanesOf(timeline, now, Infinity);
    expect([first?.from, first?.to]).toEqual([T0, lane1End]);
    expect((first?.to ?? 0) - (first?.from ?? 0)).toBe(47 * MIN + 14 * SEC);
  });

  it("starts lane 2 at its restart, from plan, and lists its rows in time order", () => {
    const { timeline, now, restart } = T117;
    const second = lanesOf(timeline, now, Infinity)[1];
    expect([second?.restart, second?.from]).toEqual([{ at: restart, from: "plan" }, restart]);
    expect(second?.rows.map((r) => (r.kind === "step" ? `${r.kind} ${r.stage}` : `${r.kind} ${r.ask}`))).toEqual([
      "step plan",
      "wait a-approve-8",
      "step exam",
      "wait a-merge-9",
      "step exam_merge",
    ]);
  });

  it("says 10 steps, 3 waits, 4 min 49 s on you, and every step priced: astra at its list price, no unknown", () => {
    const { timeline, now } = T117;
    const summary = summaryOf(lanesOf(timeline, now, Infinity));
    expect({ ...summary, usd: null }).toEqual({
      lanes: 3,
      steps: 10,
      waits: 3,
      waited: (71 + 97 + 121) * SEC,
      usd: null,
      unknown: 0,
    });
    expect(summary.usd).toBeCloseTo(0.03 + 0.04 + ASTRA_LANE_1 + ASTRA_LANE_2, 9);
  });

  it("gives each lane its own line: lane 3, code alone, has no dollars, never $0.00", () => {
    const { timeline, now } = T117;
    const lines = lanesOf(timeline, now, Infinity).map((l) => summaryOf([l]));
    expect(lines.map((l) => [l.steps, l.waits, l.unknown])).toEqual([
      [6, 1, 0],
      [3, 2, 0],
      [1, 0, 0],
    ]);
    expect(lines[0]?.usd).toBeCloseTo(0.03 + 0.04 + ASTRA_LANE_1, 9);
    expect(lines[1]?.usd).toBeCloseTo(ASTRA_LANE_2, 9);
    expect(lines[2]?.usd).toBeNull();
  });

  it("reads astra's step at its list price, from the tokens, though its end says null", () => {
    const { timeline, now } = T117;
    const plan8 = lanesOf(timeline, now, Infinity)
      .flatMap((l) => l.rows)
      .find((r) => r.kind === "step" && r.run === "r-plan-8");
    expect(plan8?.kind === "step" && plan8.price.kind).toBe("usd");
    expect(plan8?.kind === "step" && plan8.price.kind === "usd" && plan8.price.usd).toBeCloseTo(
      astra(120_000, 100_000, 4_000),
      9,
    );
  });

  it("with a model no table knows in astra's place: those 5 steps are unknown, and the total is $0.07, never more from a 0", () => {
    const { timeline, now } = T117_MADE_UP;
    const lanes = lanesOf(timeline, now, Infinity);
    const summary = summaryOf(lanes);
    expect(summary.unknown).toBe(5);
    expect(summary.usd).toBeCloseTo(0.07, 9);
    const unknown = lanes
      .flatMap((l) => l.rows)
      .flatMap((r) => (r.kind === "step" && r.price.kind === "unknown" ? [r.run] : []));
    expect(unknown).toEqual(["r-plan-2", "r-exam-3", "r-test_writer-4", "r-plan-8", "r-exam-9"]);
  });

  it("prices a code step as none, and the sorter by what claude billed", () => {
    const { timeline, now } = T117;
    const prices = new Map(
      lanesOf(timeline, now, Infinity)
        .flatMap((l) => l.rows)
        .flatMap((r): [string, Price][] => (r.kind === "step" ? [[r.run, r.price]] : [])),
    );
    expect(prices.get("r-sort-1")).toEqual({ kind: "usd", usd: 0.03 });
    expect(prices.get("r-build-5")).toEqual({ kind: "usd", usd: 0.04 });
    expect(prices.get("r-exam_merge-6")).toEqual({ kind: "none" });
  });

  it("replayed 3 min into r-plan-8: two lanes, and the last row is that step, running to the playhead", () => {
    const { timeline, now, plan8 } = T117;
    const upTo = plan8 + 3 * MIN;
    const lanes = lanesOf(timeline, now, upTo);
    expect(lanes.map((l) => l.trace)).toEqual([LANE_1, LANE_2]);
    expect(lanes.at(-1)?.open).toBe(true);
    expect(lanes.at(-1)?.to).toBe(upTo);
    expect(lanes.at(-1)?.rows.at(-1)).toMatchObject({
      kind: "step",
      run: "r-plan-8",
      to: upTo,
      ended: null,
    });
  });
});

describe("a step's spans (childrenOf)", () => {
  const at = T0;
  const span = (
    id: string,
    parent: string | null,
    name: string,
    start: number,
    end: number,
    tags: Record<string, string> = {},
  ): Span => ({
    span: id,
    parent,
    name,
    service: "pipeline",
    start,
    end,
    status: "ok",
    tags,
    events: [],
    by: "agent:lane",
  });
  const record = (spans: readonly Span[]): JobTrace => ({
    trace: LANE_2,
    job: null,
    runs: [],
    spans,
    steps: [],
    opened: [],
  });

  it("finds a step's spans by the run on its span, even when another step's span overlaps it more", () => {
    const r = record([
      span("1000000000000001", null, "run a step", at, at + 10 * MIN, { [LANE.run]: "r-plan-8" }),
      span("1000000000000002", "1000000000000001", "planner", at + MIN, at + 9 * MIN),
      span("2000000000000001", null, "run a step", at + 2 * MIN, at + 30 * MIN, {
        [LANE.run]: "r-exam-9",
      }),
      span("2000000000000002", "2000000000000001", "examiner", at + 3 * MIN, at + 29 * MIN),
    ]);
    const ids = childrenOf(r, "r-plan-8", at + 2 * MIN, at + 30 * MIN).map((s) => s.span);
    expect(ids).toContain("1000000000000002");
    expect(ids).not.toContain("2000000000000002");
  });

  it("in a record written before the tag, takes the run a step span that overlaps the step most", () => {
    const r = record([
      span("1000000000000001", null, "run a step", at, at + 4 * MIN),
      span("1000000000000002", "1000000000000001", "planner", at + MIN, at + 3 * MIN),
      span("2000000000000001", null, "run a step", at + 4 * MIN, at + 20 * MIN),
      span("2000000000000002", "2000000000000001", "examiner", at + 5 * MIN, at + 19 * MIN),
    ]);
    const ids = childrenOf(r, "r-exam-9", at + 3 * MIN, at + 20 * MIN).map((s) => s.span);
    expect(ids).toContain("2000000000000002");
    expect(ids).not.toContain("1000000000000002");
  });

  it("in a record written before the tag, takes only a run a step span, though another overlaps the step more", () => {
    const r = record([
      span("1000000000000001", null, "run a step", at + MIN, at + 9 * MIN),
      span("1000000000000002", "1000000000000001", "planner", at + 2 * MIN, at + 3 * MIN),
      span("3000000000000001", null, "read the ticket", at, at + 10 * MIN),
      span("3000000000000002", "3000000000000001", "GET", at + 4 * MIN, at + 5 * MIN),
    ]);
    const ids = childrenOf(r, "r-plan-8", at, at + 10 * MIN).map((s) => s.span);
    expect(ids).toEqual(["1000000000000002"]);
  });
});
