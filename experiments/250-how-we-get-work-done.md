# 250. How do we get work done, before any pipeline?

Read 2026-11-10 on main at `75c6fba8b`. **This is reading, not a measurement.** The numbers come
from `field/` as it stood that day, counted with `jq`. It builds the proposed note
[How we get work done](../docs/direction/how-we-get-work-done.md) and a private page titled "How we
get work done". It is the study that decision
[0059](../.decisions/0059-pipeline-starts-from-the-work.md) asks for, in the five parts its
amendment of 2026-11-10 names. Ticket 574 is the running example.

This area has no screen. So the guidelines skill's step 5 (3 or 4 designs, shot next to Linear)
does not apply, and there are no shots and no Design canvas. The page has one worked picture
instead: ticket 574 traced through the loop.

## The answer

- **The makers agree on six things.** Stop at the first defect. Limit what is in flight, and pull
  new work only when there is room. Shape the work before it starts. Ship small. Write the current
  way down, then improve that. Learn as a habit, and blame no one.
- **Here, the loop works but stalls in the middle.** Of 236 step runs on 2026-11-09 and 11-10, half
  ended `done`. 22% were sent back, and 22% got stuck. The test writer stalls most: 31 of its 101
  runs got stuck, and 16 of those were the tools failing to collect the step's commit, not the work
  being wrong.
- **A person is not asked by the steps.** All 9 asks from a step went to the lead. The owner comes
  in through decisions, plan calls and walks: 89 of 554 field notes say a person was needed.
- **Ticket 574 shows the whole shape.** It went from a bug seen on another ticket to a merged pull
  request in about 100 minutes, for $19.47 at list price. About half of its step spend ($8.81 of
  $18.31) went to rounds that stalled or were sent back. Its plan changed twice, each time because
  a later step found something the plan could not see.

```text
how each source does the loop, one line each
Toyota [t1]        stop the line at the first defect; people do kaizen; by hand before a machine
Lean VSM [l1]      map every step of the flow before you change one
Lean std work [l2] write the best current way down; that is what kaizen improves
Shape Up [s1]      shape and bound the work, bet on it for a fixed time, a circuit breaker ends it
Linear [n1]        new work lands in triage; small projects, 1-3 people, 1-3 weeks; ship all the time
DORA [d1]          small changes; count lead time and how often a change fails
Kanban [k1]        cap work in flight; that cap makes a pull system
Kitchen [o1]       tickets on a rail; every plate goes through one pass
Surgery [o2]       the whole team stops at three fixed points: sign in, time out, sign out
Cockpit [o3]       checklists are the base of crew standard work; do the flow, then confirm
SRE [p1]           a blameless postmortem after any bad event
```

## Part 1: the loop, in plain words

No fabrika words here, as 0059 asks. The loop starts at "decide what to work on next", the lead's
lean that the owner did not object to.

| Part | Who decides | What is handed over | What "done" means |
|---|---|---|---|
| Decide what to work on next | the person who owns the goals | one piece of work with a reason | it is picked, and someone has it |
| Shape it | the person who owns the goals, or someone they trust | a short plan: what changes, how we will know, how much time it is worth | the plan is agreed, and its limits are clear |
| Do it | the doer | the change, and what the doer saw on the way | the change exists and the doer thinks it meets the plan |
| Check it | someone other than the doer, and the rules | a yes, or a no with the reason | every check passes, or the work goes back with why |
| Ship it | whoever holds the gate | the change, live | people can use it |
| Learn from it | everyone who touched it | what broke, what cost too much, what worked | the lesson is in the written way of working, not only in a head |

Someone wants something before all of this. That want becomes a piece of work in the first part.

## What was read

Every source was fetched on 2026-11-10. Quotes are short and checked against the fetched page. The
three most used ones (t1, k1, d1) were fetched a second time to check the exact words.

### Factories and software makers

