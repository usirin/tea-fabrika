import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YES,
  type Ran,
  TIMED_OUT,
  pushToMain,
  lane,
  onMain,
  onMainHead,
  descends,
  codexRuns,
  foldsAsSaved,
  askedFor,
  RULES,
  RULE,
  FAULT,
  FAILS_E1,
  exams,
  endOf,
} from "./lane-harness.ts";

// The exam's pull request: its review, its merge question, its rule file's format, and main moving
// under it. The shared setup is in ./lane-harness.ts. Today's version.

// ---------------------------------------------------------------- the exam's pull request (self-fix PR 10)
//
// The exam's pull request is formatted, reviewed and fixed by the lane, before a person is asked to merge
// it. A failed review goes back to the exam writer, never the builder, and the builder never starts
// before `exam_merge` ends done. The exam review runs the review step's own brief over the exam's
// pull request, so the fake `codex` answers it as a `review` run, the first runs of that step.

describe("the exam's pull request", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The plan's one rule change, as the fake plan writes it (fixtures/pipeline-lane/codex.mjs). */
  const E1 =
    "When a reviewer reads `.oxlintrc.json` on this pull request, it does this: add an empty rules list, because the plan needs it";

  const pullOfExam = (ran: Ran) =>
    ran.facts
      .filter((f) => f.type === "ended" && f.stage === "exam")
      .map((f) => (f.carry as { readonly examPr?: string } | undefined)?.examPr);

  const lastEndOf = (ran: Ran, stage: string) =>
    ran.facts.findLastIndex((f) => f.type === "ended" && f.stage === stage);

  // scenario: the real lane's exam writer and reviewer run on a temporary git repository.
  it("scenario: is reviewed against the plan's own words before the person is asked, and the ask says what the review met", async () => {
    const ran = await lane({ title: RULES, picks: YES });
    const said = ran.lines.join("\n");
    expect(ran.lines.at(-1), said).toContain("ended: done");
    const [pr] = pullOfExam(ran);
    expect(pr, said).toEqual(expect.any(String));
    const reviewed = ran.facts.findIndex((f) => f.type === "reviewed" && f.pr === pr);
    const asked = ran.facts.findIndex((f) => f.type === "asked" && String(f.ask).startsWith("a-exam_merge-"));
    expect(reviewed, said).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(reviewed);
    expect(ran.facts[reviewed]).toMatchObject({ met: 1, of: 1 });
    expect(String((ran.facts[asked]?.shows as { what: string } | undefined)?.what)).toContain(
      "The review met 1 of 1, and the checks passed at",
    );
    // The review read the criterion code made from the plan's list, never one an agent wrote.
    const review = codexRuns(ran.dir).find((r) => r.step === "review");
    expect(review?.prompt).toContain(`- e1: ${E1}`);
  });

  it("a review that fails e1 runs the exam step again from the exam head, with the finding, on the same pull request, and the build waits", async () => {
    const ran = await lane({ title: RULES, picks: YES, fake: { answers: { review: [FAILS_E1] } } });
    const said = ran.lines.join("\n");
    expect(ran.lines.at(-1), said).toContain("ended: done");
    const runs = exams(ran);
    expect(runs, said).toHaveLength(2);
    expect(runs[1]?.prompt).toContain(FAULT);
    const prs = pullOfExam(ran);
    expect(prs).toHaveLength(2);
    expect(prs[1]).toBe(prs[0]);
    // Nothing of the lane's own starts before the rule changes merged.
    const merged = lastEndOf(ran, "exam_merge");
    expect(merged, said).toBeGreaterThan(-1);
    expect(endOf(ran, "test_writer")).toBeGreaterThan(merged);
    expect(endOf(ran, "build")).toBeGreaterThan(merged);
    expect(ran.facts.slice(0, merged).filter((f) => f.type === "started" && f.stage === "build")).toEqual([]);
  });

  it("a review that keeps failing runs the exam step 3 times, then asks rounds_spent, and its stop folds as it was saved", async () => {
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fold: true,
      fake: { answers: { review: [FAILS_E1, FAILS_E1, FAILS_E1, FAILS_E1] } },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(exams(ran)).toHaveLength(3);
    expect(askedFor(ran, "rounds_spent")).toHaveLength(1);
    expect(ran.stages).not.toContain("test_writer");
    expect(ran.stages).not.toContain("build");
    foldsAsSaved(ran, 0);
  });

  it("the exam's merge question, left unanswered: the fold of the facts goes on at it, with the review the lane held", async () => {
    const ran = await lane({
      title: RULES,
      picks: { approve: "approve" },
      leave: ["exam_merge"],
      fold: true,
    });
    const said = ran.lines.join("\n");
    expect(ran.stages, said).toContain("exam_review");
    expect(askedFor(ran, "exam_merge"), said).toHaveLength(1);
    // Waiting on the person, the lane is asking: the fold of its facts goes on at the same question.
    const folded = ran.folds[0];
    expect(typeof folded === "string" ? folded : folded?.at).toMatchObject({
      _tag: "ask",
      for: "exam_merge",
    });
    expect(typeof folded === "string" ? folded : folded?.held.carry).toMatchObject({
      examPull: { reviewed: { met: 1, of: 1 } },
    });
  });

  it("a rule file the exam writer wrote with spaces lands formatted, on a repository that names its formatter", async () => {
    const ran = await lane({
      title: RULES,
      picks: YES,
      formatter: true,
      fake: { answers: { exam: [{ with: { files: [{ path: RULE, text: '{\n  "rules": {}\n}\n' }] } }] } },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines.at(-1), said).toContain("ended: done");
    expect(onMain(ran.remote, RULE)).toBe('{\n\t"rules": {}\n}\n');
  });

  it("with no formatter named, the rule file lands as written, and the ticket says so once", async () => {
    const ran = await lane({
      title: RULES,
      picks: YES,
      fake: { answers: { exam: [{ with: { files: [{ path: RULE, text: '{\n  "rules": {}\n}\n' }] } }] } },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines.at(-1), said).toContain("ended: done");
    expect(onMain(ran.remote, RULE)).toBe('{\n  "rules": {}\n}\n');
    const lines = ran.facts.filter(
      (f) => f.type === "commented" && String(f.body).startsWith("This repository names no formatter"),
    );
    expect(lines).toHaveLength(1);
  });

  it("main moves while the exam's checks run: ship refuses its merge, and the exam's pull request keeps ship's words", async () => {
    const ran = await lane({
      title: RULES,
      picks: YES,
      // The exam review's checks are the lane's first: main moves under them, once.
      checksSay: (_head, nth, where) => {
        if (nth === 0) {
          pushToMain(where, [{ path: "docs/elsewhere.md", text: "Written elsewhere.\n" }]);
        }

        return null;
      },
    });
    const said = ran.lines.join("\n");
    // Behind: main goes into the exam's branch, its review runs again, and it lands.
    expect(ran.lines.at(-1), said).toContain("ended: done");
    const refused = ran.facts.find((f) => f.type === "ended" && f.stage === "exam_merge");
    expect(refused?.outcome, said).toMatchObject({ kind: "send", to: "builder", why: "behind" });
    expect(refused?.carry).toMatchObject({
      examPull: { why: ["Ship refused the merge: send:builder:behind."] },
    });
  });

  it("ship's conflicts at the exam's merge: the exam writer's redo stands on main, which it was told to write on", async () => {
    let moved = "";
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      // Main changes the rule file under the exam review's checks, the lane's first, once.
      checksSay: (_head, nth, where) => {
        if (nth === 0) {
          pushToMain(where, [{ path: RULE, text: '{"main": 1}\n' }]);
          moved = onMainHead(where.remote);
        }

        return null;
      },
    });
    const said = ran.lines.join("\n");
    const ends = ran.facts.filter((f) => f.type === "ended");
    const refused = ends.findIndex((f) => f.stage === "exam_merge");
    expect(ends[refused]?.outcome, said).toMatchObject({
      kind: "send",
      to: "builder",
      why: "conflicts",
    });
    const redo = ends.slice(refused).find((f) => f.stage === "exam");
    const head = (redo?.carry as { readonly examPull?: { readonly head: string } } | undefined)?.examPull?.head;
    expect(head, said).toMatch(/^[0-9a-f]{40}$/);
    expect(descends(ran.remote, head ?? "", head ?? ""), "the redo's head is pushed").toBe(true);
    expect(descends(ran.remote, moved, head ?? ""), "the redo's head takes main").toBe(true);
  });
});
