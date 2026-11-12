---
id: 0415
title: The machine asks a person only for a decision or an act that is theirs, never for a fact the ledger can hold, and each question names who must act and what the act is
status: accepted
date: 2026-10-11
tags: [asks, ledger, people]
---

# 0415: The machine asks a person only for a decision or an act that is theirs, never for a fact the ledger can hold, and each question names who must act and what the act is

```ts
// From the note. Wrong: a person is used as memory.
ask(owner, "A part of this ticket landed. What is left?");
// Right: the ledger is the memory. A person is asked only when it names one.
const left = yield* ledger.ticket(id);
if (left.owed === "a_ruling") return waitFor(owner, "rule on the open call in this ticket");
```

**What this decides:** what the machine may ask a person, in both versions.

## Context

From the note "ask for decisions, not facts", since removed,
decided 2026-10-11. A real backlog is hundreds of open tickets; nobody holds what is left on each in
their head.

## Decision

**A person is asked for a decision or an act; a fact is read.**

- The machine asks a person only for what is theirs to decide or do: approve a change, rule on an
  open call, resolve their own comment.
- A fact the machine cannot read is a gap in the ledger to fix, never a question. If the ledger
  cannot say what is left, tickets learn to record it.
- A question names exactly who must act and exactly what the act is.

## Consequences

- Before a question to a person is added, check whether its answer is already written somewhere the
  machine can read.
