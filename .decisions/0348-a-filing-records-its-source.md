---
id: 0348
title: A filing records from, the pull request, review, run or walk the ticket came out of, at filing, never only in the body's prose
status: accepted
date: 2026-11-03
tags: [tracker, ticket, from, filing, data-first]
---

# 0348: A filing records from, the pull request, review, run or walk the ticket came out of, at filing, never only in the body's prose

**What this decides:** a ticket's source is a key on its `filed` fact, written by the filer at
the moment of filing.

## Context

The owner decided this on 2026-11-03, from experiment 205
([a ticket says where it came from](../docs/direction/a-ticket-says-where-it-came-from.md#what-was-decided)).
Only the filer knows the source at filing; a later reader cannot get it back. The note's shape for
`from` is proposed, so it is not decided here. Today's version first; `next/`'s tracker carries the
same key when it is built.

## Decision

**`from` is written at filing, never only in the body's prose.**

- It names what the ticket came out of: a pull request, a review, a mutation step, a lane run or a
  walk.
- A ticket a person filed from nothing has no `from`, and so does one filed before the key existed.
- `from` keeps the meaning it already has here: a plan's story names the ticket it came from with
  `from`.

## Consequences

- An area's or a label's source guess reads `from` ([areas](../docs/direction/areas.md#the-shape),
  [label guidelines](../docs/direction/label-guidelines.md#the-shape)).
- Which cases the union needs, and whether a run names its head, is the plan for its ticket.
- Agents fill it because their brief says so; whether a person filing by hand will is not known.
