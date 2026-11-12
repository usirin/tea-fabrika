---
id: 0361
title: In today's tracker, a view tab exists only for an area a person pinned, and pins are each person's own
status: accepted
date: 2026-11-04
tags: [tracker, areas, tabs, pins, person, todays-version]
---

# 0361: In today's tracker, a view tab exists only for an area a person pinned, and pins are each person's own

**What this decides:** the tab row is All open, the reader's pinned areas, then "No area yet", and
one person's pins never change another's tabs.

```text
f menu row      Pin as tab | Unpin
ledger          area_pinned {area}, area_unpinned {area}   by says whose; the tracker folds only the reader's
tab row         All open · Pipeline · Desk · No area yet
```

## Context

The owner decided this on 2026-11-04, against the lean of a tab for every area while the row fits
([areas, call 4](../docs/direction/areas.md#4-which-areas-get-a-view-tab)). Linear's favorites are
each person's own. Today's version.

## Decision

**A tab only for an area a person pinned.**

- The tabs are All open, the pinned areas, then "No area yet". Every other area is reached through
  the `f` filter.
- Pins are each person's own: two person facts, `area_pinned {area}` and `area_unpinned {area}`.
  The ledger's `by` says whose, and the tracker folds only the reader's.
- "Pin as tab" and "Unpin" sit on an `f` menu row.

## Consequences

- Ledger order never decides what a person sees in the tab row.
