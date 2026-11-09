---
id: 0009
title: An imported theme derives its six gray tokens from its own palette, never fixed Radix slate steps
status: accepted
date: 2026-11-09
tags: [themes, color, import, contrast]
---

# 0009: An imported theme derives its six gray tokens from its own palette, never fixed Radix slate steps

**What this decides:** when a theme is imported, six tokens that a theme file has no name for are
computed from that theme's own colors, not copied from Radix slate.

## Context

[Themes](../docs/direction/themes.md) lists seven tokens a brought theme cannot set:
`--surface-selected`, `--border`, `--border-strong`, `--wire`, `--focus`, `--turn-fill-hover` and
`--scrim`. Left alone they stay fixed Radix slate steps, and fixed grays clash with a strongly colored
theme. The themes lane raised it as question T13 (tracker ticket 343). The contrast floors in
[color principles](../docs/direction/color-principles.md) still apply. No accepted decision covers it.

## Decision

**An imported theme derives `surface-selected`, `border`, `border-strong`, `wire`, `scrim` and
`turn-fill-hover` from its own palette colors, never from fixed Radix slate steps.**

- The derivation runs at import, with repair, and lands in the theme's written file.
- Every derived pair must still pass the contrast floors in color principles. A pair that fails is
  repaired and listed in `[repaired]`, like any other color.
- `--focus` is not covered here; it stays slate a9 as themes.md says.

## Consequences

- Each imported theme costs a contrast check on the derived pairs.
- Not decided here: the derivation math (which palette colors, which mix), and whether a theme may
  set these six by name later.
