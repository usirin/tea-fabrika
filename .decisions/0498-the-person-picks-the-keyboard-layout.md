---
id: 0498
title: The person picks the keyboard layout and the physical layout, with Colemak-DH and Colemak-DHm as separate picks, and the system's layout is only a first guess
status: accepted
date: 2026-11-08
tags: [ui, keys, keyboard-layout, settings]
---

# 0498: The person picks the keyboard layout and the physical layout, with Colemak-DH and Colemak-DHm as separate picks, and the system's layout is only a first guess

```ts
// A sketch from the note.
type KeyboardLayout = "qwerty" | "colemak" | "colemak-dh" | "colemak-dhm" | "dvorak" | "azerty";
type PhysicalLayout = "rows" | "corne"; // row-staggered, or split columns: 3x6 and 3 thumbs a side
```

**What this decides:** whose keyboard the keyboard map is drawn on, in both versions.

## Context

A map drawn on QWERTY is wrong for anyone on another layout. From
[keys editor](../docs/direction/keys-editor.md#keys-editor), decided before the walk.

## Decision

**The keyboard map is drawn on the person's own layouts.**

- The person picks the keyboard layout (which character each key types) and the physical layout
  (where the keys sit).
- Colemak-DH and Colemak-DHm are separate picks.
- The system's keyboard layout is only a first guess.

## Consequences

- Reading a Vial `.vil` file is a later idea, not decided.
- Where the picks are stored is a smaller call the note leaves open.
