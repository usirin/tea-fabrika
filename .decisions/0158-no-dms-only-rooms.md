---
id: 0158
title: fabrika has no DMs, a talk with one agent is a plain room of two that everyone on the project can read, never a private place
status: accepted
date: 2026-11-13
tags: [room, dm, privacy, summon, fabsh, glossary]
---

# 0158: fabrika has no DMs, a talk with one agent is a plain room of two that everyone on the project can read, never a private place

```text
A sketch. The lines are as decided on 2026-11-07; only the words beside them change.
fabsh$ @scout why does post print #7 twice?     a room of two, you and scout; anyone on the project can read it
fabsh$ #bug-17 @scout here is the failing run   a named room; the same kind of place
```

**What this decides:** fabrika drops the word DM: every talk is a room that everyone on the
project can read, and fabrika has no private place to talk.

## Context

[Summon guidelines](../docs/direction/summon-guidelines.md#rooms-mentions-and-turns-in-order)
(decided 2026-11-06) called a room with two members, a person and one agent, a DM (R1, R6), and
said every room is readable by everyone on the project, DMs included (R2). The glossary's `DM` row
says it is "not a private chat".

The word and the rule pull apart. In the three chat tools R6 takes the word from, a DM is read by
its members only (secondary: from memory, not checked against each product's page). A person who joins a project
later would read "DM" as private, and be wrong. A walk on 2026-11-13 put two ways out on the table:

- **Make DMs private.** This undoes R2. The brain would have to keep some entries from some
  people, which nothing in [the plan](../docs/plan/tiers.md) does today, and an agent's owner would
  pay for talks they cannot read (T3 bills the owner).
- **Have no DMs.** This keeps R2. Only the word goes.

The owner picked the second.

No other decision file names DMs. [0073](0073-a-lane-has-a-room.md) builds on R1, R2 and R5 and
is not changed. This record amends the note's R1 and R6 where they use the word.

## Decision

**fabrika has no DMs.**

- The word `DM` is not used in `next/`, in what fabsh prints, or in new notes. Text decided before
  today keeps it, marked.
- A person's talk with one agent is a room with two members. `@scout <text>` typed outside any room
  still lands there, as R1 says.
- Every room is readable by everyone on the project, that room included (R2, kept). No room is
  private, and no setting makes one private.
- fabrika offers no private place to talk. Talk that must stay between two people happens outside
  fabrika.
- Content stays deletable
  ([an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md)).

**Binding constraints**

- No screen, prompt or message calls a place a DM, or hints that a room is private.
- No design adds a room that some project members cannot read, unless a new decision replaces this
  one and R2.

## Consequences

- The glossary's `DM` row says the word is walked back and what stands in its place. The note's R1
  and R6 bullets are marked.
- The cost: there is no private place inside fabrika at all. A person who wants one uses another
  tool. Secrets never go in a room either way.
- R8's `direct` mark is a lean, written for DMs. Whether a room of two keeps a mark is not decided
  here.
- Not decided here: what a room of two is called on screen and how it is named; a room between two
  people; the verb `join`; two agents with one name in a room.

## Amendments

- 2026-11-13 (owner): the reason, stated the same day: fabrika is not a chat tool. Private talk,
  with a person or with an agent, happens outside fabrika, in whatever tool the person picks. The
  Decision's fourth bullet said only "between two people"; it covers a talk with an agent too.

## Records

- [`.glossary/TERMS.md`](../.glossary/TERMS.md): the `DM` row.
