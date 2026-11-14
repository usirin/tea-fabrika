Approved by the lead agent, builds 0175 and 1104's shard rows for ticket 967, with the lead's two answers; body dc0bdaa8340f
Plancheck-Version: 3
# Plan: ticket 967, the next job's end-to-end files split over legs by measured seconds

Today's CI, about `next/`. Every path below is checked against `origin/main` at `5bec9eca5`.

```yaml
# The whole idea: the one e2e leg becomes two, split by measured seconds through 1104's Shards.
matrix:
  shard: ["e2e-1", "e2e-2", "1", "2", "3", "4", "5"] # was ["e2e", "1", "2", "3", "4", "5"]
```

## The answer

Run the end-to-end files through Vitest's own `--shard`, using the `Shards` sequencer and the `measured` table from PR 1104 (ticket 890). That table gets 8 end-to-end rows. The single `e2e` leg becomes `e2e-1` and `e2e-2`. A law sets the leg count: it is the smallest count at which the longest leg is just the heaviest file. That count is 2 today. No time limit changes.

```yaml
# .github/workflows/check.yaml, the next job, after
matrix:
  shard: ["e2e-1", "e2e-2", "1", "2", "3", "4", "5"]
steps:
  - run: node next/apps/fabrika/e2e.ts --shard "${SHARD#e2e-}" --reporter=verbose --reporter=json --reporter=github-actions --outputFile.json="$RUNNER_TEMP/next.json"
    if: startsWith(matrix.shard, 'e2e-')
    env:
      SHARD: ${{ matrix.shard }}/2
```

Predicted jobs from the new rows plus the 70 s measured overhead: `e2e-1` about 7.3 min (it runs only `resources.laws`), and `e2e-2` about 6.5 min. Today the one leg takes 12.0 to 12.8 min. With PR 1012's `reload.test.ts` (about 138 s, no row yet) on the lighter leg, `e2e-2` is about 8.8 min. The ticket's failing case passes with about 2x room.

## What I read, and what runs today

- `next/apps/fabrika/e2e.ts` lists `e2e/*.test.ts` (not recursive) plus tuval's `key.laws.test.ts`. It sorts them and runs each one as its own `pnpm exec vitest run --root <its folder> <file> --maxWorkers=1 --fileParallelism=false` with 120 s limits. It stops at the first failure and writes no JSON report. So no row exists for any end-to-end file today. The `shard times` step on the `e2e` leg prints "report unavailable".
- With `--root <folder>`, Vitest 5.0.5 looks for a config only in that folder (`findConfigFile`, `chunks/index.1TqnEahn.js:8683`). The e2e folder has none. So end-to-end files run today with no config, no setup file and no sequencer.
- **Nothing makes a split unsafe. Every file can go on any leg.**
  - Each file makes its own temp home.
  - Each file takes its own port pair from the held-port helper, which uses a kernel lock that holds across processes.
  - Each file starts its own headless Chromium, and its own brain or workerd through `dev.ts` or `localInstance`.
  - `chaos-revoke` and `one-file` build into a `dist` folder under their own temp home.
  - `resources.laws` runs the `one-file` and `first-window` suites as its own child processes, `--root e2e/` with no config. A config at the repo root does not change those children.
  - `electron-launchd` skips on CI (it needs darwin, `FABRIKA_P19_HOST=1`, and no `CI`).
  - No Docker box or shared machine is involved. The only thing each leg needs is Chromium, which the existing `chromium` step already installs.
- PR 1104's way of splitting:
  - `assign` places measured files heaviest first (ties by path), each on the leg with the least load. Files with no row follow in path order, counted at the table median, which is 0.3 s over 692 rows.
  - `Shards` is Vitest's `BaseSequencer` with only `shard` changed.
  - `.github/ci/shard-rows.ts` fails lint on a row whose file Vitest no longer selects.
  - `.github/ci/shard-times.ts` reads Vitest JSON reports and prints a new row when a row is off by more than 60 s.
  - `.github/ci/workflow-lint.ts` pins the legs, `/5`, and each `if`.
- **next/ cannot import the table.**
  - `boundary-rules.json` sets `acrossDeployables: ["relative-import-crosses-workspace"]`. In code-graph 0.13.0, `crossWorkspaceImports` flags any relative import from a workspace to another one.
  - So `next/apps/fabrika/e2e.ts` importing `../../../vitest.shards.ts` would fail `pnpm lint:boundaries`.
  - `.github/ci` imports root files without trouble only because `isSourceFile` skips paths with a dot segment.
  - That rules out "e2e.ts imports `assign`".
