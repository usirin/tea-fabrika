---
id: 0478
title: A pipe's color says which pipe and nothing else, from six hues far from every state color, in a fixed order, counted per workspace
status: accepted
date: 2026-11-01
tags: [ui, pipes, color, today]
---

# 0478: A pipe's color says which pipe and nothing else, from six hues far from every state color, in a fixed order, counted per workspace

```ts
const PipeColors = ["sky", "pink", "teal", "violet", "lime", "plum"] as const;
```

**What this decides:** which colors pipes get and in what order, in today's version.

## Context

Three of the old six tints sat on amber, red and green, the state colors. From
[pipe colors](../docs/direction/pipe-colors.md#the-rule).

## Decision

**Six pipe colors, each meaning only "this pipe".**

- No pipe hue sits near a state color (done, running, stuck, your turn), and none is warm.
- The first pipes get the first colors, in an order that keeps neighbors far apart: sky, pink, teal,
  violet, lime, plum.
- A seventh pipe repeats a color, and its letter stays its own.
- Colors are counted per workspace, never across all of them.

## Consequences

- Moving a tile to another workspace can bring two pipes of one color together; the letter tells
  them apart.
