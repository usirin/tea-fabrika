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
      exclude: [...testConfig.test.exclude, "**/dist/**"],
    },
  ).toSorted();

/** Write the lint diagnostic for each missing file and return its exit code. */
export const main = (missing: readonly string[], write: (line: string) => void): number => {
  for (const path of missing) {
    write(`no shard row: ${path}`);
  }

  return missing.length === 0 ? 0 : 1;
};

if (import.meta.main) {
  process.exitCode = main(unmeasured(measured, nextFiles(fileURLToPath(new URL("../../", import.meta.url)))), (line) =>
    console.error(line),
  );
}
