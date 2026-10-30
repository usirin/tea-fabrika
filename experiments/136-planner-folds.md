# 136. Can the planner fold?

Experiment 133 found that triage cannot fold: on 13 real demlik folds it named
the right ticket 2 times out of 26. Its lean was to move fold to the planner,
which reads the code (70%). This tests that lean.

**Answer: no, the lean does not hold. The plan stage's own planner (opus,
effort medium, reading demlik's code at the time) named the right ticket, or a
sibling in the same pull request, on 6 of 26 answers. 133's triage, scored the
same way, got 4. And the planner folded where it should not on 6 of 26 control
answers, against triage's 1. Both numbers are past the sink line written
before the run. Asked from the other side, the planner of a batch's first
ticket carried none of the 10 tickets that really shared its pull request, in
either run. Confidence 80%.**

The planner says what triage said: different code, so its own pull request.
Its reasons are sound. Most real folds in demlik were a choice to ship one
study's findings in one pull request, not one change in the code. The code does
not show that choice, so reading it does not help.

**A second finding: 10 of the planner's 11 wrong names were a ticket whose pull
request was already open.** No real target had one. Cutting those tickets from
the list in code took false folds on controls from 6 of 26 to 1 of 26. It did
not add a single right fold: the planner then said "own" instead (`unbuilt`
arm, below).

**Cost: $5.87 for 99 answers.** A median answer cost $0.069, took 3 turns, 1
code read and 8 seconds. A full plan in 86 took 7 to 15 turns and $0.13 to
$0.80.

```ts
// One case: the planner is handed the ticket as first filed and the tickets it could join.
const c: Case = {
	ticket: { n: 390, title: "backlog-sweep evidence misses the two facts…", body },
	at: "<last commit on main before #390 was filed>", // its code, as livePlanner copies it
	listed: [ { n: 389, summary: "backlog-sweep evidence doesn't tell partial…" }, /* 6 more */ ],
};
const run = query({ prompt: promptOf(c, "must"), options: {
	...plannerOptions({ model: "opus", effort: "medium", budget: 1 }, tree), // Read, Grep, Glob
	outputFormat: { type: "json_schema", schema: jsonSchema(FoldAnswer) },
}});
// FoldAnswer = { joins: number | null, why: string }
// #390, both runs: { joins: 389, why: "Both change the same linkedPullRequests block…" }
//   389 itself folded into 388, so all three shipped in one pull request: a sibling, counted right.
// #389, both runs: { joins: null, why: "…different code and each can land as its own pull request." }
//   Really folded into 388: a miss.
```

## Who did what

- **The tickets, their folds and their pull requests:** today's fabrika on
  kamp-us/demlik, before this run. Every fold was its triage, its agents or
  the owners.
- **The answer key:** `133-truth.json`, as 133 left it. Nothing was added.
- **The planner:** this repo's plan stage, run outside its machine. The Agent
  SDK options are `plannerOptions` from
  `packages/pipeline/src/stages/plan/planner.ts`: Read, Grep and Glob only,
  held by the read-only Check, no settings, servers or connectors. Model and
  effort are the plan stage's defaults (`AGENT_DEFAULT` in
  `packages/pipeline/src/setup.ts`): `opus`, effort `medium`. The SDK ran
  `claude-opus-5-5`, plus `claude-haiku-5-5` for a small side call. The
  question and its answer shape were written for this run; the plan brief was
  not used.
- **The code:** a clone of kamp-us/demlik in `runs/` (git-ignored). Each case
  reads a plain copy with no history and no links, made as `livePlanner`
  makes one, at the last commit on main before the ticket was filed. That is
  main as the plan stage would have fetched it then.
- **Login:** the Agent SDK's own, as in 86 and 133. No token was loaded.
  `TYPESAFE_API_KEY` was unset.
- **Nothing was written to GitHub.** Every read went through `gh`,
  read-only. No lane ran.

## How it was done

- **Cases:** 133's 13 folds and 13 controls, all of them. Two answers each.
- **What the planner sees:**
  - the ticket as first filed;
  - the tickets it could join: filed before it, open at that moment, and
    sent to plan by triage, planned yet or not. "Sent to plan" is read from
    labels: it was ever typed `bug`, `feature`, `chore` or `epic`, and never
    a session, map, spike, decision, finding or duplicate. Each shows its
    title and the first 300 characters of its first revision, as in 133.
    2 to 27 tickets in `must`, newest first.
- **The question, before any plan:** does this ticket belong inside the plan
  of one of these, so that one pull request carries both? It may name only a
  listed ticket. The answer's Check holds it to that; a second try is told
  what the Check found. The Check never fired.
