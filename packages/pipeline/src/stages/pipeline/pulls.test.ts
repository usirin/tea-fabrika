import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Ledger } from "../../asks/ledger.ts";
import { CriteriaRecord, heldOf } from "../../criteria/record.ts";
import type { TicketId } from "../../ids.ts";
import { Tickets } from "../../tickets/tickets.ts";
import type { Given, Now } from "./carry.ts";
import { examBook } from "./exam-pull.ts";
import { carriedOf, examTicket, judgedAt, LanePulls, lanePulls, laneRecord, type Pull, yesOf } from "./pulls.ts";
import { LaneWork } from "./work.ts";

// Today's version. Reads of the lane's pull requests that need no git: what a person's `merge`
// binds to, how the verdicts posted on a pull stand at a head, and the book an exam's ticket reads.

const PULL: Pull = {
  id: "local:7",
  kind: "lane",
  ticket: 7,
  branch: "lane/7",
  head: "A",
  tree: "t",
  state: "open",
  title: "t",
  body: "b",
  verdicts: [{ kind: "review-code", verdict: "pass" }],
};

const person = { kind: "user" };
const lane = { kind: "code" };

describe("what a person's merge binds to", () => {
  const asked = (head?: string) => ({
    by: lane,
    fact: { type: "asked", ask: "a-merge-1", ...(head === undefined ? {} : { head }) },
  });
  const merge = (head?: string) => ({
    by: person,
    fact: {
      type: "answered",
      ask: "a-merge-1",
      pick: "merge",
      ...(head === undefined ? {} : { head }),
    },
  });

  it("an answer with no head, to an ask that kept one, binds to the ask's head", () => {
    expect(yesOf({ timeline: [asked("H"), merge()] }, PULL)).toEqual({ _tag: "asked", head: "H" });
  });

  it("an answer's own head comes before the ask's", () => {
    expect(yesOf({ timeline: [asked("H"), merge("K")] }, PULL)).toEqual({ _tag: "asked", head: "K" });
  });

  it("with no head on either, it is unbound: said before self-fix PR 10", () => {
    expect(yesOf({ timeline: [asked(), merge()] }, PULL)).toEqual({ _tag: "unbound" });
  });
});

// No git read may run here: every Gather and write dies when called.
const nothingRead = Layer.mergeAll(Layer.mock(LaneWork, { at: () => "" }), Layer.mock(Tickets, {}));

const judged = (pull: Pull, head: string) => Effect.runSync(judgedAt(pull, head).pipe(Effect.provide(nothingRead)));

describe("how the posted verdicts stand at a head", () => {
  const posted: Given = { head: "A", onto: "main", base: "M", diff: "d" };

  it("verdicts judged at the head they were posted at stand there with no hop", () => {
    const at = judged({ ...PULL, posted }, "A");
    expect(at).toEqual(Option.some([]));
    // So the facts name no carry: never a hop from a head to itself.
    expect(carriedOf(at)).toEqual({});
  });

  it("a pull from before, with no `posted`, stands only at its own head", () => {
    expect(judged(PULL, "A")).toEqual(Option.some([]));
    expect(judged(PULL, "B")).toEqual(Option.none());
  });

  it("verdicts carried from the head they were posted at name that one hop", () => {
    const now: Now = { head: "B", tree: "T", replayed: "T", formatted: null, diff: "d", range: "" };
    const work = Layer.mock(LaneWork, { at: () => "", now: () => Effect.succeed(now) });
    const tickets = Layer.mock(Tickets, { write: () => Effect.void });
    const at = Effect.runSync(judgedAt({ ...PULL, posted }, "B").pipe(Effect.provide(Layer.mergeAll(work, tickets))));
    expect(at).toEqual(Option.some([{ from: "A", to: "B" }]));
    expect(carriedOf(at)).toEqual({ carried: [{ from: "A", to: "B" }] });
  });
});

describe("verdicts posted again at a head their diff was carried to", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-pulls-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // Every head reads as given on the same diff, so a carry from one head to the next is kept.
  const given = (head: string): Given => ({ head, onto: "main", base: "M", diff: "d" });
  const now: Now = { head: "B", tree: "T", replayed: "T", formatted: null, diff: "d", range: "" };
  const pullsOn = () =>
    lanePulls.pipe(
      Layer.provide(
        Layer.mock(LaneWork, {
          at: (...parts) => join(dir, ...parts),
          origin: Effect.succeed({ repo: "o/r", remote: "", host: "local" as const }),
          given: (head) => Effect.succeed(given(head)),
          now: () => Effect.succeed(now),
        }),
      ),
    );
  /** Ticket 7's pull row after a pass at `A`, then `second` at `B`. */
  const postedTwice = (second: Pull["verdicts"]) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const pulls = yield* LanePulls;
        const { id: _id, state: _state, verdicts: _verdicts, ...row } = PULL;
        const id = yield* pulls.open(row);
        yield* pulls.post(id, "A", [{ kind: "review-code", verdict: "pass" }]);
        yield* pulls.post(id, "B", second);
        return yield* pulls.find(id);
      }).pipe(Effect.provide(pullsOn())),
    );

  it("the same verdicts keep what they were given on at the first head", async () => {
    const pull = await postedTwice([{ kind: "review-code", verdict: "pass" }]);
    expect(pull).toMatchObject({ head: "B", posted: given("A") });
  });

  it("a fail of the same kind is not the same: it is given on the new head", async () => {
    const pull = await postedTwice([{ kind: "review-code", verdict: "fail" }]);
    expect(pull).toMatchObject({
      head: "B",
      verdicts: [{ kind: "review-code", verdict: "fail" }],
      posted: given("B"),
    });
  });
});

describe("the record ship reads for an exam's ticket", () => {
  const BOOK = examBook([{ path: ".oxlintrc.json", change: "add a rule", why: "the plan needs it" }]);
  const LANDED: Pull = { ...PULL, state: "merged" };
  const EXAM: Pull = {
    ...PULL,
    id: "local:8",
    kind: "exam",
    branch: "exam/7",
    state: "merged",
    book: BOOK,
  };

  it("with none open, reads the book of the exam pull that landed, not the lane's", async () => {
    const read = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* CriteriaRecord).read(examTicket("o/r", 7) as TicketId);
      }).pipe(
        Effect.provide(
          laneRecord.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(Ledger, {}),
                Layer.mock(LaneWork, {
                  at: () => "",
                  side: () => Effect.succeed({ tree: "t", branch: "exam/7", base: "M" }),
                }),
                Layer.mock(LanePulls, {
                  onBranch: () => Effect.succeed(null),
                  landed: () => Effect.succeed([EXAM, LANDED]),
                }),
              ),
            ),
          ),
        ),
      ),
    );
    expect(read).not.toBeNull();
    expect(read).toEqual(heldOf(BOOK));
  });
});
