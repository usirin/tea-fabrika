---
id: 0216
title: The ledger is a plain list of events with state folded from it, and every entity in it has a stable typed id that code gives, right from day one
status: accepted
date: 2026-10-12
tags: [ledger, events, fold, ids, entities, data-shape]
---

# 0216: The ledger is a plain list of events with state folded from it, and every entity in it has a stable typed id that code gives, right from day one

**What this decides:** the ledger's basic shape, and what about it must be right before anything
else is added.

## Context

Decided 2026-10-12; the entity and id rules were added on 2026-10-18. See
[the smallest ledger](../docs/direction/smallest-ledger-proof-to-grow.md). Adding a field to an
event list later is cheap; changing ids or history later is not.

## Decision

**The ledger is a plain list of events, with state folded from it, the same idea tea is built on.**

- Ids, and how an edited criterion keeps its history, are right on day one.
- Every ledger entity, anything that stays the same thing through change (ticket, plan, story,
  criterion, task, question, answer, review verdict, lane), is built on one entity base with a
  typed id, and a test fails on a ledger shape without one. In today's version that test is
  `packages/pipeline/src/entity.test.ts`.
- Values (a commit, a reason, a fixture, a route) have no id: equal content is the same thing.
  Agent answer forms, config and fact snapshots are not entities.
- An id is stable: never a place in a list, so inserting a line moves no id. Each kind of id is
  its own type.
- Code gives ids. An agent never names one.

## Consequences

- In `next/`, an id is a TypeID ([0211](0211-one-typeid-per-thing.md)). The note's "a counter or a
  name" holds for today's version only.
- Not decided here: whether anything else waits for proof before it joins the ledger. That rule's
  scope against record wide is open.
