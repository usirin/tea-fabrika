---
id: 0230
title: A replay re-runs code only, with agent drafts, people's words and check results as recorded inputs, never an agent
status: accepted
date: 2026-11-01
tags: [replay, agents, recorded-inputs, saved-state, layers]
---

# 0230: A replay re-runs code only, with agent drafts, people's words and check results as recorded inputs, never an agent

**What this decides:** what a replay may run again.

## Context

Decided by the owner on 2026-11-01, at 90%. A game records each player's input because it cannot
work it out again; Temporal replays workflow code against recorded results. An agent run is not
repeatable and costs money. See [saved state](../docs/direction/saved-state.md), S6.

## Decision

**A replay folds agent drafts, people's words and check results as recorded inputs, and re-runs
code only.**

- A replay runs with the agent service swapped for a Layer that answers only from recorded facts
  and fails on a call it has no record for.
- A draft whose content was deleted on a person's request cannot be replayed; that replay stops and
  says so.

## Consequences

- In today's version, a lane's facts keep outcomes, not drafts, so a replay cannot re-run review on
  the builder's text.
