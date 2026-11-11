import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Duration, Effect, Fiber, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryLedger } from "../../asks/ledger.ts";
import { fakeEnv, makeLaneHome } from "./lane-fixture.ts";
import {
  MODULES,
  BRIEFS,
  OWNER,
  NUMBER,
  file,
  readNumbered,
  YES,
  answering,
  made,
  lane,
  codexRuns,
  remoteGit,
  PASSED_CI,
  onGitHub,
  THE_PLANS_NO,
  commentsOf,
  REAL_LEAN,
  REAL_QUESTION,
} from "./lane-harness.ts";
import { laneLayer, runLane } from "./layer.ts";

// What a lane leaves behind on disk and on the remote, and a long plan's lean. The shared setup is in
// ./lane-harness.ts. Today's version.

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

  // P18
  describe("what a lane leaves behind", () => {
    const entries = (path: string) => (existsSync(path) ? readdirSync(path) : []);
    const leftBehind = (dir: string) => ({
      trees: entries(join(dir, "home", "work", "trees")),
      copies: entries(join(dir, "home", "work", "copies")),
      judges: entries(join(dir, "home", "work", "judges")),
      codexHomes: entries(join(dir, "user", ".cache", "tea-fabrika", "codex")),
    });
    const NOTHING = { trees: [], copies: [], judges: [], codexHomes: [] };
    const branches = (remote: string) =>
      remoteGit(remote, "for-each-ref", "--format=%(refname)", "refs/heads").split("\n");

    it("on the local host, a lane that ends done leaves no tree, copy, judge, Codex home or merged branch", async () => {
      const ran = await lane({ title: "[rules] Read names in one form", within: 50, picks: YES });
      expect(ran.lines.at(-1)).toContain("ended: done");
      expect(leftBehind(ran.dir)).toEqual(NOTHING);
      expect(branches(ran.remote)).toEqual(["refs/heads/main"]);
      const clone = join(ran.dir, "home", "work", "clone");
      const worktrees = execFileSync("git", ["-C", clone, "worktree", "list", "--porcelain"], {
        encoding: "utf8",
      });
      expect(worktrees.match(/^worktree /gm)).toHaveLength(1);
    });

    it("on GitHub, a lane that ends done deletes its merged branch and leaves nothing on disk", async () => {
      const ran = await onGitHub({ rubrics: null, within: 50, picks: YES });
      expect(ran.lines.at(-1)).toContain("ended: done");
      expect(ran.kinds).toContain("ref_delete");
      expect(branches(ran.remote)).toEqual(["refs/heads/main"]);
      expect(leftBehind(ran.dir)).toEqual(NOTHING);
    });

    it("on GitHub, a refused branch delete does not undo a merge: the lane still ends done", async () => {
      const ran = await onGitHub({
        rubrics: null,
        within: 50,
        story: { ...PASSED_CI, refusesBranchDelete: true },
        picks: YES,
      });
      expect(ran.calls.filter((call) => call.kind === "ref_delete")).toMatchObject([{ refused: true }]);
      expect(ran.lines.at(-1)).toContain("ended: done");
      expect(leftBehind(ran.dir)).toEqual(NOTHING);
    });

    it("a lane that ends stuck keeps its tree for a person to read, and its Codex homes still go", async () => {
      // Self-fix PR 5: a touched exam asks the person now, so the stuck end here is a mutation
      // step that could not run.
      const ran = await lane({ within: 50, picks: { approve: "approve" }, failMutation: true });
      expect(ran.names.mutation).toContain("run_failed");
      const left = leftBehind(ran.dir);
      expect(left.trees).toContain("1");
      expect(left.codexHomes).toEqual([]);
    });

    it("a lane that ends done takes its own copies, and leaves what another open lane in its home holds", async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-")));
      made.push(dir);
      const { home, seed } = makeLaneHome({
        dir,
        nodeModules: MODULES,
        reads: [dirname(dirname(dirname(MODULES)))],
      });

      for (const [key, value] of Object.entries(fakeEnv(dir))) {
        vi.stubEnv(key, value);
      }

      const lines: string[] = [];
      const line = (n: number) =>
        runLane(n, (said) => Effect.sync(() => void lines.push(said))).pipe(
          Effect.provide(laneLayer({ home, checkout: seed, briefs: BRIEFS, person: "owner" })),
          Effect.timeoutOption(Duration.seconds(50)),
        );
      const OTHER = NUMBER + 1;
      const seen = await Effect.runPromise(
        Effect.gen(function* () {
          yield* file("Read names in one form", "Lower case, no spaces around.", OWNER);
          yield* file("Read names in another form", "Upper case.", OWNER, OTHER);
          // The other lane first: it reads main at the same commit, and waits at its yes.
          yield* Effect.forkScoped(line(OTHER));

          for (;;) {
            const other = yield* readNumbered(OTHER);

            if (other.timeline.some((e) => e.fact.type === "asked")) {
              break;
            }

            yield* Effect.sleep("50 millis");
          }

          const person = yield* Effect.forkScoped(answering(YES));
          yield* Effect.raceFirst(line(NUMBER), Fiber.join(person));
          return { lines: [...lines], left: leftBehind(dir) };
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(memoryLedger().layer))),
      );
      expect(seen.lines.at(-1)).toContain("#1 ended: done");
      const folder = codexRuns(dir).find((r) => r.step === "plan")?.folder ?? "";
      const held = basename(folder);
      expect(held).toMatch(/^[0-9a-f]{40}$/);
      // The other lane's copy of main, and nothing of this lane's heads.
      expect(seen.left.copies.toSorted()).toEqual([held, `${held}.done`]);
      expect(seen.left.trees).toEqual([]);
      expect(seen.left.judges).toEqual([]);
    });
  });

  // P19
  it("the plan's lean reaches the person whole, however long the plan is", async () => {
    const LONG = "a very long sentence ".repeat(4_000);
    const ran = await lane({
      within: 50,
      picks: THE_PLANS_NO,
      fake: { answers: { plan: [{ with: { summary: LONG, questions: [REAL_QUESTION] } }] } },
    });
    expect(ran.names.plan).toContain('"ask"');
    expect(commentsOf(ran).filter((body) => body.includes(REAL_LEAN))).not.toEqual([]);
  });
});
