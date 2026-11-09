---
id: 0002
title: A decision moved into `.decisions/` leaves only a one-line link where it came from, never a second copy
status: accepted
date: 2026-11-09
tags: [decisions, docs, backfill]
---

# 0002: A decision moved into `.decisions/` leaves only a one-line link where it came from, never a second copy

**What this decides:** when a decision moves into `.decisions/`, its text is removed from its old
home, and that spot keeps a one-line link to the decision file.

## Context

[0001](./0001-decisions-live-in-the-repo.md) makes `.decisions/` the home of every decision. Older
decisions still sit in `docs/direction/` notes, AGENTS.md and the skills. If a moved decision stays
in both places, the two copies drift, and an agent cannot tell which one is the rule.

## Decision

**A decision lives in one place: its `.decisions/` file.**

- When a decision moves in, in the backfill or later, its text is removed from where it came from:
  a `docs/direction/` note, AGENTS.md or a skill.
- That spot keeps only a one-line link to the decision file.
- A long design note keeps its reasoning and its code. Only the decided rules themselves leave it.

## Consequences

- Each move is a small edit in two places, in one PR.
- AGENTS.md and the skills get shorter as decisions move out.
