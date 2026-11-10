import { foldEvents, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import type { JobTrace, Span } from "@kampus/fabrika-old";
import { LANE } from "@kampus/pipeline/stages/traced";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Model, type TraceMsg, trace } from "./machine.ts";
import { LANE_1, LANE_2, LANE_3, T117 } from "./t117.ts";
import { type Shown, shownOf } from "./view.ts";
import { TraceWindow } from "./window.tsx";

// The ticket view's tree (ticket 141): a step's spans, each span's HTTP calls folded into one row,
// and the WAI-ARIA tree grid's keys and clicks on its rows. Today's version. The keys run with no
// browser: the window's rows are React elements, so a test calls a row's own `onKeyDown` and
// `onClick` with a made-up event, and its grid's rows are stand-ins that note which one took the
// focus. What the keys do is the handler's job; that a browser moves the focus is not tested here.

const ctx = stubCtxThrowingProxy<undefined>();

/** r-plan-8's span in lane 2's record, by the run it is tagged with. */
const STEP = "1000000000000001";
const READ = "1000000000000002";
const WRITE = "1000000000000003";
const THINK = "1000000000000004";
const FETCH = "1000000000000005";
const CALLS = ["2000000000000001", "2000000000000002", "2000000000000003"] as const;

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

const GET = { "http.request.method": "GET" };
const P = T117.plan8;

/**
 * Lane 2's record: r-plan-8's step span, and under it "read the ticket" with three HTTP calls,
 * "write the plan" with one span of its own, and one HTTP call of the step's own.
 */
const LANE_2_RECORD: JobTrace = {
  trace: LANE_2,
  job: null,
  runs: [],
  spans: [
    span(STEP, null, "run a step", P, P + 300_000, { [LANE.run]: "r-plan-8" }),
    span(READ, STEP, "read the ticket", P + 1_000, P + 60_000),
    span(CALLS[0], READ, "GET", P + 2_000, P + 3_000, GET),
    span(CALLS[1], READ, "GET", P + 4_000, P + 6_000, GET),
    span(CALLS[2], READ, "GET", P + 7_000, P + 9_000, GET),
    span(WRITE, STEP, "write the plan", P + 61_000, P + 200_000),
    span(THINK, WRITE, "think", P + 62_000, P + 190_000),
    span(FETCH, STEP, "GET", P + 201_000, P + 202_000, GET),
  ],
  steps: [],
  opened: [],
};

/** Ticket 117 with lane 2 open and its record read, then these Msgs. */
const shown = (more: readonly TraceMsg[]): Model =>
  foldEvents(trace, ctx, null, [
    { type: "ticket", number: 117 },
    { type: "facts", number: 117, timeline: T117.timeline },
    { type: "toggle", row: `lane:${LANE_2}` },
    { type: "got", trace: LANE_2_RECORD },
    ...more,
  ]).finalState;

const OPENED: readonly TraceMsg[] = [
  { type: "toggle", row: "run:r-plan-8" },
  { type: "toggle", row: `span:${READ}` },
  { type: "toggle", row: `span:${WRITE}` },
];

const lane2 = (s: Model) => shownOf(s).ticket?.lanes[1];

describe("a step's spans in the ticket view", () => {
  it("nests a step's spans by parent, and folds each one's HTTP calls into one row", () => {
    const rows = lane2(shown(OPENED))?.rows ?? [];
    const at = rows.findIndex((r) => r.key === "run:r-plan-8");
    expect(rows.slice(at).map((r) => [r.key, r.depth])).toEqual([
      ["run:r-plan-8", 1],
      [`span:${READ}`, 2],
      [`calls:${READ}`, 3],
      [`span:${WRITE}`, 2],
      [`span:${THINK}`, 3],
      [`calls:${STEP}`, 2],
      ["ask:a-approve-8", 1],
      ["run:r-exam-9", 1],
      ["ask:a-merge-9", 1],
      ["run:r-exam_merge-10", 1],
    ]);
    const zero = lane2(shown(OPENED))?.at ?? 0;
    const calls = rows.find((r) => r.key === `calls:${READ}`);
    expect(calls).toEqual({
      kind: "calls",
      key: `calls:${READ}`,
      depth: 3,
      count: 3,
      from: P + 2_000 - zero,
      to: P + 9_000 - zero,
      open: false,
    });
    expect(rows.find((r) => r.key === `calls:${STEP}`)).toMatchObject({ count: 1 });
  });

  it("opens a calls row to one row per call", () => {
    const rows = lane2(shown([...OPENED, { type: "toggle", row: `calls:${READ}` }]))?.rows ?? [];
    const at = rows.findIndex((r) => r.key === `calls:${READ}`);
    expect(rows.slice(at, at + 4).map((r) => r.key)).toEqual([`calls:${READ}`, ...CALLS.map((c) => `span:${c}`)]);
  });

  it("names a calls row by how many calls it folds", () => {
    const markup = renderToStaticMarkup(createElement(TraceWindow, { view: shownOf(shown(OPENED)), send: () => {} }));
    expect(markup).toContain("<span>3 calls</span>");
    expect(markup).toContain("<span>1 call</span>");
  });
});

