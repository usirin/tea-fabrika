# 84. Can a cheap reader judge a stall?

A design for the build and review loop: a **stall** is a round where the list
of open findings did not get shorter. Code sees that for free. On a stall the
builder says either "I'll try a different way" (one more round) or "I can't
meet this as written" (it goes to the owner). A second stall in a row goes to
the owner anyway.

Two narrow calls could back the builder's word. Can Jev make them, in place of
an agent?

1. **Same or different.** Is round N+1's change a different approach from round
   N's, or a repeat?
2. **Stall kind.** The builder is stuck on a fixable problem, the criterion is
   wrong or impossible, the reviewer is wrong or moved the goalposts, or a
   cause outside the change (CI, a flake, the base branch).

**Answer, call 1: no, for any reader. "Different" does not predict that the
next round is shorter. 83% of "different" steps got shorter, and so did 83% of
all steps. Real repeats almost never happen. Confidence 85%.**

**Answer, call 2: no, for Jev. It says "builder stuck" for nearly everything,
and agrees with Claude on 50% (kappa 0.17). Claude does better (12 of 16 against
my reading), but the four kinds miss the most common stall: a real finding the
first review could have raised. Confidence 80%.**

## Who did what

| Part | Whose |
|---|---|
| Every review, verdict and repair | today's fabrika, on [kamp-us/phoenix](https://github.com/kamp-us/phoenix) |
| The 106 stalls and the list counts | tea-fabrika, experiment 58's replay (`results/shrinking-list-replay.json`) |
| Rebuilding the rounds, the case texts, the two calls, the tables (`84-stall-reader.ts`) | tea-fabrika, new here; `listOf` added to `lib/review-rounds.ts` |
| The first reading | Jev, with the answers as fixed choices |
| The second reading | Claude (`claude-sonnet-5-5`) through the Agent SDK, no tools, the same choices |
| The 19 hand readings (`84-readings.json`) | a reader, for this experiment |

No lane ran. Nothing was written to GitHub. Git was used read-only, on a local
clone.

## How it was done

**The stalls.** Experiment 58 walked 525 review loops. Of 682 steps from a
failed round, 75 kept the same length and 31 grew: 106 stalls in 84 loops. The
script rebuilds each round's list with 58's own rule and checks every length
against 58's. All 106 match.

**What each reader saw.** For call 2: the ticket, the list before, the change
the builder made, and the list after. For call 1: the list before, the first
change, the list that stayed, and the second change. Changes come from
`git diff` between the reviewed heads. Inputs are cut to fit: 10,000
characters of diff, 2,500 per file, 1,200 per finding, 2,500 of ticket.
Lockfiles and snapshots are dropped.

**Who was asked what.** Call 2 was asked where the first change exists (101 of
106). Call 1 was asked where both changes are real diffs (86). Jev answered all
of them. Claude answered all 86 of call 1 and 58 of call 2: 3 chosen by hand to
start, then a fixed shuffle (seed 84), stopped at the $5 limit.

**The hand sample.** 19 cases, drawn with fixed seeds to hit the weak spots: 5
with 3 or more findings, 5 with a long change, 5 where the readers split on
kind, 3 where they split on call 1, and 3 where the next round was not
shorter. It leans hard toward disagreements, so its agreement numbers are not
the population's.

## The numbers

**Call 1, against what happened next.** 98 stalls have a next round; 81 of them
got shorter or passed (83%).

| Reader | Says different | Of those, next shorter | Says repeat | Of those, next shorter |
|---|---|---|---|---|
| Jev | 84 | 70 (83%) | 2 | 2 |
| Claude | 83 | 69 (83%) | 3 | 3 |
| By hand | 18 | 13 (72%) | 1 | 1 |

Not one "repeat" caught a step that stayed stuck. Every repeat got shorter.

**Call 2, by reader.**

| Kind | Jev (all 101) | Jev (Claude's 58) | Claude (58) | By hand (19) |
|---|---|---|---|---|
| builder_stuck | 92 | 52 | 25 | 10 |
| criterion_wrong | 0 | 0 | 0 | 0 |
| reviewer_wrong | 0 | 0 | 27 | 6 |
| outside | 9 | 6 | 6 | 3 |

At a 0.8 cut Jev says builder_stuck 80, outside 5, unsure 16. Of Claude's 27
reviewer_wrong, Jev called all 27 builder_stuck.

**Agreement.** Kappa near zero on call 1 means nothing here: almost every answer
is "different".

| Call | Jev and Claude | Jev and hand | Claude and hand |
|---|---|---|---|
| same | 83 of 86 (97%) | 17 of 19 | 18 of 19 |
| kind | 29 of 58 (50%), kappa 0.17 | 11 of 19 (58%), kappa 0.15 | 12 of 16 (75%), kappa 0.61 |

On kind, Jev and Claude agree 44% on stalls with 1 or 2 findings, 65% with 3 or
more, and 49% when the change was cut to fit.

**Cost and time per call.**

| Reader | Calls | In all | A call | Median seconds |
|---|---|---|---|---|
| Jev | 187 | $0.029 | $0.00015 | 0.11 |
| Claude | 144 | $4.97 | $0.0345 | 3.9 |

Jev is about 230 times cheaper and 35 times faster.

## What it found

- **Call 1 asks the wrong question.** A repeat is rare: 2 or 3 in 86, and each
  of those passed or got shorter next. In one hand case the second change was
  the same edit on the one file the first missed, and it passed. In another,
  the second change was a truly new approach and the loop still stalled. Code
  already sees the one useful case: no new commit between rounds (5 next tries
  had none).
- **Most stalls end next round anyway.** 83% get shorter. The "second stall
  goes to the owner" rule alone catches the 17% that do not, with no call.
- **Jev cannot tell the kinds apart.** It folds the reviewer side into
  builder_stuck. Its outside calls are mostly right (5 of 6 match Claude).
- **The four kinds miss the common case.** 4 of my 6 reviewer_wrong are real
  defects in text the first review saw and did not raise. They are "moved
  goalposts" only by the question's wording. The builder should just fix them;
  sending them to the owner would be wrong. The other 2 are a criterion the
  reviewer added mid-loop and a reviewer correcting its own round-1 framing.
  Without a "late finding" kind, Claude's 27 reviewer_wrong would send a quarter
  of all stalls to the owner for nothing.
- **criterion_wrong never came up.** No reader chose it once, in 106 stalls.
- **Claude leans to reviewer_wrong.** All 4 of my disagreements with it are
  reviewer_wrong where I read builder_stuck (3) or outside (1). In the 3, the
  new finding sat on lines the builder had just written, or on the half of
  round 1's ask it had not done. Experiment 54's splitter sometimes leaves a
  list that is only headings; one of the 3 had such a list, and only the full
  verdict settled it.

## What this cannot tell

- One reader graded 19 cases, chosen for disagreement. A second reader would
  shift the kind numbers.
- Claude read 58 of 101 for kind. The rest are Jev only.
- The cut diffs hide part of the change in 61 of 97 cases. A reader that could
  open files might do better at kind; it would also cost what an agent costs.
- The record is one repo's loops under today's fabrika, where the builder never
  had to answer "different or can't".

## What to do with it

Drop call 1. Code checks "was there a new commit", and the second-stall rule
does the rest. If call 2 stays, give it a fifth kind, "late finding: real,
first review could have raised it", that routes back to the builder, and give
the reader the full verdict text, not the split headings. Then test Jev again
on that set before trusting it with routing.
