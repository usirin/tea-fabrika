---
id: 0281
title: In today's version, each machine hands its state schema to its program's store and migrate decodes saved state with it, so a job saved by older code is refused and the other jobs open, never loaded on trust
status: accepted
date: 2026-10-25
tags: [state, schema, migrate, host, jobs, todays-version]
---

# 0281: In today's version, each machine hands its state schema to its program's store and migrate decodes saved state with it, so a job saved by older code is refused and the other jobs open, never loaded on trust

**What this decides:** what today's host does with a saved job whose shape the new code does not
know.

```ts
migrate: (raw) => {
  if (raw === null || raw === undefined) return null;
  const exit = decode(raw); // Schema.decodeUnknownExit of the state's own schema
  return Exit.isSuccess(exit) ? exit.value : refuse("not a saved state");
},
```

## Context

Decided by the owner in
[an old host is named, then restarted](../docs/direction/an-old-host-is-named-then-restarted.md)
(section 1), tracker ticket 12, built 2026-10-26. Today's version only (`packages/fabrika`,
`apps/fabrika`, tsh). In `next/` the same check runs per process
([0291](0291-hot-reload-swaps-one-program.md)).

## Decision

**A saved state is decoded with its own schema, or refused.**

- Each machine hands its state schema to its program's `store`, and `migrate` decodes with it, as
  the journal does.
- A job that does not fit is refused, "this job was saved by older code, can't open it", and the
  other jobs open.
- The note's "no version number on each machine" no longer holds where state is carried forward: a
  saved model carries its shape's number and a chain of named upgrades
  ([saved state, S3](../docs/direction/saved-state.md)). The schema is still the last check.

## Consequences

- A state schema for every machine the host keeps; 12 had none and got one.
- Not tested yet: that each schema takes every state its machine can reach.
