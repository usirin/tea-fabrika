---
state: "decided 2026-11-08"
summary: "Today's version first. The keys editor is one searchable list in a tile, not a box over the tiles: the name on the left, keycaps on the right, recording in the row, each change said in words with Undo. A keyboard map is a second view of the same program, `keys --map`, drawn on the person's own keyboard layout and physical layout, never the system's guess. Seven principles; the owner picked the list, the keyboard map as a second view and the tile on 2026-11-08. Changes the frame's shortcuts list row."
---

# Keys editor

**Decided 2026-11-08** by the owner, after the look walk: build A first, as PR 1; D, the keyboard
map view (`keys --map`), is PR 2 of the same program. The leans below keep their numbers as
written. Decided before the walk, by the owner on 2026-11-08, after four designs were built in the
app and shot next to Linear:

- **The editor is one searchable list in a tile** (design A). It is built first.
- **A keyboard map is a second view of the same `keys` program,** `keys --map` (design D), built
  right after. It is drawn on the person's own keyboard layout and physical layout.
- **When the keyboard map does not fit a tile,** zoom (`C-b z`) and fold are the way out. The map
  was reworked so it fits a quarter of a 1024x700 window anyway (see [E5](#e5-one-model-every-size)).
- **`C-b ?` opens the editor in a tile, not in the palette's box over the tiles.** This changes the
  shortcuts list row of [the frame](./the-frame.md).
- **The system's keyboard layout is only a first guess.** The person picks the keyboard layout and
  the physical layout. Colemak-DH and Colemak-DHm are separate picks. Reading a Vial `.vil` file is
  a later idea.

Its decided rules are in: [0496](../../.decisions/0496-the-keys-editor-is-a-tile.md),
[0497](../../.decisions/0497-a-key-change-says-what-it-took.md),
[0498](../../.decisions/0498-the-person-picks-the-keyboard-layout.md).

Built from [experiment 233](../../experiments/233-keys-editor-guidelines.md), which read how
about fifteen makers do a keys editor and shot four designs in today's app, and a private Design
canvas, "Keys editor guidelines". Neither is a measurement. It builds on
[keybindings are configurable](./keybindings-are-configurable.md), decided 2026-11-01, and changes
none of its calls. The words are the industry's: a **keyboard map** (the view), a **keyboard
layout** (which character each key types) and a **physical layout** (where the keys sit, QMK's and
VIA's word); see the glossary's Frame section.

```tsx
// A sketch, today's version. The editor machine stays as it is (keys/machine.ts); only its view moves.
// One program, two views of one model: `keys` draws the list, `keys --map` the keyboard map.
type View = {_tag: "list"} | {_tag: "map"; layout: KeyboardLayout; physical: PhysicalLayout};
type KeyboardLayout = "qwerty" | "colemak" | "colemak-dh" | "colemak-dhm" | "dvorak" | "azerty";
type PhysicalLayout = "rows" | "corne"; // row-staggered, or split columns: 3x6 and 3 thumbs a side

function KeysTile({editor, view, send}: Props) {
	return view._tag === "list" ? <List editor={editor} send={send} /> : <KeyboardMap {...view} editor={editor} send={send} />;
}
// The tile owns the edge. The program sits 1px inside it and paints no background.
```

```text
one rebind traced: zoom gets C-b |, which split had
C-b ?        the keys program opens in a tile; focus is in the search
zoom         the list keeps one row: Tile · Zoom · ⌃B Z
Down         focus moves from the search into the list, on Zoom
Enter        the row listens: "⌃B then a key  Esc cancels"
C-b |        the row shows ⌃B | · Takes it from Split · Save · Cancel; focus on Save
Enter        saved; the row says Zoom Changed ⌃B |
             under the list: Saved to keybindings.toml · Split lost ⌃B |  Undo
             the live region says the same in words: "Split lost ctrl+b then |"
```

## Which version

- **Today's version (`apps/fabrika`):** all of it. Today's editor is keys PR 1 (PR 505), a box
  over the tiles. The list is built first, then `keys --map`.
- **`next/`:** the `keys` program of K3 takes these principles as they are, when it arrives in
  Tier 2. Nothing here is built there yet.

## The shape

No new field in the key file for the list. The keyboard map adds the person's two picks, stored
with their keys, so another machine draws the same map:

```toml
# ~/.fabrika/keybindings.toml (a sketch; where it lives is smaller call 2)
[keyboard_map]
layout = "colemak-dhm"   # the keyboard layout: which character each key types
physical = "corne"       # the physical layout: where the keys sit
```

Neither pick changes what a key does. A key still matches by the character it types
([experiment 182](../../experiments/182-keybindings.md)).

## The seven principles

### E1: a tile, not a box over the tiles

**Decided 2026-11-08.** Kind: law.

- **What it means.** `C-b ?` and `keys` both open the editor as a program in a tile. Nothing of it
  covers another tile.
- **Why.** [Layers](./layers.md) L5, decided 2026-11-03: "nothing covers what you are working on".
  Its law, "a layer that leaves the keys below must not cover the focused tile or row", lets
  today's box pass, since the box takes the keys while it is up. This goes one step further: the
  editor is something you work in, so it is a tile and covers nothing at all, the way L5's own
  Linear answer opens a look beside the list. VS Code opens its editor "in a modal overlay on top
  of the editor area" [k1]; we leave that on purpose.
- **Linear row.** Linear's help is a side panel beside the work [k7]. On our pieces, the side panel
  is a tile, and the `keys` program owns it.
- **Elm.** The editor's machine is a tile's child, stepped by the desk like any program.
- **WCAG.** None of its own: a tile covers nothing, so focus is never hidden by it. The rule rests
  on L5, not on a WCAG criterion.
- **What holds it.** A box check in the e2e test: the editor's box sits inside its tile's box.
- **Cost.** Moving the opener from the palette layer to a tile: about 80 lines in `frame.tsx`,
  `desk.tsx` and `words.ts`, in the list's build.
- **Today.** Breaks: a Dialog in the palette's layer (`frame.tsx:1104`), over both tiles of a
  side-by-side layout.

### E2: one list, the name on the left, the keys on the right

**Decided 2026-11-08** (design A). Kind: taste.

- **What it means.** One searchable list of every command, with or without a key, grouped by
  program and then mode. Each row: the command's name in sans, a "Changed" word when it is yours,
  and its keys as keycaps. Nothing else on the row.
- **Why.** VS Code, Zed, JetBrains and macOS all do this [k1-k4]; Linear's help is the same list,
  read only [k7].
- **Linear row.** The list is Linear's help with editing added. The keys line under it comes from
  the program's commands, as every program's does ([program guidelines](./program-guidelines.md) G7).
- **Elm.** The list is a view of the editor's model: `query`, `selected` and the rows. No state of
  its own.
- **WCAG.** 1.3.1 Info and Relationships: a listbox of options, each named by its command and its
  spoken keys; 4.1.2 Name, Role, Value for the selected option.
- **What holds it.** The row's accessible name is the command and its spoken keys, nothing more
  (a test); sans on names, mono only for what a person types (lint on the stylesheet,
  [typography](./typography.md) T6).
- **Cost.** The row view and its styles: about 150 lines, in the list's build.
- **Today.** Breaks: a row reads `split down · tezgah."split --to down" · split --to down · ctrl+b
  then - · default` in mono (`keys/window.tsx:225`), and the details repeat it (`window.tsx:237`).

### E3: record in the row

**Lean, 85%.** Kind: law.

- **What it means.** From the search, Down moves into the list. Enter or a double-click on a row
  makes that row listen. The new key, its clash and Save and Cancel all show in the row. Enter
  saves, Escape cancels, and focus is on Save.
- **Why.** Zed edits "by double-clicking the action row or pressing enter" [k2]; macOS says
  "double-click the current key combination, then press the new key combination" [k4]; Ableton's
  Key Map mode is one click and one press [k5].
- **Linear row.** No Linear answer: Linear lets nobody rebind (a guess, [k8]), so it records no
  key.
- **Elm.** Recording is the editor's own `recording` field (`waiting`, `candidate`, `saving`); the
  row draws it. A key press is a Msg; Save is a Cmd whose answer is `saved` or `failed`.
- **WCAG.** 2.1.1 Keyboard: every step works from the keys; 2.4.3 Focus Order: focus goes to Save,
  then back to the row; 2.1.4 Character Key Shortcuts: the list's single keys (`a`, `r`, `/`) work
  only while the list has focus.
- **What holds it.** Tests: Down from the search moves into the list; Enter on the active row
  records; the listening row is the selected row; Escape leaves it as it was; a press on Save does
  not select the row again.
- **The doubt.** In a quarter tile the row is crowded while it records. Two rounds made it fit at
  1024x700; a narrower tile is not shot. Double-click was never pressed in the shoot.
- **Cost.** The recorder in the row and the search's key handler: about 120 lines, in the list's
  build.
- **Today.** Breaks: recording happens in a details pane below the list, and the search is an Input
  with no key handler (`keys/window.tsx:190-196`) beside the Listbox (`keys/window.tsx:205`), so
  after typing `zoom` Down and Enter do nothing (the shoot pressed both); a row is picked only with
  a click, then Change.

### E4: every change says what it took, in words, with Undo

**Decided 2026-11-01** ([keybindings](./keybindings-are-configurable.md), clashes: the new
binding wins, said in words, with Undo). Kind: law.

- **What it means.** Before Save the row says "Takes it from Split". After it the line under the
  list says "Saved to keybindings.toml · Split lost ⌃B |" with Undo, and one live region says it
  in words. The keycaps are one named image, so a screen reader hears "ctrl+b then |", not the
  glyphs.
- **Why.** JetBrains warns on a clash as you press it [k3]. macOS only marks a clash with a
  warning icon in the list, and the new shortcut does not work [k9]; neither says what the new key
  took. ARIA 1.2 drops `aria-label` on a plain span, so the caps need `role="img"`.
- **Linear row.** No Linear answer: Linear lets nobody rebind (a guess, [k8]), so a key is never
  taken from another command.
- **Elm.** The save's answer is a Msg that carries what was displaced; the view says it. Undo is a
  Msg that sends the change back.
- **WCAG.** 4.1.3 Status Messages: the live region says what was saved and what was lost.
- **What holds it.** Tests: the live region names what was lost, in words; Undo restores it.
- **Cost.** Keycaps in the saved line and the image name: about 20 lines. The rest is built.
- **Today.** Passes: "close lost ctrl+b then x." and Undo.

### E5: one model, every size

**Decided 2026-11-08** (D as a second view, zoom and fold as the fallback). Kind: law and taste.

- **What it means.** The same list draws in a full window and a quarter tile. `keys --map` is the
  same program's model drawn as a keyboard map, never a second program. In a narrow tile the map
  drops the command names from the caps and marks a bound key by its fill and bold letter; the
  picked key's command is named under it. Zoom (`C-b z`) shows the names on the caps again.
- **Which it ends up using.** At a quarter of a 1024x700 window, the whole Corne and the whole
  row-staggered layout now fit in width; the record row and "Not on this map" are a scroll below.
  So the fix holds, and zoom is for the names on the caps. Fold is not needed.
- **Why.** [Program guidelines](./program-guidelines.md) G1: one job, one model every size draws.
- **Linear row.** Linear draws no keyboard. On our pieces, a second view of one program is a flag on
  its tsh word, as `tracker --all` is.
- **Elm.** One model, two view functions. The flag picks the view; the update is the same.
- **WCAG.** 1.4.10 Reflow: the content works at a quarter tile without scrolling sideways;
  1.4.1 Use of Color: a bound key is marked by its bold letter as well as its fill.
- **What holds it.** Shots at five layouts (taste); a test that both views read one editor model.
- **Cost.** The narrow keyboard map's styles: about 40 lines, in the keyboard map's build.

### E6: a keyboard map is drawn on the person's own layouts, never on QWERTY

**Lean, 80%.** The picks are decided (above); the rest is a lean. Kind: law.

- **What it means.** A keyboard map has a keyboard layout (which character each key types) and a
  physical layout (where the keys sit). The system's read, `navigator.keyboard.getLayoutMap()`, is
  a first guess. The person picks both. A binding sits on the cap that types its character; one
  with no cap on these layouts goes under "Not on this map", in words ("types |, on another
  layer"). When the pick and the system differ, the map says so, and says the commands still run.
- **Why.** The layout map gives "mappings from code values to key values" [l1]. Karabiner and QMK
  change what the system hears but not what it reports, so it says QWERTY. Monkeytype and the
  Colemak Mod-DH authors keep DH and DHm apart [l7, l8]. Raycast separates a physical key from a
  character [l5].
- **Linear row.** No Linear answer: Linear draws no keyboard. Its one move here was moving some
  keys "for non-US keyboard layouts" [l4], which is matching, not drawing.
- **Elm.** Both layouts are model fields; the system's read is a Cmd whose answer is a Msg, never a
  truth.
- **WCAG.** 1.3.1 Info and Relationships: the map is a listbox of bound keys, each named; a binding
  with no cap is listed in words, not left out.
- **What holds it.** A test per keyboard layout: each bound character lands on the cap that types
  it, or in the list below; never on a cap that types something else.
- **The doubt.** Only the owner's layouts were drawn. ISO keyboards, non-Latin layouts and layer keys
  are not shot.
- **Cost.** The layouts, the two physical layouts and the picks: about 400 lines, the doubt being
  the layouts' tables.
- **Today.** Not there: today draws no keyboard.

### E7: quiet, inside the tile's own edge

**Decided in part, the rest a lean, 85%.** Kind: law (the edge), lint (fonts and colors), taste
(the rest). The fonts, the grays and the colors are already decided: sans for names and mono only
for typed words ([typography](./typography.md) T6, decided 2026-11-02), two grays
([typography](./typography.md) T3), the accent says your turn and nothing else
([color principles](./color-principles.md) 2, decided 2026-11-01), and one slate focus token (the
same note, changed 2026-11-08). "No second line" is decided too: if something already draws an
edge, a second line beside it goes ([color principles](./color-principles.md) 6). This note adds
no font, color or line rule. The lean is the edge law: its pixel numbers and that the program, not
the tile, gives way.

- **What it means.** The program paints no background over the tile's edge, so the focus edge
  lights all the way round. No second line under a line: the search is a field with a rule under
  it, the scroll bar has no track, the keys line is the only divider. A picked row is a full-row
  fill and stronger text, never a colored bar. Two text steps, sans names, keycaps for keys.
- **Why.** [Color principles](./color-principles.md), [themes](./themes.md), the skill's "fewer
  boxes".
- **Linear row.** Linear's settings are grouped rows with the control on the right and no box
  around each row [k8]. On our pieces, the tile draws the one edge, and every program gets that
  for free.
- **Elm.** None: this is the view's styles, not state.
- **WCAG.** 2.4.7 Focus Visible: the focus edge must light all the way round; 1.4.11 Non-text
  Contrast for that edge.
- **What holds it.** The edge law, measured in pixels in the real app: on the left, right and
  bottom of a tile, the edge pixel differs from the pixel 3px inside it by at least 6 on some
  channel. Every tile design passed it; the box over the tiles failed it.
- **The doubt.** The 3px and the 6 come from the shots of this study only, at dark and one scale.
  A light theme, a high-contrast theme or a 1x screen may need other numbers. Running the check on
  every tile program in both looks, at 1x and 2x, settles it: it must pass on main's own tiles and
  fail on the box over the tiles.
- **Cost.** The program's root inset and the edge check in e2e: about 70 lines.
- **Today.** Breaks: mono names, Manti's orange row and focus ring, a full-width Close
  (`keys/window.tsx:363`).

## The smaller calls

**1. Where `C-b ?` opens the tile.** Lean, 60%: beside the focused tile, as a split, so nothing is
hidden. The other way, tmux's `C-b ?`, takes over the pane until `q`.

```text
a  split beside the focused tile; C-b x asks y or n, y closes it   (lean)
b  in place of the focused tile, Esc gives it back                (tmux)
```

**2. Where the picks live.** Lean, 60%: a `[keyboard_map]` table in `keybindings.toml`, since the
map is about keys and moves with them. The other way is the app's own settings.

**3. The words.** Lean, 75%: "Takes it from Split" before Save, "Split lost ⌃B |" after, "Not on
this map" for a binding with no cap. The study's builds say "Not on this drawing"; the build
changes it.

## What the ledger records

Nothing new. The picks live in the person's file. No fact is lost by waiting: what the system
reported is read again on every start.

## Where this differs from settled notes

- [The frame](./the-frame.md): the shortcuts list was "in the palette's box". It is now a program
  in a tile. That row changes in this pull request, and so do the glossary's shortcuts list and
  palette rows.
- [Popovers](./popovers.md) drew the keys panel as a popover over the desk; this moves it into a
  tile. Its other rules (sans, keycaps, Escape closes what it opened) still hold.

## What it costs

The list: about 400 lines in `apps/fabrika` (the view, its styles, moving the opener from the
palette layer to a tile, the search's keys, the tests), about 3 agent hours, 75% sure. `keys --map`:
about 600 lines more (the keyboard layouts, two physical layouts, the picks, the tests), about 4
agent hours, 65% sure; the layouts' tables are the doubt.

## What it cannot tell us

- No screen reader ran. Recording and the caps' names need a VoiceOver run.
- The designs were shot as a stand-in mounted over a tsh tile, not as a real program.
- Only the owner's layouts were drawn for D.
- Smaller call 1 was not shot both ways.
