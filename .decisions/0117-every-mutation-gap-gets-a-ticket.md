---
id: 0117
title: Every real mutation gap becomes a tracker ticket the hour it is found, with no daily cap
status: accepted
date: 2026-11-11
tags: [mutation, tracker, schedule, tickets, cap]
---

# 0117: Every real mutation gap becomes a tracker ticket the hour it is found, with no daily cap

**What this decides:** the hourly mutation run files a ticket for every file with a real gap, and
the limit of three tickets a day is gone.

## Context

[0066](0066-mutation-runs-on-a-schedule.md) moved mutation to an hourly run on main and said a real
gap becomes "one tracker ticket per file, at most three a day". The cap came in with the plan and
was never a call the owner made. By 2026-11-11 it held 15 files of real gaps in a list outside the
repo and outside the tracker, and at three a day some would still be held when the trial ends on
2026-11-17. A gap that sits in a side list is knowledge in the wrong place: the tracker is what
remembers work. This amends 0066 in part; the rest of 0066 stands.

## Decision

**Every file with a real gap gets its ticket in the run that found it. Nothing is held back.**

- The hourly run files one tracker ticket per file with a real gap, in the usual shape, with its
  category ([0077](0077-mutation-gaps-carry-a-category.md)). No count limits how many a run or a
  day may file.
- No gap is kept in a list outside the tracker. The gaps held under the old cap are filed now,
  oldest first.
- Noise is still counted and not filed, and a narrowing is still filed as a ticket marked
  loosening, as 0066 says.
- The tests-step ticket for a category at two or more gaps ([0077](0077-mutation-gaps-carry-a-category.md))
  is unchanged.

## Consequences

- A day with many merges can add many tickets. Each carries its category, so the tracker can
  group them.
- The count of tickets no longer hides how many gaps the run finds: the two numbers are the same.
- Not decided here: whether gaps of one category in one run fold into one ticket. Today each file
  gets its own.
