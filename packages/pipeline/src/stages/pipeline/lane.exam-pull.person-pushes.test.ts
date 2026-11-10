import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NUMBER,
  YES,
  type Ran,
  pushOnTopOf,
  lane,
  descends,
  RULES,
  RULE,
  FAILS_E1,
  exams,
  mainTakesTheRule,
  pullHead,
  keptLines,
  refIn,
  keptPlaces,
} from "./lane-harness.ts";

// The exam's pull request: a redo that only adds, and a person who pushes to the exam branch. The
// shared setup is in ./lane-harness.ts. Today's version.

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

  /** Every kept ref, in the lane's own clone and on the remote. */
  const keptRefs = (ran: Ran) =>
    keptPlaces(ran).flatMap((at) =>
      execFileSync("git", [...at, "for-each-ref", "--format=%(refname)", "refs/kept/"], {
        encoding: "utf8",
        stdio: "pipe",
      })
        .split("\n")
        .filter((line) => line !== ""),
    );

  it("a review's redo on the exam head only adds to the branch: no kept ref, and no ticket line names one", async () => {
    const ran = await lane({ title: RULES, picks: YES, fake: { answers: { review: [FAILS_E1] } } });
    const said = ran.lines.join("\n");
    expect(ran.lines.at(-1), said).toContain("ended: done");
    const heads = ran.facts.filter((f) => f.type === "ended" && f.stage === "exam").map((f) => pullHead(f));
    expect(heads, said).toHaveLength(2);
    const [first = "", second = ""] = heads;
    expect(descends(ran.remote, first, second), "the redo adds to the exam branch").toBe(true);
    expect(keptLines(ran)).toEqual([]);
    expect(keptRefs(ran)).toEqual([]);
  });

  // Option A is for a commit a person pushed to the exam branch. The lane's own head is never at
  // risk: it is in the lane's carry. So what is kept is the branch as the remote holds it when the
  // redo's push replaces it (docs/direction/read-fresh-run-alone.md), and it is kept on the remote,
  // where a person can fetch it and a lost clone does not lose it.
  /** A person's change, on a file no step of the lane writes. */
  const PERSONS = { path: "docs/person.md", text: "A person's note on the rule changes.\n" };
  /** One ticket line names the kept ref and the person's commit, and the remote keeps that commit under the ref. */
  const keptOnRemote = (ran: Ran, pushed: string, old: string, said: string) => {
    const lines = keptLines(ran);
    expect(lines, `one line names the kept ref\n${said}`).toHaveLength(1);
    const line = lines[0] ?? "";
    expect.soft(line, "the line names the person's commit").toContain(pushed.slice(0, 7));
    expect.soft(line, "the line does not name the lane's older head").not.toContain(old.slice(0, 7));
    const ref = refIn(line);
    expect(ref, line).toMatch(/^refs\/kept\/./);
    let tip: string | null = null;

    try {
      tip = execFileSync("git", ["--git-dir", ran.remote, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    } catch {
      // Not on the remote.
    }

    expect.soft(tip, `${ref} is on the remote`).not.toBeNull();
    expect.soft(descends(ran.remote, pushed, tip ?? ""), `${ref} on the remote holds the person's commit`).toBe(true);
  };

  it("a person pushes to the exam branch after its review read it, then ship's conflicts at the exam's merge: the redo on main keeps the person's commit under a kept ref on the remote, and the ticket line names that commit", async () => {
    let pushed = "";
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fake: { see: [RULE] },
      // Under the exam review's checks, the lane's first, after `examReady` read the branch:
      // main takes the rule file, and a person pushes on top of the exam head.
      checksSay: (head, nth, where) => {
        if (nth === 0) {
          pushed = pushOnTopOf(where, head, [PERSONS]);
        }

        return mainTakesTheRule(head, nth, where);
      },
    });
    const said = ran.lines.join("\n");
    const ends = ran.facts.filter((f) => f.type === "ended");
    const refused = ends.findIndex((f) => f.stage === "exam_merge");
    expect(ends[refused]?.outcome, said).toMatchObject({ kind: "send", why: "conflicts" });
    const old = pullHead(ends[refused]);
    expect(old, said).toMatch(/^[0-9a-f]{40}$/);
    expect(pushed, said).toMatch(/^[0-9a-f]{40}$/);
    expect(descends(ran.remote, old, pushed), "the person pushed on top of the exam head").toBe(true);
    const head = pullHead(ends.slice(refused).find((f) => f.stage === "exam"));
    expect(head, said).toMatch(/^[0-9a-f]{40}$/);
    expect(descends(ran.remote, pushed, head), "the redo replaced the branch with the person's commit on it").toBe(
      false,
    );
    keptOnRemote(ran, pushed, old, said);
  });

  it("main's conflicts at the exam's own review, then a person pushes to the exam branch while the redo on main is written: the push keeps the person's commit under a kept ref on the remote, and the ticket line names that commit", async () => {
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fake: {
        answers: { review: [FAILS_E1] },
        see: [RULE],
        // The third exam run is the redo on main: the first is the writing, the second the
        // review's redo on the exam head.
        pushesAt: { exam: { 2: { branch: `exam/${NUMBER}`, ...PERSONS } } },
      },
      checksSay: mainTakesTheRule,
    });
    const said = ran.lines.join("\n");
    const ends = ran.facts.filter((f) => f.type === "ended");
    const refused = ends.findIndex(
      (f) => f.stage === "exam_review" && (f.outcome as { readonly why?: string }).why === "conflicts",
    );
    expect(refused, said).toBeGreaterThan(-1);
    const old = pullHead(ends[refused]);
    expect(old, said).toMatch(/^[0-9a-f]{40}$/);
    const pushed = exams(ran)[2]?.pushed ?? "";
    expect(pushed, said).toMatch(/^[0-9a-f]{40}$/);
    expect(descends(ran.remote, old, pushed), "the person pushed on top of the exam head").toBe(true);
    const head = pullHead(ends.slice(refused).find((f) => f.stage === "exam"));
    expect(head, said).toMatch(/^[0-9a-f]{40}$/);
    expect(descends(ran.remote, pushed, head), "the redo replaced the branch with the person's commit on it").toBe(
      false,
    );
    keptOnRemote(ran, pushed, old, said);
  });

  // The owner's rule (docs/direction/read-fresh-run-alone.md): a stage that must replace a branch
  // keeps the old head under a kept ref first, and says so on the ticket. A redo on the exam head
  // may instead push on top of a person's commit. These tests do not pick which: they pin that the
  // person's commit is not lost, and that a replace is named on the ticket.
  /** Does the remote hold `sha` under `ref`? */
  const remoteHolds = (ran: Ran, ref: string, sha: string): boolean => {
    try {
      const tip = execFileSync(
        "git",
        ["--git-dir", ran.remote, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
        { encoding: "utf8", stdio: "pipe" },
      ).trim();
      return descends(ran.remote, sha, tip);
    } catch {
      return false;
    }
  };
  /**
   * After a redo on the exam head, the person's commit `pushed` is in the redo's head, or a ticket
   * line names it and a kept ref on the remote that holds it.
   */
  const notLost = (ran: Ran, pushed: string, said: string) => {
    const ends = ran.facts.filter((f) => f.type === "ended");
    const sent = ends.findIndex(
      (f) => f.stage === "exam_review" && (f.outcome as { readonly kind?: string }).kind === "send",
    );
    expect(sent, said).toBeGreaterThan(-1);
    const old = pullHead(ends[sent]);
    expect(old, said).toMatch(/^[0-9a-f]{40}$/);
    expect(pushed, said).toMatch(/^[0-9a-f]{40}$/);
    expect(descends(ran.remote, old, pushed), "the person pushed on top of the exam head").toBe(true);
    const head = pullHead(ends.slice(sent).find((f) => f.stage === "exam"));
    expect(head, said).toMatch(/^[0-9a-f]{40}$/);
    const onTop = descends(ran.remote, pushed, head);
    const named = keptLines(ran).filter(
      (line) => line.includes(pushed.slice(0, 7)) && remoteHolds(ran, refIn(line), pushed),
    );
    expect(
      { onTop, named: named.length > 0 },
      `the person's commit ${pushed} is in the redo's head ${head}, or kept on the remote under a ref a ticket line names\n${keptLines(ran).join("\n")}`,
    ).not.toEqual({ onTop: false, named: false });
  };

  it("a person pushes to the exam branch after its review read it, then the review's findings send it back: the redo on the exam head loses no commit, and a replace is named on the ticket", async () => {
    let pushed = "";
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fake: { answers: { review: [FAILS_E1] } },
      // Under the exam review's checks, the lane's first, after `examReady` read the branch.
      checksSay: (head, nth, where) => {
        if (nth === 0) {
          pushed = pushOnTopOf(where, head, [PERSONS]);
        }

        return null;
      },
    });
    const said = ran.lines.join("\n");
    const sent = ran.facts.find((f) => f.type === "ended" && f.stage === "exam_review");
    expect(sent?.outcome, said).toMatchObject({ kind: "send", why: "review_failed" });
    notLost(ran, pushed, said);
  });

  it("a person pushes to the exam branch after its review read it, then red checks send it back: the redo on the exam head loses no commit, and a replace is named on the ticket", async () => {
    const NAME = "src/rules.test.ts > rules > reads the list";
    let pushed = "";
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      // The exam review's checks, the lane's first: a person pushes while they run, and they fail.
      checksSay: (head, nth, where) => {
        if (nth !== 0) {
          return null;
        }

        pushed = pushOnTopOf(where, head, [PERSONS]);
        return {
          head,
          commands: [{ command: "node_modules/.bin/vitest run", code: 1, ms: 3 }],
          result: "red",
          failed: [NAME],
          tail: `${NAME}: AssertionError`,
        };
      },
    });
    const said = ran.lines.join("\n");
    const sent = ran.facts.find((f) => f.type === "ended" && f.stage === "exam_review");
    expect(sent?.outcome, said).toMatchObject({ kind: "send", why: "checks_red" });
    notLost(ran, pushed, said);
  });
});
