---
id: 0484
title: y takes the rec, n refuses it with a required note even when the rec is the pause, o opens every pick, each key has a button, and the keys work only where the inbox has focus
status: accepted
date: 2026-11-02
tags: [ui, asks, keys, inbox]
---

# 0484: y takes the rec, n refuses it with a required note even when the rec is the pause, o opens every pick, each key has a button, and the keys work only where the inbox has focus

```ts
// n is "not the rec", always.
spend, rec "stop"   -> n takes "more", and the note says why
```

**What this decides:** the keys that answer an ask, in both versions.

## Context

Most asks should be one key. From
[the ask desk](../docs/direction/ask-desk.md#a3-three-keys-a-button-for-each-and-only-where-focus-is),
A3 and call 1.

## Decision

**Three keys, a button for each, and only where focus is.**

- `y` takes the rec.
- `n` means "not the rec", on every kind, even when the rec is the pause. With two picks it takes
  the other; with more it opens the rest. Either way a one-line note says why, and it goes to the
  step that runs next.
- `o` lists every pick by number, the rec included.
- Every key has a button with the key printed on it that does the same.
- The keys work only while one of the inbox's views has focus.

## Consequences

- On a spend ask, `n` spends money after a typed note: a speed bump, not one press.
