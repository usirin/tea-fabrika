---
id: 0398
title: Each write reads the facts again right before it goes out, writes the proof from that read, and answers stale with nothing written when the read no longer passes
status: accepted
date: 2026-10-18
tags: [pipeline, steps, writes, merge]
---

# 0398: Each write reads the facts again right before it goes out, writes the proof from that read, and answers stale with nothing written when the read no longer passes

```ts
// Built in today's ship (packages/pipeline/src/stages/ship/door.ts).
const door = atTheDoor(cmd.ready, yield* readFacts(cmd.ready.pr));
if ("stale" in door) return "stale"; // the machine reads again
return yield* writes.enqueue(door.write); // the proof made just now
```

**What this decides:** what a step does in the moment between deciding to write and writing.

## Context

From [read fresh, run alone](../docs/direction/read-fresh-run-alone.md#built-in-ship-a-read-at-each-write),
built 2026-10-18. Experiment 91 found a fail posted between ship's read and its write still landing.

## Decision

**A write carries the proof of a read made just before it, never the one its Cmd carried.**

- Right before a write goes out (an enqueue, a merge), the facts are read again and go through the
  same gate.
- The proof written is the one made from that read.
- If the fresh read no longer passes, the write answers `stale`, nothing is written, and the
  machine reads again.

## Consequences

- How a merge is pinned to main is no longer ship's own door: a green pull request lands as
  [0097](0097-a-green-pull-request-lands-without-catching-up.md) says, and the merge queue merges
  pinned to the head it checked ([0107](0107-fabrika-provides-the-merge-queue.md)).
