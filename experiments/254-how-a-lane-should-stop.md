---
date: "2026-11-10"
scripts: "none on main; the counting script is not kept, and the write-up says what it counts"
summary: "Today's lead tooling. Reading (SRE retry and error budgets, gRPC A6, OTP restart intensity, Shape Up, agent SDK caps) plus a replay over `field/runs.jsonl` from 2026-11-01: 84 lanes by ticket, median 6 steps, max 93, $1,067 at list price. Not alone. A flat 2x the median lane stops 29, 24 of which landed later; 2x the plan's hours stops 2 of 38, since plans give hours, not steps or dollars. OTP's 3 stuck in 5 steps stops 7, the worst two at their first burst. On the five longest lanes about 35 of 41 stuck steps were tool faults (an agent's sort). Tooling and field merges rose to 56% on 2026-11-09. Lean, about 65%: a typed `tool` or `work` cause on stuck, intensity on work, a shared tool budget, 0076's 2x as a backstop, a weekly plumbing share. For 0076 and 0072, tracker ticket 675. Ten days of data; the lane cut moves every number. No model, agent time only."
---

# 254. When should a lane stop and ask a person, and would twice the plan's estimate have been the right line?

Read and counted on 2026-11-10, on main. Both: reading on how others stop runaway work, plus a
replay over our own `field/runs.jsonl` rows. **Every claim about our lanes is about today's lead
tooling** (`chain.ts`, `drive.ts`, Codex and Claude boxes) running work for both versions, not
about `next/`'s own pipeline, which runs no lanes yet. One agent read and counted; no model was
called beyond it, and nothing in the repo changed. It is the study that
[0076](../.decisions/0076-a-lane-stops-at-its-budget.md) asked for, under tracker ticket 675.

**The answer: not alone.** Long lanes mostly run long because the tools around them fail and the
chain tries again, not because the work is big. A flat cap of twice the median lane would have
stopped 29 of 84 lanes, and 24 of those landed later, so most stops would ask a person about a lane
that was fine. Twice the plan's estimate would almost never fire, because plans estimate hours, not
steps or dollars, and the hours run high. What fits our data is OTP's answer: count stuck steps in a
window of recent steps, and stop when they bunch up. "3 stuck in 5 steps" would have stopped 7
lanes, the two worst among them, at their first burst. One level up, the share of merges that are
lead tooling or field logs rose from about 10% in late October to 56% on 2026-11-09. About 65% sure
of the lean below; the doubt is the tool-versus-work sort, done by one agent on five lanes.

```ts
// Sketch of the lean. Not built.
type StepEnd = { _tag: "done" } | { _tag: "send" } | { _tag: "stuck"; cause: "tool" | "work" };
type LaneBudget = { steps: number; dollars: number }; // from the plan, 2x, as 0076 says
type Intensity = { stuck: 3; within: 5 }; // OTP's MaxR within MaxT, counted in steps
// Stop and ask a person when either is crossed. A stuck with cause "tool" files a finding
// against the tool, and that step does not count against the lane's budget.
```

## What others do

All pages read on 2026-11-10. Quotes are short and were checked against the page.

