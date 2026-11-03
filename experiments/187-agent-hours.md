# What is an agent hour, and how many lines does one buy?

Run 2026-11-01. **An agent hour is one hour of one agent run's wall clock, summed over every
run on the work, failed runs too, and not counting a driver agent that only waits on others.**
It can be measured today from `field/runs.jsonl`. On the work where every run was logged, one
agent hour bought about **600 written lines** (median 602, middle half 279 to 740, 11 whole lanes
on demlik) and **707** on this repo's one fully logged code PR
([267](https://github.com/usirin/tea-fabrika/pull/267), 8.7 agent hours). A builder alone writes
about 1,500 an hour. **Every size guess in our docs was 4 to 17 times too slow:** they imply 35 to
160 lines an hour, and none had a source. The fact runs must record from now on is the **ticket
and the PR as two fields**, since today one `lane` field holds either.

```text
                         PRs   agent hours   written lines per agent hour
                                             median   middle half   pooled
demlik, whole lanes       11        5.7         602     279-740        601
PR 267, every step         1        8.7         707                    707
tea-fabrika, by hand      71       53.8       1,659   1,055-2,510    1,860   (main session not counted)
demlik, every leaf run    48       20.1       1,364     527-3,898    1,728
our past guesses          19          -          88      64-110        -
```

The note that builds on this, decided 2026-11-01: [agent hours](../docs/direction/agent-hours.md).

## Which version

- **Both.** The runs are today's: hand subagents on this repo, and today's fabrika's lanes on
  kamp-us/demlik. No `next/` code ran. What the note decides lands on today's tracker first,
  where tickets and their run facts live now, and `next/`'s tracker takes the same shape.
- **Nothing was changed** in the tracker or in product code. No ticket was filed.

## How others size work

Read on 2026-11-01. Each says what its unit counts and whether anyone checks it against what
really happened.

| Way | Its unit | Counts | Checked against actuals? |
|---|---|---|---|
| Story points ([Cohn](https://www.mountaingoatsoftware.com/blog/what-are-story-points), updated 2023-06-28) | a point, relative | "the overall effort", folding in complexity, risk and doubt | No. "It is the ratios that matter, not the actual numbers." A team's velocity is its own. |
| Scrum ([the 2020 guide](https://scrumguides.org/scrum-guide.html)) | none named | refinement adds "a description, order, and size" | No. "The Developers who will be doing the work are responsible for the sizing." |
| Linear ([issue properties](https://linear.app/docs/issue-property#estimates)) | a point on a team's scale | "the complexity or size of an issue" | No actual. [Cycle capacity](https://linear.app/docs/use-cycles) comes from "the velocity of the previous three completed cycles". |
| Jira ([log time](https://support.atlassian.com/jira-service-desk-cloud/docs/log-time-on-an-issue/)) | hours | original estimate, time spent, remaining | Yes: time spent is logged, and a report compares the two. |
| Person-hour, [COCOMO](https://en.wikipedia.org/wiki/COCOMO)'s person-month | one worker's hour | effort, summed across workers | Yes, by timesheet. |
| METR ([task length](https://metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/), 2025-03-19) | human expert time | how long the task takes "humans with appropriate expertise" | Yes, by timed human baselines. It sizes the task, not the agent's time. |
| SWE-bench Verified ([Epoch AI](https://epoch.ai/blog/what-skills-does-swe-bench-verified-evaluate), 2025-06-13) | four time buckets | an annotator's guess of an engineer's fix time: 39% under 15 minutes, 52% 15 minutes to 1 hour, 8% 1 to 4 hours, 3 issues over 4 | Partly. METR found the "<15 min" bucket too short against timed people. |
| Devin ([usage](https://docs.devin.ai/admin/billing/usage.md)) | ACU, or credits | "the work Devin actually performs": its actions, plus VM time | Vendor-set. Not counted: "Waiting for your response", "Waiting for a test suite to run", setting up a repo. |
| Codex ([pricing](https://developers.openai.com/codex/pricing)) | credits and usage limits | tokens at a rate | A meter, not a size. "don't use them to estimate included tasks". |

- **Two families.** Points (Scrum, Linear) are relative and never checked. Hours (Jira,
  person-hours) are checked against logged time. METR and SWE-bench size a task in a person's
  time, not in an agent's.
- **Only Devin meters agent work as its own unit,** and it is a billing unit, set by the vendor,
  that leaves out waits. No published unit we found measures an agent's own time on a task.
- **Linear's notes worth keeping:** unestimated issues "count as 1 point" by default, T-shirt
  sizes map to Fibonacci for graphs, and "When estimates are too large, refine issue scope".

## Four ways to count

```text
way                      counts                                    misses                         measurable now
A wall clock, summed     every run's start to end, all agents,     waits are inside it (CI,       yes: `minutes` on every row,
  (decided, 75%)         failed and stopped runs too               merge queue, a slow test)      `minutes` on every `ended` fact
B active time only       time a model or tool is working           the cost of a wait             no: needs per-turn times
C tokens                 billed input and output                   time; differs by model         on lane steps only, not hand rows
D dollars at list price  what it would cost on the API             time; prices move               on Claude runs only
```

- **A driver agent is left out of all four.** On demlik, today's operator agents ran 83 times
  for 38.8 hours while their builders, reviewers and shippers ran 20.1. The operator's clock
  covers its children's, so counting it would count most minutes twice. In this repo's pipeline
  the driver is code, so the question goes away.
- **Parallel runs add up,** as two people in one hour are two person-hours. A lane that runs two
  agents at once spends two agent hours in one hour of the clock.
- **Calendar time is a different number.** First run to merge, with waits on a person, is lead
  time (DORA's word), not effort. A ticket can have 0.5 agent hours and two days of lead time.
- **Why A:** it is the only one in every row today, it is what Jira and person-hours count, and
  waits are a real cost an estimate should hold. The doubt: on demlik the shipper is 26% of a
  whole lane's hours, mostly a merge-queue watch of 480 seconds. If the lane learns to record
  per-turn times, B can be shown beside A.

## The data shape

What a run must record from now on, so the number is exact and nothing is guessed:

- **`ticket` and `pr`, two fields, never one `lane`.** Today this repo's lane `#141` is a
  tracker ticket and its lane `#267` is a PR, written the same way. This study had to
  read each `why` to tell them apart. Lost forever if not recorded: which work a run was for.
- **`started` and `ended` on the writer's clock,** not only `minutes`. With both, overlap and
  lead time rebuild later. A run that dies without `ended` then shows as open, not as zero.
- **`parent`: the run that started this one, or `null`.** So a driver is never summed with its
  children. Lost forever if not recorded: who waited on whom.
- **The main session as a run of its own.** Hand rows say "The main session did it with no
  subagent, so it has no usage line". That time is lost today.
- **The planner's estimate, written before the work.** It cannot be honestly rebuilt after the
  work is done.

**Today's pipeline already has most of it.** Each step writes `{type: "ended", run, stage,
outcome, minutes, input, output, turns, ...}` on the ticket
(`packages/pipeline/src/stages/pipeline/program.ts`), next to its `started` fact, and the watcher
writes a `pr` fact with the PR's URL (`packages/pipeline/src/tickets/ticket.ts`). So a lane's
runs and its PR join on the ticket with no guess. The gap is hand work, and runs that die before
`ended`.

## How it was measured

`187-agent-hours.ts` joins `field/runs.jsonl` to merged PRs. Its `fetch` step read GitHub once
(this repo's 251 merged PRs, 250 on `origin/main`, and kamp-us/demlik's 118 merged since
2026-10-01) into `results/187-agent-hours-prs.json`. PRs with more than 100 files were read again
from the REST list, since the first read stops at 100. The saved file keeps each PR's added lines
summed by kind (code, test, docs and so on), not its file paths.

**A join is never guessed.** A run joins a PR on one of three written links:

- **named:** its `why` names the PR, `tea-fabrika/pull/<n>` or `PR <n>`, with its lane's number.
- **dated:** its lane is this repo's `#<n>`, PR `n` merged into main, and the run's date is
  in the PR's life (opened, less a day for time zones, to merged). I read all 85 dated rows
  against their PR's title by hand: 85 of 85 are the same work.
- **closes:** its lane is `kamp-us/demlik#<n>`, and a PR merged into main closes issue `n`
  (GitHub's own closing link). Issues and PRs that share a link fold into one unit.

**Lines are a PR's additions, by kind of file:** product code, tests (`*.test.*`, `fixtures/`,
`e2e`), docs (`*.md`), experiment scripts. Records (`field/`, `experiments/results/`), config
and the lockfile are kept apart and are not "written lines". A PR's bucket is the kind with 60% or
more of its written lines, or "code and tests" when those two reach 60% together. Deletions are
not counted.

## What came back

### Joins

- **This repo:** 71 of 250 merged PRs joined (4 named, 67 dated), from 91 of 105 runs on its
  lanes. Not joined: 7 rows with no minutes, 4 whose PR merged into a branch and not main, 2 whose
  number is no merged PR, 1 that is a copy of another row's run.
- **Coverage is the weak spot.** 219 PRs merged on main since the first logged run
  (2026-10-23), and 148 of them have no logged run at all: the main session did them, and it logs
  nothing. So this repo's rates are an upper bound.
- **demlik:** 50 issues in 48 units joined, from 130 leaf runs of 89 issues with runs. Not
  joined: 39 leaf runs (3.6 hours) on issues no merged PR closes, and 2 with no minutes. The 83
  driver runs (38.8 hours) are left out on purpose.
- **With [PR 285](https://github.com/usirin/tea-fabrika/pull/285)'s rows** (open, at `66737f3`),
  78 PRs join, 11 named. `results/187-agent-hours-with-285.json` keeps that run.

### Lines per agent hour

| Set | PRs | Agent hours | Median | Middle half | Pooled |
|---|---|---|---|---|---|
| demlik, whole lanes (a builder, a reviewer and a shipper all logged) | 11 | 5.7 | 602 | 279 to 740 | 601 |
| demlik, every leaf run | 48 | 20.1 | 1,364 | 527 to 3,898 | 1,728 |
| tea-fabrika, all joined | 71 | 53.8 | 1,659 | 1,055 to 2,510 | 1,860 |
| tea-fabrika, product code PRs | 10 | 7.5 | 1,485 | 705 to 2,371 | 1,489 |
| tea-fabrika, code and tests PRs | 19 | 8.8 | 2,036 | 1,303 to 2,966 | 2,868 |
| tea-fabrika, test PRs | 9 | 10.0 | 1,276 | 602 to 2,353 | 2,090 |
| tea-fabrika, docs PRs | 8 | 3.5 | 1,965 | 585 to 3,331 | 2,093 |
| tea-fabrika, experiment PRs | 17 | 16.8 | 1,563 | 1,058 to 2,043 | 1,354 |
| tea-fabrika, named only, with PR 285's rows | 11 | 16.1 | 707 | 408 to 2,061 | 1,074 |

- **The whole lane is the honest number.** Where a builder, a reviewer and a shipper were all
  logged, the builder was only 39% of the hours (2.2 of 5.7). The reviewer was 28%, the shipper
  26%, triage 7%. Divide a whole lane's lines by the builder's hours alone and you get about
  1,560, the same as this repo's hand subagents, which were mostly builders.
- **PR 267 agrees.** Every step was logged: five test writer runs (128 minutes), four builder
  rounds (153), two reviews (21), the mutation step (84), three gap tests and the write-up (83),
  and a rehearsal driver (54). Those are rounded to the minute, so they add to 523; unrounded
  they are 128.19, 152.89, 20.87, 84.30, 83.40 and 54.46 (the 14 rows in `field/runs.jsonl`),
  which add to the unit's 524.1 in `results/187-agent-hours-with-285.json`. 6,172 written lines in 524 minutes is 707 an hour.
- **The spread is wide,** a factor of two to three inside the middle half. A small fix can take
  22 to 25 minutes for 2 to 5 lines (demlik PRs 826 and 833). A rate is a planning aid, not a
  promise.
- **Tests per product line:** 1.10 pooled on this repo (median 0.90, middle half 0.46 to 1.42, 44
  PRs), 2.04 on demlik (median 2.75). Tier 1 guessed 1.06, which matches this repo.
- **Failed runs are a small share:** 47 of 221 joined runs did not end in pass or merged, and
  they hold 4.4 of 73.9 hours, 6%.

### Past guesses against the measure

Every guess on main that gives both lines and agent hours. None of the guessed items has been
built, so none has its own actual yet. Each is compared with the measured rate. Wrong guesses stay
here, marked wrong.

| Guess | Where | Lines per agent hour it implies |
|---|---|---|
| Tier 1, "about 150 lines an hour" | `docs/plan/tier-1-detail.md:28` | 150, **wrong by this measure** |
| Tier 1, all of it | `docs/plan/tier-1-detail.md:24` | 161, **wrong** |
| Ticket 115 | `docs/plan/ticket-115.md:24` | 533, the only one near the measure |
| Tiles and the wash | `docs/direction/tile-guidelines.md:512` | 48, **wrong** |
| The desk's modes | `docs/direction/modes.md:327` | 80, **wrong** |
| Windows in Tier 1 | `docs/direction/windows-in-next.md:52` | 80, **wrong** |
| The twin child | `experiments/171-alchemy-local-twin.md:363` | 35, **wrong** |
| Six theme pieces | `experiments/177-themes.md:411-417` | 40 to 150, **wrong** |
| Six study pieces | `experiments/185-dsh-superagent-study.md:367-423` | 60 to 100, **wrong** |

- **The guesses cluster at 35 to 160,** median 88. The whole-lane measure is 602. They are 4 to
  17 times too slow. They read like a person's pace.
- **Tier 1's rate has no source.** It entered in [PR 269](https://github.com/usirin/tea-fabrika/pull/269)
  as "the plan's own rate", with no measurement behind it.
- **Tier 1 at the measured rate:** its middle of 12,470 lines at 602 an hour is about 21 agent
  hours, 17 to 45 across the middle half, against the plan's 63 to 92. A guess at 50%: Tier 1 has
  parts nobody has built here (the menu bar, launchd), and steps demlik's lanes did not have (a
  test writer, a mutation step). PR 267, which had those steps, still ran 707 an hour. PR B's
  actuals settle it.

## Ticket 117, the first real lane

The field log has no step rows for ticket 117 yet. Note `2026-11-01-32` says triage passed in 2
turns for $0.07 on Claude opus, the plan ran on Codex in 2 turns, the exam was skipped, and the
owner approved plan v1. Its minutes sit in the `ended` facts on the ticket, in the app's own
home, which this study did not read. When the lane ends, its `step` rows give its agent hours with
no guess, since every step's `ended` fact is on the ticket and its PR comes from the `pr` fact.

## Cost

$0. No model calls. GitHub read-only through `gh`, once. This study's own agent hours are not in
this write-up: the session that started it logs them in `field/`.

## Running it

```
STEP=fetch env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/187-agent-hours.ts
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/187-agent-hours.ts
```

`RUNS=<file>` reads another runs file, such as an open field PR's copy. `OUT=<file>` writes the
answer elsewhere.

## What it cannot tell us

- **Whether the logs hold every minute.** This repo's main session logs nothing, and 148 of 219
  PRs since logging began have no run at all. A joined PR may also miss a run nobody logged. Only
  demlik's whole lanes and PR 267 are near complete, and that is 12 PRs.
- **Whether lines are the right check.** A deleted line, a moved file and a hard one-line fix all
  cost time that additions do not show. Lines are a planning aid here, not the unit.
- **Whether demlik's rate carries over.** Its lanes are today's fabrika on a TypeScript library,
  with no test writer or mutation step. This repo's pipeline has both.
- **Active time.** Nothing records when a run waits, so the share of an agent hour spent waiting on
  CI or a queue is only seen in one case, the shipper's 480-second watch.
- **How good a planner's estimate would be.** No planner has written one. The first few tickets
  through the pipeline with an `estimate` will say.
- **Model and effort.** Most rows are one Claude model at medium effort. A faster or slower model
  changes the rate, so a rate belongs to its model.
