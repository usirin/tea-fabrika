import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YES, type Ran, TIMED_OUT, made, lane, onMain, codexRuns, WHOLE } from "./lane-harness.ts";

// A lane, on what a real agent might answer: errors in mid-stream, a last message that does not fit,
// and odd files. The shared setup is in ./lane-harness.ts. Today's version.

// An audit changed the fake's answers to what a real agent might say, and found ordinary answers that
// end a lane for good. Each test here is one of those answers. Today's version.
describe("a lane, on what a real agent might answer", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();

    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const runsOf = (ran: Ran, step: string) => codexRuns(ran.dir).filter((r) => r.step === step);
  const THE_PLANS_NO = { approve: "no" };
  const askedOf = (ran: Ran) => ran.facts.filter((f) => f.type === "asked");

  // P1
  it("a Reconnecting error in mid-stream is a note, and the plan still ends", async () => {
    const ran = await lane({
      within: 50,
      picks: THE_PLANS_NO,
      fake: { notes: { plan: ["Reconnecting... 1/5"] } },
    });
    expect(ran.names.plan).toContain('"done"');
    expect(askedOf(ran).some((f) => String(f.ask).startsWith("a-approve"))).toBe(true);
  });

  // P2
  it("every step's agent runs with --output-schema", async () => {
    const ran = await lane({ title: "[rules] Read names in one form", within: 50, picks: YES });
    expect(ran.lines.at(-1)).toContain("ended: done");
    const runs = codexRuns(ran.dir);
    expect(runs.map((r) => r.step)).toEqual(
      expect.arrayContaining(["triage", "plan", "exam", "tests", "build", "mutants", "review"]),
    );
    expect(runs.filter((r) => !r.args.includes("--output-schema")).map((r) => r.step)).toEqual([]);
  });

  // Record wide (docs/plan/pipeline-self-fix.md, PR 7): the harness's own id for each run's
  // conversation, as a `session` fact after its start, so a later restart can load that session.
  // The fake Codex opens thread `fake-<step>` (fixtures/pipeline-lane/codex.mjs), as the real one
  // names its own.
  it("writes each agent run's harness session id once, after its start: the thread the agent opened", async () => {
    const ran = await lane({ within: 50, picks: THE_PLANS_NO });
    let run = "";
    const runs = ran.facts.flatMap((f) => {
      if (f.type === "started") {
        run = String(f.run);
        return [`started ${String(f.stage)}`];
      }

      return f.type === "session" ? [`session ${String(f.id)}${f.run === run ? "" : " of another run"}`] : [];
    });
    expect(runs).toEqual(["started triage", "session fake-triage", "started plan", "session fake-plan"]);
  });

  // P3
  describe("a last message that does not fit", () => {
    const ON_PLAN = "Done. The plan is above.";
    const ON_BUILD = "I made the change and all tests pass.";

    it("on plan: a second try names it, and the good answer carries on", async () => {
      const ran = await lane({
        within: 50,
        picks: THE_PLANS_NO,
        fake: { answers: { plan: [ON_PLAN] } },
      });
      const runs = runsOf(ran, "plan");
      expect(runs).toHaveLength(2);
      expect(runs[1]?.prompt).toContain(ON_PLAN);
      expect(ran.names.plan).toContain('"done"');
      expect(askedOf(ran).some((f) => String(f.ask).startsWith("a-approve"))).toBe(true);
    });

    // Self-fix PR 11: `draft_failed` is a `once` row. The lane runs the plan once more as a new run,
    // with its own two tries, and a second `draft_failed` in a row stops it there.
    it("on plan: a second misfit ends draft_failed; the lane runs it once more, and a second draft_failed stops it, with no fifth try", async () => {
      const misfits = [ON_PLAN, ON_PLAN, ON_PLAN, ON_PLAN];
      const ran = await lane({ within: 50, fake: { answers: { plan: misfits } } });
      expect(runsOf(ran, "plan")).toHaveLength(4);
      const plans = ran.facts.filter((f) => f.type === "ended" && f.stage === "plan");
      expect(plans.map((f) => JSON.stringify(f.outcome))).toEqual([
        '{"kind":"stuck","why":"draft_failed"}',
        '{"kind":"stuck","why":"draft_failed"}',
      ]);
      expect(ran.stages).not.toContain("build");
      expect(ran.lines.at(-1)).toContain("draft_failed");
    });

    it("on plan: after a draft_failed, the run the lane starts once more fits, and the lane goes on to the plan's yes", async () => {
      const ran = await lane({
        within: 50,
        picks: THE_PLANS_NO,
        fake: { answers: { plan: [ON_PLAN, ON_PLAN] } },
      });
      expect(runsOf(ran, "plan")).toHaveLength(3);
      expect(ran.names.plan).toContain('"done"');
      expect(askedOf(ran).some((f) => String(f.ask).startsWith("a-approve"))).toBe(true);
    });

    it("on build: a second try names it, and the good answer carries on", async () => {
      const ran = await lane({ within: 50, picks: YES, fake: { answers: { build: [ON_BUILD] } } });
      const runs = runsOf(ran, "build");
      expect(runs).toHaveLength(2);
      expect(runs[1]?.prompt).toContain(ON_BUILD);
      expect(ran.stages).toEqual(WHOLE);
      expect(ran.lines.at(-1)).toContain("ended: done");
    });

    // Self-fix PR 11: the same `once` row at build.
    it("on build: a second misfit ends draft_failed; the lane runs it once more, and a second draft_failed stops it, with no fifth try", async () => {
      const ran = await lane({
        within: 50,
        picks: { approve: "approve" },
        fake: { answers: { build: [ON_BUILD, ON_BUILD, ON_BUILD, ON_BUILD] } },
      });
      expect(runsOf(ran, "build")).toHaveLength(4);
      const builds = ran.facts.filter((f) => f.type === "ended" && f.stage === "build");
      expect(builds.map((f) => JSON.stringify(f.outcome))).toEqual([
        '{"kind":"stuck","why":"draft_failed"}',
        '{"kind":"stuck","why":"draft_failed"}',
      ]);
      expect(ran.stages).not.toContain("mutation");
      expect(ran.lines.at(-1)).toContain("draft_failed");
      expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
    });

    // Self-fix PR 10: `exam_review` is a step that runs an agent too. It runs the review stage, with
    // the review's brief, so the fake answers both reviews as `review` runs: the exam's first (its
    // misfit and its retry), then the lane's own (its misfit and its retry). Each gets one misfit.
    it("on every step that runs an agent: one misfit each, and the lane still lands", async () => {
      const MISFIT = "All done, see above.";
      const ONCE = ["triage", "plan", "exam", "tests", "build", "mutants"];
      const ran = await lane({
        title: "[rules] Read names in one form",
        within: 50,
        picks: YES,
        fake: {
          answers: {
            ...Object.fromEntries(ONCE.map((step) => [step, [MISFIT]])),
            // The exam's review, its retry, then the lane's review.
            review: [MISFIT, null, MISFIT],
          },
        },
      });
      expect(ran.lines.at(-1)).toContain("ended: done");

      for (const step of ONCE) {
        const runs = runsOf(ran, step);
        expect({ step, runs: runs.length }).toEqual({ step, runs: 2 });
        expect(runs[1]?.prompt).toContain(MISFIT);
      }

      const reviews = runsOf(ran, "review");
      expect(reviews).toHaveLength(4);
      // The first read the exam's criterion, made by code; the third the lane's pull request.
      expect(reviews[0]?.prompt).toContain("- e1: ");
      expect(reviews[2]?.prompt).not.toContain("- e1: ");
      expect(reviews[1]?.prompt).toContain(MISFIT);
      expect(reviews[3]?.prompt).toContain(MISFIT);
    });
  });

  // P5
  it("no test importing the changed file means every mutant survived: the work goes to the test writer", async () => {
    const READS_ONLY = [
      'import {readFileSync} from "node:fs";',
      'import {expect, it} from "vitest";',
      "",
      'it("reads the new file as text", () => {',
      '\texpect(readFileSync("src/lower.ts", "utf8")).toContain("toLowerCase");',
      "});",
      "",
    ].join("\n");
    const ran = await lane({
      within: 50,
      picks: YES,
      fake: {
        answers: {
          tests: [
            {
              with: {
                files: [{ path: "src/lower.test.ts", text: READS_ONLY }],
                answers: [
                  {
                    property: "p1",
                    kind: "test",
                    file: "src/lower.test.ts",
                    name: "reads the new file as text",
                  },
                ],
              },
            },
          ],
        },
      },
    });
    expect(ran.names.mutation).not.toContain("run_failed");
    expect(ran.names.mutation).toContain("test_writer");
    expect(ran.stages).toContain("mutants");
    expect(runsOf(ran, "mutants")[0]?.prompt).toContain("src/lower.ts:");
  });

  // P6, and P27: its `stop` lands nothing with or without a guard, so what is on offer is the point.
  it("every review row unseen goes to the person with the reviewer's reason, nothing lands on it, and nothing on offer lets it through", async () => {
    const REASON = "The fixture run is elsewhere, so nothing here could show it.";
    const ran = await lane({
      within: 50,
      picks: { approve: "approve", step: "stop" },
      fake: { unseen: REASON },
    });
    expect(ran.names.review).not.toContain("stuck");
    expect(ran.names.review).toContain('"ask"');
    const asked = askedOf(ran).filter((f) => String(f.ask).startsWith("a-step"));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.picks).toEqual(["again", "stop"]);
    const said = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
    expect([String(asked[0]?.what), ...said].some((text) => text.includes(REASON))).toBe(true);
    expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
  });

  // P27: a lane saved with `go_on` on offer, picked. What stops it is ship's guard, not the question.
  it("a lane saved asking with go_on on offer, and picked, opens its pull request and ends stuck: nothing lands", async () => {
    const ran = await lane({
      within: 50,
      picks: { ...YES, step: "go_on" },
      fake: { unseen: "The fixture run is elsewhere, so nothing here could show it." },
      savedAsking: { at: /asks: (?!Do you approve)/, offers: ["again", "go_on", "stop"] },
    });
    expect(ran.facts.filter((f) => f.type === "answered" && f.pick === "go_on")).toHaveLength(1);
    expect(ran.lines).not.toContain(TIMED_OUT);
    expect(ran.names.merge).toContain("reviews_unknown");
    expect(ran.lines.at(-1)).toContain("stuck");
    expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
  });

  it("a reviewer's folder is told as it is: a box that refuses a write", async () => {
    const ran = await lane({ within: 50, picks: { approve: "approve", merge: "no" } });
    const review = runsOf(ran, "review")[0]?.prompt ?? "";
    expect(review).toContain("You review one pull request");
    expect(review).not.toMatch(/thrown away/);
  });

  // P7
  it("a changed file with a space or a non-ASCII letter is mutated like any other, and the lane goes on", async () => {
    const CODE = "export const flip = (on: boolean): boolean => !on;\n";
    const ran = await lane({
      within: 50,
      picks: YES,
      fake: {
        writes: {
          build: [
            { path: "src/my flip.ts", text: CODE },
            { path: "src/flïp.ts", text: CODE },
          ],
        },
      },
    });
    expect(ran.names.mutation).not.toContain("run_failed");
    const mutants = runsOf(ran, "mutants")[0]?.prompt ?? "";
    expect(mutants).toContain("src/my flip.ts:");
    expect(mutants).toContain("src/flïp.ts:");
    expect(ran.lines.at(-1)).toContain("ended: done");
  });

  // P9
  it("a rule change's path with a line break goes back to the planner, and never reaches a question", async () => {
    const change = { path: ".oxlintrc.json\nand more", change: "add a rule", why: "it needs one" };
    const ran = await lane({
      within: 50,
      picks: THE_PLANS_NO,
      fake: { answers: { plan: [{ with: { exam: [change] } }] } },
    });
    expect(runsOf(ran, "plan")).toHaveLength(2);
    expect(ran.names.plan).toContain('"done"');
    expect(ran.stages).not.toContain("exam_merge");
  });

  it("a plan summary and a criterion over a comment's limit are cut, not fatal", async () => {
    const LONG = "a very long sentence ".repeat(4_000);
    const claim = {
      when: "someone reads a name",
      result: LONG,
      check: { how: "test", what: "a test runs it" },
      serves: ["reader"],
    };
    const ran = await lane({
      within: 50,
      picks: YES,
      fake: {
        answers: {
          plan: [
            {
              with: {
                summary: LONG,
                tasks: [
                  {
                    title: "Read a name in one form",
                    ends: "pr",
                    job: {
                      when: "someone reads three names",
                      result: "each comes back in one form",
                      check: { how: "test", what: "a test runs it" },
                      serves: ["reader"],
                      fixture: "three names, each read twice",
                    },
                    criteria: [claim],
                  },
                ],
              },
            },
          ],
        },
      },
    });
    expect(ran.names.plan).toContain('"done"');
    const said = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
    expect(said.some((body) => body.startsWith("# Plan:"))).toBe(true);
    expect(ran.lines.at(-1)).toContain("ended: done");
  });
});
