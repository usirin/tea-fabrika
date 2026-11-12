---
id: 0435
title: In today's version, a program's storage writes are atomic and fenced, one record per run, and a kept machine run stays until its parent clears it, never by time
status: accepted
date: 2026-10-17
tags: [tea-program, storage, kept, fencing, todays-version]
---

# 0435: In today's version, a program's storage writes are atomic and fenced, one record per run, and a kept machine run stays until its parent clears it, never by time

```ts
const handle = yield* storage.open("ship:desk-1", flags); // start does this
handle.store("ship", intent);  // each save is atomic and fenced
// opened again elsewhere: this handle's next write fails `Stale`, like a stale file handle
yield* ref.clear;              // its parent is done with it: dropped from storage (refused while live)
```

**What this decides:** how today's program storage writes and when it lets go of a run.

## Context

From [tea-program](../docs/direction/tea-program.md#parts-already-decided). Today's code:
`packages/fabrika/src/program/storage.ts`.

## Decision

**Storage writes are atomic and fenced, with one record per run.**

- A second opener fences the first: the old handle's next write fails `Stale`.
- A kept machine run stays until its parent clears it, never by time. A clear is refused while the
  run is live.

## Consequences

- Nothing ages out on its own; a parent that never clears keeps its runs.
