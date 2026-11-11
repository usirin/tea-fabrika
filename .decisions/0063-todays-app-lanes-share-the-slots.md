---
id: 0063
title: The owner's picked work on today's app fills agent slots beside Tier 1, never parked behind next/
status: accepted
date: 2026-11-10
tags: [lead, slots, priority, todays-app, tier-1]
---

# 0063: The owner's picked work on today's app fills agent slots beside Tier 1, never parked behind next/

**What this decides:** when the lead fills agent slots, the owner's picked work on today's app counts
as much as `next/` work, so its lanes keep moving beside Tier 1.

## Context

The lead had been running 4 of the 12 slots that [0012](0012-twelve-agents-at-once.md) allows. Most
queued `next/` work collided with a large folder move, and the lead held today's-app lanes back to
leave room for `next/`. The owner ruled on 2026-11-10 that this holding back was wrong.

It follows the plan's rule of 2026-11-03, that product foundations on today's app are built in
parallel with other work ([where we are](../docs/plan/README.md#where-we-are-now)), and makes it
a rule for filling slots.

## Decision

**The owner's picked work on today's app (the ask desk, the project window, themes, the inbox,
typography and the like) is as valuable as `next/` work, and its lanes fill slots beside Tier 1.**

- They are not parked until `next/` work is done, and not held back to leave room for it.
- A free slot that no `next/` lane can take, for example because the work collides with a move in
  flight, goes to a today's-app lane that does not collide.
- Slots stay empty only when no lane of either kind can start without a collision.

**Binding constraints:**

- The machine caps of [0012](0012-twelve-agents-at-once.md) hold: 12 agents, one type check, one
  Electron app and one Docker box at a time.
- Tier 1's rows are still the plan for `next/`.
- AGENTS.md's rule for today's version holds: only the UX work the owner picks, fixes daily use
  needs, and tryouts go in. This decision does not widen what today's app takes.

## Consequences

- The lead fills slots up to the cap from both kinds of lane, and reports why any slot stays empty.
- More today's-app lanes may mean longer waits for the one type check and the one Electron app.
- Not decided here: the order among today's-app lanes, or among Tier 1's rows.
