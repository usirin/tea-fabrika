---
id: 0516
title: Each pick is recorded as one picked fact with its query, scope, row, rank, via and sentAt, and its query stays deletable
status: accepted
date: 2026-11-07
tags: [picker, ledger, record-wide, next]
---

# 0516: Each pick is recorded as one picked fact with its query, scope, row, rank, via and sentAt, and its query stays deletable

```ts
{ _tag: "picked", query, scope, row, rank, via, sentAt } // the ledger adds its own arrivedAt
```

**What this decides:** what the ledger keeps of each pick, in `next/`.

## Context

What people typed and what they took exists only at the pick, and a ranker that learns needs it.
From [pickers](../docs/direction/picker-guidelines.md#what-the-ledger-records), and record wide
(AGENTS.md).

## Decision

**One `picked` fact per pick.**

- It holds the query, the scope, the row, its rank, `via` and the writer's `sentAt`; the ledger adds
  `arrivedAt`.
- The query is content a person may want gone, so it stays deletable.
- A message sent from the box and a Run line are recorded by their own owners; `picked` records only
  that a row was picked.

## Consequences

- Nothing reads it yet; a learning ranker is a later idea.
