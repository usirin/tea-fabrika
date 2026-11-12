---
id: 0432
title: In next/, the shell is fabsh, rethought from tsh and never copied, and tsh stays in today's version
status: accepted
date: 2026-11-01
tags: [tsh, fabsh, shell, names, next, todays-version]
---

# 0432: In next/, the shell is fabsh, rethought from tsh and never copied, and tsh stays in today's version

**What this decides:** which shell each version has.

## Context

`next/` rebuilds what today's code learned, without porting it. From the 2026-11-01 change in
the note "tsh: a shell for tea programs", since removed. AGENTS.md says
the same; no decision file held it.

## Decision

**`next/`'s shell is `fabsh`; `tsh` is today's.**

- `fabsh` is rethought from tsh, never copied
  ([rethink, do not port](../docs/direction/rethink-do-not-port.md)).
- `tsh` stays in today's version until `next/` takes its job over.
- A `next/` file, note or trace names `fabsh`, never `tsh`.

## Consequences

- tsh's decisions ([0430](0430-tsh-is-a-unix-shell-for-tea-programs.md),
  [0431](0431-agents-get-programs-as-mcp-tools.md)) bind today's version only.
- fabsh lands in Tier 2 ([the tiers](../docs/plan/tiers.md)).
