# 112. How noisy is the reviewer, on its own?

The question: in 105b the plan lane did not settle. The same code, judged
again, got a different grade 4 times in 7, and findings added 8 to 14
criteria a pass. Is the noise the model, the review prompt, or the criteria?
And which reviewer should the lane use?

- No lane and no builder. The commits 105b's passes left, each with the
  criteria book as it stood when the lane reviewed it.
- Each commit is judged 5 times by haiku and 5 times by sonnet, both as a
  task review and as a last review. The review path is the lane's own.

**Answer: the noise is mostly the model. Use sonnet as the reviewer. Findings
were not the noise here, and holding them for a yes would not have changed
how any 105b pass ended. A second, smaller source is criteria a reader cannot
check without running the code.**

- Haiku is noisy. On the 5 pairs both models ran in full, 22.7% of haiku's
  cells flipped across 5 runs. Sonnet's flipped 9.4%.
  - Pass/fail flips only: haiku 17.2%, sonnet 5.5%. The rest are flips
    to or from unseen.
  - One haiku review differs from its usual grade 5.8% of the time.
    Sonnet: 2.7%.
- The pre-written rule picks sonnet. Its flip rate is under half of haiku's,
  its verdict was steady in 10 groups of 10 (haiku 9 of 10), and a review
  costs 4.6 times haiku's ($0.049 against $0.011). It was also 3 times
  faster (19 s against 57 s).
- Task review and last review: sonnet agrees with itself (97.7% of task
  criteria). Haiku does not (88.4%), but that gap is its usual noise, not
  the whole book changing its mind.
- The c6 case came from haiku, not from the whole book. Here haiku's task
  review failed c6 4 times in 5, and its last review passed it 5 times in 5.
  That is the opposite way round from the lane. Sonnet passed c6 10 times
  in 10.
- Findings were rare: haiku 0.16 a review, sonnet none in 56 reviews. No
  review failed on findings alone. So findings did not make the verdict
  wobble.
- The hand sample of 20 findings: 8 defects, 7 docs, 3 scope, 2 other.
  Half are asks, not faults.
- "Findings wait for a yes" would have held 31 criteria across 105b's 4
  passes. 7 of 59 reviews would have passed. No pass would have ended
  differently: each pass that did not merge was also held by planned
  criteria.
  It would have saved rounds in pass 4 (task 1 passing at review 1, not 5).
