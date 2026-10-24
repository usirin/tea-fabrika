# 135. Are triage's weak scores the model's?

The question: every accuracy test of triage (the step the code still calls
`sort`, in `packages/pipeline/src/stages/sort/`) used `sonnet` at the SDK's
default effort: experiments 88, 92, 92b and 133. Nobody tried a bigger model.
And the built machine (experiment 111) runs `haiku` at low effort, which was
never scored at all. So are the weak spots the model's, and is the machine's
haiku good enough?

**Answer: not yet run. This section is filled in after the run.**

## Before the run: what would mean what

Written before any paid call, so the reading cannot bend to the result.

### The weak spots, and what is measured

| Weak spot | Cases | Answers per model |
|---|---|---|
| "No" on phoenix (92b) | the 29 real no's 92b's brief missed at least once, split as 92b's reader split them: the text shows it (18), a line the bar does not draw (9), needs the code (2) | 58 |
| Wrong "no" on built work (92b) | the 5 built tickets 92b's brief said no or duplicate to | 10 |
| Fold (133) | 13 real folds, kept in two groups: 4 later reports and 9 batch siblings; 13 controls | 52 |
| Route (88) | the 6 tickets with a route miss (ruling against plan, mostly), plus 88's 5 other misses | 22 |
| Keep right | 6 phoenix no's 92b caught both times, 5 phoenix built tickets and 5 demlik yeses sonnet always got right | 32 |

- Every case is sorted twice per model. Only the model and the effort change.
- **Wrong "no" on good work** is counted on every ticket that was really
  built or ruled: a no, or a duplicate that is not a fold's own target.

### The reading

- **The model is the cause** of a weak spot when opus gets right at least
  half the answers sonnet got wrong there, and opus does not say "no" to good
  work more often than sonnet.
  - Why: same brief, same input. If a bigger model gets it, the brief and the
    input were enough, and the smaller model could not use them.
  - Why half: that is far above the wobble between two runs of one model. In
    92b, 9 of 79 tickets split between runs (11%); in 133, 4 of 26 (15%).
- **The model is not the cause** when opus's gain on the misses is within that
  wobble (under about 15% of the answers), or when it closes more real no's
  only by also closing built work as often. The second is a looser hand on
  the same rule, not a better reading. Then the fix is the brief, the input
  (the code) or the design.
- **In between is "partly"**, and the write-up says by how much.
- **Two groups no model should win:** "needs the code" (2 tickets) and the 9
  batch folds. In today's design a batch sibling's target is not yet a plan
  when the sibling is sorted, so a fold there is not possible at all (133). In
  this replay the target is listed as a plan, so a model can fold. A model
  that wins there is read as luck or a looser hand, and checked against its
  wrong no's.
- **The machine's haiku is good enough for triage** when, on the same cases,
  it says "no" to good work no more often than sonnet, keeps the keep-right
  set as sonnet does, and is no worse on each weak spot by more than the
  wobble. It is not good enough if it closes built work more often or loses
  routes sonnet keeps.

### The baseline, and its bias

- **The misses were picked because sonnet missed them.** So sonnet's saved
  score on them is low by choice. A new sonnet run would get some right by
  chance, and so would any model. That is why opus must clear half, not just
  beat sonnet.
- **Sonnet's saved answers are used where the brief has not changed** (92b's
  "both" brief for phoenix, 133's for fold), with a fresh sonnet run on a few
  of them to check they still hold.
- **Sonnet is run again on 88's tickets**, because today's brief is not 88's.

## Run it

```
STEP=fetch GROUP=p|d node experiments/135-triage-models.ts            # first versions and issue lists, through gh, read-only
STEP=sort CONFIG=haiku-low|sonnet|opus|opus-high GROUP=p|d node experiments/135-triage-models.ts
                                                                      # SET=misses|controls|keep|all, ONLY=, RUNS=2, CONCURRENCY=3, DRY=1, PROMPT=1, MAX_USD=3
node experiments/135-triage-models.ts                                 # the tables; WHY=1 adds each answer's why, EACH=0 drops the per-ticket lines
STEP=field node experiments/135-triage-models.ts                      # field/runs.jsonl rows
```
