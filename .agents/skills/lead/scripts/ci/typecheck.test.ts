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
import "../boxfiles.ts?raw";
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
import "../flow/Beat.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../flow/Outcome.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../flow/Runners.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../flow/Step.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../flow/host.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./ChecksGh.ts?raw";
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
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../gcloop.ts?raw";
import { NodeServices } from "@effect/platform-node";
import { Effect, Option } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ChecksError } from "./Checks.ts";
import * as ChecksTest from "./ChecksTest.ts";
import { errorsIn, type Found, LINES, logText, summary, type Verdict, verdict, wait, WIDTH } from "./typecheck.ts";

const options = { seed: 119120, numRuns: 300 };
const part = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/);
const dir = fc.array(part, { minLength: 1, maxLength: 3 }).map((ps) => ps.join("/"));
const file = fc.tuple(fc.array(part, { maxLength: 2 }), part).map(([ps, f]) => [...ps, `${f}.ts`].join("/"));
const message = fc.stringMatching(/^[A-Za-z][A-Za-z' ]{0,40}[a-z.]$/);
// A made-up checkout, in the shape a runner lays one out: `.../work/<name>/<name>`.
const root = "/w/work/lane/lane";
const error = (path: string, text: string) => `${path}(3,7): error TS2322: ${text}`;

const found = (paths: ReadonlyArray<string>): ReadonlyArray<Found> =>
  paths.map((path) => ({ path, text: error(path, "bad") }));

describe("CI's typecheck log gives tsc's errors, today's tooling", () => {
  // Edge cases, each a law: a `pnpm -r` prefix, no prefix, `..` and `.` in a path, an absolute
  // path inside and outside the checkout, indented lines that go on, and pnpm's own lines.
  it("property: a prefixed error's path is the package's folder joined with the file", () => {
    fc.assert(
      fc.property(dir, file, message, (d, f, m) => {
        const out = `${d} typecheck$ tsc --noEmit -p .\n${d} typecheck: ${error(f, m)}\n${d} typecheck: Failed`;
        expect(errorsIn(out)).toEqual([{ path: `${d}/${f}`, text: error(`${d}/${f}`, m) }]);
      }),
      options,
    );
  });

  it("property: an unprefixed error keeps its path, and `.` and `..` resolve inside the repo", () => {
    fc.assert(
      fc.property(dir, file, message, (d, f, m) => {
        expect(errorsIn(error(f, m)).map((e) => e.path)).toEqual([f]);
        const up = `${d} typecheck: ${error(`../${f}`, m)}`;
        const above = d.split("/").slice(0, -1).join("/");
        expect(errorsIn(up).map((e) => e.path)).toEqual([above === "" ? f : `${above}/${f}`]);
        const here = `${d} typecheck: ${error(`./${f}`, m)}`;
        expect(errorsIn(here).map((e) => e.path)).toEqual([`${d}/${f}`]);
      }),
      options,
    );
  });

  it("pinned: an absolute path in the checkout is its repo path; one outside stays absolute", () => {
    const inside = `apps/x typecheck: ${error(`${root}/next/a.ts`, "bad")}`;
    expect(errorsIn(inside).map((e) => e.path)).toEqual(["next/a.ts"]);
    expect(errorsIn(error("/elsewhere/b.ts", "bad")).map((e) => e.path)).toEqual(["/elsewhere/b.ts"]);
  });

  it("pinned: the checkout's own path never rides in a line, so no runner path reaches a step", () => {
    const out = [
      `p typecheck: ${error("src/a.ts", `Type 'typeof import("${root}/p/src/b")' is wrong.`)}`,
      `p typecheck:   Type 'typeof import("${root}/p/src/c")' is not 'X'.`,
    ].join("\n");
    const [e] = errorsIn(out);
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
    expect(errorsIn(out)).toEqual([
      {
        path: "packages/p/src/a.ts",
        text: `${error("packages/p/src/a.ts", "Type 'A' is not assignable to type 'B'.")}\n  Property 'x' is missing in type 'A'.`,
      },
    ]);
    expect(errorsIn("packages/p typecheck: Done\nall good")).toEqual([]);
  });

  it("format: a line that goes on joins its own package's error when pnpm mixes two packages", () => {
    const out = [
      `packages/p typecheck: ${error("src/a.ts", "Type 'A' is wrong.")}`,
      "packages/q typecheck$ tsc --noEmit -p .",
      "packages/p typecheck:   Property 'x' is missing.",
      "packages/q typecheck:   not an error's line",
    ].join("\n");
    expect(errorsIn(out).map((e) => e.text)).toEqual([
      `${error("packages/p/src/a.ts", "Type 'A' is wrong.")}\n  Property 'x' is missing.`,
    ]);
  });
});

describe("CI's typecheck job's result, today's tooling", () => {
  const paths = fc.array(file, { minLength: 1, maxLength: 40 });
  const failed = (output = "x") => ({ conclusion: "failure", output });

  it("property: success is green, whatever the log says", () => {
    fc.assert(
      fc.property(paths, fc.string(), (ps, out) => {
        expect(verdict({ conclusion: "success", output: out }, found(ps), new Set(ps))._tag).toBe("green");
      }),
      options,
    );
  });

  it("property: any ending but success or failure is no answer, and says how it ended", () => {
    const other = fc.constantFrom("cancelled", "skipped", "timed_out", "neutral", "action_required", "stale");
    fc.assert(
      fc.property(other, paths, (conclusion, ps) => {
        expect(verdict({ conclusion, output: "x" }, found(ps), new Set())).toEqual({
          _tag: "skipped",
          reason: `CI's typecheck job ended ${conclusion}`,
        });
      }),
      options,
    );
    expect(verdict({ conclusion: null, output: "" }, [], new Set())).toEqual({
      _tag: "skipped",
      reason: "CI's typecheck job ended with no conclusion",
    });
  });

  it("property: a failure goes to tests only when every error is in an exam path, else to build", () => {
    fc.assert(
      fc.property(paths, fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }), (ps, picks) => {
        const exam = new Set(ps.filter((_, i) => picks[i]));
        const v = verdict(failed(), found(ps), exam);
        expect(v).toMatchObject({ _tag: "red", to: ps.every((p) => exam.has(p)) ? "tests" : "build" });
      }),
      options,
    );
  });

  it("property: a red result carries every error line up to LINES, and says how many it left out", () => {
    fc.assert(
      fc.property(paths, (ps) => {
        const v = verdict(failed(), found(ps), new Set());
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
    expect(verdict(failed(), found(at(LINES)), new Set())).toMatchObject({
      lines: found(at(LINES)).map((e) => e.text),
    });
    const over = verdict(failed(), found(at(LINES + 1)), new Set());
    expect(over).toMatchObject({ lines: [...found(at(LINES - 1)).map((e) => e.text), "... and 2 more lines"] });
  });

  it("property: no line is longer than WIDTH, and a cut line keeps its start", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 600 }), (m) => {
        const v = verdict(failed(), [{ path: "a.ts", text: error("a.ts", m) }], new Set());
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
      fc.property(message, (last) => {
        const v = verdict(failed(`ERR_PNPM_X\n${last}\n`), [], new Set());
        expect(v).toEqual({ _tag: "skipped", reason: `CI's typecheck job failed with no error line: ${last}` });
      }),
      options,
    );
  });
});

