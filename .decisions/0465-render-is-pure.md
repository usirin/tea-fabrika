---
id: 0465
title: Render is pure, so a view never reads the clock, never touches a ref's current and never changes what it was given
status: accepted
date: 2026-11-03
tags: [react, compiler, render, purity, next]
---

# 0465: Render is pure, so a view never reads the clock, never touches a ref's current and never changes what it was given

```tsx
// From the note: today's tooltip, in the shape this asks.
export const useTip = (tip: Tip, quiet: boolean) => {
  const id = useId(); // was useRef(`tip-${Math.random()}`).current, read in render
  // ...
};
```

**What this decides:** what a component may do while it draws, in `next/` and in today's app's
tryout.

## Context

The Compiler caches a component's output, so an impure render draws stale. From
[React Compiler from day one](../docs/direction/react-compiler.md#c1-render-is-pure-and-a-view-never-reads-the-clock),
C1 to C3.

## Decision

**Render reads only its props and its model.**

- A view never reads the clock. The time comes through a `now` Cmd, held by the Compiler's purity
  check and `fabrika/no-clock-in-view`.
- Render never reads or writes a ref's `current`. Refs are for effects and handlers, and an id
  comes from `useId`.
- Nothing changes after render: props, the model, a hook's value and what JSX was given stay as
  drawn.

## Consequences

- `react/refs`, `react/immutability` and `react/purity` hold it ([0464](0464-every-compiler-finding-fails-the-build.md)).
