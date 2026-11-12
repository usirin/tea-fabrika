---
id: 0359
title: In today's tracker, a row never repeats the area its view names, a saved view is a named filter, and picking an area is a menu, never a program
status: accepted
date: 2026-11-07
tags: [tracker, areas, rows, views, filter, menu, todays-version]
---

# 0359: In today's tracker, a row never repeats the area its view names, a saved view is a named filter, and picking an area is a menu, never a program

**What this decides:** three calls of the areas walk, taken as leaned: say the area once, keep
the picker in the tracker, and make every view tab a filter.

## Context

The owner decided A5, A6 and A7 together on 2026-11-07, as leaned
([areas, A5](../docs/direction/areas.md#a5-dont-say-it-twice),
[A6](../docs/direction/areas.md#a6-picking-an-area-is-a-menu-not-a-program-until-areas-have-a-job-of-their-own),
[A7](../docs/direction/areas.md#a7-a-saved-view-is-a-named-filter-never-a-title-search)).
Today's version.

## Decision

**Say the area once, pick it in a menu, and make every view a filter.**

- A row drops the area word when the view already names the area. On "All open" each row says its
  area. A guessed row keeps a small "?" where the word was dropped.
- Picking an area is a menu in the tracker. There is no `areas` program, until areas have a job of
  their own.
- A saved view is a named filter, `{name, filter}`. A view tab sets the same filter as the chip it
  shows and sends the same Msg as the `f` menu. No view matches title words.
- The current tab is filled and weight 500 and says `aria-selected` or `aria-pressed`, never color
  alone.

## Consequences

- The law of [0358](0358-one-area-filter-many-doors.md), that every door gives the same rows,
  covers the tab door too.
- If make, rename and merge grow (an owner per area, a description), an `areas` program may earn
  its place. A week of use after the build settles it.
