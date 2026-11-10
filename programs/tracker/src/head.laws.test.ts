import { type Entry, Fact, type FactOf, fold } from "@kampus/pipeline/tickets/ticket";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Head, HOUR, headOf, openAsksOf } from "./head.ts";

// The laws of a ticket's top line, over random lists of facts. The facts go through the real fold
// first, so a fact that does not fit (an answer to an ask never asked, an agent's answer, a run
// ended twice) is kept out as it is on a real ticket, and the line is read off what is left.

// ---------------------------------------------------------------- generators

const owner = { kind: "user", id: "owner" } as const;
const build = { kind: "agent", id: "build", for: "owner" } as const;
const writer = fc.constantFrom(owner, build);

const ask = fc.constantFrom("a-1", "a-2", "a-3");
const run = fc.constantFrom("r-1", "r-2", "r-3");
const stage = fc.constantFrom("triage", "plan", "build", "review");
const PICKS = ["approve", "no"] as const;
const SHA = "a1b2c3d";

const outcome: fc.Arbitrary<Extract<Fact, { type: "ended" }>["outcome"]> = fc.oneof(
  fc.record({ kind: fc.constant("done" as const), part: fc.boolean() }),
  fc.record({ kind: fc.constant("send" as const), to: stage, why: fc.constant("built") }),
  fc.record({
    kind: fc.constant("ask" as const),
    who: fc.constant("owner"),
    for: fc.constant("approval"),
  }),
  fc.record({ kind: fc.constant("skip" as const), why: fc.constant("closed") }),
  fc.record({ kind: fc.constant("stuck" as const), why: fc.constant("read_failed") }),
);

/** Any fact but `filed`, which every timeline starts with. Lane facts weigh more, so lanes happen. */
const fact: fc.Arbitrary<Fact> = fc.oneof(
  fc.constant<Fact>({ type: "commented", body: "Seen it." }),
  fc.constant<Fact>({ type: "closed" }),
  fc.constant<Fact>({ type: "reopened" }),
  {
    arbitrary: fc
      .tuple(run, stage, fc.option(fc.constant("t-1"), { nil: null }))
      .map(([r, s, task]): Fact => ({ type: "started", run: r, stage: s, task, log: null })),
    weight: 3,
  },
  {
    arbitrary: fc.tuple(run, stage, outcome).map(([r, s, o]): Fact => ({
      type: "ended",
      run: r,
      stage: s,
      outcome: o,
      usd: 0.1,
      input: 10,
      output: 5,
      turns: 3,
    })),
    weight: 3,
  },
  {
    arbitrary: ask.map((a): Fact => ({
      type: "asked",
      ask: a,
      what: `approve ${a}`,
      picks: [...PICKS],
    })),
    weight: 3,
  },
  {
    arbitrary: fc
      .tuple(ask, fc.constantFrom("approve", "no", "maybe"))
      .map(([a, pick]): Fact => ({ type: "answered", ask: a, pick, note: "" })),
    weight: 3,
  },
  {
    arbitrary: fc.constantFrom("draft", "open", "merged", "closed").map((state): Fact => ({
      type: "pr",
      url: "https://github.com/o/r/pull/12",
      state: state as "draft" | "open" | "merged" | "closed",
      head: SHA,
      checks: [],
    })),
    weight: 2,
  },
  fc.constant<Fact>({ type: "rated", finding: "f-1", says: "noise" }),
);

/** A ticket's timeline: `filed`, then what the fold keeps of the facts after it. */
const timeline: fc.Arbitrary<readonly Entry[]> = fc
  .array(fc.tuple(writer, fact, fc.nat({ max: 3 * HOUR })), { maxLength: 25 })
  .map((rows) => {
    let at = 1_000;
    const entries: Entry[] = [
      { pos: 1, ticket: 1, by: owner, at, fact: { type: "filed", title: "Login fails", body: "" } },
    ];
    rows.forEach(([by, f, gap], i) => {
      at += gap;
      entries.push({ pos: i + 2, ticket: 1, by, at, fact: f });
    });
    return fold([], entries).tickets[0]?.timeline ?? [];
  });

