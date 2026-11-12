---
id: 0477
title: A pipe is marked by its title wash and a letter, step 2 of its color at rest and step 3 focused, with no box change, and a plain tile washes the same in slate with a dot
status: accepted
date: 2026-11-01
tags: [ui, pipes, color, tiles, accessibility, today]
---

# 0477: A pipe is marked by its title wash and a letter, step 2 of its color at rest and step 3 focused, with no box change, and a plain tile washes the same in slate with a dot

```ts
// A sketch from the note. Radix Colors 3.0.0, the dark alpha scales.
const plain = { rest: "slateA2", focused: "slateA3", edge: "slateA9", mark: "dot" };
const pipe = (color: PipeColor, letter: string) => ({
  rest: `${color}A2`,
  focused: `${color}A3`,
  edge: `${color}A8`,
  mark: letter, // A, B, C... drawn in slateA12 beside the name
});
```

**What this decides:** how a tile shows which pipe it is on, in today's version. `next/` takes it
as a lesson.

## Context

The old line tints sat on state colors and changed nothing but a faint fill. From
[pipe colors](../docs/direction/pipe-colors.md#the-rule).

## Decision

**The title bar carries the pipe.**

- A tile's title is filled with step 2 of its color at rest and step 3 when focused. A plain tile
  does the same in slate.
- The box does not change: no rule line under a washed title, and tile sizes and dividers stay as
  they are.
- A folded strip gets the same wash and letter.
- Color is never the only cue (WCAG 1.4.1). Each pipe tile shows its letter, and a plain tile shows
  a small dot in the same slot.

## Consequences

- Built in today's app: `[data-pipe]` in `apps/fabrika/src/window/window.css`. The note's "not
  built yet" is stale.
