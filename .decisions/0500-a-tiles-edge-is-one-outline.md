---
id: 0500
title: A tile is ours on Manti's names, its edge one 1px outline at slate a4 at rest and the focus token on the one focused tile, and hovering a tile changes nothing
status: accepted
date: 2026-11-01
tags: [ui, tiles, tokens, focus, contrast, today]
---

# 0500: A tile is ours on Manti's names, its edge one 1px outline at slate a4 at rest and the focus token on the one focused tile, and hovering a tile changes nothing

```css
/* A sketch from the note. */
.tile, .strip { outline: 1px solid var(--tile-edge); outline-offset: -1px; } /* box-shadow dies in forced colors */
.titlebar, .strip { background: var(--tile-wash); color: var(--tile-text); } /* no line under the title */
.tile.focused { outline-color: var(--tile-edge-on); }                          /* reads --focus */
```

**What this decides:** a tile's edge and its focused and hovered looks, in today's version.

## Context

Tile edges were box-shadows that vanish in forced colors, and focus had a text step with no weight.
From [tile guidelines](../docs/direction/tile-guidelines.md#tokens), changed 2026-11-08 for the one
slate a9 focus.

## Decision

**One outline, one focused tile, and a quiet hover.**

- A tile is ours, not a Manti part. Its tokens point at Manti's names.
- The resting edge is slate a4 on every tile, plain or pipe. Only focus and hover take a pipe's
  color.
- The edge is one 1px `outline`, never a box-shadow. Nothing draws a second line around it.
- `--text-faint` takes slate a11, never a10, which falls short of 4.5:1.
- One tile per workspace is focused. Its edge goes to the focus token, slate a9 in both looks
  (pipes keep their own focus steps); its title wash to step 3; its name to step 12 at weight 500.
  Its body stays plain.
- Hovering a tile changes nothing. Only title bar text, a strip and a divider answer, and hover
  never moves focus.
- Under more contrast the resting edge is slate a8, text a12 and focus a11 at 2px. In forced colors
  edges are `CanvasText` and focus is 2px `Highlight`.

## Consequences

- Built in the token files: `text-faint.toml` is slate a11, and `tile-edge-on` reads `--focus`
  ([0452](0452-a-token-means-one-thing.md)).
