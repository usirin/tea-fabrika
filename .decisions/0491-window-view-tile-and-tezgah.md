---
id: 0491
title: Window means the OS window, a program draws a view and a line's programs show in tiles, Tuval's window manager is tezgah and never desk, and glance keeps the inbox's meaning
status: accepted
date: 2026-11-03
tags: [ui, frame, names, glossary, tezgah, today, next]
---

# 0491: Window means the OS window, a program draws a view and a line's programs show in tiles, Tuval's window manager is tezgah and never desk, and glance keeps the inbox's meaning

| Word | Means | Never |
|---|---|---|
| window | the OS window, and the client that draws it | what a program draws |
| view | what a program draws | window |
| tile | one rectangle of a workspace; a line's programs show in tiles | a line's windows |
| tezgah | Tuval's window manager; `next/`'s `fabrika/tezgah` | desk |
| desktop | only layer 5 | the window manager |
| inbox | the inbox program, the old ask desk; the owner's desk is the inbox | ask desk |
| glance | the inbox program's small view in the top bar | the tracker's `Status` |
| menu bar extra | in `next/`, the app's icon in macOS's menu bar | menu bar |

**What this decides:** the words for the window, the window manager and what sits on them, in both
versions.

## Context

"Window" meant four things and "desk" five. From
[the frame](../docs/direction/the-frame.md#5-glance-means-two-things), clashes 5, 6, 7 and 9. The
glossary holds each word.

## Decision

**Each of these words keeps one meaning.**

- Window means the OS window and the client that draws it. What a program draws is its view, and a
  line's windows are its tiles.
- Tuval's window manager is tezgah, never desk. Desktop is only layer 5. The ask desk is the inbox
  program, and the owner's desk is the inbox.
- Glance keeps the inbox program's meaning, and the tracker's `Glance` becomes `Status`.
- In `next/`, the app's icon in macOS's menu bar is the menu bar extra, never "menu bar".

## Consequences

- Older notes still say "window" for a line's tiles and `fabrika/desk`; the words here win.
