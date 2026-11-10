import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { Duration, Effect, FileSystem, Path } from "effect";
import { describe, expect, it } from "vitest";
import { CheckRunner, checkRunner } from "./checks.ts";

// Code runs `[build] checks` itself after every build, at the head, in a copy of it, the way the
// mutation step runs the repo's tests (docs/plan/pipeline-self-fix.md, PR 4). Each test here runs
// small real commands in a temporary folder. No network, no key.
//
//   every command exits 0                          green
//   one exits non-zero, `{out}` names the tests    red, with each failing test's name
//   one exits non-zero, no `{out}`                 red, no name, its last 40 lines
//   one cannot start, twice                        not_run: never green

const HEAD = "7".repeat(40);

type Command = readonly [string, ...string[]];

/**
 * Run the checks at HEAD `runs` times, in one fresh folder, as a lane runs them again at a head it
 * already checked. The last answer, every answer, the folder, and what the folder holds after.
 */
const checksIn = (
  commands: readonly Command[],
  { runs = 1, within = Duration.seconds(60) }: { runs?: number; within?: Duration.Duration } = {},
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "checks-" });
        const asked: string[] = [];
        const layer = checkRunner({
          folder: (head) => {
            asked.push(head);
            return dir;
          },
          commands,
          within,
        });
        const all = yield* Effect.gen(function* () {
          const runner = yield* CheckRunner;
          // One after another, as a lane runs them: each in the same copy.
          return yield* Effect.forEach(Array.from({ length: runs }), () => runner.run(HEAD), {
            concurrency: 1,
          });
        }).pipe(Effect.provide(layer));
        const tries = yield* fs.readFileString(path.join(dir, "tries")).pipe(Effect.orElseSucceed(() => ""));
        const left = (yield* fs.readDirectory(dir)).filter((name) => name !== "tries");
        const checked = all.at(-1);

        if (checked === undefined) {
          return yield* Effect.die("checksIn ran the checks no times");
        }

        return {
          checked,
          all,
          asked,
          tries: tries.split("\n").filter((l) => l !== "").length,
          dir,
          left,
        };
      }),
    ).pipe(Effect.provide(nodeServices)),
  );

/** A command that runs `script` in node, with the rest as its arguments. */
const node = (script: string, ...rest: string[]): Command => ["node", "-e", script, ...rest];

const PASSES = node("process.exit(0)");

/** vitest's JSON report, written at `{out}`: one test passes, one fails, in src/clamp.test.ts. */
const REPORTS_RED = node(
  [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "fs.writeFileSync(process.argv[1], JSON.stringify({testResults: [{",
    "  name: path.join(process.cwd(), 'src', 'clamp.test.ts'), status: 'failed',",
    "  assertionResults: [",
    "    {ancestorTitles: ['clamp'], title: 'keeps a low number', status: 'passed'},",
    "    {ancestorTitles: ['clamp'], title: 'keeps a high number', status: 'failed',",
    "     failureMessages: ['AssertionError: expected 11 to be 10']},",
    "  ],",
    "}]}));",
    "process.exit(1);",
  ].join("\n"),
  "{out}",
);

/** Sixty lines out, then a red exit, with no report. */
const SAYS_SIXTY = node("for (let i = 1; i <= 60; i++) console.log('line ' + i); process.exit(1);");

/** A command that never starts, and counts each try in `tries`. */
const NEVER_STARTS: Command = ["sh", "-c", "echo x >> tries; exit 127"];

