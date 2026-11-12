---
id: 0270
title: Escape leaves every mode, the load refuses a mode with no way out, the prefix and F6 work in every mode, and leaving keeps your work, never on a timer
status: accepted
date: 2026-11-01
tags: [modes, escape, keys, accessibility, wcag, next]
---

# 0270: Escape leaves every mode, the load refuses a mode with no way out, the prefix and F6 work in every mode, and leaving keeps your work, never on a timer

**What this decides:** that no mode can trap a person.

## Context

Decided by the owner in [modes](../docs/direction/modes.md) (M4). The no-way-out refusal was decided
before, in PR 282. The prefix and F6 rule is the same one [0265](0265-one-modal-esc-peels-the-top.md)
gives for layers. `next/`; today's version is not changed.

## Decision

**You always get out.**

- Escape leaves every mode a program defines, beside any other key the program picks (85%).
- The load refuses a mode with no way out.
- The prefix and F6 work in every mode, so a mode never keeps the keys (WCAG 2.1.2).
- Leaving a mode keeps your work: in editing, Escape saves, then reads (65%: a person who meant
  cancel may expect no save; the draft is never lost either way).
- A mode never ends on a timer (WCAG 2.2.1).

## Consequences

- Escape no longer reaches a tile's own content while a mode is on.
