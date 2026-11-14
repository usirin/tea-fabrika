---
id: 0518
title: You summon an agent by @name in any text box, never a summon word or a palette row, an @ with no such agent on the desk starts it and says it is a paid run, and an @ line runs in the background
status: superseded by [0157](0157-summon-starts-an-agent-and-at-talks-to-it.md)
date: 2026-11-05
tags: [ui, shared-tiles, summon, agents, tsh, today]
---

# 0518: You summon an agent by @name in any text box, never a summon word or a palette row, an @ with no such agent on the desk starts it and says it is a paid run, and an @ line runs in the background

```text
tsh$ @scout why does post print #7 twice?    [1] scout: runs behind you, the prompt stays yours
tsh$ fg %scout                               wait on it; Ctrl-C stops the turn
```

**Superseded by [0157](0157-summon-starts-an-agent-and-at-talks-to-it.md).** "No `summon` word" and
"an `@` with no such agent starts it" were taken back on 2026-11-06. The `@` in every text box and
the background `@` line still hold, and 0157 restates them.

**What this decides:** how a person calls an agent into their tile, in today's version.

## Context

A `summon claude` word mixed commands with talk. From
[shared tiles](../docs/direction/shared-tiles.md#shared-tiles-summon-an-agent-into-your-tile-and-see-who-is-there)
(2026-11-05) and [the smaller calls](../docs/direction/shared-tiles.md#the-smaller-calls), 1 and 3
(2026-11-07).

## Decision

**`@` is how you summon.**

- A plain line in tsh is a command; `@claude <words>` talks to claude. There is no `summon claude`
  word.
- With no claude on the desk, the `@` starts it first and says so, since that starts a paid run.
- `@` works in every text box, the command palette included, with no separate summon row
  (2026-11-07).
- An `@` line runs in the background, as if it ended in `&`. It is never refused and never takes
  over the person's prompt; it lands in the name's mailbox, and a busy agent queues it (2026-11-07).

## Consequences

- The full `@` grammar is in [summon guidelines](../docs/direction/summon-guidelines.md).
