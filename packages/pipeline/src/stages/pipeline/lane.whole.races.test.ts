import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YES,
  type Ran,
  TIMED_OUT,
  AGAIN,
  type Where,
  lane,
  onMain,
  onMainHead,
  descends,
  codexRuns,
  remoteGit,
  pushedHead,
  heldAt,
  askedFor,
} from "./lane-harness.ts";
import { Pull } from "./pulls.ts";

// A lane, whole, while something moves under it: main under the review (row 62), and the ticket
// closed or opened again at the build (row 13). The shared setup is in ./lane-harness.ts. Today's version.

describe("a lane, whole", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Self-fix PR 11a, jidoka row 62: ship's `behind` at merge reads main fresh, and a clean read runs
  // merge again with no agent turn and no round. The pull request is the one ship reads, so the head
  // with main merged in has to be on it before ship runs again.
  it("row 62: main moves under the review, ship says behind, and the head with main in it is pushed and lands, with no build round", async () => {
    const ELSEWHERE = { path: "docs/elsewhere.md", text: "Written elsewhere.\n" };
    const ran = await lane({
      within: 50,
      picks: { ...YES, step: "stop", rounds_spent: "stop" },
      // Main moves once, as the first review starts: after the lane's head left it.
      fake: { pushesAt: { review: { 0: { branch: "main", ...ELSEWHERE } } } },
    });
    const said = ran.lines.join("\n");
    const moved = codexRuns(ran.dir).find((r) => r.step === "review")?.pushed ?? null;
    expect(moved, "main moved under the review").toMatch(/^[0-9a-f]{40}$/);
    // Ship's first answer at merge: behind.
    const merges = ran.facts.filter((f) => f.type === "ended" && f.stage === "merge");
    expect(merges[0]?.outcome, said).toMatchObject({ kind: "send", to: "builder", why: "behind" });
    // It lands. What landed holds main's commit and the head the lane first pushed: the head with
    // main merged in, pushed before ship ran again, since ship merges only what the pull request holds.
    expect(ran.lines.at(-1), said).toContain("ended: done");
    const landed = onMainHead(ran.remote);
    expect(descends(ran.remote, moved ?? "", landed), "what landed takes main in").toBe(true);
    expect(descends(ran.remote, pushedHead(ran), landed), "and the lane's own head").toBe(true);
    expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
    expect(onMain(ran.remote, ELSEWHERE.path)).toBe(ELSEWHERE.text);
    // No agent turn and no round: the build ran once, in round 1, and nothing stopped.
    const builds = ran.facts.filter((f) => f.type === "started" && f.stage === "build");
    expect(builds.map((f) => f.round)).toEqual([1]);
    expect(said).not.toContain("step_stuck");
    expect(said).not.toContain("sent_back");
    // The route's read pushed the head with main in it itself: after ship's `behind`, the only step
    // is merge again. No push step runs, and the merge is not asked a second time.
    const behind = ran.facts.findIndex((f) => f.type === "ended" && f.stage === "merge");
    expect(
      ran.facts
        .slice(behind)
        .filter((f) => f.type === "started")
        .map((f) => f.stage),
      said,
    ).toEqual(["merge"]);
    expect(askedFor(ran, "merge"), said).toHaveLength(1);
    const read = ran.facts.find((f) => f.type === "restarted" && f.from === "merge");
    expect(
      ran.facts.filter((f) => f.type === "pushed").map((f) => f.head),
      said,
    ).toEqual([pushedHead(ran), read?.to]);
  });

  // Self-fix PR 11a, round 3, review finding 1: a person's commit is taken in at ship's `behind`, so
  // the review does not stand at the head with main merged in. The route's read pushes nothing there:
  // no pull request body and no verdict at a head no review read. The review reads it first, and
  // here it stops, so the pull request and its row stay at the head the lane pushed.
  it("row 62, with a person's commit taken in at ship's behind: nothing is pushed or posted at the head with main in it before a review reads it", async () => {
    const ELSEWHERE = { path: "docs/elsewhere.md", text: "Written elsewhere.\n" };
    const PERSONS = { path: "docs/person.md", text: "A person's note.\n" };
    const MISFIT = "I read the diff and it looks right.";
    const ran = await lane({
      within: 50,
      picks: { ...YES, step: "stop", rounds_spent: "stop" },
      fake: {
        // Main moves once, as the first review starts: after the lane's head left it.
        pushesAt: { review: { 0: { branch: "main", ...ELSEWHERE } } },
        // Every review after the first answers what does not fit, so the lane stops there.
        answers: { review: [null, MISFIT, MISFIT, MISFIT, MISFIT] },
      },
      // A person pushes one commit on top of the lane's head once it is on the pull request.
      branchAfter: { step: "push", files: [PERSONS] },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    const merges = ran.facts.filter((f) => f.type === "ended" && f.stage === "merge");
    expect(merges[0]?.outcome, said).toMatchObject({ kind: "send", to: "builder", why: "behind" });
    // The route's read went on from the person's commit, taken in, and merged main into it.
    const read = ran.facts.find((f) => f.type === "restarted" && f.from === "merge");
    expect(read, said).toBeDefined();
    const theirs = String(read?.head);
    const fresh = String(read?.to);
    expect(remoteGit(ran.remote, "log", "-1", "--format=%s", theirs), said).toBe("A person's change");
    expect(fresh, said).toMatch(/^[0-9a-f]{40}$/);
    expect(fresh).not.toBe(theirs);
    // Its checks there were green, so only the review's standing keeps it from pushing.
    expect(
      ran.facts.filter((f) => f.type === "checked" && f.head === fresh).map((f) => f.result),
      said,
    ).toEqual(["green"]);
    // The review read that head again: the person's commit is in what it was shown.
    const reviews = codexRuns(ran.dir).filter((r) => r.step === "review");
    expect(reviews.length, said).toBeGreaterThan(1);
    expect(reviews[1]?.diff ?? "", said).toContain(PERSONS.path);
    // Nothing was pushed at that head: one `pushed` fact, the lane's own head.
    expect(
      ran.facts.filter((f) => f.type === "pushed").map((f) => f.head),
      said,
    ).toEqual([pushedHead(ran)]);
    // And the pull request's row never shows it, or keeps a verdict given on it.
    const rows = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Pull)))(
      readFileSync(join(ran.dir, "home", "work", "pulls.json"), "utf8"),
    );
    const row = rows.find((r) => r.kind === "lane");
    expect(row?.head, said).toBe(pushedHead(ran));
    expect(row?.posted?.head, said).toBe(pushedHead(ran));
    expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
    expect(ran.lines.at(-1), said).not.toContain("ended: done");
  });

  // Self-fix PR 11a, round 3, mutation M2: red checks at the head with main merged in push nothing.
  // The build runs the next round, told the failing test, as any red after a build does.
  it("row 62, with red checks at the head with main in it: the route's read pushes nothing, and the build runs the next round, told the failing test", async () => {
    const ELSEWHERE = { path: "docs/elsewhere.md", text: "Written elsewhere.\n" };
    const NAME = "src/lower.test.ts > lowers capitals";
    const VITEST = "node_modules/.bin/vitest run --reporter=json --outputFile={out}";
    /** Whether `head`, in the lane's own clone, holds main's moved file. */
    const takesMainIn = ({ dir }: Where, head: string) => {
      try {
        execFileSync("git", ["-C", join(dir, "home", "work", "clone"), "cat-file", "-e", `${head}:${ELSEWHERE.path}`], {
          stdio: "pipe",
        });
        return true;
      } catch {
        return false;
      }
    };
    let saidRed = false;
    const ran = await lane({
      within: 50,
      picks: { ...YES, step: "stop", rounds_spent: "stop" },
      fake: { pushesAt: { review: { 0: { branch: "main", ...ELSEWHERE } } } },
      // Red once: at the first head with main in it, the route's read's. Every other run is real.
      checksSay: (head, _nth, where) => {
        if (saidRed || !takesMainIn(where, head)) {
          return null;
        }

        saidRed = true;
        return {
          head,
          commands: [{ command: VITEST, code: 1, ms: 8_120 }],
          result: "red",
          failed: [NAME],
          tail: `${NAME}: boom`,
        };
      },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    const behind = ran.facts.findIndex((f) => f.type === "ended" && f.stage === "merge");
    expect(ran.facts[behind]?.outcome, said).toMatchObject({
      kind: "send",
      to: "builder",
      why: "behind",
    });
    const read = ran.facts.find((f) => f.type === "restarted" && f.from === "merge");
    const red = ran.facts.filter((f) => f.type === "checked" && f.result === "red");
    expect(
      red.map((f) => f.head),
      said,
    ).toEqual([read?.to]);
    // From ship's `behind` to the next step, nothing is pushed, and that step is the build, round 2.
    const after = ran.facts.slice(behind);
    const next = after.findIndex((f) => f.type === "started");
    expect(after[next]?.stage, said).toBe("build");
    expect(after[next]?.round, said).toBe(2);
    expect(
      after.slice(0, next).filter((f) => f.type === "pushed"),
      said,
    ).toEqual([]);
    expect(codexRuns(ran.dir).filter((r) => r.step === "build")[1]?.prompt).toContain(NAME);
    expect(said).not.toContain("stuck:checks_red");
  });

  // Self-fix PR 11a, jidoka row 13: a step's `skip:closed` is a `host` row. The lane reads the ticket
  // fresh and goes by what it says now, never by the step's word alone: closed ends the lane, open is
  // a person's pause, saved at that step, and the same line goes on there.
  describe("row 13: build's skip:closed reads the ticket fresh", () => {
    /** The `ended` facts after build's. */
    const endsAfterBuild = (ran: Ran) => {
      const ends = ran.facts.filter((f) => f.type === "ended");
      return ends.slice(ends.findIndex((f) => f.stage === "build") + 1);
    };

    it("the ticket still closed: the lane ends skip:closed, and no step runs after the build", async () => {
      const ran = await lane({
        within: 50,
        picks: YES,
        ticketAfter: [{ step: "test_writer", fact: "closed" }],
      });
      const said = ran.lines.join("\n");
      expect(ran.lines, said).not.toContain(TIMED_OUT);
      // The build read the closed ticket and said so.
      expect(ran.names.build, said).toBe(JSON.stringify({ kind: "skip", why: "closed" }));
      const built = ran.facts.findIndex((f) => f.type === "ended" && f.stage === "build");
      expect(ran.facts.slice(built).filter((f) => f.type === "started")).toEqual([]);
      expect(endsAfterBuild(ran)).toEqual([]);
      expect(ran.lines.at(-1), said).toContain("ended: skip:closed");
      expect(said).not.toContain("step_stuck");
      expect(said).not.toContain("paused");
    });

    it("the ticket open again by the time the lane reads it: a saved pause at the build, never skip:closed, and the same line goes on from the build and lands", async () => {
      const ran = await lane({
        within: 50,
        picks: YES,
        ticketAfter: [
          { step: "test_writer", fact: "closed" },
          { step: "build", fact: "reopened" },
        ],
        again: [{}],
      });
      const said = ran.lines.join("\n");
      expect(ran.lines, said).not.toContain(TIMED_OUT);
      // The build said closed, but the lane read the ticket after it, open, and used that.
      const built = ran.facts.find((f) => f.type === "ended" && f.stage === "build");
      expect(built?.outcome, said).toEqual({ kind: "skip", why: "closed" });
      const first = ran.lines.slice(0, ran.lines.indexOf(AGAIN));
      expect(first.at(-1), said).toContain("ask:owner:paused");
      expect(first.join("\n")).not.toContain("ended: skip:closed");
      expect(heldAt(ran, 0), said).toMatchObject({
        outcome: { kind: "ask", who: "owner", for: "paused" },
        at: { _tag: "run", step: "build" },
      });
      // The same line goes on at the build, and lands.
      const steps = ran.facts.filter((f) => f.type === "started").map((f) => f.stage);
      expect(
        steps.filter((step) => step === "build"),
        said,
      ).toHaveLength(2);
      expect(ran.lines.at(-1), said).toContain("ended: done");
      expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
      expect(said).not.toContain("step_stuck");
    });
  });
});
