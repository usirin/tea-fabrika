# 113. Focused review runs

The question: in 112b, opus flipped 21 cells between pass and fail, and each
flip was a real defect that opus saw in some runs and missed in others. So
what if we run the reviewer three times on one commit, give each run a
different focus, and count a row as failed when any run fails it? Do we
catch more of the real defects? And how often do we fail rows that should
pass?

- No lane and no builder. 112's heads and books, 112's review path.
- Each pair and kind of review is judged by a **trio**: three opus runs at
  effort medium, each with its own focus added to its prompt.
- The three forms are joined: a row fails if any run fails it.
- Compared against 112b's single opus runs and 112's sonnet runs, which are
  reused as they are.

**Answer: no, not by the pre-written rule. A trio caught 15 of the 21 known
defects on average (15, 13, 17 in three trios), under the bar of 18. Its
fails are almost all real (1 false in 135), and it costs 3.5 times one opus
review, so the other two bars hold. But it is not steadier: two trios
disagree on 11.5% of cells, one opus run against another on 9.8%.**

- Caught, of the 21 known defects:
  - a trio: 15 on average; 19 caught by at least one of the three trios; 12
    by all three. Two were never caught.
  - one run of each focus alone: A (bug sweep) 12.3, C (across files) 9.7,
    B (riskiest way) 8.3. One plain opus run in 112b: 9.2. One sonnet run:
    2.2.
  - so the trio's 15 is about what three plain runs would give if they were
    independent (15.5), and below the biased ceiling taken from 112b's own
    runs (17.3). The focuses did not beat plain repeats on these cells.
- New fails: 30 joined fails on 18 cells opus never failed steadily or
  flipped on in 112b. Read against the code, 29 are real.
  - Five defects that 112b's 60 opus runs named once between them, or never:
    cycles through devDependencies are not seen; two rows with one target
    pass the checks and the second rename overwrites the first (named once);
    a `..` path or an absolute path is put in the wrong package (two small
    cases); and a lockfile link is skipped when the name already sits in
    another section. 112's haiku and sonnet runs had named the first four,
    2 or 3 times each in 116 runs. No earlier run named the lockfile one.
  - The rest are 112b's known defects (bare-name importers, a partial
    write) failed on other criteria of the same book.
  - The one false fail: "no test that used the old function form was
    changed". The base had no test at all; at the head every test passes an
    Env.
- False fails: 1 of 135 joined fails (0.7%), 1 of the 30 new ones (3.3%).
- Findings of its own (new criteria) went up: 29 in 90 runs, about 1 a
  trio, against 9 in 60 for plain opus. 22 came from focus C. Of 20 drawn,
  17 are real defects and 3 are README claims. Plain opus's 9 held 1 defect.
- Steadiness: two-look disagreement of the joined grade 11.5% (pass/fail
  only 10.4%). One opus run: 9.8% (7.7%). One sonnet run: 4.5% (2.7%). So a
  trio is not steadier. A whole trio missed the "no CLI exists" cells (c1,
  c16 at p4-t1-741c, task review) in trio 2, after all three runs caught
  them in trio 1.
- Cost: $0.708 a trio, 3.47 times a single opus review ($0.204). The first
  trio, with nothing cached, cost $0.826 (4.05 times). Time: 89 s when the
  three run at once, 202 s one after another (one opus run: 59 s).

Confidence 75% that the trio, as built here, does not catch the cells that
flip much better than three plain runs would: 3 trios, 21 cells, one ticket.
65% that focus A, alone, catches more than a plain run (12.3 against a 9.2
that is biased up): it was not checked against fresh plain runs. 80% that
focus C is what makes findings of real defects; the drawn 20 say so.

## The reading rule (written before any counted run)

### Words

