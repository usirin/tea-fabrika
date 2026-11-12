---
id: 0419
title: Each harness's ACP adapter is the official one, pinned and at least two weeks old, when it can be contained, else a small one of our own, never a community wrapper
status: accepted
date: 2026-10-19
tags: [agents, acp, harness, dependencies]
---

# 0419: Each harness's ACP adapter is the official one, pinned and at least two weeks old, when it can be contained, else a small one of our own, never a community wrapper

**What this decides:** where the adapter between fabrika and an agent harness comes from.

## Context

From [helpers, and one supervisor](../docs/direction/helpers-and-the-supervisor.md#what-was-decided),
decided 2026-10-19. Today's version pins the official Claude and Codex adapters
(`packages/fabrika/src/agents/acp/harness.ts`). The contract itself is our own interface, with ACP
one adapter behind it ([0026](0026-fabrika-never-owns-the-agent-loop.md)).

## Decision

**Adapters are picked in this order.**

- The official adapter, pinned and at least two weeks old, if it can be contained: its real tools
  and folder, nothing from the user's own setup.
- Otherwise our own, small one.
- Never a community wrapper. Projects that wrap many harnesses are a map of what differs, not a
  dependency.

## Consequences

- A harness with only community adapters gets one of ours, or none if its terms forbid wrapping it.
