---
id: 0388
title: An agent hour is one agent's wall clock from a run's start to its end, summed, failed runs in and drivers out, and a ticket's spent is folded from its run facts, never typed
status: accepted
date: 2026-11-01
tags: [size, agent-hours, tracker, records]
---

# 0388: An agent hour is one agent's wall clock from a run's start to its end, summed, failed runs in and drivers out, and a ticket's spent is folded from its run facts, never typed

```ts
// A sketch, from the note. Never written: folded from the ticket's started and ended facts.
type Spent = {
  readonly hours: number; // every run's minutes over 60, failed runs too
  readonly active: number | null; // working time beside wall, null until runs record it
  readonly runs: number;
  readonly failed: number;
  readonly open: number; // started and never ended: unknown, never zero
};
```

**What this decides:** the unit work is sized in, and how a ticket's real size is counted.

## Context

From [agent hours](../docs/direction/agent-hours.md#the-name), H1, H2, H3 and H5, decided by the
owner 2026-11-01 from experiment 187. AGENTS.md says to size work in agent hours; this says what one
is. Today's tracker first, then `next/`'s with `_tag`.

## Decision

**A ticket's size is an `estimate` in agent hours, and its actual is `spent`; never story points
or a vendor's unit such as ACUs.**

- An agent hour is one agent's wall clock from a run's start to its end. Runs add up: two agents
  for one hour spend two agent hours.
- Every run on the work counts, failed ones too. An agent that only drives others never counts,
  since its clock covers theirs.
- `spent` is wall clock with waits, for now. Active time, when a run can say it, is recorded
  beside it.
- `spent` is folded from the ticket's `started` and `ended` facts and never typed. A run that
  never ended shows as open, never as zero.

## Consequences

- The estimate is [0389](0389-an-estimate-is-on-a-doubling-scale.md); what a run records is
  [0390](0390-a-run-records-ticket-and-pr-apart.md).
- A lane's budget is in steps and dollars ([0076](0076-a-lane-stops-at-its-budget.md)); that is a
  stop rule, not this size.
