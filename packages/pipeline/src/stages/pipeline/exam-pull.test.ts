import { describe, expect, it } from "vitest";
import type { ExamChange } from "../exam/machine.ts";
import { examCriteria, folderWords } from "./exam-pull.ts";

// Today's version. The exam pull request's criteria, made by code from the plan's `exam` list, never
// by an agent (self-fix PR 10, Part 2). One per change, in the plan's order: e1, e2, ..., version 1.
// Each says what the person reads today.

const RULE: ExamChange = {
  path: ".oxlintrc.json",
  change: "turn on no-floating-promises",
  why: "a dropped Effect never runs",
};

const WORKFLOW: ExamChange = {
  path: ".github/workflows/ci.yml",
  change: "run the laws on every push",
  why: "a law that never runs proves nothing",
};

describe("the exam pull request's criteria", () => {
  it("are one per change the plan lists, e1 first, each version 1, in the plan's words", () => {
    expect(examCriteria([RULE, WORKFLOW])).toEqual([
      {
        id: "e1",
        version: 1,
        text: "When a reviewer reads `.oxlintrc.json` on this pull request, it does this: turn on no-floating-promises, because a dropped Effect never runs",
      },
      {
        id: "e2",
        version: 1,
        text: "When a reviewer reads `.github/workflows/ci.yml` on this pull request, it does this: run the laws on every push, because a law that never runs proves nothing",
      },
    ]);
  });

  it("keep the plan's order, so the same plan gives the same ids", () => {
    expect(examCriteria([WORKFLOW, RULE]).map((c) => c.text)).toEqual(
      examCriteria([WORKFLOW, RULE]).map((c) => c.text),
    );
    expect(examCriteria([WORKFLOW, RULE])[0]?.text).toContain(WORKFLOW.path);
  });

  it("are none for a plan with no rule change", () => {
    expect(examCriteria([])).toEqual([]);
  });
});

// What the exam writer's brief says its folder holds, which its first turn reads: main on the first
// writing and on a redo on main, the pull request's head on any other redo.
describe("what the exam writer's folder holds, in its brief", () => {
  const HEAD = "1a4882b8";
  const WHY = ["`no-floating-promises` is still off"];

  it("on the first writing: main", () => {
    expect(folderWords(undefined)).toMatch(/your folder holds main\b/i);
  });

  it("on a redo: the pull request's head, with the last changes, and never main", () => {
    const words = folderWords({ head: HEAD, why: WHY });
    expect(words).toMatch(/your folder holds the pull request's head, with your last changes/i);
    expect(words).not.toMatch(/\bmain\b/i);
  });

  it("on a redo on main: main, without the last changes", () => {
    expect(folderWords({ head: HEAD, why: WHY, on: "main" })).toMatch(
      /your folder holds main, without your last changes/i,
    );
  });
});
