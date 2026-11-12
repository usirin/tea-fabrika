---
id: 0521
title: What an agent or a person sends you is a message in the inbox, an unsummoned agent's message is a row replied to inline that opens no tile, and an agent whose link drops says away and then gone
status: accepted
date: 2026-11-07
tags: [ui, shared-tiles, inbox, messages, agents, today]
---

# 0521: What an agent or a person sends you is a message in the inbox, an unsummoned agent's message is a row replied to inline that opens no tile, and an agent whose link drops says away and then gone

```ts
// A sketch, today's version. What the avatar says, in words; "here" draws no word.
const Link = Schema.TaggedUnion({
  here: {},
  away: { since: Schema.Number }, // the link dropped; letters queue
  gone: { since: Schema.Number }, // about 10 minutes away; the person dismisses or summons again
});
// One activity row on ticket #7, pointing back at the line that caused it.
{ _tag: "areaSet", ticket: "7", area: "tracker", by: "agent:scout", cause: "in-3f9a0c21-52" }
```

**What this decides:** where an agent's talk and changes show, in today's version.

## Context

An agent's message had nowhere to land without opening a tile. From
[shared tiles](../docs/direction/shared-tiles.md#the-smaller-calls), calls 2, 4 and 5
(2026-11-07), and the change of 2026-11-08.

## Decision

**Talk lands in the inbox; changes land on the ticket.**

- What an agent or a person sends you is a message, never a line. The inbox groups them under
  Messages, below Your turn (2026-11-08, [0480](0480-the-inbox-is-one-program-two-views.md)).
- A message from an agent nobody summoned lands as an inbox row the person replies to inline.
  Nothing opens a tile on its own.
- An agent whose link drops stays summoned and says "away"; messages to it queue in its mailbox.
  After about 10 minutes it says "gone", and the person dismisses it or summons it again.
- The tile shows what an agent said, and the ticket shows what it changed, as activity rows that
  point back through `cause`.

## Consequences

- The 10 minutes is a guess, set from a week of use. Folding many small edits into one row is a
  known follow-up.