- **No plan was written.** The fold question alone is the cheap shape.
- **Three arms, each added after the one before had answered:**
  - `may`: read the code where it helps, stop once you can answer. Its first
    3 answers read no code at all, so it was stopped there.
  - `must`: read the code first, where this ticket's change and each close
    ticket's change would land, then answer. The main arm.
  - `unbuilt`: `must`, with the tickets that already had an open pull request
    cut from the list. Run only on the 14 cases whose list it changed; the
    other 12 keep `must`'s answers, as their prompt is the same.
- **Part B**, for the batches: the planner of a batch's first ticket, two
  minutes after it was filed, asked which open tickets its pull request
  should also carry, older or newer. Brief `must`. 8 heads, two answers each.
- **Scoring a fold answer:** right (a real target), a sibling (a ticket that
  itself folded into a real target, so one pull request carries all three),
  a neighbour (any other ticket), or none. A control answer is kept or a
  false fold.
- **Money:** estimated first, 3 cases tried and read, then scaled. Hard cap
  $8, checked before every call.

## What would back the lean, and what would sink it

Written before any paid call.

- **The baseline is 133's triage:** a right fold on 2 of 26 answers (8%) on the 13 real folds,
  and a false fold on 1 of 26 answers (4%) on the 13 controls.
- **The lean backs** if the planner names a right target, or a batch sibling that itself folded
  into it (one pull request carries all of them), on at least 13 of 26 fold answers, and folds
  falsely on at most 10% of control answers (2 of 26, or 1 of 12 on 6 controls).
  - Why half: at under half, more folds still miss than land, and a person still finds most of
    them. Half is also far past run-to-run noise from an 8% start.
  - Why 10%: a false fold puts two changes in one pull request. 10% is the most false alarms an
    advice-level check may give at Google; a blocking one may give about none (Sadowski et al.,
    CACM 2018, as experiment 125 cites it). A fold is not a block, so the advice bar fits.
- **The lean sinks** if it gets 6 or fewer of 26 right (no better than triage plus noise), or
  folds falsely on more than 10% of control answers.
