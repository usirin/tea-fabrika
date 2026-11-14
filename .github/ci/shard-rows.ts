// Today's CI, about next/'s test files.
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testConfig } from "../../vitest.config.ts";
import { measured } from "../../vitest.shards.ts";

/** Missing own keys, in path order. Zero seconds still counts as a row. */
export const unmeasured = (table: Readonly<Record<string, number>>, files: readonly string[]): string[] =>
  files.filter((path) => !Object.hasOwn(table, path)).toSorted();

/** Use the same next/ includes and excludes as Vitest. */
export const nextFiles = (root: string): string[] =>
  globSync(
    testConfig.test.include.filter((glob) => glob.startsWith("next/")),
    {
      cwd: root,
      exclude: testConfig.test.exclude,
    },
  ).toSorted();

/** Write the lint diagnostic for each missing file and return its exit code. */
export const main = (missing: readonly string[], write: (line: string) => void): number => {
  for (const path of missing) {
    write(`no shard row: ${path}`);
  }

  return missing.length === 0 ? 0 : 1;
};

// L1, run by `pnpm lint`. Plant, run once on a filled copy of the table and restored: delete the
// chaos.laws row. The check printed `no shard row: next/apps/fabrika/src/chaos.laws.test.ts` and
// exited 1; restored, it printed nothing and exited 0.
// Under Vitest `import.meta.main` is false, so a test that imports this file never runs the check.
if (import.meta.main) {
  process.exitCode = main(unmeasured(measured, nextFiles(fileURLToPath(new URL("../../", import.meta.url)))), (line) =>
    console.error(line),
  );
}
