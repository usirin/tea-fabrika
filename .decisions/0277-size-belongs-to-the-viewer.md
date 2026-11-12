---
id: 0277
title: In next/, a process never knows its screen size, the layout is in percent, one per workspace, each window folds it to its own size and picks its own workspace, and focus stays per workspace
status: accepted
date: 2026-10-31
tags: [desktop, layout, workspace, focus, size, tmux, next]
---

# 0277: In next/, a process never knows its screen size, the layout is in percent, one per workspace, each window folds it to its own size and picks its own workspace, and focus stays per workspace

**What this decides:** who owns size and focus when two windows look at one desk.

```ts
type Workspace = { n: 1; layout: Split; focus: TileId }; // one focus: two windows on it mirror
type Split = { dir: "row" | "column"; parts: { percent: number; inner: Split | Tile }[] };
```

## Context

Decided by the owner in [the desktop layer](../docs/direction/the-desktop-layer.md) (W4).

## Decision

**Size belongs to the viewer.**

- A process never knows its screen size. Shell output is lines, and every program draws with a
  React view.
- The layout tree is in percent, one per workspace, never pixels or columns. Each window folds what
  does not fit its own size.
- Each window picks its own workspace, and focus stays per workspace, so two windows on one
  workspace mirror, as in tmux.
- We keep our own drag code, never react-resizable-panels.

## Consequences

- A fast follow only if two windows on one workspace annoy: focus per window with a last-used list,
  and an opt-in follow.
