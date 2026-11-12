---
id: 0512
title: A picker is five parts, a program writes only its sources, and pick is one program run in the palette layer by Cmd-K and in a tile on a pipe, never frame code
status: accepted
date: 2026-11-07
tags: [ui, picker, palette, programs, next]
---

# 0512: A picker is five parts, a program writes only its sources, and pick is one program run in the palette layer by Cmd-K and in a tile on a pipe, never frame code

```ts
// A sketch. A searchable row carries an id and an `open` flag for ranking.
type SearchableItem = { id: string; location: Location; title: string; hint: string; open: boolean };
type Program = {
  index?: (model: Model) => ReadonlyArray<SearchableItem>;
  prefix?: string;     // `t`: a word and a space narrow the box to this program's rows
  commands?: Commands; // also the actions on this program's rows
};
```

**What this decides:** who owns which part of a picker, in `next/` (Tier 2). Today's palette is
only the example.

## Context

Each program could have drawn its own search box. From
[pickers](../docs/direction/picker-guidelines.md#q1-a-picker-is-five-parts-and-a-program-writes-only-its-sources),
Q1, the shape and Q9.

## Decision

**Sources are the program's; everything else is the desk's.**

- A picker is five parts: a source hands rows, the desk ranks them, each row has an id, a row has
  actions, and a row may have a preview.
- A program writes only `index`, `prefix` and `commands`. The desk owns the box, the ranker, the
  keys and the stack. No program draws its own Cmd-K.
- A searchable row carries a program-scoped `id` and an `open` flag for ranking. The desk keys a row
  by program and id. A program may declare one `prefix`.
- `pick` is one filter program: rows in, one row out. Cmd-K runs it over the desk's index in the
  palette layer, and it runs in a tile on a pipe too. Never frame code.
- The Cmd-K box has no preview. The ticket tile beside a tiled pick is the only one.

## Consequences

- The group heading needs a plural word; the build plan picks between a `noun` field and the
  program's name.
