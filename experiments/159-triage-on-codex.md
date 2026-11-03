# 159. Does GPT sol through Codex triage as well as opus?

The question: stage agents are to run on GPT sol through Codex, with opus kept
for the main session. Triage is the one place with hard evidence that the model
matters: in experiment 135, opus closed 32 of 58 answers on phoenix's missed
"no"s where sonnet closed 6, and that is why triage stayed on opus
([agents-run-on-opus-for-now.md](../docs/direction/agents-run-on-opus-for-now.md)).
So: on 135's saved cases, does GPT sol answer as well as opus did?

**Answer: yes on the "no" answers, better than opus. But it is a stricter
hand, and it closed two built security tickets that opus kept.**

```ts
// The only change from experiment 135: the model and the harness.
const agents = Agent.makeAgents({adapters: {codex: yield* codexAdapter({codex})}, ...});
agents.run({provider: "codex", session, folder: emptyDir, prompt: pPrompt(all, ticket),
	answer: SortAnswer, model: "gpt-6.1-sol", effort: "medium", limits: {usd: null, tools: null, seconds: 300}});
// 135's cases, briefs and scoring: lib/triage-135.ts, moved out of 135 unchanged.
```

- **Real "no" on phoenix (the 29 sonnet missed):** GPT sol closed 54 of 58
  answers. Opus closed 32, sonnet 6. It also closed all 12 answers on the 6
  easy no's.
- **"No" to built phoenix work (10 tickets, fewer is better):** GPT sol 12 of
  20 answers, opus 8, sonnet 8. The 4 extra are two tickets, each closed in
  both runs: #2563 (an authorization gap) and #8010 (an error message that
  could leak a secret). Both are agent-filed audits. GPT sol called both
  "hardening with no incident". Opus built both.
