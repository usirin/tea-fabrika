---
id: 0414
title: A new Jev question asked at volume is measured against hand labels written before the run and controls, and a saved agent turn counts the person's plan quota as well as dollars
status: accepted
date: 2026-10-28
tags: [jev, judge, measurement, cost]
---

# 0414: A new Jev question asked at volume is measured against hand labels written before the run and controls, and a saved agent turn counts the person's plan quota as well as dollars

```ts
// A sketch, from the note: the duplicate hint, asked on every filing.
const scores = yield* scoresOf(filed, candidatesOf(filed, openOf(tickets, filed.number)));
hintsOf(scores); // [{of: 6, yes: 0.78}]: advice, with accept and dismiss
```

**What this decides:** how a Jev use that no agent ever asked is measured, and what an agent turn
costs.

## Context

From [Jev, changed 2026-10-28](../docs/direction/jev-same-answer-cheaper.md#changed-2026-10-28),
decided with the first live use, the duplicate hint ([experiment 167](../experiments/167-duplicate-hint.md)):
1,638 calls for $0.05.

## Decision

**A question asked only because a call is cheap has no agent answer to agree with.**

- It is measured against hand labels written before the run, for the hits, and controls, for the
  false alarms. The rest of [0412](0412-jev-is-measured-by-agreement.md) and
  [0413](0413-a-jev-question-is-narrow.md) holds: a floor per question, advice not an action, never
  a person removed.
- Each person runs agents on their own plan, so a saved agent turn counts twice: the dollars, and
  the turns left in that person's plan quota.

## Consequences

- How much a turn costs in quota is not measured; providers set and change plan limits.
