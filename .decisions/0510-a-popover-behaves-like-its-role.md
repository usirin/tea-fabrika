---
id: 0510
title: A popover behaves like its standard role, with focus moving in, Escape closing it and putting focus back, one open at a time, a calm open and an instant close
status: accepted
date: 2026-10-30
tags: [ui, popovers, aria, focus, motion, today]
---

# 0510: A popover behaves like its standard role, with focus moving in, Escape closing it and putting focus back, one open at a time, a calm open and an instant close

| Content | Role |
|---|---|
| rows that each do something | `menu` |
| the palette | `combobox` with a `listbox`, in a `dialog` |
| fields | `dialog` |
| a name | `tooltip` |

**What this decides:** how every popover acts, in today's version.

## Context

Custom popovers each handled focus and keys their own way. From
[popovers](../docs/direction/popovers.md#3-the-rule), with the palette's backdrop decided
2026-11-06.

## Decision

**Pick the role by the content, and behave as that role does.**

- Focus moves in; arrows move; Enter acts; Escape closes and puts focus back where it was; a click
  outside closes it; only one is open at a time.
- It opens over `--fast` with a fade and a 0.96 scale from its anchor, and closes at once with no
  fade. With reduced motion it fades only.
- The palette has no dim behind it: the desk stays inert under a backdrop that paints nothing
  (2026-11-06).
- A tooltip shows a name and its keys after 700 ms, 300 ms between neighbors, and also opens on
  keyboard focus.

## Consequences

- The parts run Zag's machines on Manti's anatomy ([0462](0462-popovers-drive-zag-directly.md)).