describe("a job's log as the command printed it, today's tooling", () => {
  const stamp = fc
    .date({ min: new Date("2020-01-01"), max: new Date("2030-01-01"), noInvalidDate: true })
    .map((d) => d.toISOString().replace("Z", "1234Z"));

  it("property: the runner's time and its ##[error] mark go, and the line stays whole", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(stamp, fc.boolean(), message), { maxLength: 20 }), (rows) => {
        const log = rows.map(([at, flagged, text]) => `${at} ${flagged ? "##[error]" : ""}${text}`).join("\n");
        expect(logText(log)).toBe(rows.map(([, , text]) => text).join("\n"));
      }),
      options,
    );
  });

  it("pinned: a red typecheck job's lines, as GitHub served them on 2026-11-11, give its error", () => {
    const log = [
      "﻿2026-11-11T18:10:57.0312476Z apps/fabrika typecheck$ tsc --noEmit -p .",
      "2026-11-11T18:11:03.7908273Z ##[error]apps/fabrika typecheck: test-window.ts(108,13): error TS2379: Argument of type 'X' is not assignable.",
      "2026-11-11T18:11:03.7922773Z apps/fabrika typecheck:   Types of property 'cwd' are incompatible.\r",
      "2026-11-11T18:11:03.9758354Z apps/fabrika typecheck: Failed",
      `2026-11-11T18:11:03.9768977Z   \u001B[31m×\u001B[39m "pnpm recursive run" failed in ${root}/`,
    ].join("\n");
    expect(errorsIn(logText(log))).toEqual([
      {
        path: "apps/fabrika/test-window.ts",
        text: "apps/fabrika/test-window.ts(108,13): error TS2379: Argument of type 'X' is not assignable.\n  Types of property 'cwd' are incompatible.",
      },
    ]);
  });

  it("property: a checkout is any absolute path ending work/<name>/<name>/; another path stays", () => {
    const seg = part.filter((p) => p !== "work");
    fc.assert(
      fc.property(fc.array(seg, { maxLength: 3 }), seg, file, (above, name, f) => {
        const at = `/${[...above, "work", name, name].join("/")}`;
        expect(errorsIn(error(`${at}/${f}`, `see ${at}/x.ts`))).toEqual([{ path: f, text: error(f, "see x.ts") }]);
        const other = `/${[...above, "work", name, `${name}z`].join("/")}/${f}`;
        expect(errorsIn(error(other, "bad")).map((e) => e.path)).toEqual([other]);
      }),
      options,
    );
  });
});

