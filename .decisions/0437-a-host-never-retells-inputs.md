---
id: 0437
title: In today's version, a host never tells inputs again when it reattaches, and a program finds its own unfinished runs at start
status: accepted
date: 2026-10-17
tags: [tea-program, host, restart, recovery, todays-version]
---

# 0437: In today's version, a host never tells inputs again when it reattaches, and a program finds its own unfinished runs at start

**What this decides:** who brings back half-done work after a restart in today's version.

## Context

From [tea-program](../docs/direction/tea-program.md#parts-already-decided).

## Decision

**A program, not its host, finds its own unfinished work.**

- A host never tells inputs again when it reattaches.
- A program that keeps state finds its own unfinished runs at start.
- Whatever must outlive a restart lives in a machine.

## Consequences

- A host restart sends nothing twice by itself; each program owns its recovery.
