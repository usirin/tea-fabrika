---
id: 0458
title: What a person acts on is the loudest text in its block, text ranks by size then weight in two grays, and the element sets the meaning while the text style sets the look
status: accepted
date: 2026-11-02
tags: [design, typography, hierarchy, color, accessibility]
---

# 0458: What a person acts on is the loudest text in its block, text ranks by size then weight in two grays, and the element sets the meaning while the text style sets the look

**What this decides:** how text ranks inside a block, in both versions.

## Context

Questions shouted louder than the answer a person acts on, and headings were picked by size. From
[typography](../docs/direction/typography.md#t2-what-you-act-on-leads-its-block), T2 to T4. T3 was
decided first in color principles and themes (2026-11-01).

## Decision

**Rank follows what a person acts on.**

- What a person acts on is the loudest text in its block. The question that frames it steps down a
  rank.
- Text ranks by size, then weight, in two grays: step 12 and the low step, never a third. Manti's
  `subtle` gets no text style.
- The element sets the meaning and the text style sets the look. Headings follow the page's
  outline, never a wanted size.

## Consequences

- An `h2` may wear `strong` and an answer under it `heading`, as the ask's rec does.