- Installed: vitest 5.0.5, effect 4.1.2, `@effect/platform-node` 4.1.2, fast-check 4.10.2, playwright 1.64.1.
- Vitest refuses `--shard n` when n is more than the file count (`chunks/index.1TqnEahn.js:6078`), unless `passWithNoTests` is set.

## How others do it

- **Vitest:** `--shard <k>/<n>`, with a custom `sequence.sequencer` overriding `shard()` as the documented extension point. I read this in the installed source; I did not fetch the docs. PR 1104 and experiment 222 already use it here.
- **CircleCI:** `circleci tests split --split-by=timings` splits by stored per-file times. GitLab with Knapsack does the same. Playwright `--shard` splits by count, not time. None of these docs were fetched this session.
- **The algorithm:** `assign` is LPT, longest processing time first (Graham, 1969, "Bounds on multiprocessing timing anomalies"; not fetched). No split can make the longest leg shorter than the heaviest file. That bound is where the leg count comes from.
- **Elm and OTP:** not relevant. This is CI tooling with no state that changes. `assign` is a pure function, so 0037 has no control state to name.
- **0040, existing tools first:** Vitest's own `--shard` plus 1104's sequencer, not a splitter written by hand into e2e.ts.

## The shape

### 1. A root Vitest config for the end-to-end files (new: `vitest.e2e.config.ts`)

```ts
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
```

What does not carry over from the per-file runs, on purpose:

- **No setup file.** Today's runs have none either.
- **No `passWithNoTests`.** Then a leg with no file, or more legs than files, fails loudly. This drops item 10's old "passes while there are none". The folder holds 7 files and is never empty again.
- **No bail.** A leg runs all its files, as every vitest leg does. That costs at most the rest of one leg, about 5 min, and a red run shows every failure.
- **File order** is Vitest's own sort, not alphabetical. No file depends on another (above).

Is any of this a setting (0069)? No. No person running fabrika picks a CI leg count or a test limit. It is test config, like `testTimeout` in `vitest.config.ts`.

### 2. The runner passes its arguments through (`next/apps/fabrika/e2e.ts`)

```ts
// The exam's thin end-to-end runner (docs/plan/tier-1-detail.md, the exam's item 10). Each landing adds
// its own file to `e2e/`. This runs them in one Vitest run with the repo's end-to-end config, one file at
// a time. Its arguments go to Vitest as they are: a file name selects, `--shard k/n` keeps one leg.
//
//   node next/apps/fabrika/e2e.ts [vitest arguments]
const run = Effect.gen(function* () {
  const path = yield* Path.Path;
  const config = path.resolve(import.meta.dirname, "../../../vitest.e2e.config.ts");
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make("pnpm", ["exec", "vitest", "run", "--config", config, ...process.argv.slice(2)], {
      cwd: import.meta.dirname, // unchanged; no end-to-end file reads its cwd
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    }),
  );

  if (exitCode !== 0) {
    return yield* new E2eFailed({ exitCode });
  }
});
```

