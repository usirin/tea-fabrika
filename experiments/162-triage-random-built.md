# 162. Does GPT sol wrongly close built work, on a fair sample?

The question: experiment 161 found GPT sol, with one security line in the bar,
said "no" to built phoenix work less often than opus: 7 of 20 answers against
8. But that was 10 tickets, and 5 were picked because a model had closed them.
On built tickets drawn at random, how often does GPT sol close work the
project went on to build?

**Answer: about twice as often as opus. GPT sol closed 9 of 30 random built
tickets, opus 4. 161's "less often than opus" does not hold.**

```ts
// The whole experiment: two sets, two models, two runs each, one score.
const RANDOM = shuffled(builtSince("2026-07-01").without(USED_BEFORE), 162).slice(0, 30);
const SECURE = heldOutSecurityTickets(); // 10, by a rule written before any answer
const wrongClose = (said: Said) => said === "no" || said === "dup"; // on a ticket that was built

// GPT sol: 161's harness and bar, security line in.   Opus: 135's way, no security line.
sol:  `${SYSTEM}\n\n${pPrompt(all, t, P_BAR_SECURITY)}`   // gpt-6.1-sol, medium, Codex, ChatGPT plan
opus: sortOnce(n, pPrompt(all, t), cwd, "opus")           // Agent SDK, SYSTEM as system prompt
```