- The second source: criteria that need the code run. The c5 case ("the
  workspace build passes") and a "the CLI runs on Node" criterion. Sonnet
  calls them unseen every time, and haiku fails them. Neither can pass them by
  reading.

Confidence 75% that the model is the main source and sonnet is the better
reviewer. It is lower on "better" than on "steadier". Sonnet grades to the
criterion's words. Some of haiku's extra fails were real defects outside those
words (see Holes).

## The reading rule (written before any counted run)

### Words

- **A pair** is one commit and the book as it stood then, plus the task the
  lane was reviewing there.
- **A group** is one pair, one model, one kind of review (task or last).
  It has 5 runs.
- **A cell** is one criterion in one group. Its 5 runs give it 5 grades:
  `pass`, `fail`, or `none` (unseen, no row, or no form at all).
- **A cell flips** when its 5 grades are not all the same.
  - **Flip rate** = cells that flip / all cells.
  - **Odd-one-out rate** = runs that disagree with their cell's most common
    grade / all runs. It is the chance one review differs from the usual
    answer.
- **A verdict** is the review's outcome: passed (`done`) or not. A group's
  verdict is **steady** when all 5 runs agree.
- **A finding** is a problem no criterion covers. In the lane it becomes a
  new criterion.
  - Two findings in two runs of one group are **the same finding** when they
    name the same file (or both name none) and their `wants` share at least
    30% of their words (words of 3 letters or more, lower case, common words
    left out). Checked by hand on a sample.
  - **Repeat rate** = findings with the same finding in at least one other
    run of the group / all findings.

### What each result means

1. **Is the reviewer noisy?**
   - Yes, if haiku's flip rate is 15% or more, or haiku's verdict is not
     steady in a third of its groups or more.
   - Small, if haiku's flip rate is 5% or less and its verdict is steady in
     5 groups of 6 or more.
2. **Does the model matter?**
   - Yes, if sonnet's flip rate is at most half of haiku's and at least 5
     points lower, and sonnet's verdict is steady in more groups.
   - No (not the main source), if sonnet's flip rate is two thirds of
     haiku's or more.
3. **Is it the criteria's words?**
   - Yes, if half or more of all flipped cells sit on criteria that flip
     under both models (same pair, same kind), and those criteria are at most
     a quarter of all criteria. The write-up then names them and reads them.
4. **Is it the review prompt (its standing checks)?**
   - Look at groups whose verdict is not steady. Count their runs that did
     not pass only because of findings (every given criterion passed).
   - Yes, if that is half or more of those groups' not-passed runs: the
     findings, not the rows, make the verdict wobble.
5. **Task review against last review.**
   - For each task criterion, take its most common grade in the task review
     and in the last review (same pair, same model).
   - They **disagree** if they match on fewer than 90% of criteria.
   - The whole book **changes the judgement** only if the run-to-run
     disagreement between task and last runs is more than 5 points above the
     disagreement between two task runs. Otherwise the gap is the same noise.
6. **Findings.**
   - Mostly noise, if the repeat rate is under 50%.
   - They grow the book, if a review adds 1 finding or more on average.
7. **Scope against defect.** 20 findings drawn with a fixed seed, from both
   models, read by hand and put in one class:
   - **defect**: the code does something wrong, or a user would hit it;
   - **scope**: asks to cut or justify work, or to add work no criterion
     asks for;
   - **docs**: the README or other text, its words or its claims;
   - **rule**: the repository's own `AGENTS.md` rule;
   - **other**.
   - Many are asks, not faults, if scope and docs are 40% or more.
8. **Which reviewer.**
   - Sonnet, if point 2 says the model matters and a sonnet review costs at
     most 6 times a haiku review.
   - Else haiku, with a majority of 3, if a majority of 3 (worked out from
     the 5 runs, every set of 3) halves haiku's flip rate.
   - If no choice gets the flip rate under 10%, no reviewer fixes it: the
     review itself has to change first (findings that wait, criteria
     rewritten), and the write-up says which.
9. **Would "findings wait for a yes" have changed 105b?** From 105b's own
   records, no new runs:
   - every criterion a review added would have been held;
   - every review that failed only on review-added criteria would have
     passed. Count both per pass and say what would have ended differently.

### The pairs

Six, from all four 105b passes, picked before any run:

| Pair | Pass | Commit | Task | Why |
|---|---|---|---|---|
| p2-t2-f590 | 2 | f590263 | t2 | the c6 case: the task review passed c6, the last review failed it, same commit |
| p3-t2-9698 | 3 | 9698f3a | t2 | c5, the whole job on one task: failed 9 reviews of 9; here the only one open |
| p3-t1-5148 | 3 | 51489d0 | t1 | judged twice by the lane: c1 and c2 failed, then passed, same commit |
| p4-t2-23bb | 4 | 23bbb33 | t2 | the task review failed c13 (review-added); the last review failed c1 and c10 |
| p4-t1-741c | 4 | 741c832 | t1 | the last review failed 8, 5 of them passed by their task's own review |
| p1-t2-fb61 | 1 | fb61832 | t2 | judged three times by the lane at one commit: unseen, a finding, a fail |

### Spend

- Cap $4. The script stops starting reviews at $3.8 counted.
- Pairs run in the order above, both models each, so a cap cuts the last
  pairs whole, not one model.

## How it ran

- The runner is `112-reviewer-noise.ts`. Each pair gets a copy of the pass's
  repository (kept as a git bundle in `112-reviewer-noise/repos/`), checked
  out at the head.
  - The book is rebuilt in a ledger in memory, from the facts the lane had
    written by then: the plan as drafted, then each earlier review's rows
    and findings, in order (`112-reviewer-noise/pairs.ts`).
  - Then the review machine runs to its end, with its own read and Subs,
    over `localCodeHost` and the live reviewer.
  - The rubrics and the lockfile check are 105's. Effort is low, at most
    $0.4 a run. Only the model changes.
- A task review reads `<plan>/tasks/<task>`, so it gets the task's criteria.
  A last review reads `<plan>/book`, so it gets the whole book.
- Nothing is kept: no row goes to any book. Labels are real, and the GitHub
  is fake.
- The count is `112-reviewer-noise/count.ts`. It writes `count` into the
  results.

### Where it went off the plan

- **The spend plan.** In the pilot a sonnet review cost about $0.095, so
  sonnet looked like it would cover only 2 or 3 pairs. So haiku ran all 6
  pairs first, then sonnet in pair order, with the script's stop at $3.2
  counted. The pilot's $0.23 is on top of that.
  - Counted sonnet reviews then cost $0.049 on average, so sonnet reached
    all 6 pairs. The stop cut its last pair, p1-t2-fb61, after 3 task and 3
    last runs.
  - A group has 5 runs (the words above). So p1-t2-fb61 is left out of
    every rate, for both models. Its runs are shown per group, and its
    findings and spend still count.
- **One harness bug, fixed.** Pass 1 merged, so its bundle's main already
  held the head, and the diff was empty. The first 10 haiku runs there
  stopped at `kinds_unknown` with no agent run and $0. The copy now moves
  main back to before the merge. Those 10 runs were dropped and run again.
  This was the harness, not review code.
- **The sample.** Only 11 findings came out of 116 reviews, all from haiku.
  All 11 were read. The other 9 were drawn, with the same seed, from 105b's
  own 31 findings (only their `wants` text was kept).
- **The pilot.** 4 reviews on p2-t2-f590, one per model and kind, run to test
  the harness. They are kept in `results/112-pilot.json` and not counted.

## Results, by the rule

| Point | Result | Reading |
|---|---|---|
| 1. Noisy? | haiku flips 22.7%; verdict steady 9 of 10 | yes (15% or more) |
| 2. Model? | sonnet 9.4%, under half and 13 points lower; steady 10 of 10 | yes |
| 3. Criteria words? | 34% of flipped cells sit on 7 criteria that flip under both (5.5% of criteria) | not the main source |
| 4. Prompt (findings)? | 0 runs not passed on findings alone | no |
| 5. Task vs last | haiku 88.4% agree; run-pair gap 18.0 vs 14.9 task-task | haiku disagrees, but it is the same noise |
| 5. Task vs last | sonnet 97.7% agree; 3.7 vs 1.4 | agree |
| 6. Findings | haiku 0.16 a review, 4 of 8 repeat (50%); sonnet 0 | not mostly noise, by a hair; they do not grow the book here |
| 7. Sample of 20 | defect 8, docs 7, scope 3, other 2 | scope and docs 50%: many are asks |
| 8. Which reviewer | rule 2 holds; sonnet costs 4.6 times haiku | sonnet |
| 9. Wait for a yes | 31 criteria held; 7 of 59 reviews would pass | no pass ends differently |

- Point 1's verdict count flatters haiku. Haiku passed 1 review of 50. Its
  verdict is steady because it nearly always fails.
- Point 6's repeat rate is right on the line, from 8 findings. At a 40% word
  overlap it drops to 25%.
- Point 8's fallback would have been haiku with a majority of 3. That brings
  haiku's flip rate from 22.7% to 6.3%, at 3 reviews ($0.032), 3 times
  slower. Sonnet with one review is 9.4%, and a sonnet majority of 3 is 3.9%.

## Per group

How many of 5 runs passed, and how many cells flipped:

- **p2-t2-f590** (the c6 case)
  - Task: haiku 0 of 5 passed, 4 flips (c6 fail 4 times). Sonnet 5 of 5, 0
    flips.
  - Last: both 0 of 5. Both fail c1, c2 and c4 nearly every time. Pass 2's
    plan has task 1 refuse cross-package moves and task 2 make them, so a
    last review must fail one of them. That is the plan's words, not noise.
- **p3-t2-9698** (the c5 case)
  - Task: haiku fails c5 5 times in 5, plus one other criterion each time,
    a different one each run (5 flips). Sonnet calls c5 unseen 5 times in
    5, 0 flips.
  - Last: both call c5 and c14 unseen most runs.
- **p3-t1-5148**
  - Task: haiku 0 of 5, failing c1 every time. Sonnet 5 of 5.
  - The lane failed then passed c1 here. Haiku's last review passes c1 5 of
    5 at the same commit.
  - Last: both fail task 2's criteria. Task 2 is not built yet at this head.
- **p4-t2-23bb**
  - Task: haiku 1 of 5, failing the review-added c13 4 times. Sonnet 5 of 5.
  - Last: both fail c1 (planned) and c10 every time.
- **p4-t1-741c**
  - Task: both fail or cannot see c16, "the CLI must run when invoked as the
    bin on the supported Node runtime". Haiku fails it; sonnet calls it
    unseen.
  - Last: both fail task 2's planned c3, c4, c6, c7 and c8 every time.
    Those failures are steady, not noise.
- **p1-t2-fb61** (not counted: sonnet has 3 runs a kind)
  - Task: haiku 1 failed and 4 unseen on c8, "the lockfile matches a fresh
    install". Sonnet 2 passed and 1 unseen.
  - Last: both fail c1 and c3 every time.

## Why haiku's task review fails more

Haiku's extra fails are not random words. Read against the code, they are
often real, but outside what the criterion says.

- p2-t2-f590, c6: haiku says importers inside the source package are not
  rewritten. True: `rewriteImports` skips the source package. But c6 only
  asks about importers "in other packages". Sonnet grades to those words and
  passes.
- p3-t1-5148, c1: haiku says no `structure-sweep move apply` command is wired
  to `apply()`. True, and c1 names that command. Sonnet passes it anyway.
- So haiku is noisier and stricter. In the task review it reads one task
  closely and finds more. In the last review, with 16 to 20 criteria, it
  passes the same criterion at the same commit (c6, c1). Which grade is
  right is a matter of the criterion's words.

## Findings

- Haiku made 11 findings in 60 reviews. Sonnet made none in 56.
- Fewer than in 105b (31 in 59 lane reviews). Each book here already held
  the findings the lane had kept before that review. Those cover the same
  ground, so a finding there becomes a row here.
- By source: 7 standing checks, 3 deviations, 1 the repository's rule.

### The hand sample of 20

Each finding was read against the code at its commit. One class each:

- **defect** (8): the code does something wrong, or a test that is there
  cannot fail. E.g. `addDependency` returns early when it cannot find a
  package, and nothing reports it. A manifest write sorts every existing
  dependency.
- **docs** (7): the README claims what the code does not do. E.g. "the
  lockfile is regenerated" when the code splices lines into it.
- **scope** (3): cut or justify work, or add a test no criterion asks for.
  All 3 are from 105b's own findings.
- **other** (2): a test's tidiness, and one 105b finding whose whole text
  was "placeholder". That one held a pass 1 review open.
- **rule** (0). The one finding given under the rule was a defect when read.

From this run's 11: 5 defects, 5 docs, 1 other. From 105b's 9: 3 defects, 2
docs, 3 scope, 1 other.

## Findings that wait for a yes, in 105b

From 105b's own records, no new runs (`held` in the results):

- Criteria the reviews added, all held: pass 1: 7, pass 2: 6, pass 3: 6,
  pass 4: 12. Total 31, against 52 planned.
- Reviews that failed only on added criteria, which would have passed: 7 of
  59 (pass 1: 1, pass 2: 1, pass 3: 0, pass 4: 5).
- What would have ended differently: no pass.
  - Pass 1 merged anyway.
  - Pass 2's last review failed planned c1, c2 and c4 (the contradictory
    plan). Both models here fail them every time.
  - Pass 3's task 2 failed planned c5 in 9 reviews of 9.
  - Pass 4's last reviews failed planned c1, then planned c3, c4, c6, c7
    and c8. Both models here fail them every time.
