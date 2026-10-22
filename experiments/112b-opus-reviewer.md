# 112b. The reviewer's noise, with opus

The question: experiment 112 measured how noisy the reviewer is on its own,
but only with haiku and sonnet. The product's default reviewer is opus at
effort medium (`AGENT_DEFAULT` in `packages/fabrika/src/pipeline/setup.ts`).
Is opus steadier than sonnet? And does it make findings of its own, on
defects no criterion names? Sonnet made none in 56 reviews, and that was
112's biggest hole.

- The same 6 heads and books as 112, the same review path, the same count.
- Opus judges each pair 5 times as a task review and 5 times as a last
  review, at effort medium.
- Haiku's and sonnet's runs are 112's, reused as they are.

**Answer: opus is not steadier. It flips 19.5% of cells, near haiku's 22.7%
and twice sonnet's 9.4%, so the pre-written rule picks sonnet. But the rule
measures steadiness, not being right, and here the two point opposite ways.
Every opus flip between pass and fail sits on a real defect that opus saw in
some runs and missed in others. Sonnet passed those same cells every time. Sonnet is
steady because it steadily misses them.**

- Flip rate: opus 19.5%, haiku 22.7%, sonnet 9.4%. Pass/fail flips only:
  opus 16.4%, haiku 17.2%, sonnet 5.5%.
  - One opus review differs from its usual grade 5.8% of the time (haiku
    5.8%, sonnet 2.7%).
  - Verdict steady in 8 of 10 groups (sonnet 10, haiku 9).
- What the flips are. Opus had 21 cells that went between pass and fail.
  Each fail came with a fault, and we read each one against the code.
  - All 21 name something that is really wrong at that commit. One (c20,
    importers outside `packages/` are never looked at) is a small case.
  - Sonnet passed 16 of those 21 cells 5 times in 5. Haiku failed 11 of
    them at least once.
  - So opus's noise is not random words. Each run sees some of the real
    defects, and the next run sees a different few.
