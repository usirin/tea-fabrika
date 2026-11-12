---
id: 0506
title: A fold is stored on the tile alone and keeps its size, the last open tile never folds, focus is always on an open tile, and programs know nothing about folds
status: accepted
date: 2026-10-28
tags: [ui, desk, fold, tiles, focus, keys, today]
---

# 0506: A fold is stored on the tile alone and keeps its size, the last open tile never folds, focus is always on an open tile, and programs know nothing about folds

```text
after Ctrl-B
f       fold the focused tile into a strip
Space   turn the focused tile's container: horizontal, then vertical
```

**What this decides:** how a tile folds into a strip and where focus goes, in today's version.

## Context

Folding keeps every tile in its place and in view as a strip. From
[fold, not tabs](../docs/direction/fold-not-tabs.md#what-changed).

## Decision

**A fold is a flag on a tile, and the desk keeps the rest.**

- A fold is stored on the tile alone, and the tile keeps its stored size. The open tiles beside it
  share the space the strips leave, so an unfold puts every size back.
- A container is folded when all its tiles are. That is worked out, never stored. It draws as one
  strip labeled with its tiles' names.
- The last open tile never folds, and a saved tree with nothing open is refused.
- Focus is always on an open tile. Moving desk focus onto a strip opens it; folding the focused
  tile moves focus to its neighbor. Folding the zoomed tile ends the zoom.
- Programs know nothing about folds. A strip shows its program's name.
- `C-b f` or a double-click on the title bar folds a tile. A single click only focuses it.
  `C-b Space` turns its container.

## Consequences

- Tab onto a strip shows its ring and does not move desk focus
  ([0503](0503-each-tile-is-one-region.md)).
