import { blindDraw, sealAsk } from "@kampus/pipeline/tickets/ask";
import { closedAsks, Entry, Fact, fold } from "@kampus/pipeline/tickets/ticket";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import {
  AGENT,
  DRAFT,
  FILED,
  LEGACY_ASK,
  NOW,
  OWNER,
  TOOK,
  TRACE,
  policyFor,
  type Sealed,
} from "../../../fixtures/ask-desk/cases.ts";
import { property, ticketNumber } from "../../../fixtures/ask-desk/property.ts";
import { lanesOf } from "./ticket.ts";

const seal: (draft: unknown, policy: { seed: number }) => Effect.Effect<Sealed, unknown> = sealAsk;

describe("ask desk P22: trace reads the shared answer meaning", () => {
  property(
    "ends the saved wait at the answer and shows the resolved rec pick and writer",
    { gap: ticketNumber },
    async ({ gap }) => {
      const ask = await Effect.runPromise(seal(DRAFT, policyFor(DRAFT.ask, false, blindDraw)));
      const facts = [
        FILED,
        { type: "started", run: "r-plan-8", stage: "plan", task: null, log: null, trace: TRACE },
        {
          type: "ended",
          run: "r-plan-8",
          stage: "plan",
          outcome: { kind: "done", part: false },
          usd: 0,
          input: 0,
          output: 0,
          turns: 1,
        },
        { ...ask, trace: TRACE },
        {
          type: "answered",
          format: 1,
          ask: ask.ask,
          answer: { _tag: "rec" },
          saw: ask.saw,
          via: { _tag: "window", took: TOOK },
        },
      ];
      const timeline = facts.map((fact, i) =>
        Schema.decodeUnknownSync(Entry)({
          pos: i + 1,
          ticket: 117,
          by: i === 0 || fact.type === "answered" ? OWNER : AGENT,
          at: NOW + i * gap,
          fact,
        }),
      );
      const lane = lanesOf(timeline, NOW + 50 * gap, Infinity)[0];
      expect(lane?.rows.filter((r) => r.kind === "wait")).toEqual([
        {
          kind: "wait",
          ask: ask.ask,
          what: DRAFT.what,
          from: NOW + 3 * gap,
          to: NOW + 4 * gap,
          pick: "approve",
          by: "owner",
        },
      ]);
      expect(lane?.open).toBe(false);
    },
  );
});

const endings = Schema.Array(Schema.Literals(["waiting", "answered", "withdrawn", "replaced"])).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(8),
);

/** Valid mixed histories, including the crash between withdrawing and replacing an old ask. */
const history = async (ends: readonly string[], gap: number) => {
  const facts: Fact[] = [
    FILED,
    { type: "started", run: "trace-waits", stage: "plan", task: null, log: null, trace: TRACE },
    {
      type: "ended",
      run: "trace-waits",
      stage: "plan",
      outcome: { kind: "done", part: false },
      usd: 0,
      input: 0,
      output: 0,
      turns: 1,
    },
  ];

  for (const [i, end] of ends.entries()) {
    const id = `trace-ask-${i}`;
    const draft = { ...DRAFT, ask: id };
    const ask = Schema.decodeUnknownSync(Fact)({
      ...(await Effect.runPromise(seal(draft, policyFor(id, false, blindDraw)))),
      trace: TRACE,
    });

    if (ask.type !== "asked" || !("format" in ask)) {
      throw new Error("not a sealed ask");
    }

    if (end === "replaced") {
      const old = `old-${id}`;
      facts.push(Schema.decodeUnknownSync(Fact)({ ...LEGACY_ASK, ask: old }), {
        type: "withdrawn",
        ask: old,
        why: "changed",
      });
      facts.push({ ...ask, replaces: old });
    } else {
      facts.push(ask);
    }

    if (end === "answered" || end === "replaced") {
      facts.push(
        Schema.decodeUnknownSync(Fact)({
          type: "answered",
          format: 1,
          ask: id,
          answer: { _tag: "rec" },
          saw: ask.saw,
          via: { _tag: "window", took: TOOK },
        }),
      );
    }

    if (end === "withdrawn") {
      facts.push({ type: "withdrawn", ask: id, why: "ended" });
    }
  }

  return facts.map((fact, i) =>
    Schema.decodeUnknownSync(Entry)({
      pos: i + 1,
      ticket: 117,
      by: fact.type === "filed" || fact.type === "answered" ? OWNER : AGENT,
      at: NOW + i * gap,
      fact,
    }),
  );
};

describe("ask desk round 24: trace waits agree with today's folded ticket", () => {
  // Plant: ignore withdrawn facts, as review 10 found in lanesOf.
  property(
    "a withdrawn ask stops waiting at its withdrawal in a mixed history",
    { ends: endings, gap: ticketNumber },
    async ({ ends, gap }) => {
      const timeline = await history([...ends, "withdrawn"], gap);
      const folded = fold([], timeline);
      expect(folded.problems).toEqual([]);
      const now = NOW + (timeline.length + 10) * gap;
      const waits = lanesOf(folded.tickets[0]!.timeline, now, Infinity)
        .flatMap((l) => l.rows)
        .filter((r) => r.kind === "wait");

      for (const entry of timeline) {
        if (entry.fact.type === "withdrawn" && entry.fact.why !== "changed") {
          const id = entry.fact.ask;
          expect(waits.find((w) => w.ask === id)?.to).toBe(entry.at);
        }
      }
    },
  );

  // Plant: decide openness from pick === null even after a withdrawal.
  property(
    "zero waiting asks leaves no open wait, at every folded prefix",
    { ends: endings, gap: ticketNumber },
    async ({ ends, gap }) => {
      const timeline = await history([...ends, "withdrawn"], gap);

      for (let n = 3; n <= timeline.length; n++) {
        const folded = fold([], timeline.slice(0, n));
        expect(folded.problems).toEqual([]);
        const ticket = folded.tickets[0]!;
        const closed = closedAsks(ticket.timeline);
        const waiting = ticket.timeline.filter((e) => e.fact.type === "asked" && !closed.has(e.fact.ask));
        const lanes = lanesOf(ticket.timeline, NOW + (timeline.length + 10) * gap, Infinity);
        expect(lanes.some((l) => l.open)).toBe(waiting.length > 0);
      }
    },
  );

  // Plant: draw both asked facts for one legacy question, doubling its attention time.
  property(
    "a legacy question and its sealed replacement are one continuous wait",
    { gap: ticketNumber },
    async ({ gap }) => {
      const timeline = await history(["replaced"], gap);

      for (let n = 4; n <= timeline.length; n++) {
        const folded = fold([], timeline.slice(0, n));
        expect(folded.problems).toEqual([]);
        const now = NOW + (timeline.length + 10) * gap;
        const rows = lanesOf(folded.tickets[0]!.timeline, now, Infinity)
          .flatMap((l) => l.rows)
          .filter((r) => r.kind === "wait");
        expect(rows).toHaveLength(1);
        expect(rows[0]?.from).toBe(NOW + 3 * gap);
        const answer = timeline.slice(0, n).find((e) => e.fact.type === "answered");
        expect(rows[0]?.to).toBe(answer?.at ?? now);
      }
    },
  );
});
