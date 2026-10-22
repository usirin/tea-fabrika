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

**Answer: not run yet.**

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

## Run it

```sh
MODELS=opus EFFORT=medium BUDGET=2 OUT=112b-opus-reviewer node experiments/112-reviewer-noise.ts
FROM=experiments/results/112b-opus-reviewer.json ALSO=experiments/results/112-reviewer-noise.json \
  node experiments/112-reviewer-noise/count.ts
```

- Needs `CLAUDE_CODE_OAUTH_TOKEN`. Writes to no real repository.
