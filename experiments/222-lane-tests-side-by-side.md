---
date: "2026-11-06"
scripts: "none"
summary: "Today's version, a CI fix (PR 412). Main's check went from 3.8 min (Oct 30) to 30 min (Nov 5) as one file grew from 26 to 160 whole-lane tests, run in order on one CPU. A laptop tryout of 12 time-balanced buckets, 4 at a time, ran them in 161 to 197 s a round, against 1,397 s in order. As 18 files over six machines, with a time-weighted `--shard` (`vitest.shards.ts`), PR 412's check took 5.4 min. $0."
---

# The lane's tests, side by side: a 30-minute check back to 5

Measured 2026-11-06. Today's version (`packages/pipeline`), a CI fix,
[PR 412](https://github.com/usirin/tea-fabrika/pull/412). No model, $0 in runner minutes (standard
runners are free in a public repository).

```text
                         check, wall    lane tests                       where they ran
before (main, Nov 5-6)   27-33 min      1 file, 160 tests, 1,610 s        1 CPU of 1 machine, in order
PR 412's first run       5.4 min        18 files, 20 to 158 s each       6 machines, up to 4 files at once
PR 412, table refreshed  4.8 min        the same 18 files                 the same, 2.9 to 3.9 min a machine
main after the merge     5.0 min        the same 18 files                 the same
```

## What was wrong

Main's check took a median 3.8 min on 2026-10-30 and 30.1 min on 2026-11-05. Nothing slowed
down. One file grew: `program.test.ts` held 26 whole-lane tests on 2026-11-01 and 160 on
2026-11-05, each about 10 s of real git, a fake `codex`, real vitest and Stryker. The self-fix plan
wrote each pull request's red tests "on the lane fixture", with `program.test.ts` named as a test
file for each.

vitest gives a whole file to one worker and runs its tests in order. So 160 lanes ran on one CPU
of one machine for 27 minutes, while the other 11 CPUs of the check (3 machines of 4) were done by
minute 4. Since 2026-11-03, 53 of 135 pull request runs (39%) took over 15 minutes.

```text
CI, shard 3, 2026-11-06:  program.test.ts (160 tests) 1610.3s   of   Duration 1612.79s
```

Two more facts made a split need more than new files:

- vitest's `--shard` places files by a sha1 of each path and gives each machine the same count of
  files, not the same seconds (`vitest/dist/chunks/index.1TqnEahn.js`, `shard`).
- The tests in one file cannot run side by side: each lane points `process.env` at its own fakes
  (`vi.stubEnv`).

## What changed

```ts
// vitest.config.ts
sequence: {sequencer: Shards},          // vitest.shards.ts

// vitest.shards.ts: each file, heaviest first (ties by path), to the machine with the least so far
export const assign = (files: readonly {path: string; seconds: number}[], count: number): number[] => ...;
export class Shards extends BaseSequencer { override async shard(files) { /* keeps this machine's */ } }
```

- `program.test.ts` became 18 `lane.*.test.ts` files and one shared `lane-harness.ts`. Every one of
  the 160 tests is there once, with the same assertions, checked by parsing both sides.
- Six test machines, not three.
- Three cuts that make each lane cheaper: the checkout's origin read once a lane and settings once
  a commit (`work.ts`), the tests that leave a question unanswered end once it was asked, and no
  test sets its own limit. The poll test takes its poll as an input (`laneLayer(home, polling?)`):
  46 s to 12.5 s.

## The tryout first, on the laptop

Before any file moved, the 149 tests of the tree with the cuts went into 12 buckets of about 116 s
by their measured times, each bucket its own vitest process (`-t` with names joined by `" > "`),
4 at a time like one 4-CPU machine.

| | wall |
|---|---|
| one file, in order | 1,397 s |
| round 1, 2, 3 (4 buckets each) | 197 s, 167 s, 161 s |

Every test ran once, and only the 3 tests that fail on that laptop alone failed, so no test needed
its file's order. Side by side, each test took about 44% longer (a sum of 2,013 s against 1,397),
with another session loading the laptop.

## PR 412's run

| machine | test step, first run | test step, table refreshed |
|---|---|---|
| 1 (it also runs the bundles and standard tests) | 4.3 min | 3.7 min |
| 2 | 3.0 min | 3.7 min |
| 3 | 3.0 min | 3.9 min |
| 4 | 3.3 min | 3.4 min |
| 5 | 3.0 min | 2.9 min |
| 6 | 3.9 min | 3.4 min |

The whole check: 5.4 min, then 4.8 min, both with every test (the change touches `.github` and `vitest.config.ts`, which
rerun everything). On CI the lane files ran about 1.2 times their laptop time.

The slowest file on CI was not a lane file: `packages/fabrika/src/host/door.laws.test.ts`, 170 s,
which the first seconds table did not name, so it counted 1 s and stacked onto machine 1. The table
now holds every file of 20 s or more from this run; over those files it gives each machine 413 to
430 s. With it, machine 1 came down from 4.3 to 3.7 min and the slowest machine took 3.9 min.

Two more runs of the pull request, after rebases onto main, took 4.5 and 4.3 min. Main's own first
run after the merge took 5.0 min (run 42355711305, 2026-11-07). Its machine 5 was red on an older
flake, `packages/fabrika/src/host/local.test.ts` (it failed on main on 2026-11-04 too, run
41766963610), and green on a rerun of that machine. The next pull request keeps all an ended child
wrote to stderr, where the first 500 characters had lost workerd's reason when Node's trace came
first.

## Wrong guesses, kept

- "About 1 pull request in 4 waits on it": 39% did.
- "Cut the split, the suite is throwaway": the split was the whole gain. The cuts make each test
  cheaper; only the split uses the idle CPUs.
- The earlier plan's cut 3 (move 75 question tests to unit tests) found 41, moved 11, saved about
  130 s and lost one lane check. It was reverted.

## What it cannot tell us

- Whether 4.8 min holds: two runs on one day is a small sample, and runners differ.
- Setup is a floor of about 1 min a machine, and `apt-get update` once took 2.9 min on one.
- The table goes stale as tests are added: a new slow file counts 1 s until it is measured again
  from the log. The cost is a slower machine, never a wrong result.
- A test that hits its limit leaves its lane in `layer.ts`'s `live` set, and the rest of its file
  then reads "#1 is already running". Older than this; the split keeps it to one file.
- Whether `next/` repeats one file of whole lanes. The lesson for it: test a step on the machine
  that owns it, and keep a whole lane for order across steps, git or the ledger.

## Closing note, 2026-11-10

Today's lane files no longer share a machine's vitest workers (ticket 554).
They run one file at a time before the rest, which keeps three workers.
Crowded CI runs took 550, 690 and 804 s on the slowest machine; the refreshed
three-run median for catchup alone is 689.1 s. Lane placement now starts from
the rest's estimated wall time; the lead measures the new layout in CI.