const lastAt = (t: readonly Entry[]) => t.at(-1)?.at ?? 0;
/** A time some way after the last fact: before or after the hour. */
const nowOf = (t: readonly Entry[], gap: number) => lastAt(t) + gap;
const gap = fc.nat({ max: 3 * HOUR });

const OPTS = { numRuns: 2000, seed: 6 };

// ---------------------------------------------------------------- what is wanted, said again

const since = (t: readonly Entry[]) => t.slice(t.findLastIndex((e) => e.fact.type === "reopened") + 1);

const mergedSince = (t: readonly Entry[]) => since(t).some((e) => e.fact.type === "pr" && e.fact.state === "merged");

const closedNow = (t: readonly Entry[]) => since(t).some((e) => e.fact.type === "closed");

/**
 * Every kind of fact a ticket's stream can hold, and whether it is work: a fact that moves the
 * ticket on, so it wakes an idle one. The rest is advice, shown on the ticket and never read to
 * decide (docs/direction/label-guidelines.md, L1): a Jev duplicate hint, a person's word on it, a
 * person's rating of a review finding. A new kind must take a row here, or this does not compile.
 */
const WORK = {
  filed: true,
  commented: true,
  closed: true,
  reopened: true,
  started: true,
  session: true,
  ended: true,
  checked: true,
  restarted: true,
  planned: true,
  pushed: true,
  reviewed: true,
  pr: true,
  asked: true,
  carried: true,
  answered: true,
  rated: false,
  maybe_duplicate: false,
  duplicate_rated: false,
} as const satisfies Record<Fact["type"], boolean>;

const isWork = (e: Entry) => WORK[e.fact.type];
/** When the last work fact was written: the hour of "idle" runs from it, not from advice. */
const lastWorkAt = (t: readonly Entry[]) => t.findLast(isWork)?.at ?? 0;

const append = (t: readonly Entry[], by: Entry["by"], f: Fact): readonly Entry[] => [
  ...t,
  { pos: (t.at(-1)?.pos ?? 0) + 1, ticket: 1, by, at: lastAt(t), fact: f },
];

/** Deep equal, or throw with the difference, so a failed law says what it saw. */
const same = (a: unknown, b: unknown) => {
  expect(a).toEqual(b);
  return true;
};

const holds = (law: (t: readonly Entry[], now: number) => boolean) => () =>
  fc.assert(
    fc.property(timeline, gap, (t, g) => law(t, nowOf(t, g))),
    OPTS,
  );

// ---------------------------------------------------------------- the laws

