---
id: 0493
title: Zoom alone is tile zoom, a tile's y or n is the close question and ask is only what an agent or a step asks, line is a tsh line or a line of text, and a screen reader hears a tile's accessible name
status: accepted
date: 2026-11-03
tags: [ui, frame, names, glossary, today]
---

# 0493: Zoom alone is tile zoom, a tile's y or n is the close question and ask is only what an agent or a step asks, line is a tsh line or a line of text, and a screen reader hears a tile's accessible name

**What this decides:** the smaller frame words that had two or more meanings, in today's version
first.

## Context

The asks count and the tile's "asking marker" sat on one screen and meant different things. From
[the frame](../docs/direction/the-frame.md#11-zoom-means-three-things), clashes 11 to 14.

## Decision

**Each word keeps one meaning.**

- "Zoom" alone is tile zoom (`C-b z`). Page zoom and window zoom are always written in full.
- A tile's y or n is the close question; its mark is the question marker, and `Open.ask` becomes
  `question`. "Ask" means only what an agent or a step asks a person.
- "Line" means a tsh line or a plain line of text. The top bar's "the line" shows the tsh line.
- The hidden-bars flag is `barsHidden` in code, never `bare`.
- What a screen reader hears entering a tile is its accessible name. The title bar's word is the
  program name, never "the region's name".

## Consequences

- "Item lines" stays: they are lines of text.
