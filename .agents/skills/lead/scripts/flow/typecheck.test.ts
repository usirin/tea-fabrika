// Today's lead tooling. The typecheck's deciding part is pure and read here; nothing runs tsc.
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../codexexec.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../botpush.mjs?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../box.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../box/BoxGit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../box/BoxGitProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../box/Remove.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../box/Runs.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../box/RunsProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../boxnode.ts?raw";
import "../catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../chain.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../runid.ts?raw";
import "../clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../drive.ts?raw";
import "../env.sh?raw";
import "../fieldrow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../freshmain.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../gc.ts?raw";
import "../keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../lane.ts?raw";
import "../leakgrep.sh?raw";
import "../loosening.sh?raw";
import "../mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../mutbox.Dockerfile?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../mutbox.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../pgrep.ts?raw";
import "../redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../sizecap.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Beat.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Outcome.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Runners.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./Step.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./host.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../mutation/scripts/limit.ts?raw";
import "../../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../mutation/scripts/scope.ts?raw";
import "../../../plan/scripts/plancheck.sh?raw";
import "../../../step-commit/scripts/exam.py?raw";
import "../../../step-commit/scripts/stepcommit.sh?raw";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { errorsIn, type Found, LINES, summary, verdict, WIDTH } from "./typecheck.ts";

