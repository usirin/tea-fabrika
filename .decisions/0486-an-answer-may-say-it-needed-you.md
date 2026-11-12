---
id: 0486
title: An answer may carry an optional needed mark at the end of the rec line and a chose answer an optional note, and no mark never means yes or no
status: accepted
date: 2026-11-07
tags: [ui, asks, ledger, record-wide, next]
---

# 0486: An answer may carry an optional needed mark at the end of the rec line and a chose answer an optional note, and no mark never means yes or no

```ts
// A sketch, next/. Effect Schema writes the _tag.
const Answered = Schema.TaggedStruct("answered", {
  ask: Id,
  answer: Answer, // `chose: {pick, note?}`: no rec in view, a note if you like
  saw: Schema.String,
  via: Via,
  took: Schema.optionalKey(Took),
  needed: Schema.optionalKey(Schema.Boolean), // true: only a person could answer
});
```

**What this decides:** two optional things a person may add to an answer, in both versions.

## Context

Only the person knows whether an ask really needed them, and only when they answer. From
[the ask desk](../docs/direction/ask-desk.md#did-this-ask-need-you) (2026-11-07, its place
2026-11-08) and [the shape](../docs/direction/ask-desk.md#the-shape) (2026-11-08).

## Decision

**The `needed` mark is optional, and silence is not an answer.**

- Beside the answer, two marks: this ask needed me, or the agent could have worked it out. It is
  saved on `answered` as `needed`. Neither is picked for you.
- It sits quietly at the end of the "Recommended … sure" line, never on a row of its own
  (2026-11-08).
- No mark means the person did not say. It never means yes or no.
- A `chose` answer, a pick with no rec in view, may carry an optional note (2026-11-08).

## Consequences

- Nothing reads `needed` yet. The share of asks that needed a person is a fold, per step and per
  agent.
