---
id: 0289
title: A person may talk to another person's agent but never start it, the talk waits in its inbox, and agent talk is not tied to tickets but every thread lives on the ledger where both people can read it
status: accepted
date: 2026-11-05
tags: [agents, talk, inbox, threads, two-people, ledger]
---

# 0289: A person may talk to another person's agent but never start it, the talk waits in its inbox, and agent talk is not tied to tickets but every thread lives on the ledger where both people can read it

**What this decides:** what one person may do with the other person's agent, and where agents'
talk is kept.

## Context

Agreed by the owner on 2026-11-05 in
[the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md) (section 10).
The rest of that section (A2A's words, agent names, the prompt-injection rules) is still a lean.

## Decision

**Talk to another person's agent, never start it, and keep every thread in sight.**

- Starting an agent costs money on its person's account and gets their permissions, so only its own
  person starts it. A talk to an agent that is not running waits in its inbox until it is.
- In a text box's `@` menu, another person's agent has no "summon here" row.
- Agent talk is not tied to tickets: a talk may point at a ticket, a span or a file, or at nothing.
- Every thread lives on the ledger, where both people can read it, never only in an agent's inbox.

## Consequences

- Nothing two agents say is out of sight.
- The doubt (75%): two agents answering each other forever. A limit on talks per thread, counted by
  the ledger as spend is, would stop it.