describe("a ticket's top line", () => {
  it("is drawn as each of its seven lines by these lists, so no law above holds for want of a case", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(timeline, gap, (t, g) => {
        seen.add(headOf(t, nowOf(t, g))._tag);
        return true;
      }),
      OPTS,
    );
    expect([...seen].sort()).toEqual(["asks", "closed", "done", "idle", "next", "running", "stuck"].sort());
  });

  it(
    "is done when, and only when, its pull request merged after the last reopen, or a person closed it once every ask was answered",
    holds((t, now) => {
      const head = headOf(t, now);
      const byMerge = mergedSince(t);
      const close = since(t).findLast((e) => e.fact.type === "closed");
      const answered = t.some((e) => e.fact.type === "answered");
      const byClose = close !== undefined && close.by.kind === "user" && answered && openAsksOf(t).length === 0;
      expect(head._tag === "done").toBe(byMerge || byClose);

      if (byMerge) {
        expect(head).toEqual({ _tag: "done", pr: "https://github.com/o/r/pull/12" });
      }

      return true;
    }),
  );

  it(
    "is never done from what an agent writes alone: no merge, no person's close, no done",
    holds((t, now) => {
      const agentOnly = t.filter(
        (e) =>
          !(e.fact.type === "pr" && e.fact.state === "merged") && !(e.fact.type === "closed" && e.by.kind === "user"),
      );
      return headOf(agentOnly, now)._tag !== "done";
    }),
  );

  it(
    "says an open ask whenever one is open and the ticket is not finished: an open ask always wins",
    holds((t, now) => {
      const open = openAsksOf(t);
      const finished = mergedSince(t) || closedNow(t);
      const head = headOf(t, now);

      if (finished || open.length === 0) {
        return head._tag !== "asks";
      }

      return head._tag === "asks" && same(head.asks, open);
    }),
  );

  it("keeps an open ask open through a comment, from a person or an agent: a comment is never an answer", () =>
    fc.assert(
      fc.property(timeline, gap, writer, (t, g, by) => {
        const commented = append(t, by, { type: "commented", body: "approve" });
        expect(openAsksOf(commented)).toEqual(openAsksOf(t));
        const before = headOf(t, nowOf(t, g));
        const after = headOf(commented, nowOf(t, g));
        return before._tag !== "asks" || after._tag === "asks";
      }),
      OPTS,
    ));

  it("is never done or closed again just after a reopen", () =>
    fc.assert(
      fc.property(timeline, gap, (t, g) => {
        const head = headOf(append(t, owner, { type: "reopened" }), nowOf(t, g));
        return head._tag !== "done" && head._tag !== "closed";
      }),
      OPTS,
    ));

  it(
    "says a run is going over idle, however long it runs: a running agent wins over the clock",
    holds((t) => {
      const head = headOf(t, lastAt(t) + 10 * HOUR);
      const ended = new Set(t.flatMap((e) => (e.fact.type === "ended" ? [e.fact.run] : [])));
      const going = t.some((e) => e.fact.type === "started" && !ended.has(e.fact.run));
      const before: readonly Head["_tag"][] = ["done", "closed", "asks"];

      if (before.includes(head._tag)) {
        return true;
      }

      return (head._tag === "running") === going;
    }),
  );

  it("changes with the clock only from next to idle, once the hour is gone", () =>
    fc.assert(
      fc.property(timeline, gap, gap, (t, g, more) => {
        const early = headOf(t, nowOf(t, g));
        const late = headOf(t, nowOf(t, g + more));

        if (early._tag === late._tag) {
          return same(late, early);
        }

        const quiet = nowOf(t, g + more) - lastWorkAt(t);
        return early._tag === "next" && late._tag === "idle" && quiet > HOUR;
      }),
      OPTS,
    ));

  it("is idle only past the hour, and never while a run is going or an ask is open", () =>
    fc.assert(
      fc.property(timeline, gap, (t, g) => {
        const now = nowOf(t, g);
        const head = headOf(t, now);

        if (head._tag !== "idle") {
          return true;
        }

        return now - lastWorkAt(t) > HOUR && openAsksOf(t).length === 0;
      }),
      OPTS,
    ));
});

// ---------------------------------------------------------------- what wakes a ticket

const hints = { kind: "agent", id: "duplicates", for: "owner" } as const;
const watcher = { kind: "agent", id: "watcher", for: "owner" } as const;
type Row = readonly [Entry["by"], Fact];

const MINUTE = 60_000;
/** When the fact under test is written: hours after what came before it, so that ticket is idle. */
const AT = 5 * HOUR;
const FILED: Row = [owner, { type: "filed", title: "Login fails", body: "" }];

/** The ticket from `before`, a minute apart from 0, then `last` at {@link AT}, through the real fold. */
const ticketOf = (before: readonly Row[], last?: Row): readonly Entry[] => {
  const rows = last === undefined ? before : [...before, last];
  const entries = rows.map(([by, fact], i): Entry => ({
    pos: i + 1,
    ticket: 3,
    by,
    at: last !== undefined && i === before.length ? AT : i * MINUTE,
    fact,
  }));
  const { tickets, problems } = fold([], entries);
  expect(problems).toEqual([]);
  return tickets[0]?.timeline ?? [];
};

