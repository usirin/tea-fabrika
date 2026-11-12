---
id: 0294
title: In next/, a window takes a program's new view code from the brain by hash on code.loaded, never from Vite, and keeps its model when the new schema decodes it, else rebuilds only that tile
status: accepted
date: 2026-11-01
tags: [hot-reload, window, view, browser, modes, next]
---

# 0294: In next/, a window takes a program's new view code from the brain by hash on code.loaded, never from Vite, and keeps its model when the new schema decodes it, else rebuilds only that tile

**What this decides:** how a window gets new view code, so an open draft survives a save.

```ts
// A sketch. The window's own machine hears the event through a Sub.
{type: "code_loaded", program: "counter", window: "a71c3e..."}
// fits     -> swap the view, keep the window model (an open note draft stays open)
// no fit   -> rebuild that one tile from the brain at its rev; nothing else reloads
```

## Context

Approved by the owner on its own, at 60%, in [hot reload](../docs/direction/hot-reload.md#the-window).
A browser tab on Cloudflare has no dev server, so the window cannot take code from Vite. The import
by hash is a one-line platform edge ([no Promises](../docs/direction/no-promises.md)).

## Decision

**The window swaps a view the way a process swaps its code.**

- On `code.loaded`, a window imports that program's view by hash from the brain, never from Vite.
- It keeps its window model when the new view's schema decodes it; else it rebuilds only that tile.
- A mode in that model stays with its window, or goes to `null` with a line saying so
  ([0271](0271-one-mode-per-program.md)).

## Consequences

- The brain serves each program's window bundle by hash.
- A first build of the counter tile settles the 60%.
