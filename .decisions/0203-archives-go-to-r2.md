---
id: 0203
title: In next/, archives live in R2 and live data in Durable Objects, with Cloudflare D1 only once a real cross-project need appears
status: accepted
date: 2026-11-07
tags: [storage, r2, durable-objects, d1, cloudflare, next]
---

# 0203: In next/, archives live in R2 and live data in Durable Objects, with Cloudflare D1 only once a real cross-project need appears

**What this decides:** which Cloudflare store holds which kind of data in `next/`.

## Context

The owner decided this on 2026-11-07, from P37's questions. See
[design for bounded objects](../docs/direction/design-for-bounded-objects.md). Cloudflare D1 here
is the database product, not the five layers note's decision label D1.

## Decision

**In `next/`, archives go to R2, everything live stays in Durable Objects, and Cloudflare D1 is
used only once a real need for data across projects appears.**

- R2 holds what nobody replays: old raw measurements, agent logs, big bodies.
- Old ledger stretches are still live data, since every rebuild replays them, so they stay in
  Durable Objects ([0206](0206-sealed-ledger-stretches-keep-one-order.md)).
- No cross-project need is known today: a person's devices and projects fit an object of their
  own.

## Consequences

- Adding D1 needs a named need first, written as its own decision.
