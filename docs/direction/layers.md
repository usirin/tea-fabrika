---
state: "decided 2026-11-03"
summary: "Both versions, today's app first. Six named layers in one order the frame owns, low to high: desk, sheet, float, popover, palette, tooltip; no program picks a z-index (L1). Every layer has an owner and goes when it goes: a sheet is one tile's, the rest are desk-wide, and a float is a whole tile lifted, only by the person's choice (L2). The status bar names the layer that takes the keys; the prefix and F6 always work (L3). One modal at a time on the smallest owner, inert under it; Esc peels the top (L4). Nothing covers what you work on (L5). A look unfolds in place beside the list, not Linear's float, and a peek keeps focus on the list, an exception to program guidelines G4 R2 (L6). Built in today's app as D1's fixes, then D3's sheet, then D4's unfold; the desk inert under the palette is tracker ticket 203. Open: what the ledger records, and program guidelines' call 8, a side panel. From experiment 207."
---

# Layers: what sits on top, who owns it, and who takes the keys

Its decided rules are in: [0264](../../.decisions/0264-the-frame-owns-named-layers.md), [0265](../../.decisions/0265-one-modal-esc-peels-the-top.md), [0266](../../.decisions/0266-a-look-unfolds-in-place.md).

**Decided 2026-11-03.** The owner approved the six principles, L1 to L6, and the smaller calls 1 to 4
below, after a walk of each part. The leans' confidence numbers stay as written. In the walk the
owner took these:

- **L2:** a sheet belongs to one tile. A float, a popover, the palette and a tooltip are desk-wide. A
  float is a whole tile lifted, and only when the person asks for it (experiment 206's
  `place = "float"`).
- **L6 and call 3:** a look unfolds in place, not Linear's float. Program guidelines G3 (land
  beside), [fold, not tabs](./fold-not-tabs.md) and L5 point there. Floats stay opt-in.
- **Call 2:** a peek keeps focus on the list. This is an exception to program guidelines G4 R2, for
  a peek only, and G4 now says so.
- **Call 4:** the desk is inert under the palette. Filed as tracker ticket 203.