| Tickets closed at least once (fewer is better) | GPT sol + security line | opus (135's way) |
|---|---|---|
| 30 random built tickets | 9 of 30: 30% (95% 17 to 48%) | 4 of 30: 13% (95% 5 to 30%) |
| 10 held-out built security tickets | 2 of 10: 20% (95% 6 to 51%) | 2 of 10: 20% (95% 6 to 51%) |

- **Every ticket opus closed, GPT sol closed too.** GPT sol closed 5 more,
  opus none more. With 5 to 0 the exact sign test gives p = 0.06: strong
  but not proof on its own.
- **The 5 extra closes:** 3 bugs or decisions read as "hardening with no
  incident" (#7894, #8057, #9196), and 2 called duplicates of a related
  ticket (#4087 into its own epic, #8018 into a closed ticket whose fix had
  not held).
- **The security line holds on tickets it was not written for.** On 10
  held-out security tickets GPT sol closed 2, as opus did. Its `why` names
  the line: "a concrete security gap, even without an incident". Only one of
  its closes is a security reading (#2013); the other is a duplicate.
- **Agreement:** the two models gave the same answer in 75% of answer pairs
  on the random 30 (90 of 120), and all four answers matched on 22 of 30
  tickets. On the security set: 70%, 5 of 10.
- **Lean: do not move triage to GPT sol on this bar.** Confidence 75%. GPT
  sol closes real no's far better (159, 161), but here it closes built work
  twice as often, and a wrongly closed ticket is lost work nobody sees.
  Narrow the two rules it reads too tightly first, then measure again.
- **Cost:** opus $4.71 for 80 sorts (the estimate was $5.45 at list price,
  $8.80 at 135's $0.11 a sort; the cap was $10). GPT sol ran on the ChatGPT
  plan; at OpenAI's list price its 80 sorts would cost $1.72.

## Who did what

- **The tickets, labels, merges and what really happened:** today's fabrika
  on kamp-us/phoenix, before this run. Phoenix's triage set each type label;
  phoenix's builders and shippers merged each closing pull request.
- **The draw, the security rule, the hand read and the answer key
  (`162-truth.json`):** this run, all before any model answer was seen.
- **GPT sol:** this repo's Codex adapter (`@kampus/fabrika/agents/codex`)
  through `lib/triage-codex.ts`, exactly as 161: model `gpt-6.1-sol`, effort
  medium, on the laptop's ChatGPT plan, with `OPENAI_API_KEY`,
  `CODEX_API_KEY` and `TYPESAFE_API_KEY` unset. Each turn's Codex home and
  the empty work folder were removed after use.
- **Opus:** the Agent SDK with its own login, `TYPESAFE_API_KEY` unset,
  through 135's `sortOnce` and 135's prompt. The alias resolved to
  `claude-opus-5-5`.
- **The script:** `162-triage-random-built.ts`. 161's security line moved
  into `lib/triage-135.ts` (`SECURITY`, `P_BAR_SECURITY`) so 161 and 162
  share it; 161's tables and field rows, and 159's field rows, print byte for
  byte the same after the move.
- **Nothing was written to GitHub.** Every read went through `gh`,
  read-only. No lane ran.
- **One edit to the saved answers before publishing:** two long dashes, one
  in a GPT sol `why` (#2361) and one in an opus `reason` (#2325), were
  replaced with brackets and a colon. Nothing else in the results files was
  changed.

## How it was done

### The random 30

- **"Built" is 92b's and 135's yes side:** a phoenix ticket filed on
  2026-07-01 or later, closed as completed by a merged pull request, not an
  epic. The route key is triage's type label: a decision is ruling, an
  investigation is research, the rest plan.
- **The pool:** 5,543 phoenix tickets closed since 2026-07-01, of them 2,555
  built, less the 10 built tickets 135, 159 and 161 used. All 2,555 numbers
  are in `162-truth.json` (`pool`), as listed on 2026-10-28 (UTC).
- **The draw:** the pool sorted by number, shuffled with seed 162 (the same
  seeded shuffle 135 used, `shuffled` in `lib/review-rounds.ts`), the first
  30. The script refuses to draw again once the file exists.
- **What came out:** 27 plan, 2 ruling, 1 research; by type label 11 bug,
  12 feature, 4 chore, 2 decision, 1 investigation.

### The held-out security set

161's line was written after reading #2563 and #8010, so those two prove
little. This set is new security tickets, picked by a rule written before any
answer on them.

- **The rule:**
  - From the same pool of built tickets, not in the random 30 and not the 10
    used before (so #2563, #8010 and #2792 are out).
  - The title, as it stands today, matches a list of security words
    (`SECURITY_WORDS` in the script: secur*, authoriz*, authenticat*,
    permission*, privilege*, secret, credential, password, leak*, redact*,
    inject*, xss, csrf, ssrf, redos, backtrack*, sanitiz*, untrusted,
    signature*, spoof*, traversal, exploit*, vulnerab*, cors, bearer, api
    key, and a few more).
  - Read in a seeded order (seed 162), every candidate. Kept when the first
    body names a security gap: a hole in who may see or do what, a secret or
    credential that can reach a log, an error, an output, the repo or a
    third party, an injection or unsafe-input path, or a ReDoS. A
    machine-local path in a comment is not a secret.
- **One change to the rule, before any answer:** the first word list also
  had `auth`, `token` and `escape`. It matched 215 titles, and its first 12
  held no gap at all ("author", "design token", "Escape key"). The list was
  narrowed to the one above: 66 candidates.
- **The read:** all 66, each with a one-line reason, in `162-truth.json`
  (`security.read`). The aim was 12; 10 were kept.

| # | Type | The gap, from its first body |
|---|---|---|
| #2013 | chore | the rule for who may see a sandboxed post is written four times and can drift |
| #2325 | feature | no scanner for credentials committed to the repo |
| #3332 | chore | CI workflows run with a write token they do not need |
| #3341 | bug | three ReDoS alerts and one insecure-randomness alert open in main |
| #5685 | feature | an agent got past a permission denial by making the same edit through a script |
| #6585 | bug | one person's private vote and saved state is broadcast to every viewer |
| #7952 | bug | a tightened permission mode never reaches a running agent |
| #8179 | decision | a sandbox's own guarantees about what an agent may do, measured false |
| #9533 | decision | preview workers sign logins with the production secret |
| #9826 | feature | nothing stops private repo names reaching public issue bodies |

### The runs

- **Sample first.** GPT sol on 6 tickets, twice (12 sorts); opus on 3,
  twice (6 sorts, $0.42). The answers were whole and readable; #4087 was
  already a duplicate both times on GPT sol. Then the rest.
- **80 sorts per model,** two runs on each of the 40 tickets.
- **Scored as 135 scores built work:** a "no" or a duplicate on a built
  ticket is a wrong close. A route is right when it matches the type label.
- **Intervals are Wilson 95%, on tickets.** The two runs of one ticket are
  not independent (GPT sol gave the same answer both times on all 40), so an
  interval on 60 answers would be too narrow. Answer counts are given too.

## What came back

### The random 30

| | GPT sol + security line | opus (135's way) |
|---|---|---|
| Wrong close, tickets (fewer is better) | 9/30, 30% (17 to 48%) | 4/30, 13% (5 to 30%) |
| Wrong close, answers | 18/60 | 8/60 |
| Route right, answers | 38/60 | 41/60 |
| Same answer both runs | 30/30 | 29/30 |
| Answers | plan 36, ruling 6, no 10, dup 8 | plan 37, ruling 13, research 2, no 4, dup 4 |

- **Closed by both models (4), the bar's, not the model's:**
  - #2561, a per-user throttle before sign-up opens: "hardening with no
    incident", both models, all 4 answers.
  - #8672, tests for a merge that never failed: the same.
  - #3682 and #5416: duplicates of an open ticket on the same root cause,
    both models, all 4 answers. The project built them anyway, as their own
    tickets.
- **Closed by GPT sol only (5).** Each is the same answer in both of its
  runs, and a plan or ruling in both of opus's:
  - #7894 (bug): an empty window index makes real spell calls fail. GPT sol:
    "hardening with no incident... found by reading boot wiring". Opus: "a
    real wiring bug, not hardening".
  - #8057 (bug): dangling ARIA references in Tuval's chat. GPT sol: no real
    assistive-technology failure, so hardening. Opus: a real accessibility
    gap that changes live announcements, an owner's call.
  - #9196 (decision): a gate that could record a pass over a text FAIL. GPT
    sol: no false record was posted, so hardening. Opus: an owner must pick
    between two fixes.
  - #4087 (feature): the authz README lane of epic #4073. GPT sol: "folded
    into #4073, which carries this work". Opus: a lane of that epic, which
    no other lane covers.
  - #8018 (bug): the Pi window still shows the bug #7997 was meant to fix.
    GPT sol: a duplicate of the closed #7978, "reopen it". Opus: nothing open
    tracks it; research.
- **Route differences, no close (3):**
  - #2361: GPT sol ruling twice, opus ruling then plan (key: plan).
  - #5254: GPT sol plan (right), opus ruling twice.
  - #9740: GPT sol plan (right), opus ruling twice.
- **The pattern.** GPT sol's extra closes are the two rules it reads by
  their words. "Hardening with no incident" catches any agent-filed bug no
  user has hit yet, even one that breaks a real call. "Duplicate" catches a
  ticket that is part of an epic or that reopens a failed fix. Opus reads the
  same words with an exception for "a real bug".

### The held-out security set

| | GPT sol + security line | opus (135's way) |
|---|---|---|
| Wrong close, tickets (fewer is better) | 2/10, 20% (6 to 51%) | 2/10, 20% (6 to 51%) |
| Wrong close, answers | 4/20 | 2/20 |
| Route right, answers | 12/20 | 14/20 |
| Same answer both runs | 10/10 | 6/10 |

- **Where the models differ (5):**
  - #2013: GPT sol "no" twice: "no current access-control hole", only
    drift that could come. Opus "no" once, then plan: the sandbox boundary
    has already failed for real (#1811, #1831, #1835).
  - #2325: GPT sol plan twice: "the missing credential scanner is a
    security gap". Opus "no" once (no committed secret found yet), then plan.
  - #3332: GPT sol plan twice: "a concrete security gap, even without an
    incident". Opus ruling, then plan.
  - #6585: GPT sol duplicate of #6551 twice, though the ticket says it
    takes #6551 over. Opus plan twice: it should carry the work.
  - #9533: GPT sol research twice, opus research then ruling (key: ruling).
- **The line holds where it should.** #2325, #3332, #3341, #5685, #7952
  and #9826 all went to plan on GPT sol in both runs. For #2325, #3332,
  #5685 and #9826 its `why` calls it "a security gap", the line's own words;
  #7952 it read as a plain bug. Opus, with no line, closed #2325 once.
- **#2013 is the line's edge.** A duplicated visibility rule is a gap only
  if it drifts, and GPT sol read it as "no hole yet". The rule here counted
  it as a security gap; a stricter reader could say it is not.
- **Both models sent #8179 to plan** (key: ruling). It is an ADR to record
  a posture already measured, so "plan" is a fair reading; it is a route
  miss, not a close.

### Time and tokens

- **GPT sol:** median 7.0 s a sort, slowest 13.7 s. Median 17.9k input
  tokens (8.4k cached) and 97 output a sort, 1.44M in all. No tool ran, no
  answer was missing. **$1.72 at list price** for the 80 sorts, $0.021 a
  sort: 1.43M input tokens (0.65M cached) and 8.9k output, at OpenAI's
  standard price for `gpt-6.1-sol` (short context: $2.00 input, $0.10 cached
  input, $10.00 output per 1M; read 2026-10-30 from
  https://developers.openai.com/api/docs/pricing). The plan itself bills no
  call. Added on 2026-10-30; the field rows carry it as `listUsd`.
- **Opus:** median 6.2 s and 12.5k tokens a sort, 1.04M in all. $4.71 for
  80 sorts: a first sort cost $0.10 (median), a second about a tenth of
  that, as 135 found.

## What this means

1. **Do not move triage to GPT sol on today's 92b bar.** Why: on a fair
   sample it closes 30% of built tickets against opus's 13%, and every
   ticket opus closes, it closes too. Against that, it closes 57 of 58 hard
   real no's to opus's 32 (161). A wrong close costs more than a missed
   "no": a missed "no" is a plan someone can still drop, a wrong close is
   work nobody sees again. Cost of waiting: one more experiment. Confidence
   75%. The doubt: 5 to 0 is p = 0.06, and the intervals overlap. What would
   settle it: the fix below, then 30 more random built tickets.
2. **Narrow the two rules GPT sol reads too tightly, then rerun.** Two
   lines, in the same shape as 161's:
   - "A real bug in shipped code is not hardening, even if no user has hit
     it yet." That is #7894, #8057, #9196, and opus's own reading.
   - "A ticket that is one lane of an epic, takes over another ticket, or
     reopens a fix that did not hold is not a duplicate." That is #4087,
     #6585, #8018.
   Then GPT sol on these 40 and on 161's 29 hard no's, to see the closes
   kept. Cost: about 140 sorts, about $3 at list price. Confidence 65% that
   it brings GPT sol level with opus without losing many real no's: the
   duplicate line may also keep some real duplicates.
3. **Keep the security line.** On 10 security tickets it was not written
   for, GPT sol kept 8, and named the line as its reason on 4; the one
   security reading it closed (#2013) is a borderline ticket. Confidence
   80%.
4. **The 4 tickets both models closed are the bar's, as 135 said.** Two
   are "hardening with no incident" word for word, and two are real
   duplicates by their text that the project built as their own ticket. An
   owner's question, not a model's.

## What it cannot tell us

- **Whether the gap is real or luck.** 5 to 0 on 30 tickets is p = 0.06.
  The direction matches 159 (12 of 20 against 8), but 161 went the other
  way on 10.
- **Opus with the security line.** Opus ran 135's way, without it, as
  asked. On the random 30 the line is about security, so it likely does not
  explain the gap; on the security set it might.
- **Today's machine.** Both models read 92b's brief, as 135, 159 and 161
  did. Today's pipeline bar has no hardening clause at all.
- **How the trade nets out.** How many real no's per built ticket phoenix
  gets is not measured here, so "closes more no's" and "closes more built
  work" cannot be put on one scale.
- **Whether every "built" ticket was worth building.** Built means merged,
  not worth it. Some of the 4 shared closes may be right.
- **The security set is one reader's call.** The rule is written, and every
  read is in `162-truth.json`, but the read was by hand. It is 10 tickets,
  not 12, and two (#2013, #8179) are borderline. The title words miss gaps
  whose title says nothing about security.
- **What the plan really charges for GPT sol.** The dollars here are list
  price for the same tokens; the plan bills no call.
- **Another day.** One Codex version, one model id, one SDK version, one
  plan.

## Run it

```
STEP=draw node experiments/162-triage-random-built.ts            # once: the draw, through gh, read-only; refuses if 162-truth.json exists
STEP=fetch node experiments/162-triage-random-built.ts           # first versions of both sets and the issue list, into runs/exp-162-cache
STEP=security-read K=66 node experiments/162-triage-random-built.ts   # the security candidates, in their seeded order, for the hand read
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY STEP=sort MODEL=sol node experiments/162-triage-random-built.ts
env -u TYPESAFE_API_KEY STEP=sort MODEL=opus node experiments/162-triage-random-built.ts
                                                                 # SET=random|security|all, ONLY=, RUNS=2, CONCURRENCY=2, PROMPT=1; opus: DRY=1, MAX_USD=10
node experiments/162-triage-random-built.ts                      # the tables; WHY=1 adds every answer's why
STEP=field node experiments/162-triage-random-built.ts           # field/runs.jsonl rows
```
