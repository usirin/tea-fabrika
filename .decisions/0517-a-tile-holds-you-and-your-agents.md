---
id: 0517
title: A tile holds the person and any agent they summon, one kind of tile, so nothing is shown twice and nobody is sent to another tile to act, and any agent that speaks the agent link may be summoned
status: accepted
date: 2026-11-04
tags: [ui, shared-tiles, agents, summon, tiles, today]
---

# 0517: A tile holds the person and any agent they summon, one kind of tile, so nothing is shown twice and nobody is sent to another tile to act, and any agent that speaks the agent link may be summoned

```ts
// A sketch, today's version. Ticket #7 in t1, the owner's tile.
desk.step({ type: "summon", agent: "claude", tile: "t1" }); // a tea Msg keeps `type`; focus stays
```

**What this decides:** where an agent works beside a person on the desk, in today's version.
`next/` reads it as a lesson.

## Context

An agent's own tile showed the same ticket twice and sent the person elsewhere to answer. From
[shared tiles](../docs/direction/shared-tiles.md#shared-tiles-summon-an-agent-into-your-tile-and-see-who-is-there),
decided in the walk of 2026-11-04.

## Decision

**One kind of tile, shared.**

- A tile holds the person and any agent they summon. The agent's own tile goes as a kind, for good.
- `summon` takes any agent that speaks the agent link (`fabrika mcp --as <name>`), never only claude.
- The same thing is never shown twice on screen, and the person is never sent to another tile to
  act.
- Following an agent's tile, Zed's way, is out: you act where you watch.
- How writes are signed is [inputs carry their sender](../docs/direction/inputs-carry-their-sender.md).

## Consequences

- The note is walked again when Tier 5 starts; its proposed rule wording stays open.
