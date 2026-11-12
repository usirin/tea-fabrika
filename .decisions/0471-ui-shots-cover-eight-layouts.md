---
id: 0471
title: UI shots cover eight layouts, AGENTS.md's five plus 200% text zoom on the 2x2, the smallest tile and 400% reflow, in both looks, with content states run in the 2x2 grid
status: accepted
date: 2026-11-07
tags: [ui, verification, layouts, shots, accessibility]
---

# 0471: UI shots cover eight layouts, AGENTS.md's five plus 200% text zoom on the 2x2, the smallest tile and 400% reflow, in both looks, with content states run in the 2x2 grid

```text
the five      one tile, side by side, stacked, a 2x2 grid, a small app window (about 1024x700)
plus three    200% text zoom on the 2x2 (WCAG 1.4.4)
              the smallest tile the desk allows
              one tile at 400% zoom in a 1280-wide window, no sideways scroll (WCAG 1.4.10)
content       empty, a very long name, a long list: in the 2x2 grid, not layouts
x             dark and light, for every layout and content state
```

**What this decides:** which layouts and states every window is shot and checked in, in both
versions.

## Context

A window that looks right in five layouts can still break at text zoom or in the smallest tile.
From [UI verification](../docs/direction/ui-verification.md#u3-eight-layouts-and-the-content-states-both-looks-every-time),
U3, grown from AGENTS.md's "Shoot more than one layout".

## Decision

**Eight layouts and the content states, both looks, every time.**

- The eight are the five from AGENTS.md, plus 200% text zoom on the 2x2 grid, the smallest tile
  the desk allows, and reflow: one tile at 400% zoom in a 1280-wide window.
- A terminal tile is exempt from reflow, as WCAG 1.4.10 exempts content that needs two dimensions.
- A window's content states (empty, a very long name, a long list) are listed in its test and run
  in the 2x2 grid. They are not layouts.
- Both looks apply to every layout and every content state.

## Consequences

- The note's older lines ("the four tile layouts at the default window, and the same four at the
  small window", a four-value `Layout`) predate this and are not the rule.
