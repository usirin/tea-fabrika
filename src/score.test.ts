import { describe, expect, it } from "vitest";
import type { Criterion, Issue } from "./issue.ts";
import type { ReplayIssue } from "./replay.ts";
import { endOf, scoreLevel, scoreTable, scoreTriage, type TriageOutcome } from "./score.ts";

const replay: ReplayIssue = {
  number: 7,
  title: "stop leaves a child in the table",
  labelsAtClose: { type: "type:bug", priority: "p1" },
  useFor: ["triage", "lane"],
  rawReport: "run.stop() leaves the child in `packages/tea/src/effect/children.ts`",
  seed: { from: "original-report block", filedBy: "agent" },
  filesChanged: [
    { path: ".changeset/x.md", additions: 3, deletions: 0, kind: "changeset" },
    { path: "packages/tea/docs/reference/effect.md", additions: 9, deletions: 0, kind: "generated" },
    { path: "packages/tea/docs/how-to/run-many-machines.md", additions: 4, deletions: 2, kind: "docs" },
    { path: "packages/tea/src/effect/children.ts", additions: 20, deletions: 3, kind: "src" },
    { path: "packages/tea/src/effect/handle.ts", additions: 5, deletions: 1, kind: "src" },
    { path: "packages/tea/src/effect/children.test.ts", additions: 40, deletions: 0, kind: "test" },
    { path: "packages/tea/src/effect/stop.test.ts", additions: 30, deletions: 0, kind: "test" },
  ],
  testsAdded: [{ path: "packages/tea/src/effect/children.test.ts", status: "changed", names: ["drops a stopped child"] }],
  level: "runtime",
  preMonorepoLayout: false,
  notes: [],
  pr: { number: 8, baseSha: "b", mergeSha: "m" },
};

/** The PR's files that existed when the issue was filed: all but the new stop test. */
const atFiling = new Set([
  "packages/tea/docs/how-to/run-many-machines.md",
  "packages/tea/src/effect/children.ts",
  "packages/tea/src/effect/handle.ts",
  "packages/tea/src/effect/children.test.ts",
]);
const filing = { files: atFiling, teaAtRoot: false };

const example: Criterion = {
  kind: "example",
  id: "drop",
  rule: "a stopped child leaves the table",
  file: "packages/tea/src/effect/children.ts",
  name: "stopChild",
  uses: [{ name: "defineMachine", file: "packages/tea/src/pure/core.ts" }],
  examples: [{ call: "stopChild(t, 1).size", result: "0" }],
};
const docRule: Criterion = {
  kind: "unchecked",
  id: "doc",
  rule: "the how-to says what stop does",
  files: ["packages/tea/docs/how-to/run-many-machines.md", "packages/tea/README.md"],
  about: "doc",
  why: "prose",
};
const guard: Criterion = {
  kind: "type",
  id: "keep",
  rule: "spawn keeps its signature",
  files: ["packages/tea/src/effect/spawn.ts"],
  uses: [{ name: "spawn", file: "packages/tea/src/effect/spawn.ts" }],
  snippets: [
    { expect: "rejects", today: "holds", code: "// @ts-expect-error\nspawn()" },
    { expect: "compiles", today: "fails", code: "spawn(m)" },
  ],
};

const issue = (...criteria: [Criterion, ...Criterion[]]): Issue => ({
  id: "7",
  title: "t",
  goal: "g",
  body: "b",
  criteria,
  openDecision: null,
});

const outcome = (over: Partial<TriageOutcome> = {}): TriageOutcome => ({
  issue: issue(example, docRule, guard),
  sort: { type: "bug", priority: "p2", value: "keep" },
  vetted: [2, 0],
  end: "triaged",
  ...over,
});

describe("scoring triage's files", () => {
  const { files } = scoreTriage(replay, outcome(), filing);

  it("compares src files: one named of two changed, and every named one was changed", () => {
    expect(files.src).toMatchObject({
      hits: ["packages/tea/src/effect/children.ts"],
      precision: 1 / 2,
      recall: 1 / 2,
    });
    // Ours: children.ts (example) and spawn.ts (the type rule); the PR changed children.ts and handle.ts.
    expect(files.src.ours).toEqual(["packages/tea/src/effect/children.ts", "packages/tea/src/effect/spawn.ts"]);
  });

  it("counts a test file the PR added apart: nobody could name it, so recall over existing files leaves it out", () => {
    expect(files.test).toMatchObject({ ours: [], added: ["packages/tea/src/effect/stop.test.ts"], recall: 0, recallExisting: 0, precision: null });
  });

  it("scores docs on their own, and leaves changesets and generated pages out", () => {
    expect(files.docs).toMatchObject({ hits: ["packages/tea/docs/how-to/run-many-machines.md"], precision: 1 / 2, recall: 1 });
    expect(Object.values(files).flatMap((f) => f.theirs)).not.toContain(".changeset/x.md");
    expect(Object.values(files).flatMap((f) => f.theirs)).not.toContain("packages/tea/docs/reference/effect.md");
  });
});

