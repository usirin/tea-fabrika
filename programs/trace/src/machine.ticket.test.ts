import { foldEvents, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import type { JobTrace } from "@kampus/fabrika-old";
import { describe, expect, it } from "vitest";
import { type Model, type TraceMsg, trace } from "./machine.ts";
import { LANE_1, LANE_3, T117 } from "./t117.ts";

// The trace machine's ticket view, by example on ticket 117's shape (ticket 141). Today's version.
// Each test pins one answer the laws in ./machine.ticket.laws.test.ts reach but never check: a
// step row opens and can be chosen, a lane's record that cannot be read says so, and a newest lane
// the person closed stays closed when the same facts come again.

const ctx = stubCtxThrowingProxy<undefined>();

/** The state after these Msgs, from the real init. */
const after = (msgs: readonly TraceMsg[]): Model => foldEvents(trace, ctx, null, msgs).finalState;

/** Ticket 117 shown with its facts read, then these Msgs. */
const shown = (more: readonly TraceMsg[] = []): Model =>
  after([{ type: "ticket", number: 117 }, { type: "facts", number: 117, timeline: T117.timeline }, ...more]);

/** A lane's record with nothing in it. */
const record = (id: string): JobTrace => ({
  trace: id,
  job: null,
  runs: [],
  spans: [],
  steps: [],
  opened: [],
});

/** Each lane's record as the ticket view holds it, by its trace id. */
const recordsOf = (s: Model) => (s.shows.kind === "ticket" ? s.shows.records : null);

describe("the ticket view's rows", () => {
  it("opens a step's row by its run, and closes it again", () => {
    const open = shown([{ type: "toggle", row: "run:r-plan-2" }]);
    expect(open.open).toContain("run:r-plan-2");
    const closed = shown([
      { type: "toggle", row: "run:r-plan-2" },
      { type: "toggle", row: "run:r-plan-2" },
    ]);
    expect(closed.open).not.toContain("run:r-plan-2");
  });

  it("chooses a step's row and an ask's row, and never a lane's", () => {
    expect(shown([{ type: "choose", row: "run:r-plan-2" }]).chosen).toBe("run:r-plan-2");
    expect(shown([{ type: "choose", row: "ask:a-approve-2" }]).chosen).toBe("ask:a-approve-2");
    expect(shown([{ type: "choose", row: `lane:${LANE_1}` }]).chosen).toBeNull();
  });
});

describe("a lane's record that cannot be read", () => {
  it("is marked unread, with why", () => {
    const s = shown([{ type: "lost", id: LANE_1, why: "gone" }]);
    expect(recordsOf(s)).toEqual([{ id: LANE_1, read: { at: "unread", id: LANE_1, why: "gone" } }]);
  });

  it("after it was read, stays read", () => {
    const s = shown([
      { type: "got", trace: record(LANE_1) },
      { type: "lost", id: LANE_1, why: "gone" },
    ]);
    expect(recordsOf(s)?.map((r) => [r.id, r.read.at])).toEqual([[LANE_1, "read"]]);
  });
});

describe("the newest lane, on a facts refresh", () => {
  it("stays closed when the person closed it and no new lane began", () => {
    const newest = `lane:${LANE_3}`;
    expect(shown().open).toEqual([newest]);
    const s = shown([
      { type: "toggle", row: newest },
      { type: "facts", number: 117, timeline: T117.timeline },
    ]);
    expect(s.open).not.toContain(newest);
  });
});
