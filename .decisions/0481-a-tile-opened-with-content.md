---
id: 0481
title: A tile opened with content takes half the focused tile's share after it, folding its row's others under 220px, and takes focus on the same selection
status: accepted
date: 2026-11-02
tags: [ui, tiles, focus, inbox, today]
---

# 0481: A tile opened with content takes half the focused tile's share after it, folding its row's others under 220px, and takes focus on the same selection

**What this decides:** where a tile lands when a program opens it with content, and where focus
goes, in today's app first.

## Context

"Open all" was the first thing in the app to open a tile with content. From
[the ask desk](../docs/direction/ask-desk.md#opening-a-tile-with-content).

## Decision

**A tile opened with content lands beside the focused tile and takes focus.**

- It takes half of the focused tile's share, after it, side by side. In a row it is a sibling; in a
  column it nests. A zoom ends first.
- If it would be under 220px wide, the others in its row fold, the tile it came from last.
- The handoff: the popover closes and the new tile is focused, on the same selection.

## Consequences

- Where focus goes when that tile closes is not decided here: the ask desk's way back and the tile
  guidelines' next tile in reading order clash, and the owner picks.
