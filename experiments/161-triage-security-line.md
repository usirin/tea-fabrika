# 161. Does one line fix GPT sol's closed security tickets?

The question: experiment 159 found GPT sol (through this repo's Codex adapter)
closes phoenix's real "no" tickets far better than opus. But it closed two
built security tickets in both runs, calling them "hardening with no incident",
and it folded 6 of 26 answers on experiment 133's demlik controls. Does one
plain line in the brief fix each, without costing closes?

**Answer: the security line works. The fold line half works and costs a right
fold, so leave it out.**

```ts
// The only change from experiment 159: one more "still a yes" clause in 92b's bar,
// and one more sentence after the demlik brief's fold rule.
const SECURITY = {
	rule: "A security gap is not hardening. A hole in who may see or do what, or a secret that could leak into a log or an error message, is a yes even if nobody has used it yet: a hole nobody has used is still a hole.",
	example: {what: "a webhook that takes a request without checking its signature"},
};
const FOLD_LINE =
	"Sharing code or files with an open plan is not enough for `partOf`: a separate bug, or a follow-up to a fix that already landed, is work of its own.";
```

- **The two security tickets:** #2563 (an authorization gap) and #8010 (an
  error message that could leak a secret) went to plan in all 4 answers. In
  159 they were closed in all 4. GPT sol's `why` now says "this is an
  authorization gap, so it warrants a fix even without a reported incident".
- **No closes lost:** on the 29 hard real "no" tickets it closed 57 of 58
  answers (159: 54, opus 32).
- **"No" to built phoenix work** fell from 12 of 20 answers to 7 of 20, below
  opus's 8.
- **The fold line:** false folds on 133's controls went from 6 of 26 to 4 of
  26 (sonnet 1). It fixed #66 and left #46 and #575. It also lost the one right
  fold 159 had on #717.
- **Confidence:** 75% that GPT sol with the security line is the right model
  for triage. 55% that the fold line is worth having, which is not enough to
  add it.

## Who did what

- **The tickets, labels, closing comments and what really happened:** today's
  fabrika on kamp-us/phoenix and kamp-us/demlik, before this run. The answer
  keys are 88's, 92b's and 133's, unchanged.
- **The cases and scoring:** experiment 135's (`lib/triage-135.ts`). The
  harness, model and effort are 159's, unchanged. 159's calls, sorts and
  tables moved to `lib/triage-codex.ts` so both scripts share them; 159's
  tables and field rows print byte for byte the same after the move.
- **The ticket text:** 135's saved cache, as 159 read it. No new fetch.
- **The agent:** this repo's Codex adapter (`@kampus/fabrika/agents/codex`),
  codex-cli as in 159, model `gpt-6.1-sol`, effort medium, on the laptop's
  ChatGPT plan. `OPENAI_API_KEY`, `CODEX_API_KEY` and `TYPESAFE_API_KEY` were
  unset. Each turn's own Codex home is now removed after the turn, and the
  empty work folder after the run.
- **Opus, sonnet and 159's GPT sol:** their saved answers. No new call.
- **The script:** `161-triage-security-line.ts`.
- **Nothing was written to GitHub.** No lane ran.

## How it was done

- **The security line** is a "still a yes" clause after 92b's "a person filed
  it", in the same shape as the others. It sits in the phoenix brief only.
  Today's demlik bar (`packages/pipeline/src/stages/sort/bar.ts`) has no
  hardening clause, so there is nothing there for it to answer.
- **The fold line** goes right after the demlik brief's fold rule. Why this
  line: in 159, GPT sol's reasons for its false folds leaned on shared code.
  #66 "fits that editing pass" of #46, and #575 "adds missed cases to #573".
  So the line says shared code is not enough.
- **Which tickets, two runs each, 114 sorts:**
  - the 10 built phoenix tickets (the 5 92b closed and 5 kept right), 20 sorts
  - the 29 hard real no's sonnet missed, which hold 159's 4 misses, 58 sorts
  - 133's 13 controls, 26 sorts
  - the 5 folds 159's GPT sol got right at least once (#389, #424, #425,
    #426, #717), 10 sorts: the only right folds the fold line could cost
- **Sample first:** #2563 and #8010 twice, then #46, #66, #575 and #389 twice.
  Both security tickets went to plan, #66 stopped folding, #46 and #575 still
  folded, #389 still folded right. Then the rest.
- **Same scoring as 135 and 159.** The table reads only the tickets this run
  sorted, in every column.

## What came back

Right answers out of all answers, two runs a ticket. "Fewer is better" rows
count wrong answers.

