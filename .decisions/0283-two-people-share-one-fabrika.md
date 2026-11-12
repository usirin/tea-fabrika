---
id: 0283
title: Two people sharing one fabrika, with agents that talk across their two machines, is a core goal, and each ledger stands alone with no central users database or service
status: accepted
date: 2026-10-25
tags: [sharing, two-people, ledger, members, cloudflare, both-versions]
---

# 0283: Two people sharing one fabrika, with agents that talk across their two machines, is a core goal, and each ledger stands alone with no central users database or service

**What this decides:** that sharing is built in from the start, and that nothing outside a ledger
knows who belongs to it.

## Context

Decided by the owner in
[the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md). It is built in
today's version, invites included. In `next/`, a few people is Tier 3, and who may be in a fabrika
is that fabrika's own fact ([a key per client](../docs/direction/a-key-per-client-and-no-github-trust.md)).

## Decision

**Two people share one fabrika, and each ledger stands alone.**

- Two people working the same tickets, with their agents talking across two machines, is a core
  goal, never a later team feature. Cost is not a blocker: the Workers Paid plan is already paid.
- No central users database and no central service. Each ledger stands alone, in its own Durable
  Object or its own Cloudflare account.
- A person first picks which ledger to connect to, by its address.
- Who belongs is facts on that ledger, and nothing outside it knows.

## Consequences

- Every ledger keeps its own members; there is no account to sign in to across ledgers.
