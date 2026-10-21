# 112. How noisy is the reviewer, on its own?

The question: in 105b the plan lane did not settle. The same code, judged
again, got a different grade 4 times in 7, and findings added 8 to 14
criteria a pass. Is the noise the model, the review prompt, or the criteria?
And which reviewer should the lane use?

- No lane and no builder. The commits 105b's passes left, each with the
  criteria book as it stood when the lane reviewed it.
- Each commit is judged 5 times by haiku and 5 times by sonnet, both as a
  task review and as a last review. The review path is the lane's own.

**Answer:** not run yet. This file holds the reading rule, written before any
counted run.

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
