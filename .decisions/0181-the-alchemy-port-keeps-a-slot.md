---
id: 0181
title: The Alchemy port is part of the four-primitives plan and keeps a slot beside them, never work that waits for a free one
status: accepted
date: 2026-11-13
tags: [alchemy, durable-objects, plan, order, infra, next]
---

# 0181: The Alchemy port is part of the four-primitives plan and keeps a slot beside them, never work that waits for a free one

**What this decides:** whether the port of `next/`'s Durable Object classes to Alchemy's Effect model
is in the current plan, or waits behind it.

## Context

[0041](0041-object-classes-are-effect-objects.md) decided the port on 2026-11-09: every Durable
Object class in `next/` is written on Alchemy's Effect model, one object at a time (tracker ticket
502). Its spike ran on 2026-11-10 (experiments 248 and 249), and the first object, `RecordPart`,
landed on 2026-11-11 as pull request 763.

Then it stopped. [0159](0159-fabsh-pipes-summon-join-first.md) put the four primitives first on
2026-11-13, and its changed Tier 1 lists what they need. The port is not on that list, so every
slot went to the primitives. Nobody chose to pause the port. On 2026-11-13 `Project`, `Process`,
`Connection` and `Control` are still plain platform classes in `next/apps/fabrika/src/brain.ts`,
with no open pull request.

The owner ruled the same day: the port is a base piece of the infrastructure, so it is part of this
plan. This adds to 0159. It changes none of 0159's order for the primitives themselves.

## Decision

**The Alchemy port is part of the plan 0159 set, and it keeps a slot beside the four primitives.**

- The port runs as its own lane, alongside the primitives lanes, until no plain platform class is
  left in the brain (0041's end state).
- It is not filler: it does not wait for a slot the primitives leave free.
- It goes through the same steps as any product change: a plan, tests, build, one review.
- Where the port and a primitives lane change the same file, the plan for the port says which lands
  first.

## Consequences

- [0042](0042-platform-pieces-go-through-alchemy.md)'s direct platform uses, which move with the
  port, start moving again, and the largest group of Promise edges in the brain goes with them.
- Other work that waits on the port can count on it: the static-member rule for `cloudflare/`
  closes when the port deletes `cloudflare/platform.ts`.
- The cost: one more lane meets the primitives lanes in `runtime/` and `brain.ts`, so merges there
  need care.
- Not decided here: the order of the remaining objects, and what happens to `Control` and the
  Worker's default `fetch`, which 0041 left open. The port's plan answers the first and brings the
  second to the owner if no decided note answers it.
