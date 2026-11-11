---
id: 0106
title: Tests stay on the pull request, and a pull request's checks finish in five minutes at most
status: accepted
date: 2026-11-11
tags: [ci, tests, speed, pull-request, budget]
---

# 0106: Tests stay on the pull request, and a pull request's checks finish in five minutes at most

**What this decides:** where tests run, and how long a pull request may wait for them.

## Context

A study of which work belongs in a lane, a queue or a loop on a timer asked whether tests could
move off the pull request, since main runs the full suite after every merge. Measured on
2026-11-11, a pull request's checks took about 12.5 minutes, running only the tests that reach a
changed file. The owner ruled the same day: tests stay, and 12 minutes is not fast. At this stage,
with few parts working together yet, a pull request should not wait that long.

[Fast and daily mutation](../docs/direction/fast-and-daily-mutation.md) already lists what never
moves off the pull request. This decision adds a time budget to it.

## Decision

**A pull request's checks finish within five minutes, from push to the last required check.**

- Tests run on the pull request, before the merge. They do not move to a schedule.
- Five minutes is the budget for the whole set of required checks on a pull request, not for one
  job.
- When the checks take longer, the fix is to the cause: a slow test file is split or rewritten, a
  setup step is cached or removed, work that judges shared state and not this change moves to a
  loop. A check is never dropped or loosened to meet the budget.
- The budget is measured from CI's own run times on merged pull requests and reported, so a
  regression is seen the week it happens.

## Consequences

- The slowest jobs are found and fixed first. One known floor is a single lead-script test file
  with a median of 689 seconds on the slowest machine (tracker ticket 559).
- Until the checks meet the budget, the number is a target that work is aimed at, not a gate that
  fails a pull request.
- Not decided here: the budget for the full suite on main after a merge.
