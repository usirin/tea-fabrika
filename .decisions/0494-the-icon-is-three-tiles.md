---
id: 0494
title: The app icon is always three gray tiles with an open gap, a middle tile narrower than the top, and only the top tile lit, with no hue, shadow, gradient, gloss, letters or tilt
status: accepted
date: 2026-11-01
tags: [ui, icon, brand, today]
---

# 0494: The app icon is always three gray tiles with an open gap, a middle tile narrower than the top, and only the top tile lit, with no hue, shadow, gradient, gloss, letters or tilt

```text
1024 canvas, 824 rounded square centered in it

  stem 128 x 500     top 224 x 128, lit
                     middle 150 x 128

gap 28 everywhere, corners 14
```

```ts
// At 32px and under: its own drawing on a 16-pixel grid.
stem   { x: 5, y: 3, w: 2, h: 10 }
top    { x: 8, y: 3, w: 4, h: 3 }   // lit
middle { x: 8, y: 7, w: 3, h: 3 }
```

**What this decides:** what the app's icon, Tile F, may and may not become. Today's version, and
built (`apps/fabrika/icon/icon.svg`).

## Context

The icon is three tiles spaced like the app's tiles, in a layout that spells F, with one lit as one
tile has focus. From [the app's icon](../docs/direction/app-icon.md#the-rules).

## Decision

**Tile F keeps its shape.**

- Always three tiles, never a fourth.
- The gap never closes.
- The middle tile stays narrower than the top one.
- Exactly one lit part, the top tile: never two, never none.
- No hue, since in the app a color means a pipe.
- No shadow, gradient or gloss, no letters added, no tilt.
- At 32px and under, it uses its own drawing on a 16-pixel grid. In a menu bar it goes in one
  color, the dim tiles at half strength, with no rounded square.

## Consequences

- A packaged app needs the small drawing too; there is no packaged app yet.