- Findings of its own (new criteria): rare. 9 in 60 reviews (0.12 a review
  on the counted pairs; sonnet 0, haiku 0.16). None repeats in another run.
  - Read by hand, all 9 are true. Only 1 is a defect. 6 are README claims
    the code does not keep, and 2 ask for a CLI test.
  - Opus does name defects no criterion's narrow words name. But it hangs
    them on an existing wide criterion ("the README describes what the code
    does", "the build passes", c6's long story), not on a new one. Examples:
    importers in third packages get no dependency on the target, a missing
    source half-way through a plan leaves a partial write, the lockfile
    merge drops unquoted entries.
- Fails: 10 drawn, 10 real. 6 of them are steady fails any model makes (a
  plan whose tasks contradict, a task not built yet at that head).
- It also misses things. At p3-t1-5148 and p4-t1-741c there is no
  `structure-sweep move apply` command or bin at all. Opus passed c1 there 5
  times in 5, and c16 (the CLI runs as the bin) 4 times in 5. Haiku failed
  them. On 112's c6 case it never named the source-package importers haiku
  found, but it named two other real defects at that cell.
- Cost: $0.204 a review (4.2 times sonnet's $0.049), 59 s a review (3 times
  sonnet's 19 s).

Confidence 80% that opus's flips are mostly real defects seen some of the
time, from 21 cells read on 5 heads of one ticket. 70% that this makes opus
the better reviewer despite the noise: a lane on opus gets more real fails,
but a fresh one can turn up on any round, so the lane does not settle.

## The reading rule (written before any counted run)

### Words

The words are 112's: a pair, a group, a cell, a flip, the flip rate, the
odd-one-out rate, a steady verdict, a finding, the same finding, the repeat
rate. See [112](./112-reviewer-noise.md#words). Two more:

- **A fail** is one row a review graded `fail`, with the fault the reviewer
  gave for it (its finding on that criterion).
- **A real finding** is one that, read against the code at the pair's head,
  names something the code really does wrong, or a test that cannot fail:
  112's `defect` class. A finding that is true but only asks for more work or
  better words (`scope`, `docs`) is true, but not a real defect.

### Why sonnet's runs are reused

- The pairs, the books, the bundles, the review machine, the rubrics and the
  lockfile check are the ones 112 ran. No review code changed since.
- Sonnet ran at effort low, at most $0.4 a run. Opus runs at effort medium,
  at most $2 a run, the product's default. So opus against sonnet changes
  two things at once: the model and the effort. That is the comparison the
  owner asked for (the default against 112's pick), and the write-up says it
  in the holes.
- Sonnet is not run again.

### What each result means

The counted pairs are those where every model has all 5 runs of every group,
as in 112. Haiku and sonnet are counted again on those pairs, with the same
count script, so their numbers are checked against 112's (22.7% and 9.4%).

1. **Is opus steadier than sonnet?** Flip rate per cell, against sonnet's.
   - Steadier, if opus's flip rate is at most two thirds of sonnet's, and its
     verdict is steady in at least as many groups.
   - The same, if it is within a third of sonnet's either way.
   - Noisier, if it is a third or more above sonnet's.
   - Also given: the odd-one-out rate, pass/fail flips only, and a majority
     of 3.
2. **Steadiness per group.** How many of the groups have a steady verdict,
   against sonnet's 10 of 10 and haiku's 9 of 10.
3. **Does opus make findings of its own?**
   - Yes, if it makes 0.2 findings a review or more (above haiku's 0.16).
   - Rare, if it makes some, but under 0.2 a review.
   - No, if it makes none, as sonnet.
   - The repeat rate, as in 112.
4. **Are its findings real?** Every opus finding is read by hand against the
   code at its head, up to 20. With more than 20, 20 are drawn with 112's
   fixed seed. Each is put in one of 112's classes (defect, scope, docs,
   rule, other).
   - Opus's findings are mostly real, if half or more of those read are
     `defect`.
5. **Are its fails real?** 10 of opus's fails, drawn with the same seed from
   the counted pairs, read against the code and the criterion's words:
   - **real**: the fault is true in the code, and the criterion's words cover
     it;
   - **true, outside the words**: the fault is true, but the criterion does
     not ask for it (112's c6 case);
   - **wrong**: the fault is not true in the code;
   - **cannot be seen by reading**: the criterion needs the code run.
   - Opus fails well, if 8 of 10 or more are real.
6. **The two known defects outside the words.** 112 found two real defects
   haiku failed and sonnet passed. What opus grades there, and whether its
   fault or a finding names the defect:
   - p2-t2-f590, task review, c6: importers inside the source package are not
     rewritten.
   - p3-t1-5148, task review, c1: no `structure-sweep move apply` command is
     wired to `apply()`.
7. **Criteria that need the code run.** c5 on p3-t2-9698 and c16 on
   p4-t1-741c: does opus call them unseen (as sonnet) or fail them (as
   haiku)?
8. **Task review against last review.** 112's point 5, for opus.
9. **Cost and time.** Mean cost a review and mean seconds a review, against
   sonnet's $0.049 and 19 s.
10. **Which reviewer.**
    - Opus, if point 1 is not "noisier", and either point 1 says steadier or
      points 3 and 4 both say yes (it makes findings, and they are mostly
      real). The cost is said next to it, and does not decide.
    - Sonnet, if opus is noisier, or the same and makes no real findings.
    - Else the write-up says it is open, and what would settle it.

### The pairs

The six pairs of 112, in 112's order. The first five are the counted ones in
112 (both models ran them in full). p1-t2-fb61 runs last and only if the
money allows: sonnet has 3 runs a kind there, so it is out of every rate
anyway, and its findings are still read.

### Spend

- Hard cap $20 for everything, the pilot included.
- The runner keeps a run's whole budget ($2) aside while it is in flight. It
  starts no review that could take the counted spend past `CAP_USD` with the
  runs in flight. So the cap holds, whatever a run costs.
- A pilot of 2 reviews on p2-t2-f590 (one task, one last), not counted, kept
  in `results/112b-pilot.json`, sizes the spend.

## How it ran

- The runner is 112's, with two additions: `EFFORT` and `BUDGET` (default
  low and $0.4, as 112), and a cap that keeps each in-flight run's budget
  aside. Opus ran with `MODELS=opus EFFORT=medium BUDGET=2`, at most 4 at a
  time.
- The count is 112's, with `ALSO`: it reads 112's results file and counts
  haiku and sonnet with opus, on the pairs where all three have 5 runs a
  group. Those are the same 5 pairs as 112, and the count gives back 112's
  numbers for haiku (22.7%) and sonnet (9.4%).
- The hand read is `112b-opus-reviewer/read.ts`. It draws with 112's seed and
  keeps the class each finding and fail was given.
- No run broke, and none came near its $2 budget (the dearest cost $0.56).

### Where it went off the plan

- **p1-t2-fb61 ran in two goes.** The in-flight cap skipped 2 of its 10
  reviews once the counted spend neared it. A second start ran those 2. The
  pair is out of the rates anyway (sonnet has 3 runs a kind there).
- **The flipped cells were read too.** The rule asked for a draw of 10
  fails. The fails drawn were mostly steady ones, so they could not say what
  the flips are. All 21 cells where opus went between pass and fail were
  read as well, against the code at their head. This read was not in the
  rule.

## Results, by the rule

| Point | Result | Reading |
|---|---|---|
| 1. Steadier than sonnet? | opus 19.5% against 9.4%; steady 8 of 10 | noisier (a third or more above) |
| 2. Steady groups | opus 8, sonnet 10, haiku 9, of 10 | the two unsteady are task reviews that passed 1 in 5 and 4 in 5 |
| 3. Findings of its own? | 0.12 a review (6 in 50 counted, 9 in all 60); repeat 0% | rare |
| 4. Findings real? | 9 read: defect 1, docs 6, scope 2 | not mostly defects (all 9 are true) |
| 5. Fails real? | 10 drawn: 10 real | fails well, but 6 are steady fails any model makes |
| 6. The two known defects | c6: fails 4 of 5, names two other real defects, not 112's; c1: passes 5 of 5 | one half caught, one missed |
| 7. Needs the code run | c5: unseen 5 of 5 (task), 3 unseen 2 fail (last); c16: passes 4 of 5 (task) | like sonnet on c5; on c16 it passes a CLI that does not exist |
| 8. Task vs last | 90.7% agree; run-pair gap 10.3 against 8.4 task-task | agree, and the gap is the same noise |
| 9. Cost and time | $0.204 and 59 s a review | 4.2 times sonnet's cost, 3 times slower |
| 10. Which reviewer | point 1 says noisier | sonnet, by the rule |

- Point 1, by majority of 3: opus 9.4%, sonnet 3.9%, haiku 6.3%.
- Point 3 counts only findings that would become new criteria. Opus puts
  most of what it finds on an existing criterion instead (3.16 faults on
  criteria a review, sonnet 2.34). See below.

## What opus's flips are

The rule's count says opus is noisy. Reading the cells says what the noise
is. For each of the 21 cells where opus went between pass and fail, the fail
came with a fault. Read against the code:

- **p2-t2-f590** (c6, c17, c14): `fsEnv.rewriteImports` skips every file in
  the target package, so importers there keep a relative path to a file that
  is gone. Importers in third packages are rewritten to `<target>/<sub>`, but
  their package gets no dependency on the target, so the import does not
  resolve under pnpm. A row whose source is missing passes the checks, then
  throws from `renameSync` after earlier rows were written.
- **p3-t2-9698** (c13): the lockfile merge starts a group only on a quoted
  name, so an unquoted entry (an unscoped package) before the first quoted
  one is dropped. That is squarely in c13's words ("no unrelated lockfile
  entries change"). Opus failed it 6 of 10. Sonnet passed it 10 of 10.
- **p3-t2-9698** (c7, c5, c14): only relative imports are walked, so an
  importer that uses the source package's name is not rewritten, and the
  moved file's own bare imports never reach the target's manifest.
- **p4-t2-23bb** (c3, c8, c9): the same bare-name importers, in pass 4's
  code. c3 asks that "every importer reaches them through B's exports".
- **p4-t2-23bb** (c13, c2): adding a dependency writes the whole manifest
  again with `JSON.stringify`. A same-package plan can add a dependency to
  another package's manifest and never make the lockfile again, because the
  lockfile step runs only when a row crosses packages.
- **p4-t1-741c** (c1, c16): there is no command and no bin at all. Opus
  passed c1 9 times in 10 and c16 6 times in 10.

So the cells that flip are where a real defect is. Each opus run sees some
of them. Sonnet passed 16 of the 21 every time. On these cells a steady
sonnet is a steady miss.

## Findings

- 9 findings in 60 reviews, all from the standing checks: 6 from "says what
  the code does", 3 from "tests prove it". None was found twice.
- Each was read against the code. All 9 are true.
  - **docs** (6): the README says only the source package gets a lockfile
    `link:` entry, but one is added per importing package; says a move that
    makes the target depend on the source is refused, when every move does
    that; says every importer is rewritten and existing manifest text is
    kept.
  - **defect** (1): asks for tests of three real breakages (a partial write,
    target-package importers, the moved file's own imports).
  - **scope** (2): the CLI has no test. No criterion asks for one.
- So opus's new criteria are mostly "make the README true". Its real defects
  come as fails on criteria already in the book.

## The fails drawn

10 fails drawn with the seed, from the 153 opus fails on the counted pairs:

- **real** (10). The fault is true, and the criterion's words cover it.
  - 3 are task 2's criteria at task 1's head (not built yet).
  - 3 are task 1's criteria at task 2's head, in pass 3's plan, whose task 1
    refuses what task 2 builds (as pass 2's does).
  - 1 is c16: there is no CLI to run.
  - 3 are code defects: bare-name importers not rewritten (c3), the
    target-package importers the README claims (c17), the moved file's bare
    imports (c14).
- No fail was wrong, outside the words, or unseeable.

## Proposals (not built here)

- **Keep opus as the reviewer, and do not judge it by steadiness alone.**
  The rule picked sonnet, but sonnet's steadiness here is missing the same
  defects every time. A reviewer that passes a lockfile merge which drops
  entries is not a better gate for being steady.
- **Take a fail with a named fault as found, not as noise.** Every opus fail
  read here was true. A lane that re-reviews until two rounds agree would
  throw real defects away. The cost is the one 105b showed: a fresh true
  fail can come on any round, so the lane does not settle. That needs its own
  answer (for example: a fail on a cell an earlier round passed at the same
  code is kept, not re-litigated).
- **Wide criteria soak up defects.** "The README describes what the code
  does" and "the build passes" are where opus hangs things no narrow
  criterion names. That is useful, but it hides them: the defect is a fault
  on c17, not a criterion of its own, and the next round may not see it.
- **The missing CLI is a blind spot for opus and sonnet.** Both passed "when
  someone runs `structure-sweep move apply`" with no such command. Only
  haiku read it literally. A criterion that names a command is a check the
  code host can run, as 112 proposed for build criteria.

## Holes

- **Two changes at once.** Opus ran at effort medium with $2 a run. Sonnet
  ran at effort low with $0.4. So the gap is model and effort together.
  Sonnet at medium was not run, and might find more.
- **Real is checked, complete is not.** The read shows opus's fails are
  true. It does not show how many real defects all three missed.
- **One ticket, 5 heads.** The same hole as 112. The defects here are in
  hand-rolled import and lockfile code, which has many edge cases. A ticket
  with fewer edges may give opus fewer things to flip on.
- **5 runs a group.** The rates are rough, about ±5 points. Opus at 19.5%
  against sonnet at 9.4% is outside that. Opus against haiku is not.
- **The flipped-cell read was not pre-registered.** It was done because the
  drawn fails could not answer the question. One reader, no second check.

## Spend

| Run | Reviews | Spent |
|---|---|---|
| pilot (not counted) | 2 | $0.586 |
| opus, 5 counted pairs | 50 | $10.210 |
| opus, p1-t2-fb61 (not in the rates) | 10 | $2.838 |
| total | 62 | $13.634 |

Under the $20 cap. Haiku's and sonnet's runs are 112's and cost nothing new.

## Run it

```sh
MODELS=opus EFFORT=medium BUDGET=2 OUT=112b-opus-reviewer node experiments/112-reviewer-noise.ts
FROM=experiments/results/112b-opus-reviewer.json ALSO=experiments/results/112-reviewer-noise.json \
  node experiments/112-reviewer-noise/count.ts
```

- Needs `CLAUDE_CODE_OAUTH_TOKEN`. Writes to no real repository.
- `node experiments/112b-opus-reviewer/read.ts` keeps the hand-read classes
  under `read`; `SHOW=1` prints what is drawn.
- Results: `results/112b-opus-reviewer.json` (runs, count, read) and
  `results/112b-pilot.json` (not counted).
