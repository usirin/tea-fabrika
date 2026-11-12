---
id: 0420
title: Tools reach an agent over MCP, a standard protocol before one of our own
status: accepted
date: 2026-10-18
tags: [agents, tools, mcp, protocols]
---

# 0420: Tools reach an agent over MCP, a standard protocol before one of our own

**What this decides:** the protocol that brings tools to an agent.

## Context

From [helpers, and one supervisor](../docs/direction/helpers-and-the-supervisor.md#what-was-decided),
decided 2026-10-18.

## Decision

**MCP is the tools protocol.**

- Tools reach an agent over MCP.
- A standard protocol comes before one of our own.

## Consequences

- A tool that needs the outside is still a call the parent checks and runs
  ([0028](0028-the-parent-holds-every-right.md)); MCP is how the agent sees it.
