import { foldEvents, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import type { Writer } from "@kampus/fabrika-old";
import type { Entry, Fact, FactOf } from "@kampus/pipeline/tickets/ticket";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Model, type TraceMsg, trace } from "./machine.ts";
import { LANE_2, MIN, SEC, T0, T117 } from "./t117.ts";
import { stopsOf } from "./ticket.ts";
import { type LaneShown, shownOf } from "./view.ts";
import { TraceWindow } from "./window.tsx";

// The ticket view's `shownOf` and its window, by example (ticket 141). Today's version. Ticket
// 117's shape (./t117.ts), and small made-up tickets of one or two lanes, each built for the one
// case it shows: a lane with no trace id, a ticket with no lane, a restart a whole number of hours
// or days later, a long lane's ruler, a step whose known price is nothing.

const ctx = stubCtxThrowingProxy<undefined>();
const HOUR = 60 * MIN;
const NUMBER = 117;
const LANE_A = "d4".repeat(16);
const LANE_B = "e5".repeat(16);

const laneWriter: Writer = { kind: "agent", id: "lane", for: "owner" };
const owner: Writer = { kind: "user", id: "owner" };

/** A ticket's facts, each at its time, in order, filed first. */
const ticketOf = (facts: readonly (readonly [number, Fact])[]): readonly Entry[] =>
  [[T0 - HOUR, { type: "filed", title: "A made-up ticket", body: "" }] as const, ...facts].map(([at, fact], i) => ({
    pos: i + 1,
    ticket: NUMBER,
    by: fact.type === "filed" || fact.type === "restarted" ? owner : laneWriter,
    at,
    fact,
  }));

const started = (run: string, trace: string | null, model: string | null = null): Fact => ({
  type: "started",
  run,
  stage: "build",
  task: null,
  log: null,
  ...(trace === null ? {} : { trace }),
  ...(model === null ? {} : { model, harness: "codex" }),
});

const ended = (
  run: string,
  o: {
    readonly model?: string;
    readonly listUsd?: number;
    readonly outcome?: FactOf<"ended">["outcome"];
  } = {},
): Fact => ({
  type: "ended",
  run,
  stage: "build",
  outcome: o.outcome ?? { kind: "done", part: false },
  usd: 0,
  input: 1_000,
  output: 100,
  turns: 1,
  cached: 0,
  ...(o.listUsd === undefined ? {} : { listUsd: o.listUsd }),
  ...(o.model === undefined ? {} : { model: o.model, harness: "codex" }),
});

const restarted: Fact = { type: "restarted", from: "plan", base: null, onto: "abcdef0" };

/** Two lanes of one minute each, the second restarted `after` the first ended. */
const restartedAfter = (after: number): readonly Entry[] =>
  ticketOf([
    [T0, started("r-a", LANE_A)],
    [T0 + MIN, ended("r-a")],
    [T0 + MIN + after, restarted],
    [T0 + 2 * MIN + after, started("r-b", LANE_B)],
    [T0 + 3 * MIN + after, ended("r-b")],
  ]);

/** The state with this ticket's facts read, then these Msgs. */
const shown = (timeline: readonly Entry[], more: readonly TraceMsg[] = []): Model =>
  foldEvents(trace, ctx, null, [
    { type: "ticket", number: NUMBER },
    { type: "facts", number: NUMBER, timeline },
    ...more,
  ]).finalState;

/** The window's markup for a state, and its text with the tags taken out. */
const drawn = (s: Model): { readonly markup: string; readonly text: string } => {
  const markup = renderToStaticMarkup(createElement(TraceWindow, { view: shownOf(s), send: () => {} }));
  return { markup, text: markup.replaceAll(/<[^>]*>/g, " ").replaceAll(/\s+/g, " ") };
};

const lanesOfShown = (s: Model): readonly LaneShown[] => shownOf(s).ticket?.lanes ?? [];

