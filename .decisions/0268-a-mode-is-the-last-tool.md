---
id: 0268
title: A mode is the last tool, only for several commands in a row on one thing, and never a held letter, only held modifiers
status: accepted
date: 2026-11-01
tags: [modes, keys, ux, next]
---

# 0268: A mode is the last tool, only for several commands in a row on one thing, and never a held letter, only held modifiers

**What this decides:** when a program may add a mode at all.

```text
the job                                   the tool
one command                               a command: a key, the palette, a shell word
one choice, then back                     the prefix, or a popover: one key and done
a peek while you hold a key               a held modifier, as Shift
several commands in a row on one thing    a mode: copy, select, resize, editing, info
```

## Context

Decided by the owner in [modes](../docs/direction/modes.md) (M1), after Tesler, Apple and NN/g on
modes. `next/`; today's version is not changed.

## Decision

**No mode first.**

- A mode is only for several commands in a row on one thing, where the same keys would otherwise
  mean something else (75%).
- Never a held letter: it repeats into a terminal, a window that loses focus never hears it come up,
  and Sticky Keys turns it into a toggle. Only modifiers (60%).

## Consequences

- Copy mode, a resize, editing and info mode pass the test; a single confirm does not.