describe("the wait for CI's typecheck job, today's tooling", () => {
  const head = "c".repeat(40);
  const main = new URL("../../../../..", import.meta.url).pathname.replace(/\/$/, "");
  const job = (status: string, conclusion: string | null) => Option.some({ id: 9, status, conclusion });
  // The verdict after these polls and this log, checked by `law` once the wait ends.
  const waited = (
    polls: ReadonlyArray<ChecksTest.Poll>,
    law: (v: Verdict) => void,
    { log = "", minutes = 1, at = head } = {},
  ) =>
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
    Effect.runPromise(
      wait({ main, head: at, minutes, every: 0 }).pipe(
        Effect.map(law),
        Effect.provide(ChecksTest.layer(polls, log)),
        Effect.provide(NodeServices.layer),
      ),
    );

  it("scenario: no job yet, then queued, then running, then success: green the moment it ends", () =>
    waited([Option.none(), job("queued", null), job("in_progress", null), job("completed", "success")], (v) =>
      expect(v).toEqual({ _tag: "green" }),
    ));

  it("scenario: GitHub failing on a poll is tried again within the limit", () =>
    waited([new ChecksError({ reason: "gh api exited 1" }), job("completed", "success")], (v) =>
      expect(v).toEqual({ _tag: "green" }),
    ));

  it("scenario: a failed job with a type error in today's code sends the work to build with its lines", () =>
    waited(
      [job("completed", "failure")],
      (v) => expect(v).toEqual({ _tag: "red", to: "build", lines: ["packages/p/src/a.ts(1,2): error TS2322: bad"] }),
      { log: "2026-11-11T18:11:03.7908273Z ##[error]packages/p typecheck: src/a.ts(1,2): error TS2322: bad" },
    ));

  it("scenario: a failed job whose every error is in an exam path sends the work to tests", () =>
    waited([job("completed", "failure")], (v) => expect(v).toMatchObject({ _tag: "red", to: "tests" }), {
      log: "2026-11-11T18:11:03.7908273Z ##[error]next/apps/fabrika typecheck: src/exam/a.ts(1,2): error TS1: bad",
    }));

  it("scenario: a job that never ends within the limit is no answer, with the last state seen", () =>
    waited(
      [job("in_progress", null)],
      (v) =>
        expect(v).toEqual({
          _tag: "skipped",
          reason: `CI's typecheck job at ${head.slice(0, 8)} did not end within 0.002 minutes (the typecheck job was in_progress)`,
        }),
      { minutes: 0.002 },
    ));

  it("scenario: a lane with no head reads nothing", () =>
    waited(
      [job("completed", "success")],
      (v) => expect(v).toEqual({ _tag: "skipped", reason: "the lane has no head to read CI at (none)" }),
      { at: "" },
    ));
});

describe("CI's typecheck in the lane's log, today's tooling", () => {
  it("format: green, red with its step and first line, or why it gave no answer", () => {
    expect(summary({ _tag: "green" })).toBe("green");
    expect(summary({ _tag: "red", to: "tests", lines: ["a.ts(1,1): error TS1: x", "b"] })).toBe(
      "red, to tests: a.ts(1,1): error TS1: x",
    );
    expect(summary({ _tag: "skipped", reason: "no job" })).toBe("no answer: no job");
  });
});