| | sonnet (saved) | opus (135) | GPT sol (159) | GPT sol, two lines |
|---|---|---|---|---|
| No, all 29 hard real no's | 6/58 | 32/58 | 54/58 | 57/58 |
| No, on a line the bar does not draw (9) | 0/18 | 6/18 | 14/18 | 17/18 |
| 159's 4 misses | 0/8 | 0/8 | 4/8 | 7/8 |
| "No" to built phoenix work, 92b closed them (5; fewer is better) | 8/10 | 8/10 | 10/10 | 7/10 |
| "No" to built phoenix work, kept right (5; fewer is better) | 0/10 | 0/10 | 2/10 | 0/10 |
| Route right, all 10 built phoenix tickets | 12/20 | 12/20 | 7/20 | 12/20 |
| The two security tickets, built (#2563, #8010) | 2/4 | 4/4 | 0/4 | 4/4 |
| False fold, 133's controls (13; fewer is better) | 1/26 | not run | 6/26 | 4/26 |
| Right fold, the 5 159 got right | 2/10 | 3/10 | 9/10 | 8/10 |
| Same answer both runs (tickets) | 46/57 | 40/44 | 51/57 | 53/57 |

### The security line: it fixes the two, and closes no fewer

- **#2563 and #8010, plan in all 4 answers.** Its reasons name the line: "This
  is a security gap requiring a code fix", "could expose sensitive values, so
  this is a security gap even without an observed leak".
- **#2792, a regex that could hang a guard (ReDoS), went to plan once.** It is
  one of the 5 built tickets every model closed in 135. The other run said
  "latent regex performance risks... no exposed security boundary". So the
  line reaches past the two tickets it was written for, and only part way.
- **The other three built tickets every model closed** (#6457, #7750, #2915)
  stay closed, all 6 answers. As 135 said, those are the bar's, not the
  model's.
- **No real no was kept because of the line.** 57 of 58. The one miss is
  #8141 once, a doc naming the wrong variable, which GPT sol read as a real
  bug; nothing about security.
- **159's 4 misses closed in 7 of 8 answers.** They are edge tickets, read
  once each way in 159. Part of this is likely run-to-run wobble, which 135
  put at 11 to 15%. It does not look like the line made GPT sol looser or
  stricter on them.

### The fold line: one fixed, one lost

- **#66, fixed:** a plan of its own both times. "This is separate work from
  #46's resilience reorganization."
- **#46, not fixed:** "a concrete implementation slice of #41's export-surface
  collapse". Not about shared code, so the line does not reach it.
- **#575, not fixed:** "missed cases of #573's timeout-inheritance change".
  Today's fold rule names "a case it missed" as its own example of a fold, and
  #573 was still open. The line cannot win against the rule's own example.
- **#717, lost:** 159 folded it right once. Now a plan both times: "sharing
  files with #714 does not make it part of that plan". That is the line's own
  words, used against a real fold.
- **The batch folds held:** #389, #424, #425, #426 folded right in all 8
  answers, as in 159.
- So the line traded one wrong fold for one right fold, and one more wrong
  fold to the good. On 18 tickets that is noise. Fold was dropped from triage
  on 2026-10-24, so this matters only while the sort answer still has
  `partOf`.

### Time and tokens

- **Median 7.5 s a sort**, slowest 14.9 s (159: 8.3 s and 19.3 s).
- **Median 17.5k input tokens (8.4k cached) and 109 output a sort,** 2.10M in
  all for the 114 sorts, on the plan's allowance. No limit was hit.
- **$2.75 at list price** for the 114 sorts, $0.024 a sort: 2.09M input
  tokens (0.83M cached) and 13.9k output, at OpenAI's standard price for
  `gpt-6.1-sol` (short context: $2.00 input, $0.10 cached input, $10.00
  output per 1M; read 2026-10-30 from
  https://developers.openai.com/api/docs/pricing). The plan itself bills no
  call. Added on 2026-10-30, as in 159; the field rows carry it as `listUsd`.
- No tool ran, no second try was needed, every sort gave an answer that fit.

## What this means

1. **Move triage to GPT sol, with the security line in the bar.** Why: with
   the line it closes real no's best of all three models (57 of 58), says "no"
   to built work less than opus (7 of 20 against 8), and routes built work as
   well as opus (12 of 20). Cost: one line in whichever bar holds the
   hardening clause. Confidence 75%. The doubt: only 10 built phoenix tickets,
   and 5 were picked because a model closed them. What would settle it: 30 or
   more built phoenix tickets drawn at random, on GPT sol with the line.
   **Wrong, by [experiment 162](./162-triage-random-built.md):** on 30
   random built tickets GPT sol with the line closed 9, opus 4, so "less than
   opus" did not hold. The line itself held on 10 new security tickets.
2. **Keep the line wherever the hardening clause goes.** Today's pipeline bar
   has no hardening clause. If one is added, the security line goes beside
   it, in the same commit. Confidence 85%: 159 showed GPT sol applies a
   clause's words with no exception the words do not state.
3. **Do not add the fold line.** It fixed one false fold and lost one right
   fold. The bigger pull is the fold rule's own example ("a case it missed"),
   which a line after it cannot outweigh. Confidence 60%. If fold comes back,
   rewrite the rule itself and rerun 133's folds and controls.

## What it cannot tell us

- **Whether the line holds on built work it has not seen.** 10 built phoenix
  tickets, 2 of them the ones the line was written for. A random draw of built
  tickets is the real test.
- **Whether the line makes GPT sol keep a real "no" that sounds like
  security.** None of the 29 hard no's is a security ticket, so none could
  show it.
- **How the line reads on opus.** Opus already kept both tickets; it was not
  rerun.
- **Today's bar.** Group p is 92b's brief, as in 135 and 159. Today's pipeline
  bar has no hardening clause.
- **Whether the fold result is more than noise.** 18 tickets, a change of one
  or two answers each way.
- **What the plan really charges.** The dollars here are list price for the
  same tokens; the plan bills no call.
- **Another day.** One Codex version, one model id, one plan.

## Run it

```
STEP=fetch GROUP=p|d node experiments/135-triage-models.ts                 # once: ticket text through gh, read-only, into runs/exp-135-cache
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY STEP=sort GROUP=p|d node experiments/161-triage-security-line.ts
                                                                           # SET=built|misses (p), controls|folds (d), or all; ONLY=, RUNS=2, CONCURRENCY=2, PROMPT=1
node experiments/161-triage-security-line.ts                               # the tables beside 159's GPT sol, 135's opus and the saved sonnet; WHY=1, EACH=0
STEP=field node experiments/161-triage-security-line.ts                    # field/runs.jsonl rows
```

Run one sort step at a time: each run rewrites the whole results file.
