---
id: 0503
title: Each open tile is one named region inside one main, reached by C-b o, C-b ; and F6, with desk focus following DOM focus and a fold or close sending focus to the next open tile in reading order
status: accepted
date: 2026-11-01
tags: [ui, tiles, keys, focus, landmarks, accessibility, today]
---

# 0503: Each open tile is one named region inside one main, reached by C-b o, C-b ; and F6, with desk focus following DOM focus and a fold or close sending focus to the next open tile in reading order

```text
main (.workspace)
  region "tracker, t1, pipe A, 1 of 2, sends to ticket"
  region "ticket #7, t2, pipe A, 2 of 2"
  button "trace" (a folded tile: not a region)
```

**What this decides:** a tile's landmark, how the keyboard moves between tiles, and where focus
lands, in today's version.

## Context

Tab could leave a tile while its edge stayed lit, and a tsh tile was two regions. From
[tile guidelines](../docs/direction/tile-guidelines.md#a-tile-is-a-region).

## Decision

**A tile is a region, and every tile is reached by keys.**

- Each open tile is one named region inside one `main`. A folded tile is a button in place, not a
  region. A covered terminal goes `inert`.
- `C-b o` and `C-b ;` move to the next tile and the tile focused before, as tmux means them. F6 and
  Shift-F6 cycle the open tiles, then the bars, and skip strips; Tab stops on strips. `C-b [` moves
  focus to a terminal's text.
- Desk focus follows DOM focus. A fold or close sends focus to the next open tile in reading order;
  an unfold, to the first tile it opens. Each tile remembers its last inner spot, by a stable key.
- A tile's accessible name comes from one function, `tileName`, program first.
- Tiles resize by keys too, `C-b C-arrow` and `C-b M-arrow`, listed in the palette, and a resize
  says its percent.
- A tile has no motion: state changes are instant.

## Consequences

- A terminal keeps Tab for tsh; `C-b` or F6 leaves it, which WCAG 2.1.2 allows when the way out is
  told.
- The divider is focusable only in resize mode ([0492](0492-the-divider-and-resize-mode.md)).
- Whether a tile opened with content sends focus back to the tile it came from on close is open:
  the ask desk says so and clashes with this rule ([0481](0481-a-tile-opened-with-content.md)).