- What it would have saved: pass 4's task 1 passes at review 1, not 5. Task
  2 passes at review 2 instead of never. Pass 4 stopped at the spend cap,
  so those rounds were money. It still would not have merged.

## Proposals (not built here)

- **Sonnet reviews, effort low.** About $0.05 a review, 3 times faster than
  haiku. Expect about 1 cell in 10 to move across 5 runs. 5 of sonnet's 12
  flipped cells were to or from unseen.
- **A criterion that needs the code run is a check, not a row.** "The
  workspace build passes", "the CLI runs on Node", "the lockfile matches a
  fresh install": both models fail them or cannot see them, every time. The
  planner should write them as checks the code host runs. Or the plan check
  should send such a criterion back.
- **The plan check should catch tasks that contradict.** Pass 2's task 1
  refuses what task 2 builds. No reviewer can pass that plan's last review.
- **Findings that wait** are still worth it for growth: 31 criteria a pass
  set. But with sonnet they barely come. The lane hole "a round that changed
  nothing is reviewed again" mattered more with haiku than it will with
  sonnet.

## Holes

- **Steadier is not the same as right.** Nothing here measures which grade
  is correct. Sonnet sticks to the criterion's words. Haiku found real
  defects outside them (c6), and read c1's "command" literally where sonnet
  did not. A lane on sonnet may merge code with defects no criterion names.
  Sonnet also made no finding at all, so the "a real problem becomes a
  criterion" path goes quiet.
