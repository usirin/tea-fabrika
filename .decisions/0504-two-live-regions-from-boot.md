---
id: 0504
title: A screen reader is told through one polite and one assertive region that exist from boot, joining bursts into one line and never mirroring the screen
status: accepted
date: 2026-11-01
tags: [ui, tiles, screen-reader, live-regions, accessibility, today]
---

# 0504: A screen reader is told through one polite and one assertive region that exist from boot, joining bursts into one line and never mirroring the screen

| Event | Region | Words |
|---|---|---|
| The close question | assertive | `close t2? (y/n)` |
| Closing | polite | `t2 closing` |
| A program ends, unfocused tile | polite | `tracker in t2 ended` |
| Fold; zoom; resize | polite | `ticket folded`; `t2 zoomed`; `t2 at 42%` |
| Output, typing, focus moves | none | nothing |

**What this decides:** how the desk speaks to a screen reader, in today's version.

## Context

A live region made with its content may not speak, and one was. From
[tile guidelines](../docs/direction/tile-guidelines.md#what-a-screen-reader-is-told).

## Decision

**Two regions, made empty at boot.**

- One polite region and one assertive region (`role="alert"`) are in the page from boot.
- Bursts join into one line (WCAG 4.1.3). If focus moves to the thing, say nothing.
- Never mirror the screen: output, typing and focus moves are not announced.

## Consequences

- A real screen reader run is still a person's job ([0476](0476-the-owners-look-is-aimed.md)).
