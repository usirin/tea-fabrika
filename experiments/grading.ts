// Grading agent-written tests: run a test file against one version of a toy's
// code, and cut the file into its tests.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { checkoutToy, localWorkspace } from "../src/local.ts";
import { Workspace } from "../src/services.ts";
import type { Toy } from "./toys.ts";

/** The file an agent writes its tests into. */
export const TEST_FILE = "criteria.test.js";

/** The names of the tests in `file` that pass against `source`, or the starting code when `null`. */
export async function passing(toy: Toy, file: string, source: string | null): Promise<ReadonlySet<string>> {
  const { dir } = await checkoutToy(toy.fixture);
  if (source !== null) await writeFile(join(dir, toy.file), source);
  await writeFile(join(dir, TEST_FILE), file);
  const checked = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Workspace).check();
    }).pipe(Effect.provide(localWorkspace(dir, { test: ["node", "--test"] }))),
  );
  return new Set(checked.passingTests);
}

/** Each top-level test() call in a file: its name and its source. */
export const testsIn = (file: string) =>
  file
    .split(/^(?=test\()/m)
    .flatMap((block) => {
      const literal = /^test\(\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(block)?.[2];
      return literal === undefined
        ? []
        : [{ name: literal.replace(/\\(.)/g, "$1"), source: block.trim() }];
    });
