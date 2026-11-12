---
id: 0324
title: Security follows the settled goal and never rests on one code host's settings, and only shapes that make a mistake impossible are built before hardening
status: accepted
date: 2026-10-12
tags: [security, hardening, order-of-work, code-host]
---

# 0324: Security follows the settled goal and never rests on one code host's settings, and only shapes that make a mistake impossible are built before hardening

**What this decides:** where security sits in the order of work, in both versions.

## Context

Designing around a code host's permissions tied the design to that host and went round in circles.
From the note "North Star first; harden later", since removed. Its 2026-10-18 order of work is
replaced by [the tiers](../docs/plan/tiers.md).

## Decision

**First settle what the tool should be, then make it safe.**

- Security, accessibility and speed are always a concern, never a limit on the goal.
- The safety goal: nobody can steal a login by filing a ticket.
- Safety never rests on one code host's settings: not GitHub's organization permissions, and not a
  label only collaborators can set. A project may not use GitHub at all.
- A gap that today's fabrika has too is parked for the hardening pass, never a blocker, and is
  fixed before the build step leaves experiment status.
- A gap this repo adds that today's fabrika does not have is fixed now.
- Shapes that make a mistake impossible get built now
  ([make the mistake impossible](../docs/direction/make-the-mistake-impossible.md)). Only new
  security guards wait for hardening.
- Lists of known gaps are never kept in this public repo. Only the fixes land here.

## Consequences

- Developer experience comes first until the hardening pass, one package at a time.
- Each fix lands as a normal pull request.
