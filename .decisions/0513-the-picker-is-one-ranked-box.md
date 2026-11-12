---
id: 0513
title: The picker is one box of fixed groups ranked by word-start match, then open work, then newest, where an exact id goes on top and the selected row never moves when rows arrive late
status: accepted
date: 2026-11-07
tags: [ui, picker, ranking, selection, next]
---

# 0513: The picker is one box of fixed groups ranked by word-start match, then open work, then newest, where an exact id goes on top and the selected row never moves when rows arrive late

```text
(empty)        Commands (5), Recent (5)
"split"        Commands, Tickets, Tiles, Traces, fabsh, Ask: top 5 each, plus "All 23 tickets"
#193           an exact ticket id: #193 on top, above Commands, selected
#bug-17        # and a letter: a room
```

**What this decides:** how the picker's rows are grouped, ranked and selected, in `next/`.

## Context

Late rows moved the selection under the person's Enter. From
[pickers](../docs/direction/picker-guidelines.md#q2-one-box-commands-first-5-per-group), Q2, Q3,
Q7 and smaller call 1.

## Decision

**One box, fixed groups, and a selection that stays put.**

- Empty, the box shows Commands then Recent. Typed, every source is a group in one fixed order,
  each with 5 rows and an "All N" row that narrows the box to that program.
- Rows rank by word-start match, then open work, then newest.
- An exactly typed id, in any case, puts every row with that id on top, above Commands. Never on a
  partial match. The desk does this from the rows' ids; no program writes it.
- `#` and a digit is a ticket id; `#` and a letter is a room.
- The selection is a row id. Rows that arrive late land below it or in their own group; only typing
  resets it to the top match.

## Consequences

- A property test holds the selection rule.
- 5 rows a group is a lean a day of use settles.
