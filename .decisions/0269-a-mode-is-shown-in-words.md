---
id: 0269
title: A mode is always shown in words, on the status bar, the tile's title and its accessible name, told to a screen reader on entry and exit, and the palette lists the mode's commands first
status: accepted
date: 2026-11-01
tags: [modes, accessibility, status-bar, palette, screen-reader, next]
---

# 0269: A mode is always shown in words, on the status bar, the tile's title and its accessible name, told to a screen reader on entry and exit, and the palette lists the mode's commands first

**What this decides:** how a person, and a screen reader, always knows a mode is on.

```text
no mode     t3 notes · reading                                      C-b ? keys
info        INFO · a workspace, named by what it holds               esc leaves
copy        COPY · v select · y yank · / search                      q or esc leaves
```

## Context

Decided by the owner in [modes](../docs/direction/modes.md) (M3). The note says "the bottom line";
the current word is the status bar. `next/`; today's version is not changed.

## Decision

**You always see a mode, in words.**

- The status bar leads with the mode's name as a word, then its keys, then the way out. It shows
  with the bars hidden too (85%).
- The tile's title bar and its accessible name say it too, as `t2 terminal · copy` and `, copy mode`.
- Color is never the only cue (WCAG 1.4.1).
- A screen reader is told when a mode starts and ends, through one polite `role="status"` region,
  and nothing on each hover (WCAG 4.1.3).
- In a mode, the palette lists that mode's commands first, in a group named for it. A command that
  cannot run now is left out, never shown dead (70%).

## Consequences

- One status region per window, and a mode word in three places.
- Needs a real run: VoiceOver and NVDA, with focus in a terminal's text box.
