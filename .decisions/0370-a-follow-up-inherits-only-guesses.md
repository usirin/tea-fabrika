---
id: 0370
title: In next/'s tracker, a follow-up inherits only guessable groups' labels from its source, and only as a guess
status: accepted
date: 2026-11-06
tags: [tracker, labels, guess, from, follow-up, next]
---

# 0370: In next/'s tracker, a follow-up inherits only guessable groups' labels from its source, and only as a guess

**What this decides:** a ticket filed from another takes its source's pick in a guessable group as
a guess, and no other label.

```ts
// A sketch from the note, with `why` renamed `reason` (0081). The fold's answer per pick-one group.
const Pick = Schema.TaggedUnion({
  picked: { label: Schema.NullOr(LabelNumber) },
  guessed: { label: LabelNumber, reason: Schema.Literals(["filer", "source"]) },
  none: {},
});
```

## Context

The owner decided call 4 on 2026-11-06, lean 70%
([label guidelines, call 4](../docs/direction/label-guidelines.md#4-does-a-follow-up-inherit-labels),
[the shape](../docs/direction/label-guidelines.md#the-shape)). The source is the ticket's `from`
([0348](0348-a-filing-records-its-source.md)). `next/`.

## Decision

**Only a guess carries over.**

- A guess applies only to groups made with `guess: true`.
- A pick wins over every guess, even a pick of none. Else the filer's `guess`. Else the source's
  pick in that group, through `from`.
- Other labels are the person's words about that ticket, not its source's, so they never carry
  over.

## Consequences

- A follow-up of an agent-filed ticket still shows "?" on its area until a person picks.
