---
id: 0496
title: The keys editor is one searchable list in a tile, opened by C-b ? and keys alike, and the keyboard map is a second view of the same keys program, never a box over the tiles
status: accepted
date: 2026-11-08
tags: [ui, keys, keys-editor, tiles, today, next]
---

# 0496: The keys editor is one searchable list in a tile, opened by C-b ? and keys alike, and the keyboard map is a second view of the same keys program, never a box over the tiles

```ts
// A sketch from the note: one program, one model, two views.
type View = { _tag: "list" } | { _tag: "map"; layout: KeyboardLayout; physical: PhysicalLayout };
```

**What this decides:** where the keys editor opens and what it shows. Today's app builds it first;
`next/`'s `keys` program (K3, Tier 2) takes the same principles.

## Context

`C-b ?` opened a box over the tiles, covering what the person was working on. From
[keys editor](../docs/direction/keys-editor.md#e1-a-tile-not-a-box-over-the-tiles), E1, E2 and E5,
after four designs were shot next to Linear.

## Decision

**The keys editor is a program in a tile.**

- `C-b ?` and `keys` both open it as a program in a tile. Nothing of it covers another tile. This
  replaces the shortcuts list in the palette's box.
- It is one searchable list of every command, with or without a key, grouped by program and then
  mode. Each row: the command's name in sans on the left, a "Changed" word when it is yours, and its
  keys as keycaps on the right. Nothing else on the row.
- The keyboard map is a second view of the same `keys` program, `keys --map`: one model drawn two
  ways, never a second program.
- When the map does not fit a tile, zoom (`C-b z`) and fold are the way out. A narrow tile drops the
  names from the caps and marks a bound key by its fill and bold letter.

## Consequences

- The list is PR 1 and the map PR 2 of the same program.
- Older notes that put the keys panel in the palette (popovers, picker guidelines, the frame) are
  replaced on this point.
