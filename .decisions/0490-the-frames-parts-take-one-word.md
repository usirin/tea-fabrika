---
id: 0490
title: The frame's parts take one word each, frame, popover and menu, status bar, toolbar and key hints, never chassis, popup, bottom line or panel
status: accepted
date: 2026-11-03
tags: [ui, frame, names, glossary, today]
---

# 0490: The frame's parts take one word each, frame, popover and menu, status bar, toolbar and key hints, never chassis, popup, bottom line or panel

| Today's word | The word |
|---|---|
| chassis | frame |
| popup | popover; a menu when each row acts |
| bottom line | status bar |
| action bar, keys line | toolbar; unpressable keys are key hints |
| `Panel`, keys panel | item lines popover, shortcuts list |

**What this decides:** the words for the parts of the window the app draws. Decided as words for
today's version; one rename pass puts them in code.

## Context

One part had up to five names across notes and code. From
[the frame](../docs/direction/the-frame.md#1-frame-and-chassis), clashes 1 to 4 and 8. The glossary
holds each word under Frame.

## Decision

**One part, one word.**

- The frame is everything the app draws that is not a program's view: the bars, each tile's title
  bar, edge, strips and dividers, and what opens over the tiles. Never "chassis".
- A popover is the box; a menu is a popover whose rows each do something. "Popup" survives only as
  ARIA's `aria-haspopup`.
- The one line under the tiles is the status bar. "Status line" means one line about one thing, and
  "footer" only a popover's last row.
- A toolbar is a row of buttons built from a program's `commands` with their keys printed on them.
  Keys that nothing presses are key hints. Never "action bar" or "keys line".
- No frame part is called a panel.

## Consequences

- Today's code still says `.bottomline`, `Panel` and `bare`; the rename pass changes about 120 lines
  in `apps/fabrika`.