- **Retry budgets.** The Google SRE book,
  [Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/):
  "Limit retries per request", and "Consider having a server-wide retry budget", for example "only
  allow 60 retries per minute in a process". gRPC's retry design
  [A6](https://github.com/grpc/proposal/blob/master/A6-client-retries.md): each failure takes a
  token, each success gives back `tokenRatio` of one, and below half of `maxTokens` nothing is
  retried; attempts above 5 count as 5. The [gRPC guide](https://grpc.io/docs/guides/retry/) uses
  `maxTokens` 10 and `tokenRatio` 0.1. Lesson: two caps, one per try and one shared; failures drain
  the shared one fast and successes refill it slowly.
- **Error budgets.** The SRE book, [Embracing Risk](https://sre.google/sre-book/embracing-risk/):
  while budget remains, "new releases can be pushed"; when it is spent, "releases are temporarily
  halted". The SRE workbook's
  [error budget policy](https://sre.google/workbook/error-budget-policy/): past budget, halt "all
  changes and releases other than P0 issues or security fixes". Lesson: the budget is agreed ahead
  of time, and when it burns, feature work stops and reliability work starts.
- **OTP restart intensity, the one that matters most.** OTP's
  [supervisor principles](https://www.erlang.org/doc/system/sup_princ.html): "If more than `MaxR`
  number of restarts occur in the last `MaxT` seconds", the supervisor stops its children and then
  itself; the defaults are 1 and 5. The
  [stdlib reference](https://www.erlang.org/doc/apps/stdlib/supervisor.html) says the same. Learn
  You Some Erlang, [Supervisors](https://learnyousomeerlang.com/supervisors) (secondary): the
  supervisor's own parent "might still have hope". Lesson: OTP does not cap restarts over a whole
  life; it caps how many come close together, and hands a burst up one level. Our level up is a
  person.
- **Shape Up.** [Chapter 3](https://basecamp.com/shapeup/1.2-chapter-03): "An appetite is
  completely different from an estimate." [Chapter 8](https://basecamp.com/shapeup/2.2-chapter-08):
  by default a project that does not finish gets no extension, "like a circuit breaker". Lesson:
  0076's rule is an estimate rule, not an appetite, and Shape Up's default on a miss is to drop and
  reshape, not to extend.
- **WIP limits and sunk cost.** The [Kanban Guide](https://kanban.university/kanban-guide/):
  limiting what enters the system cuts delay and context switching. Staw's 1976 paper first named
  escalation of commitment
  ([Wikipedia](https://en.wikipedia.org/wiki/Escalation_of_commitment), secondary); that page says
  clear alternatives help avoid it. That limits set in advance and a fresh judge are the usual
  cures is a guess here: the page read does not say so. It matters because the one who decides "one
  more round" is the lead who has spent the most on the lane.

What agent systems cap:

| System | Cap | Source |
|---|---|---|
| Claude Agent SDK | `maxTurns` and `maxBudgetUsd`, both off by default; "Setting a budget is a good default for production agents" | [agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop) |
| SWE-agent | `per_instance_cost_limit` 3.0 dollars by default; total and call limits off | [model config](https://swe-agent.com/latest/reference/model_config/) |
| Codex CLI | no turn cap in `codex exec` | [third-party page](https://agentpatterns.ai/workflows/headless-codex-bounding/) (secondary) |
| Devin | monthly limits per user and per budget; new work blocked at the limit | [usage policies](https://docs.devin.ai/enterprise/features/usage-policies) |
| Cursor background agents | no per-session limit, only monthly account limits | [forum answer](https://forum.cursor.com/t/how-can-i-see-per-chat-agent-usage-and-cap-it-so-one-session-doesn-t-burn-the-month/172064) (secondary) |
| GitHub Copilot coding agent | a 59-minute session limit | guess (from search summaries; the official page was not read) |
| Anthropic, Building effective agents | "stopping conditions (such as a maximum number of iterations)" | [post](https://www.anthropic.com/engineering/building-effective-agents) |

No public write-up found gives a cap on CI or review rounds per pull request. The labs study
(experiment 250, in an open pull request) found two teams that cap them, at two and three rounds.

The plain way they agree on: cap each try and, apart, the whole; set the cap before the work
starts; count bursts, not only totals; at the cap, stop by default and hand the call up one level
with clear choices; and let failures drain the budget faster than successes refill it.

## How the numbers were counted

Data: `field/runs.jsonl` (6,075 rows) and `field/notes.jsonl` (560 rows), on main on 2026-11-10.
The analysis script is not kept ([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)).
What it does, in enough detail to redo:

- Take every run row dated 2026-11-01 or later that has a `ticket`. Leave out rows whose `role` is
  `session`, `driver`, `pipeline`, `acp`, `machine` or `lane` (they would count their children
  twice), rows with `driver_caused: true`, and rows that a later row's `corrects` replaced.
- A lane is all such rows for one ticket number. `ticket` is either a number or a string ending in
  `#<number>`; take the number.
- A step is one row. Stuck means outcome `stopped` or `stuck`; sent back means `fail`.
- Dollars are `costUsd`, else `listUsd`. Most runs were on a subscription that bills no call, so
  this is list price, a measure of effort, not money spent.
- Landed means one of the lane's pull requests, or a `T<ticket>` commit, is on main.
- The replay walks each lane's rows in order and stops at the first step where the step count
  passes k times the budget's steps, or the dollars so far pass k times its dollars. The intensity
  replay stops at the first step where N of the last M steps were stuck.

A second count re-did the headline numbers from the rows with the same rules: 84 lanes, 992
steps, a median of 6 steps and a max of 93, $1,067.2 in all, 104 stuck steps, median dollars
$6.81. Each matched the study. The flat replay's stop counts (38, 29 and 16) and the intensity
counts for 3 in 5 (7) and 4 in 10 (6) matched too. One did not: 2 stuck in 3 steps stops 18 lanes
when rows are sorted by `started` and 19 in file order, where the study had 17. The "later landed"
splits and dollars after each stop were not re-counted.

[0076](../.decisions/0076-a-lane-stops-at-its-budget.md) counts differently: 40 lanes, a median of
12.5 steps, from the lane state files the rows name. Lanes here are cut by ticket from the rows, so
the two do not compare one to one.

## Our lanes

84 lanes; 61 landed (73%), and some of the 23 others are still open.

| Measure | Median | p75 | p90 | Max | Sum |
|---|---|---|---|---|---|
| Steps | 6 | 15 | 25 | 93 | 992 |
| Dollars (list) | 6.8 | 15.3 | 27.8 | 93.8 | 1,067 |
| Stuck steps | 0 | 2 | 3 | 18 | 104 |

Step p75 and p90 are nearest rank (re-counted); the dollar and stuck quantiles are from the study,
not re-counted.

The five longest lanes, re-counted for steps, stuck steps and dollars:

- Ticket 270: 93 steps, 18 stuck, $86.4, landed.
- Ticket 502: 62 steps, 13 stuck, $93.8, landed (two pull requests).
- Ticket 282: 55 steps, 2 stuck, $62.9, landed.
- Ticket 102 (today's ask desk): 52 steps, 2 stuck, $71.1, not landed.
- Ticket 518: 39 steps, 5 stuck, $27.8, landed.

Those five are 6% of lanes and 32% of the dollars ($342 of $1,067). The study also gives, not
re-counted: sent-back counts of 7, 8, 7 and 9 for 270, 502, 282 and 518; by kind of change, `next/`
32 lanes (median 10.5 steps, $539), today's app 15 (median 11, $209), lead tooling 18 (median 5,
$207), docs 10 (median 3, $60), 9 unknown; and per pull request instead of per ticket (58 named on
rows), a median of 3 steps, p90 13, max 65.

**Do plans carry an estimate?** Yes, in agent hours with a confidence percent:
`.agents/skills/plan/scripts/plancheck.sh` refuses an approved plan without one. No plan states
steps or dollars. From the study, not re-counted: 38 lanes joined to a plan by ticket; their
measured agent hours (the sum of row `minutes`) were a median 0.38 of the plan's top estimate, max
2.36 (ticket 102), and 11 of 38 went past 1.0. Our rates, over 56 lanes with both: $5.89 and 6.8
steps per measured agent hour. Many rows lack `minutes`, and plan hours include lead time rows do
not record, so plan hours look high.

## The replay

Two stand-ins for a budget, since plans give no steps or dollars: (A) a flat budget, the median lane
(6 steps, $6.82), and (B) the plan's top hours times the two rates above.

| Budget | Lanes stopped | Later landed | Never landed | Most common stop step | Dollars after the stop |
|---|---|---|---|---|---|
| A, 1.5x | 38 of 84 | 32 | 6 | tests 15, build 10 | $554 |
| A, 2x | 29 of 84 | 24 | 5 | tests 14, review 5 | $480 |
| A, 3x | 16 of 84 | 13 | 3 | tests 8, review 4 | $354 |
| B, 1.5x | 6 of 38 | 5 | 1 | review 4 | $70 |
| B, 2x | 2 of 38 | 1 | 1 | tests 2 | $34 |
| B, 3x | 1 of 38 | 0 | 1 | review 1 | $0 |

"Lanes stopped" under A was re-counted; the other columns and all of B are from the study. Under A
at 2x, ticket 270 stops at step 7 and goes on to land; 102 stops at step 11 and never lands. The five
lanes that never landed spent about $110 after the stop, which a stop would have saved, at the price
of asking a person 24 times about a lane that landed.

OTP-style intensity on the same lanes (stuck steps within a window of recent steps):

- 2 stuck in 3 steps: stops 18 or 19 lanes, by row order (the study had 17, with 15 later landed
  and $188 after).
- 3 stuck in 5 steps: stops 7 lanes. From the study: 6 later landed, $115 after, and it fires on
  270 at step 67 (its first burst of `fetch_failed`), 502 at 16, 518 at 21, 554 at 7, 248 at 11.
- 4 stuck in 10 steps: stops 6 lanes; from the study, all landed later, $113 after.

Intensity fires late, at the burst, not early on size. It would not have stopped 282 or 102, which
ran long with few stuck steps and many send-backs instead.

## Why the long lanes got stuck

This sort was done by an agent's judgment, on the five longest lanes only, from each stuck row's
`why` text. Another reader may sort it differently.

- Ticket 270, 18 stuck: 11 `fetch_failed` on a failed commits check, 2 `agent_failed` (Codex
  exited 1), and one each of a stale signing link, an unformatted fetch, no commit and a plan hash
  that blocked a commit. One was the work (plan file ownership). Tool 17, work 1.
- Ticket 502, 13 stuck: 5 where Codex's box would need 603 lines and takes at most 600, 2 denied
  cache paths, a pinned Node, an unformatted file, a denied patch read, and a mutation sample that
  missed the product files. Two reviews said they were incomplete: work. Tool 11, work 2.
- Ticket 282, 3 stuck: mutation setup retries, a stale link, a lockfile. Tool 3.
- Ticket 102, 2 stuck: a tiling window manager moved the test window, and a sandbox refusal. Tool 2.
- Ticket 518, 5 stuck: 2 missing installs in a box with no network (tool); 3 where main moved or the
  plan's layers were wrong, so the agent was right to stop (work).

About 35 of 41 stuck steps were tool faults, 85%. Of all 104 stuck steps, the study counts 34 with
only free text, 27 `step_said`, 22 `fetch_failed` and 15 `agent_failed`. The last two are tool
faults by name; `step_said` is mixed. So today the rows cannot tell tool from work without someone
reading them. 39 of the 41 came after the flat 2x stop point, and 34 of those 39 were tool faults.

## One level up: the plumbing share

From the study, not re-counted. Each merged commit on main is put in one bucket by the paths it
touched, in this order: `next/`; then `apps/`, `packages/` or `programs/` (today's app); then
`.agents/`, `.claude/`, `.github/`, `scripts/` or `oxlint-plugins/` (tooling); then field rows only;
else docs.

- 2026-10-21 to 2026-10-31: tooling plus field rows, 2% to 13% a day.
- 2026-11-01 to 2026-11-06: 0% to 27%.
- 2026-11-07: 31% of 159 merges. 2026-11-08: 30% of 251.
- 2026-11-09: 56% of 146 (58 tooling, 24 field, 11 `next/`, 6 today's app).
- 2026-11-10: 41% of 110 (29 tooling, 16 field, 18 `next/`, 7 today's app).

Decisions and other docs were another 32% and 36% on the last two days. Notes agree: from
2026-11-08 to 2026-11-10, 128 of 190 notes had stage `harness`, `driver` or `lead`. Each tooling
lane was cheap (median 5 steps), so no per-lane budget sees this. It is the case 0076 left open: a
run of lanes that each stay inside budget, while the plumbing never ends.

## The candidate rules

Judged by what is lost, what holds, how each fails, and whether saying "I'm stuck" stays cheap for
an agent. Size played no part.

- **A flat cap of steps and dollars per lane.** Holds: simple, known ahead, needs nothing from the
  plan, like SWE-agent's $3. Lost: the line between a big lane and a broken one. Fails: at 2x it
  asks about 29 lanes and 24 of them land, so people learn to answer without reading, the alarm
  fatigue the repo's 0% to 10% false-alarm rule exists to stop. Honesty: fine while the agent never
  sees the cap; if it does, saying "done" early pays.
- **A multiple of the plan's estimate (0076's trial rule).** Holds: the plan owns the number, and a
  bigger plan gets more room. Lost: plans give hours, not steps or dollars, and converted at 2x it
  fires on 2 of 38 lanes. Shape Up's point bites too: an estimate grows with the plan's optimism.
  Fails: a planner who wants room writes a big estimate, and nothing checks it after. Honesty: it
  makes an honest small estimate costly to write.
- **OTP intensity, N stuck in M steps.** Holds: it is what OTP does, which this repo says to follow,
  and it counts work, not the clock, as [0065](../.decisions/0065-speed-laws-count-work.md)
  asks of speed laws. At 3 in 5 it caught the bursts no retry fixes (270's `fetch_failed`, 502's
  600-line limit). Lost: slow drift; a lane that loops on send-backs without getting stuck (282,
  102) runs on. Fails: if stuck rows are not written, or a step says `fail` where it was stuck.
  Honesty: risky, since saying stuck brings a stop closer; it needs the cause split below.
- **A separate budget for tool faults, charged to the tool.** Holds: it matches the data and gRPC's
  shared token count. A tool fault becomes a finding row
  ([0035](../.decisions/0035-outside-work-becomes-finding-rows.md)) and the tool is fixed the same
  day, like a flaky test ([0036](../.decisions/0036-a-flaky-test-is-fixed.md)). Lost: it needs a
  typed cause, `tool` or `work`, on every stuck step; today a third of stuck rows have free text
  only, and an agent cannot always tell. Fails: everything gets called `tool`; a budget shared
  across all lanes catches that, since past it no new step starts until the tool is fixed. Honesty:
  the best of the five; "the box broke" costs the lane nothing.
- **A weekly plumbing share.** Holds: the only rule that sees the level-up problem. Like an error
  budget, it says ahead of time what share of merges may be tooling. Lost: a week when tooling truly
  must come first, such as a broken chain that blocks every lane; an exception covers it, as the
  error-budget policy does for P0s. Fails: tooling rides inside a product pull request; counting by
  path makes that harder. Honesty: it puts the cost on the lead's choices, not on any agent's answer.

## The lean

Use intensity, the tool budget and the plumbing share together, and keep 0076's per-lane budget as
a backstop:

- Each stuck step carries a typed cause, `tool` or `work`. A `tool` stuck files a finding row
  against the tool and does not count against the lane.
- 3 `work` stuck (or sent back) in 5 steps stops the chain and asks a person to redo, cut scope or
  drop, in [0072](../.decisions/0072-a-churning-lane-is-redone.md)'s and 0076's words. That is
  OTP's restart intensity with a person as the parent.
- A tool budget shared across all lanes: past it, chains start no new step until the tool is fixed.
- 0076's 2x budget stays, with steps and dollars written in the plan instead of hours, so it can be
  checked. No agent sees any of these numbers in its prompt.
- The weekly plumbing share shows on the status page, with a line the owner sets. It asks; it does
  not block.

Why: it matches the plain way the reading agrees on, it matches what broke in our long lanes, and it
is the only mix where saying "I'm stuck" stays cheap. Cost: a typed cause on stuck answers in
`drive.ts` and the step skills, a counter in `chain.ts`, and one line in each plan's size section.
Confidence: about 65%. The doubt is the 85% tool share, sorted by one agent on five lanes, and
whether an agent knows the cause when it stops. What would settle it: two weeks of stuck rows with a
typed cause, then the same replay. If tool faults stay above about half, the lean holds; if agents
cannot tell tool from work, the lead tags the cause at the stop instead.

This study cost only agent time: one agent reading and counting, no model call of its own and no
paid run. No dollar figure is given for it, since none was recorded.

## What it cannot tell us

- Lanes are cut by ticket, and some tickets ran 2 to 4 pull requests and hand rounds from before
  `drive.ts`. Cut per pull request, the median is 3 steps, not 6, so every replay number moves with
  how a lane is cut. 0076's own count, from state files, gives 40 lanes and a median of 12.5.
- Dollars are list price. Most runs were on subscriptions that bill nothing, so a dollar budget is a
  proxy for effort, not money spent.
- "Landed" is read from main's commit titles and pull request numbers. Lanes opened today count as
  not landed, though they may land tomorrow.
- Measured agent hours miss rows without `minutes` and all lead time, so the 0.38 ratio may say more
  about logging than about plans.
- The tool-versus-work sort is one agent's reading of free text on five lanes.
- The intensity counts depend on row order: 2 in 3 gives 17, 18 or 19 depending on how rows are
  sorted.
- A replay cannot show what a person would have chosen at a stop. "Later landed" says the lane could
  land, not that the extra spend was worth it.
- Ten days of data, in the week the tooling itself was being built. The plumbing share may fall on
  its own once the chain settles; reading the trend needs two more weeks.
