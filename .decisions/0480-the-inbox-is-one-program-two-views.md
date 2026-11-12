---
id: 0480
title: The inbox is one program with two views, its glance in the top bar's slot and its tile, showing one list in two groups, Your turn then Messages, with one selection
status: accepted
date: 2026-11-08
tags: [ui, inbox, asks, glance, customization, today, next]
---

# 0480: The inbox is one program with two views, its glance in the top bar's slot and its tile, showing one list in two groups, Your turn then Messages, with one selection

```ts
// A sketch, today's version. One queue, two groups, one selection shared by both views.
type Row =
  | { _tag: "ask"; ask: AskId }                   // Your turn
  | { _tag: "stuck"; run: RunId }                 // Your turn
  | { _tag: "message"; from: Name; text: string }; // Messages: reply in the row
type Inbox = { rows: ReadonlyArray<Row>; selected: RowId | null; looking: RowId | null };

// "Open all" is a command, so it is a button with its key, a palette row and a tsh word.
const commands = { open: { send: { type: "open" }, keys: "<s-o>" } };
```

**What this decides:** what the inbox is and how its two views share one list. Today's app builds
it now; `next/` takes the same principles, with the glance as a view a program definition may have.

## Context

The asks lived in a popup the frame drew and a second desk was proposed beside it. From
[customization](../docs/direction/customization.md#c3-the-inbox-is-one-list-in-two-groups) (study
206's D1 with D3), which grows [the ask desk](../docs/direction/ask-desk.md#one-asks-program-two-views)'s
one asks program. The ask desk is the inbox program
([the frame](../docs/direction/the-frame.md#7-desk-means-five-things)).

## Decision

**One inbox program, two views, one list.**

- The glance sits in the top bar's slot, which holds `inbox` by default (2026-11-06). The tile is
  its full view. Both show the same rows, the same groups and one selection.
- One list in two groups: Your turn (asks and stuck runs) on top, then Messages, never a tab.
  Messages are what an agent or a person sends you.
- A new row is a status message, never a focus move (WCAG 4.1.3). The groups are labelled groups
  in the listbox.
- "Open all" is the inbox's `open` command: a button with its key, a palette row and a tsh word,
  never a footer typed by hand. With a row selected, it opens the tile on that row.
- "Open all" opens or focuses the one inbox tile, never a second one (2026-11-02).
- A look unfolds in place under its row. Only a person's place rule may float it.

## Consequences

- The ask desk's list-beside-detail tile gives way to one list with the look in place.
- How many glance slots the bar has, and where a new tile opens by default, are leans, not decided.
