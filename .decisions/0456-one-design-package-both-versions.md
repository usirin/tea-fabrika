---
id: 0456
title: fabrika's design lives in one package both versions import, the one exception to sharing code, its contents rethought from settled notes and the old copy deleted when a file moves in
status: accepted
date: 2026-11-02
tags: [design, design-package, versions, rethink]
---

# 0456: fabrika's design lives in one package both versions import, the one exception to sharing code, its contents rethought from settled notes and the old copy deleted when a file moves in

```ts
// today's app, apps/fabrika
import { fabrika, terminalTheme } from "@kampus/fabrika-design";
import "@kampus/fabrika-design/tokens.css";

// next/, a window
import "@kampus/fabrika-design/tokens.css";
```

**What this decides:** where the colors, the Manti mapping and the text styles live, and how a
file gets there.

## Context

Both versions need the same look, and the clean slate forbids sharing code. From
[one design package](../docs/direction/fabrika-design-package.md#how-it-fits-rethink-do-not-port-and-clean-slate).
Moved in P31 ([PR 431](https://github.com/usirin/tea-fabrika/pull/431)).

## Decision

**`@kampus/fabrika-design` holds fabrika's design, and today's app and `next/` both import it.**

- It is the one named exception to the two versions sharing no code. It never becomes a way to
  share anything else.
- What it holds comes from settled notes. A file moving in is rethought against them, never copied
  as it is.
- The pull request that moves a file in deletes the old copy from `apps/fabrika`, with its tests
  moved first.
- A design-system page is made from the package's data, never written by hand
  ([0450](0450-design-notes-sit-on-five-levels.md)).

## Consequences

- The package holds the themes, the token files and build, `tokens.css` and the Manti mapping. The
  text styles join it ([0457](0457-six-text-styles-set-every-size.md)).
- It is modeled on `@kampus/design` in the public kamp-us/phoenix repo.
