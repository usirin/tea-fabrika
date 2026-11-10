import { fileURLToPath } from "node:url";
import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path } from "effect";
import { describe, expect, it } from "vitest";
import { MutationRunner } from "./services.ts";
import { sampleOf, strykerRunner } from "./stryker.ts";

// One small real run of StrykerJS, on the toy repository in
// fixtures/mutation: a copy of it in a temporary folder, with this package's
// node_modules linked in. Its test is weak on purpose. No network, no key.

const FIXTURE = fileURLToPath(new URL("../../../../../fixtures/mutation", import.meta.url));
const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));

/** The fixture's lines that hold code: `clamp` and `unit`. */
const SPANS = [{ file: "clamp.ts", from: 9, to: 19 }];

/** The repo's own tests, with vitest's JSON report written where the runner says (`{out}`). */
const REPORTED = ["node_modules/.bin/vitest", "run", "--reporter=json", "--outputFile={out}"] as const;

/** A test file planted beside the fixture's own: one test passes, one fails. */
const PLANTED = {
  name: "red.test.ts",
  text: [
    'import {describe, expect, it} from "vitest";',
    'import {clamp} from "./clamp.ts";',
    "",
    'describe("a planted red", () => {',
    '\tit("passes beside it", () => {',
    "\t\texpect(clamp(5, 0, 10)).toBe(5);",
    "\t});",
    "",
    '\tit("keeps a number above the high", () => {',
    "\t\texpect(clamp(12, 0, 10)).toBe(11);",
    "\t});",
    "});",
    "",
  ].join("\n"),
};

/** Run `use` with a fresh copy of the fixture and the runner over it. */
const inCopy = <A, E>(
  use: (runner: MutationRunner["Service"]) => Effect.Effect<A, E>,
  {
    tests = ["node_modules/.bin/vitest", "run"],
    planted = [],
  }: {
    readonly tests?: readonly [string, ...string[]];
    /** More files in the copy, beside the fixture's. */
    readonly planted?: readonly { readonly name: string; readonly text: string }[];
  } = {},
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mutation-fixture-" });

        for (const name of yield* fs.readDirectory(FIXTURE)) {
          yield* fs.copyFile(path.join(FIXTURE, name), path.join(dir, name));
        }

        for (const { name, text } of planted) {
          yield* fs.writeFileString(path.join(dir, name), text);
        }

        yield* fs.symlink(MODULES, path.join(dir, "node_modules"));
        const layer = strykerRunner({
          folder: () => dir,
          tests,
          typecheck: ["node_modules/.bin/tsc", "--noEmit", "-p", "."],
        });
        return yield* Effect.gen(function* () {
          return yield* use(yield* MutationRunner);
        }).pipe(Effect.provide(layer));
      }),
    ).pipe(Effect.provide(nodeServices)),
  );

describe("StrykerJS behind MutationRunner, on the fixture", () => {
  it("runs the repo's own tests, then lets the weak test's mutants survive and leaves out what it must", async () => {
    const [tests, ran] = await inCopy((runner) =>
      // One after the other: Stryker's run must not overlap the plain test run in the same copy.
      Effect.all([runner.tests("h"), runner.run({ head: "h", spans: SPANS, seed: 5, most: 150 })], {
        concurrency: 1,
      }),
    );
    expect(tests.result).toBe("green");
    expect(tests.failed).toEqual([]);
    // The error text: the ignorer.
    expect(ran.ignored).toBe(1);
    // No test runs `unit`, and the typecheck rejects both its mutants: `return ""` is not a
    // `Unit`, and a body made `{}` returns nothing.
    expect(ran.compileErrors).toBe(2);
    expect(ran.survived.some((m) => m.mutant.startsWith("clamp.ts:17:"))).toBe(false);
    expect(ran.ran).toBe(ran.found);
    // The place, without the id's tag of mutator and replacement.
    const survived = ran.survived.map(
      (m) => `${m.mutant.replace(/:[0-9a-f]{6}$/, "")} ${m.original} -> ${m.replacement}`,
    );
    // Nothing checks a number above `high`, or a low equal to the high.
    expect(survived).toContain("clamp.ts:12:6 n > high -> false");
    expect(survived).toContain("clamp.ts:12:6 n > high -> n >= high");
    expect(survived).toContain("clamp.ts:10:6 low > high -> low >= high");
    // Two mutants at one place keep apart.
    expect(new Set(ran.survived.map((m) => m.mutant)).size).toBe(ran.survived.length);
    expect(ran.killed + ran.compileErrors + ran.survived.length).toBe(ran.ran);
  }, 120_000);

  it("names each failing test of a red run, by its file, its describe and its own name, and no test that passed", async () => {
    const tested = await inCopy((runner) => runner.tests("h"), {
      tests: REPORTED,
      planted: [PLANTED],
    });
    expect(tested.result).toBe("red");
    expect(tested.failed).toEqual(["red.test.ts > a planted red > keeps a number above the high"]);
    // The tail: each name with the first line of its error, not the run's raw output.
    expect(tested.tail).toMatch(
      /^red\.test\.ts > a planted red > keeps a number above the high: .*expected 10 to be 11/,
    );
  }, 120_000);

  it("answers green, with no name, when every test passes and the report is written", async () => {
    const tested = await inCopy((runner) => runner.tests("h"), { tests: REPORTED });
    expect(tested).toMatchObject({ result: "green", failed: [] });
  }, 120_000);

  it("runs only the fixed-seed sample when there are more mutants than `most`", async () => {
    const ran = await inCopy((runner) => runner.run({ head: "h", spans: SPANS, seed: 5, most: 4 }));
    expect(ran.ran).toBe(4);
    expect(ran.found).toBeGreaterThan(4);
    expect(ran.killed + ran.compileErrors + ran.survived.length).toBe(4);
  }, 120_000);
});

describe("the sample", () => {
  const items = Array.from({ length: 40 }, (_, i) => i);

  it("is the same on every run, keeps the first order, and takes all when they fit", () => {
    const a = sampleOf(items, 139, 10);
    expect(a).toEqual(sampleOf(items, 139, 10));
    expect(a).toHaveLength(10);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    expect(new Set(a).size).toBe(10);
    expect(sampleOf(items, 139, 40)).toEqual(items);
    expect(sampleOf(items, 1, 10)).not.toEqual(a);
  });
});
