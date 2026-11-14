---
id: 0165
title: In next/, each tile keeps a cursor, the place inside it where focus last sat, and focus coming back to the tile lands there, never back at the top
status: accepted
date: 2026-11-13
tags: [desktop, cursor, focus, tile, accessibility, keyboard, screen-reader, tmux, next]
---

# 0165: In next/, each tile keeps a cursor, the place inside it where focus last sat, and focus coming back to the tile lands there, never back at the top

**What this decides:** where focus lands when a person returns to a tile: the tile's cursor, the place they left, not the top.

```ts
// A sketch, not the shape. Who keeps `cursor` is not decided.
type Tile = {
  id: TileId;
  shows: Program;
  cursor: Cursor | null; // null: never focused, so land at the top
};
// Focus has two levels.
// 1. Between tiles: one per workspace (0277).
// 2. Inside a tile: the tile's own cursor (this file).
```

## Context

The owner decided this for `next/` on 2026-11-13. It adds a second level to the focus rule in
[0277](0277-size-belongs-to-the-viewer.md). There, focus between tiles is one per workspace, so two
windows on one workspace mirror. The desk's own state is a process in the brain
([0274](0274-the-desktop-is-a-platform-free-core.md)).

Today's version already has the rule. [0503](0503-each-tile-is-one-region.md) says each tile
remembers its last inner spot, by a stable key, from
[tile guidelines](../docs/direction/tile-guidelines.md). Today's version calls it the "last inner
spot"; `next/` calls it the cursor. `next/` read the rule as a lesson only. This file makes it a rule
in `next/` too.

The reason is accessibility. A person on a keyboard or a screen reader should not have to find
their place again each time they switch tiles.

Known ways, each read at its source on 2026-11-13:

- **WAI-ARIA Authoring Practices, toolbar pattern.** Its keyboard section says that when a toolbar
  has held focus before, focus may go back to the control that last had focus. It says "optionally",
  so it is allowed, not required. It also says the first time in, focus goes to the first enabled
  control. [Toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/).
- **WCAG 2.4.3 Focus Order (level A).** It asks that keyboard users meet content in an order that
  keeps its meaning and works from the keyboard, so they can form a steady mental model. It does not
  say where focus must land on return. We cite it for the intent only.
  [Understanding 2.4.3](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html).
- **tmux.** Each pane keeps its own cursor, so switching panes brings you back where you were. This
  is common knowledge of the tool.

## Decision

**Each tile keeps a cursor, the place inside it where focus last sat, and focus returns there.**

- A tile that has had focus keeps a cursor. Focus coming back to the tile lands on it.
- A cursor is named by a stable key, as in 0503, so a view that is drawn again can find it.
- A tile that never had focus has no cursor yet. Focus lands at the top, as the toolbar pattern does the
  first time in.
- Two levels: focus between tiles (0277) and the cursor inside a tile (this file).
- This needs a real screen reader run before it is called done.

**Binding constraints**

- Returning to a tile never resets it to the top.

## Consequences

- A person who switches away and back finds their place again.
- A cursor may point at something that is gone when focus returns. What to do then is not decided.
- The name is `cursor`, named by the owner on 2026-11-13. `spot` already means something else in the
  glossary, the thing a person points an agent at. `cursor` is tmux's own word for this, since each
  pane keeps its cursor, and editors and lists use it the same way. In a terminal tile it is the
  terminal's own text cursor, the same idea. The word was free in `next/` and in the glossary, which
  now has its row.

**Not decided here:**

- Who keeps the cursor: the desk's process, or each program's own model.
- Who gives a cursor its stable key: the program's view, or the desk.
- Whether two windows on one workspace share a tile's cursor, as they share focus.
- How a focus move fits [0278](0278-each-window-runs-its-own-prefix.md)'s "no network wait".
