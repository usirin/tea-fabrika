---
id: 0466
title: A window reads its model only through tea's useRuntime and draws the value it returns, and memoizing is the Compiler's job, so new code writes no useMemo, useCallback or memo
status: accepted
date: 2026-11-03
tags: [react, compiler, tea, useRuntime, next]
---

# 0466: A window reads its model only through tea's useRuntime and draws the value it returns, and memoizing is the Compiler's job, so new code writes no useMemo, useCallback or memo

```tsx
// next/: each tile reads its own part through a selector, with plain-value props.
const view = useRuntime(run, (m) => m.views[id]);
```

**What this decides:** how a window reads state and who memoizes, in `next/`.

## Context

A component that calls the store hook, drops its value and reads a module store keeps its first
output forever once compiled, and no tool reports it. From
[React Compiler from day one](../docs/direction/react-compiler.md#c4-one-store-hook-and-its-value-is-what-you-draw),
C4 and C6, changed 2026-11-05 when tea 0.23.0's `useRuntime` took the Effect engine. AGENTS.md
says the hook too.

## Decision

**One store hook, tea's `useRuntime`, and its value is what you draw.**

- A window reads its model only through `useRuntime`, and draws from the value it returns. Never a
  module store read during render, and no stand-in hook.
- In `next/**`, `useSyncExternalStore` is imported nowhere. A store hook called with its value
  dropped fails `fabrika/one-store-hook`.
- New code writes no `useMemo`, `useCallback` or `memo` by default: memoizing is the Compiler's job.
- A tile reads its own part through a selector, and gets plain values as props.

## Consequences

- The note's older lines about `useModel` and `window/use-model.ts` are history, not rules.
