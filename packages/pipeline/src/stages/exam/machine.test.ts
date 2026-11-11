import { describe, expect, it } from "vitest";
import { type ExamAsk, exam, examSub } from "./machine.ts";

// What the exam writer's first run is told on a redo, by where the redo is written (self-fix PR 10).
// Today's version.

const HEAD = "3".repeat(40);
const WHY = ["Ship refused the merge: send:builder:conflicts."];

const ASK: ExamAsk = {
  ticket: "o/r#1",
  number: 1,
  base: "b",
  changes: [{ path: ".oxlintrc.json", change: "add an empty rules list", why: "the plan needs it" }],
  tries: 3,
};

/** The prompt the first run of `ask` carries. */
const firstPrompt = (ask: ExamAsk): string => {
  const [s] = exam.update.start({ phase: "idle" }, { type: "start", ask, key: "k" });
  return examSub.deps(s)?.prompt ?? "";
};

describe("an exam redo's first prompt", () => {
  it("says it is on main when main does not merge into the head it was sent back from", () => {
    expect(firstPrompt({ ...ASK, redo: { head: HEAD, why: WHY, on: "main" } })).toMatch(/\bon main\b/i);
  });

  it("never says main when the redo is written on the pull request's head", () => {
    expect(firstPrompt({ ...ASK, redo: { head: HEAD, why: WHY } })).not.toMatch(/\bon main\b/i);
  });
});
