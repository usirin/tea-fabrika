# 135. Are triage's weak scores the model's?

The question: every accuracy test of triage (the step the code still calls
`sort`, in `packages/pipeline/src/stages/sort/`) used `sonnet` at the SDK's
default effort: experiments 88, 92, 92b and 133. Nobody tried a bigger model.
And the built machine (experiment 111) runs `haiku` at low effort, which was
never scored at all. So are the weak spots the model's, and is the machine's
haiku good enough?

**Answer: partly. The missed "no" on phoenix is the model's. Fold and route
are not.**

- **"No" on phoenix (92b's brief):** on the 29 real no's sonnet had missed,
  opus closed 32 of 58 answers. Sonnet closed 6, and the machine's haiku 18.
  Opus did not say "no" to built work more often: 8 of 20 answers on 10 built
  tickets, the same as sonnet, and none on demlik. The built tickets it still
  closes fit the bar's written words, so those are the bar's, not the model's.
- **Fold (133):** opus right 5 of 26 times, sonnet 2. That gain is inside the
  wobble between two runs of one model. On the 4 later reports, all three
  models gave the same wrong answer every time. Fold was dropped from triage
  the same day; this backs that.
- **Route (88's misses):** opus right 0 of 12 times, sonnet 3, haiku 5. The
  three models mostly agree with each other and disagree with 88's answer key.
- **Haiku at low effort is not good enough, by the bar written before the
  run.** It folded 10 of 26 answers on tickets that had a plan of their own
  (sonnet 1), and let 4 of 12 answers go on real no's sonnet always closed. It
  is level with sonnet on "no" to good work (9 of 94 answers, sonnet 8 of 72),
  as fast, and about 14 times cheaper a ticket. Both of its fails sit on
  things today's machine does not do: fold is gone, and today's bar has no
  "hardening" or "churn" rule.
- **Confidence:** 75% that the missed "no" is the model's (one repo, a brief
  that is not today's, 10 built tickets). 80% that fold and route are not. 70%
  on haiku.
- **Cost:** $9.90 for 335 sorts, under a $10 cap. A ticket's first sort costs
  $0.004 on haiku, $0.06 on sonnet and $0.11 on opus.

## Who did what

- **The tickets, labels, closing comments, merged PRs and what really
  happened:** today's fabrika on kamp-us/phoenix and kamp-us/demlik, before
  this run. The answer keys are 88's, 92b's and 133's (`88-truth.json`,
  `92b-truth.json`, `133-truth.json`), unchanged.
- **The pick of cases:** this run, from those keys and the saved sonnet
  answers, with a seeded draw (seed 135) for the keep-right tickets, before
  any new answer was seen.
- **Sort on phoenix (group p):** 92b's "both" brief from `lib/sort.ts` and
  `lib/sort-bar.ts`, one call, no tools. `sortOnce` gained an optional effort,
  sent only when given.
- **Sort on demlik (group d):** this repo's sort stage, run outside its
  machine, as in 133: `promptFor` and `sortProblems` (`brief.ts`), `SortReply`
  (`answer.ts`), `sorterOptions` (`sorter.ts`) with its effort swapped for the
  model's, and `nextTry` (`combos.ts`) for a second try.
- **The models:** Claude through the Agent SDK (0.3.296), signed in with the
  SDK's own login, `TYPESAFE_API_KEY` unset. The aliases resolved to
  `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5`.
- **The script:** `135-triage-models.ts`.
- **Nothing was written to GitHub.** Every read went through `gh`, read-only.
  No lane ran.

## How it was done

```ts
// The only thing that changes between runs: the model and the effort.
const CONFIGS = {
	"haiku-low": { model: "haiku", effort: "low" },      // what the built machine runs (111)
	sonnet:      { model: "sonnet", effort: undefined },  // the baseline; no effort is sent
	opus:        { model: "opus", effort: undefined },
	"opus-high": { model: "opus", effort: "high" },      // only if the money allowed; it did not
};

// Group p, phoenix: 92b's brief, one call. (Simplified.)
const prompt = promptOf(ticket, ticket.body, earlier, P_BAR, PHOENIX_NOTE); // drafted bar + 3 written clauses
const run = await sortOnce(n, prompt, cwd, c.model, c.effort);

// Group d, demlik: today's brief and Check, 133's world, up to two tries. (Simplified.)
const reply = await call(promptFor(brief, null), {...sorterOptions(settings, cwd), effort: c.effort});
sortProblems(reply, brief); // [] passes; else one more try, told what the Check found
```

- **Why two briefs.** Today's bar (`bar.ts`) has seven ways a ticket is a
  "no". The written clauses 92b closed these tickets with ("hardening with no
  incident", "churn on our own output") are not among them. Under today's brief, phoenix's
  real no's are not a "no" on any model. 92b's "both" brief is the one sort
  missed them under, so group p uses it. Group d uses today's brief.
- **The cases** are in the table below. The keep-right tickets are a seeded
  draw: phoenix built tickets 92b got right both times (2281, 3788, 8010,
  8147, 8944), and demlik yeses right in all six of 88's and 92's saved
  answers (68, 381, 657, 659, 693).
- **Saved sonnet answers** stand in for sonnet on phoenix (92b's "both" runs)
  and on 133's 26 tickets, where the brief has not changed. A fresh sonnet run
  on #8826 and #494 matched them in both runs. Sonnet ran again on 88's 11
  misses, since today's brief is not 88's.
- **Scoring** is as the plan below says. A fold on one of 88's yes tickets
  counts as its route (plan), since 88's key has no fold. This touches three
  answers: haiku's two folds of #657 into #635, and one of opus's.

### Cost, calls, and what was cut

- **Estimate, then 3 tickets per model, then the rest.** The first estimate
  was too low for opus, and that guess was wrong in two ways. It counted 4
  characters a token and missed about 4,500 tokens the SDK adds to each call.
  And the first sort of a ticket writes the prompt to the cache at about twice
  the input price; the second run of the same ticket reads it back for about
  a tenth. The script's estimate counts both now.
- **Spent: $9.90.** Haiku $0.51 (174 sorts), sonnet $0.86 (26), opus $8.53
  (135). 335 sorts, 335 calls: the Check passed every first answer on demlik,
  so no second try was needed. 4.74M tokens; the token count and the billed
  count are the same here, as in 133. The 142 saved sonnet answers cost $4.27
  when 92b and 133 ran them.
- **Every miss ran on all three models.** To stay under $10, these were cut,
  in this order:
  - opus at high effort;
  - opus on 133's 13 controls;
  - opus on the 6 phoenix no's sonnet always closed;
  - fresh sonnet on 88's 5 keep-right tickets;
  - the second opus run on demlik #693 (the cap stopped the step).
- **Why the controls went before keep-right:** the brief for this run said to
  cut keep-right last. And opus's fold gain was inside the wobble, so its
  controls could not change the reading on fold.
- One field row per sort in `field/runs.jsonl` (335), and note 2026-10-24-03.
- **One edit to the saved answers before publishing:** one product name was
  replaced with `‹product›` in 6 sorter answers (`why` on demlik #360 and #393
  once each, and #494 four times). Nothing else in the results file was
  changed.

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

## What came back

Right answers out of all answers, two runs a ticket. Rows marked "88" are a
fresh sonnet run on today's brief; the other sonnet answers are 92b's and
133's.

| Weak spot | sonnet | haiku, low | opus |
|---|---|---|---|
| No, the filer's text shows it (18 tickets) | 6/36 | 15/36 | 25/36 |
| No, on a line the bar does not draw (9) | 0/18 | 2/18 | 6/18 |
| No, needs the code (2) | 0/4 | 1/4 | 1/4 |
| No, sonnet closed both times in 92b (6) | 12/12 | 8/12 | not run |
| "No" to built phoenix work (10 tickets; fewer is better) | 8/20 | 9/20 | 8/20 |
| Fold, batch siblings (9) | 2/18 | 8/18 | 5/18 |
| Fold, later reports (4) | 0/8 | 0/8 | 0/8 |
| Fold where there was none: 133's controls (13; fewer is better) | 1/26 | 10/26 | not run |
| 88: route misses (6) | 3/12 | 5/12 | 0/12 |
| 88: other misses, 3 no's and 2 duplicates (5) | 0/10 | 0/10 | 0/10 |
| 88: keep-right routes (5) | not run | 9/10 | 9/9 |
| "No" to good work on demlik (fewer is better) | 0/66 | 0/74 | 0/47 |
| Same answer both runs (tickets) | 59/71 | 72/87 | 60/67 |

### The "no" on phoenix: the model

- **Opus closes most of what sonnet missed.** On the 29 missed tickets: opus
  32 of 58 answers, haiku 18, sonnet 6.
- **Against the plan:**
  - "The text shows it": opus right 25 of 36, sonnet 6. The gain (19
    answers) is more than half of sonnet's 30 misses. **The model is the
    cause.**
  - "A line the bar does not draw": opus 6 of 18, a third. Above the wobble,
    below half: **partly**.
  - "Needs the code": 1 of 4 for opus and haiku, the same ticket (#10139) in
    one run. Luck, as the plan said.
- **How opus reads it.** It names the clause and checks the ticket against
  it. Removing an unused re-export (#10128), one wrong clause in a docblock
  (#8338), and the wording of a figure in an ADR (#8577) all got "won't do:
  churn on our own output, no behavior change". 92b's sonnet called the same
  kind of ticket "a real bug" or "a real wrong doc".
- **It does not close more built work.** 8 of 20 answers, as sonnet. It
  kept #2563, an authorization gap sonnet closed both times. It called #2915
  a duplicate both times (92b's key: research).
- **Three built tickets are closed by every model.** #6457 and #7750 in all
  6 answers, #2792 in 5 of 6. All are agent-filed hardening: a regex that
  could backtrack, a cost never measured behind a flag that is off, tests for
  refusals that already work. Each fits "hardening with no incident" word for
  word, and triage built them anyway. That is the bar and the record
  disagreeing, not a model reading badly.
- **Opus is steadier here:** 3 of the 29 tickets split between its two runs;
  sonnet 6, haiku 7.
- **Haiku is a noisier reader, not a better one.** It closes more of the
  misses than sonnet (18 against 6), but let go two easy ones sonnet closed
  every time (#8524 and #10418, a plan in both runs). And it closed one built
  ticket sonnet kept (#8010, once).

### Fold: not the model

- **Opus 5 of 26, sonnet 2.** 3 more of 24 misses is 12.5%, inside the
  wobble.
- **The 4 later reports get the same wrong answer from every model, every
  run.** #444 folds into #397 (the target was #412), #717 into #715 (target
  #714), #494 is a duplicate of #493, #473 a plan of its own. Whatever is
  missing there, a bigger model does not bring it.
- **Batch siblings** are the group no model should win. Haiku wins most (8
  of 18), and it also folds 10 of 26 answers on the controls, where sonnet
  folds 1: a looser hand, not a better reading. Opus's 5 of 18 was not
  checked against the controls (cut).
- Fold was dropped from triage on 2026-10-24
  ([sort-answers-yes-or-no.md](../docs/direction/sort-answers-yes-or-no.md)).
  This run backs that: the fix was not a bigger model.

### Route on 88's misses: not the model

- **Opus does worst:** 0 of 12, sonnet 3, haiku 5. It gave #320 (a host asks
  to list saved runs under a store root; 88's key: ruling) a plan "with a
  lean". It sent #604 to a ruling because the ticket asks the maintainers
  where the work should live (88's key: plan).
- **The three models agree with each other.** On 5 of 88's 11 misses all six
  answers are the same; on 6, at least five are. #316, #295 and #633 fold into
  the open ticket they name, #615 is a plan of its own, #319 a ruling.
- **88's key is older than fold and today's brief.** With every open ticket
  listed as a plan, a fold is a fair reading of some of these. So some
  "misses" may be the key's.
- **88's other 5 misses** (3 real no's and 2 duplicates): no model got any.

### Is the machine's haiku good enough?

**Not by the bar written before the run.** Against sonnet on the same cases:

- **Where it fails the bar:**
  - Keep-right: it let go 4 of 12 answers on easy no's, and gave built
    tickets sonnet kept a "no" once (#8010) and research once (#3788).
  - Fold where there was none: 10 of 26 answers on the controls, sonnet 1.
- **Where it holds:**
  - "No" to good work: 9 of 94 answers, sonnet 8 of 72.
  - Route on 88's misses: 5 of 12, sonnet 3. 88's keep-right: 9 of 10.
  - The same answer both runs: 83%, as sonnet.
- **Both fails sit on things today's machine does not do.** Fold is dropped,
  and the closing clauses phoenix's no's need are not in today's bar. On what
  remains, this run does not show haiku doing worse than sonnet. That is a
  weaker claim than "good enough", and it rests on small sets: 11 route
  misses and 5 keep-right tickets.

### Cost and speed

| Model | $ a ticket (first sort) | $ a sort, both runs | Median seconds | Median tokens a sort |
|---|---|---|---|---|
| haiku, low | 0.0042 | 0.0029 | 4.3 | 12.6k |
| sonnet | 0.059 | 0.033 | 4.3 | 14.3k |
| opus | 0.111 | 0.063 | 6.9 | 12.4k |

- **The first sort is the price to plan with.** The machine sorts a ticket
  once, so it always pays the cache write. The second run here read it back.
- The sonnet row is the 26 fresh sorts, mostly on demlik. 92b's and 133's
  saved sonnet sorts were $0.030 each.

## What this means

1. **Keep fold out.** A bigger model does not fold better, and the later
   reports get one wrong answer from all three. Cost: none, it is decided.
   Confidence 85%.
2. **If the bar gets its closing clauses back, ask that question of opus,
   not sonnet or haiku.** Opus closed 32 of 58 missed answers where sonnet
   closed 6, with no more "no" to built work. Cost: about $0.11 a ticket,
   against $0.06 for sonnet and $0.004 for haiku. Confidence 70%. The doubt:
   one repo, 92b's brief rather than today's, and only 10 built tickets, 5 of
   them picked because sonnet closed them. What would settle it: the clauses
   written into today's bar, then opus and sonnet on 30 or more built tickets
   and the same missed no's.
3. **The three built tickets every model closes are an owner's question, not
   a model's.** Their text fits "hardening with no incident" as written. Either
   the clause is too wide, or those builds were not worth it. Cost: one
   ruling. Confidence 75%.
4. **Before more route work, check 88's key on its 11 misses against today's
   answers.** The models agree with each other and not with the key, and the
   key is older than fold. Cost: an hour of reading. Confidence 75%.
5. **Keep haiku at low effort for today's triage, for now.** It is 14 times
   cheaper than sonnet and as fast, and on what today's machine does, this run
   shows no loss. Confidence 60%. The doubt: the sets are small, and haiku
   failed the bar on both things it was asked that today's machine does not
   do. What would settle it: haiku and sonnet on all 66 of 88's yes tickets
   under today's brief, two runs each, about $0.40 for haiku and $4.50 for
   sonnet.

## What it cannot tell us

- **How today's machine does on phoenix.** Group p is 92b's brief. It shows
  how models read the written clauses, not how today's bar would sort these
  tickets.
- **Opus's false folds, and whether opus keeps the easy no's.** Opus did not
  run on the controls or on the 6 no's sonnet always closed.
- **What effort does.** Opus at high effort, sonnet at high effort and haiku
  at its own default were not run. Haiku's results mix the model and the low
  effort.
- **How much of opus's gain is luck from the pick.** The misses were picked
  because sonnet missed them, so any rerun would get some right. Only 2 of
  them were rerun on sonnet (both matched). Sonnet's two saved runs split on
  6 of the 29 phoenix tickets, so a rerun might gain a few answers; opus
  gained 26.
- **Wrong "no" rates on built work.** 10 built phoenix tickets is small, and
  5 were picked for being closed.
- **Whether 88's route misses are misses.** The key is older than fold.
- **Fold as the machine would see it.** The replay lists every open ticket as
  a plan, as 133 did. That is more than the machine has, and it gives every
  model, and haiku most, more to fold into.
- **Another day.** One SDK version, one set of aliases, one price list. The
  price of a ticket hangs on the SDK's cache.

## Run it

```
STEP=fetch GROUP=p|d node experiments/135-triage-models.ts            # first versions and issue lists, through gh, read-only
STEP=sort CONFIG=haiku-low|sonnet|opus|opus-high GROUP=p|d node experiments/135-triage-models.ts
                                                                      # SET=misses|controls|keep|all, ONLY=, RUNS=2, CONCURRENCY=3, DRY=1, PROMPT=1, MAX_USD=3
node experiments/135-triage-models.ts                                 # the tables; WHY=1 adds each answer's why, EACH=0 drops the per-ticket lines
STEP=field node experiments/135-triage-models.ts                      # field/runs.jsonl rows
```
