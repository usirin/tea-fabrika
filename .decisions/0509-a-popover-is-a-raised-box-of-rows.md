---
id: 0509
title: What opens over the desk wears the views' font and colors with no tokens of its own, and a popover is a raised box of rows, each saying one thing in sentence case, never a blank box
status: accepted
date: 2026-10-30
tags: [ui, popovers, menus, typography, today]
---

# 0509: What opens over the desk wears the views' font and colors with no tokens of its own, and a popover is a raised box of rows, each saying one thing in sentence case, never a blank box

```css
/* A sketch from the note, today's token names. */
.pop { background: var(--surface-raised); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 4px; }
.pop .row { height: 32px; }       /* one line */
.pop .row.two { height: 44px; }   /* two lines */
.pop .row[aria-selected="true"] { background: var(--surface-hover); }
```

**What this decides:** the look of every popover, menu and the palette, in today's version
(`apps/fabrika/src/window/`).

## Context

The old asks list read as terminal text. From
[popovers](../docs/direction/popovers.md#3-the-rule) and [what the build decided](../docs/direction/popovers.md#9-what-the-build-decided).

## Decision

**What opens over the desk is the product, in the views' own type and color.**

- It uses the views' `--font`, the `--fs-*` scale and their colors. No type or color token of its
  own.
- A popover is a raised box of rows: `--surface-raised`, a 1px `--border`, `--r-lg` and 4px
  padding. Rows are 32px for one line and 44px for two.
- One row says one thing: an icon for its state (never color alone), a title at weight 500, one
  muted line under it, and the time or the row's keys at the right.
- Text inside a popover is sentence case, never title case.
- A popover is never a blank box: with no rows it shows one calm line and what to expect.
- Mono inside it only for typed things ([0460](0460-mono-only-for-typed-words.md)).

## Consequences

- The token names follow the rename ([0451](0451-tokens-take-four-tiers-one-grammar.md)).