/** A row the window draws, as its element's props give it. */
/** A row element as the key handler reads it: where its grid is, and the focus it takes. */
interface StandIn {
  readonly key: string;
  readonly focus: () => void;
  readonly closest: () => { readonly querySelectorAll: () => readonly StandIn[] };
}

/** A key event as the handler reads it: the key, its row, and the default it stops. */
interface KeyPress {
  readonly key: string;
  readonly currentTarget: StandIn | undefined;
  readonly preventDefault: () => void;
}

interface DrawnRow {
  readonly key: string;
  readonly onClick: () => void;
  readonly onKeyDown: (e: KeyPress) => void;
}

/** The tree grid's rows the ticket view draws, in order, with their handlers. */
const rowsDrawn = (view: Shown, send: (msg: unknown) => void): readonly DrawnRow[] => {
  const out: DrawnRow[] = [];
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      return node.forEach(walk);
    }

    if (!isValidElement<Record<string, unknown>>(node)) {
      return;
    }

    const { props } = node;
    const key = props["data-row"];

    if (node.type === "tr" && typeof key === "string") {
      out.push({
        key,
        onClick: props.onClick as DrawnRow["onClick"],
        onKeyDown: props.onKeyDown as DrawnRow["onKeyDown"],
      });
    }

    walk(props.children as ReactNode);
  };
  // TraceWindow hands the ticket view to its own component, which keeps no state: call it.
  const outer = TraceWindow({ view, send });

  if (isValidElement<Record<string, unknown>>(outer) && typeof outer.type === "function") {
    walk((outer.type as (p: unknown) => ReactNode)(outer.props));
  }

  return out;
};

/** What a press of `key` on `row` sends, and which row takes the focus. */
const press = (s: Model, row: string, key: string) => {
  const sent: unknown[] = [];
  const focused: string[] = [];
  const rows = rowsDrawn(shownOf(s), (m) => sent.push(m));
  const stand: StandIn[] = [];
  const grid = { querySelectorAll: () => stand };

  for (const r of rows) {
    stand.push({ key: r.key, focus: () => focused.push(r.key), closest: () => grid });
  }

  // The handler finds its row among the grid's by identity, so the event carries the stand-in.
  const event: KeyPress = {
    key,
    currentTarget: stand.find((r) => r.key === row),
    preventDefault: () => {},
  };
  rows.find((r) => r.key === row)?.onKeyDown(event);
  return { sent, focused };
};

/** What a click on `row` sends. */
const click = (s: Model, row: string): readonly unknown[] => {
  const sent: unknown[] = [];
  rowsDrawn(shownOf(s), (m) => sent.push(m))
    .find((r) => r.key === row)
    ?.onClick();
  return sent;
};

/** Ticket 117 as it first reads: lanes 1 and 2 folded, lane 3 open. */
const first = (more: readonly TraceMsg[] = []): Model =>
  foldEvents(trace, ctx, null, [
    { type: "ticket", number: 117 },
    { type: "facts", number: 117, timeline: T117.timeline },
    ...more,
  ]).finalState;

describe("the ticket view's tree grid keys", () => {
  it("moves down a row with ↓", () => {
    expect(press(first(), `lane:${LANE_1}`, "ArrowDown").focused).toEqual([`lane:${LANE_2}`]);
  });

  it("opens a folded lane with →", () => {
    expect(press(first(), `lane:${LANE_1}`, "ArrowRight").sent).toEqual([
      { type: "toggle", value: { row: `lane:${LANE_1}` } },
    ]);
  });

  it("folds an open lane with ←", () => {
    expect(press(first(), `lane:${LANE_3}`, "ArrowLeft")).toEqual({
      sent: [{ type: "toggle", value: { row: `lane:${LANE_3}` } }],
      focused: [],
    });
  });

  it("moves from a step to its lane with ←, past the rows before it in the lane", () => {
    const s = first([{ type: "toggle", row: `lane:${LANE_1}` }]);
    expect(press(s, "run:r-exam-3", "ArrowLeft")).toEqual({ sent: [], focused: [`lane:${LANE_1}`] });
  });

  it("shows a step's detail with Enter", () => {
    const s = first([{ type: "toggle", row: `lane:${LANE_1}` }]);
    expect(press(s, "run:r-sort-1", "Enter").sent).toEqual([{ type: "choose", value: { row: "run:r-sort-1" } }]);
  });
});

describe("a click on the ticket view's rows", () => {
  it("opens a step with spans and shows its detail", () => {
    expect(click(shown([]), "run:r-plan-8")).toEqual([
      { type: "toggle", value: { row: "run:r-plan-8" } },
      { type: "choose", value: { row: "run:r-plan-8" } },
    ]);
  });

  it("only shows the detail of a step with no spans", () => {
    expect(click(shown([]), "run:r-exam-9")).toEqual([{ type: "choose", value: { row: "run:r-exam-9" } }]);
  });
});
