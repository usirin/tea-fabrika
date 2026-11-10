import { execFileSync } from "node:child_process";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NUMBER,
  YES,
  type Ran,
  lane,
  onMainHead,
  descends,
  codexRuns,
  remoteGit,
  RULES,
  RULE,
  FAULT,
  FAILS_E1,
  exams,
  endOf,
  MAIN_RULE,
  mainTakesTheRule,
  pullHead,
  keptLines,
  refIn,
  keptPlaces,
} from "./lane-harness.ts";

// The exam's pull request: after its merge, and a redo written on main or on the exam head. The
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

  /** The rule file as the fake exam writer writes it (fixtures/pipeline-lane/codex.mjs). */
  const WRITTEN_RULE = '{"rules": {}}\n';
  /** The brief's words for a redo on the pull request's head: false on main. */
  const ON_THE_HEAD = "On a redo, your folder holds the pull request's head, with your last changes in it.";

  // Tracker 194, ticket 117: the lane's tree was made before the exam merged, so the test writer was
  // given the old main, never saw the exam, and wrote a test of its own for it. A tree made at the
  // test writer, as on a first line, already starts on the new main: `treeFirst` makes it earlier.
  it("once the exam's merge ends done, the test writer starts on main's tip, and its folder has the rule file as the exam head has it", async () => {
    const ran = await lane({ title: RULES, picks: YES, fake: { see: [RULE] }, treeFirst: true });
    const said = ran.lines.join("\n");
    const merged = endOf(ran, "exam_merge");
    expect(ran.facts[merged]?.outcome, said).toMatchObject({ kind: "done" });
    const writer = ran.facts.find((f) => f.type === "ended" && f.stage === "test_writer");
    const base = (writer?.carry as { readonly base?: string } | undefined)?.base ?? "";
    expect(base, said).toMatch(/^[0-9a-f]{40}$/);
    // The base holds the exam's merge: the rule file is there as the exam writer wrote it.
    const atBase = (() => {
      try {
        return remoteGit(ran.remote, "show", `${base}:${RULE}`);
      } catch {
        return null;
      }
    })();
    expect(atBase, "the writer's base holds the merged exam").toBe(WRITTEN_RULE.trim());
    const [tests] = codexRuns(ran.dir).filter((r) => r.step === "tests");
    expect(tests?.seen[RULE], "the writer's folder holds the exam").toBe(WRITTEN_RULE);
  });

  // Tracker 194: the branch moves onto main as the exam's merge left it, and its end says so, so a
  // fold or a restart reads the new base. A commit on the branch that main lacks is never lost.
  it("once the exam's merge ends done, its end carries main's tip as base and head, and a commit on the lane's branch that main lacks stays under a kept ref the step's intent names", async () => {
    const EARLIER = { path: "docs/earlier.md", text: "From an earlier line.\n" };
    const ran = await lane({
      title: RULES,
      picks: YES,
      fake: { see: [RULE] },
      treeFirst: true,
      treeHolds: [EARLIER],
    });
    const said = ran.lines.join("\n");
    const merged = ran.facts[endOf(ran, "exam_merge")];
    expect(merged?.outcome, said).toMatchObject({ kind: "done" });
    const { base, head } = Schema.decodeUnknownSync(Schema.Struct({ base: Schema.String, head: Schema.String }))(
      merged?.carry,
    );
    expect(base, said).toMatch(/^[0-9a-f]{40}$/);
    expect(head).toBe(base);
    // Main's tip as the merge left it: on main, with the exam's rule file in it.
    expect(remoteGit(ran.remote, "rev-list", "main").split("\n")).toContain(base);
    expect(remoteGit(ran.remote, "show", `${base}:${RULE}`)).toBe(WRITTEN_RULE.trim());
    // The branch's own commit stays on the remote, under the ref the exam's merge names.
    const kept = remoteGit(ran.remote, "for-each-ref", "--format=%(refname)", "refs/kept/")
      .split("\n")
      .filter((ref) => ref.endsWith("/exam_merge"));
    expect(kept, said).toHaveLength(1);
    expect(kept[0]).toMatch(new RegExp(`^refs/kept/lane/${NUMBER}/\\d+/exam_merge$`));
    expect(remoteGit(ran.remote, "show", `${kept[0]}:${EARLIER.path}`)).toBe(EARLIER.text.trim());
  });

  it("ship's conflicts at the exam's merge: the exam writer is first told its folder is on main, never that it holds the pull request's head", async () => {
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fake: { see: [RULE] },
      checksSay: mainTakesTheRule,
    });
    const said = ran.lines.join("\n");
    const runs = exams(ran);
    expect(runs.length, said).toBeGreaterThan(1);
    const redo = runs[1];
    expect(redo?.seen[RULE], "the redo's folder is main").toBe(MAIN_RULE);
    expect(redo?.prompt).toMatch(/\bon main\b/i);
    expect(redo?.prompt).not.toContain(ON_THE_HEAD);
  });

  it("a review's findings, then main's conflicts at the exam's own review: the first redo is written on the exam head, the second on main", async () => {
    let moved = "";
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fake: { answers: { review: [FAILS_E1] }, see: [RULE] },
      checksSay: (head, nth, where) => {
        const said = mainTakesTheRule(head, nth, where);

        if (nth === 0) {
          moved = onMainHead(where.remote);
        }

        return said;
      },
    });
    const said = ran.lines.join("\n");
    const reviews = ran.facts.filter((f) => f.type === "ended" && f.stage === "exam_review");
    expect(
      reviews.map((f) => f.outcome),
      said,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "send", why: "review_failed" }),
        expect.objectContaining({ kind: "send", why: "conflicts" }),
      ]),
    );
    const runs = exams(ran);
    expect(runs, said).toHaveLength(3);
    // The review's redo: the exam head, with the writer's own rule file, and not told main.
    expect(runs[1]?.seen[RULE], "the review's redo stands on the exam head").toBe(WRITTEN_RULE);
    expect(runs[1]?.prompt).toContain(FAULT);
    expect(runs[1]?.prompt).not.toMatch(/\bon main\b/i);
    // The conflicts redo: main, with main's rule file, and what it lands takes main.
    expect(runs[2]?.seen[RULE], "the conflicts redo stands on main").toBe(MAIN_RULE);
    const ends = ran.facts.filter((f) => f.type === "ended" && f.stage === "exam");
    const head = (ends[2]?.carry as { readonly examPull?: { readonly head: string } } | undefined)?.examPull?.head;
    expect(head, said).toMatch(/^[0-9a-f]{40}$/);
    expect(descends(ran.remote, moved, head ?? ""), "the redo's head takes main").toBe(true);
  });

  it("red checks at the exam's review: the redo is written on the exam head, with the failing name, and not told main", async () => {
    const NAME = "src/rules.test.ts > rules > reads the list";
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fake: { see: [RULE] },
      checksSay: (head, nth) =>
        nth === 0
          ? {
              head,
              commands: [{ command: "node_modules/.bin/vitest run", code: 1, ms: 3 }],
              result: "red",
              failed: [NAME],
              tail: `${NAME}: AssertionError`,
            }
          : null,
    });
    const said = ran.lines.join("\n");
    const first = ran.facts.find((f) => f.type === "ended" && f.stage === "exam_review");
    expect(first?.outcome, said).toMatchObject({ kind: "send", why: "checks_red" });
    const runs = exams(ran);
    expect(runs.length, said).toBeGreaterThan(1);
    expect(runs[1]?.seen[RULE], "the checks' redo stands on the exam head").toBe(WRITTEN_RULE);
    expect(runs[1]?.prompt).toContain(NAME);
    expect(runs[1]?.prompt).not.toMatch(/\bon main\b/i);
  });

  // The owner's decision on PR 322 (option A): a redo on main is pushed over the exam branch, so
  // before it does, the lane keeps the old exam head under a kept ref, as a restart does
  // (`refs/kept/...`), and posts one line on the ticket that names the ref and the old commit. A
  // commit a person pushed there is then never lost without a word. A redo that only adds to the
  // branch keeps nothing and posts nothing.

  /** What `ref` points at, in the lane's own clone or else on the remote: `null` in neither. */
  const keptAt = (ran: Ran, ref: string): string | null => {
    for (const at of keptPlaces(ran)) {
      try {
        return execFileSync("git", [...at, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
      } catch {
        // Not here: the other place may hold it.
      }
    }

    return null;
  };

  /** The old head is kept under the ref one ticket line names, and that line names the old commit. */
  const keptOnce = (ran: Ran, old: string, said: string) => {
    const lines = keptLines(ran);
    expect(lines, `one line names the kept ref\n${said}`).toHaveLength(1);
    const line = lines[0] ?? "";
    expect(line, "the line names the old commit").toContain(old.slice(0, 7));
    const ref = refIn(line);
    expect(ref, line).toMatch(/^refs\/kept\/./);
    expect(keptAt(ran, ref), `${ref} holds the old exam head`).toBe(old);
  };

  it("ship's conflicts at the exam's merge: before the redo on main replaces the exam branch, the old head is kept under a kept ref, and one ticket line names the ref and the old commit", async () => {
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fake: { see: [RULE] },
      checksSay: mainTakesTheRule,
    });
    const said = ran.lines.join("\n");
    const ends = ran.facts.filter((f) => f.type === "ended");
    const refused = ends.findIndex((f) => f.stage === "exam_merge");
    expect(ends[refused]?.outcome, said).toMatchObject({ kind: "send", why: "conflicts" });
    const old = pullHead(ends[refused]);
    expect(old, said).toMatch(/^[0-9a-f]{40}$/);
    const head = pullHead(ends.slice(refused).find((f) => f.stage === "exam"));
    expect(head, said).toMatch(/^[0-9a-f]{40}$/);
    // The redo's push replaced the branch: the old head is not in the new one's history.
    expect(descends(ran.remote, old, head), "the redo replaced the exam branch").toBe(false);
    keptOnce(ran, old, said);
  });

  it("main's conflicts at the exam's own review: before the redo on main replaces the exam branch, the head it found is kept under a kept ref, and one ticket line names it; the review's redo before it keeps nothing", async () => {
    const ran = await lane({
      title: RULES,
      within: 50,
      picks: { ...YES, rounds_spent: "stop" },
      fake: { answers: { review: [FAILS_E1] }, see: [RULE] },
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
    const head = pullHead(ends.slice(refused).find((f) => f.stage === "exam"));
    expect(head, said).toMatch(/^[0-9a-f]{40}$/);
    expect(descends(ran.remote, old, head), "the redo replaced the exam branch").toBe(false);
    keptOnce(ran, old, said);
  });
});