| Tag | Source | What it says, short | What it teaches |
|---|---|---|---|
| t1 | [Toyota, production system](https://global.toyota/en/company/vision-and-philosophy/production-system/) | "the operator can stop the line by pulling the stop cord themselves"; "Only humans can implement kaizen"; first "do the work smoothly and correctly by hand" | Stop at the first defect. Do it by hand before a machine does it. People improve the work. |
| l1 | [Lean Enterprise Institute, value-stream mapping](https://www.lean.org/lexicon-terms/value-stream-mapping/) | "diagraming every step involved in the material and information flows" | Map the whole flow before you change a part of it. |
| l2 | [Lean Enterprise Institute, standardized work](https://www.lean.org/lexicon-terms/standardized-work/) | "once established and displayed at workstations, is the object of continuous improvement through kaizen" | The written way is what you improve. |
| s1 | [Shape Up](https://basecamp.com/shapeup/1.1-chapter-02) | appetite is "The amount of time we want to spend on a project, as opposed to an estimate"; a "circuit breaker" so "one project doesn't overload the system" | Shape and bound work before it starts. A bet has a fixed time. |
| n1 | [Linear Method](https://linear.app/method/scope-projects), [triage](https://linear.app/docs/triage) | "completed in 1–3 weeks with a team of 1–3 people"; "Triage is a special inbox for your team" | New work waits in one place to be picked. Keep projects small. |
| d1 | [DORA](https://dora.dev/guides/dora-metrics-four-keys/) | "Teams should make each change as small as possible"; "Smaller changes are also easier to recover from" | Ship small. Count lead time and how often a change fails. |
| k1 | [Kanban Guide](https://kanbanguides.org/english/) | "must explicitly control the number of work items in a workflow from started to finished"; it "should create a pull system" | Cap the work in flight. New work starts only when there is room. |
| p1 | [Google SRE, postmortem culture](https://sre.google/sre-book/postmortem-culture/) | "Blameless postmortems are a tenet of SRE culture." | Write down every bad event. Blame no one. |

### Outside software

| Tag | Source | What it teaches | What does not carry over |
|---|---|---|---|
| o1 | [A culinary school's kitchen glossary](https://www.escoffier.edu/blog/culinary-arts/more-useful-examples-of-chef-jargon/): the rail is "where order tickets are hung", the pass is for "orders that are ready to be served" | One place where work waits, and one place where every result is checked before it leaves. That the expediter is the check is **secondary**, from summary pages. | Fixed stations and a strict chain of command. Two people swap roles all day. |
| o2 | [WHO Surgical Safety Checklist](https://www.who.int/teams/integrated-health-services/patient-safety/research/safe-surgery/tool-and-resources): the team stops "at three critical points"; the form's headings are sign in, time out, sign out | A few short checks at fixed points, each with a named person. The time out re-checks the plan just before the act. The WHO's own form would not fetch (403); the headings come from a hospital's copy of it. | Everyone in one room at once. Agents do not pause together, so a pause has to be a gate. |
| o3 | [NASA report on cockpit checklists, 1991](https://ntrs.nasa.gov/citations/19910017830): checklists are "the foundation of pilot standardization and cockpit safety" | A checklist is the written standard. Routine work is done, then confirmed against it. Read-do for steps you do not know is **secondary**: no FAA page defining it was found. | Memory. An agent has none between runs, so every list is read-do for it. |

## Part 2: what they agree on

- **Stop at the first defect, and do not pass it on** (t1, o1, o2, d1).
- **Limit what is in flight, and pull new work only when there is room** (k1, s1's circuit breaker,
  n1's triage, o1's rail).
- **Shape the work before it starts** (s1, o2's time out, n1, l1).
- **Ship small: small changes ship and recover better** (d1, n1, s1).
- **Write the current way down, then improve that** (l2, t1, k1's explicit policies, o2, o3).
- **Learn as a habit, and blame no one** (t1, p1, s1's cool-down).
- **Checks are short, sit at fixed points and have a named owner** (o2, o3, o1).

Where they differ:

- **Who picks the work.** A few senior people bet once a cycle (s1). A shared triage inbox (n1).
  Pull under a cap, with no planning meeting (k1).
- **Fixed time or steady flow.** Shape Up fixes the time and lets scope bend (s1). Kanban and DORA
  aim for steady flow (k1, d1).
- **Where the check sits.** Inside each step, so anyone can stop the line (t1). Or one gate at the
  end (o1's pass).

One clash with a goal of ours: Shape Up's six-week bet and Linear's 1 to 3 weeks are sized for
people. Here an agent does a ticket in hours, so a "cycle" in their sense is too long to be useful.

## Part 3: what really happens here

All of this is today's version: the lead's tooling and today's lanes. `next/` has no pipeline yet.

### The rows

- `field/runs.jsonl` has 5,985 rows from 2026-10-10 to 2026-11-10. 44 are corrections, so 5,937 are
  live. Most are experiment replays (4,001 `triager` rows), not real work.
- The clean step data is the `drive.ts` rows: `role: "hand"` and a `why` that starts
  `drive.ts <step>`. There are 236, on 2026-11-09 and 11-10 only, over 24 tickets. Before that,
  step outcomes are free text in many spellings and cannot be counted cleanly.

| Step | done | send | stuck | ask | skip | all |
|---|---|---|---|---|---|---|
| tests | 49 | 12 | 31 | 9 | 0 | 101 |
| review | 22 | 28 | 8 | 0 | 0 | 58 |
| build | 21 | 8 | 8 | 0 | 0 | 37 |
| mutation | 21 | 3 | 4 | 0 | 6 | 34 |
| plan | 4 | 2 | 0 | 0 | 0 | 6 |
| all | 117 (50%) | 53 (22%) | 51 (22%) | 9 (4%) | 6 (3%) | 236 |

The verbs are mapped from the row's `outcome`: `pass` is done, `fail` is send, `stopped` is stuck,
`parked` is ask.

### Where work stalled

- **The test writer stalls most.** 31 of 101 runs got stuck. 16 of those are `fetch_failed`: the
  lane could not collect the step's commit out of its box. That is the tools, not the work.
- **Review sends back most.** 28 of 58 reviews sent work back, 25 of them to the test writer, so a
  law needed fixing.
- **Retries need a judge.** On ticket 574, 9 small judgment agents decided what to do after a stuck
  step: 2 said send again, 7 said park for the lead.
- **Time lost is not recorded.** The median step takes about 4.5 minutes. Nothing records how long
  the lead spent unsticking a lane by hand.

### Where a person was needed

- **Steps never asked the owner.** All 9 `ask` rows from a step went to the lead
  (`ask:lead:question` 7 times).
- **89 of 554 notes say a person was needed** (`person: true`). By stage: plan 18, driver 16,
  harness 14, triage 9, ship 7. Read by hand, the newest 40 fall into four groups: design calls and
  plan approvals; the owner correcting how the lead worked; tooling knots only a person could untie
  (signing chains, a stack stranded by a squash); and outside limits.

### What cost the most

- **List-price dollars on the `drive.ts` steps:** tests $117.91 (median $0.77 a run), review $65.55
  ($1.12), build $44.32 ($1.07), mutation $6.27 ($0.14), plan $5.38 ($1.12). About $239 over 24
  tickets. List price is from each row's `listUsd`; the runs were on subscriptions.
- **The test writer costs the most and stalls the most.** It is the same step.
- **Not trusted or missing:** `tokens` is null on 977 rows and `minutes` on 308; 582 rows have no
  dollars; `billing` is set on only 231. 36 rows are `driver_caused` and stay out of any baseline.

### Notes and findings

- **Notes by kind:** failure 202, friction 176, success 110, cost 32, plus 34 rows with kinds
  outside the schema.
- **Findings:** 50 rows and 46 ratings, all from 2026-11-09 and 11-10. 22 rated fix, 24 noise, 4
  not rated. The lead found 27 (14 fix), review 16 (7 fix).

## Today's example: ticket 574

Ticket 574 built decision [0052](../.decisions/0052-tests-never-depend-on-the-machine.md): tests
never read the home folder. It landed as [PR 787](https://github.com/usirin/tea-fabrika/pull/787).
Times are Pacific, on 2026-11-10. The sources are the PR, its 25 run rows (`t574-*`), notes
2026-11-10-24 and -25, and the lane's plan and chain files, which live outside the repo.

| Part | What happened | Who decided | What was handed over | Where it stalled |
|---|---|---|---|---|
| Decide | A test box on ticket 576 failed every suite: the test setup looked at the home folder, and a locked home refused it. The owner ruled the dependency goes. 0052 merged 11:50. Ticket 574 was filed to build it. | the owner (the rule), the lead (the ticket) | the decision and the ticket | who filed 574 and when is not recorded |
| Shape | A plan with laws L1 to L5, approved by the lead because it builds 0052. Amended twice: A1 at 11:52, when the test writer found the installed linter lacks the rule the plan named; A2 at about 12:38, when mutation got stuck twice because the code ran only at file load, so it had nothing to measure. | the lead | the plan file, signed again after each amendment | each amendment came from a later step |
| Do | The chain ran 11:48 to 13:18 with no lead agent holding it. Tests: 8 rounds, 4 done. Build: 7 rounds, 5 done; two made no commit because every law was already green. | each step's own agent | signed commits on the lane's branch, a brief per round | tests stuck twice on `fetch_failed`; collecting a stuck step's commit moved the lane's branch, and the next box was refused until the lead moved it back |
| Check | Mutation: 4 rounds, the last with 17 killed and no survivors. Review: round 1 sent back to tests (a law needed its `scenario:` label), round 2 done. The lead ran lint, typecheck and narrow tests outside the boxes, which cannot do some of it. `loosening.sh` flagged 2 removed laws; the lead's hand check found both rewritten stricter. | review's agent, then code; the lead for the hand check | review answers, `loosening.sh` output | the lead's own runs have no rows |
| Ship | PR opened 13:18, `catchup.sh` landed it 13:28 on green CI. No owner read, since nothing loosened ([0014](../.decisions/0014-the-lead-merges-when-every-step-passed.md)). 6 files, +289 and -48. | code, under the lead | the merged change | none |
| Learn | PR 789 added the run rows and note 2026-11-10-25. The note names four causes and leaves "branch move and box limits" to look at. No ticket or finding names them. | the lead | a field note | the lesson did not reach a ticket, a finding or a skill |

**Cost:** $18.31 for the steps and $1.16 for the judgments, $19.47 in all, at list price. 70 agent
minutes. 8.95M tokens in (7.89M cached) and 27.9k out. 9 of its 18 step rows, $8.81, were rounds
that stalled or were sent back.

**Not recorded, so it cannot be traced:** who filed 574 and when; who wrote the first plan and what
it cost; the first approved plan body (only the two signed-again copies are left); three rounds
with no rows (build 3, mutation 1 and 2); the lead's own time and runs; CI and the leak grep apart
from the PR comment; the owner's time.

### Ticket 574 against the six principles

| Principle | 574 |
|---|---|
| W1 one loop, six handoffs | half: every handoff happened, but three of them left no row |
| W2 pull under a cap | follows: one lane, run by the chain, inside the lead's cap |
| W3 shape first, amend in the open | follows: both amendments are in the plan, signed again |
| W4 stop at the first defect, and say whose it is | breaks: `fetch_failed` and the moved branch were the tools' defects, but read as the step's |
| W5 ship small | follows: 6 files, about 100 minutes from decision to merge |
| W6 a lesson lands in the standard | breaks: the note names the tooling causes, and nothing picks them up |

## Part 4: the translation

Each name below was checked on main at `75c6fba8b`, in code or in a settled note. "Today" is
today's version; "`next/`" is the new one. The ledger's word for a recorded fact is now **event**
(renamed 2026-11-08, `.glossary/TERMS.md`); today's code says fact and `kind`.

| Part | Who owns it today | In `next/`, by settled notes |
|---|---|---|
| Decide | The owner sets the order in `docs/plan/` (tiers). The lead picks lanes and files tickets in the tracker (`programs/tracker`, `programs/ticket`; `tracker_file`). A filed ticket is a `filed` fact (`packages/pipeline/src/stages/pipeline/lane-harness.ts:53`). The `triage` step exists in `STEPS` (`packages/pipeline/src/stages/pipeline/routes.ts:29`) but is paused. | Not built. Settled: `ticket`, `tracker`, `triage` ([sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md), [triage asks when worth is unclear](../docs/direction/triage-asks-when-worth-is-unclear.md)), `area` and `label`, and a label never routes ([label guidelines](../docs/direction/label-guidelines.md)). fabrika has no priority (the `tier` row). |
| Shape | The plan step's file, approved on its line 1 by the lead when it builds a decided note, or by the owner for a new design call (AGENTS.md). A plan check can send a plan back (`plancheck`, in the plan rows of other lanes). | A `plan` with criteria and properties, approved by version and a hash of the ticket's text ([the plan stage](../docs/direction/the-plan-stage.md), decided). |
| Do | `test_writer` and `build` steps, run by `drive.ts` and chained by `chain.ts`, which is a tea machine on the Effect engine (`.agents/skills/lead/scripts/chain.ts`, its header). Each step's agent runs in a box. A step signs its commit in a git note. | Steps are tea machines that answer in five verbs ([outcome names](../docs/direction/outcome-names.md)). A step's commit is an `attested` link, which `next/`'s exam already checks (`next/apps/fabrika/src/exam/commits.ts`), and a `committed` event is a settled name ([a unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md)). |
| Check | `mutation` (Stryker), `review`, CI, `leakgrep.sh` and `loosening.sh`, then the lead's hand check on a hit. | `mutation`, `review` and the `exam` ([nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)). A person is asked only for a `judgment` ([jidoka and andon](../docs/direction/jidoka-and-andon.md)). |
| Ship | `catchup.sh`, under the lead, once every step passed ([0014](../.decisions/0014-the-lead-merges-when-every-step-passed.md)). | `ship`, the one merge authority ([ship stage rules](../docs/direction/ship-stage-rules.md)). |
| Learn | `field/notes.jsonl`, `field/runs.jsonl`, `field/findings.jsonl` (a person rates each `fix` or `noise`), `.decisions/` through `/adr`. | A `finding` stays a row until Tier 6 ([0035](../.decisions/0035-outside-work-becomes-finding-rows.md)). An `ask` is `asked` and `answered` events, with `needed` marked by a person ([one ask and one meter](../docs/direction/one-ask-and-one-meter.md)). |

Where a person judges, in both versions: the owner sets the goals and the tier order, makes each
new design call and reads real loosening of a law. The lead approves plans that build decided
notes and hand-checks `loosening.sh` hits. Nothing else waits on a person.

What is a tea machine today: today's lane and each step (`packages/pipeline/src/stages/`), and
`chain.ts`. In `next/` none of the loop is built. Its tea machines today are the runtime's, such
as the supervisor (`next/packages/libfabrika/src/app/supervisor.ts`).

## What this tells us for fabrika

- The pipeline notes already hold W4's first half (P3, jidoka) and the "only a judgment" rule (P1).
  What is new here is the rest of the loop: deciding what is next, shaping, and learning.
- The data says the costliest problems are in the tools, not the work: `fetch_failed`, moved
  branches, boxes that cannot run a check. A stop that cannot say whose defect it is sends a person
  to find out.
- Learning stops at the note. A note names a cause and nothing makes it a ticket, a finding or a
  skill change. Toyota and Lean put the lesson into the written standard.
- The steps record most of the "do" and "check" parts well, and the "decide" and "shape" parts
  barely: who filed, who wrote the plan, the first plan body.

## What it cannot tell us

- The clean step data is two days and 24 tickets. It may not hold for a month of work.
- Ticket 574 is one ticket, and an easy one: it built a decision already made.
- Nothing here measures whether the principles would make work faster or cheaper.
- The owner's time is not recorded anywhere, so the cost of "a person was needed" is unknown.
- The person-needed groups come from reading 40 notes by hand, not from a field.
- No source was about a two-person team working with AI agents. Every lesson is carried over.

Dollars spent: $0 on model calls for the reading. The two research agents and this write-up ran on
a subscription; their rows are in `field/runs.jsonl`.

## Links

- [t1] https://global.toyota/en/company/vision-and-philosophy/production-system/
- [l1] https://www.lean.org/lexicon-terms/value-stream-mapping/
- [l2] https://www.lean.org/lexicon-terms/standardized-work/
- [s1] https://basecamp.com/shapeup/1.1-chapter-02, https://basecamp.com/shapeup/2.2-chapter-08, https://basecamp.com/shapeup/3.4-chapter-13
- [n1] https://linear.app/method/scope-projects, https://linear.app/method/write-issues-not-user-stories, https://linear.app/docs/triage
- [d1] https://dora.dev/guides/dora-metrics-four-keys/
- [k1] https://kanbanguides.org/english/
- [p1] https://sre.google/sre-book/postmortem-culture/
- [o1] https://www.escoffier.edu/blog/culinary-arts/more-useful-examples-of-chef-jargon/
- [o2] https://www.who.int/teams/integrated-health-services/patient-safety/research/safe-surgery/tool-and-resources
- [o3] https://ntrs.nasa.gov/citations/19910017830
