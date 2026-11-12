/**
 * The hourly mutation run's file pick (0066, 0089): which changed files it mutates and which tests
 * it runs. One source: the sample script beside this one imports `PRODUCT` and `inScope` for its
 * diff, and the `range` step of `.github/workflows/mutation.yaml` pipes `git diff --name-only`
 * through this script for the test list.
 *
 *   git diff --name-only --diff-filter=d BASE HEAD | node .agents/skills/mutation/scripts/scope.ts
 *
 * Of the lead tooling under `.agents/`, only the code that runs lanes is in (0089): the lead's
 * chain and drive scripts and the flow runner under `flow/`, each with the tests beside it.
 * Everything outside `.agents/` is in as before. Script names here are built from their stems, so
 * the script-reads lint does not take this file for a reader of those scripts.
 *
 * Hand-written, since no tool here fits (0040). A git pathspec cannot do it: an exclude always
 * wins over an include, so "not `.agents/`, but the chain script" needs two diffs, and the
 * workflow's shell could not share them. The rule is four exact paths and one folder, so plain
 * string tests are enough; picomatch is only a transitive dependency here. Its edge cases, each in
 * the test:
 *
 * - `.agents/` only at the top: an `.agents/` folder inside `apps/` is product code.
 * - `flow/` is a folder: a `flow` file or a `flowers/` folder beside it is out.
 * - The chain and drive scripts only in the lead skill: the same names in another skill are out.
 * - Only the exact names: a `chain.cleanup` test or a `chain` `.tsx` file is out.
 * - A test of an in-scope file is in, and a test of an out-of-scope file is out.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Stdio, Stream } from "effect";

const LEAD = ".agents/skills/lead/scripts/";

/** The lane code's own files and tests (0089's table); the flow runner is a folder. */
const LANE = ["chain", "drive"].flatMap((stem) => [".ts", ".test.ts"].map((end) => `${LEAD}${stem}${end}`));
const FLOW = `${LEAD}flow/`;

/**
 * Every extension Stryker 10.1.1's Instrumenter parses as JavaScript or TypeScript (its
 * parsers/create-parser.js). A changed `.cjs` or `.mjs` file is sampled like a `.ts` one (ticket 655).
 */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const DECLARATIONS = [".d.ts", ".d.mts", ".d.cts"] as const;
const TESTS = [".test.ts", ".test.tsx"] as const;

/** The same product rule as a git pathspec, for the sample script's diff: less tests and type-only files. */
export const PRODUCT = [
  ...EXTENSIONS.map((extension) => `*${extension}`),
  ":!*.test.*",
  ...DECLARATIONS.map((extension) => `:!*${extension}`),
] as const;

/** A file that holds mutants: the pathspec above, read as git reads it (its `*` crosses `/`). */
const product = (path: string) =>
  EXTENSIONS.some((extension) => path.endsWith(extension)) &&
  !path.includes(".test.") &&
  !DECLARATIONS.some((extension) => path.endsWith(extension));

const test = (path: string) => TESTS.some((extension) => path.endsWith(extension));

/** Whether the run may mutate this path, or run it as a test: all but lead tooling, lane code kept. */
export const inScope = (path: string) => !path.startsWith(".agents/") || LANE.includes(path) || path.startsWith(FLOW);

/** The changed paths in scope, in their order. */
export const pick = (paths: ReadonlyArray<string>) => paths.filter(inScope);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The tests a run of these changed paths may use, sorted and unique: for each changed product file
 * in scope, its `name.test.ts` and `name.test.tsx`, and each changed test in scope. Whether each
 * exists at head is the workflow's check.
 */
export const related = (changed: ReadonlyArray<string>) => {
  const tests = pick(changed).flatMap((path) => {
    if (product(path)) {
      const stem = path.slice(0, path.lastIndexOf("."));
      return TESTS.map((extension) => `${stem}${extension}`);
    }

    return test(path) ? [path] : [];
  });

  return [...new Set(tests)].sort(compare);
};

if (import.meta.main) {
  NodeRuntime.runMain(
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio;
      const text = yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
      const tests = related(text.split("\n").filter((line) => line !== ""));

      if (tests.length > 0) {
        yield* Console.log(tests.join("\n"));
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}
