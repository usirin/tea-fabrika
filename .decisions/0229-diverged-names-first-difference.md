---
id: 0229
title: When two folds that should agree part, one diverged fact names the case, the field path, both values and the rev that last set that field
status: accepted
date: 2026-11-01
tags: [fold, diverged, saved-state, laws, replay, debugging]
---

# 0229: When two folds that should agree part, one diverged fact names the case, the field path, both values and the rev that last set that field

**What this decides:** what is written when a fold and a saved model, or two copies of a view,
disagree.

```ts
// A sketch from the note. The fold notes, per field, the rev that last changed it.
{
  _tag: "diverged",
  body: { case: "fold_vs_saved", rev: 407, path: "carry.exam", fold: "5d38d582", saved: null },
}
```

## Context

Decided by the owner on 2026-11-01, at 75%. Riot logs a value only on frames where it changes,
because only the first divergence really matters; Factorio's report holds both copies of the save.
See [saved state](../docs/direction/saved-state.md), S5.

## Decision

**When two folds that should agree part, one `diverged` fact names the case, the field path, both
values, and the rev of the fact that last set that field in the fold.**

- It is a law's failure message in a test, and the same function at a live restart.
- At a live restart, both copies are written before resuming, since the restart replaces the saved
  one.
- In `next/`, the "drop the views, replay the log and compare" test and later local copies use the
  same report.

## Consequences

- Lost if it waits: the two copies at the moment of a live mismatch.
- How often folds part on real lanes is not known; if never, it is insurance.
