---
id: 0482
title: Every ask a person owes sits in one queue, oldest first and same-kind asks together, with its count and minutes on top
status: accepted
date: 2026-11-02
tags: [ui, asks, inbox, queue]
---

# 0482: Every ask a person owes sits in one queue, oldest first and same-kind asks together, with its count and minutes on top

```ts
// Runs of one kind together, the oldest kind first.
[approve #117, approve #141, merge #117]
```

**What this decides:** the order of the asks a person answers, in both versions.

## Context

Asks were spread over tickets, and a person could not see how long the queue would take. From
[the ask desk](../docs/direction/ask-desk.md#a1-one-queue-a-list-beside-the-selected-ask), A1 and
call 4.

## Decision

**One queue across every ticket and repository.**

- Every ask a person owes is in it, oldest first.
- Same-kind asks run together, the oldest kind first; the oldest ask still leads its group.
- The top says how many and about how long ("4 asks, 1 stop · about 2 min"). The minutes come from
  the person's own past answers per kind; until a kind has 20, 30 seconds a kind, marked "about".
- One source feeds the top bar, the badge, the glance and the tile, so they cannot tell two
  stories. After an answer, the next ask is selected and focus stays where it was.

## Consequences

- Grouping bends a strict first in, first out; nobody measured it on reading speed yet.
