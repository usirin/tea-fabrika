---
id: 0290
title: In next/, a shared fabrika has exactly one owner plus admins and members, recorded from day one with who invited whom, and finer roles wait for Tier 7
status: accepted
date: 2026-11-07
tags: [roles, members, owner, admins, invite, tier-3, next]
---

# 0290: In next/, a shared fabrika has exactly one owner plus admins and members, recorded from day one with who invited whom, and finer roles wait for Tier 7

**What this decides:** the roles a shared fabrika has in `next/`.

```ts
// A sketch. One owner by shape: no per-person `role` field, so two owners cannot happen.
type Project = { owner: Person; admins: Person[]; members: Person[] };
```

## Context

Decided by the owner in the product walk, written in
[Tier 3's roles](../docs/plan/tiers.md#tier-3s-roles-owner-2026-11-07) and pointed at from
[the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md#later).

## Decision

**One owner, admins and members.**

- A shared fabrika has exactly one owner, plus admins and members.
- Who invited whom is recorded from day one.
- Finer roles, such as read-only members, wait for Tier 7, if they come at all.

## Consequences

- What each role may do is listed in Tier 3's roles, in the plan.