describe("shownOf in the ticket view", () => {
  it("shows a lane with no trace id open, with no record and nothing to fold", () => {
    const timeline = ticketOf([
      [T0, started("r-a", null)],
      [T0 + MIN, ended("r-a")],
    ]);
    const [lane] = lanesOfShown(shown(timeline));
    expect(lane).toMatchObject({ trace: "", open: true, opens: false, record: "none" });
    expect(lane?.rows.map((r) => r.key)).toEqual(["run:r-a"]);
  });

  it("says a ticket whose facts hold no lane is empty, and the window says so in words", () => {
    const s = shown(ticketOf([]));
    expect(shownOf(s).empty).toBe(true);
    expect(drawn(s).text).toContain("No lane has run on this ticket yet.");
  });

  it("draws an answered wait's bar done, and one still on a person waiting", () => {
    const waits = (s: Model) =>
      (lanesOfShown(s)[1]?.bars ?? []).filter((_, i) => i === 1 || i === 3).map((b) => b.state);
    expect(waits(shown(T117.timeline))).toEqual(["done", "done"]);
    // Replayed to the second ask: it has no answer yet.
    const asked = T117.timeline.find((e) => e.fact.type === "asked" && e.fact.ask === "a-merge-9");
    const replayed = shown(T117.timeline, [{ type: "seek", at: asked?.at ?? 0 }]);
    expect(waits(replayed)).toEqual(["done", "waiting"]);
  });

  it("live with no tick yet, runs an open step to the newest fact", () => {
    // Ticket 117 as it stood just after r-plan-8 started: its start and its session.
    const timeline = T117.timeline.filter((e) => e.at <= T117.plan8 + 1);
    const lane = lanesOfShown(shown(timeline)).at(-1);
    expect(lane?.live).toBe(true);
    expect(lane?.length).toBe(T117.plan8 + 1 - T117.restart);
    expect(lane?.rows.at(-1)).toMatchObject({
      key: "run:r-plan-8",
      to: T117.plan8 + 1 - T117.restart,
    });
  });

  it("opens an ask's row to what was asked, and who picked what, after how long", () => {
    const s = shown(T117.timeline, [
      { type: "toggle", row: `lane:${LANE_2}` },
      { type: "choose", row: "ask:a-merge-9" },
    ]);
    expect(shownOf(s).chosen).toMatchObject({
      kind: "ask",
      key: "ask:a-merge-9",
      ask: "a-merge-9",
      what: "Merge the rule changes?",
      took: 121 * SEC,
      pick: "merge",
      by: "owner",
    });
  });

  it("after a seek, the replay says which stop it is on", () => {
    const stops = stopsOf(T117.timeline);
    const s = shown(T117.timeline, [{ type: "seek", at: stops[2] ?? 0 }]);
    expect(shownOf(s).ticket?.replay).toEqual({ at: stops[2], stop: 3, stops: stops.length });
  });
});

describe("the ticket view's window, on small tickets", () => {
  it("says a restart a whole number of hours later in hours alone", () => {
    const { text } = drawn(shown(restartedAfter(2 * HOUR)));
    expect(text).toContain("2 h later, restarted from plan");
  });

  it("says a restart a day or more later in days and hours, and whole days in days alone", () => {
    expect(drawn(shown(restartedAfter(52 * HOUR))).text).toContain("2 d 4 h later, restarted from plan");
    expect(drawn(shown(restartedAfter(48 * HOUR))).text).toContain("2 d later, restarted from plan");
  });

  it("labels an hour tick of a long lane's ruler in hours and minutes", () => {
    const timeline = ticketOf([
      [T0, started("r-a", LANE_A)],
      [T0 + 3 * HOUR + 10 * MIN, ended("r-a")],
    ]);
    const { markup } = drawn(shown(timeline));
    expect(markup).toContain(">1 h 30 min</span>");
    expect(markup).toContain(">1 h</span>");
  });

  it("says a known price of nothing as no charge, never $0.00", () => {
    const timeline = ticketOf([
      [T0, started("r-a", LANE_A, "gpt-6-astra")],
      [T0 + MIN, ended("r-a", { model: "gpt-6-astra", listUsd: 0 })],
    ]);
    const { text } = drawn(shown(timeline));
    expect(text).toContain("no charge");
    expect(text).not.toContain("$");
  });

  it("places a step's bar on its lane's axis: the second half of the lane", () => {
    const timeline = ticketOf([
      [T0, started("r-a", LANE_A)],
      [T0 + MIN, ended("r-a", { outcome: { kind: "send", to: "build", why: "planned" } })],
      [T0 + MIN, started("r-b", LANE_A)],
      [T0 + 2 * MIN, ended("r-b")],
    ]);
    const { markup } = drawn(shown(timeline));
    expect(markup).toContain(
      'class="tv-bar done" style="inset-inline-start:50%;inline-size:max(2px, calc(100% - 50%))"',
    );
    expect(markup).toContain('class="tv-bar send" style="inset-inline-start:0%;inline-size:max(2px, calc(50% - 0%))"');
  });
});
