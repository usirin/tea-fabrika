import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { reviewInterpret } from "./handlers.ts";
import type { Issue } from "./issue.ts";
import { type Finding, fingerprint, placeOf, type Review, type ReviewInput, type ReviewMsg, review } from "./review.ts";
import { scriptedReviewer, scriptedRouter } from "./scripted.ts";
import type { Relation, ReviewReport } from "./services.ts";

// Review on its own: a change goes in, a verdict comes out. No builder, no
// tests run; the check's facts are given.

const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  goal: "slugify turns a title into a URL slug",
  body: "Make slugify(title) in slugify.js return a URL slug.",
  criteria: [
    { kind: "example", id: "lower", rule: "The slug is lower case", file: "slugify.js", name: "slugify", examples: [{ call: `slugify("Hi")`, result: `"hi"` }] },
  ],
};

const slugifyJs = [
  "// Lower-cases the title and joins its words with dashes.",
  "export function slugify(title) {",
  '  return title.toLowerCase().split(" ").join("-");',
  "}",
  "",
].join("\n");

/** What the check saw: slugify.js, with lines 2 and 3 changed. Line 1 is old. */
const input = (more: Partial<ReviewInput> = {}): ReviewInput => ({
  issue,
  round: 1,
  diff: "+ slugify",
  changed: ["slugify.js"],
  snapshot: { "slugify.js": { text: slugifyJs, lines: [2, 3] } },
  deviations: [],
  open: [],
  ...more,
});

const spaces = { file: "slugify.js", line: 3, quote: 'title.toLowerCase().split(" ")', problem: "Two spaces in a row make two dashes" };
const stale = { file: "slugify.js", line: 1, quote: "// Lower-cases the title", problem: "The comment says what the code says" };
const madeUp = { file: "slugify.js", line: 3, quote: "title.trim()", problem: "Trims twice" };
const report = (findings: ReviewReport["findings"], rechecks: ReviewReport["rechecks"] = []): ReviewReport => ({ findings, rechecks });

/** Drive review from `from` with `msg`. */
async function step(from: Review, msg: ReviewMsg, reviews?: readonly (ReviewReport | "fail")[], routes: Readonly<Record<string, Relation>> = {}) {
  const reviewer = scriptedReviewer(reviews);
  const router = scriptedRouter(routes);
  const result = await Effect.runPromise(
    drive(review, from, msg, reviewInterpret).pipe(Effect.provide(Layer.mergeAll(reviewer.layer, router.layer))),
  );
  const cmds = result.trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : []));
  return { ...result, cmds, asked: router.asked, requests: reviewer.requests };
}
const run = (i: ReviewInput, reviews?: readonly (ReviewReport | "fail")[], routes?: Readonly<Record<string, Relation>>) =>
  step({ phase: "idle" }, { type: "start", input: i }, reviews, routes);

describe("where a finding's quote sits", () => {
  const snapshot = input().snapshot;

  it("is in the diff when the line was changed and holds the quote", () => {
    expect(placeOf(snapshot, spaces)).toBe("in_diff");
  });

  it("is outside the diff on a line the change did not touch", () => {
    expect(placeOf(snapshot, stale)).toBe("outside_diff");
  });

  it("is missing when the line does not say what the finding quotes", () => {
    expect(placeOf(snapshot, madeUp)).toBe("missing");
    expect(placeOf(snapshot, { ...spaces, line: 99 })).toBe("missing");
    expect(placeOf(snapshot, { ...spaces, file: "other.js" })).toBe("missing");
    expect(placeOf(snapshot, { ...spaces, quote: "   " })).toBe("missing");
  });
});

