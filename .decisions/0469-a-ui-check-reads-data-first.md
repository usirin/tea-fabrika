---
id: 0469
title: A UI check reads the most structured thing that shows the bug, tokens before the tree and boxes before pixels, and a found UI bug's fix lands with a law at the lowest layer that would have caught it
status: accepted
date: 2026-11-07
tags: [ui, verification, laws, layers]
---

# 0469: A UI check reads the most structured thing that shows the bug, tokens before the tree and boxes before pixels, and a found UI bug's fix lands with a law at the lowest layer that would have caught it

```ts
// From the note: each bug pinned at the lowest layer that can say it.
const pins = [
  { bug: "'esc leaves' at 2.14:1", layer: 1, law: "every color the CSS draws as text reads 4.5:1" },
  { bug: "explanation cut with … at 1024x700", layer: 4, law: "must-read text is never cut, at every layout" },
] as const;
// Layers: 1 tokens, 2 machine, 3 DOM and ARIA, 4 layout, 5 golden images, 6 model judge, 7 a person.
```

**What this decides:** where a UI check looks, in today's app first, and in every `next/` window.

## Context

A person found every bug the shots showed; nothing kept the next one from coming back. From
[UI verification](../docs/direction/ui-verification.md#u1-check-the-data-first-the-pixels-last), U1.

## Decision

**Check the data first, the pixels last.**

- A UI check reads the most structured thing that shows the bug: tokens before the tree, the tree
  before boxes, boxes before pixels.
- A found UI bug's fix lands with a law at the lowest layer that would have caught it, or says why
  no layer can.

## Consequences

- Layers 1 to 4 are laws in the app's own tests and shot script, beside the code they check.
