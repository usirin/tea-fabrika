// Today's CI, about next/'s test files.
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";
import { testConfig } from "../../vitest.config.ts";
import { measured } from "../../vitest.shards.ts";

/** Missing own keys, in path order. Zero seconds still counts as a row. */
export const unmeasured = (table: Readonly<Record<string, number>>, files: readonly string[]): string[] =>
  files.filter((path) => !Object.hasOwn(table, path)).toSorted();

/**
 * next/'s test files as Vitest itself selects them, from the config's next/ includes and every
 * exclude, read on each call. A glob of our own drifted from Vitest's twice (`dist`, then dot
 * folders), so Vitest does the selecting.
 */
export const nextFiles = async (root: string): Promise<string[]> => {
  const vitest = await createVitest("test", {
    root,
    config: false,
    watch: false,
    include: testConfig.test.include.filter((glob) => glob.startsWith("next/")),
    exclude: [...testConfig.test.exclude],
  });

  try {
    return (await vitest.globTestSpecifications())
      .map((spec) => relative(vitest.config.root, spec.moduleId))
      .toSorted();
  } finally {
    await vitest.close();
  }
};

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
  const files = await nextFiles(fileURLToPath(new URL("../../", import.meta.url)));
  process.exitCode = main(unmeasured(measured, files), (line) => console.error(line));
}
