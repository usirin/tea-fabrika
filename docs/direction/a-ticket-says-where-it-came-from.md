---
state: "decided 2026-11-03, shape proposed; walked at Tier 2"
summary: "Today's version first. A filing records `from`: the pull request, review, run or walk it came out of, since only the filer knows it then. Tickets stay without a type label; area and project wait for experiment 205's designs."
---

# A ticket says where it came from

**Decided 2026-11-03 by the owner,** from [experiment 205](../../experiments/205-organizing-work.md):
a ticket records where it came from, at filing, and tickets stay without a type label. The
shape of `from` below is **proposed**: the plan for its ticket settles it. Today's version
first; `next/`'s tracker carries the same key when it is built. Walked when Tier 2 starts (owner, 2026-11-08): filing tickets with their source kept.

Its decided rules are in: [0348](../../.decisions/0348-a-filing-records-its-source.md),
[0369](../../.decisions/0369-no-kind-label-ships-or-routes.md).

```ts
// A sketch, not built. A filing says where it came from. Effect Schema writes `_tag`.
{type: "filed", title: "Mutation runner: sandbox links node_modules ...", body: "...",
 from: {_tag: "pr", url: "https://github.com/usirin/tea-fabrika/pull/352", step: "mutation"}}
{type: "filed", title: "Lane checks fail when the repo path has a space", body: "...",
 from: {_tag: "run", ticket: 117, run: "lane 6", head: "<sha>"}}
{type: "filed", title: "Desk settings: reuse and place", body: "...",
 from: {_tag: "walk", pr: 332}}
// No `from`: a person filed it from nothing, or it was filed before the key existed.
```

## What was decided

- **`from` is written at filing.** Only the filer knows, at that moment, which pull request,
  review, mutation step, lane run or walk a ticket came out of. Today that lives in the body's
  prose, when the filer bothers. A later reader cannot get it back. By the data rule in
  `AGENTS.md`, a fact that exists only when something is written goes in now.
- **No type label, for now.** [Sort answers yes or no](./sort-answers-yes-or-no.md) keeps its
  rule: no ticket-kind label enters the ledger. What a ticket needs next is already said by
  sort's `plan`, `ruling` or `research`. Experiment 205 found that a type would be for a person
  scanning the list, not for the pipeline. We add it only if the owner misses it.
- **Area and project wait** for the rest of experiment 205's walk and its designs.

## Why `from`

- The makers' closest match is a follow-up work order in maintenance software: it "points back"
  at the job it came from and takes its asset (experiment 205, [o4]). None of the agent tools
  the study read files its own follow-ups, so there is no software default to copy.
- Our agents already file follow-ups: tickets 186 to 195 all came out of a pull request, a
  review, a run or a walk, and each says so only in prose.
- `from` keeps the meaning it already has here: a plan's story says which ticket it came from
  with `from` ([experiment 105](../../experiments/105-the-plan-lane-dry-run.md)).

## How sure

About 85% that `from` is right to record now. The doubt is the shape: which cases the union
needs (a job, a daily check, another ticket), and whether a `run` names its head. The plan for
the ticket settles that, against the 10 agent-filed tickets we have.

## What this cannot tell us

- Whether a person filing by hand will ever fill `from`. Agents will, because their brief says
  so; a person may not.
- Whether we will miss a type label. That shows only after weeks of scanning the list without one.