- **Demlik:** no "no" to good work (0 of 74 answers), routes the same as opus
  (0 of 12 on 88's route misses, 9 of 10 on the keep-right set). But it folds
  more: 6 of 26 false folds on 133's controls, where sonnet folded 1.
- **Steady:** the same answer in both runs on 80 of 87 tickets (opus 60 of 67).
- **Speed:** median 8.3 s a sort (opus 6.9 s in 135). No tool ran in any of
  the 174 sorts.
- **Effort:** medium and high gave the same answer on all 12 sample tickets.
  Medium was faster (median 9.2 s against 10.7 s), so the full set ran on
  medium.
- **Confidence:** 80% that GPT sol closes real no's at least as well as opus.
  65% that moving triage to it is right as the bar stands. The doubt is the two
  security tickets. One line in the bar would likely fix it (see "What this
  means").

## Who did what

- **The tickets, labels, closing comments and what really happened:** today's
  fabrika on kamp-us/phoenix and kamp-us/demlik, before this run. The answer
  keys are 88's, 92b's and 133's, unchanged.
- **The cases, briefs and scoring:** experiment 135's, moved to
  `experiments/lib/triage-135.ts` with no change. 135's script imports them
  now, and its tables print byte for byte the same as before the move.
- **The ticket text:** 135's own fetch step, run again through `gh`,
  read-only. Titles of earlier tickets are as they stand today, as in 135.
- **The agent:** this repo's Codex adapter (`@kampus/fabrika/agents/codex`,
  experiment 156: `codex exec --json`) behind the agent service, with 153's
  containment: its own Codex home per session, a keep-list environment, the
  fenced permission profile, `--ignore-user-config`, approvals `never`.
  codex-cli 0.165.0, model `gpt-6.1-sol`, signed in with the laptop's ChatGPT
  plan. `OPENAI_API_KEY`, `CODEX_API_KEY` and `TYPESAFE_API_KEY` were unset,
  and the script refuses to start if either OpenAI key is set.
- **Opus and sonnet:** the saved answers of 135, 92b and 133. No Claude call
  was made.
- **The script:** `159-triage-on-codex.ts`.
- **Nothing was written to GitHub.** No lane ran.

## How it was done

- **Same cases as 135, all of them.** Group p is 45 phoenix tickets with 92b's
  "both" brief: the 29 real no's sonnet missed, the 6 it always caught, the 5
  built tickets it closed, and 5 built tickets it kept. Group d is 42 demlik
  tickets with today's sort brief and Check: 133's 13 folds and 13 controls,
  88's 11 misses and 5 keep-right yeses. Two runs a ticket, as in 135. That
  covers more than opus ran in 135: opus skipped the 6 easy no's and the 13
  controls, for money.
- **Same scoring.** The rows below are 135's rows, computed by the same
  functions.
- **What the harness changed:**
  - 135 sent its one line of system prompt for group p ("You sort new
    tickets... Do not use any tool.") as the SDK's system prompt. The adapter
    has no system prompt field, so it leads the prompt here.
  - Codex is a coding agent with a shell, where 135's calls had no tool. Each
    prompt starts with one line: everything is in this message, do not run a
    command. The folder is empty. No tool ran in any sort.
  - The p answer schema has an optional field, so Codex's strict mode does
    not take it. The adapter then puts the schema in the prompt and reads the
    last message. Demlik's schema is strict and went by `--output-schema`.
    Every one of the 174 sorts gave an answer that fit; no second try was
    needed on demlik.
- **Sample first.** 12 tickets, one run each at medium and at high: 5 real
  no's sonnet missed, 1 easy no, 3 built tickets (2 that opus kept), and 3
  demlik tickets. The two efforts gave the same 12 answers. GPT sol said "no"
  to all 9 phoenix tickets, including the 2 built ones opus kept. That pointed
  at a looser hand, so the full set had to tell. It ran on medium. The
  sample's medium answers count as the first run of those tickets.

## What came back

Right answers out of all answers, two runs a ticket. "Fewer is better" rows
count wrong answers.

| Weak spot | sonnet (saved) | opus (135) | GPT sol, medium |
|---|---|---|---|
| No, the filer's text shows it (18 tickets) | 6/36 | 25/36 | 36/36 |
| No, on a line the bar does not draw (9) | 0/18 | 6/18 | 14/18 |
| No, needs the code (2) | 0/4 | 1/4 | 4/4 |
| No, sonnet closed both times in 92b (6) | 12/12 | not run | 12/12 |
| "No" to built phoenix work, 92b closed them (5; fewer is better) | 8/10 | 8/10 | 10/10 |
| "No" to built phoenix work, kept right (5; fewer is better) | 0/10 | 0/10 | 2/10 |
| Route right, all 10 built phoenix tickets | 12/20 | 12/20 | 7/20 |
| Fold, batch siblings (9) | 2/18 | 5/18 | 8/18 |
| Fold, later reports (4) | 0/8 | 0/8 | 1/8 |
| False fold, 133's controls (13; fewer is better) | 1/26 | not run | 6/26 |
| 88: route misses (6) | 3/12 (fresh, 135) | 0/12 | 0/12 |
| 88: other misses (5) | 0/10 (fresh, 135) | 0/10 | 0/10 |
| 88: keep-right routes (5) | not run | 9/9 | 9/10 |
| "No" to good work, all groups (fewer is better) | 8/72 | 8/67 | 12/94 |
| Same answer both runs (tickets) | 59/71 | 60/67 | 80/87 |

### The "no" on phoenix: better than opus

- **54 of 58 answers on the 29 misses**, against opus's 32. All 18 "the text
  shows it" tickets closed in both runs. Even the 2 "needs the code" tickets,
  which 135's plan said no model should win, closed in all 4 answers.
- **How it reads.** It names the clause word for word: 45 of its phoenix no's
  say "not now: hardening with no incident", 29 say "won't do: churn on our own
  output, no behavior change", and 4 are duplicates. Its `why` says what the
  ticket lacks, in one or two short sentences: "reports no failure in real
  use", "changes no runtime behavior".
- **Its 4 misses** are 4 "line the bar does not draw" tickets (#8141, #8246,
  #8537, #10463), each closed in one run and kept in the other. That is a
  ticket on the bar's edge, read once each way.
- **By 135's own reading rule** a model is better when it gets at least half
  of the other model's misses and does not say "no" to good work more often.
  GPT sol got 22 of opus's 26 misses. It fails the second half by 4 answers on
  2 tickets. So: better at the "no", with a cost, not a looser hand across the
  board. On the 5 seeded keep-right built tickets it closed one (#8010).

### The cost: two built security tickets

- **#2563**, an authorization gap an agent found in an audit. GPT sol, both
  runs: "no failure in real use", the attack needs an unguessable id. Opus
  built it both times, and so did the project.
- **#8010**, sanitizing an SDK error that could carry a secret into a log. GPT
  sol, both runs: "no observed leak". Opus kept it both times.
- High effort on the sample closed both too, so it is not the effort.
- **Both fit the bar's written words.** The clause says: "It hardens something
  that has never failed for a real user. Ask: has this ever failed in real
  use? If not, it is a no." Neither had failed. GPT sol applies the clause as
  written, and opus made an exception the bar does not state. For security
  that exception is right: a hole that has never been used is the normal
  state of a hole.
- The three built tickets every model closed in 135 (#6457, #7750, #2792)
  GPT sol closed too, all 6 answers. As 135 said, those are the bar's, not the
  model's.

### Demlik: level with opus, but folds more

- **No "no" to good work** in 74 answers.
- **Routes as opus:** the same wrong answers on 88's 11 misses (all three
  models agree with each other there, not with 88's older key), and 9 of 10 on
  the keep-right set. It sent #693 (a ruling) to plan once.
- **More folds, right and wrong.** 8 of 18 on batch siblings (opus 5, sonnet
  2), and 6 of 26 false folds on the controls (sonnet 1; opus not run). 135's
  plan reads a win on batch siblings with false folds beside it as a looser
  hand. Fold was dropped from triage on 2026-10-24, but the sort stage's
  answer still has `partOf` today, so this would show if the machine ran on
  GPT sol now.
- **One new route miss on a control:** #682, a plan of its own, went to ruling
  in both runs (sonnet: plan both times).

### Time and tokens

| | GPT sol, medium | GPT sol, high (sample) | opus (135) |
|---|---|---|---|
| Median seconds a sort | 8.3 | 10.7 | 6.9 |
| Slowest sort | 19.3 s | 23.8 s | not kept |
| Median tokens a sort | 17.5k in (8.4k of it cached), 110 out | 17.6k in, 185 out | 12.4k |
| Dollars at list price | $4.89 for 174 sorts, $0.028 a sort | $0.32 for 12 sorts | $0.11 a ticket's first sort |

- **Dollars at list price.** Codex runs on the owner's ChatGPT plan, which
  does not price a call, and the adapter reports `usd: null`. The dollars
  above are what the same tokens cost at OpenAI's standard API price for
  `gpt-6.1-sol` (short context: $2.00 input, $0.10 cached input, $10.00
  output per 1M tokens; read 2026-10-30 from
  https://developers.openai.com/api/docs/pricing; `lib/list-price.ts`).
  All 186 sorts: 3.46M input tokens (1.03M cached) and 24k output, **$5.21**.
  A median sort is about 9k fresh input, 8.4k cached input and 110 output
  tokens, about $0.02. No limit of the plan was hit. Added on 2026-10-30;
  the field rows got the dollars in a new `listUsd` field.
- **Output tokens include the thinking.** A Codex rollout counts reasoning
  inside `output_tokens` (25 of 88 in one sort checked).
- Every sort is one Codex process; experiment 156 put its start at about 1 s.

## What this means

1. **Move triage to GPT sol, with one line added to the bar first.** It
   closes real no's far better than opus (54 of 58 against 32 of 58), is
   steady, and runs on the plan. The one cost found is security hardening.
   The line: "A security gap (who may do what, a secret that could leak) is
   not hardening: it is a yes even if it has never been used." Why: the bar
   says what to close in words, and GPT sol follows the words; so the fix is
   the words, not the model. Cost: one line, and one rerun of the 10 built
   phoenix tickets and the 29 misses on GPT sol (about 80 sorts, 15 minutes,
   about $2.25 at list price). Confidence 65%. The doubt: only 10 built tickets, and 5 of
   them were picked for being closed. What would settle it: that rerun, plus
   30 or more built phoenix tickets drawn at random.
2. **Run it at medium effort.** High gave the same answers on 12 tickets and
   was 16% slower there (median 10.7 s against 9.2 s). Confidence 70%; high on the full set was not run.
3. **Watch fold if the machine still asks it.** GPT sol folds more, wrongly
   too. If `partOf` stays in the sort answer, rerun 133's controls on GPT sol
   after any brief change. Confidence 75%.
4. **This does not change 135's reading of the bar.** Today's bar has no
   "hardening" or "churn" clause, so on today's brief none of phoenix's real
   no's are a "no" on any model. What this run shows is that GPT sol reads a
   written clause at least as well as opus, and more literally.

## What it cannot tell us

- **How GPT sol does on today's bar on phoenix.** Group p is 92b's brief, as
  in 135. It shows how a model reads written clauses.
- **Whether the security line fixes it.** Not tried here.
- **Wrong "no" rates on built work.** 10 built tickets is small, and 5 were
  picked because sonnet closed them.
- **What high effort does on the full set.** Only 12 tickets ran at high.
- **What the plan really charges.** The dollars here are list price for the
  same tokens; the plan bills no call. How much of the plan's allowance a day
  of triage takes is not known.
- **A fair harness match.** 135 used the Agent SDK with no tools and a system
  prompt. Here Codex had a shell it did not use and the system line led the
  prompt. That is part of the change being tested, but it is a second change
  beside the model.
- **How much is luck from the pick.** The misses were picked because sonnet
  missed them, so any rerun would get some right. GPT sol's gain over opus (22
  answers) is well past the 11 to 15% run-to-run wobble 135 measured.
- **Another day.** One Codex version, one model id, one plan.

## Run it

```
STEP=fetch GROUP=p|d node experiments/135-triage-models.ts            # once: ticket text through gh, read-only, into runs/exp-135-cache
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY STEP=sort CONFIG=sol-medium|sol-high GROUP=p|d node experiments/159-triage-on-codex.ts
                                                                      # SET=misses|controls|keep|all, ONLY=, RUNS=2, CONCURRENCY=2, PROMPT=1
node experiments/159-triage-on-codex.ts                               # the tables beside 135's opus and the saved sonnet; WHY=1, EACH=0, SAME=1
STEP=field node experiments/159-triage-on-codex.ts                    # field/runs.jsonl rows
```

Run one sort step at a time: each run rewrites the whole results file.