/** One fact of each kind, by the writer who writes it, after the facts it needs to fit. */
const ONE_OF_EACH: {
  readonly [K in Fact["type"]]: {
    readonly before: readonly Row[];
    readonly by: Entry["by"];
    readonly fact: FactOf<K>;
  };
} = {
  filed: { before: [], by: owner, fact: { type: "filed", title: "Login fails", body: "" } },
  commented: { before: [FILED], by: owner, fact: { type: "commented", body: "Still broken." } },
  closed: { before: [FILED], by: owner, fact: { type: "closed" } },
  reopened: { before: [FILED, [owner, { type: "closed" }]], by: owner, fact: { type: "reopened" } },
  started: {
    before: [FILED],
    by: build,
    fact: { type: "started", run: "r-1", stage: "build", task: null, log: null },
  },
  session: {
    before: [
      FILED,
      [build, { type: "started", run: "r-1", stage: "build", task: null, log: null }],
      [
        build,
        {
          type: "ended",
          run: "r-1",
          stage: "build",
          outcome: { kind: "send", to: "review", why: "built" },
          usd: 0.1,
          input: 10,
          output: 5,
          turns: 3,
        },
      ],
    ],
    by: build,
    fact: { type: "session", run: "r-1", id: "s-1" },
  },
  ended: {
    before: [FILED, [build, { type: "started", run: "r-1", stage: "build", task: null, log: null }]],
    by: build,
    fact: {
      type: "ended",
      run: "r-1",
      stage: "build",
      outcome: { kind: "send", to: "review", why: "built" },
      usd: 0.1,
      input: 10,
      output: 5,
      turns: 3,
    },
  },
  checked: {
    before: [FILED],
    by: build,
    fact: { type: "checked", head: SHA, commands: [], result: "green", failed: [] },
  },
  restarted: {
    before: [FILED],
    by: owner,
    fact: { type: "restarted", from: "build", base: null, onto: SHA },
  },
  planned: { before: [FILED], by: build, fact: { type: "planned", version: 1, tasks: ["t-1"] } },
  pushed: {
    before: [FILED],
    by: build,
    fact: { type: "pushed", head: SHA, commits: [{ sha: SHA, title: "Fix login" }] },
  },
  reviewed: {
    before: [FILED],
    by: build,
    fact: { type: "reviewed", head: SHA, met: 2, of: 2, findings: [] },
  },
  pr: {
    before: [FILED],
    by: watcher,
    fact: { type: "pr", url: "https://github.com/o/r/pull/12", state: "open", head: SHA, checks: [] },
  },
  asked: {
    before: [FILED],
    by: build,
    fact: { type: "asked", ask: "a-1", what: "approve a-1", picks: [...PICKS] },
  },
  carried: {
    before: [FILED],
    by: build,
    fact: { type: "carried", from: SHA, to: "d4e5f6a", why: "same_head" },
  },
  answered: {
    before: [FILED, [build, { type: "asked", ask: "a-1", what: "approve a-1", picks: [...PICKS] }]],
    by: owner,
    fact: { type: "answered", ask: "a-1", pick: "approve", note: "" },
  },
  rated: { before: [FILED], by: owner, fact: { type: "rated", finding: "f-1", says: "noise" } },
  maybe_duplicate: {
    before: [FILED],
    by: hints,
    fact: { type: "maybe_duplicate", of: 4, yes: 0.83 },
  },
  duplicate_rated: {
    before: [FILED, [hints, { type: "maybe_duplicate", of: 4, yes: 0.83 }]],
    by: owner,
    fact: { type: "duplicate_rated", of: 4, says: "dismiss" },
  },
};

const KINDS = Object.keys(WORK) as readonly Fact["type"][];
const WORK_KINDS = KINDS.filter((k) => WORK[k]);
const ADVICE_KINDS = KINDS.filter((k) => !WORK[k]);

/** A fact of advice, by the writer who writes it. A word on a hint never given is kept out by the fold. */
const advice: fc.Arbitrary<Row> = fc.oneof(
  fc
    .constantFrom("fix" as const, "noise" as const)
    .map((says): Row => [owner, { type: "rated", finding: "f-1", says }]),
  fc
    .tuple(fc.constantFrom(4, 5), fc.double({ min: 0, max: 1, noNaN: true }))
    .map(([of, yes]): Row => [hints, { type: "maybe_duplicate", of, yes }]),
  fc
    .tuple(fc.constantFrom(4, 5), fc.constantFrom("accept" as const, "dismiss" as const))
    .map(([of, says]): Row => [owner, { type: "duplicate_rated", of, says }]),
);

