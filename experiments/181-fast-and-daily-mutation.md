# 181: A fast mutation check per pull request, and a mutation queue for the rest

Done 2026-11-01. Today's version: the mutation step in
`packages/pipeline/src/stages/mutation/`, StrykerJS 10.1.1 with the vitest runner. No model,
no key, $0. The owner's decision this starts from: a mutation run that takes hours on a
pull request is not acceptable. The check per pull request must be very fast, and a daily
run over the whole codebase gets planned.

## The answer

- **Two settings and one test file make almost all of the time.** On PR 267's by-hand run,
  mutants that hang to the 60 s test limit took 46% of the time, and static mutants (a
  change that only runs when a file loads, so Stryker reruns every test) took 53%. With the
  lane's own end-to-end tests in, each mutant took about 100 s, and the run was on track for
  about 1 h 50.
- **A fast arm keeps every kill but the static ones.** Static mutants off, Stryker's default
  5 s over the run, 10 s per test, and the slow test files left out. On 331 mutants of three
  real sets, the fast arm lost no kill on a normal mutant and made no new one. It dropped the
  static mutants: 30 kills, 0% to 14% of each set. It cut mutant time by 17% to 95%, and
  wall time by up to 65%.
- **The time limit is the biggest single win.** On the ship gate, 37 of 226 mutants were
  killed only by hanging to the 60 s limit: 80% of the run. At 10 s per test they were all
  still caught.
- **One mutant per line, as Google does it, is cheaper but misses real gaps here.** It finds
  60% to 73% of the lines where a mutant lives. Lines first, then the rest, keeps its order
  without its blind spot.
- **Proposed budget: 5 minutes of wall time per pull request, on 2 workers.** That is about
  90 to 300 mutants after the first test run, by how slow the code's tests are. The median
  merged pull request has 98 mutants, so it about fits. The 75th percentile has 761, so a
  third to a half of pull requests do not fit whole. Over the cap, the
  check stops, keeps what it has, and says which lines it did not reach. Sure: 70%.
- **What it means, as the owner then shaped it:**
  - **Today's version gets only the speedups on each pull request:** the 10 s test limit,
    static mutants off, slow test files out, the 5-minute cap in the step, and lines first.
    About 3 to 5 agent hours. Its daily run is not built: that was 15 to 24 agent hours in
    code that `next/` deletes.
  - **In `next/`, the rest goes to a mutation queue,** a program shaped like a merge queue, in
    Tier 6. A pull request's unreached lines and a daily sweep go in, repeats drop by a stable
    id, hands run Stryker, and survivors come out as at most 3 tickets a day. It runs on a
    Durable Object alarm and writes the tracker on the ledger. See
    [the direction note](../docs/direction/fast-and-daily-mutation.md).
- **The whole codebase: about 87,000 mutants once legacy is out,** about 48 worker hours for a
  first pass, a guess. After the first pass, incremental reuse runs only what changed.
- **No Tier 1 pull request has to be split for mutation.** Only C and D2 fit the cap whole.
  The others get a lines-first part. In today's version, the rest is only reported. If the
  owner wants every mutant checked per pull request, the limit is about 100 to 350 product
  lines.

## 1. Where the time goes