Not walked, and still open: [what the ledger records](#what-the-ledger-records) is a lean, and
[call 8 of program guidelines](#8-is-a-side-panel-a-program), "Is a side panel a program?", moved
here from that note and waits on a day of use.

Built from [experiment 207](../../experiments/207-layers.md), which read about 20 makers and tools,
two of them outside software, and built four designs in today's app, and a private Design canvas,
"Layers guidelines", with every design and layout pressable. Neither is a measurement. A tag such as
`[m1]` points at that experiment's links.

```ts
// A sketch, next/. Low to high. The frame draws them in this order; no program picks a number.
type Layer =
	| {_tag: "desk"}                    // tiles and strips
	| {_tag: "sheet"; tile: TileId}     // a program's own layer, on its own tile only (L2, L4)
	| {_tag: "float"; tile: TileId}     // only if the person's place says float (206)
	| {_tag: "popover"; item: string}   // the frame's: the inbox list, an item's lines
	| {_tag: "palette"}                 // the one desk-wide modal
	| {_tag: "tooltip"; for: string};   // never while a popover or the palette is open

// Who takes the keys is a second fact (L3). `takes`: every key but the prefix and F6.
type Keys = "takes" | "passes";
```

```text
one sitting, traced (today's version, as design D3 runs it, with D4's peek)
C-b a      the inbox list opens: a popover, takes keys         status bar: ASKS · the menu takes the keys
Space      D4: the ticket strip beside opens in place           focus stays in the list; the peek follows j and k
Enter      focus moves into the ticket (G4 R2)                  the list closes
           the answer opens as a sheet on t2 only               status bar: SHEET · on t2 · takes t2's keys
           t1 keeps its half-typed line and still works         only t2's view is inert
Cmd-K      the palette: the one desk-wide modal                 the whole desk is inert (ticket 203)
Esc        the palette closes; focus back in the sheet's note box
Esc        the sheet closes; focus back in t2's ticket
```

The words on the status bar are the layer's own name, as a mode's word is (modes M3). Today's
menu is titled Asks, so it says `ASKS`; after the rename to inbox (program guidelines G8) it says
`INBOX`. Today's code calls the status bar the bottom line.

## Which version

- **Today's version (`apps/fabrika`):** built first, in three pull requests and one small fix
  (ticket 203). See [the build](#the-build-in-todays-version).
- **`next/`:** all of it, with tezgah, the window manager, in Tier 2. The `Layer` union is the
  frame's, and a program returns its sheet as part of its view. Nothing about layers is built in
  `next/` yet.

## The shape

```ts
// A sketch, next/. What the frame holds. Today's `Over` stays one value: one thing over the tiles.
type Frame = {
	over: Over;                              // none | asks | jobs | item | palette, as today
	sheets: ReadonlyMap<TileId, Sheet>;      // at most one per tile (L4)
};
type Sheet = {for: string; opener: string}; // what it answers, and where focus goes back (made up)

// Where a key goes: today's keyGoesTo (frame.ts:832) grows one case per layer.
// palette > popover > the focused tile's sheet > the focused tile.
// The prefix and F6 reach the desk under every layer (modes M4, WCAG 2.1.2).
```

```ts
// Today's version, as design D4 built it: a peek is an unfold that leaves focus where it is.
// apps/fabrika/src/desk/desk.ts
type DeskMsg =
	| {readonly type: "unfold"; readonly node: NodeId} // today: open a strip and focus it
	| {readonly type: "peek"; readonly node: NodeId};  // open it in place; focus stays
```

How it was checked: the four designs ran on today's app at five layouts, 62 states, and each press
was saved with the state it reached (experiment 207's `shots/`). No type probe ran for the `next/`
sketch.

## The six principles

### L1: a few named layers, in one fixed order, owned by the frame

**Decided 2026-11-03. Lean, 80%. Kind: law and lint.**

- **What it means.** Desk, sheet, float, popover, palette, tooltip, low to high. The frame draws them
  in that order. No program picks a z-index.
- **Why.** NSWindow picks a level by name, never a number [m1]. Neovim, for plugin floats: "Below 100
  is recommended" [m2]. i3: "Floating windows are always on top of tiling windows." [m5]
- **Linear as the builder.** Linear keeps a fixed CSS ladder, popover 600 up to context menu 1200
  [p5]. On our pieces the ladder is the frame's, and every program gets it for free: a program says
  "a sheet" and the frame places it.
- **Elm.** The parent draws one tree. A child returns its layer as data, and the frame places it.
- **What holds it.** The `Layer` union in the frame, and a lint that refuses `z-index` anywhere but
  the frame's own layer block.
- **Doubt.** Whether a sheet sits under or over a float. Lean under: the float is the person's pick.
  No float is built beside a sheet yet, so a shot would settle it.
- **Cost.** About 40 lines and one lint (a guess).
- **Today: half.** The order exists as three loose CSS numbers: `.scrim` 9 (the palette's backdrop,
  which paints nothing since 2026-11-06 and still takes a press outside), `.pop` 10, `.tip` 20
  (`window/window.css:1166`, `:840`, `:1297`).

### L2: every layer has an owner, and goes when its owner goes

**Decided 2026-11-03. Lean, 80%. Kind: law.**

- **What it means.** A sheet's owner is its tile. A popover's is a top bar item; the palette's is the
  window. A float is a whole tile lifted, so its owner is that tile, drawn desk-wide. A tile that
  closes, folds or is hidden by a zoom takes its layers with it, and focus goes where the tile
  guidelines say (reading order).
- **Why.** Emacs: a child frame "always appears on top of its parent frame", and hides with it [m3].
  Neovim floats are `relative` to a window [m2]. OTP links: when one side ends, it will "send an exit
  signal to the other" [m7].
- **Linear as the builder.** Linear's peek closes when its list goes. On our pieces the desk does it
  for every program: no program writes its own cleanup.
- **OTP.** A link between the layer and its tile.
- **What holds it.** A desk law in tests: no layer outlives its owner's tile.
- **Doubt.** A sheet with a half-typed note when its tile is zoomed away. Lean: hide it, keep the
  draft in the model.
- **Cost.** About 20 lines in the desk model (a guess).
- **Today: no case yet.** Every layer is the frame's. Design D4 showed the break this rule stops:
  with t1 zoomed, Space peeked a tile hidden by the zoom, and the list still said `Space Peek`.

### L3: what is on top and who takes the keys are two facts, and both are said

**Decided 2026-11-03. Lean, 80%; 65% that the words read well at a glance. Kind: law.**

- **What it means.** When a layer takes the keys, the status bar names it, as a mode's word is named:
  `ASKS`, `PALETTE`, `SHEET · on t2`. The prefix and F6 work under every layer.
- **Why.** macOS keeps the main window (what you look at) and the key window (what takes input)
  apart. Neovim floats have `enter` and `focusable` [m2].
- **Linear as the builder.** A peek is on top while the list keeps the keys [p3] (**secondary** on
  the keys). On our pieces the status bar is the one place that says where keys go, for every program.
- **Elm.** One pure function decides where a key goes: today's `keyGoesTo`.
- **Accessibility.** WCAG 2.1.2 [a4]: the prefix and F6 always reach the desk. Here we leave tmux,
  whose modal pane takes "all keys, including the prefix key" [m4].
- **What holds it.** `keyGoesTo` grows one case per layer, with a test per case.
- **Doubt.** The words. A week of use would tell.
- **Cost.** About 20 lines for the words (built in D1 to D4).
- **Today: breaks.** With the asks menu or the palette open, the status bar still says `t1 tsh`.

### L4: one modal at a time, on the smallest owner; `Esc` peels the top; focus goes back

**Decided 2026-11-03. Lean, 85% on `Esc` and focus; 60% on the tile scope. Kind: law.**

- **What it means.** One modal desk-wide: the palette. A program's modal is a sheet on its own tile,
  and only that tile is inert under it. Under the palette, the whole desk is inert. `Esc` closes the
  top layer and nothing else, and focus goes back to the opener.
- **Why.** APG: "Windows under a modal dialog are inert." [a1] Apple: "Let people dismiss a modal
  view before presenting another one." [p1] Apple scopes a sheet to one window [p2].
- **Linear as the builder.** One modal at a time; `Esc` closes the top one. On our pieces a tile is
  the smallest owner, so a sheet stops at its tile's edge.
- **Elm.** The frame's `Over` holds one thing; a sheet is a second slot, one per tile.
- **What holds it.** `Over` stays one value, each tile gets one sheet slot, and a test: under the
  palette, every tile is inert.
- **Doubt.** The tile scope is a guess past the makers: macOS scopes a sheet to a window, not a pane.
  In a 2x2 tile the sheet covers its tile whole. Use will tell whether that is cramped.
- **Cost.** Inert under the palette, about 5 lines (ticket 203). A sheet slot, about 150 lines.
- **Today: half.** `Esc` peels one layer and focus goes back (`window/frame.ts:798`, `escaped`;
  `window/pop.tsx:127`, `useOverlay`). The palette is `aria-modal` (`window/pop.tsx:534`) while the
  workspace is inert only when the link is down (`window/desk.tsx:867`).

### L5: nothing covers what you are working on

**Decided 2026-11-03. Lean, 80%. Kind: law (a box check in tests) and taste (shots).**

- **What it means.** A layer that leaves the keys below must not cover the focused tile or row.
- **Why.** WCAG 2.4.11: the focused part "is not entirely hidden due to author-created content" [a2].
  IFALPA warns of "obscuring outside visual details ... by HUD clutter" [o3].
- **Linear as the builder.** Linear's peek sits on the list's right side and the selected row stays
  in view (one picture, not measured). On our pieces a look opens beside, so nothing is covered (L6).
- **Elm.** No Elm answer: it is a layout rule the frame checks.
- **Accessibility.** 2.4.11, and 1.4.13 [a3] for a tooltip: dismissible, hoverable, persistent.
  Hoverable needs a check.
- **What holds it.** A box check in tests: the focused tile's box does not lie under a layer that
  passes keys.
- **Doubt.** A tooltip over the focused row.
- **Cost.** About 30 lines for the check (a guess).
- **Today: follows.** Only the palette covers tiles, and it takes the keys while it is up. Design D2
  broke it: its float hid t4 whole in a 2x2 at 1024x700.

### L6: a look opens in place before it floats

**Decided 2026-11-03: unfold in place. Lean, 60% before the walk, a guess; the owner picked the
unfold at about 80%. Kind: taste, with a law for focus.**

- **What it means.** A look at another program's thing opens as a strip beside the list, unfolded in
  place. Focus stays on the list, the peek follows the selection, and `Esc` or Space folds it back.
  Enter moves focus in. No new layer.
- **Why.** VS Code's peek: "we embed the result inline" [m8]. Ableton folds its own devices in the
  chain [o1]. tmux and i3 make a look a split.
- **Linear as the builder.** Clash: Linear's peek floats, Quick Look style [p3]. The owner picked the
  unfold, since program guidelines G3 says a new tile lands beside, fold, not tabs keeps the picture,
  and L5 holds by construction. A float stays the person's opt-in through 206's placement.
- **Elm.** The strip is the same tile model, drawn open or folded. No second program.
- **What holds it.** A law: a peek opens a strip and never moves focus; Enter does.
- **Doubt.** Fold, not tabs says moving focus onto a strip opens it. This adds a second way to open
  one, which may confuse.
- **Cost.** About 80 lines and 2 agent hours (a guess), plus D4's two fixes.
- **Today: no case yet.** Today has no look: Enter on an ask turns the tracker or says "no tile shows
  #117 · the tracker opens it" (`window/frame.ts:378`).

## The smaller calls

### 1. Which designs, in which order

**Decided 2026-11-03. Lean, 60%.** D1's fixes now, D3's sheet next, D4 after its two fixes. Floats
stay the person's opt-in.

```text
sheet and unfold (taken)   nothing covers a tile you did not ask about
floats first               206's place, tmux 3.8's way; covers neighbors
both                       more to build and to teach
```

- D4's two fixes: the list covers the peek's title (side by side), and a zoom hides the peek (L2).

### 2. A peek keeps focus on the list

**Decided 2026-11-03. Lean, 60%.** Yes, for a peek only. Enter still moves focus in.

```text
yes, for a peek (taken)    j and k keep moving the list; one line in program guidelines G4
no                         every open takes focus; D4 becomes D1
```

- **Doubt.** Two ways to open a strip may confuse.

### 3. Linear floats its peek; we unfold it

**Decided 2026-11-03.** No lean before the walk, since it is a clash with Linear. The owner picked
the unfold (L6).

### 4. The desk is inert under the palette

**Decided 2026-11-03. Lean, 90%.** A plain fix in today's version, about 5 lines in
`window/desk.tsx`. Filed as tracker ticket 203.

### 8. Is a side panel a program?

**Open. Moved here from [program guidelines](./program-guidelines.md#8-is-a-side-panel-a-program)
(PR 332). Not walked. Lean, 65%, a guess.**

A block about the same thing is a section of that program's view. A block about another thing is
another program's tile.

```text
ticket's properties    same thing (this ticket's own folds)    a section of ticket's view
live agent panel       another thing (a run, trace's job)      ticket | trace, two tiles
```

- **Why:** program guidelines G1 (one job per program) and G6 (programs meet on typed pipes). L6
  agrees: a look at another thing opens beside, as a tile.
- **What would settle it.** A day of use with `ticket | trace`: whether a ticket that always opens
  with its run beside it is noise.

## What the ledger records

**Proposed, not walked. Lean, 70%.**

- Each layer opened and closed, with `via` (keybindings already records a command's `via`) and how it
  closed: `why: "escape" | "outside" | "done" | "owner_gone"`. This is lost forever if it is not
  written when it happens: nothing rebuilds why a sheet closed.
- For a peek: whether it turned into an open (Enter). It tells whether peek earns its place.

## The build in today's version

Planned the same day, in the order the owner sees it. Sizes are guesses from the designs' code.

| Pull request | What it builds | Lines | Agent hours |
|---|---|---|---|
| Ticket 203 | The desk inert under the palette (L4) | ~35 | under 1 |
| 1 | The status bar names the layer that takes the keys; one layer order, owned by the frame; the z-index lint (L1, L3) | ~150 | 1.5 |
| 2 | The sheet, one per tile, with L2's and L4's laws | ~330 | 3 |
| 3 | The peek unfolds in place, with D4's two fixes and the peek-keeps-focus rule (L6, call 2) | ~260 | 2.5 |

## Where this differs from settled notes

- **[Popovers](./popovers.md) and [the frame](./the-frame.md):** "one thing over the tiles at a time"
  becomes one thing over the tiles, plus one sheet per tile.
- **[Modes](./modes.md):** M5 says a popover is not a mode; the same holds for a sheet. Its word on
  the status bar follows M3.
- **[Fold, not tabs](./fold-not-tabs.md):** moving focus onto a strip opens it. A peek is a second way:
  open without focus.
- **[Program guidelines](./program-guidelines.md):** G4 R2 (the new tile takes focus) gets one
  exception, for a peek. Its call 7 (a look over the desk, moved to experiment 206) is answered here
  for today's desk: a look unfolds; a float is 206's opt-in.
- **[Tile guidelines](./tile-guidelines.md):** a tile's accessible name gains `, sheet open`, beside
  `, zoomed` and `, closing`.

## What it costs

- One sheet slot per tile, and one layer word on the status bar.
- A `peek` desk message, and a footer hint `Space Peek` that shows only when a peek can open.
- One lint, and laws for L2, L4 and L5.

## Made up here

The setting `fabrika.layers`; the `peek` message; the sheet's words ("Note, sent with your answer",
"Optional for approve. Say why for no.", Cancel); the status bar words `ASKS`, `PALETTE`, `SHEET` and
their lines, "C-b o leaves it open" included; the float word and D2 floating the ticket tile by a
setting; the `Space Peek` hint; ticket #117 cut back to its first ask; the writer id `github:7`; the
half-typed `git log --oneline -3`; the `Sheet` type's fields; the D1 to D4 names. Linear's names are
its own.

## What it cannot tell us

- Nobody used these designs on real asks. Every lean is a reading of shots, not a measurement.
- One ask only, so the list never showed a peek following a second, different ticket.
- No screen reader ran. The sheet, the inert desk and the layer words need a VoiceOver run.
- Whether a sheet in a small tile is cramped, and whether two ways to open a strip confuse. A week of
  use would tell.
- Whether a sheet sits under or over a float: no float is built beside a sheet.
