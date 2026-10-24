# 123. How long does each check layer take on real tickets, and which repeat runs can be cheap?

The question: [Promises in the pipeline](../docs/direction/promises-in-the-pipeline.md)
has six steps: Plan, Tool, Verify writer, Build, Mutation test, Ship. Each
needs the right layer of checks, and mutation testing must not run on every
commit. This experiment times each layer on experiment 122's three
kamp-us/demlik tickets (#483, #367, #355), on copies of 122's trees. It also
tries Stryker's incremental mode for a repair round, and tries to fill a
promise's `covers` lines from coverage, by code.

**Answer: the fast layer takes 3 to 6 seconds a ticket, so it can run on
every commit. A full Stryker run takes 14 seconds to 3 minutes. A repair
round can be cheap, but only with Stryker's vitest runner. With the command
runner that 119 and 122 used, incremental mode keeps old survivors after a
new test kills them. Coverage cannot fill `covers`: the check runs every
line the PR changed. Confidence 75%.**

- **Every commit:** typecheck 2.1 to 2.5 s, `vitest related` 1.1 to 3.3 s,
  the agent's check alone 0.5 s. Medians of 3 runs.
- **Once a ticket:** a fresh full Stryker run took 188 s, 14 s and 15 s with
  the command runner. Stryker 10.1.1's vitest runner, released the day of
  this run, took 52 s on #483. It found the same survivors.
- **Repair round, command runner, `--incremental`:**
  - (a) nothing changed: every result reused, 4 to 7 s.
  - (b) one new test that kills a survivor: **every result reused, so the
    answer was wrong.** #367 still showed 3 survivors; the truth (`--force`)
    was 1. #483 still showed 24; the truth was 23. Stryker's docs name this
    limit, and upstream issue
    [stryker-mutator/stryker-js#6119](https://github.com/stryker-mutator/stryker-js/issues/6119)
    is open on it.
  - (c) one source line changed: only the mutants on that line ran again,
    3 to 4 of them, 7 to 16 s. Correct.
- **Repair round, vitest runner, `--incremental`:** (b) worked. It saw the
  changed test file, ran 6 of 23, 1 of 9 and 31 of 128 mutants again, and
  killed the same survivors `--force` killed. 9 to 24 s.
- **Coverage of the agent's check:** it ran nearly every changed line that
  holds a mutant, on all three tickets. All 29 of 122's survivors fall
  inside, none outside. Stryker on those lines found 120 of #483's 126 mutants, in the
  same time. So the lines a check *runs* are not the lines a promise is
  *about*.
- **Cost:** $0. No agent, no model. About 35 minutes of wall time.

```ts
// A sketch of 123-check-layer-timings.ts, per ticket.
const tree = cloneOf(e122.mutateTree);                        // 122's tree, copied, never changed
const fast = {
	typecheck: median3(() => tsc("--noEmit", changedPackages)), // every commit
	related: median3(() => vitest("related", changedSrc)),
	check: median3(() => vitest("run", agentCheck)),
};
const full = stryker({mutate: prChangedLines, runner: "command", incremental: true}); // once a ticket
const again = stryker({...same});                              // (a) nothing changed
addTest(killsOneSurvivor); const test = stryker({...same});    // (b) is the survivor still alive?
const truth = stryker({...same, force: true});                 // what a fresh run says
editLine(equalLine); const line = stryker({...same});          // (c) one source line changed
const covers = changedLines.filter((l) => ranBy(agentCheck, l)); // v8 coverage, no agent
const narrow = stryker({mutate: covers, runner: "command"});
const runner = stryker({...same, runner: "vitest@10.1.1", coverage: "perTest"}); // then (b) again
```

## Who did what

- **This repo:** one script, `123-check-layer-timings.ts`. No machine of this
  repo ran.
- **Today's fabrika:** nothing in this run. The trees, the agent's checks and
  the PRs' tests come from experiment 122, which used today's fabrika's
  triaged bodies as plans.
- **No agent and no model ran.** Every child ran with the Jev key unset.

## How it was done

- **Trees:** a copy-on-write copy of each of 122's Stryker trees (the merge
  commit, the agent's check, the base copies of the PR's changed tests).
  122's trees were not touched. `@vitest/coverage-v8@5.0.1` was added to each
  copy.
- **Machine:** a 12-core laptop, Node 26, vitest 5.0.1. Every test and
  Stryker run under `nice -n 15`, one Stryker at a time, concurrency 4.
- **The fast layer:** each command 3 times in a row, median kept.
  - Typecheck: `tsc --noEmit` in each changed package, as the package's own
    `typecheck` script does. #483 has two packages, so its time is the sum.
  - `vitest related` on the changed source files, in each changed package,
    as 122 found them: 26, 387 and 131 tests.
  - The agent's check alone: one file, 1 to 6 tests.
- **Stryker:** 9.6.1, the command runner, TypeScript checker on, 122's
  mutate ranges and 122's lists of related test files. One added setting:
  `incremental: true`, with its file kept between runs. The first run had no
  file, so it tested every mutant.
- **The repair round,** one change at a time, each kept for the next:
  - (a) nothing changed.
  - (b) one test appended to a test file the PR changed. #483: a reply of
    exactly 400 must carry its account error detail (kills `>= 400` made
    `> 400`). #367: a run ending at 1999.9999999 ms must end at `[2, 0]`
    (kills both carry survivors). #355: both of 122's survivors change
    nothing a test can see, so the test added checks a known value and
    kills nothing.
  - Then the same with `--force`, which tests every mutant again: the true
    answer.
  - (c) one source line rewritten to an equal one. #483: `>= 400` to
    `> 399`. #367: `1_000` to `1000` and `1_000_000` to `1e6`. #355: the two
    sides of an `||` swapped.
- **Coverage:** vitest's v8 coverage of the agent's check alone. A line ran
  when the smallest statement holding it ran. Intersected with the PR's
  changed lines, then Stryker on just those lines, without incremental.
- **The vitest runner:** Stryker 10.1.1 (core, vitest runner and checker) in
  a second copy, `coverageAnalysis: "perTest"`, the same mutate ranges. tea's
  tests needed a small wrapper config that sets vitest's `root` to the
  package; without it the runner looked for tea's setup file at the tree's
  root. #483 used the workspace's root config, so both packages' tests ran.

## What came back

### Every commit: the fast layer

| Ticket | Typecheck | `vitest related` | The agent's check | Sum |
|---|---|---|---|---|
| [#483](https://github.com/kamp-us/demlik/issues/483) (2 packages, 131 tests) | 2.5 s | 3.3 s | 0.5 s | 6.3 s |
| [#367](https://github.com/kamp-us/demlik/issues/367) (tea, 26 tests) | 2.3 s | 1.1 s | 0.5 s | 3.9 s |
| [#355](https://github.com/kamp-us/demlik/issues/355) (tea, 387 tests) | 2.1 s | 2.3 s | 0.5 s | 4.9 s |

- The three runs of each were within 15% of each other. The first was the
  slowest, by up to 0.4 s.
- Every run passed, on the merge tree.
- tea's `tsc --noEmit` checks `src` without its tests, so a test file's type
  errors are not in these numbers.

### Once a ticket: a full Stryker run

| Ticket | Mutants | Refused | Ran | Command runner | Vitest runner 10.1.1 |
|---|---|---|---|---|---|
| #483 | 126 | 38 | 88 | 188 s | 52 s (128 mutants) |
| #367 | 15 | 4 | 11 | 14 s | 19 s (23 mutants) |
| #355 | 8 | 2 | 6 | 15 s | 18 s (9 mutants) |

- **The command runner's results matched 122 exactly:** the same killed,
  refused and survived mutants on all three. 122 reported 307 s for #483;
  that number also held the search for related tests and a busier machine.
- **The vitest runner found the same survivors** on every mutant both made.
  Stryker 10 makes a few more mutants (a new `CallExpression` mutator). Two of
  them on #483 timed out, since dropping the retry's `sleep` loops forever;
  Stryker counts a timeout as killed.
- **Why it is faster on #483:** with per-test coverage it runs only the tests
  that reach a mutant. The command runner runs all 131 related tests, in two
  vitest processes, for every mutant. On the two small tickets the start-up
  cost wins and the command runner is a little faster.
- The vitest runner also says when no test reaches a mutant ("no coverage").
  On #367, 3 of the 4 lived that way. The command runner can only say
  "survived".

### A repair round, with `--incremental`

| Ticket | (a) nothing changed | (b) new test, command | (b) the truth, `--force` | (b) new test, vitest runner | (c) one line changed |
|---|---|---|---|---|---|
| #483 | 7 s, ran 0 | 7 s, ran 0, 24 live | 190 s, ran 88, 23 live | 24 s, ran 31 of 128, 23 live | 16 s, ran 4 |
| #367 | 4 s, ran 0 | 5 s, ran 0, 3 live | 14 s, ran 11, 1 live | 9 s, ran 6 of 23, right | 7 s, ran 3 |
| #355 | 5 s, ran 0 | 6 s, ran 0, 2 live | 15 s, ran 6, 2 live | 12 s, ran 1 of 9, right | 12 s, ran 4 |

"Ran" is how many mutants had their tests run, counted by code from the
command runner's calls, or taken from Stryker's own incremental report.

- **(b) with the command runner is wrong, and says nothing.** Stryker
  reported "126 of 126 mutant result(s) are reused" and kept the survivor
  the new test kills. The command runner reports one test, "All tests", with
  no file, so Stryker cannot see that a test changed. Its docs say the same
  of mutants with no per-test coverage, and
  [#6119](https://github.com/stryker-mutator/stryker-js/issues/6119) asks to
  change it. Under the rule that every survivor blocks, this would send a
  fixed pull request back to the verify writer again.
- **(b) with the vitest runner is right.** Its report said "Tests: 1 files
  changed", and it ran again only the mutants that test file's tests reach.
- **(c) is right with the command runner too.** A changed source file is
  seen from its text, and only the mutants on the changed lines run again.
- **(c) made a new survivor on #483.** The equal rewrite `> 399` gave Stryker
  a new mutant, `>= 399`, that no test can tell apart (no reply has status
  399). An equal rewrite on #355 moved its survivor to a new column. Under
  the survivor rule both block until the owner approves a disable comment.

### Only the lines a promise's check runs

| Ticket | Changed lines the check runs | Mutants kept | 122's kills kept | 122's survivors inside, outside | Time |
|---|---|---|---|---|---|
| #483 | 33 of 52 in each client | 120 of 126 | 64 of 64 | 24, 0 | 195 s |
| #367 | 26 of 63 | 12 of 15 | 7 of 8 | 3, 0 | 13 s |
| #355 | 5 of 37 | 7 of 8 | 4 of 4 | 2, 0 | 14 s |

The changed lines count comments and blank lines, which never run.

- **All 29 survivors are inside.** 122's hand read put 13 of them on lines no
  promise is about: the account error text on #483, a span kind on #367.
  The check runs those lines, because they sit on the same path. It does
  not assert on them.
- **What coverage dropped was nearly all refused mutants:** 6 on #483, 2 on
  #367 and 1 on #355. It dropped one real kill, on #367.
- **No time saved:** the narrow run took as long as the full one, since the
  same mutants ran.
- The saved run of this step came after the repair round's test and line
  change. The check does not run the new test, and the changed line is
  equal, so the coverage is the same; the run before the repair gave the
  same counts on #367 and #355. The narrow Stryker run does see the new
  test, so #367's shows 1 survivor, not 3.
- The first try at #483 used a coverage `include` glob, which dropped the
  other package's file. The script now takes every file the check loads and
  picks the changed ones.

### Stryker's vitest runner on vitest 5

- **It works with Stryker 10.1.1,** published the day of this run. Its notes
  list "support vitest v5". 9.6.1, which 122 used, reported no coverage at
  all.
- The upstream bug, now closed:
  [stryker-mutator/stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210),
  the per-test name filter that matched nothing on vitest 5, so every
  covered mutant lived. Nothing was filed.
- What it took: one wrapper config for tea, so vitest's `root` is the
  package. About 10 minutes in all.

## Recommendation

1. **Every commit, in the build loop: typecheck the changed packages,
   `vitest related` on the changed files, and every promise's check.** Why:
   3 to 6 s a ticket here, cheap enough for every commit. Cost: none to
   speak of. Confidence 85%. The doubt: these are small packages; a change
   to tea's core could make `related` pull in far more tests.
2. **The mutation test step: one full Stryker run after the build, on the
   PR's changed lines, with the vitest runner (10.1.1 or later) and per-test
   coverage.** Why: the same survivors as the command runner, 3.6 times
   faster on the one large ticket, and it says when no test reaches a line.
   Cost: a setup per repository (tea needed a root wrapper), and a runner
   version that is one day old. Confidence 75%. The doubt: three tickets,
   one release. A run on ten tickets, or on fabrika's own packages, would
   settle it.
3. **A repair round runs Stryker with `--incremental` only when the runner
   gives per-test coverage. With the command runner, it runs a full run.**
   Why: with the command runner, (b) reused a survivor a new test had
   killed, and said nothing. This is poka-yoke: the step's code picks
   `--force` from the runner, so the stale answer cannot happen. Cost: about
   20 s instead of 3 minutes on #483 with the vitest runner; a full run with
   the command runner. Confidence 80%.
4. **Do not fill `covers` from coverage.** Why: the check ran nearly every
   changed line that holds a mutant, so coverage kept all 29 survivors, including
   the 13 that no promise is about. Some other source has to say which lines
   a promise is about: the plan, the verify writer, or the owner. Cost: that
   stays open. Confidence 80%.
5. **Ship runs no mutation test.** It checks the promises and experiment
   117's gate, as the proposal says. Why: mutation testing ran once after the
   build and again on each repair; nothing changes between the last repair
   and ship. Confidence 70%. The doubt: a rebase on a moved main changes the
   code under the PR; whether that needs one more incremental run is not
   tested here.

Also worth an owner's ruling: an equal rewrite made a new live mutant on
#483 and moved one on #355. Under "every survivor blocks", a refactor in a
repair round can block a pull request that was clean.

## What it cannot tell us

- **Three tickets, all small diffs, in one repository.** #483 is the only one
  big enough for runner speed to matter.
- **One machine, one load.** Times under `nice -n 15` on a laptop, with other
  work on it. 122 measured 307 s where this run measured 188 s on the same
  mutants.
- **The vitest runner was one day old,** and tried on these three tickets
  only. Its (c) case, a changed source line, was not run.
- **The repair round's changes were made by hand,** one each. A real repair
  changes more at once.
- **Coverage was one tool's line view,** v8 read through istanbul's
  statements. A branch view could differ on a line with two branches.
- **The fast layer leaves out lint and test-file typechecks.** tea's
  `typecheck:test` and biome were not timed.
- **No machine of this repo ran.** The script plays the steps; the routing in
  the five verbs was not tried.
