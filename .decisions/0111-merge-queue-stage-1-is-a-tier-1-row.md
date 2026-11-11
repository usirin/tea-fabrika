---
id: 0111
title: The merge queue's first stage is a Tier 1 row, P43, as the pipeline's thin slice for landing changes, never left to Tier 6
status: accepted
date: 2026-11-11
tags: [tiers, plan, next, merge-queue, pipeline, slice, tier-1, p43]
---

# 0111: The merge queue's first stage is a Tier 1 row, P43, as the pipeline's thin slice for landing changes, never left to Tier 6

**What this decides:** the merge queue's first stage, "works", is built in Tier 1, as its own row.

## Context

The owner decided this on 2026-11-11. Tracker ticket 765 holds it.

- [0068](0068-tiers-carry-every-part.md) and [0078](0078-agent-and-flow-slices-start-early.md) put a
  thin working slice of every core idea in Tier 1, the pipeline included: a flow fabrika runs gets
  its slice there, and the full pipeline stays in Tier 6.
- [0107](0107-fabrika-provides-the-merge-queue.md) makes the merge queue a fabrika primitive, and
  [0110](0110-merge-queue-is-fabrika-programs.md) gives its shape: one queue program and one
  merger per change, which talk by mail, built in three stages, works, better and secure.
- Without a row, the queue would wait for Tier 6, where the pipeline's stages land.

## Decision

**The merge queue's first stage is Tier 1 row P43, as small as it can be and still work.**

- P43 builds stage 1 only: one queue program holds the line, and one merger per change
  brings it up to date with main, waits for its checks on that head and merges through `CodeHost`.
  One merger at a time.
- It is the pipeline's thin slice for landing changes, under the core idea of a flow fabrika runs.
- Later stages harden it in later tiers: Tier 6 adds batches, a cheap lane and a record of wait
  times, and the signing stage comes after.
- It gets its own plan before a builder starts, as every Tier 1 row does.
- 0068's rules for a slice hold: no stub, no dead path, and it records now what a later stage needs.

## Consequences

- Tier 1 grows from 43 rows to 44, with P43 not planned or sized.
- It leans on P41's later slices, mail between instances
  ([0103](0103-a-program-may-mail-another-by-name.md)), and on P34c, restart and recovery. Until both
  land, 0110 says the queue cannot be trusted with main.
- [The tiers](../docs/plan/tiers.md), [Tier 1](../docs/plan/tier-1.md),
  [the plan](../docs/plan/README.md) and `AGENTS.md` change their counts with it
  ([0013](0013-plan-docs-change-with-the-work.md)).
- Not decided here: P43's size, its place in the waves, and whether 0078's own flow slice, a saved
  list of typed steps handed to fabrika as data, folds into it or keeps a row of its own.
