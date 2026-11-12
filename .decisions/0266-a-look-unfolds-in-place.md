---
id: 0266
title: A look at another program's thing unfolds in place as a strip beside the list, never Linear's float, and a peek keeps focus on the list, follows the selection, and only Enter moves focus in
status: accepted
date: 2026-11-03
tags: [layers, peek, fold, focus, linear, ui, both-versions]
---

# 0266: A look at another program's thing unfolds in place as a strip beside the list, never Linear's float, and a peek keeps focus on the list, follows the selection, and only Enter moves focus in

**What this decides:** how a person looks at a ticket from a list without leaving the list.

```text
Space      the ticket strip beside opens in place     focus stays in the list; the peek follows j and k
Enter      focus moves into the ticket
Esc        the strip folds back
```

## Context

Decided by the owner in [layers](../docs/direction/layers.md) (L6 and calls 2 and 3). It clashes
with Linear, whose peek floats; the owner picked the unfold at about 80%, since a new tile lands
beside and [fold, not tabs](../docs/direction/fold-not-tabs.md) keeps the picture. Today's app
builds it first; `next/` in Tier 2.

## Decision

**A look opens in place before it floats.**

- A look at another program's thing opens as a strip beside the list, unfolded in place, with no new
  layer. It is the same tile model, drawn open or folded.
- Floats stay the person's opt-in, never the default for a look.
- A peek keeps focus on the list and follows the selection; `Esc` or Space folds it back, and only
  Enter moves focus in (60%). This is an exception to program guidelines G4 R2, for a peek only.

## Consequences

- Nothing a person did not ask about gets covered, by construction.
- The doubt: a peek is a second way to open a strip, beside moving focus onto it. A week of use
  would tell.
