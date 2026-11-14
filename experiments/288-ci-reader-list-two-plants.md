# 288. Is the CI plan's reader list complete? Two comment-only plants under `next/`, one full `next` run each

**Summary.** `next/`, slice 0 of the CI path plan (`docs/plan/ci-paths.md` on the branch
`fabrikalfa/plan-ci-paths`). Answer: **yes, as far as two plants can show, with one gap in what was
seen.** Every test that went red for a reason the plants caused is on the reader list (the exam's
`laws-scan`, `layers` and `deps` tests). One test off the list went red on both plants,
`runtime-recovery.laws.test.ts`'s "T753 L16", by hitting its 60 s timeout; run alone here, three times
per side, it takes 29.7 s on `main` and 32.3 s on plant 1 (medians), about half its limit, so it is a slow law on a loaded CI machine, not a reader. And plant 1's
sixth `next` machine hit the job's 17-minute limit, so about a sixth of the suite was not seen on
plant 1. CI time only, about 2 x 90 machine-minutes; no model spend beyond this session.

Run on 2026-11-14 (UTC). The plants were made and checked in a Claude cloud session (Linux, 4
cores) with `oxc-parser` 0.157.0 from the lockfile; CI ran on GitHub's `ubuntu-latest` machines.

| | Plant 1 | Plant 2 |
|---|---|---|
| Branch, commit | `fabrikalfa/x-ci-plant-1`, `a9d665f` | `fabrikalfa/x-ci-plant-2`, `0759f89` |
| Pull request (ready, never queued, closed after) | [kamp-us/tea-fabrika#1195](https://github.com/kamp-us/tea-fabrika/pull/1195) | [kamp-us/tea-fabrika#1196](https://github.com/kamp-us/tea-fabrika/pull/1196) |
| CI run | [43563163607](https://github.com/kamp-us/tea-fabrika/actions/runs/43563163607) | [43563165554](https://github.com/kamp-us/tea-fabrika/actions/runs/43563165554) |
| `next` machines | 1, 2, 4, 5 green; 3 red; 6 cancelled at 17 min | 1, 4, 6 green; 2, 3, 5 red |
| Red tests on the reader list | none | 4, all in the exam |
| Red tests off the list | 1: T753 L16, timed out | 1: T753 L16, timed out |
| `check` (lint) and `typecheck` | both green | `check` red, `typecheck` green |

```ts
// The whole idea, as a sketch: a comment-only change, proven the same program, then every `next`
// test run on it. A red test is a reader; a reader the plan did not list is a hole.
const same = (a: string, b: string, path: string) =>
  JSON.stringify(strip(parseSync(path, a).program)) === JSON.stringify(strip(parseSync(path, b).program));
// strip drops start, end, range, loc and span; literal text (`raw`) stays in.
for (const red of failedTests(run)) verdict(red, readerList.includes(fileOf(red)) ? "listed" : "hole?");
```

## The plants

Both start from `origin/main` at `7ae7cea`, whose own `check` run is green, and change only the
297 `.ts` and `.tsx` files under `next/` whose names do not end in `.test.ts(x)`. That set includes
the `*.test-support.ts` files and the exam's own helpers (`plant.ts`, `twin.ts`, `rows.ts`, ...),
since the plan's rule would skip a comment-only change to them too.

**Plant 1: a big doc block at the top of every file.** 26 lines after a shebang where there is one,
8,316 lines added in all, none removed:

```ts
/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * ... 24 such lines ...
 */
```

It moves every line of every file down by 26, which is the plan's "a test that pins a line" case.
It also grows the built app: Rolldown 1.2.13, the repo's bundler, keeps `/** */` blocks in an
unminified build and drops `//` comments (checked here on a two-function file: unminified, all
three `/** */` blocks stayed; minified, none did).

**Plant 2: trap text.** In every file, a top block whose inner lines do not all start with `*`, so
a test that reads lines as text sees code-shaped lines:

```ts
/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
```

The strings come from what the exam's tests grep for (`defineMachine(`, `syncTest(`, lines that
start with `import`, `p8-clean-window`, `person:`, `imports "..."`). Plant 2 also puts
`/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */` right after the `{`
of the first function body in 219 files, where `fn.toString()` and an unminified bundle show it,
and a three-line block before a middle top-level statement in 284 files. 4,338 lines added and 219
changed.

**Proof that both are comments only.** For each of the 297 files, the `origin/main` version and the
branch version both parse with `oxc-parser` 0.157.0 with no errors, and the two trees are equal as
JSON once `start`, `end`, `range`, `loc` and `span` are dropped (BigInt literals compared by their
text). The hashbang matched too. The check catches a real change: `1000` made `1e3` in one file
gave "tree differs". No plant holds text the plan's tool-comment rule refuses (an `@` word with a
dash or underscore, `#__`, a leading `!`, `@license`, `ignore`, a lint or format tool's name), and
no middle block lands right under an `oxlint-disable-next-line` or `@ts-expect-error` line, so no
directive was moved off its target. The script that made and checked the plants is not kept; this
paragraph is its whole logic.

## Every red test, and whether it is on the list

| Plant | Machine | Test | Why it went red | On the reader list? |
|---|---|---|---|---|
| 2 | 2 | `exam/laws-scan.test.ts` > has laws beside every machine | 287 files now "make a machine": the planted `defineMachine(` | yes (the exam) |
| 2 | 2 | `exam/laws-scan.test.ts` > runs the sync test on every machine, or names why not | 4 files with pbt laws became "machines" | yes |
| 2 | 2 | `exam/layers.test.ts` > keeps every part to the imports the table allows | 302 planted `import` and `export` lines read as imports | yes |
| 2 | 5 | `exam/deps.test.ts` > imports only what each package lists, through exports maps, inside its own package | 252 files "import" `../../../x-ci-plant-not-a-file.ts` | yes |
| 1 | 3 | `runtime-recovery.laws.test.ts` > T753 L16 real first/later process steps, recovery and successors keep the shared instance gate | `Test timed out in 60000ms` | **no** |
| 2 | 3 | the same T753 L16 | `Test timed out in 60000ms` | **no** |

**T753 L16 is not a reader, as far as this can show.** The law reads no source file, builds
nothing and bundles nothing: it drives the real runtime in process over SQLite, for 100 fast-check
runs with the fixed seed 119120. The same inputs run on both sides, so a comment cannot change
what it does. What points at load and not at the plants:

- On `main` at `48460bd`, the same machine 3 passed all 413 of its tests in 509 s. On the plants it
  took 682 s and 653 s, about 30% longer, and every slow file was slower, not only this one.
- Plant 1 adds twice the lines of plant 2, yet both machines were equally slow and both failed the
  same way.
- Both runs ran side by side with each other, and at least seven other pull requests' runs started
  while they ran (06:03 to 06:11 UTC).
- Run here alone, one machine, Node 26.13.0 as the repo pins it, `-t "T753 L16" --maxWorkers=1`,
  the two sides taking turns:

  | Side | Run 1 | Run 2 | Run 3 | Median |
  |---|---|---|---|---|
  | `main` at `7ae7cea` | 28.3 s | 29.7 s | 30.6 s | 29.7 s |
  | plant 1, its 297 files on top | 32.3 s | 28.4 s | 33.0 s | 32.3 s |

  The ranges overlap, and every run is about half the 60 s limit. To time out, the law needs a
  machine about twice as slow as this box, which a busy CI machine running the rest of shard 3
  beside it can be.
- The plan's own finding already records the same kind of red: `QueueRunnerTest.ts` timing out at
  120 s in a merge-queue run of a pull request that changed only doc comments.

So T753 L16 is a law that runs close to its timeout on a loaded CI machine. It is a flaky-test
finding, `field/findings/2026-11-14-t753-l16-times-out-on-a-loaded-ci-machine.json`, not a hole in
the list. A flaky test also owes a tracker ticket and a fix the same day (0036); this session has
no tracker, so the lead files the ticket.

**Plant 1's machine 6 was not seen whole.** It was cancelled at the job's 17-minute limit
(`timeout-minutes: 17`) while its tests were still passing; one of them, `StartChild.test.ts`'s
"L6: a valid first-letter row survives when its full command exceeds the row limit", took 243 s.
On `main` at `48460bd` the same machine took 15 minutes, already close to the limit. The tests
after the cut never ran on plant 1. Plant 2's machine 6 ran to the end and was green, so the
trap-text plant reached them; the line-shift plant did not.

**What `check` said.** On plant 1, lint passed: a 26-line plain doc block at the top of a file
breaks no lint rule. On plant 2 it failed (oxlint's exit code 1, the cause not traced from the
log). `typecheck` was green on both. Neither job gates the `next` job, which needs only
`changes`.

## The answer

**Is the reader list complete? Yes for these two plants, with two limits.** No red test that the
plants caused is off the list. The holes it could still have:

1. **Plant 1's machine 6.** About a sixth of the `next` files never ran under the line shift. A
   test there that pins a line would not have been seen. To settle it: rerun that one machine on
   [kamp-us/tea-fabrika#1195](https://github.com/kamp-us/tea-fabrika/pull/1195) with a longer limit,
   about 17 machine-minutes.
2. **A test that reacts only to other comment text.** Two plants test the text they hold. The plan's
   own "what would settle it" still stands: a guard that fails a `next/` test outside the list when
   it opens a product source file.

And one thing the plants show about the plan's design, not its list: a comment-only pull request
can still meet a red from a slow law (T753 L16 here, `QueueRunnerTest.ts` in the plan's finding).
Running only the readers would hide those, which is a gain for the pull request and a loss for
finding the flake.

## What this cannot tell us

- Whether any test turns **green** because of a comment. A comment can hide a missing fact from a
  text-reading test (a `syncTest(` written in a comment of a laws file would satisfy `laws-scan`'s
  sync check). Test files were not planted, and only reds were looked for.
- Plant 1's machine 6 after its 17-minute cut, as above.
- Why `check` failed on plant 2; only its exit code was read.
- Test files (`*.test.ts`) were not planted. A comment-only change to a test file falls under the
  same rule, and a test that reads its own file was not looked for.
- One run per plant. A reader whose red depends on timing or order could pass once and fail later.
- The local A/B of T753 L16 is three runs per side on a 4-core cloud box, not CI's machine.
