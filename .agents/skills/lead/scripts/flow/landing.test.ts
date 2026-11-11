// What the landing runners read from each script, and that they refuse args they cannot parse. No
// script runs here.
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../botpush.mjs?raw";
import "../box.sh?raw";
import "../catchup.sh?raw";
import "../clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../drive.ts?raw";
import "../env.sh?raw";
import "../fieldrow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Flow.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Outcome.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Runners.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../freshmain.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../gc.ts?raw";
import "../governance.sh?raw";
import "../keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../lane.ts?raw";
import "../leakgrep.sh?raw";
import "../mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../mutbox.Dockerfile?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../mutbox.ts?raw";
import "../redact.sh?raw";
import "../../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../mutation/scripts/scope.ts?raw";
import "../../../plan/scripts/plancheck.sh?raw";
import "../../../step-commit/scripts/exam.py?raw";
import "../../../step-commit/scripts/stepcommit.sh?raw";
import { NodeServices } from "@effect/platform-node";
import { Effect, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import { landDecision } from "./flows/land-decision.ts";
import { commitOutcome, createdPr, leakOutcome, listedPr, passOrStuck, runners as landing } from "./landing.ts";
import * as Step from "./Step.ts";

const ran = <A, E>(law: Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>) =>
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  Effect.runPromise(law.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const decision = landDecision({
  ticket: "656",
  dir: "worktree",
  branch: "fabrikalfa/adr-x",
  paths: [".decisions/0000-x.md"],
  subject: "T656 lead: x",
  title: "x",
  body: "y",
});

describe("what the landing scripts' exit codes mean", () => {
  const r = (code: number, output = "line") => ({ code, output });

  it("pinned: the landing table has a runner for each step of the land-decision flow, and no other", () => {
    expect(Object.keys(landing).toSorted()).toEqual(decision.steps.map((s) => s.name).toSorted());
  });

  it("vector: each script's exit codes, as the scripts document them", () => {
    expect(passOrStuck("pnpm lint", r(0))._tag).toBe("done");
    expect(passOrStuck("pnpm lint", r(1))._tag).toBe("stuck");
    expect(commitOutcome(r(0))._tag).toBe("done");
    expect(commitOutcome(r(5))._tag).toBe("ask");
    expect(commitOutcome(r(4))._tag).toBe("stuck");
    expect(leakOutcome(r(0))._tag).toBe("done");
    expect(leakOutcome(r(1))._tag).toBe("ask");
    expect(leakOutcome(r(2))._tag).toBe("stuck");
    expect(listedPr(r(0, "812\n"))).toBe(812);
    expect(listedPr(r(0, "\n"))).toBeNull();
    expect(listedPr(r(1, "812"))).toBeNull();
    expect(createdPr(r(0, "https://github.com/o/r/pull/813\n"))).toBe(813);
    expect(createdPr(r(1, "https://github.com/o/r/pull/813"))).toBeNull();
  });

  it("scenario: a runner whose args do not parse fails, since a wrong flow file must not run a script", () =>
    ran(
      Effect.gen(function* () {
        const format = landing.format;
        expect(format).toBeDefined();
        const failed = yield* (format ?? (() => Effect.die("no format")))(Step.act("format", { folder: "x" })).pipe(
          Effect.flip,
        );
        expect(failed.reason).toContain("args do not parse");
      }),
    ));
});
