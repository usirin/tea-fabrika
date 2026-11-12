---
id: 0292
title: In next/, a bad save never runs and leaves the process on its old code, a core change restarts only workerd and an Electron main change only Electron, losing nothing, and local workerd restarts at its 500 MB mark
status: accepted
date: 2026-11-01
tags: [hot-reload, errors, workerd, electron, memory, next]
---

# 0292: In next/, a bad save never runs and leaves the process on its old code, a core change restarts only workerd and an Electron main change only Electron, losing nothing, and local workerd restarts at its 500 MB mark

**What this decides:** what a broken save does, and what restarts for a change outside a program.

| Change | What happens | Kept |
|---|---|---|
| a syntax error | refused at the bundle; nothing reaches the brain; `code.failed` | the old code |
| a module that throws as it loads | the load fails; `code.failed` | the old code |
| the core, libfabrika | workerd restarts | everything |
| Electron's main process | only Electron restarts; the brain runs on | everything |

## Context

Decided by the owner in [hot reload](../docs/direction/hot-reload.md) (H4 and H5). Experiment 183
saw each save keep about 4 MB in local workerd. H4's rollback of a step that throws after a swap is
left out: against P34's crash and restart it is still open, and
[0016](0016-tier-1-supervision-is-otps-top-level-supervisor.md) leaves it open too.

## Decision

**A bad save never takes over, and running work keeps running.**

- A syntax error or a module that throws as it loads writes `code.failed`, and the process stays on
  its old code (70%).
- A core change restarts workerd, and an Electron main change restarts only Electron. Both lose
  nothing, since facts live in the log and a process's state in its object's storage (80%).
- Local workerd restarts at its 500 MB mark, which loses nothing.

## Consequences

- The core keeps one `was` hash per process.
- Hands restart with their terminals in a pty process of their own (Tier 4; 60%, nothing built).
