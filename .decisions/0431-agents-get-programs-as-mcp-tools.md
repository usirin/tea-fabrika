---
id: 0431
title: In today's version, an agent gets the host's listed programs as MCP tools, chosen by whoever sets it up, with guards added only once harm is seen
status: accepted
date: 2026-10-18
tags: [tsh, mcp, agents, policy, programs, todays-version]
---

# 0431: In today's version, an agent gets the host's listed programs as MCP tools, chosen by whoever sets it up, with guards added only once harm is seen

**What this decides:** how an agent reaches today's programs, and who says which ones it sees.

## Context

Agents starting real, typed programs is the main gain of tsh. From
the note "tsh: a shell for tea programs", since removed
(the policy parts 2026-10-17, MCP 2026-10-18). The note says tsh would serve the tools; in today's
code the host does, on its agents' socket (`packages/fabrika/src/mcp.ts`). This file writes that
current form.

## Decision

**MCP is the tools protocol: each input of each listed program is an MCP tool an agent can call.**

- Which programs an agent sees is up to whoever sets up that agent.
- An agent changing its own programs is ordinary user work. Guards come only once harm is seen.
- A value bound to one lane is fabrika's job: narrow the flag or input schema to that lane's value.
- This is fabrika's policy layer, improved over time. It is not an OS sandbox; the walls of a box
  are their own decisions ([0045](0045-test-steps-run-in-containers.md),
  [0028](0028-the-parent-holds-every-right.md)).

## Consequences

- Whether programs that write must ask a person first, and reading ones are free, is not decided
  here.
- Whether an agent gets tsh in place of its harness's own shell is not decided here.
