import { Effect, Option, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  YES,
  TIMED_OUT,
  AGAIN,
  keptAsLegacy,
  pushToMain,
  lane,
  onMain,
  codexRuns,
  remoteGit,
  heldAt,
  secondLine,
  askedFor,
  inClone,
  holds,
  changedBy,
  roundsOf,
  moveMain,
  restartOf,
  headBefore,
  REDONE_MARK,
  REDO,
  SEE,
} from "./lane-harness.ts";

// A stopped lane, typed again: main taken in by a merge, and saves from before a change. The shared
// setup is in ./lane-harness.ts. Today's version.

describe("a stopped lane, typed again", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exam_conflict, `again`: the test writer redoes the conflicted file alone, on main, its check runs, and build goes on from the builder's rebased head", async () => {
    const ON_MAIN =
      'import {expect, it} from "vitest";\n\nit("lowers on main", () => {\n\texpect("AB".toLowerCase()).toBe("ab");\n});\n';
    const ran = await lane({
      within: 50,
      picks: { ...YES, exam_conflict: "again" },
      failMutation: true,
      fake: { answers: REDO, see: SEE },
      again: [
        {
          between: (where) => Effect.sync(() => pushToMain(where, [{ path: "src/lower.test.ts", text: ON_MAIN }])),
        },
      ],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(askedFor(ran, "exam_conflict"), said).toHaveLength(1);
    // The redo is the test writer's check's second run: on main, changing the conflicted file alone.
    // The file exists on main, so the test writer must be let write it again: not a new file beside it.
    const checks = ran.onBase.filter((c) => c.line === 1);
    expect(checks[0]?.files, said).toEqual(["src/lower.test.ts"]);
    // Main's side of the conflicted file stands, so the test writer starts from main's version.
    const writers = codexRuns(ran.dir).filter((r) => r.step === "tests");
    expect(writers[1]?.seen["src/lower.test.ts"], said).toContain("lowers on main");
    const redo = checks[0]?.commit ?? "";
    expect(changedBy(ran, redo)).toEqual(["src/lower.test.ts"]);
    expect(holds(ran, redo, "src/lower.ts")).toBe(false);
    // The build goes on from the builder's head, rebased: its work stands, with the redone test.
    const builds = codexRuns(ran.dir).filter((r) => r.step === "build");
    expect(builds, said).toHaveLength(2);
    expect(builds[1]?.seen["src/lower.ts"]).toContain("toLowerCase");
    expect(builds[1]?.seen["src/lower.test.ts"]).toContain(REDONE_MARK);
    expect(roundsOf(ran, "build")).toEqual([1, 2]);
    expect(ran.lines.at(-1)).toContain("ended: done");
  });

  it("a lane branch already pushed takes main in by a merge, never a rebase: the head it pushed stays under main", async () => {
    const ran = await lane({
      within: 50,
      picks: YES,
      queues: { merge: ["no", "merge"] },
      again: [{ between: moveMain }],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    // The `no` on the merge paused it after the push, to ask the merge again.
    expect(heldAt(ran, 0)?.at, said).toMatchObject({ _tag: "ask", for: "merge" });
    const pushed = ran.facts.find((f) => f.type === "pushed");
    expect(pushed, said).toBeDefined();
    const head = String(pushed?.head);
    expect(ran.facts.filter((f) => f.type === "restarted")).toHaveLength(1);
    expect(ran.lines.at(-1), said).toContain("ended: done");
    expect(onMain(ran.remote, "docs/elsewhere.md")).toContain("Written elsewhere.");
    expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
    // A rebase would rewrite the pushed head, and it would never reach main.
    const under = (() => {
      try {
        remoteGit(ran.remote, "merge-base", "--is-ancestor", head, "main");
        return true;
      } catch {
        return false;
      }
    })();
    expect(under, `${head} is not under main`).toBe(true);
  });

  // Self-fix PR 10, Part 4 (docs/direction/a-yes-binds-to-the-diff.md): main moved in another file, so
  // the merge of main into the pushed branch replays the reviewed diff cleanly. The review carries to
  // the merged head, with a `carried` fact, and runs no second time. The push shows the merged head,
  // then the merge is asked again, at that head.
  it("main merged into a pushed branch, in another file: the review carries to the merged head and does not run again", async () => {
    const ran = await lane({
      within: 50,
      picks: YES,
      queues: { merge: ["no", "merge"] },
      again: [{ between: moveMain }],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(ran.lines.at(-1), said).toContain("ended: done");
    expect(
      codexRuns(ran.dir).filter((r) => r.step === "review"),
      said,
    ).toHaveLength(1);
    const restarted = ran.facts.findIndex((f) => f.type === "restarted");
    expect(restarted, said).toBeGreaterThan(-1);
    const after = ran.facts
      .slice(restarted)
      .filter((f) => f.type === "started")
      .map((f) => String(f.stage));
    expect(after, said).not.toContain("review");
    expect(after.indexOf("push"), said).toBeGreaterThan(-1);
    expect(after.indexOf("push")).toBeLessThan(after.indexOf("merge"));
    // Self-fix PR 11a, round 3, mutation M2: a restart's read pushes nothing itself. The push step
    // after it puts the merged head on the pull request.
    const pushStarted = ran.facts.findIndex((f, i) => i > restarted && f.type === "started" && f.stage === "push");
    expect(
      ran.facts.slice(restarted, pushStarted).filter((f) => f.type === "pushed"),
      said,
    ).toEqual([]);
    const pushed = ran.facts.filter((f) => f.type === "pushed").map((f) => String(f.head));
    expect(pushed, said).toHaveLength(2);
    expect(
      ran.facts.filter((f) => f.type === "carried"),
      said,
    ).toContainEqual(expect.objectContaining({ from: pushed[0], to: pushed[1], why: "replayed" }));
    expect(onMain(ran.remote, "docs/elsewhere.md")).toContain("Written elsewhere.");
    expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
  });

  // Round 3 of the tests for self-fix PR 5: what the mutation step found no test held.

  it("main changes the builder's file while the lane is stuck: main's side stands, and the build runs again from it", async () => {
    const MAIN_LOWER =
      "// Written on main.\nexport function lower(name: string): string {\n\treturn name.toLowerCase();\n}\n";
    const ran = await lane({
      within: 50,
      picks: YES,
      failMutation: true,
      fake: { see: SEE },
      again: [
        {
          between: (where) => Effect.sync(() => pushToMain(where, [{ path: "src/lower.ts", text: MAIN_LOWER }])),
        },
      ],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    const builds = codexRuns(ran.dir).filter((r) => r.step === "build");
    expect(builds, said).toHaveLength(2);
    expect(builds[1]?.prompt).toContain("src/lower.ts");
    expect(builds[1]?.seen["src/lower.ts"], said).toContain("Written on main.");
    expect(ran.lines.at(-1)).toContain("ended: done");
    // Round 4, record wide: the restart names where main's side won.
    expect(restartOf(ran), said).toMatchObject({
      head: headBefore(ran),
      conflicts: ["src/lower.ts"],
    });
  });

  it("a stop no line restarts, typed again: the line says it is a person's call, and restarts nothing", async () => {
    const ran = await lane({ writer: "user:someone", again: [{}] });
    const again = secondLine(ran);
    expect(again, ran.lines.join("\n")).toContain("a person's call");
    expect(again).not.toMatch(/restart: #\d+ from/);
    expect(ran.stages).toEqual([]);
    expect(ran.lines.at(-1)).toMatch(/not_yours/);
  });

  // Round 4 of the tests for self-fix PR 5, from the review.

  it("a build whose checks could not run, typed again: the restart runs the checks at its head, and the builder does not run again", async () => {
    const ran = await lane({
      within: 50,
      picks: YES,
      // The first checks after the build could not run; every later run is real.
      checksSay: (head, nth) =>
        nth === 0
          ? {
              head,
              commands: [{ command: "node_modules/.bin/vitest run", code: null, ms: 3 }],
              result: "not_run",
              failed: [],
              tail: "spawn ENOSPC",
            }
          : null,
      again: [{}],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(ran.lines[ran.lines.indexOf(AGAIN) - 1], said).toContain("stuck:checks_not_run");
    const restarted = ran.facts.findIndex((f) => f.type === "restarted");
    expect(restarted, said).toBeGreaterThan(-1);
    const after = ran.facts.slice(restarted);
    // Code's checks at the head, before any step runs on it.
    const checked = after.findIndex((f) => f.type === "checked");
    const started = after.findIndex((f) => f.type === "started");
    expect(checked, said).toBeGreaterThan(-1);
    expect(checked).toBeLessThan(started);
    expect(after[checked]).toMatchObject({ result: "green" });
    expect(after[started]?.stage).toBe("mutation");
    expect(
      codexRuns(ran.dir).filter((r) => r.step === "build"),
      said,
    ).toHaveLength(1);
    expect(ran.lines.at(-1)).toContain("ended: done");
  });

  it("a lane from before code ran the checks, typed again after main moved: the restart runs the checks at its new head before the step it stopped at", async () => {
    const ran = await lane({
      within: 50,
      picks: YES,
      failMutation: true,
      // The ends keep their carries, so the fold finds the plan and goes on at mutation; only the
      // checks are gone, as from a lane code stopped before it ran them.
      beforeChecks: true,
      again: [{ between: (where) => Effect.andThen(keptAsLegacy(where.home), moveMain(where)) }],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    const restarted = ran.facts.findIndex((f) => f.type === "restarted");
    expect(restarted, said).toBeGreaterThan(-1);
    const after = ran.facts.slice(restarted);
    const checked = after.findIndex((f) => f.type === "checked");
    const started = after.findIndex((f) => f.type === "started");
    expect(checked, said).toBeGreaterThan(-1);
    expect(checked).toBeLessThan(started);
    // At the head the rebase gave, not the one the lane stopped at.
    expect(after[checked]).toMatchObject({ result: "green" });
    expect(after[checked]?.head).not.toBe(headBefore(ran));
    expect(after[started]?.stage).toBe("mutation");
    expect(ran.lines.at(-1)).toContain("ended: done");
  });

  it("a lane from before its ends kept a carry, typed again: the fold names `plan`, the branch starts again from main, and the old head stays under the ref the restart names", async () => {
    const ran = await lane({
      within: 50,
      picks: YES,
      failMutation: true,
      beforeCarries: true,
      fake: { see: SEE },
      again: [{ between: ({ home }) => keptAsLegacy(home) }],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(secondLine(ran), said).toMatch(/restart: #1 from plan\b/);
    const old = headBefore(ran);
    expect(old, said).toMatch(/^[0-9a-f]{40}$/);
    // The test writer runs again on main's head, not on the old build.
    const writers = codexRuns(ran.dir).filter((r) => r.step === "tests");
    expect(writers, said).toHaveLength(2);
    expect(writers[1]?.seen["src/lower.ts"] ?? "", said).not.toContain("toLowerCase");
    const restarted = ran.facts.findIndex((f) => f.type === "restarted");
    const written = ran.facts
      .slice(restarted)
      .filter((f) => f.type === "ended" && f.stage === "test_writer")
      .flatMap((f) => {
        const kept = Schema.decodeUnknownOption(Schema.Struct({ head: Schema.String }))(f.carry);
        return Option.isSome(kept) ? [kept.value.head] : [];
      });
    expect(written, said).toHaveLength(1);
    expect(inClone(ran, "rev-parse", `${written[0]}^`)).toBe(restartOf(ran)?.onto);
    // The old head is kept: on the fact, and under a ref the restart names, still reachable.
    const fact = restartOf(ran);
    expect(fact, said).toMatchObject({ head: old, kept: expect.stringMatching(/^refs\//) });
    expect(inClone(ran, "rev-parse", String(fact?.kept))).toBe(old);
    expect(ran.lines.at(-1)).toContain("ended: done");
  });

  it("a save from before the lane kept its `Held`, typed again when the ticket cannot be read: the lane stops `step_failed`, and runs nothing from an empty fold", async () => {
    const ran = await lane({
      within: 50,
      picks: YES,
      failMutation: true,
      readFailsAt: 1,
      again: [{ between: ({ home }) => keptAsLegacy(home) }],
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(ran.lines.at(-1), said).toContain("ended: stuck:step_failed");
    expect(ran.facts.filter((f) => f.type === "restarted")).toEqual([]);
    expect(codexRuns(ran.dir).filter((r) => r.step === "triage")).toHaveLength(1);
  });
});
