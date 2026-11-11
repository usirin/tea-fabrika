// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
import "./catchup.sh?raw";
import "./leakgrep.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./env.sh?raw";
import "./box.sh?raw";
import "./keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pgrep.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./codexexec.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxnode.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxfiles.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./freshmain.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { green, merges, run, type Setup } from "./catchup.test-support.ts";

describe("catchup, today's tooling", () => {
  // Plant: protect the worktree path while forgetting the separate admin directory it deletes.
  it.each(["catchup-900", "driver"] as const)(
    "T318 review3 MAIN sharing %s admin data prevents worktree removal",
    (worktree) => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-z]{2,10}$/), (branch) => {
          const got = run({
            ...green,
            branch: `fabrikalfa/${branch}`,
            cleanup: "clean",
            sharedAdmin: worktree,
          });
          expect(got.code, got.text).toBe(0);
          expect(merges(got.calls)).toHaveLength(1);
          expect(got.remaining, got.text).toContain(worktree);
          expect(got.storage.admin, got.text).toBe(true);
          expect(got.storage.exists, got.text).toBe(true);
          expect(got.storage.files).toEqual(expect.objectContaining(got.storage.saved));
          expect(got.storage.code, got.storage.error).toBe(0);
          expect(got.storage.after).toBe(got.storage.history);
          expect(got.text).toMatch(new RegExp(`^kept worktree ${worktree}: [^\\n]+$`, "m"));
          expect(
            got.calls.some(
              (c) => c.cmd === "git" && c.args.includes("remove") && c.args.some((a) => a.endsWith(`/${worktree}`)),
            ),
          ).toBe(false);
        }),
        { seed: 31863, numRuns: 3, endOnFailure: true },
      );
    },
  );

  // Plant: ignore a nested walk failure and remove a candidate without proving independence.
  it.each(["catchup-900", "driver"] as const)("T318 review3 %s stays when MAIN cannot be fully walked", (worktree) => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 6 }), (parts) => {
        const got = run({ ...green, cleanup: "clean", unwalkable: { worktree, parts } });
        expect(got.code, got.text).toBe(0);
        expect(got.remaining, got.text).toContain(worktree);
        expect(got.storage.admin, got.text).toBe(true);
        expect(got.text).toMatch(new RegExp(`^kept worktree ${worktree}: [^\\n]+$`, "m"));
      }),
      { seed: 31864, numRuns: 3, endOnFailure: true },
    );
  });

  // Plant: today's guard protects MAIN's folder alone and removes borrowed Git storage.
  // Both worktree-removal calls must keep nested alternates and intermediate links, too.
  it.each(
    (["catchup-900", "driver"] as const).flatMap((worktree) =>
      (["gitdir", "commondir", "objects", "alternates", "alternates-file"] as const).flatMap((binding) =>
        (binding === "alternates-file" ? [false] : [false, true]).map((through) => ({
          worktree,
          binding,
          through,
        })),
      ),
    ),
  )("T318 $worktree keeps MAIN storage reached by $binding through link $through", ({ worktree, binding, through }) => {
    fc.assert(
      fc.property(
        fc.record({
          branch: fc.stringMatching(/^[a-z]{2,10}$/),
          parts: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 5 }),
          relative: fc.boolean(),
          hops: fc.integer({ min: 2, max: 4 }),
        }),
        ({ branch, ...path }) => {
          const got = run({
            ...green,
            branch: `fabrikalfa/${branch}`,
            cleanup: "clean",
            storage: { worktree, binding, through, ...path },
          });
          expect(got.code, got.text).toBe(0);
          expect(merges(got.calls)).toHaveLength(1);
          expect(got.remaining, got.text).toContain(worktree);
          expect(got.storage.exists, got.text).toBe(true);
          expect(got.storage.code, got.storage.error).toBe(0);
          expect(got.storage.after).toBe(got.storage.history);
          expect(got.registrations).toContain(`/${worktree}\0`);
          expect(got.text).toMatch(new RegExp(`^kept worktree ${worktree}: [^\\n]+$`, "m"));
          expect(got.state).toBe("saved wait");
          expect(got.keptHead).toBe(got.checkedTip);
        },
      ),
      { seed: 31842, numRuns: 3, endOnFailure: true },
    );
  });

  // Plant: box removal accepts a pair holding MAIN or saved driver state.
  it.each(["main-work", "main-data", "main-child", "main-data-child", "state"] as const)(
    "T318 cleanup preserves protected %s pairs",
    (protectedLocation) => {
      fc.assert(
        fc.property(fc.stringMatching(/^[a-z]{2,12}$/), fc.integer({ min: 1, max: 4 }), (name, depth) => {
          const branch = `fabrikalfa/${name}`;
          const got = run({
            ...green,
            branch,
            cleanup: "clean",
            protected: protectedLocation,
            protectedDepth: depth,
          });
          expect(got.code, got.text).toBe(0);
          expect(merges(got.calls)).toHaveLength(1);
          expect(got.protectedPair, got.text).toEqual([true, true]);
          expect(got.saved).toBe(branch);
          expect(got.state).toBe("saved wait");
          expect(got.text).toMatch(
            new RegExp(`^kept box ${protectedLocation === "state" ? "state" : "protected"}: [^\\n]+$`, "m"),
          );
        }),
        { seed: 31828, numRuns: 3, endOnFailure: true },
      );
    },
  );

  // Plant: remove the locked/prunable guard, formerly catchup.sh line 175.
  it("T318 missing registered worktrees keep their registration and print a reason", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2,12}$/), (name) => {
        const branch = `fabrikalfa/${name}`;
        const got = run({ ...green, branch, cleanup: "clean", trouble: "missing" });
        expect(got.code, got.text).toBe(0);
        expect(merges(got.calls)).toHaveLength(1);
        expect(got.registrations).toContain(`branch refs/heads/${branch}\0`);
        expect(got.text).toMatch(/^kept worktree driver: [^\n]+$/m);
        expect(
          got.calls.some(
            (c) => c.cmd === "git" && c.args.includes("remove") && c.args.some((arg) => arg.endsWith("/driver")),
          ),
        ).toBe(false);
        expect(got.remaining).not.toContain("later box");
        expect(got.state).toBe("saved wait");
      }),
      { seed: 31829, numRuns: 4, endOnFailure: true },
    );
  });

  // Plant: clean before a successful merge, including after checks, trust, pushes or merge fail.
  // `merge: true` is a head that lacks main. Green at its head, it lands without a catch-up (0097),
  // so each failure is planted on both paths: on the fast path (its own checks or trust, the last
  // look at main, the merge) and on the catch-up path a red first look sends it down (the push).
  it("T318 cleanup starts only after a successful merge", () => {
    fc.assert(
      fc.property(
        fc.record({
          suffix: fc.nat({ max: 99 }),
          answer: fc.constantFrom<Setup["answer"]>("red", "event", "app", "ticket", "trust-red"),
        }),
        ({ suffix, answer }) => {
          for (const patch of [
            { answer },
            { merge: true, answer },
            { merge: true, before: "red" as const, refused: "notes" as const },
            { mergeFails: true },
            { merge: true, mergeFails: true },
            { merge: true, stale: true },
          ]) {
            const got = run({
              ...green,
              branch: `fabrikalfa/cleanup-${suffix}`,
              cleanup: "clean",
              ...patch,
            });
            expect(got.code, got.text).toBe(1);

            for (const path of ["exact box", "exact box-gitdata", "later box", "driver", "sibling"]) {
              expect(got.remaining).toContain(path);
            }

            // The catch-up checkout holds nothing of MAIN's, so the EXIT trap force-removes it.
            expect(got.remaining).not.toContain("catchup-900");
            expect(got.keptHead).toBe("");
            const touched = got.calls.filter(
              (c) => c.cmd === "git" && (c.args.includes("remove") || c.args.includes("update-ref")),
            );
            expect(touched).toHaveLength(1);

            for (const call of touched) {
              expect(call.args).toContain("--force");
              expect(call.args.at(-1)).toMatch(/\/catchup-900$/);
            }
          }

          // Positive case keeps this law red until cleanup exists; absence alone is insufficient.
          const landed = run({ ...green, branch: `fabrikalfa/cleanup-${suffix}`, cleanup: "clean" });
          expect(landed.code, landed.text).toBe(0);
          expect(landed.remaining).not.toContain("catchup-900");
          const mergedAt = landed.calls.findIndex((c) => c.key === "merge");

          for (const [i, c] of landed.calls.entries()) {
            if (c.cmd === "git" && (c.args.includes("remove") || c.args.includes("update-ref"))) {
              expect(i).toBeGreaterThan(mergedAt);
            }
          }
        },
      ),
      { seed: 3191, numRuns: 3 },
    );
  });

  // Plants: match a branch prefix, omit refs/keep, or leave the catch-up/driver checkout registered.
  it("T318 cleanup retains the checked head and removes only exact branch boxes and registered worktrees", () => {
    fc.assert(
      fc.property(fc.record({ suffix: fc.stringMatching(/^[a-z]{2,8}$/) }), ({ suffix }) => {
        // Every PR squash-merges (0004), so the run takes no merge method.
        const got = run({ ...green, branch: `fabrikalfa/${suffix}`, cleanup: "clean" });
        expect(got.code, got.text).toBe(0);
        expect(got.keptHead).toBe(got.checkedTip);

        for (const path of [
          "exact box",
          "exact box-gitdata",
          "later box",
          "later box-gitdata",
          "catchup-900",
          "driver",
        ]) {
          expect(got.remaining).not.toContain(path);
        }

        for (const path of ["sibling box", "sibling box-gitdata", "sibling", "state"]) {
          expect(got.remaining).toContain(path);
        }

        expect(got.state).toBe("saved wait");
        const removes = got.calls.filter(
          (c) => c.cmd === "git" && c.args.includes("worktree") && c.args.includes("remove"),
        );
        // The driver goes only when Git agrees; the catch-up checkout is forced, last, by EXIT.
        expect(removes).toHaveLength(2);
        expect(removes.map((c) => [c.args.at(-1)?.split("/").at(-1), c.args.includes("--force")])).toEqual([
          ["driver", false],
          ["catchup-900", true],
        ]);
        expect(
          got.calls.some(
            (c) =>
              c.cmd === "git" && c.args.includes("list") && c.args.includes("--porcelain") && c.args.includes("-z"),
          ),
        ).toBe(true);
        const keepAt = got.calls.findIndex((c) => c.args.includes("refs/keep/pr/900"));
        const firstRemove = got.calls.findIndex((c) => c.args.includes("remove"));
        expect(keepAt).toBeGreaterThan(-1);
        expect(keepAt).toBeLessThan(firstRemove);
      }),
      { seed: 3192, numRuns: 3 },
    );
  });

  // Plants: propagate cleanup failure into merge status; stop after the first kept candidate.
  it("T318 kept dirty unsaved locked malformed or failed candidates never stop later cleanup or turn merge red", () => {
    fc.assert(
      fc.property(fc.nat({ max: 99 }), (suffix) => {
        for (const cleanup of ["dirty", "unsaved", "locked", "malformed", "error"] as const) {
          const got = run({ ...green, branch: `fabrikalfa/kept-${suffix}`, cleanup });
          expect(got.code, got.text).toBe(0);
          expect(merges(got.calls)).toHaveLength(1);
          expect(got.keptHead).toBe(got.checkedTip);
          expect(got.remaining).not.toContain("later box");
          expect(got.remaining).not.toContain("later box-gitdata");
          expect(got.remaining).not.toContain("catchup-900");
          const keepBox = ["dirty", "unsaved", "malformed"].includes(cleanup);
          expect(got.remaining.includes("exact box")).toBe(keepBox);
          expect(got.remaining.includes("exact box-gitdata")).toBe(keepBox);
          expect(got.remaining.includes("driver")).toBe(["dirty", "locked", "error"].includes(cleanup));
          expect(got.text).toMatch(/kept [^\n]+: [^\n]+/);
          expect(got.state).toBe("saved wait");
        }
      }),
      { seed: 3193, numRuns: 3 },
    );
  });

  // Plants (mutation, seed 119120): drop the line for a failed worktree listing; remove
  // worktrees after the keep ref failed; skip an unregistered catch-up checkout silently; or
  // remove one of two worktrees that share the PR branch.
  it("T318 listing keep-ref registration and shared-branch trouble each keep with a line and stay green", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2,8}$/), (suffix) => {
        for (const trouble of ["list", "keep", "unregistered", "twins"] as const) {
          const got = run({ ...green, branch: `fabrikalfa/${suffix}`, cleanup: "clean", trouble });
          expect(got.code, got.text).toBe(0);
          expect(merges(got.calls)).toHaveLength(1);
          expect(got.state).toBe("saved wait");
          const has = (path: string) => got.remaining.includes(path);
          // The catch-up checkout holds nothing of MAIN's here, so whatever the trouble, EXIT
          // force-removes it; only the branch's other worktrees and boxes wait on the trouble.
          expect(has("catchup-900")).toBe(false);

          if (trouble === "list") {
            expect(got.text).toMatch(/^kept worktrees: [^\n]+$/m);
            expect(got.keptHead).toBe(got.checkedTip);

            for (const path of ["driver", "sibling"]) {
              expect(has(path)).toBe(true);
            }

            for (const path of ["exact box", "later box"]) {
              expect(has(path)).toBe(false);
            }
          }

          if (trouble === "keep") {
            expect(got.keptHead).toBe("");
            expect(got.text).toMatch(/^kept worktree driver: [^\n]+$/m);
            expect(got.text).toMatch(/^kept box exact box: [^\n]+$/m);

            for (const path of ["driver", "exact box", "later box"]) {
              expect(has(path)).toBe(true);
            }
          }

          if (trouble === "unregistered") {
            for (const path of ["driver", "exact box", "later box"]) {
              expect(has(path)).toBe(false);
            }
          }

          if (trouble === "twins") {
            for (const path of ["driver", "driver twin"]) {
              expect(has(path)).toBe(true);
              expect(got.text).toMatch(new RegExp(`^kept worktree ${path}: [^\\n]+$`, "m"));
            }

            for (const path of ["catchup-900", "exact box", "later box"]) {
              expect(has(path)).toBe(false);
            }
          }
        }
      }),
      { seed: 3195, numRuns: 2 },
    );
  });
});
