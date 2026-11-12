---
id: 0367
title: In next/'s tracker, a label group that grows an owner, a date or a rule that acts graduates to its own concept, keeping its label numbers
status: accepted
date: 2026-11-06
tags: [tracker, labels, graduation, concepts, next]
---

# 0367: In next/'s tracker, a label group that grows an owner, a date or a rule that acts graduates to its own concept, keeping its label numbers

**What this decides:** the day a group needs behavior, it stops being labels and becomes facts of
its own, and no ticket moves.

## Context

The owner decided L6 on 2026-11-06, lean 70%
([label guidelines, L6](../docs/direction/label-guidelines.md#l6-a-label-that-grows-behavior-graduates-to-its-own-concept)).
Jira's components have owners and auto-assign, and its labels have neither. `next/`.

## Decision

**Behavior graduates a group out of labels.**

- A group that needs an owner, a default assignee, a strategy, a date or a rule that acts becomes
  its own facts.
- Its labels keep their numbers, so no ticket moves. As OTP's `code_change` moves state to a new
  shape, one fold reads the old label facts into the new concept's state.

## Consequences

- When a group graduates is taste; that its numbers carry over is a law.
- Whether a strategy belongs to the area is the open call of
  [pipeline strategies](../docs/direction/pipeline-strategies.md). A yes graduates Area on day one.
