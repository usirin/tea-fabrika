---
id: 0271
title: A program has one mode at a time, never a stack, a popover is not a mode, and a mode is window state that stays with its tile, never on the ledger, gone on an app restart
status: accepted
date: 2026-11-01
tags: [modes, popovers, focus, window-state, ledger, next]
---

# 0271: A program has one mode at a time, never a stack, a popover is not a mode, and a mode is window state that stays with its tile, never on the ledger, gone on an app restart

**What this decides:** how many modes can be on, and where a mode lives and how long.

```text
the event          a tile's mode (copy, editing)          the desk's mode (info, resize)
focus moves        stays with its tile; its title says so  stays on
another window     not there: each window its own          not there
app restart        gone: window state is not kept           gone
```

## Context

Decided by the owner in [modes](../docs/direction/modes.md) (M5, M6 and what the ledger records).
What a hot reload does to a mode follows [0294](0294-a-window-swaps-its-view-by-hash.md). `next/`;
today's version is not changed.

## Decision

**One mode per program, and a mode stays where it lives.**

- `mode()` returns one value, so a program is never in two modes; a step inside a mode is state in
  it. Never a stack (70%).
- With two programs in modes (the desk and a tile), one Escape leaves one, the desk's first.
- A popover is not a mode: focus moves into it, and Escape and a click outside close it.
- A mode stays with its tile when focus moves, is not shared with another window, and is gone on an
  app restart (70%).
- A mode is window state, never on the ledger or in program storage. Entering and leaving are
  recorded only as the commands' `did` rows.

## Consequences

- How long a mode lasted rebuilds from the `did` rows.
- Not known: whether people forget a tile is in a mode once they move away.
