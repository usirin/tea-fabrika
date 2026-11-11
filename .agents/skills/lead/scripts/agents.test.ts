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
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
import "./catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./freshmain.ts?raw";
import "./box.sh?raw";
import "./keepruns.sh?raw";
import "./leakgrep.sh?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Exit } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ADAPTER_SCRIPTS, adaptersReady, type Install } from "./agents.ts";

/** A checkout's adapters folder holding the scripts named, and an install that writes `writes`. */
const world = (present: ReadonlyArray<string>, writes: ReadonlyArray<string>, code: number) => {
  const root = mkdtempSync(join(tmpdir(), "adapters-"));
  const modules = join(root, "adapters", "node_modules");
  const put = (s: string) => {
    mkdirSync(dirname(join(modules, s)), { recursive: true });
    writeFileSync(join(modules, s), "");
  };
  present.forEach(put);
  const calls: string[] = [];
  const install: Install = (folder) =>
    Effect.sync(() => {
      calls.push(folder);
      writes.forEach(put);
      return { code, said: code === 0 ? "" : "ERR_PNPM_FETCH offline" };
    });
  return { root, modules: `${modules}/`, install, calls };
};

const subset = fc.subarray([...ADAPTER_SCRIPTS]);

/** The law, run on a fresh world that is removed after. */
const judged = (
  present: ReadonlyArray<string>,
  writes: ReadonlyArray<string>,
  code: number,
  law: (w: ReturnType<typeof world>, exit: Exit.Exit<void, unknown>) => void,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => world(present, writes, code)),
    (w) =>
      adaptersReady(w.modules, w.install).pipe(
        Effect.exit,
        Effect.tap((exit) => Effect.sync(() => law(w, exit))),
      ),
    (w) => Effect.sync(() => rmSync(w.root, { recursive: true, force: true })),
  ).pipe(Effect.asVoid, Effect.runPromise);

describe("adaptersReady (ticket 565)", () => {
  // Plants (each failed this law by hand): never install; install even when nothing is missing;
  // succeed when the install left a script missing.
  it("property: installs only when a script is missing, once, and fails only when one is still missing", () =>
    fc.assert(
      fc.asyncProperty(subset, subset, fc.constantFrom(0, 1), (present, writes, code) =>
        judged(present, writes, code, (w, exit) => {
          const before = ADAPTER_SCRIPTS.filter((s) => !present.includes(s));
          const after = before.filter((s) => !writes.includes(s));
          expect(w.calls).toEqual(before.length === 0 ? [] : [join(w.root, "adapters")]);
          expect(Exit.isSuccess(exit)).toBe(after.length === 0);
          const error = Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "";
          expect(after.filter((s) => !error.includes(s))).toEqual([]);
          expect(error === "" || error.includes(`install exit ${code}`)).toBe(true);
        }),
      ),
      { seed: 565, numRuns: 24 },
    ));

  it("scenario: layout0 on 2026-11-10, a fresh worktree with no adapters, starts once the install writes them", () =>
    judged([], ADAPTER_SCRIPTS, 0, (w, exit) => {
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(w.calls).toHaveLength(1);
    }));
});
