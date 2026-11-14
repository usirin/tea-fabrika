---
state: "decided; the host's clock breaks it, fixed in the core sweep"
summary: "Effect's own modules first; Node only at a thin edge, named in a comment. Check Effect before building our own. Types come from inference, not by hand."
---

# Build on Effect; let types be inferred

Decided 2026-10-17. Type inference: 2026-10-13.

Its decided rules are in: [0250](../../.decisions/0250-effect-modules-first-node-at-an-edge.md), [0251](../../.decisions/0251-types-are-inferred-except-contracts.md), [0254](../../.decisions/0254-tea-is-the-one-engine.md).

```ts
// Yes: Effect's platform, with Node at one named edge.
const fs = yield* FileSystem.FileSystem;
// Node at the edge: readline, because Effect's Terminal has no line editing.

// Yes: the type comes from the schema.
type Ticket = typeof Ticket.Type;
```

## What was decided

- **Use Effect's own modules where they exist:** FileSystem, Path,
  ChildProcess, the platform layers, KeyValueStore.
- **Node only at a thin edge, said out loud.** Where Node is touched, a comment
  names exactly what and why.
- **Check what Effect has before building our own** (2026-10-18). For example,
  Effect's `Entity` was checked and not taken for machine refs; the design of
  its cluster `MessageStorage` was copied for pipe acks.
- **One exception, in `next/`** (2026-11-02): a module that would replace a tea
  machine, such as Effect's `Workflow` or cluster's `Entity`, does not come in.
  Its ideas may be copied into a machine. See
  [tea is the engine](./tea-is-the-engine.md).
- **Types are inferred, not written by hand.** Having to spell out a type that
  the code already knows is a smell.

## Why

- Effect's modules come with Layers, so a test swaps the real file system for
  a fake one with no extra work.
- One way of doing a thing across the repo is easier to read than two.

## Where the code still breaks it

- **The clock.** The host and the ledger read `Date.now()` directly, about 49
  times in `packages/fabrika/src/host`. A test cannot use Effect's
  `TestClock` there, so experiment 116 needed a one-hour lease, and host law 30
  ("wall time runs from registration, across restarts") failed once on a slow
  CI runner. Decided 2026-10-22: fixed in the core sweep, with a lint rule that
  bans `Date.now()` and `new Date()` in the packages, so time comes only from
  Effect's `Clock`. A place that truly needs the wall clock gets a named
  exception with its reason.

```ts
// Today, in the host:
const expired = lease.expiresAt <= Date.now();
// After the sweep:
const expired = lease.expiresAt <= (yield* Clock.currentTimeMillis);
```

## What would change it

A place where Effect's module is missing what is needed, often enough that the
Node edge keeps growing.
