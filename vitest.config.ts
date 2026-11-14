import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { configDefaults, defineConfig, type Plugin } from "vitest/config";
import { parseCLI } from "vitest/node";
import { isScript, isTest, load, reached } from "./oxlint-plugins/script-reads.mjs";
import packageJson from "./package.json" with { type: "json" };
import { Shards } from "./vitest.shards.ts";

// Shared by local Vitest and Stryker's config. Importing this object never runs the local CLI guard.
export const testConfig = {
  test: {
    setupFiles: ["./scripts/vitest.setup.ts"],
    // A changed trigger selects every test in CI. Tests read these files without importing them.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      "**/pnpm-lock.yaml",
      "**/pnpm-workspace.yaml",
      "**/tsconfig*.json",
      "**/.oxlintrc.json",
      "**/.oxfmtrc.json",
      "**/oxlint-plugins/**",
      "**/layer-rules.json",
      "**/fixtures/**",
      "**/.github/**",
      "**/.gitattributes",
    ],
    // One run over every package. `fixtures/` holds toy repos with their own
    // `node --test` files. They are the lane's subject, not this repo's tests.
    include: [
      "apps/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "programs/*/src/**/*.test.ts",
      "oxlint-plugins/*.test.ts",
      "vitest.shards.test.ts",
      ".github/ci/*.test.ts",
      "scripts/*.test.ts",
      // Any depth, so the flow runner's tests under `lead/scripts/flow/` run, as 0089's hourly
      // mutation run reads them (`flow/**/*.test.ts`).
      // A skill's `fixtures/` is excluded below.
      ".agents/skills/*/scripts/**/*.test.ts",
      // Keep next/ for its own job and local runs. Today's CI excludes it on the CLI.
      // Its end-to-end tests sit outside `src/`, in
      // `next/apps/fabrika/e2e/`, and run through `node next/apps/fabrika/e2e.ts`.
      "next/packages/*/src/**/*.test.{ts,tsx}",
      "next/programs/*/src/**/*.test.{ts,tsx}",
      "next/apps/*/src/**/*.test.{ts,tsx}",
    ],
    // A toy repo's tests under a skill's scripts are its subject, as with `fixtures/` above.
    exclude: [
      ...configDefaults.exclude,
      ".agents/skills/*/scripts/**/fixtures/**",
      "next/packages/tuval/src/browser/key.laws.test.ts",
      "next/**/dist/**",
    ],
    // One time limit for every test, chosen from measured times, not vitest's 5 s default,
    // which turned main red 6 times for slow tests and found no bug (experiment 125).
    // Measured on 2026-10-24: the slowest test in 128 CI runs took 17.9 s (60 s is 3.3 times
    // that); with two whole suites side by side on one laptop, the slowest took 28.4 s (60 s
    // is 2.1 times that). A test does not set its own limit to get room on a busy machine; if
    // tests grow slower, measure again and change this number.
    testTimeout: 60_000,
    // The same limit for a `beforeAll` or `afterAll`, for the same reason, not vitest's 10 s
    // default, which failed a git set-up on CI once with no bug (code-host-local). A hook is
    // set-up for its tests, so it gets their limit. Measured on 2026-10-24 with three whole
    // suites side by side: no file's hooks took more than 1.5 s in all.
    hookTimeout: 60_000,
    // `--shard` gives each machine about the same seconds, from measured times, not the same count
    // of files (vitest.shards.ts).
    sequence: { sequencer: Shards },
  },
};

// Use Vitest's installed matcher, including its dot-path behavior.
const match = createRequire(import.meta.resolve("vitest/package.json"))("picomatch");
const workers = Number(process.env.FABRIKA_MAX_WORKERS ?? 3);

if (!Number.isInteger(workers) || workers < 1) {
  throw new Error("FABRIKA_MAX_WORKERS must be a positive integer");
}

const localLimits = () => {
  if (!/^vitest(?:\.[cm]?js)?$/.test(basename(process.argv[1] ?? ""))) {
    return;
  }

  const pinned = packageJson.engines.node;

  if (!process.env.CI && process.versions.node !== pinned) {
    throw new Error(
      `Local test run refused. Running Node ${process.version}; pinned Node v${pinned}. Use: volta run --node ${pinned} pnpm exec vitest run --maxWorkers=1 <narrow path>`,
    );
  }

  const cli = parseCLI(["vitest", ...process.argv.slice(2)], { allowUnknownOptions: true });
  const narrow = (filter: string) => {
    const path = isAbsolute(filter) ? relative(process.cwd(), filter) : filter.replace(/^\.\//, "");
    return !/[*?[\]{}]/.test(path) && /(?:^|\/)[^/]+\.test\.[cm]?[jt]sx?(?::[\d-]+)?$/.test(path);
  };

  if (!process.env.CI && !(cli.filter.length > 0 && cli.filter.every(narrow))) {
    const changed = cli.options.changed;
    // The same three sets as Vitest 5.0.5's GitVCSProvider. A net diff loses staged
    // changes canceled in the worktree; two endpoints lose divergent branch changes.
    const commands = [
      ...(typeof changed === "string" ? [["diff", "--name-only", "-z", `${changed}...HEAD`]] : []),
      ["diff", "--cached", "--name-only", "-z"],
      ["ls-files", "-z", "--other", "--modified", "--exclude-standard"],
    ];
    const diffs = changed === undefined ? [] : commands.map((args) => spawnSync("git", args, { encoding: "utf8" }));
    const forced = diffs.some((diff) =>
      diff.stdout
        .split("\0")
        .some((path) => path && match.isMatch(path, testConfig.test.forceRerunTriggers, { dot: true })),
    );

    if (changed === undefined || diffs.some((diff) => diff.status !== 0) || forced) {
      throw new Error("Local broad test run refused. Use: pnpm exec vitest run --maxWorkers=1 <narrow path>");
    }
  }

  const value = cli.options.maxWorkers ?? workers;
  // Vitest resolves percentages against availableParallelism, rounded and clamped.
  const requested =
    typeof value === "string" && value.trim().endsWith("%")
      ? Math.max(
          1,
          Math.min(availableParallelism(), Math.round((Number.parseInt(value, 10) / 100) * availableParallelism())),
        )
      : Number(value);

  if (!Number.isInteger(requested) || requested < 1 || requested > workers) {
    throw new Error("--maxWorkers exceeds FABRIKA_MAX_WORKERS or is invalid");
  }

  return { test: { maxWorkers: requested } };
};

const root = import.meta.dirname;

// A lead-script test starts its scripts as child processes, which Vitest's import graph cannot see.
// The files each one reaches are derived from the scripts (oxlint-plugins/script-reads.mjs) and
// handed to Vitest as watched files, which its `--changed` and `--related` walk follows as edges.
// Nothing is declared in a test.
const scriptReads: Plugin = {
  name: "fabrika-script-reads",
  transform(_code, id) {
    const path = relative(root, id);

    if (isScript(path) && isTest(path)) {
      const { tree, exists } = load(root);

      for (const file of reached(tree, exists, path).keys()) {
        this.addWatchFile(join(root, file));
      }
    }

    return null;
  },
};

export default defineConfig({
  ...testConfig,
  test: { ...testConfig.test, maxWorkers: workers },
  // Vite runs this hook only while resolving a run. Importers can merge or spread the object.
  plugins: [{ name: "fabrika-local-test-limits", enforce: "post", config: localLimits }, scriptReads],
});
