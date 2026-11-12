---
id: 0460
title: Mono is only for what a person types or reads as code, so an agent's id, a ticket number and a cost are sans, while the frame's bars keep their monospace
status: accepted
date: 2026-11-02
tags: [design, typography, mono, frame]
---

# 0460: Mono is only for what a person types or reads as code, so an agent's id, a ticket number and a cost are sans, while the frame's bars keep their monospace

```css
/* The frame: the top bar and the status bar, like tmux. Stays mono. Today's class names. */
.topbar, .bottomline { font: 400 var(--fs-small) / 1 var(--mono); }

/* What opens over it and a program's view: the product's own sans. */
.pop, .palette, .tooltip, .dialog { font: 400 var(--fs-body) / 1.4 var(--font); }

/* Inside them, mono only for typed things. */
.pop code { font-family: var(--mono); }
```

**What this decides:** where the monospace font may appear, in both versions.

## Context

Ids, costs and ticket numbers were mono, so the product read as terminal text. Decided for what
opens over the desk in [popovers](../docs/direction/popovers.md#3-the-rule) (2026-10-30), and for
every program's text in [typography](../docs/direction/typography.md#t6-mono-only-for-typed-words),
T6.

## Decision

**Mono marks what a person types or reads as code; everything else is sans.**

- Mono is for a command, a path, a hash, a branch, code and backticked words in a title.
- An agent's id, a ticket number, a tile name, a key, a time and a cost are sans, with tabular
  digits where numbers line up.
- The frame is the exception: the top bar, the status bar and the tiles' title bars stay
  monospace, as tmux's are. They are the frame; what a program draws and what opens over the desk
  is the product.
- The text styles carry no font family, so a text style is always sans.

## Consequences

- Today's agent id, Activity's cost and the ticket number break it; each moves to sans when its
  program is touched.
- A later lint on `.mono` and `var(--mono)` outside typed spans holds it.
