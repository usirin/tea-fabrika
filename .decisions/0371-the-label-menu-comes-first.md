---
id: 0371
title: In next/'s tracker, the label menu and the chips with a typed line are built first, both writing one labeled, and the menu is Manti's Combobox patched to take groups
status: accepted
date: 2026-11-06
tags: [tracker, labels, menu, manti, combobox, build-order, next]
---

# 0371: In next/'s tracker, the label menu and the chips with a typed line are built first, both writing one labeled, and the menu is Manti's Combobox patched to take groups

**What this decides:** which label designs are built first, and that the menu is built on Manti
with one change sent upstream.

```text
D1   l on the Labels row: the label menu, groups as sections, Area first as radio items
D4   chips in the ticket tile, plus a fabsh line: label 193 area=pipeline +flaky -stale
     both write one labeled {add, drop}
D2   bulk accept of guesses in the list: the second slice
```

## Context

The owner decided this on 2026-11-06, from experiment 218's designs, and the Manti part was
corrected the same day
([label guidelines, the design to build first](../docs/direction/label-guidelines.md#the-design-to-build-first)).
The note says "a tsh line"; `next/`'s shell is `fabsh`. `next/`.

## Decision

**D1 and D4 first, D2 second, on Manti.**

- D1, the label menu in the ticket, and D4, chips plus a typed line with Tab completing names, are
  built first. Both write the same `labeled`.
- D2, bulk accept of guesses, comes second, once guessing at filing exists. Its select all uses
  Manti's `Checkbox` `indeterminate`, so it needs no Manti change.
- The menu is Manti's `Combobox` inside a `Popover`. Manti 0.13.0's items take a string label
  only, so we patch `Combobox` with `pnpm patch` to take groups and custom row content, and send
  the same change to Manti by pull request.
- The picker needs the same change, so one Manti change serves both.

## Consequences

- D3, a labels tile, is mostly the decided filter and adds little over `--label` and `--area`;
  make, rename and merge stay in D1's menu.
- Two look fixes the D1 reshoot found go into the build: the first down arrow skips the picked
  item, and the menu shifts left after a swap.