/** `rows` after `t`, each `gap` after the one before, through the real fold. */
const appendAll = (t: readonly Entry[], rows: readonly (readonly [Row, number])[]): readonly Entry[] => {
  let at = lastAt(t);
  const more = rows.map(([[by, f], g], i): Entry => {
    at += g;
    return { pos: (t.at(-1)?.pos ?? 0) + i + 1, ticket: 1, by, at, fact: f };
  });
  return fold([], [...t, ...more]).tickets[0]?.timeline ?? [];
};

/** A ticket's timeline with advice mixed in among the work, through the real fold. */
const mixed: fc.Arbitrary<readonly Entry[]> = fc
  .array(
    fc.tuple(
      fc.oneof({ arbitrary: fc.tuple(writer, fact), weight: 3 }, { arbitrary: advice, weight: 2 }),
      fc.nat({ max: 3 * HOUR }),
    ),
    { maxLength: 25 },
  )
  .map((rows) => {
    const filed: Entry = {
      pos: 1,
      ticket: 1,
      by: owner,
      at: 1_000,
      fact: { type: "filed", title: "Login fails", body: "" },
    };
    return appendAll([filed], rows);
  });

describe("what wakes a ticket (label-guidelines.md, L1: nothing decides on advice)", () => {
  it("has a row for every kind of fact a ticket's stream can hold, so a new kind must say if it is work", () => {
    const kinds = Fact.members.map((m) => m.fields.type.literal);
    expect([...KINDS].sort()).toEqual([...kinds].sort());
    expect(Object.keys(ONE_OF_EACH).sort()).toEqual([...kinds].sort());
  });

  it.each(WORK_KINDS)("wakes an idle ticket on a %s fact, and the hour starts again from it", (kind) => {
    const { before, by, fact } = ONE_OF_EACH[kind];
    const t = ticketOf(before, [by, fact]);
    expect(headOf(t, AT + 30 * MINUTE)._tag).not.toBe("idle");
    const later = headOf(t, AT + HOUR + 1);

    if (later._tag === "idle") {
      expect(later.since).toBe(AT);
    }
  });

  it.each(ADVICE_KINDS)("leaves an idle ticket's line as it was on a %s fact, at any time after it", (kind) => {
    const { before, by, fact } = ONE_OF_EACH[kind];
    const was = ticketOf(before);
    const t = ticketOf(before, [by, fact]);
    expect(t).toHaveLength(was.length + 1);
    expect(headOf(was, AT + 30 * MINUTE)._tag).toBe("idle");

    for (const now of [AT, AT + 30 * MINUTE, AT + HOUR + 1, AT + 3 * HOUR]) {
      expect(headOf(t, now)).toEqual(headOf(was, now));
    }
  });

  it("says the same line with every fact of advice taken out, at any time", () =>
    fc.assert(
      fc.property(mixed, gap, (t, g) => {
        const now = nowOf(t, g);
        return same(
          headOf(t, now),
          headOf(
            t.filter((e) => isWork(e)),
            now,
          ),
        );
      }),
      OPTS,
    ));

  it("keeps its line through any advice written after its last fact, at any time after", () =>
    fc.assert(
      fc.property(timeline, fc.array(fc.tuple(advice, gap), { minLength: 1, maxLength: 3 }), gap, (t, rows, g) => {
        const after = appendAll(t, rows);
        const now = nowOf(after, g);
        return same(headOf(after, now), headOf(t, now));
      }),
      OPTS,
    ));

  it("wakes an idle ticket with any work fact that fits, written within the hour", () =>
    fc.assert(
      fc.property(timeline, gap, fc.tuple(writer, fact), fc.nat({ max: HOUR - 1 }), (t, g, [by, f], back) => {
        const now = nowOf(t, g);

        if (headOf(t, now)._tag !== "idle" || !WORK[f.type]) {
          return true;
        }

        const at = Math.max(lastAt(t), now - back);
        const pos = (t.at(-1)?.pos ?? 0) + 1;
        const after = fold([], [...t, { pos, ticket: 1, by, at, fact: f }]).tickets[0]?.timeline;

        if (after === undefined || after.length === t.length) {
          return true;
        }

        const head = headOf(after, now);

        if (head._tag === "idle") {
          return false;
        }

        const later = headOf(after, at + HOUR + 1);
        return later._tag !== "idle" || later.since === at;
      }),
      OPTS,
    ));
});
