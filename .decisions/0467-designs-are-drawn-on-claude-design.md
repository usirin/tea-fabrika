---
id: 0467
title: Designs are drawn on a Design canvas with the design system installed, and a guidelines study is one canvas of slides ending in a clickable prototype beside the real app's shots
status: accepted
date: 2026-11-06
tags: [design, claude-design, guidelines, prototypes]
---

# 0467: Designs are drawn on a Design canvas with the design system installed, and a guidelines study is one canvas of slides ending in a clickable prototype beside the real app's shots

```text
guidelines                  one Design canvas: slides, then a clickable prototype
explorations, prototypes    a Design canvas, the design system installed
a keyboard walk             the prototype's focused window, on the same canvas
the decision and its why    docs/direction/, as before
shots of the real app       the real built app, as before
```

**What this decides:** where design work is drawn, in both versions.

## Context

Hand-built HTML mockups drifted from the built screen, and a demo lifted from saved DOM had presses
that did nothing. From [designs are drawn on Claude Design](../docs/direction/design-on-claude-design.md#designs-are-drawn-on-claude-design),
decided 2026-11-03 and changed 2026-11-06.

## Decision

**Design explorations and prototypes are drawn on a Design canvas in Claude Design, with the design
system installed, never a hand-built HTML page.**

- A guidelines study is one Design canvas: slides that walk the story, ending in a clickable
  prototype on the design system, driven by a small state machine, so every key and click the
  guidelines name does something.
- A keyboard walk lives on the same canvas: keys go to the prototype's focused window. No plain
  keyboard page.
- The real app is still built and shot. Its shots sit beside the prototype on a slide, as the
  reference the prototype must match.

## Consequences

- A prototype is built by hand on the real parts, so it can drift in what it does. The press
  checklist and the owner's look per round hold it; nothing checks it in code.
