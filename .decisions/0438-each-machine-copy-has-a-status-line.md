---
id: 0438
title: In today's version, each machine copy has a status line, a required state-to-string declared on its kind in tea-program, never in tea
status: accepted
date: 2026-10-18
tags: [tea-program, status, machines, jobs, todays-version]
---

# 0438: In today's version, each machine copy has a status line, a required state-to-string declared on its kind in tea-program, never in tea

```ts
ship: kind({
  machine: ship,
  status: (s) => `${ref(s.pr)}: ${words(s)}`, // one line per copy: `#8: in the merge queue`
}),
run.machines.ship.copies(); // [{ id, line: "#8: in the merge queue", live }]
```

**What this decides:** where a program's one-line status is declared and how its copies show it.

## Context

From [tea-program](../docs/direction/tea-program.md#parts-already-decided), built in experiment 73.
tea stays small, so the line lives in tea-program.

## Decision

**`status` is a `state => string` on each kind, typed by that machine's state.**

- It is required on every kind: a kind with no line does not compile, and is refused past the types.
- A program with many copies of one machine shows one line per copy, keyed by its id, so a stuck
  copy is not hidden by a newer one. An ended copy keeps its row until the run ends.
- tsh's `jobs` shows the lines under the job, and the line is the copy span's `tea.status` tag.

## Consequences

- tea itself is unchanged.