describe("code's checks at a head", () => {
  it("answers green, at the head it was asked about, run in that head's copy, when every command passes", async () => {
    const { checked, asked } = await checksIn([PASSES, PASSES]);
    const passed = { command: "node -e process.exit(0)", code: 0, ms: expect.any(Number) };
    expect(checked).toMatchObject({
      head: HEAD,
      commands: [passed, passed],
      result: "green",
      failed: [],
    });
    expect(asked).toContain(HEAD);
  });

  it("answers red with each failing test's name when a command with `{out}` writes vitest's report", async () => {
    const { checked, dir } = await checksIn([REPORTS_RED]);
    expect(checked.result).toBe("red");
    expect(checked.failed).toEqual(["src/clamp.test.ts > clamp > keeps a high number"]);
    // The command as the settings say it: no path from the machine that ran it.
    expect(checked.commands[0]?.command).toContain("{out}");
    expect(JSON.stringify(checked.commands)).not.toContain(dir);
  });

  it("answers red with no name and the last 40 lines when a command without `{out}` fails", async () => {
    const { checked } = await checksIn([SAYS_SIXTY]);
    expect(checked.result).toBe("red");
    expect(checked.failed).toEqual([]);
    expect(checked.tail.trimEnd().split("\n")).toEqual(Array.from({ length: 40 }, (_, i) => `line ${i + 21}`));
  });

  it("answers red, never green, when a command with `{out}` fails and writes no report", async () => {
    const { checked } = await checksIn([node("console.log('boom'); process.exit(1)", "{out}")]);
    expect(checked.result).toBe("red");
    expect(checked.failed).toEqual([]);
    expect(checked.tail).toContain("boom");
  });

  it("keeps the copy's folder out of the last lines, since they go on a public ticket", async () => {
    const { checked, dir } = await checksIn([node("console.log(process.cwd()); process.exit(1)")]);
    expect(checked.result).toBe("red");
    expect(checked.tail).not.toContain(dir);
  });

  it("tries a command that cannot start once more, then answers not_run", async () => {
    const { checked, tries } = await checksIn([NEVER_STARTS]);
    expect(checked.result).toBe("not_run");
    expect(checked.failed).toEqual([]);
    expect(tries).toBe(2);
  });

  it("answers not_run when the program is not there at all", async () => {
    const { checked } = await checksIn([["no-such-program-for-checks"]]);
    expect(checked.result).toBe("not_run");
  });

  it("answers green when a command that could not start runs on its second try", async () => {
    const { checked, tries } = await checksIn([
      ["sh", "-c", "if [ -s tries ]; then exit 0; fi; echo x >> tries; exit 127"],
    ]);
    expect(checked.result).toBe("green");
    expect(tries).toBe(1);
  });

  it("is never green when one command passes and another cannot run", async () => {
    const { checked } = await checksIn([PASSES, NEVER_STARTS]);
    expect(checked.result).toBe("not_run");
  });

  it("is red when one command passes and another fails", async () => {
    const { checked } = await checksIn([PASSES, REPORTS_RED]);
    expect(checked.result).toBe("red");
    expect(checked.failed).toEqual(["src/clamp.test.ts > clamp > keeps a high number"]);
  });

  it("is not_run, never red, when one command fails and another cannot run: nothing says the rest holds", async () => {
    const { checked } = await checksIn([REPORTS_RED, NEVER_STARTS]);
    expect(checked.result).toBe("not_run");
  });

  it("answers not_run, and says why, when `[build] checks` names no command: no check is never green", async () => {
    const { checked, asked } = await checksIn([]);
    expect(checked).toMatchObject({ head: HEAD, commands: [], result: "not_run", failed: [] });
    expect(checked.tail).toMatch(/\[build\] checks names no command/);
    expect(asked).toEqual([]);
  });

  it("says the home folder as `~` in the last lines, since they go on a public ticket", async () => {
    const mine = join(homedir(), "code", "acme");
    const { checked } = await checksIn([node("console.log(process.argv[1]); process.exit(1)", mine)]);
    expect(checked.result).toBe("red");
    expect(checked.tail).toContain("~/code/acme");
    expect(checked.tail).not.toContain(homedir());
  });

  // The PR 4 review: what a check run leaves behind, how long it may take, what it keeps, and what
  // a key in a command's output becomes.

  it("leaves the copy as it found it, so a second run at the same head is green again", async () => {
    /** A format check's stand-in: red when the copy holds any file it did not hold before. */
    const NOTHING_NEW = node(
      "const extra = require('node:fs').readdirSync('.').filter((f) => f !== 'tries'); if (extra.length > 0) { console.log(extra.join(' ')); process.exit(1); }",
    );
    /** vitest's stand-in: writes its report at `{out}`, all green. */
    const REPORTS_GREEN = node(
      "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({testResults: []}));",
      "{out}",
    );
    const { all, left } = await checksIn([NOTHING_NEW, REPORTS_GREEN], { runs: 2 });
    expect(all.map((run) => run.result)).toEqual(["green", "green"]);
    expect(left).toEqual([]);
  });

  it(
    "ends a command that runs past `within`, and all it started, as not_run that says it timed out, tried once",
    { timeout: 40_000 },
    async () => {
      const outside = mkdtempSync(join(tmpdir(), "checks-late-"));
      const late = join(outside, "late");

      try {
        const started = Date.now();
        // The shell waits on a child of its own: a stop that ends only the shell leaves it running.
        const { checked, tries } = await checksIn(
          [["sh", "-c", `echo x >> tries; (sleep 3; echo late > '${late}') & wait`]],
          { within: Duration.seconds(1) },
        );
        expect(Date.now() - started).toBeLessThan(2_900);
        expect(checked.result).toBe("not_run");
        expect(checked.failed).toEqual([]);
        expect(checked.tail).toMatch(/timed out/);
        expect(checked.commands).toEqual([
          { command: expect.stringContaining("sleep 3"), code: null, ms: expect.any(Number) },
        ]);
        expect(checked.commands[0]?.ms).toBeGreaterThanOrEqual(1_000);
        // Not tried again: a command that hangs once is no command that could not start.
        expect(tries).toBe(1);
        await new Promise((done) => setTimeout(done, 4_000));
        expect(existsSync(late)).toBe(false);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("keeps each command's exit code and how long it took, code null for one that could not start", async () => {
    const { checked } = await checksIn([["sh", "-c", "sleep 0.3"], SAYS_SIXTY, ["no-such-program-for-checks"]]);
    expect(checked.result).toBe("not_run");
    expect(checked.commands).toEqual([
      { command: "sh -c sleep 0.3", code: 0, ms: expect.any(Number) },
      { command: SAYS_SIXTY.join(" "), code: 1, ms: expect.any(Number) },
      { command: "no-such-program-for-checks", code: null, ms: expect.any(Number) },
    ]);
    expect(checked.commands[0]?.ms).toBeGreaterThanOrEqual(300);

    for (const { ms } of checked.commands) {
      expect(Number.isInteger(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("cuts a key in a command's output out of the last lines, since they go on a public ticket", async () => {
    const key = `ghp_${"Ab3".repeat(12)}`;
    const { checked } = await checksIn([node("console.log(process.argv[1]); process.exit(1)", key)]);
    expect(checked.result).toBe("red");
    expect(checked.tail).not.toContain(key);
    expect(checked.tail).toContain("[key cut]");
  });
});
