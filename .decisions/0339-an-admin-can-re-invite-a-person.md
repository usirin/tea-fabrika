---
id: 0339
title: In next/, an admin can re-invite a person who lost every device as the same person, at once and with no wait, and the ledger records who re-invited whom
status: accepted
date: 2026-11-08
tags: [security, recovery, invites, admin, tier-3, next]
---

# 0339: In next/, an admin can re-invite a person who lost every device as the same person, at once and with no wait, and the ledger records who re-invited whom

**What this decides:** the way back for a person in a group fabrika who has no device and no sheet.

## Context

Decided by the owner for a few friends on one Cloudflare account, from experiment 229's row 19. In
[account recovery](../docs/direction/recovery-key.md#what-is-decided-and-what-is-open) and
[Tier 3's recovery](../docs/plan/tiers.md#tier-3s-address-mail-recovery-and-join-screen-owner-2026-11-08).

## Decision

**An admin's invite is already trust, so a re-invite has no barrier.**

- The person comes back as the same person, not a new one.
- It takes effect at once, with no wait.
- The ledger records who re-invited whom.
- The invite itself is [0323](0323-an-invite-is-a-one-day-link.md).

## Consequences

- fabrika is for building, not enterprise security
  ([principles](../docs/direction/principles.md)).
