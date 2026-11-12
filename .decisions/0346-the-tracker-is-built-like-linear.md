---
id: 0346
title: The tracker is built like Linear, a full issue tracker that grows toward Linear's model on purpose, never the smallest form that runs one lane
status: accepted
date: 2026-10-27
tags: [tracker, linear, assignee, milestone, pipeline]
---

# 0346: The tracker is built like Linear, a full issue tracker that grows toward Linear's model on purpose, never the smallest form that runs one lane

**What this decides:** the tracker aims at a whole Linear, each ticket has a person as its
assignee, and milestones are for people, never for the pipeline's decisions.

## Context

The owner decided this on 2026-10-27
([the tracker is like Linear](../docs/direction/the-tracker-is-like-linear.md)). It replaces the
2026-10-24 line "It is not a whole Linear" in
[tickets start in our tracker](../docs/direction/tickets-start-in-our-tracker.md), and, for the
tracker, the "left out until proven" list of
[the smallest ledger](../docs/direction/smallest-ledger-proof-to-grow.md). It is walked for `next/`
when Tier 2 starts.

## Decision

**The tracker is a full issue tracker in Linear's shape, the base the pipeline, milestones and
packs build on.**

- It grows toward Linear's model on purpose. No run is needed to justify each part.
- No pipeline step reads a milestone to decide. The tracker keeps milestones for people, and packs
  may read them.
- Every ticket has an assignee, a person, and the assignee's own host runs its lane, with that
  person's agents on that person's login.

## Consequences

- More tracker work comes before and around the pipeline: more fact kinds, more window.
- A thin tracker would make every pack invent its own fields; this avoids it.
- Which parts come first is the study in
  [tracker views are programs](../docs/direction/tracker-views-are-programs.md), still proposed
  outside its decided parts.
