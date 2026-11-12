---
id: 0349
title: The team builds before it buys, uses what it builds every day, and keeps the backend on one Cloudflare account on the $5 Workers plan
status: accepted
date: 2026-10-27
tags: [tools, tracker, cloudflare, cost, github, providers, dogfood]
---

# 0349: The team builds before it buys, uses what it builds every day, and keeps the backend on one Cloudflare account on the $5 Workers plan

**What this decides:** a tool the team needs is first a program on the ledger, the tracker before
any other, and only GitHub and the model providers stay outside, each behind a service.

## Context

The owner decided this on 2026-10-27
(in the note "we use the tools we build", since removed: this file holds its rules).
Cloudflare's Workers Paid plan is $5 a month for an account. AGENTS.md says fabrika assumes it.

## Decision

**Build before buy, and use it every day.**

- When the team needs a tool, the first answer is a program on the ledger. The tracker replaces
  Linear first, built like Linear ([0346](0346-the-tracker-is-built-like-linear.md)).
- Daily use is the test. A program that feels worse than the tool it replaces is a bug to fix,
  never a reason to go back.
- The backend stays one Cloudflare account on the $5 Workers plan while the numbers allow. A piece
  that would push the bill well past it says so in its note, with the number.
- GitHub stays the code host, reached through `CodeHost`
  ([tickets start in our tracker](../docs/direction/tickets-start-in-our-tracker.md)), and the
  model providers stay outside. Each sits behind a service, so it can be swapped later.

## Consequences

- We own the upkeep: every feature Linear gives for free, we build.
- Cloud boxes on Cloudflare Containers are billed past what the plan includes, so many cloud agent
  runs cost more than $5.
- Which bought tool goes next waits for a need.
