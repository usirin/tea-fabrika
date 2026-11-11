---
id: 0323
title: A second person joins by a one-time invite link that expires in a day, sent by an admin or the owner, and the ledger records who invited them
status: accepted
date: 2026-11-07
tags: [security, invites, access, tier-3, next]
---

# 0323: A second person joins by a one-time invite link that expires in a day, sent by an admin or the owner, and the ledger records who invited them

**What this decides:** how the invite that [0322](0322-a-key-per-client-github-never-a-way-in.md)
names is carried.

## Context

[A key per client](../docs/direction/a-key-per-client-and-no-github-trust.md#what-it-cannot-tell-us)
left the invite's form open until Tier 3. The owner decided it in the product walk, as
[Tier 3's invites](../docs/plan/tiers.md#tier-3s-invites-owner-2026-11-07) records.

## Decision

**An invite is a one-time link, also shown as a QR code, good for one day.**

- An admin or the owner sends it, by Tier 3's roles.
- The link works once and expires in a day.
- The QR code is the same link, so a phone can scan it.
- The ledger records the join and who invited the person.

## Consequences

- A join stays one more grant at the gateway, never a second way in.
- Not decided here: the join screen's words.
