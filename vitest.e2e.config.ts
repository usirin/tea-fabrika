// Today's test tooling, for next/'s end-to-end files: `node next/apps/fabrika/e2e.ts` runs Vitest with
// it. One file at a time, since each starts a brain, Chromium or Electron. `--shard k/n` keeps one CI
// leg's share by measured seconds (vitest.shards.ts), as the next job's vitest legs do.
import { configDefaults, defineConfig } from "vitest/config";
import { Shards } from "./vitest.shards.ts";

/** Vitest's own 5 s times 24, the limit the runner gave each file before. */
const LIMIT = 120_000;

export const e2eConfig = {
  test: {
    root: import.meta.dirname, // the repo root, so a file's path is its row's key
    include: ["next/apps/fabrika/e2e/*.test.ts", "next/packages/tuval/src/browser/key.laws.test.ts"],
    exclude: [...configDefaults.exclude],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: LIMIT,
    hookTimeout: LIMIT,
    sequence: { sequencer: Shards },
  },
};

export default defineConfig(e2eConfig);