- A path string is not an import, so code-graph has nothing to flag.
- The file stays in `next/apps/fabrika`. It is the app's runner for the app's own e2e folder (`next/AGENTS.md`'s libfabrika test: a client written from scratch would not need it).

### 3. Rows in the same table (`vitest.shards.ts`), with 1104's fallback unchanged

```ts
const E2E = "next/apps/fabrika/e2e";
// in `measured`, beside the other next/ rows:
  [`${E2E}/chaos-revoke.test.ts`]: 46.7,
  [`${E2E}/electron-launchd.test.ts`]: 1.5,
  [`${E2E}/first-window.test.ts`]: 222.2,
  [`${E2E}/instance.test.ts`]: 23.7,
  [`${E2E}/one-file.test.ts`]: 14.6,
  [`${E2E}/resources.laws.test.ts`]: 366.6,
  [`${E2E}/stored.test.ts`]: 1.2,
  "next/packages/tuval/src/browser/key.laws.test.ts": 7.1,
```

- **Where the samples come from:**
  - A: run 43601966383 (push to main at `5bec9eca5`), job 132468657925.
  - B: run 43601964962 (push to main at `ba96004e4`), job 132468687674.
  - C: run 43605298688 (green pull request run), job 132478645693.
  - Attempt 1 each. All three are `next (e2e)` jobs from after PR 1104.
- **How each sample is measured:** Vitest's printed `Duration` for that file's own run, rounded to one decimal. Today's runner writes no JSON report, so there is nothing else to read.
- **Each row** is the median of A, B and C.
- **Later reads differ slightly.** From now on, CI's `shard times` step reads the JSON report (`startTime` to `endTime`), which leaves out Vitest's startup. Expect up to about 2 s less, well inside its 60 s advice limit.

| Test | A | B | C | Row |
|---|---|---|---|---|
| chaos-revoke | 46.5 | 50.0 | 46.7 | 46.7 |
| electron-launchd | 1.5 | 1.1 | 1.5 | 1.5 |
| first-window | 222.2 | 206.3 | 225.4 | 222.2 |
| instance | 23.7 | 22.4 | 23.9 | 23.7 |
| one-file | 14.3 | 14.7 | 14.6 | 14.6 |
| resources.laws | 366.6 | 348.9 | 373.3 | 366.6 |
| stored | 1.2 | 1.1 | 1.3 | 1.2 |
| key.laws | 7.1 | 5.8 | 7.5 | 7.1 |

**Unmeasured files keep 1104's default.** They count at the table median and go on the least-loaded leg, ties by path. One line on why: with 2 or 3 legs, the guess barely matters. A new file goes on the lightest leg whether it counts as 0.3 s or 14.6 s, because the legs are more than 40 s apart. CI's `shard times` step then prints the file's real row. I am 80% sure of this.

Rows from before PR 1104 (runs 43597657318, 43594434801 and 43590628228, where e2e ran after vitest on leg 1) were 15 to 45% faster for `first-window` and `resources.laws`. I use the post-1104 samples because they match the shape this PR runs. Both ranges overlap with the noise between runs.

### 4. The stale-row lint sees the end-to-end files (`.github/ci/shard-rows.ts`)

```ts
/** Test files as Vitest selects them from `include` and `exclude`, read on each call. */
const selected = async (root: string, include: string[], exclude: string[]): Promise<string[]> => { /* nextFiles' body */ };

export const nextFiles = (root: string) =>
  selected(root, testConfig.test.include.filter((glob) => glob.startsWith("next/")), [...testConfig.test.exclude]);
export const e2eFiles = (root: string) => selected(root, e2eConfig.test.include, e2eConfig.test.exclude);

if (import.meta.main) {
  const files = [...(await nextFiles(root)), ...(await e2eFiles(root))];
  process.exitCode = main(stale(measured, files), (line) => console.error(line));
}
```

- Without this change, the 8 new rows would all fail lint as stale. `stale` itself does not change.
- Vitest still does the selecting, as 1104 chose after a glob of its own drifted twice.

### 5. The workflow and its lint

- **`check.yaml`, the next job:**
  - The matrix becomes `["e2e-1", "e2e-2", "1", "2", "3", "4", "5"]`.
  - The vitest step's guard becomes `${{ !startsWith(matrix.shard, 'e2e-') }}`.
  - The chromium step's guard becomes `startsWith(matrix.shard, 'e2e-') && hashFiles('next/apps/fabrika/e2e/*.test.ts') != ''`.
  - The end-to-end step is the one shown at the top.
  - `shard times` moves after the end-to-end step, still under `!cancelled()`, so both kinds of leg feed it their own `next.json`.
  - Edges stays on `'1'`. `timeout-minutes: 17` stays. The comment block says seven machines.
- **`workflow-lint.ts`:**
  - Pins the shape, not the count: e2e legs `e2e-1` to `e2e-N`, in order, before `"1"` to `"5"`, all strings, with N at least 1.
  - The end-to-end step's command, and its `/N` equal to the count of e2e legs.
  - Each guard, and the order of `shard times`.
  - Exports `e2eLegs(text)` beside `vitestLegs`, for the count law.
- **`related.test.ts`:** finds the vitest step by its run command, not as "the first step with `env.SHARD`". The end-to-end step now has a `SHARD` too.

### How the leg count is chosen

**The rule (the lead's pick):** N is the smallest count at which every leg's job, its longest `assign` leg plus the 70 s overhead, fits within half the job's 17 min limit, so at most 440 s of tests on a leg. The limit's own comment sizes it at twice the largest job, so half the limit keeps the same 2x room. Fewest runners wins over fastest split because the free plan's 20 jobs at once, not one leg's length, is what kept the queue waiting (field finding on why CI is capped).

**What it cannot fix:** if the heaviest file alone is over 440 s, no N fits, and E4 goes red naming that file. The file itself must then be split, as its own ticket.

The overhead is the median of job time minus end-to-end step time over A, B and C: 76.5 s, 69.8 s and 70.2 s.

| N | Longest leg (s) | Predicted job (min) |
|---|---|---|
| 1 | 683.6 | 12.6 (12.0 to 12.8 measured) |
| 2 | 366.6, alone; the other leg 317.0 | 7.3 |
| 3 | 366.6 | 7.3 |

So N = 2 today. The worst run seen was job 132468626169 (PR 1208's queue group). It was canceled at 17 min with `resources.laws` still running after 622 s. Alone on its leg, that run would end near 11.5 min.

## One value traced: PR 1012's `reload.test.ts` arrives with no row

1. Leg `e2e-2` runs `node next/apps/fabrika/e2e.ts --shard 2/2 ...`, and e2e.ts starts `pnpm exec vitest run --config <repo>/vitest.e2e.config.ts --shard 2/2 ...`.
2. Vitest selects 9 files. `Shards.shard` looks up their rows; `reload` has none.
3. `assign(files, 2)`:
   - resources (366.6) goes to leg 0.
   - first-window (222.2) goes to leg 1, then chaos, instance, one-file, key.laws, electron and stored also go to leg 1. Leg 1 reaches 317.0.
   - Then the unmeasured `reload`, counted at 0.3, goes to the least-loaded leg: leg 1 again (317.0 against 366.6).
4. Leg `e2e-2` runs 8 files, about 317 + 138 = 455 s plus 70 s, so about 8.8 min. It writes `next.json`.
5. `shard times` reads it. `reload` is off by more than 60 s from the default 1 s, so it prints `::warning::` and the line `"next/apps/fabrika/e2e/reload.test.ts": 138.0,`.
6. Then a row is added, by 1012 itself or by a later refresh. With that row, `assign` puts reload beside first-window: the legs are about 412 s and 410 s, both under 440 s, so N stays 2 and the count law stays green. Only a file that pushes a leg past 440 s makes the law name 3.

## Laws

| Law | What it holds | Kind (lint, type or test) | Generator | Plant |
|---|---|---|---|---|
| E1 | next's matrix is `e2e-1` to `e2e-N` in order, then `"1"` to `"5"`, all strings, one matrix key, N at least 1 | lint | lint | Drop `e2e-2` and keep `/2` (red: the count differs). Write `e2e-2, e2e-1` (red). Name a leg plain `e2e` (red) |
| E2 | The end-to-end step runs once, with the pinned command, guard `startsWith(matrix.shard, 'e2e-')`, and `SHARD` set to `${{ matrix.shard }}/N` with N the e2e leg count | lint | lint | `/3` with two legs (red). Drop its guard (red). Drop `--shard` (red) |
| E3 | The vitest step runs only on numbered legs, chromium only on e2e legs, edges only on `'1'`, and `shard times` after both test steps with `!cancelled()` | lint | lint | Move `shard times` back before the end-to-end step (red). Run chromium on every leg (red). Run vitest on the e2e legs (red) |
| E4 | The workflow's e2e leg count is the smallest N whose longest `assign` leg, over the real selection and table with fallback, plus 70 s fits in half of `timeout-minutes`. If the heaviest file alone does not fit, the law fails and names that file | test | scenario: the real table, the real end-to-end selection and check.yaml | Add `e2e-3` and `/3` (red: not the smallest). On a copy of the table, set chaos-revoke to 300 (red: 3 needed). Set resources.laws to 500 (red: one file over half the limit) |
| E5 | 1104's L5, widened: every next/ row, vitest and end-to-end, is the median of its three samples. `e2eSamples` holds A, B and C with job IDs, and the overhead samples | test | vector: runs 43601966383, 43601964962 and 43605298688, jobs 132468657925, 132468687674 and 132478645693 | Drop the resources.laws row (red). Set first-window to 1.0 (red) |
| E6 | `createVitest` with the real end-to-end config and `--shard k/N`, for each k, keeps exactly `assign`'s files for leg k-1, and covers each end-to-end file once | test | scenario: the real end-to-end config, as 1104's two-new-files scenario does | Drop `sequence.sequencer` from the end-to-end config (red: Vitest's own split by count differs) |
| E7 | The end-to-end config: root is the repo root; include is exactly the two globs; one worker; no file parallelism; 120 s test and hook limits; `Shards`; no setup file; no `passWithNoTests` | test | pinned: vitest.e2e.config.ts's values | Set `testTimeout` to 60_000 (red). Make the include `e2e/**/*.test.ts` (red) |
| E8 | `e2eFiles` on a scratch tree finds `e2e/a.test.ts` and tuval's `key.laws.test.ts`. It does not find `e2e/node/b.test.ts` or `src/c.test.ts` | test | scenario: a scratch tree, as 1104's L3 | Make the e2e glob recursive (red) |
| E9 | `node .github/ci/shard-rows.ts` judges rows against the next/ and end-to-end selections together. On main with the 8 rows it prints nothing and exits 0. A row for `${E2E}/gone.test.ts` prints one stale line and exits 1 | lint | lint | Leave `e2eFiles` out of the entry (red: 8 stale end-to-end rows). The existing L4 scenario test follows the entry's new selection |

- **No type law.** The shapes here are YAML and config values, which E1 to E3 and E7 pin.
- **No host-only law.** Every end-to-end file runs on CI's Linux, and E4 to E8 read the selection without starting a browser.
- **The real proof is the PR's own ready runs.** Both e2e legs go green, each writes `next.json`, and `shard times` prints advice for the end-to-end files only where a row is more than 60 s off. As with 1104, the lead reads three ready runs and puts the leg times in the PR body.
- **Not a law:** e2e.ts passing its arguments through. Only CI proves it, because a root test importing `next/apps/fabrika/e2e.ts` would cross workspaces. If `--config` were dropped, CI's e2e legs would run the wrong set and go red.

## Files

| Path | Change | Product lines expected | Owner |
|---|---|---|---|
| `.github/workflows/check.yaml` | Legs `e2e-1`, `e2e-2`; guards; the end-to-end command; `shard times` moved after it; the comment says seven machines | 20 | tests |
| `.github/ci/workflow-lint.ts` | E1 to E3; `e2eLegs` export; the new allowed command | 45 | tests |
| `.github/ci/workflow-lint.test.ts` | Plant cases for E1 to E3 | tests | tests |
| `.github/ci/shard-rows.ts` | `selected`, `e2eFiles`; the entry uses both selections | 20 | tests |
| `.github/ci/shard-rows.test.ts` | E8; L4 follows the entry's selection | tests | tests |
| `.github/ci/related.test.ts` | Finds the vitest step by its run command | tests | tests |
| `next/apps/fabrika/e2e.ts` | One Vitest run with the end-to-end config; arguments pass through | 30 (about 40 removed) | tests |
| `vitest.e2e.config.ts` | New file: the end-to-end config and `e2eConfig` export | 30 | tests |
| `exam-paths.json` | One row: `vitest.e2e.config.ts`, "which end-to-end tests run, and their time limit" | 1 | tests |
| `vitest.config.ts` | The key.laws exclude's comment points to the end-to-end config | 2 | tests |
| `vitest.shards.ts` | 8 end-to-end rows, the `E2E` const, the header's sample line | 14 | build |
| `vitest.shards.test.ts` | `e2eSamples`, E4, E5, E6, E7 | tests | tests |
| `.github/ci/shard-times.ts` | No change: the e2e legs now write the `next.json` it reads | 0 | tests |
| `.github/ci/changes.mjs` | No change: the e2e legs run when `next` runs, as now (0175 holds through the `next` flag) | 0 | tests |
| `next/apps/fabrika/e2e/*.test.ts` | Read only: rows are keyed on these paths; no file changes | 0 | tests |
| `next/packages/tuval/src/browser/key.laws.test.ts` | Read only: its row is keyed on this path; no change | 0 | tests |
| `next/apps/fabrika/e2e/reload.test.ts` | Not in this PR: PR 1012 adds it; the trace above shows where it lands | 0 | tests |
| `boundary-rules.json` | Read only: why e2e.ts cannot import the table; no change | 0 | tests |
| `.github/**` | The exam's folder: every file this PR changes there is its own row above | 0 | tests |
| `.github/` | The exam's folder, as above | 0 | tests |
| `.github/ci` | The exam's CI scripts, as above | 0 | tests |
| `.github/ci/shard-times.test.ts` | Read only: run in validation; no change | 0 | tests |
| `next/apps/fabrika/e2e/` | Read only: the folder the end-to-end config selects from; no change | 0 | tests |

Nearly all of this is the exam's: `.github/**`, the runner, the config and the exam list. That matches 1104, where the build only filled rows. The build's job here is the 8 rows and their header line, transcribed from the three job logs.

**No list lets broken code pass (0524).**

- A row only places a file. A missing row never passes anything.
- The new `exam-paths.json` row protects the config. It waives nothing.
- No law is loosened: E5 and 1104's L4 now check more rows, not fewer.

## PR 1220 (CI paths, draft) and this PR

- **Different parts of the CI:**
  - 1220 edits `changes.mjs` (`scope`, `readers`, a `filter` output, the `--same` pass), the `changes` job, and the next vitest step's `run` and `env` (`$FILTER`, plus its `FILTER` pin in workflow-lint).
  - This PR does not touch `changes.mjs`. In the next job it changes the matrix, the guards, the end-to-end step and the step order.
- **Where text will clash:** the vitest step (1220 changes its `run` and `env`, this PR its `if`) and workflow-lint's next block (`nextCommand` beside the leg pins). Resolve by keeping both changes.
- **1220 must rebase anyway.** It still pins six shards and `/6`, from before 1104.
- **Order:** land this one first. 1220 is a draft with later slices still running.
- **Meaning:** under 1220's `readers` filter, the e2e legs still run all end-to-end files, as the `e2e` leg does today. If 1220 wants them to skip on a readers-only run, it adds that to the end-to-end step's `if`. That is its call and fits this shape.

## What fact is lost if not recorded now

- **End-to-end seconds:** today they live only in job logs. The runner writes no JSON report, so `shard times` cannot read them, and logs expire (this repo's log retention was not checked). This PR records the three samples, with run and job IDs, in `e2eSamples`. From now on every e2e leg writes a JSON report that `shard times` reads.
- **The worst run seen:** job 132468626169, with `resources.laws` over 622 s when the job was canceled. This goes in E4's comment as the room check.

## Size

1. One pull request, about 160 product lines: e2e legs by measured seconds. It lands whole: rows, config, runner, lint and workflow together. Rows without the stale-lint change go red, and legs without the config split nothing. About 80% sure of this size.

Validation for the tests and build steps:

- `nice -n 15 pnpm exec vitest run --maxWorkers=3 vitest.shards.test.ts .github/ci/shard-rows.test.ts .github/ci/workflow-lint.test.ts .github/ci/related.test.ts .github/ci/shard-times.test.ts`
- `node .github/ci/workflow-lint.ts`, `node .github/ci/shard-rows.ts`, and `pnpm lint`.
- The lead runs `--changed` and the one typecheck.
- CI's e2e legs are the real run. The lead reads three ready runs.

Cost: priced from ticket 890's rows in `field/runs/` (tests about $4.0, build $1.1, review $3.2, fix round $2.4, a later tests round $0.7). Expected steps: tests, build, review, plus one fix round and its recheck.

Estimate: 5 steps, $14

## Records

No new word, so no glossary row. No decision file: this builds 0175, 1104's shard rows and the lead's two answers below. The PR's three ready runs and their leg times go in its body, and each step's run goes in `field/runs/`.

## What this plan cannot tell us

- **One Vitest process per leg is unproven.** Today each file gets its own Vitest. Isolated forks with `fileParallelism: false` should behave the same, but only CI's run proves it. I am about 75% sure there is no difference.
- **The samples come from one day and three runs.** The cause of the 622-plus second outlier is unknown.
- **The organization's limit on jobs running at once was not checked.** A full run goes from about 17 jobs to 18.
- **If `resources.laws` alone outgrows half the limit,** no leg count helps. E4 then goes red, and the file itself must be split. That would be its own ticket.

## Answered questions

The lead answered both, overnight, as the lead's leans for the owner to read.

1. **Vitest `--shard` through a root end-to-end config, not a CI script.** It reuses 1104's sequencer, rows, fallback and JSON advice unchanged, and decision 0040 says to try the existing tool first. The cost is one Vitest per leg in place of one per file, Vitest's file order, and no stop at the first failure. About 70% sure; the PR's first ready run settles it.
2. **Leg count: the fewest legs that keep every leg's job under half the limit.** The plan's first draft leaned toward the fastest split. The lead picked fewest runners, because the free plan's 20 jobs at once is the measured bottleneck: a third e2e leg would hold one more runner on every run to save about 40 s. E4 and the trace above follow this rule. About 70% sure.

## Open questions

None.

## Findings

None.