describe("an issue filed before tea moved to packages/tea, fixed after", () => {
  it("reads our root paths the way the PR names them", () => {
    const atRoot: Criterion = { ...example, file: "src/effect/children.ts", uses: [] };
    const score = scoreTriage(replay, outcome({ issue: issue(atRoot) }), { files: atFiling, teaAtRoot: true });
    expect(score.files.src.hits).toEqual(["packages/tea/src/effect/children.ts"]);
    expect(score.caught.files).toEqual(["packages/tea/src/effect/children.ts"]);
  });
});

describe("scoring the level", () => {
  it("reads examples as runtime, type rules as type, doc rules as docs: together, mixed, for half credit", () => {
    expect(scoreLevel(issue(example, docRule, guard), "runtime")).toEqual({
      ours: "mixed",
      from: ["docs", "runtime", "type"],
      theirs: "runtime",
      credit: 0.5,
    });
  });

  it("gives full credit for the same level, none for another, and none when ours says nothing", () => {
    expect(scoreLevel(issue(example), "runtime").credit).toBe(1);
    expect(scoreLevel(issue(guard), "runtime").credit).toBe(0);
    const other: Criterion = { ...docRule, kind: "unchecked", about: "other" };
    expect(scoreLevel(issue(other), "mixed")).toMatchObject({ ours: "none", credit: 0 });
  });

  it("reads an existing test of a doc page as docs, and any other existing test as runtime", () => {
    const twin: Criterion = { kind: "existing_test", id: "t", rule: "r", test: "packages/tea/src/docs/how-to/x.test.ts", files: [] };
    const plain: Criterion = { kind: "existing_test", id: "u", rule: "r", test: "packages/tea/src/effect/children.test.ts", files: [] };
    expect(scoreLevel(issue(twin), "docs").ours).toBe("docs");
    expect(scoreLevel(issue(plain), "docs").ours).toBe("runtime");
  });
});

describe("scoring the rest", () => {
  const score = scoreTriage(replay, outcome(), filing);

  it("compares type and priority with the labels at close, and says what always-p1 would have scored", () => {
    expect(score.type).toEqual({ ours: "bug", theirs: "bug", match: true });
    expect(score.priority).toEqual({ ours: "p2", theirs: "p1", match: false, p1Baseline: true });
  });

  it("counts checked and unchecked criteria, examples, snippets and guards", () => {
    expect(score.criteria).toEqual({
      total: 3,
      checked: 2,
      unchecked: 1,
      examples: 1,
      snippets: 2,
      guards: 1,
      existingTests: 0,
      uncheckedAbout: { type: 0, doc: 1, other: 0 },
    });
  });

  it("says vetting passed on the second draft", () => {
    expect(score.vetting).toEqual({ drafts: 2, passed: true, problems: [2, 0] });
    expect(scoreTriage(replay, outcome({ vetted: [3, 1, 1] }), filing).vetting.passed).toBe(false);
  });

  it("says the checks touch the fix when a checked criterion imports a changed file; an unchecked rule's files do not count", () => {
    expect(score.caught).toEqual({ yes: true, files: ["packages/tea/src/effect/children.ts"], prTests: [] });
    const onlyDocs = scoreTriage(replay, outcome({ issue: issue(docRule, guard) }), filing);
    expect(onlyDocs.caught.yes).toBe(false);
  });

  it("names a PR test our existing-test criterion runs", () => {
    const runs: Criterion = { kind: "existing_test", id: "t", rule: "r", test: "packages/tea/src/effect/children.test.ts", files: [] };
    expect(scoreTriage(replay, outcome({ issue: issue(runs) }), filing).caught.prTests).toEqual([
      "packages/tea/src/effect/children.test.ts",
    ]);
  });

  it("scores a run that never got a rewrite or a sort as nothing found", () => {
    const empty = scoreTriage(replay, outcome({ issue: null, sort: null, vetted: [], end: "parked:enricher_failed" }), filing);
    expect(empty).toMatchObject({
      level: null,
      criteria: null,
      type: { ours: null, match: false },
      vetting: { drafts: 0, passed: false },
      caught: { yes: false },
    });
    expect(empty.files.src.recall).toBe(0);
  });
});

describe("where triage stopped", () => {
  const knobs = { sortFloor: 0.8, vetTries: 3 };
  const held = { raw: { id: "7", title: "t", body: "b", filedBy: "agent" as const }, session: null, facts: null, knobs };

  it("is the phase, with why when it parked or was killed", () => {
    expect(endOf({ phase: "idle" })).toBe("idle");
    expect(endOf({ phase: "parked", id: "7", knobs, why: { kind: "tracker_failed" } })).toBe("parked:tracker_failed");
    expect(endOf({ phase: "killed", ...held, clause: "process_ceremony" })).toBe("killed:process_ceremony");
  });
});

describe("the score table", () => {
  it("has one row per run and totals beside the always-p1 baseline", () => {
    const table = scoreTable([{ score: scoreTriage(replay, outcome(), filing), cost: { claudeUsd: 1.234, jevCalls: 1 } }]);
    expect(table).toContain("| #7 | triaged | bug / bug | p2 / p1 ✗ | mixed / runtime (0.5) | 50% / 50% | - / 0% (0%) | 50% / 100% | 2 / 3 | passed, 2 draft(s) [2,0] | yes (1) | 1.23 | 1 |");
    expect(table).toContain("Totals: type 1/1; priority 0/1 (always p1: 1/1); level 0.5/1; vetting passed 1/1; caught 1/1; Claude $1.23.");
  });
});
