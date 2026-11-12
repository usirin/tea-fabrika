---
id: 0508
title: Closing one tile of a line ends only its process, upstream fails on its next send and downstream keeps what it last had, and a program on a line sends the ticket it is on by number at each change
status: accepted
date: 2026-10-28
tags: [ui, desk, lines, pipes, processes, today]
---

# 0508: Closing one tile of a line ends only its process, upstream fails on its next send and downstream keeps what it last had, and a program on a line sends the ticket it is on by number at each change

| The line tracker, ticket, trace: the ticket's tile closes | What happens |
|---|---|
| ticket | its inputs end; it ends on its own, and its tile goes |
| tracker (upstream) | goes on; its next pick fails: the pipe answered stopped |
| trace (downstream) | its input ends; it keeps showing the last ticket |

**What this decides:** what closing one of a line's tiles ends, and what the line's pipe carries,
in today's version.

## Context

The person closed one tile; ending more would take away tiles they did not ask to close. The tmux
rule was decided 2026-10-25 and applied to lines on 2026-10-28. From
[fold, not tabs](../docs/direction/fold-not-tabs.md#a-lines-windows-close-one-by-one).

## Decision

**One tile, one process, and Unix pipe rules for the rest.**

- `x` asks the close question; `y` ends the one process the tile holds, as tmux's `kill-pane`.
- Its neighbors follow the pipe rules: upstream fails on its next send (SIGPIPE), downstream keeps
  what it last had, as `tail` does.
- The typed-in tile is the line's: closing it ends tsh and every process of the line.
- A program on a line sends the ticket it is on, by number, at each change: the latest pick, never
  a stream. A ticket's writes name their ticket.

## Consequences

- In `next/` a pipe is saved program mail ([0109](0109-a-pipe-is-saved-program-mail.md)); this
  file is today's version.
