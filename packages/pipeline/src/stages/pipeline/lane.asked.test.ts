import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YES,
  type FakeScript,
  made,
  lane,
  onMain,
  codexRuns,
  PASSES_AT_ONCE,
  heldAt,
  askedFor,
  onGitHub,
  runsOf,
  THE_PLANS_NO,
  commentsOf,
  REAL_LEAN,
  REAL_QUESTION,
  REAL_P1,
  REAL_P2,
  REAL_CANNOT,
  REAL_MUTANT,
  P1_CANNOT,
  readBy,
  reads,
  RUN3_LEAN,
  RUN3_FINDING,
  AGAINST_Q1,
  THE_LEAN,
  found,
  RUN_3,
  bye,
  answeredWith,
} from "./lane-harness.ts";

// A lane, on what the real agents answered: a plan's `from`, a brief, a step's question in words, and
// a person's lean carried on. The shared setup is in ./lane-harness.ts. Today's version.

// A rehearsal ran the lane on real models, and these are what it found. The fake's answers below are
// copied from what the real agents wrote. Today's version.
describe("a lane, on what the real agents answered", () => {
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

  const REAL_STORY = {
    id: "blog-author",
    who: "A blog author",
    want: "A URL slug made from a post title",
    why: "Titles with spaces, punctuation and accented letters need a consistent URL form.",
  };
  /** What the real planner wrote in a story's `from`, on its first try. */
  const REAL_FROM = "The ticket; the repository currently only provides title whitespace cleanup.";
  const REAL_RESULT =
    "“Hello, World!” becomes “hello-world”, “Çay Şeker” becomes “cay-seker”, and “!!!” becomes an empty string.";
  const REAL_FIXTURE =
    "One batch of three titles, converted once each: an English greeting, a Turkish title with accents, and punctuation without usable text.";
  const REAL_TASK = {
    title: "Add title-to-slug conversion",
    ends: "pr",
    job: {
      when: "A blog author converts three post titles for publication",
      result: REAL_RESULT,
      check: {
        how: "test",
        what: "Compare the three title-to-slug results with the expected strings.",
      },
      serves: [REAL_STORY.id],
      fixture: REAL_FIXTURE,
    },
    criteria: [],
  };

  const TWO_PROPERTIES = { plan: [{ with: { properties: [REAL_P1, REAL_P2] } }] };

  // P12
  it("a story's `from` that names no ticket goes back to the planner, in words, and the plan goes on", async () => {
    const ran = await lane({
      within: 50,
      picks: THE_PLANS_NO,
      fake: {
        answers: {
          plan: [{ with: { stories: [{ ...REAL_STORY, from: REAL_FROM }], tasks: [REAL_TASK] } }],
        },
      },
    });
    const runs = runsOf(ran, "plan");
    expect(runs).toHaveLength(2);
    expect(runs[1]?.prompt).toMatch(/`from`/);
    expect(ran.names.plan).toContain('"done"');
    expect(ran.facts.some((f) => f.type === "planned")).toBe(true);
  });

  // P13
  it("a plan that keeps a bad `from` until its tries are spent ends with the reason on the ticket", async () => {
    const bad = { with: { stories: [{ ...REAL_STORY, from: REAL_FROM }], tasks: [REAL_TASK] } };
    const ran = await lane({ within: 50, fake: { answers: { plan: [bad, bad, bad] } } });
    expect(ran.names.plan).toContain('"stuck"');
    expect(commentsOf(ran).filter((body) => /`from`/.test(body))).not.toEqual([]);
  });

  // P14
  it("a brief with a ticket's url also holds the ticket's words, and each task's job where a writer needs it", async () => {
    const TITLE = "Add slugify: turn a title into a URL slug";
    const BODY = "Lower case, no spaces around.";
    const ran = await lane({
      title: TITLE,
      within: 50,
      picks: YES,
      fake: { answers: { plan: [{ with: { stories: [REAL_STORY], tasks: [REAL_TASK] } }] } },
    });
    const prompt = (step: string) => runsOf(ran, step)[0]?.prompt ?? "";
    const holds = (step: string, words: readonly string[]) => ({
      step,
      missing: words.filter((word) => !prompt(step).includes(word)),
    });
    expect([
      holds("tests", [TITLE, BODY, REAL_RESULT, REAL_FIXTURE]),
      holds("mutants", [TITLE, BODY, REAL_RESULT, REAL_FIXTURE]),
      holds("review", [TITLE, BODY]),
    ]).toEqual([
      { step: "tests", missing: [] },
      { step: "mutants", missing: [] },
      { step: "review", missing: [] },
    ]);
  });

  // P15
  // scenario: a real temporary git repo, local step processes, and a pull request on the local host.
  it("scenario: a person's go_on past a property with no test: the ticket and the pull request say which", async () => {
    const ran = await onGitHub({
      within: 50,
      rubrics: null,
      picks: { ...YES, step: "go_on" },
      fake: { answers: { ...TWO_PROPERTIES, ...P1_CANNOT } },
    });
    expect(ran.lines.at(-1)).toContain("ended: done");
    const args = ran.calls.find((call) => call.kind === "pr_create")?.args ?? [];
    const body = args[args.indexOf("--body") + 1] ?? "";
    expect(body).toMatch(/no test/i);
    expect(body).toContain(REAL_P1.when);
    expect(body).not.toContain(REAL_P2.when);
    const answer = answeredWith(ran, "go_on")[0];
    expect(answer).toBeDefined();
    const answered = ran.facts.indexOf(answer!);
    const later = ran.facts
      .slice(answered)
      .filter((f) => f.type === "commented")
      .map((f) => String(f.body));
    expect(later.filter((said) => /no test/i.test(said) && said.includes(REAL_P1.when))).not.toEqual([]);
  });

  // P16
  describe("what a person is asked", () => {
    it.each<[string, FakeScript, readonly string[]]>([
      [
        "a test writer's `cannot`: its reason, and the property",
        { answers: { ...TWO_PROPERTIES, ...P1_CANNOT } },
        [REAL_CANNOT, REAL_P1.when],
      ],
      ["the mutants' writer's `cannot`: its reason", { cannot: REAL_MUTANT }, [REAL_MUTANT]],
      [
        "a test that already passes: the property",
        {
          answers: {
            tests: [
              {
                with: {
                  files: [
                    {
                      path: "src/lower.test.ts",
                      text: 'import {expect, it} from "vitest";\n\nit("lowers capitals", () => {\n\texpect("ab").toBe("ab");\n});\n',
                    },
                  ],
                },
              },
              // Self-fix PR 11, row 28: it goes back to the writer one time, so it asks on the second.
              PASSES_AT_ONCE,
            ],
          },
        },
        ["a name holds capitals"],
      ],
      [
        "a review that could not see: its reason",
        { unseen: "The fixture run is elsewhere, so nothing here could show it." },
        ["The fixture run is elsewhere, so nothing here could show it."],
      ],
    ])("a step's question reads in words, %s, and what each pick does", async (_name, fake, words) => {
      const ran = await lane({ within: 50, picks: { approve: "approve", step: "stop" }, fake });
      reads(ran, "a-step", words);
    });

    // Self-fix PR 11, row 28: a test that already passes goes back to the writer one time, with its
    // names, so it can fix that test. Its fix is the same file, written again: never a stop.
    it("a test writer sent back once for a test that already passes may write that test again, and then it asks", async () => {
      const PASSING = {
        with: {
          files: [
            {
              path: "src/lower.test.ts",
              text: 'import {expect, it} from "vitest";\n\nit("lowers capitals", () => {\n\texpect("ab").toBe("ab");\n});\n',
            },
          ],
        },
      };
      const ran = await lane({
        within: 50,
        picks: { approve: "approve", step: "stop" },
        fake: { answers: { tests: [PASSING, PASSING] } },
      });
      const writers = ran.facts.filter((f) => f.type === "ended" && f.stage === "test_writer");
      expect(
        writers.map((f) => JSON.stringify(f.outcome)),
        ran.lines.join("\n"),
      ).toEqual([
        '{"kind":"ask","who":"owner","for":"already_passes"}',
        '{"kind":"ask","who":"owner","for":"already_passes"}',
      ]);
      expect(askedFor(ran, "step")).toHaveLength(1);
      expect(ran.lines.join("\n")).not.toContain("unchecked");
    });

    // Self-fix PR 11, rows 28, 29 and 35, from round 2 on. A second round's writer adds its tests on a
    // head, and its first try's commit is that head once it ends. Sent back once, it writes the same
    // file again: that is its own file, never one that "exists already", so it is never a stop.
    it("row 28 in round 2: a test writer sent back once may write its own file again on the head it first wrote on, and then it asks", async () => {
      // The fake's round-2 writer writes `src/lower-again.test.ts`, which passes at once on the
      // build's head; its redo, also plain, writes that same file again.
      const ran = await lane({
        title: "[review-once] Read names in one form",
        within: 50,
        picks: { approve: "approve", step: "stop" },
      });
      const said = ran.lines.join("\n");
      const writers = ran.facts.filter((f) => f.type === "ended" && f.stage === "test_writer");
      expect(
        writers.slice(1).map((f) => JSON.stringify(f.outcome)),
        said,
      ).toEqual([
        '{"kind":"ask","who":"owner","for":"already_passes"}',
        '{"kind":"ask","who":"owner","for":"already_passes"}',
      ]);
      const started = ran.facts.filter((f) => f.type === "started" && f.stage === "test_writer");
      expect(started.map((f) => f.round)).toEqual([1, 2, 2]);
      // The redo stands on a head, as round 2 does: it is told of round 1's test there.
      const redo = codexRuns(ran.dir).filter((r) => r.step === "tests")[2];
      expect(redo?.taken).toContain("src/lower.test.ts");
      expect(askedFor(ran, "step")).toHaveLength(1);
      expect(said).not.toContain("unchecked");
    });

    // P19 too: a yes takes the lean, so the question says so.
    it("the plan's yes says what it takes: each pick does what it says, and a yes takes the lean", async () => {
      const ran = await lane({
        within: 50,
        picks: THE_PLANS_NO,
        fake: { answers: { plan: [{ with: { questions: [REAL_QUESTION] } }] } },
      });
      reads(ran, "a-approve", [REAL_LEAN]);
      const { text } = readBy(ran, "a-approve");
      const yes = text.split("\n").filter((line) => /approve/i.test(line));
      expect(yes.filter((line) => /lean/i.test(line))).not.toEqual([]);
    });

    // The second rehearsal's run 3, in its real words: a lean the person approved, a review that calls
    // that same behavior wrong, a second test writer that writes a test against it, and a builder that
    // cannot pass both. The names are the fake's own, so the fake's plain builder has code to change.
    describe("what a person decided at the plan", () => {
      // P20
      it("its lean reaches each step that judges or writes after it, in both rounds", async () => {
        const ran = await lane({
          within: 50,
          // Self-fix PR 11, row 46: round 2's red goes another round, so the rounds run out.
          picks: { approve: "approve", step: "stop", rounds_spent: "stop" },
          fake: RUN_3,
        });
        const steps: readonly (readonly [string, number])[] = [
          ["tests", 0],
          ["build", 0],
          ["mutants", 0],
          ["review", 0],
          ["tests", 1],
          ["build", 1],
        ];
        const untold = steps.filter(([step, at]) => !(runsOf(ran, step)[at]?.prompt ?? "").includes(RUN3_LEAN));
        expect(untold).toEqual([]);
      });

      // P20
      // scenario: a real lane runs two plan refusals and carries their notes into later local processes.
      it("scenario: the note against a recommendation reaches the steps after the revised plan", async () => {
        const NOTE = "Fold ß to ss. Keep the rest of the plan.";
        const ran = await lane({
          within: 50,
          picks: YES,
          // Review 2: every plan approval shows its recommendation, including after a refusal.
          queues: { approve: ["no", "no", "approve"] },
          notes: { approve: NOTE },
          again: [{}, {}],
          fake: { answers: { plan: [...THE_LEAN.plan, ...THE_LEAN.plan] } },
        });
        const plans = runsOf(ran, "plan");
        expect(plans).toHaveLength(3);
        expect(plans[1]?.prompt).toContain(NOTE);
        expect(plans[2]?.prompt).toContain(NOTE);
        expect(askedFor(ran, "approve")).toMatchObject([
          { blind: { hidden: false } },
          { blind: { hidden: false } },
          { blind: { hidden: false } },
        ]);
        expect(answeredWith(ran, "no").map((fact) => ("format" in fact ? fact.answer : null))).toEqual([
          { _tag: "against", pick: "no", note: NOTE },
          { _tag: "against", pick: "no", note: NOTE },
        ]);
        const untold = ["tests", "build", "mutants", "review"].filter(
          (step) => !(runsOf(ran, step)[0]?.prompt ?? "").includes(NOTE),
        );
        expect(untold).toEqual([]);
      });

      // P20, and the review's half of P21: it names the question, so a finding can name it back.
      it("the review's brief names each decision, and says it is not a finding", async () => {
        const ran = await lane({
          within: 50,
          picks: { approve: "approve", merge: "no" },
          fake: { answers: THE_LEAN },
        });
        const prompt = runsOf(ran, "review")[0]?.prompt ?? "";
        expect(prompt).toContain("`q1`");
        expect(prompt).toMatch(/not a finding/i);
      });

      // P21: run 3's main line. It goes to the person, and no test is written against what they decided.
      it("a finding marked against it goes to the person with both sides, and no test comes of it", async () => {
        const marked = found(AGAINST_Q1);
        const ran = await lane({
          within: 50,
          picks: { approve: "approve", step: "stop" },
          fake: { answers: { ...THE_LEAN, review: [marked, marked, marked] } },
        });
        expect(ran.names.review).toContain('"ask"');
        reads(ran, "a-step", [RUN3_LEAN, RUN3_FINDING.fault]);
        expect(runsOf(ran, "tests")).toHaveLength(1);
        // Self-fix PR 5: the person's `stop` is a saved pause, not `skip:owner_no`.
        expect(heldAt(ran, 0), bye(ran)).not.toBeNull();
      });

      // P21
      it("the person's go_on keeps the decision: the work lands as it is, and no test comes of the finding", async () => {
        const marked = found(AGAINST_Q1);
        const ran = await lane({
          within: 50,
          picks: { ...YES, step: "go_on" },
          fake: { answers: { ...THE_LEAN, review: [marked, marked, marked] } },
        });
        expect(answeredWith(ran, "go_on")).not.toEqual([]);
        expect(runsOf(ran, "tests")).toHaveLength(1);
        expect(bye(ran)).toContain("ended: done");
        expect(onMain(ran.remote, "src/lower.ts")).not.toBeNull();
      });
    });
  });
});
