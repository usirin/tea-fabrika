---
id: 0397
title: A step reads the facts fresh at the moment it acts and runs alone from a small input, an id, and it ends by writing exactly one fact
status: accepted
date: 2026-10-11
tags: [pipeline, steps, ledger, testing]
---

# 0397: A step reads the facts fresh at the moment it acts and runs alone from a small input, an id, and it ends by writing exactly one fact

**What this decides:** what a step may trust, how small its input is, and how it ends.

## Context

From [read fresh, run alone](../docs/direction/read-fresh-run-alone.md#what-was-decided), decided
2026-10-11 while sketching the ship machine. Between a review passing and the merge, a commit can
be pushed, checks can go red, or main can move.

## Decision

**A step trusts its own read, never its parent's memory.**

- A step reads the facts fresh at the moment it acts. When a fresh read and a remembered fact
  disagree, the fresh read wins.
- Every step machine can run alone. Its input is small, an id, never a bundle of facts gathered
  earlier; it reads the rest itself. Each step has a way to be run alone, and tests that run it so.
- Reading twice is fine. A step still ends by writing exactly one fact to the ledger.

## Consequences

- A step started by a parent and one started by hand on one id behave the same.
