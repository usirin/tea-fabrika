---
id: 0463
title: next/ is React Compiler compatible from day one, on oxc's native port with no Babel, and today's app follows the same rules as a tryout
status: accepted
date: 2026-11-02
tags: [react, compiler, oxc, build, next, today]
---

# 0463: next/ is React Compiler compatible from day one, on oxc's native port with no Babel, and today's app follows the same rules as a tryout

```ts
// A sketch, from experiment 195: one step that the build and `pnpm lint:compiler` both call.
import { transformSync } from "oxc-transform-react"; // oxc's Rust port of the Compiler

export const compile = (id: string, code: string) =>
  transformSync(id, code, {
    jsx: { runtime: "automatic" },
    reactCompiler: { reportDiagnostics: true, environment: { validateNoImpureFunctionsInRender: true } },
  });
```

**What this decides:** that windows are written for the React Compiler, and which compiler runs.

## Context

A window that breaks the Compiler's rules freezes once compiled. From
[React Compiler from day one](../docs/direction/react-compiler.md#react-compiler-from-day-one) and
[how the build runs the Compiler](../docs/direction/react-compiler.md#how-the-build-runs-the-compiler),
with [experiment 195](../experiments/195-oxc-toolchain.md).

## Decision

**Every `next/` window is Compiler compatible from its first `.tsx` file.**

- Today's app follows the same rules, as the owner's tryout. What it teaches goes to `next/`
  rethought, never copied.
- No Babel in the build. The Compiler runs on oxc's native port, `oxc-transform-react`, pinned
  exact and bumped with oxlint.
- The Compiler's yardstick is our planted files plus a real window run, never Babel's output.
- Otherwise the Compiler keeps its defaults.

## Consequences

- How strict it is: [0464](0464-every-compiler-finding-fails-the-build.md).
- Rolldown as the bundler in `next/build.ts` is still a lean, not decided here.
