---
id: 0519
title: Presence is a 12px avatar in the title bar that says who and a presence label on what the agent writes that says where, never a ring, a glow, a cursor or the tile's edge
status: accepted
date: 2026-11-07
tags: [ui, shared-tiles, presence, agents, accessibility, today]
---

# 0519: Presence is a 12px avatar in the title bar that says who and a presence label on what the agent writes that says where, never a ring, a glow, a cursor or the tile's edge

```ts
// A sketch, today's version. Show it, never save it, never decide with it.
{ _tag: "presence", client: "agent:claude for:github:42", location: "tile:t1", writing: "ticket:7/ask/a-1" }
```

**What this decides:** how a tile shows who is in it and what they are writing, in today's version.
In `next/` presence rides the ephemeral lane.

## Context

A state word in the title was too quiet to notice an agent. From
[shared tiles](../docs/direction/shared-tiles.md#presence-the-avatar-says-who-the-presence-label-says-where),
P2 plus P4 (2026-11-07), with two calls of 2026-11-05.

## Decision

**The avatar says who; the presence label says where.**

- The avatar is 12px, in the title bar, by the id. An agent is a rounded square with a drawn
  four-point star; a person is a circle. Shape plus name, never color alone. The name is in the
  tile's accessible name and a tooltip.
- The presence label is a small "✦ claude" tag on the thing the agent's job is writing now: a line
  it sent, a button it presses. It replaces the writer label, so the name shows once.
- The label goes only where the agent itself writes, never on a card a step's own agent writes
  (2026-11-05).
- Agents have no cursor, so no arrow pointer is drawn anywhere (2026-11-05).
- No ring, no glow, and never the tile's edge, which means focus.

## Consequences

- The title bar gains the avatar by the id ([0501](0501-a-tiles-title-bar-is-mono.md)).
- Presence is never saved and never decides anything.
