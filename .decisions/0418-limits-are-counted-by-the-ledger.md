---
id: 0418
title: In today's version, saying no to a run is limits on its child spec, counted and enforced by the ledger, since a host can die mid-spend
status: accepted
date: 2026-10-21
tags: [limits, ledger, host, spend]
---

# 0418: In today's version, saying no to a run is limits on its child spec, counted and enforced by the ledger, since a host can die mid-spend

**What this decides:** who counts a run's spend and says no.

## Context

From the note "helpers, and one supervisor", since removed,
changed 2026-10-21 by experiment 102. Built in today's host (`setLimits` in `packages/fabrika/src/host/`).

## Decision

**The ledger keeps the count, because only the ledger outlives a host.**

- A run's limits sit on its child spec. A top-level name gets them from `setLimits`.
- The ledger counts and enforces them. The host only reports what it spent and checks before each
  turn.

## Consequences

- Not decided here: the same rule in `next/`, where a program gets hard walls by
  [0020](0020-programs-get-hard-walls.md) and a lane its budget by
  [0076](0076-a-lane-stops-at-its-budget.md).
