---
id: 0278
title: In next/, each window runs the prefix itself with no network wait, a binding on a key its backend cannot have fails at load, and every command also has a shell word and a palette entry
status: accepted
date: 2026-10-31
tags: [desktop, keys, prefix, backends, palette, shell, next]
---

# 0278: In next/, each window runs the prefix itself with no network wait, a binding on a key its backend cannot have fails at load, and every command also has a shell word and a palette entry

**What this decides:** where the prefix key is handled, and what happens to a key a window cannot
own.

```ts
// Ctrl-B arms only the window it was pressed in. That window sends one finished command.
{type: "did", does: "split_right"}
const browser = {cannot: ["Mod-W", "Mod-T", "Mod-N", "Mod-Q"]};
const electron = {cannot: ["Cmd-Q", "Cmd-H"]};
```

## Context

Decided by the owner in [the desktop layer](../docs/direction/the-desktop-layer.md) (W5). How sure:
70%; the doubt is that "Ctrl-C over a program" reads a desk that may be a moment old.

## Decision

**Keys are the window's, and no command depends on one key.**

- Each window runs the prefix itself, as tmux keeps a key table per client, with no network wait
  after the prefix and one copy of it.
- A binding on a key the backend cannot have fails at load, never with a warning.
- Every command also has a shell word and a palette entry, so losing a key never loses a command
  (85%).
- Where Linear's keys clash with ours, the prefix wins.

## Consequences

- The old desktop's double-key bug cannot come back.
- A test with a slow fake link would settle the 70%.