describe("review", () => {
  it("passes a change with nothing outside the ticket and nothing found", async () => {
    const { state, cmds } = await run(input(), [report([])]);

    expect(state).toEqual({ phase: "passed", deviations: [], notes: [] });
    expect(cmds).toEqual(["inspect"]);
  });

  it("fails a change to a file nobody named or listed, before any agent reads it", async () => {
    const { state, cmds } = await run(input({ changed: ["slugify.js", "util.js"] }));

    expect(state).toMatchObject({ phase: "failed", feedback: expect.stringContaining("util.js, which no criterion names") });
    expect(cmds).toEqual([]);
  });

  it("asks the router about a listed extra change, and reads only once it serves the ticket", async () => {
    const helper = { file: "util.js", why: "a trim helper slugify uses" };
    const { state, cmds } = await run(
      input({ changed: ["slugify.js", "util.js"], deviations: [helper] }),
      [report([])],
      { [helper.why]: "related" },
    );

    expect(cmds).toEqual(["route", "inspect"]);
    expect(state).toEqual({ phase: "passed", deviations: [helper], notes: [] });
  });

  it("throws away a finding whose quote is not there", async () => {
    const { state, asked } = await run(input(), [report([madeUp])]);

    expect(state).toEqual({ phase: "passed", deviations: [], notes: [] });
    expect(asked).toEqual([]);
  });

  it("files a finding on a line the change did not touch, and does not block on it", async () => {
    const { state, asked } = await run(input(), [report([stale])]);

    expect(state).toMatchObject({ phase: "passed", notes: [{ id: "r1-1", ...stale }] });
    expect(asked).toEqual([]);
  });

  it("fails on a finding the router says is this ticket's, with the finding for the builder", async () => {
    const { state } = await run(input(), [report([spaces])], { [spaces.problem]: "related" });

    expect(state).toMatchObject({ phase: "failed", open: [{ id: "r1-1", ...spaces }] });
    expect(state.phase === "failed" && state.feedback).toContain(`[r1-1] slugify.js:3`);
  });

  it("files a finding the router says is not this ticket's", async () => {
    const { state } = await run(input(), [report([spaces])], { [spaces.problem]: "unrelated" });

    expect(state).toMatchObject({ phase: "passed", notes: [{ id: "r1-1" }] });
  });

  it("parks a finding the router is unsure about, and a person decides", async () => {
    const { state: parked } = await run(input(), [report([spaces])], {});
    const fix = await step(parked, { type: "answer", answer: { park: "finding_unsure", answer: { kind: "decide", fix: ["r1-1"] } } });
    const note = await step(parked, { type: "answer", answer: { park: "finding_unsure", answer: { kind: "decide", fix: [] } } });

    expect(parked).toMatchObject({ phase: "parked", why: { kind: "finding_unsure", findings: [{ id: "r1-1" }] } });
    expect(fix.state).toMatchObject({ phase: "failed", open: [{ id: "r1-1" }] });
    expect(note.state).toMatchObject({ phase: "passed", notes: [{ id: "r1-1" }] });
  });

  describe("an open finding from an earlier round", () => {
    const open: Finding = { id: "r1-1", ...spaces, seen: fingerprint(slugifyJs) };
    const rewritten = slugifyJs.replace('split(" ")', "split(/ +/)");
    const later = (text: string) => input({ round: 2, open: [open], snapshot: { "slugify.js": { text, lines: [2, 3] } } });
    const says = (fixed: boolean) => [report([], [{ id: "r1-1", fixed }])];

    it("stays open when the reviewer says it is not fixed, or says nothing", async () => {
      expect((await run(later(rewritten), says(false))).state).toMatchObject({ phase: "failed", open: [open] });
      expect((await run(later(rewritten), [report([])])).state).toMatchObject({ phase: "failed", open: [open] });
    });

    it("closes when the reviewer says it is fixed and the file has changed", async () => {
      const { state, requests } = await run(later(rewritten), says(true));

      expect(state).toMatchObject({ phase: "passed" });
      expect(requests[0]?.open).toEqual([open]);
    });

    it("stays open when the reviewer says fixed but nobody touched the file", async () => {
      expect((await run(later(slugifyJs), says(true))).state).toMatchObject({ phase: "failed", open: [open] });
    });

    it("closes when its file is out of the change altogether", async () => {
      expect((await run(input({ round: 2, open: [open], snapshot: {} }), says(true))).state).toMatchObject({ phase: "passed" });
    });
  });

  it("names a later round's findings apart from the first's", async () => {
    const { state } = await run(input({ round: 2 }), [report([spaces])], { [spaces.problem]: "related" });

    expect(state).toMatchObject({ phase: "failed", open: [{ id: "r2-1" }] });
  });

  it("parks when the reviewer fails, and reads again on retry", async () => {
    const { state: parked } = await run(input(), ["fail"]);
    const retried = await step(parked, { type: "answer", answer: { park: "reviewer_failed", answer: { kind: "retry" } } }, [report([])]);

    expect(parked).toMatchObject({ phase: "parked", why: { kind: "reviewer_failed" } });
    expect(retried.state).toMatchObject({ phase: "passed" });
  });

  it("ends dropped when a person drops it", async () => {
    const { state: parked } = await run(input(), ["fail"]);
    const dropped = await step(parked, { type: "answer", answer: { park: "reviewer_failed", answer: { kind: "drop" } } });

    expect(dropped.state).toEqual({ phase: "dropped", why: { kind: "reviewer_failed" } });
  });
});
