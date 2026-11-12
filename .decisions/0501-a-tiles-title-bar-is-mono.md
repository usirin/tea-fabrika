---
id: 0501
title: A tile's title bar is a 20px mono header with no tab stop and no line under it, slot, name and state word then the id, where the name cuts first and the id and state never
status: accepted
date: 2026-11-01
tags: [ui, tiles, title-bar, mono, today]
---

# 0501: A tile's title bar is a 20px mono header with no tab stop and no line under it, slot, name and state word then the id, where the name cuts first and the id and state never

```text
[A] ticket #7 · closing                    t2
 slot  name      state word                id (far right, tabular digits)
```

**What this decides:** the parts and order of a tile's title bar, in today's version.

## Context

The title bar was a button with no action, a dead tab stop, and its name differed from the status
bar's. From [tile guidelines](../docs/direction/tile-guidelines.md#title-bar).

## Decision

**A title bar names the tile and holds its marks.**

- A `header`, not a `button`, 20px high, with no tab stop and no line under it.
- Slot, program name, state word, then the id at the far right. The id and the state are never cut;
  the name cuts first.
- The title bars stay mono, as the top bar and the status bar do. A study of one program never
  changes them (2026-11-02).
- The program name uses the same words as the status bar's `tileWord`: `ticket #7`, `tracker`,
  `tsh`.
- A pipe tile shows its letter in the slot, on its wash, and a plain tile a dot, so a name never
  moves when a tile joins or leaves a pipe ([0477](0477-a-pipe-is-marked-by-a-wash.md)).
- It never carries the app's icon.

## Consequences

- An agent's presence avatar joins the bar by the id; the
  [shared tiles](../docs/direction/shared-tiles.md#presence-the-avatar-says-who-the-presence-label-says-where)
  rule of 2026-11-07 adds it.
