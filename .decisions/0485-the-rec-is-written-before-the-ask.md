---
id: 0485
title: The rec is written on asked before the desk draws it, an answer records its key, time on screen, parts opened and whether the rec was shown, and attention is counted per merged ticket, never capping an ask
status: accepted
date: 2026-11-02
tags: [ui, asks, ledger, record-wide, next]
---

# 0485: The rec is written on asked before the desk draws it, an answer records its key, time on screen, parts opened and whether the rec was shown, and attention is counted per merged ticket, never capping an ask

```ts
// A sketch, next/: what the window records with the press.
took: { key: "y", rec: "shown", ms: 41_000, opened: [], sentAt: 1793649030000 }
```

**What this decides:** what the ledger keeps about each ask and each answer, from the day a step
first asks a person in `next/`.

## Context

Each of these exists only at the moment of the press. From
[the ask desk](../docs/direction/ask-desk.md#a4-write-the-rec-before-the-ask-and-record-what-the-person-saw-and-did),
A4, and record wide (AGENTS.md).

## Decision

**Seal the rec first, then record what the person saw and did.**

- The rec is a field on the `asked` fact, written before the desk draws it.
- The answer records which key, how long the ask was on screen, what was opened, and whether the
  rec was in view. A yes covers what the desk drew: its `saw` is the hash of the data drawn.
- The window's own clock on the press is `sentAt`, kept out of the deciding code's types; the
  ledger's `arrivedAt` stays the referee's.
- Attention is counted per merged ticket. The count is data; it never caps or cuts an ask.

## Consequences

- Agreement, minutes per kind and the queue's estimate are folds over these facts, never stored.
