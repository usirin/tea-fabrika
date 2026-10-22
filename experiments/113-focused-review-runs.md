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
