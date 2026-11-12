---
id: 0462
title: Popovers run Zag's machines directly on Manti's anatomy, never Manti's React Menu, and a row Manti has no shape for stays ours on Manti's tokens
status: accepted
date: 2026-10-30
tags: [design, manti, zag, popovers, today]
---

# 0462: Popovers run Zag's machines directly on Manti's anatomy, never Manti's React Menu, and a row Manti has no shape for stays ours on Manti's tokens

```tsx
// A sketch from the note: Zag's machine, Manti's part props, so Manti's CSS draws it.
const service = useMachine(menu.machine, {
  id: "asks",
  positioning: { getAnchorRect: () => itemRect ?? topEdge },
});
const api = menu.connect(service, normalizeProps);
<div {...api.getPositionerProps()}><div {...api.getContentProps()}>{rows}</div></div>
```

**What this decides:** where the app uses Manti's React parts and where it uses only Manti's look,
in today's version.

## Context

Our popovers open by key with no trigger, and Manti's `Menu` needs one. From
[UI on Manti](../docs/direction/ui-on-manti.md#4-every-piece-mapped).

## Decision

**A part that opens by key runs Zag's machine itself, on Manti's anatomy.**

- The asks list, the jobs menu, the palette's shell, the item lines panel and tooltips run Zag's
  `menu`, `dialog`, `popover` and `tooltip` machines with Manti's `data-scope` and `data-part`
  props, never Manti's React `Menu`.
- A row Manti has no shape for (the tracker list, the ticket timeline, the runs tracks, the trace
  waterfall) stays ours, styled from Manti's tokens.
- The terminals (ghostty-web's canvas) stay out of Manti: they are not UI parts.

## Consequences

- Our keys (`J`, `K`, a second action, fold) stay in our own code beside Zag's machine.
