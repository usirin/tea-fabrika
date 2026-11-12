---
id: 0434
title: In today's version, a program's outputs are events heard once and kept nowhere, and what a late viewer needs lives in a machine's state
status: accepted
date: 2026-10-17
tags: [tea-program, outputs, events, state, todays-version]
---

# 0434: In today's version, a program's outputs are events heard once and kept nowhere, and what a late viewer needs lives in a machine's state

```ts
run.listen("outcome", log);    // from now on; nothing sent before is kept
run.machines.ship.changes;     // what a late viewer reads: the machine's state now, then every change
```

**What this decides:** what an output is in today's `defineProgram`, and where a late viewer looks.

## Context

Elm's ports keep nothing, and a Unix pipe is wired before the program runs. From
[tea-program](../docs/direction/tea-program.md#parts-already-decided). For `next/`,
[program shape](../docs/direction/program-shape.md) replaced this rule by name: an output there is
a value picked from the model and sent when it changes.

## Decision

**An output is heard once, by whoever listens at that moment, and kept nowhere.**

- Anything a viewer who comes late needs lives in a machine's state, served as
  `run.machines.<name>.state()` and `.changes`.
- This holds for today's version only.

## Consequences

- A listener that attaches late reads state, never a replay of outputs.
- A `next/` agent follows program shape, not this file.
