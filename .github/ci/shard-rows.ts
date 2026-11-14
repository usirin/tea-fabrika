// Today's CI, about next/'s test files.
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createVitest } from "vitest/node";
import { testConfig } from "../../vitest.config.ts";
import { e2eConfig } from "../../vitest.e2e.config.ts";
import { measured } from "../../vitest.shards.ts";

/**
 * next/ rows whose file is not among `files`, in path order. A file with no row is not listed:
 * `assign` places it by its fallback until CI's `shard-times` step gives it a row.
 */
export const stale = (table: Readonly<Record<string, number>>, files: readonly string[]): string[] => {
  const selected = new Set(files);
  return Object.keys(table)
    .filter((path) => path.startsWith("next/") && !selected.has(path))
    .toSorted();
};

/**
 * Test files under `root` as Vitest itself selects them from `include` and `exclude`, in path order.
 * A glob of our own drifted from Vitest's twice (`dist`, then dot folders), so Vitest does the
 * selecting.
 */
const selected = async (root: string, include: string[], exclude: string[]): Promise<string[]> => {
  const vitest = await createVitest("test", { root, config: false, watch: false, include, exclude });

  try {
    return (await vitest.globTestSpecifications())
      .map((spec) => relative(vitest.config.root, spec.moduleId))
      .toSorted();
  } finally {
    await vitest.close();
  }
};

/** next/'s vitest files: the repo config's next/ includes and every exclude, read on each call. */
export const nextFiles = (root: string) =>
  selected(
    root,
    testConfig.test.include.filter((glob) => glob.startsWith("next/")),
    [...testConfig.test.exclude],
  );

/** next/'s end-to-end files: the end-to-end config's includes and excludes, read on each call. */
export const e2eFiles = (root: string) => selected(root, e2eConfig.test.include, e2eConfig.test.exclude);

/** Write the lint diagnostic for each stale row and return its exit code. */
export const main = (rows: readonly string[], write: (line: string) => void): number => {
  for (const path of rows) {
    write(`stale shard row: ${path} is not a next/ test file Vitest selects; delete its row in vitest.shards.ts`);
  }

  return rows.length === 0 ? 0 : 1;
};

// L1, run by `pnpm lint`. Plant, run once on the table and restored: add a row for
// next/apps/fabrika/src/gone.test.ts. The check printed its stale shard row line and exited 1;
// restored, it printed nothing and exited 0. On the same tree the old check, which refused a file
// with no row, printed `no shard row: next/apps/fabrika/src/exam/effect-checks.test.ts` and exited 1.
// Under Vitest `import.meta.main` is false, so a test that imports this file never runs the check.
// E9 (T967): the vitest and end-to-end selections are judged together, since one table holds both
// rows. Plants, each run once with the 8 end-to-end rows in the table, and restored: leave e2eFiles
// out of the entry (8 stale lines, exit 1); add a row for next/apps/fabrika/e2e/gone.test.ts (its one
// stale line, exit 1). Restored, it printed nothing and exited 0.
if (import.meta.main) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = [...(await nextFiles(root)), ...(await e2eFiles(root))];
  process.exitCode = main(stale(measured, files), (line) => console.error(line));
}