const options = { seed: 119120, numRuns: 300 };
const part = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
const dir = fc.array(part, { minLength: 1, maxLength: 3 }).map((ps) => ps.join("/"));
const file = fc.tuple(fc.array(part, { maxLength: 2 }), part).map(([ps, f]) => [...ps, `${f}.ts`].join("/"));
const message = fc.stringMatching(/^[A-Za-z][A-Za-z' ]{0,40}[a-z.]$/);
const root = "/w/lane-typecheck";
const error = (path: string, text: string) => `${path}(3,7): error TS2322: ${text}`;

const found = (paths: ReadonlyArray<string>): ReadonlyArray<Found> =>
  paths.map((path) => ({ path, text: error(path, "bad") }));

describe("the host typecheck reads tsc's errors, today's tooling", () => {
  // Edge cases, each a law: a `pnpm -r` prefix, no prefix, `..` and `.` in a path, an absolute
  // path inside and outside the worktree, indented lines that go on, and pnpm's own lines.
  it("property: a prefixed error's path is the package's folder joined with the file", () => {
    fc.assert(
      fc.property(dir, file, message, (d, f, m) => {
        const out = `${d} typecheck$ tsc --noEmit -p .\n${d} typecheck: ${error(f, m)}\n${d} typecheck: Failed`;
        expect(errorsIn(out, root)).toEqual([{ path: `${d}/${f}`, text: error(`${d}/${f}`, m) }]);
      }),
      options,
    );
  });

  it("property: an unprefixed error keeps its path, and `.` and `..` resolve inside the repo", () => {
    fc.assert(
      fc.property(dir, file, message, (d, f, m) => {
        expect(errorsIn(error(f, m), root).map((e) => e.path)).toEqual([f]);
        const up = `${d} typecheck: ${error(`../${f}`, m)}`;
        const above = d.split("/").slice(0, -1).join("/");
        expect(errorsIn(up, root).map((e) => e.path)).toEqual([above === "" ? f : `${above}/${f}`]);
        const here = `${d} typecheck: ${error(`./${f}`, m)}`;
        expect(errorsIn(here, root).map((e) => e.path)).toEqual([`${d}/${f}`]);
      }),
      options,
    );
  });

  it("pinned: an absolute path in the worktree is its repo path; one outside stays absolute", () => {
    const inside = `apps/x typecheck: ${error(`${root}/next/a.ts`, "bad")}`;
    expect(errorsIn(inside, root).map((e) => e.path)).toEqual(["next/a.ts"]);
    expect(errorsIn(error("/elsewhere/b.ts", "bad"), root).map((e) => e.path)).toEqual(["/elsewhere/b.ts"]);
  });

  it("pinned: the worktree's own path never rides in a line, so no laptop path reaches a step", () => {
    const out = [
      `p typecheck: ${error("src/a.ts", `Type 'typeof import("${root}/p/src/b")' is wrong.`)}`,
      `p typecheck:   Type 'typeof import("${root}/p/src/c")' is not 'X'.`,
    ].join("\n");
    const [e] = errorsIn(out, root);
    expect(e?.text).toBe(
      `${error("p/src/a.ts", `Type 'typeof import("p/src/b")' is wrong.`)}\n  Type 'typeof import("p/src/c")' is not 'X'.`,
    );
  });

  it("format: indented lines join the error above; pnpm's own lines are no error", () => {
    const out = [
      "packages/p typecheck$ tsc --noEmit -p .",
      `packages/p typecheck: ${error("src/a.ts", "Type 'A' is not assignable to type 'B'.")}`,
      "packages/p typecheck:   Property 'x' is missing in type 'A'.",
      "packages/p typecheck: Failed",
      "[ELIFECYCLE] Command failed with exit code 1.",
      '  × "pnpm recursive run" failed in /w/lane-typecheck/packages/p',
    ].join("\n");
    expect(errorsIn(out, root)).toEqual([
      {
        path: "packages/p/src/a.ts",
        text: `${error("packages/p/src/a.ts", "Type 'A' is not assignable to type 'B'.")}\n  Property 'x' is missing in type 'A'.`,
      },
    ]);
    expect(errorsIn("packages/p typecheck: Done\nall good", root)).toEqual([]);
  });

  it("format: a line that goes on joins its own package's error when pnpm mixes two packages", () => {
    const out = [
      `packages/p typecheck: ${error("src/a.ts", "Type 'A' is wrong.")}`,
      "packages/q typecheck$ tsc --noEmit -p .",
      "packages/p typecheck:   Property 'x' is missing.",
      "packages/q typecheck:   not an error's line",
    ].join("\n");
    expect(errorsIn(out, root).map((e) => e.text)).toEqual([
      `${error("packages/p/src/a.ts", "Type 'A' is wrong.")}\n  Property 'x' is missing.`,
    ]);
  });
});

describe("the host typecheck's result, today's tooling", () => {
  const paths = fc.array(file, { minLength: 1, maxLength: 40 });

  it("property: exit 0 is green, whatever the output says", () => {
    fc.assert(
      fc.property(paths, fc.string(), (ps, out) => {
        expect(verdict({ code: 0, output: out }, found(ps), new Set(ps))._tag).toBe("green");
      }),
      options,
    );
  });

  it("property: a failure goes to tests only when every error is in an exam path, else to build", () => {
    fc.assert(
      fc.property(paths, fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }), (ps, picks) => {
        const exam = new Set(ps.filter((_, i) => picks[i]));
        const v = verdict({ code: 1, output: "x" }, found(ps), exam);
        expect(v).toMatchObject({ _tag: "red", to: ps.every((p) => exam.has(p)) ? "tests" : "build" });
      }),
      options,
    );
  });

  it("property: a red result carries every error line up to LINES, and says how many it left out", () => {
    fc.assert(
      fc.property(paths, (ps) => {
        const v = verdict({ code: 2, output: "x" }, found(ps), new Set());
        expect(v._tag).toBe("red");

        if (v._tag === "red") {
          expect(v.lines.length).toBe(Math.min(ps.length, LINES));
          const kept = ps.length > LINES ? LINES - 1 : ps.length;
          expect(v.lines.slice(0, kept)).toEqual(found(ps.slice(0, kept)).map((e) => e.text));

          if (ps.length > LINES) {
            expect(v.lines.at(-1)).toBe(`... and ${ps.length - LINES + 1} more lines`);
          }
        }
      }),
      options,
    );
  });

  it("vector: LINES errors fit whole; one more keeps LINES - 1 and the count line", () => {
    const at = (n: number) => Array.from({ length: n }, (_, i) => `f${i}.ts`);
    expect(verdict({ code: 1, output: "x" }, found(at(LINES)), new Set())).toMatchObject({
      lines: found(at(LINES)).map((e) => e.text),
    });
    const over = verdict({ code: 1, output: "x" }, found(at(LINES + 1)), new Set());
    expect(over).toMatchObject({ lines: [...found(at(LINES - 1)).map((e) => e.text), "... and 2 more lines"] });
  });

  it("property: no line is longer than WIDTH, and a cut line keeps its start", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 600 }), (m) => {
        const v = verdict({ code: 1, output: "x" }, [{ path: "a.ts", text: error("a.ts", m) }], new Set());
        const whole = error("a.ts", m);
        expect(v._tag).toBe("red");
        const lines = v._tag === "red" ? v.lines : [];
        expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(WIDTH);
        const first = lines[0] ?? "";
        expect(whole.startsWith(first.endsWith("...") ? first.slice(0, -3) : first)).toBe(true);
      }),
      options,
    );
  });

  it("property: a failure with no error line did not check the code, so it is skipped with why", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 255 }), message, (code, last) => {
        const v = verdict({ code, output: `ERR_PNPM_X\n${last}\n` }, [], new Set());
        expect(v).toEqual({ _tag: "skipped", reason: `pnpm typecheck exited ${code} with no error line: ${last}` });
      }),
      options,
    );
  });
});

describe("the host typecheck's line in the lane's log, today's tooling", () => {
  it("format: green, red with its step and first line, or why it did not run", () => {
    expect(summary({ _tag: "green" })).toBe("green");
    expect(summary({ _tag: "red", to: "tests", lines: ["a.ts(1,1): error TS1: x", "b"] })).toBe(
      "red, to tests: a.ts(1,1): error TS1: x",
    );
    expect(summary({ _tag: "skipped", reason: "no worktree" })).toBe("did not run: no worktree");
  });
});
