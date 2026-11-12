---
id: 0497
title: Every key change says in words what it took, before and after Save, in one live region, with Undo
status: accepted
date: 2026-11-01
tags: [ui, keys, keybindings, accessibility]
---

# 0497: Every key change says in words what it took, before and after Save, in one live region, with Undo

```text
before Save   the row says "Takes it from Split"
after Save    "Saved to keybindings.toml · Split lost ⌃B |"   [Undo]
```

**What this decides:** what a person is told when a new key binding takes a key from another
command, in both versions.

## Context

A clash between bindings was settled silently. Decided in keybindings (the new binding wins, said
in words, with Undo); restated in [keys editor](../docs/direction/keys-editor.md#e4-every-change-says-what-it-took-in-words-with-undo),
E4.

## Decision

**The new binding wins, and the editor says so.**

- Before Save the row says what the change takes, and from which command.
- After Save the line under the list says what was saved and what lost its key, with Undo.
- One live region says it in words. The keycaps are one named image, so a screen reader hears
  "ctrl+b then |", not the glyphs.

## Consequences

- A law checks the words, not only the saved file.
