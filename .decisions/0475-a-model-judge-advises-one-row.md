---
id: 0475
title: A model judge answers one narrow rule row on one shot, runs only once measured, advises under 10% false alarms and never blocks for now, and a row leaves the judge once a law states it
status: accepted
date: 2026-11-07
tags: [ui, verification, judge, model, false-alarms]
---

# 0475: A model judge answers one narrow rule row on one shot, runs only once measured, advises under 10% false alarms and never blocks for now, and a row leaves the judge once a law states it

```ts
// A sketch. The Judge move: one shot, one row, a typed answer.
type RowVerdict =
  | { _tag: "holds" }
  | { _tag: "breaks"; box: Box; reason: string }
  | { _tag: "cannot_tell" }; // never counted as a pass
```

**What this decides:** what a model may judge on a UI shot, in both versions.

## Context

A model reading shots for taste was wrong about 29% of the time in the research read. From
[UI verification](../docs/direction/ui-verification.md#u6-a-model-judge-answers-one-narrow-row-is-measured-first-and-advises),
U6.

## Decision

**A judge answers one narrow fact on one shot, never taste.**

- It runs only after its rows are measured on clean and planted shots, and only a row under 10%
  false alarms advises. None blocks, for now.
- It is allowed on a row no law states yet. Once a law states it, the row leaves the judge.
- `cannot_tell` is never counted as a pass.

## Consequences

- The sketch's keys follow 0081's nouns: `box` and `reason`, never `where` and `why`.
