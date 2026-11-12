---
id: 0468
title: A canvas decides a look and never proves a build, mounts the system's real components and never look-alikes, is named in the repo by title only, and gets a person's look each round
status: accepted
date: 2026-11-03
tags: [design, claude-design, canvas, shots]
---

# 0468: A canvas decides a look and never proves a build, mounts the system's real components and never look-alikes, is named in the repo by title only, and gets a person's look each round

```html
<!-- A sketch: one artboard. Manti's real parts and ours, mounted from the bundle's global. -->
<link rel="stylesheet" href="ds/fabrika/tokens.css" />
<script src="ds/fabrika/components/bundle.js"></script>
<x-import component-from-global-scope="Fabrika.Kbd">⌃B</x-import>
```

**What this decides:** what a Design canvas may stand for, and what the repo keeps of it, in both
versions.

## Context

A canvas can look right and still differ from the build. From
[designs are drawn on Claude Design](../docs/direction/design-on-claude-design.md#which-version).

## Decision

**A canvas is for deciding a look.**

- It never proves a build. A pull request's shots come from the real built app.
- It mounts the system's real components from its bundle, never look-alikes. A part the bundle
  lacks is drawn as a named gap.
- The canvas is private, so the repo names it by title only, never by link.
- The design system's contents come from settled notes, never today's shapes. Once its code is in
  `@kampus/fabrika-design`, it is synced, never edited by hand on its page
  ([0450](0450-design-notes-sit-on-five-levels.md)).
- The canvas type tells an agent not to check its own render, so a person looks at each round once.

## Consequences

- Parts built from the notes' sketches stay listed under "Not synced" in the system's README until
  their code moves into the package.
