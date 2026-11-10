import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YES, keptAsLegacy, lane } from "./lane-harness.ts";

// The exam's side tree, after a plan restarts to a new version. The shared setup is in
// ./lane-harness.ts. Today's version.

// Self-fix PR 10, Part 1: the side tree starts from main on the first landing of each plan version.
// Today it is made once and reused, so a second exam landing after a plan restart commits on top of the
// old rule changes, on an old main (experiment 193's new hole).
describe("the exam's side tree, after a plan restarts to a new version", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const RULE = ".oxlintrc.json";
  const FAULT = "The rules list is not empty: it turns on a rule the plan never named.";
  const FAILS_E1 = {
    with: {
      rows: [{ id: "e1", grade: "fail", where: [{ file: RULE, first: 1, last: 1 }], says: FAULT }],
      findings: [
        {
          kind: "review-code",
          from: { source: "criterion", id: "e1" },
          fault: FAULT,
          at: { file: RULE, first: 1, last: 1 },
          proof: "Read from the file.",
          wants: "The rules list is empty, as the plan says.",
          seen: "read",
        },
      ],
      skipped: [],
    },
  };
  const remoteGit = (remote: string, ...args: readonly string[]) =>
    execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  const isAncestor = (remote: string, older: string, newer: string) => {
    try {
      remoteGit(remote, "merge-base", "--is-ancestor", older, newer);
      return true;
    } catch {
      return false;
    }
  };

  it("a plan written again as version 2 lands its exam on a side tree from main, not on version 1's rule changes", async () => {
    const ran = await lane({
      title: "[rules] Read names in one form",
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      // Version 1's exam review fails each round, and the person stops it. The line typed again
      // finds a save and a ticket from before the lane kept its carry, so the fold names `plan`,
      // and the plan runs again, as version 2.
      fake: { answers: { review: [FAILS_E1, FAILS_E1, FAILS_E1] } },
      beforeCarries: true,
      again: [{ between: ({ home }) => keptAsLegacy(home) }],
    });
    const said = ran.lines.join("\n");
    const versions = ran.facts.filter((f) => f.type === "planned").map((f) => f.version);
    expect(versions, said).toEqual([1, 2]);
    // Only the exam's reviews carry `pr` (`bodies.exam_review` in program.ts); the lane's own
    // review (`bodies.review`) does not, and since 194 that one stands on the main that merged the
    // exam.
    const heads = ran.facts
      .filter((f) => f.type === "reviewed" && "pr" in f && f.pr !== undefined)
      .map((f) => String(f.head));
    expect(heads.length, said).toBeGreaterThan(3);
    const first = heads[0] ?? "";
    const last = heads.at(-1) ?? "";
    expect(last).not.toBe(first);
    expect(isAncestor(ran.remote, first, last), "version 2's exam stands on version 1's").toBe(false);
  });
});
