---
id: 0452
title: A token means one thing, so turn splits into fill and text and focus is one slate a9 token in both looks, with only pipes keeping their own focus steps
status: accepted
date: 2026-11-07
tags: [design, tokens, color, focus, design-package]
---

# 0452: A token means one thing, so turn splits into fill and text and focus is one slate a9 token in both looks, with only pipes keeping their own focus steps

**What this decides:** what a color token may stand for, in the design package both versions
share.

## Context

"Accent only for your turn" was a rule about one color, and focus had several grays. From
[design language](../docs/direction/design-language.md#the-owners-calls), call 4, and its change of
2026-11-08 at the top of that note.

## Decision

**One token, one meaning.**

- `turn` splits into `turn-fill` and `turn-text`.
- A colored primary button stays a separate pick, never folded into `turn`.
- Focus is one token, `--focus`, slate a9 in dark and in light. Every keyboard ring and the focused
  tile's edge read it (changed 2026-11-08, design foundations PR 1).
- A pipe keeps its own focus steps ([pipe colors](../docs/direction/pipe-colors.md#the-values));
  nothing else does.

## Consequences

- `--tile-edge-on` reads `--focus`; the token file `tokens/color/focus.toml` holds the one value.
- A new state color is a new token, never a second meaning on an old one.