112's words hold: a pair, a group, a cell, a flip. See
[112](./112-reviewer-noise.md#words). And 112b's: a fail, a real finding. See
[112b](./112b-opus-reviewer.md#words). More:

- **A focus** is a few sentences added to a run's prompt, after the way of
  working: what that run spends most of its reading on. The run still does
  the whole review and fills the whole form. The three, written before any
  run (`113-focused-review-runs/focuses.ts`):
  - **A, a broad bug sweep**: every changed file, line by line, against the
    criteria.
  - **B, the riskiest way**: for each criterion, the one way it is most
    likely to be false, checked in the code.
  - **C, across files and security**: follow each change out of the diff
    into callers and files that depend on it; callers left behind, two
    places that disagree, a write that stops half way, trusted input.
- **A trio** is one run of each focus on one pair and one kind of review.
  **Trio k** is the k-th trio of every group.
- **The joined grade** of a cell in a trio: `fail` if any of the three runs
  fails it; else `none` if any run has it unseen or has no row; else `pass`.
  A row passes only if every run passed it.
- **The joined verdict** of a trio: passed if all three runs passed.
- **The known defects** are the 21 cells where opus, in 112b, went between
  pass and fail. 112b read every one against the code and each names a real
  defect. A known defect is **caught** by a trio when its joined grade is
  `fail`.
- **The steady fails** are the 20 cells opus failed in all 5 runs in 112b:
  tasks not built yet at that head, a plan whose tasks contradict, a CLI
  that does not exist.
- **A new fail** is a joined fail on a cell that is neither a known defect
  nor a steady fail.
- **A false fail** is a joined fail where no run's fault on that cell names
  something really wrong in the code at the head, under the criterion's
  words or outside them. Read by hand against the code.
- **Two-look disagreement**: take two looks at the same cell (two trios, or
  two single runs). The share of cells whose grade differs between the two,
  averaged over every pair of looks. With two trios it is 112's flip rate.
  It lets a trio, a single opus run and a single sonnet run be compared,
  whatever their number of runs.

### What we already know (from 112 and 112b, no new runs)

- One opus run catches 9.2 of the 21 known defects on average. One sonnet
  run catches 2.2.
- If runs were independent, three plain opus runs joined would catch about
  15.5 of 21. That guess is high: the 21 cells were picked because opus
  failed each of them at least once, so their fail rates are overestimated.
- One opus review costs $0.204 and takes 59 s (112b).

### What each result means

1. **Does a trio catch more?** The mean, over the counted trios, of known
   defects caught.
   - Also: caught in every trio, caught in at least one, and the same for a
     single run of each focus, so we see which focus pulls its weight.
   - Also: the same count for every set of 3 of 112b's 5 plain opus runs.
     That number is biased up (the 21 were picked from those runs), and is
     shown as a ceiling for "three plain runs", not a fair control.
2. **New defects.** Every new fail is read by hand against the code at its
   head. Each is called **real** (the fault is true, inside or outside the
   criterion's words) or **false**.
3. **False fails.** The false-fail share is false fails / all joined fails,
   over every cell of every counted trio.
   - Known defects and steady fails count as real, but are checked: 10
     joined fails on known defects, drawn with 112's seed, have their faults
     read. And one joined fail per steady-fail cell has its fault read. If a
     fault read there is false, every fault on that set is read, and the
     false ones count as false.
   - Also given: the false-fail share among new fails alone.
4. **How much does the joined verdict move?** Two-look disagreement of the
   joined grade over all cells, against a single opus run's and a single
   sonnet run's (from 112b's and 112's runs). Pass/fail flips only too. And
   per group, whether the joined verdict agrees across trios.
   - A trio is **steadier than one opus run** if its two-look disagreement is
     at most two thirds of one opus run's.
5. **Findings of their own** (new criteria). Per trio, and every one read
   (up to 20, else 20 drawn with 112's seed), in 112's classes.
6. **Cost and time.** Per trio: the three runs' cost added, and the three
   runs' time both added (one after another) and as the longest of the three
   (all at once).

### The pass rule

Focused review runs **pass** if all three hold:

- a trio catches **at least 18 of the 21** known defects, on average over
  the counted trios;
- at most **10% of its joined fails are false**;
- a trio costs at most **4 times a single opus review**, so $0.816 or less
  on average.

Why these bars. 18 of 21 is well above the 15.5 guessed for three plain
runs, and that guess is already high. So passing the bar means the focuses
add something that plain repeats would not. 10% false keeps a lane from
sending the builder after made-up faults often. 4 times leaves room for
focused runs to read more than a plain one, but not for a review that costs
a builder round.

The flip rate is not in the pass rule. A joined grade can be steady and
wrong, as sonnet was in 112b. It is reported, and read by point 4.

### What runs

- The five pairs 112b counted, both kinds, three focuses: 30 runs a trio.
- At least 2 trios. A third runs if the money allows, trio by trio, so the
  cap cuts the last trio, never the first two.
- A trio counts only if it is whole in all 10 groups. A part trio is shown,
  not counted.
- The single runs compared against are 112b's opus runs and 112's sonnet
  runs, on the same pairs. Nothing of theirs is run again.
- Opus at effort medium, as 112b. **Budget $1 a run**, not 112b's $2: the
  dearest of 112b's 62 opus runs cost $0.56. A lower budget keeps less money
  aside per run in flight, so 6 can run at once under the cap. A run that
  hits $1 ends with no form, and is counted as such (its rows are `none`)
  and named in the write-up.

### Spend

- Hard cap $25, the pilot included.
- The runner keeps each in-flight run's whole budget aside, as 112b's does,
  so the cap holds whatever a run costs.
- A pilot of 3 runs (one trio, p2-t2-f590, task review), not counted, kept
  in `results/113-pilot.json`, sizes the spend and checks that the focus
  reaches the prompt.

## How it ran

- **The focus option.** `promptOf` in
  `packages/fabrika/src/pipeline/stages/review/reviewer.ts` takes an
  optional focus, and `liveReviewer` takes it in its config (`focus`). With
  a focus, the prompt gets a "Your focus for this run" section after "How to
  work" and before the criteria. With none, the prompt is the same text as
  before, and a test holds that. The review machine is not changed. A stage
  that wants several focused runs runs one review per focus, each with its
  own reviewer, and joins their forms.
- **The runner** is `113-focused-review-runs.ts`: 112's review path, with
  one reviewer per focus. Trio by trio, pair by pair, the six runs of a pair
  (two kinds, three focuses) at once.
- **The count** is `113-focused-review-runs/count.ts`. It reads 112b's opus
  runs and 112's sonnet runs to compare, and keeps the hand reads by key.
- **Three trios ran**, all whole: 90 runs. The money allowed the third.
- No run came near its $1 budget (the dearest cost $0.61). One run ended
  `stuck:unseen` (a review outcome: it could not see c5); its rows are kept.

### Where it went off the plan

- **Cost per trio fell trio by trio**: $8.26, $6.94, $6.04 for 30 runs. The
  same prompt run again later is partly cached. 112b's single runs had the
  same help (5 repeats of one prompt, 4 at a time). A lane reviews a new
  head each time, so the first trio's $0.826 is the fairer price.
- **The pilot's runs cost $0.26 each**, more than 112b's $0.204. Trio 1
  came in at $0.28 a run. The cost bar was left as written.

## Results, by the rule

| Point | Result | Reading |
|---|---|---|
| 1. Catches more? | 15.0 of 21 a trio (15, 13, 17); 19 in any trio, 12 in all | under 18 |
| 1. Per focus, one run | A 12.3, C 9.7, B 8.3; plain opus 9.2; sonnet 2.2 | A is the strong one |
| 1. Three plain runs (biased ceiling) | 17.3 (lowest set 15) | the trio is not above it |
| 2. New defects | 30 new joined fails on 18 cells; 29 real | 5 defects 112b's opus barely or never named |
| 3. False fails | 1 of 135 (0.7%); 1 of 30 new (3.3%) | under 10% |
| 3. Checks on the rest | 10 known drawn: 10 real; 20 steady: 20 real | none false |
| 4. Steadier? | two looks differ on 11.5% (pass/fail 10.4%); one opus run 9.8% (7.7%); one sonnet run 4.5% (2.7%) | not steadier |
| 4. Joined verdict | agrees across trios in 9 of 10 groups | most groups fail every time |
| 5. Findings | 29 in 30 trios (0.97 a trio); A 6, B 1, C 22 | 20 drawn: 17 defect, 3 docs |
| 6. Cost | $0.708 a trio, 3.47 times one opus review; first trio $0.826 (4.05 times) | under 4 times, but only with a warm cache |
| 6. Time | 89 s at once, 202 s one after another; one opus run 59 s | |
| **Pass rule** | caught 15 < 18; false 0.7% ≤ 10%; cost 3.47 ≤ 4 | **fails** on the first bar |

Three of the 30 new fails read as real are small cases (a `..` path, an
absolute path, a name already in another lockfile section). Called false,
the false share would be 3.0%, still under 10%.

## What the trios caught

Per known defect: the focuses that failed it in trio 1 / 2 / 3, and opus's
5 plain grades in 112b (f fail, p pass, n none).

| Cell | Trios | 112b |
|---|---|---|
| p2-t2-f590 task c6 | ABC / ABC / ABC | ffpff |
| p2-t2-f590 task c17 | BC / ABC / AB | ppfff |
| p2-t2-f590 last c5 | B / - / - | fpppp |
| p2-t2-f590 last c6 | - / - / ABC | fppfp |
| p2-t2-f590 last c17 | B / A / AC | fppfp |
| p3-t2-9698 task c7 | - / - / C | ppppf |
| p3-t2-9698 task c13 | AB / A / A | ffffp |
| p3-t2-9698 last c13 | AC / B / - | ffppp |
| p3-t2-9698 last c20 | - / - / C | pppfp |
| p3-t1-5148 last c13 | ABC / AC / ABC | fnpff |
| p4-t2-23bb task c3 | ABC / AC / ABC | pfpfp |
| p4-t2-23bb task c13 | ABC / BC / ABC | ffffp |
| p4-t2-23bb last c2 | - / - / - | fpppp |
| p4-t2-23bb last c3 | AC / A / A | pffpp |
| p4-t2-23bb last c8 | - / - / - | ppfpp |
| p4-t2-23bb last c9 | ABC / AB / AC | fffpf |
| p4-t2-23bb last c13 | AC / C / AB | ffppf |
| p4-t1-741c task c1 | ABC / - / AC | ppppf |
| p4-t1-741c task c16 | ABC / A / AC | ppppf |
| p4-t1-741c last c1 | - / - / AB | pppfp |
| p4-t1-741c last c16 | A / AC / AB | ppfff |

- Cells opus caught often in 112b, the trio catches every time (c6, c13 and
  c9 above).
- Cells opus caught once in 5, the trio still mostly misses: 8 such cells,
  caught in 9 of 24 trio looks.
- The trio moves as a block. At p4-t1-741c's task review, "there is no
  `move apply` command" was failed by all three runs in trio 1 and by none
  in trio 2. The three runs of one trio are not independent: they read the
  same brief at the same head, and the focus changes less than hoped.

## New fails

Read against the code at each head (`READ` in the count):

- **Cycles through devDependencies** (p2-t2-f590 c7, p3-t2-9698 c10): the
  dependency graph is built from `dependencies` only. Real; failed in every
  trio at both heads.
- **Two rows with one target** (p3-t2-9698 c4, c5, c14): the checks look at
  each row against the disk, never at the rows against each other. The
  second rename overwrites the first file, after importers, manifests and
  the lockfile were written.
- **Paths not kept to the workspace** (p2-t2-f590 c9, p3-t1-5148 c1): a
  `packages/a/../b/x.ts` target counts as package a; an absolute path counts
  as no package. Real, small: a plan is not usually written that way.
- **A lockfile link skipped** (p3-t2-9698 c12): if the target's name is
  already in another section of the importer block, the link is not added,
  but the manifest still gains it. Real, small.
- **The same-package loop** (p4-t1-741c c2): it renames with no check
  first, so it can stop half way or overwrite. True, outside c2's words
  ("as before", and before, apply did nothing).
- **Known defects on other rows** (f590 last c14; 9698 c5, c7, c14): the
  partial write and the bare-name importers of 112b, failed on the book's
  wide criteria.
- **Task 2 not built yet** (p3-t1-5148 last c9, c11): real, as the words
  say; plain opus had graded them unseen or passed some runs.
- **The false one** (p2-t2-f590 task c18, trio 1, focus B): "no test that
  called apply in its function form was changed". The base had no test; at
  the head every test passes an Env, which is what c18 asks.

## Findings

- 29 in 90 runs. By focus: C 22, A 6, B 1. Plain opus made 9 in 60 in
  112b, and 1 of them was a defect.
- 20 drawn with 112's seed and read:
  - **defect** (17): rows not checked against each other or the disk before
    the first rename (9); third-package importers get no dependency on the
    target (2); a same-package move edits a manifest and the lockfile step
    is skipped (2); missing tests for bare-name importers and unquoted
    lockfile entries (3, tests of real breakages); `addDependency` returns
    quietly when it cannot find the package (1).
  - **docs** (3): the README says every importer is rewritten.
- Focus C ("follow each change out of the diff ... a write that can stop
  half way") is where they come from. It turns real defects outside the
  criteria into new criteria, which is the path 112 found quiet.

## Proposals (not built here)

- **Do not ship the trio as a way to stop flips.** It catches what plain
  repeats would, flips as much as one run, and costs 3.5 to 4 times. The
  flipping cells need something else: a fail with a named fault kept across
  rounds (112b's proposal), or a check the code host runs.
- **Try focus A as the one reviewer's default.** One run of A caught 12.3 of
  21, against 9.2 for a plain run, at the same cost ($0.21). That needs a
  fair test first: fresh plain runs next to fresh A runs, on fresh cells.
- **Try focus C as a second, finding-only run.** It made 22 of 29 findings,
  most of them real defects outside the criteria. One plain or A run for the
  rows, plus one C run for findings, is 2 times the cost, not 3.
- **Put the focus at the end of the prompt** if several focused runs are
  kept. Here it sits before the criteria and the diff, so the three prompts
  share almost nothing a cache could reuse.

## Holes

- **The 21 cells were picked from 112b's runs.** Single opus's 9.2 and the
  "three plain runs" 17.3 come from the same runs that picked the cells, so
  both are high. The trio and the focus runs are fresh. A fair plain
  baseline needs fresh plain runs; none were run, to stay under the cap.
- **One ticket, 5 heads**, as 112 and 112b. The focuses were written for
  code with many edge cases; a ticket with fewer may differ.
- **One reader, no second check**, as 112b. The three "small" new fails
  could be called scope, not defects.
- **Budget $1 a run against 112b's $2.** No run came near it, so it did not
  change a run.
- **Cache.** Later trios were cheaper than the first. The single opus price
  ($0.204) had the same help. The cold first trio is 4.05 times.
- **Three trios.** The two-look rate is from 3 pairs of looks; about ±3
  points.

## Spend

| Run | Reviews | Spent |
|---|---|---|
| pilot (not counted) | 3 | $0.771 |
| trio 1 | 30 | $8.261 |
| trio 2 | 30 | $6.942 |
| trio 3 | 30 | $6.041 |
| total | 93 | $22.014 |

Under the $25 cap. 112b's and 112's runs are reused and cost nothing new.

## Run it

```sh
TRIOS=3 CAP_USD=24.2 CONCURRENCY=6 node experiments/113-focused-review-runs.ts
node experiments/113-focused-review-runs/count.ts
```

- Needs `CLAUDE_CODE_OAUTH_TOKEN`. Writes to no real repository.
- `BUDGET=1` (a run's most), `FOCUS=A,B,C`, `KINDS=task,last`,
  `PAIRS=<ids>`, `OUT=<name>` (the pilot: `OUT=113-pilot PAIRS=p2-t2-f590
  KINDS=task TRIOS=1`).
- A stopped run goes on where it left off: runs already in the results are
  skipped.
- `SHOW=1` on the count prints every fail to read and the findings drawn.
- Results: `results/113-focused-review-runs.json` (runs, count) and
  `results/113-pilot.json` (not counted).
