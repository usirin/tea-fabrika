---
id: 0288
title: In today's version, sharing a project is a one-time copy of its tracker streams into an empty ledger, like git push -u origin main, never two-way sync until it is needed
status: accepted
date: 2026-10-25
tags: [sharing, move, import, ledger, tracker, sync, todays-version]
---

# 0288: In today's version, sharing a project is a one-time copy of its tracker streams into an empty ledger, like git push -u origin main, never two-way sync until it is needed

**What this decides:** how a solo project on the laptop becomes a shared one.

## Context

Decided by the owner in
[the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md) (section 6).
The decision said "the whole ledger, every row"; the move as built (2026-10-27, `fabrika move`)
marked that half wrong in the same note. This file states the rule as built.

## Decision

**Sharing is one copy into an empty ledger, then the shared ledger is the one server.**

- The copy goes once, into an empty ledger, as `git push -u origin main` goes to an empty repo.
- Only the tracker's streams move. The rest is one person's desk, which would be clutter on a shared
  ledger.
- The door knows only real ids, so `user:owner` becomes the founder, and each agent the founder's
  agent.
- No two-way sync until it is needed.

## Consequences

- Work done on the laptop after the move is not pushed later; that waits on a real need.