PR 267, run by hand on 2026-11-01 (not the lane's own step), 2 workers, `nice -n 15`, on a
12-core laptop at load 11 to 16. Two stages: first without the lane's end-to-end tests, then
with them.

| Cause | Measured | Share |
|---|---|---|
| Static mutants: 46 of 256 (18%) | 647 s of 1,230 s of mutant time | 53% |
| Nine mutants killed only by hanging to the 60 s test limit, mostly in `program/kept.ts` | 566 s | 46% |
| The lane's end-to-end tests (`program.test.ts`, 8 tests, 98 s first run) | about 100 s per mutant; 53 of 143 done in 28 min | the whole of stage 2 |
| Typecheck per survivor, as `takes` does it | 16 s per run of `pnpm typecheck`, 145 survivors | about 39 min, serial |
| The step's `testing` phase runs the whole suite once more | CI's three test shards on main: 241 + 187 + 171 s | about 10 machine minutes |

The two shares overlap: static and hung mutants are not the same mutants, and a static one
can also hang. Stage 1 took 14 min 14 s of wall time. The top 10 mutants took 48% of the
time, and the top 46 took 96%. `kept.ts` alone, 15 mutants, took 507 s.

- **Test selection works.** Per-test coverage plus vitest's `related` (on by default) ran 721
  tests in 37 files, not the whole suite.
- **The `mutate` ranges pull in more than the sample.** Asking for 150 mutants by range ran
  256: a range holds the mutants inside it. Without the by-hand run's own ignorer it would
  have been about 460.
- **Concurrency and `nice` were not measured on their own.** Other agents ran on the same
  laptop all day, so the load moved between 7 and 20. `nice -n 19` against `15` could not be
  told apart from that noise.
- **What stage 2 adds.** Of the 36 mutants it ran, 14 (39%) were caught by the lane tests
  and not by the fast ones. So "no fast test catches it" is not "no test catches it".

## 2. How others do it

- **Google** ([Petrovic and others, TSE 2021](https://arxiv.org/html/2102.11378)): at most one
  mutant per line, and when it is killed, no other is made on that line. At most 7 times the
  number of files are reported per change. The results show in code review, "before the
  review is complete". 82% of reported mutants with feedback were rated useful. The paper
  gives no time budget, and it does not say a mutant ever blocks a change.
- **Meta** ([Beller and others, 2021](https://arxiv.org/html/2010.13464)): shows only mutants
  that live, and runs outside peak hours. In a study with 26 engineers, 84.6% agreed a shown
  mutant was a testing gap, and about 46% acted on it.
- **StrykerJS 10.1.1**, from the installed schema and
  [its docs](https://stryker-mutator.io/docs/stryker-js/incremental/):
  - `ignoreStatic`: static mutants make Stryker "reload the entire environment" and "run all
    tests".
  - `incremental`: keeps results in a file and reuses them. "Stryker will not detect any
    changes you've made in files other than mutated files and test files." "Static mutants
    don't have test coverage; thus, Stryker won't detect test changes for them." `force` runs
    everything again.
  - `timeoutMS` defaults to 5,000.
- **cargo-mutants** ([in-diff](https://mutants.rs/in-diff.html),
  [shards](https://mutants.rs/shards.html)): a pull request tests only the mutants in its
  diff, which is "not a substitute for a full test run". The full run splits as `--shard k/n`.
- **PIT** ([incremental analysis](https://pitest.org/quickstart/incremental_analysis/)): keeps
  history between runs, and warns that "all these optimisations introduce a degree of
  potential error".

## 3. What works here

Three sets of real mutants in today's code, each run twice: once as today's step runs, once
in the fast arm. The planted-bug sets of 119, 121 and 139 were found again by file, mutator,
original text and replacement, since lines have moved.

- **`whole`:** every mutant of `stages/mutation/scope.ts`, 139, so one per line is exact.
- **`ship121`:** 146 of the 150 mutants 121 drew in the ship gate. 4 could not be found again.
- **`lane139`:** the 46 lane mutants 139 lists. Its 104 mutants that `tsc` refused are not in
  its results, so they could not be reused.

| Set | Mutants run | Today's arm, wall | Fast arm, wall | Kills lost | Of them static | New kills |
|---|---|---|---|---|---|---|
| `whole` | 139 | 271 s | 139 s | 10 | 10 | 0 |
| `ship121` | 226 | 1,751 s | 610 s | 20 | 20 | 0 |
| `lane139` | 88 | 122 s | 111 s | 0 | 0 | 0 |

Mutant time, which leaves out the first test run, fell from 248 s to 13 s, 2,870 s to 912 s
and 120 s to 100 s. On the small sets, the first test run (12 s to 80 s) is most of the wall
time, so the fast arm's cost there is mostly that one run.

Against the old labels: of the 146 `ship121` mutants, the fast arm caught every one today's arm
caught, except 20 static ones. Three of those 20 were 119's "both" mutants, ones both 119's test
sets caught. 17 mutants that 121's second run saw live are now caught by both arms, since the
tests changed. In `lane139`, the 22 mutants 139 says the tests kill were caught by both arms,
and the 24 it says nothing kills lived in both.

The options, one by one. Time saved is from the replays of these reports (`replay`), so it is
mutant time on 2 workers, not wall time.

| Option | Time saved | What it misses |
|---|---|---|
| A 10 s test limit and Stryker's 5 s default, not 60 s | 68% on `ship121`, 39% on PR 267 | Nothing measured: every hung mutant was still caught |
| Static mutants off (`ignoreStatic`) | 53% on PR 267, 97% on `whole`, 22% on `ship121` | 6% to 14% of kills. Lines that only static mutants reach |
| Slow test files out (the lane's end-to-end tests) | about 100 s per mutant, the whole of stage 2 | 39% of the fast tests' live mutants were caught by them |
| One mutant per line | 25% to 55% | 27% to 40% of lines where a mutant lives |
| Leaf mutants only (no mutant inside its range), static off, 10 s limit | 12% to 99% | 8% to 75% of lines where a mutant lives |
| Incremental reuse on a rerun | the second run: 0 s of mutant time, 14 s in all, the first test run | Changes outside the mutated files; static mutants after a test change |
| Typecheck in one batch | 7.7 times less time when none is refused | As built, 15% wrong answers when half are refused (see below) |
| A hard time cap | the rest of the run | What is not reached; the stop from outside failed (see below) |

- **Incremental reuse held when every line moved.** A comment on top of `scope.ts` moved all
  139 mutants down a line, and the third run still reused them all. Stryker matches by the
  code's text, not by line number. A change to a test was not tried.
- **Typecheck in one batch.** `batch` puts mutants that do not overlap into one copy and runs
  `tsc` once. An error on a mutant's own line rejects it. An error that no mutant's line
  explains splits the group in two.
  - `lane139`: 46 mutants, all accepted, in 6 runs and 14 s, against 47 runs and 110 s one at
    a time. Same answer.
  - `whole`: 139 mutants, 113 runs and 238 s, against 140 runs and 357 s one at a time. **And
    the answer was wrong.** The batch refused 17 mutants that pass alone and let 4 through
    that fail alone: 21 of 139, 15%. In one copy, a mutant's change to a type shows up as an
    error on another mutant's line. So pinning an error to a line is not safe.
  - What is safe: a group with no error at all is accepted whole. A group with any error
    falls back to one run per mutant. Survivors are mostly accepted by `tsc`, so that is
    the case where a batch saves the most. This safe form was not run.
- **A hard time cap.** Stryker has no cap on a whole run: its only time options are
  `timeoutMS`, `timeoutFactor` and `dryRunTimeoutMinutes`. So the cap was tried from outside,
  on `ship121` in the fast arm, with a reporter that writes each answer as it comes.
  - The reporter works. The first answer came at 96 s, after the first test run. At the
    240 s mark, 41 of the 203 answers were on disk, and none was lost later.
  - **Stopping it from outside failed.** Stryker renames its own process, so a stop by
    command line did not find it, and the run went on to 638 s. Its files were put back
    clean. So the cap belongs in the step, which starts Stryker and holds its process.

## 4. The per-pull-request budget

**Proposed: 5 minutes of wall time on 2 workers, with the check advising and never blocking.**

- **Why 5 minutes.** CI's own checks on a pull request take about 2.5 minutes (`check`: p50
  137 s, p90 144 s; `e2e` p50 96 s, max 183 s; 31 runs). A check that takes twice that is
  still something a person waits for over a coffee, not over a lunch. That is our own
  judgment, not a measured bar. No source gives a number: Google's paper says only "before
  the review is complete".
- **What fits.** The first test run takes 12 s to 80 s. In the fast arm, a mutant took 0.8 s
  of wall time on 2 workers in `whole`, 1.1 s in `lane139` and 2.6 s in `ship121`, whose
  tests are slow. So 5 minutes is about 90 to 300 mutants.
- **Merged pull requests.** The last 60 merges on main, 27 with source lines:

| | p50 | p75 | p90 | max |
|---|---|---|---|---|
| Changed source lines | 137 | 931 | 1,805 | 5,685 |
| Mutants on them | 98 | 761 | 1,658 | 4,090 |
| Lines with a mutant | 41 | 274 | 588 | 2,051 |

  About 0.8 mutants per changed line, and 0.33 lines with a mutant per changed line. Of the
  27, 13 to 17 fit whole (90 or 300 mutants), and lines first reaches every changed line in
  16 to 22. So about 100 to 350 changed product lines fit whole.
- **When a pull request does not fit.** The check runs lines first: one mutant on each
  changed line, in a fixed seeded order, then the rest. At 5 minutes it stops. It keeps every
  answer it has (a reporter writes each one as it comes) and says in plain words how many
  lines and mutants it did not reach. In `next/`, those enter the mutation queue. In today's
  version they are only reported. A pull request is not split to fit the check: splitting is
  for the review's sake.

Sure of 5 minutes: 70%. The doubt is the rate. It came from three sets on a busy laptop, and
the ship gate's tests are ten times slower than the mutation step's own. A week of the real
step's timings settles it.

## 5. The daily run

- **How many mutants.** `count` instrumented every source file under `src/` and never ran a
  test: 101,622 mutants in 528 files, 41,051 lines with a mutant, 13 s. Legacy (14,724) only
  shrinks, so leave it out: about 87,000. The biggest files are law helpers, such as
  `laws/tea-host.ts` with 3,364.
- **How long.** About 80% are not static. At about 2.5 s of worker time each, that is about
  48 worker hours. A public repo's standard Linux runner has 4 cores
  ([GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)), so 3
  workers each: about 16 runner hours. Sure: 50%; the rate is from three files.
- **Where it runs: in `next/`, as a mutation queue on hands.** The owner set this after the
  first draft. The queue is a program on a Durable Object alarm. It reads and writes the
  tracker on the ledger, and hands run Stryker. Today's version gets no daily run. See
  [the direction note](../docs/direction/fast-and-daily-mutation.md).
- **The first lean, replaced.** The first draft put the daily run on GitHub Actions' free
  shards: 6 hours a job and 20 jobs at a time on the free plan
  ([limits](https://docs.github.com/en/actions/reference/limits)), so about 20 shards of 50
  minutes. Today's tracker is `ledger.sqlite` on the laptop, which Actions cannot reach
  (`fabrika post` needs a connected home and the person's key, `apps/fabrika/src/host/post.ts`),
  so a laptop job would have fetched the results through `CodeHost`. That was about 15 to 24
  agent hours in code that `next/` deletes. It is kept here as the road not taken.
- **What the queue's hands face.** 48 worker hours is days of rolling batches on a laptop's
  hands for the first pass. After it, only changed code and tests go in.

## 6. Pull request size

Tier 1's pull requests, from the plan's own sizes. Mutants are product lines times 0.8, and
lines with a mutant are product lines times 0.33. Reached is the share of those lines that
lines first reaches in 5 minutes, at 90 to 300 mutants.

| PR | Product lines | Mutants | Lines with a mutant | Reached in 5 minutes |
|---|---|---|---|---|
| A, door and plumbing | about 1,200 to 1,700 | about 1,000 to 1,400 | about 400 to 560 | 16% to 75% |
| B, the app | about 900 to 1,300 | about 700 to 1,000 | about 300 to 430 | 21% to 100% |
| C, cloud | a few hundred | under 250 | under 100 | all |
| D, notes | 1,500 to 2,000, half copied | about 1,200 to 1,600 | about 500 to 660 | 14% to 60% |
| D2, backup | 150 to 300 | about 120 to 240 | about 50 to 100 | all |
| E, chaos | about 800 to 1,200 | about 650 to 950 | about 260 to 400 | 22% to 100% |

A, B and E are split from the plan's 3,300 to 4,500 lines "before today" by their task
counts, a guess. The mutation step's own skip list takes out the files no test process can
mutate, so the real numbers are lower.

- **None needs splitting for the check.** Lines first reaches every changed line of C and D2
  and most of B and E. The rest enters the mutation queue, once Tier 6 builds it.
- **The plan's "10 to 25 machine minutes per PR" becomes 5.** And its "Survivors go back to the
  test writer" becomes "survivors are advice, rated by the owner".
- **Until Tier 6, nothing reaches the unreached lines.** Tier 1's pull requests come long
  before the queue, so their leftovers are only reported.

## What this cannot tell us

- **The rate is from three files on a busy laptop.** The load moved between 7 and 20 all
  day, with other agents running. The first pass's 48 worker hours could be half or double.
- **The fast arm was not run on PR 267's own sample.** That set's by-hand folder belongs to
  another agent. The replay of its report is the closest we have.
- **No survivor has been checked against a real bug on a real pull request.** The lane's own
  mutation step has not run on a real ticket. What we know of survivors' worth is from
  studies: in 119, 11 of 12 checked "neither" mutants were real uncovered changes; in 126,
  7 of 11 hand-checked survivors were real gaps. Together 5 of 23 were not, 22%. That is
  above the 10% bar for advice, from a small sample.
- **Static mutants are a real blind spot of the fast arm.** Most were schema and literal
  changes caught by any test that loads the file. Some were not: three of 119's "both" mutants
  are among them.
- **Incremental reuse was tried only with no change and with lines moved.** A changed test
  and a changed imported file were not tried. Stryker's docs say the second is missed.
- **The batch typecheck as built gave wrong answers.** Its safe form (accept a clean group
  whole, else one run each) was not run, and neither was any batch on survivors only.
- **The time cap was not shown working.** The answers streamed, but the stop from outside
  missed the process. A stop from inside the step is untested.
- **The `run` command in the script is the same logic as the scratch runner that made these
  numbers,** rewritten to sit beside the write-up. `sets` and `compare` were run again from
  it and gave the same answers; `run` itself was not run again.
- **The Tier 1 sizes are the plan's guesses, split by a guess of ours.**

## Files

- `181-fast-and-daily-mutation.ts`: `count`, `prs`, `pick`, `batch`, `replay`, `sets`, `run`
  and `compare`. `run` works on a throwaway copy of the repo, since Stryker writes in place.
  The answers are not saved under `results/`: the reports hold file paths of the machine they
  ran on.

```sh
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/181-fast-and-daily-mutation.ts count .
```
