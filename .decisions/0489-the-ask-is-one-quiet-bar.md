---
id: 0489
title: The ask is one quiet bar under the ticket title with no box, a selected row is a full-row fill marked aria-selected, and every other card is one quiet box with nothing nested
status: accepted
date: 2026-11-08
tags: [ui, asks, look, cards, accessibility, today]
---

# 0489: The ask is one quiet bar under the ticket title with no box, a selected row is a full-row fill marked aria-selected, and every other card is one quiet box with nothing nested

```ts
// A sketch of design E, in words a test or a shot can check.
const ask = {
  place: "under the ticket title", box: null, scroll: "with the ticket",
  rec: ["Recommended", "Approve", "95% sure", "Did this need you?"], // "Recommended" once
  picksRule: "lighter line",
};
const selectedRow = { mark: "full-row fill", text: "stronger", aria: "aria-selected" };
const card = { fill: "slate 3", edge: null, radius: 8, nested: 0, indigo: 1 };
```

**What this decides:** how the ask, the rows and the cards look. Today's app built it (ticket 102);
`next/` takes it.

## Context

The look step of 2026-11-02 set the rows and cards; design E on 2026-11-08 replaced the "Your turn"
card for the ask. From [the ask desk](../docs/direction/ask-desk.md#the-look).

## Decision

**Quiet, with no extra containers.**

- The ask is one quiet bar under the ticket's title, where the "Your turn" card sat. It has no box,
  scrolls with the ticket, and shows "Recommended" once, with a lighter line under the picks
  (2026-11-08).
- A selected row is a full-row fill with stronger text, marked `aria-selected`, never a colored bar
  on one side and never `aria-current` (Q4).
- The running, stuck and done cards share one quiet box: slate 3 fill, no edge, 8px corners,
  nothing nested, one indigo button (Q3).
- The box around a ticket's properties goes (Q5), as AGENTS.md's "no extra containers" asks.

## Consequences

- In a narrow tile the properties must still read as their own group without the box; the narrow
  shots check it.
