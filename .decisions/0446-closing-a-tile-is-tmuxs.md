---
id: 0446
title: In today's version, closing a tile is tmux's, Ctrl-B x always asks and ends inputs before it stops anything, and & starts a background job as in bash, brought in by attach
status: accepted
date: 2026-10-25
tags: [app, tiles, jobs, tmux, bash, close, todays-version]
---

# 0446: In today's version, closing a tile is tmux's, Ctrl-B x always asks and ends inputs before it stops anything, and & starts a background job as in bash, brought in by attach

```mermaid
stateDiagram-v2
  [*] --> open
  open --> asked: Ctrl-B x
  asked --> open: any key but y
  asked --> closing: y, something runs
  asked --> [*]: y, nothing runs
  closing --> [*]: its programs end
  closing --> stop_asked: Ctrl-B x
  stop_asked --> [*]: y, stop now
  stop_asked --> closing: any key but y
```

**What this decides:** what closing a tile ends, and how a job goes to the background and back.

## Context

A tile owns its tsh, as a pane owns its shell, so Tuval's close, which only let go of a view, does
not fit. From [Tuval and tmux decide](../docs/direction/the-gui-is-electron-first.md#decided-2026-10-25-later-tuval-and-tmux-decide-the-host-runs-apart).
It replaced the earlier lean that `&` opens a tile beside. Today's code: `apps/fabrika/src/desk/desk.ts`.

## Decision

**Ctrl-B x always asks y or n, and only y says yes.**

- y gives the tile's tsh and the programs it started the end of their inputs. The tile shows
  "closing" until they end, then goes. There is no timer.
- Ctrl-B x on a closing tile asks to stop them now.
- Runs shown in other tiles are left alone.
- `&` starts a job in the background, as in bash, and nothing opens. `attach %n` brings it into the
  tile, as `fg` does.

## Consequences

- A program that ignores the end of its inputs (`sleep`) keeps its tile closing until the second
  question.
