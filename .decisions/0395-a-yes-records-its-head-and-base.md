---
id: 0395
title: A yes records its head, onto, base and diff from the day it is given, every carry is a carried fact of its own, and only the base branch's formatter can keep a yes
status: accepted
date: 2026-11-02
tags: [pipeline, review, approval, records, carry]
---

# 0395: A yes records its head, onto, base and diff from the day it is given, every carry is a carried fact of its own, and only the base branch's formatter can keep a yes

```ts
// A sketch, from the note: what a yes keeps when it is given.
type Given = { readonly head: Sha; readonly onto: string; readonly base: Sha; readonly diff: DiffId };
// What code writes when a yes moves. next/ says `reason`; today's code says `why`.
{ _tag: "carried", from: "a1b2c3", to: "d4e5f6", reason: "formatted" }
```

**What this decides:** what a yes stores so that [0394](0394-a-yes-carries-by-one-rule.md) can run,
and how a move of a yes is recorded.

## Context

From [a yes binds to the diff](../docs/direction/a-yes-binds-to-the-diff.md#what-was-decided),
decided by the owner 2026-11-02. `base` is the one field that cannot be rebuilt later: the base
branch moves, and a parent's branch can be squashed away.

## Decision

**A yes keeps what `carry` needs, and every carry leaves a fact.**

- The `reviewed` fact, a verdict row and a person's merge answer each keep `head`, `onto`, `base`
  and `diff` from the day the yes is given. In `next/` the review entry and the merge answer keep
  them from the first entry written.
- A carry is its own `carried` fact, with `from`, `to` and its reason, so a yes never moves
  silently.
- The formatter that can keep a yes is the base branch's, from its `fabrika.toml`, run only on the
  paths the reviewed diff touched. A pull request cannot bring the formatter that excuses it.

## Consequences

- 13 places in today's code bound a yes to a sha or to no head; they move to `carry`.
