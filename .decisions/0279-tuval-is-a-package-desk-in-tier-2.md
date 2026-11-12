---
id: 0279
title: In next/, Tuval is the @kampus/tuval package drawn from fabrika's logic, the desk is tezgah's program arriving in Tier 2, and Tier 1 has one fixed layout, focus per window and no desk process
status: accepted
date: 2026-11-01
tags: [desktop, tuval, tezgah, packages, tier-1, tier-2, next]
---

# 0279: In next/, Tuval is the @kampus/tuval package drawn from fabrika's logic, the desk is tezgah's program arriving in Tier 2, and Tier 1 has one fixed layout, focus per window and no desk process

**What this decides:** where the desktop's code lives in `next/`, and how much of it Tier 1 has.

## Context

Changed for `next/` on 2026-11-01, from Tier 1's plan, in
[the desktop layer](../docs/direction/the-desktop-layer.md). The note's `fabrika/desk` is
`fabrika/tezgah` since the frame's walk (2026-11-03), as the glossary's `tezgah` row says.

## Decision

**Tuval is a package, and the desk comes in Tier 2.**

- Tuval is the `@kampus/tuval` package: fabrika is the logic, and Tuval is what is drawn from it.
  People see "fabrika".
- The desk is a program, `fabrika/tezgah`, arriving in Tier 2 with split, close and prefix keys.
- Tier 1 has one fixed layout at wiring, each window keeps its own focus, and there is no desk
  process.

## Consequences

- Tier 1's windows do not wait on the window manager.