- **In between** it is a partial answer. Then the split says which part holds:
  - the 9 batch tickets (18 answers), whose target was not yet a plan when triage ran;
  - the 4 later reports (#444, #473, #494, #717, 8 answers), which missed on "can one pull
    request carry both?".
- **Same answer both runs** is reported, not barred. 133's triage gave the same answer on 22 of
  26 tickets.
- **The cheap shape** (the fold question alone, no plan) backs only if a run costs well under a
  full plan: 86 put a small one at about $0.41.

## Part B's bar

Written after part A's answers were in and before any part B call.

Part A asks the newer ticket "do you join an older one?". On a batch that is the wrong side: the
siblings land seconds apart, and the first one's planner is the one that sees them all. Part B
asks that planner, two minutes after its ticket was filed, "which open tickets should your pull
request also carry?". The 8 heads are the 4 batch targets (#388, #411, #423, #20) and the 4
tickets a batch control was filed seconds after (#467, #523, #45, #358).

- **It backs** a head-side fold if the planner carries at least 10 of the 20 slots that really
  shared its pull request (10 tickets, 2 runs each), and carries a batch control that got its own
  pull request in at most 10% of slots.
- **It sinks** if it carries 4 or fewer of 20 (no better than part A's batch answers), or carries
  a batch control in more than 10% of slots.
- Any other ticket it carries is listed and checked by hand against the head's real pull request.

## The `unbuilt` arm's bar

Written after part A's `must` answers and part B's answers were in, and before any `unbuilt` call.

In `must`, 10 of the 11 answers that named a wrong ticket named one whose pull request was already
open when the new ticket was filed. No real target had one. So the `unbuilt` arm cuts those
tickets from the list, in code, before the planner sees it. Everything else stays as in `must`.
A case whose list does not change keeps `must`'s two answers, since its prompt is the same.

- **The cut backs** (as a code step in front of the planner) if false folds on controls fall to
  10% or less (2 of 26) and right folds, sibling ones counted, do not fall below `must`'s 6 of 26.
- **It sinks** if false folds stay above 10%, or right folds fall.
- On its own it cannot save the lean: that still needs 13 of 26 right.

## Part A: what came back

| 13 folds, 26 answers | Planner, `must` | Planner, `unbuilt` | Triage (133) |
|---|---|---|---|
| The right ticket | 4 | 4 | 2 |
| A sibling in the same pull request | 2 | 2 | 2 |
| A neighbour | 5 | 0 | 4 |
| A duplicate of the right ticket | | | 4 |
| A plan of its own | 15 | 20 | 13 |
| A ruling | | | 1 |
| **13 controls, 26 answers: a false fold** | **6** | **1** | **1** |
| Same answer both runs, of 26 tickets | 24 | 25 | 22 |

133 counted triage's #390 into #389 as a fold into a neighbour. Here it is a
sibling, scored the same way for both.

- **The lean sinks on both counts.** 6 of 26 right is on the sink line (6 or
  fewer), and 6 of 26 false folds (23%) is past 10%. The split does not help:
  4 of 18 on the batch tickets, 2 of 8 on the later reports.
- **The 4 right folds are 2 tickets, both runs:** #21 into #20 and #494 into
  #493. Triage called both a duplicate of the right ticket. With the code, the
  planner saw what each adds: #21 exposes the same set that #20's error
  builds, in the same function; #494 is one way to fix #493's cost, in the
  same file. Where triage saw the link and picked the wrong word, the planner
  picked the right one.
- **The 2 siblings:** #390 into #389, both runs, as triage did. Both add facts
  to the same block of the same file.
- **It lost the 2 right folds triage made once each** (#389 into #388, #425
  into #422). Both runs of each said a plan of its own.
- **On the 9 batch tickets it said "own" 14 of 18 times.** Its reasons are
  code facts, and they are true. #389 changes the evidence files and #388
  changes the verdict file. #413 changes how moves are committed and #411
  changes which files get picked. #424 is a new kind of file with its own
  schema. They were folded for another reason: one graded study's findings
  went in one pull request (PR 486 closes #388 only; its siblings became rows
  in #388's criteria).
- **The 5 neighbours on later reports all named the ticket whose lane the
  report came from, and that lane's pull request was already open:**
  - #444 named #397. #397's PR 443 opened 7 minutes before #444 was filed
    and merged 85 minutes after. The real target, #412, opened its PR 107
    minutes after.
  - #473 named #471. PR 472 opened 2 minutes before and merged 18 minutes
    after. The real target, #467, opened its PR 8 hours later.
  - #717 named #715 (one run). PR 716 opened 64 minutes before and merged 11
    minutes after. The real target, #714, opened its PR 49 minutes later.
  - In code terms each is a fair pick: the report is a gap in that change.
    But a fold into a pull request already in review, minutes from merging,
    would be lost, as 133 said of #717.
- **The 6 false folds were 3 tickets, both runs:** #575 into #573, #212 into
  #205, and #66 into #44 once and into #46 once. Each is a follow-up whose
  parent "has not landed yet" at the commit it read. The planner read "this
  needs that change" as "this is part of that change". In 5 of the 6, the
  parent's pull request was already open (PRs 574, 211 and 64).

```ts
// #575 (own PR 578, really), brief must, both runs:
{ joins: 573, why: "At this commit no suite declares its long timeout on its `describe`, so #573's work, … has not landed yet. These three code-graph files … are cases that sweep missed …" }
// #573's PR 574 had been open 26 minutes when #575 was filed, and merged 8 minutes later.
```

## The `unbuilt` arm: the wrong names were tickets already being built

- **It backs the cut, by its bar.** False folds on controls fell from 6 of 26
  to 1 of 26 (4%), and right folds stayed at 6 of 26.
- **The one false fold left** is #66 into #46, one run. #46 had no pull
  request yet; #66's real parent, #44, did.
- **The cut added no right fold.** With #397, #471 and #715 gone from the
  list, #444, #473 and #717 said "own", both runs. The real targets (#412,
  #467, #714) were in the list and the planner did not pick them. Real triage
  put #444 into #412 because #412 had the engine seam (the spot where the
  engine plugs in); the planner did not see that link.
- **14 cases had their list cut** (by 1 to 8 tickets); the other 12 kept
  `must`'s answers, since their prompt was the same.

```ts
// Sketch, not built: a fold question's list, cut in code first. A Gather from the ledger,
// which knows which lanes are already past plan.
const unbuilt = (open: readonly Listed[], prs: readonly Pr[], at: string) =>
	open.filter((t) => !prs.some((p) =>
		p.closes.includes(t.n) && p.createdAt <= at && (p.closedAt === null || p.closedAt > at)));
```

## Part B: the batch's first planner

| Head | Listed | Really in its pull request | A control with its own pull request | Planner carried, 2 runs |
|---|---|---|---|---|
| #388 | 9 | #389, #390, #391, #392 | | none / none |
| #411 | 18 | #413 | #412 | none / none |
| #423 | 31 | #422, #424, #425, #426 | #412 | none / none |
| #20 | 4 | #21 | | none / none |
| #467 | 24 | | #468 | none / none |
| #523 | 5 | | #524 | none / none |
| #45 | 15 | | #46 | none / none |
| #358 | 14 | | #360 | none / none |

- **It sinks, by its bar: 0 of 20.** The planner carried nothing, on any
  head, in any run. So it also carried no control (0 of 12) and nothing else.
  Same answer both runs on 8 of 8.
- **Its reasons are the same code reasons as in part A.** On #388: #389 and
  #390 add facts to the evidence file, #391 adds a new command, #392 writes a
  README section, "so each one stands as its own pull request". On #20: #21
  "adds a new public function, so it is better as its own follow-up pull
  request on top of this one".
- **So the side does not matter.** Asked from the newer ticket or from the
  head, with 1 to 3 code reads, the planner splits by code, and the real folds
  were not split by code.

## Cost

- **$5.87 for 99 answers in 99 calls.** The Check never sent a second try.
  2.72M tokens billed; the context at the last turn was 10k to 16k tokens.
  About 15 minutes of model time in all.
- **By arm:** `may` 3 answers, $0.26; `must` 52, $3.02; `unbuilt` 28 new,
  $1.61; part B 16, $0.98.
- **A median answer:** $0.069, 3 turns, 1 code read, 8 seconds, about 24k
  tokens billed. The first run of a case wrote the prompt cache, $0.07 to
  $0.12; the second read it, $0.01 to $0.06. A case, both runs: about $0.11.
- **The cheap shape costs what its bar asked:** a median answer is about a
  sixth of the $0.41 the bar named. That does not matter, since the answers do
  not back the lean.
- **`may` read no code** in 3 of 3 answers (2 turns each), so it was stopped
  after 3. `must` read 1 to 4 times.
- **Field:** 99 rows in `field/runs.jsonl`, note 2026-10-24-07.
- **One edit to the saved answers before publishing:** in 4 planner answers
  (`why` on #360 three times and on #494 once), one product name was replaced
  with `‹product›`. Nothing else in the results file was changed. The
  prompts carried the name as the tickets did; they are not saved.

## What this means

- **Keep "triage does not fold, for now"
  ([sort-answers-yes-or-no.md](../docs/direction/sort-answers-yes-or-no.md)),
  and do not give the planner a fold step either.**
  - Why: reading the code, the planner named the right ticket or a sibling 6
    of 26 times, against triage's 4. From the batch's own side it carried 0 of
    20. The bar asked for 13. Its reasons are true code facts; the real folds
    shared a study or a README, not a change.
  - Cost: the one the direction note names. A batch like #388 to #392 is five
    plans and five pull requests.
  - 80% sure. The doubt: one repo, four batches, mostly one filer. A repo
    whose batches really share a change might fold better.
- **The fold signal is not in the code, and not in the batch alone.** 4 of the
  13 controls were batch siblings filed within 4 seconds that shipped on their
  own. A guess, not measured: a bundle is the owner's call, which would make
  it an `ask` at plan approval, not a Draft. Under 60% sure. What would settle
  it: count how often demlik's owners bundled a same-study batch and how often
  they shipped it apart.
- **Wherever a fold question lives, cut tickets already being built from its
  list, in code.**
  - Why: 10 of 11 wrong names were such tickets, and the cut took false folds
    from 6 to 1 of 26 with no right fold lost.
  - Cost: one read of open pull requests and the issues they close; the ledger
    already knows which lanes are past plan.
  - 75% sure: 11 wrong names on 7 tickets is a small count.
- **Fold is not duplicate.** On #21 and #494 triage said duplicate, and the
  planner, with the code, said join. Today's direction closes a duplicate.
  #21 asked for a public helper #20 did not build, so a duplicate there would
  close real work. Two tickets: worth watching, not acting on. 60% sure.

## What it cannot tell us

- **The samples are small.** 13 folds, 13 controls, 8 heads. One more right
  fold moves the rate by 4 points.
- **One repo, mostly one filer.** 9 of the 13 folds came from four batches.
- **The answer key is what happened, not what was best.** It is 133's hand
  read. On some folds the planner's "own pull request" may be the better
  call; this run cannot tell.
- **The planner saw ticket openings, not plans.** Each listed ticket was its
  first 300 characters. A real plan's text might show a bundle more clearly.
- **It asked the fold question alone.** A planner deep in writing #388's plan,
  with more turns and more code read, might see more. Part B read the code 1
  to 3 times. Not measured.
- **`unbuilt` reused `must`'s answers on 12 cases** whose prompt was the same.
  A fresh draw could differ a little; `must` gave the same answer both runs on
  24 of 26.
- **"Sent to plan" is read from labels, "being built" from pull requests that
  close the ticket.** A pull request that only says "part of" is not counted.
- **Titles are today's**, as in 88 and 133.
- **Opus at effort medium only**, the plan stage's defaults.