- **5 pairs, from one ticket.** All the code is #700's cross-package move in
  a fake workspace. Criteria in other tickets may be clearer, or worse.
- **5 runs a group.** A cell that flips 1 time in 10 shows up in only half
  of 5-run groups. The rates are rough, about ±5 points.
- **The books are not fresh.** Each holds the findings earlier reviews added.
  That is why findings are rarer here than in 105b. A first review of a
  fresh book would make more.
- **A last review at a task's head** (p3-t1-5148) judges tasks not built yet.
  Only task criteria go into the task-vs-last count, so this does not touch
  it, but it adds steady fails to the last-review groups.
- **p1-t2-fb61 is out of the rates.** The cap cut sonnet there at 3 runs a
  kind. Haiku's 10 runs there are shown but not counted.
- **Prices come from the SDK's reported cost.** Sonnet's first reviews on a
  pair cost more ($0.075 to $0.19) than later ones ($0.02 to $0.04). The
  mean depends on how many run together.

## Spend

| Run | Reviews | Spent |
|---|---|---|
| pilot (not counted) | 4 | $0.229 |
| haiku | 60 | $0.665 |
| sonnet | 56 | $2.851 |
| total | 120 | $3.745 |

Under the $4 cap. The 10 haiku runs that stopped on the harness bug cost $0.

## Run it

```sh
node experiments/112-reviewer-noise.ts
node experiments/112-reviewer-noise/count.ts
```

- Needs `CLAUDE_CODE_OAUTH_TOKEN`. Writes to no real repository.
- `MODELS=haiku,claude-sonnet-5-5`, `REPEAT=5`, `PAIRS=<ids>`,
  `CONCURRENCY=4`, `CAP_USD=3.8` (counted spend in the results file).
- `OUT=<name>` writes results under another name (the pilot: `112-pilot`).
- `ONLY_CHECK=1` rebuilds each pair's book and prints its size against the
  lane's rows, with no agent run.
- A stopped run goes on where it left off: runs already in the results are
  skipped.
- `SAMPLE=1` on the count prints the 20 findings drawn for the hand read.
- `112-reviewer-noise/extract.ts` rebuilt `inputs.json` and the bundles from
  105b's worlds. Those lived in a temporary folder, so its output is kept in
  the repository.
