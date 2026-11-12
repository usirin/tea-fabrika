---
id: 0291
title: In next/, hot reload is there from day one, a save swaps only that program at each of its processes' next step through the mailbox, and a process keeps its model when the new schema decodes it, else that one process is refused
status: accepted
date: 2026-11-01
tags: [hot-reload, programs, process, mailbox, state, schema, erlang, elm, next]
---

# 0291: In next/, hot reload is there from day one, a save swaps only that program at each of its processes' next step through the mailbox, and a process keeps its model when the new schema decodes it, else that one process is refused

**What this decides:** what happens to running processes when a program's code changes in `next/`.

```mermaid
sequenceDiagram
  participant D as dev.ts or a deploy
  participant B as brain
  participant P as counter process
  D->>B: install new hash
  B->>B: code.loaded
  B->>P: swap, queued in the mailbox
  Note over P: Msg, Msg, swap, Msg: never inside a step
  P->>P: the new state schema decodes the model?
  alt decodes, after the chain of named upgrades
    P->>P: keep the model; update and view change
  else does not decode
    P->>B: code.refused; stay on the old code with Restart
  end
```

## Context

Decided by the owner in [hot reload](../docs/direction/hot-reload.md) (H0 to H3), from experiment
183, which measured 23 ms per swap and lost a counter in 5 of 5 runs when a swap went around the
queue. Tier 1's P15 builds it. The note's upcast sketch is replaced by
[saved state, S3](../docs/direction/saved-state.md)'s version number and named upgrades. Today's
version is not changed ([0282](0282-an-old-host-is-named-then-restarted.md)).

## Decision

**New code, same session, one program at a time.**

- `next/` has hot reload from day one, in Tier 1's slice, never a later tier.
- Saving a program's file swaps only that program, at each of its processes' next step. The app,
  the brain and every other program run on (85%).
- A save and a deploy take one path: a new hash arrives, and only what sends it differs.
- A swap is one more message in the process's mailbox, between two Msgs, never inside a step or
  around the queue (85%).
- The process keeps its model when the new code's state schema decodes it, after its chain of named
  upgrades, and only update and view change (85%).
- A model the new code cannot decode refuses the swap for that one process. It keeps its old code,
  with Restart on its tile, never a guess. Other processes of the program that fit still swap.

## Consequences

- A restart runs the new `init` ([0253](0253-init-cmds-run-once-per-process.md)); a person presses
  it.
- Not run yet: Cmds and Subs across a swap.
