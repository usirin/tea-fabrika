import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YES,
  TIMED_OUT,
  made,
  lane,
  onMain,
  PLAIN_LOWER,
  FAILS_ON_MAIN,
  heldAt,
  askedFor,
  onGitHub,
  runsOf,
  commentsOf,
  REAL_P1,
  REAL_P2,
  REAL_MUTANT,
  P1_CANNOT,
  readBy,
  RUN3_LEAN,
  RUN3_QUESTION,
  RUN3_FINDING,
  AGAINST_Q1,
  NO_CHANGE,
  THE_LEAN,
  found,
  RUN_3,
  bye,
  FOLDS,
} from "./lane-harness.ts";

// What a person decided at the plan: `again` and its rounds, and a finding a person lets through. The
// shared setup is in ./lane-harness.ts. Today's version.

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

  // P16
  describe("what a person is asked", () => {
    // The second rehearsal's run 3, in its real words: a lean the person approved, a review that calls
    // that same behavior wrong, a second test writer that writes a test against it, and a builder that
    // cannot pass both. The names are the fake's own, so the fake's plain builder has code to change.
    describe("what a person decided at the plan", () => {
      const THE_LEAN_AND_NOTHING_SEEN = {
        unseen: "The fixture run is elsewhere, so nothing here could show it.",
      };

      // P28: this replaces a test whose new test passed from the start, which only a fake could write.
      it("`again` with a note runs the builder once more with it, and no new test writer: a real fix lands", async () => {
        const NOTE = "Fold ß to ss in `lower`, as the new test says.";
        const ran = await lane({
          within: 50,
          // The first step's question is round 1's surviving mutant, then the builder's no change.
          steps: ["go_on", "again"],
          picks: { ...YES, step: "go_on" },
          notes: { step: NOTE },
          fake: {
            ...RUN_3,
            // Each mutant is answered `cannot`, so a later mutation run writes no test twice.
            cannot: REAL_MUTANT,
            answers: { ...RUN_3.answers, build: [null, NO_CHANGE, null] },
            writesAt: { build: { 2: [FOLDS] } },
          },
        });
        const builds = runsOf(ran, "build");
        expect(builds).toHaveLength(3);
        expect(builds[2]?.prompt).toContain(NOTE);
        expect(runsOf(ran, "tests")).toHaveLength(2);
        expect(bye(ran)).toContain("ended: done");
        expect(onMain(ran.remote, "src/lower.ts")).toContain("replaceAll");
      });

      // P28
      it("`again` counts as a round: a builder that keeps changing nothing ends stuck at the limit, in words", async () => {
        const ran = await lane({
          within: 50,
          // `again` at round 2's question. Once the rounds are spent, the person stops.
          picks: { approve: "approve", step: "again", rounds_spent: "stop" },
          fake: {
            ...RUN_3,
            answers: {
              ...RUN_3.answers,
              build: [null, NO_CHANGE, NO_CHANGE, NO_CHANGE, NO_CHANGE],
            },
          },
        });
        expect(ran.lines).not.toContain(TIMED_OUT);
        // Round 2's `again` ran round 3, the last, and the lane asked once its rounds were spent.
        expect(runsOf(ran, "build")).toHaveLength(3);
        const spent = ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-rounds_spent"));
        expect(spent).toHaveLength(1);
        expect(bye(ran)).toContain("stuck:rounds_spent");
        const told = [bye(ran), ...commentsOf(ran)];
        expect(told.filter((said) => /builder/i.test(said) && /round/i.test(said))).not.toEqual([]);
        expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
      });

      // P28: a first round has no work to go on with, so nothing goes on past the build. Self-fix PR
      // 11, jidoka row 41: the builder runs once more, told it changed nothing, and a second time in
      // a row the build asks its own question. The person's `stop` is a saved pause.
      it("a builder that changes nothing in round 1 runs once more, then asks, and nothing after the build runs", async () => {
        const ran = await lane({
          within: 50,
          picks: { approve: "approve", step: "stop" },
          // The plain builder writes just this, so round 1's diff is empty. The writer's test fails
          // on main, so the build's is the one question past the plan's yes.
          mainFiles: [PLAIN_LOWER],
          fake: { answers: { tests: [FAILS_ON_MAIN] } },
        });
        const said = ran.lines.join("\n");
        const builds = ran.facts.filter((f) => f.type === "ended" && f.stage === "build");
        expect(
          builds.map((f) => JSON.stringify(f.outcome)),
          said,
        ).toEqual(['{"kind":"stuck","why":"no_change"}', '{"kind":"stuck","why":"no_change"}']);
        const started = ran.facts.filter((f) => f.type === "started" && f.stage === "build");
        expect(started.map((f) => f.round)).toEqual([1, 1]);
        expect(askedFor(ran, "step")).toHaveLength(1);
        expect(heldAt(ran, 0), said).not.toBeNull();
        expect(ran.stages).not.toContain("mutation");
      });

      // P26: the one path where a go_on asks again from inside the same step's end.
      it("a finding marked against a decision, beside a row the review could not see: two questions, each with its own id and its own answer", async () => {
        const ran = await lane({
          within: 50,
          steps: ["go_on", "stop"],
          picks: { approve: "approve" },
          fake: {
            ...THE_LEAN_AND_NOTHING_SEEN,
            answers: { ...THE_LEAN, review: [found(AGAINST_Q1)] },
          },
        });
        const asked = ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-step"));
        expect(new Set(asked.map((f) => f.ask)).size).toBe(2);
        const heard = ran.facts
          .filter((f) => f.type === "answered" && String(f.ask).startsWith("a-step"))
          .map((f) => [f.ask, f.pick]);
        expect(heard).toEqual([
          [asked[0]?.ask, "go_on"],
          [asked[1]?.ask, "stop"],
        ]);
        // The second question waited: its answer came after it was asked, not with the first.
        const at = (type: string, ask: unknown) => ran.facts.findIndex((f) => f.type === type && f.ask === ask);
        expect(at("answered", asked[1]?.ask)).toBeGreaterThan(at("asked", asked[1]?.ask));
        expect(at("asked", asked[1]?.ask)).toBeGreaterThan(at("answered", asked[0]?.ask));
        // Self-fix PR 5: the person's `stop` is a saved pause, not `skip:owner_no`.
        expect(heldAt(ran, 0), bye(ran)).not.toBeNull();
        expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
      });

      describe("a finding a person lets through", () => {
        const MARKED_ONCE = { ...THE_LEAN, review: [found(AGAINST_Q1)] };
        const prBody = (ran: { readonly calls: readonly { readonly args: readonly string[] }[] }) => {
          const args =
            ran.calls.find((call) => call.args.includes("--body") && call.args.includes("--head"))?.args ?? [];
          return args[args.indexOf("--body") + 1] ?? "";
        };

        // P29
        it("its question says the finding and the decision side by side, and that go_on lets the finding through", async () => {
          const ran = await lane({
            within: 50,
            picks: { approve: "approve", step: "stop" },
            fake: { answers: MARKED_ONCE },
          });
          const { text } = readBy(ran, "a-step");
          const lines = text.split("\n");
          const decided = lines.findIndex((line) => line.includes(RUN3_LEAN));
          const faulted = lines.findIndex((line) => line.includes(RUN3_FINDING.fault));
          expect(decided).toBeGreaterThan(-1);
          expect(faulted).toBe(decided + 1);
          const goOn = lines.filter((line) => /go[ _]on/.test(line));
          expect(goOn.filter((line) => line.includes("lets that finding through"))).not.toEqual([]);
        });

        // P29, with a title long enough to cut: a count that goes first survives it.
        it("the merge question says the count, then how many were let through, and each in a line", async () => {
          const OTHER_MARK = { ...AGAINST_Q1, fault: "The accents are folded too far." };
          const ran = await lane({
            title: `Read names in one form ${"and keep reading them ".repeat(8)}`.trim(),
            within: 50,
            picks: { approve: "approve", step: "go_on", merge: "no" },
            fake: { answers: { ...THE_LEAN, review: [found(AGAINST_Q1, OTHER_MARK)] } },
          });
          const { what, text } = readBy(ran, "a-merge");
          const reviewed = ran.facts.findLast((f) => f.type === "reviewed");
          const count = `met ${String(reviewed?.met)} of ${String(reviewed?.of)}`;
          const said = what.indexOf(count);
          expect(said).toBeGreaterThan(-1);
          expect(what.slice(said)).toMatch(/\b2 findings\b.*let through/);
          const lines = text.split("\n");
          const each = [AGAINST_Q1.fault, OTHER_MARK.fault].filter(
            (fault) => !lines.some((line) => line.includes(fault)),
          );
          expect(each).toEqual([]);
        });

        // P29
        it("one finding let through is said as one", async () => {
          const ran = await lane({
            within: 50,
            picks: { approve: "approve", step: "go_on", merge: "no" },
            fake: { answers: MARKED_ONCE },
          });
          expect(readBy(ran, "a-merge").what).toMatch(/\b1 finding\b.*let through/);
        });

        // P29
        it("the pull request lists each finding, mutant and untested property let through, and does not say no deviations", async () => {
          const ran = await onGitHub({
            within: 50,
            rubrics: null,
            picks: { approve: "approve", step: "go_on", merge: "no" },
            fake: {
              cannot: REAL_MUTANT,
              answers: {
                ...P1_CANNOT,
                plan: [{ with: { questions: [RUN3_QUESTION], properties: [REAL_P1, REAL_P2] } }],
                review: [found(AGAINST_Q1)],
              },
            },
          });
          const body = prBody(ran);
          expect(body).toContain(RUN3_FINDING.fault);
          expect(body).toContain(REAL_MUTANT);
          expect(body).toContain(REAL_P1.when);
          expect(body).not.toMatch(/no deviations/i);
        });

        // Each with its own reason: under one shared reason, a row that dropped out would not show.
        it("every mutant answered `cannot` reaches the merge question and the pull request, each with its own reason", async () => {
          const ran = await onGitHub({
            within: 50,
            rubrics: null,
            picks: { approve: "approve", step: "go_on", merge: "no" },
            fake: {
              cannot: "No test can see the change at {mutant}.",
              // A file no test reads: every mutant in it survives, so there are several to let live.
              writes: {
                build: [
                  {
                    path: "src/big.ts",
                    text: "export const isBig = (size: number): boolean => size > 10;\n",
                  },
                ],
              },
            },
          });
          const asked = runsOf(ran, "mutants")[0]?.prompt ?? "";
          const ids = [...new Set(asked.match(/src\/[^:"\n]+\.ts:\d+:\d+:[0-9a-f]{6}/g) ?? [])];
          expect(ids.length).toBeGreaterThan(1);
          const rows = ids.map((id) => `\`${id}\`: No test can see the change at ${id}.`);
          const body = prBody(ran);
          const merge = readBy(ran, "a-merge").text;
          expect(rows.filter((row) => !body.includes(row))).toEqual([]);
          expect(rows.filter((row) => !merge.includes(row))).toEqual([]);
        });

        // P29
        it("a pull request with nothing let through says nothing was", async () => {
          const ran = await onGitHub({
            within: 50,
            rubrics: null,
            picks: { approve: "approve", merge: "no" },
          });
          expect(prBody(ran)).toContain("No deviations.");
          expect(prBody(ran)).not.toMatch(/let through/i);
        });
      });
    });
  });
});
