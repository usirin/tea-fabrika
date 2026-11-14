---
date: "2026-11-08"
scripts: "none"
summary: "Today's version; reading about fifteen makers (VS Code, Zed, JetBrains, macOS, Ableton, Linear, Raycast, the keyboard map spec, Colemak Mod-DH, WCAG) and a look step: four designs built in the app on a local branch and shot at five layouts, 150 states with a real shot each. The makers agree on one searchable list with recording in the row; ours sits in a tile, not over the tiles. The owner picked the list and a keyboard map as a second view, on the person's own keyboard layout and physical layout, since Karabiner and QMK leave the system saying QWERTY. Today's editor has the right jobs and the wrong look: a box over the tiles, mono, rows of internals. Feeds the proposed keys editor note. $0."
---

# How should the keys editor look and sit, and what does today's editor teach?

Read 2026-11-08. **This is reading, not a measurement,** with one look step that ran. It feeds
[keys editor](../docs/direction/keys-editor.md), a proposed note, and a private Design canvas,
"Keys editor guidelines": 31 slides, then pressable prototypes of today, A (both rounds), D (the system's guess and the Corne) and Linear's screens, each beside its real shots.

The look step ran in today's version (`apps/fabrika`) on a local branch, not pushed, off main
at `6041f99e`, on Electron 45.2.1 and Manti 0.13.0. Four designs were built for real in the app,
around the real tile, and shot with Playwright on Electron at five layouts, dark: one tile, two side
by side, two stacked, a 2x2 grid and a 1024x700 window. Each design was pressed through five states
(open, a row picked, listening, a clash, saved), and design D on three keyboards (the system's guess,
Colemak-DHm on a laptop's row-staggered physical layout, Colemak-DHm on a Corne). Two refine rounds followed the owner's pick.
That is 6 design runs x 5 layouts x 5 states = 150 states, each with a real shot, its words and its
DOM. A later pass pressed every key and click the editor takes, from each state on the walk's path and one press off it: today 56 states, A 63 and D on the Corne 61, each with a saved page and a shot at one tile, and the path's states at all five layouts. The canvas's prototypes take their presses from those graphs.

**The answer.** The makers agree on one shape: one searchable list of every command, the name on
the left and its keys on the right, grouped; press Enter or double-click a row, then press the new
key; say a clash where you record; reset one row or all. VS Code, Zed, JetBrains and macOS all do it,
and Linear's shortcuts help is that list without the editing. Only the place differs: VS Code opens
it over the editor, and our settled notes say nothing covers what you work on, so ours sits in a
tile. The owner picked that list in a tile (design A) on 2026-11-08, and a keyboard map (design
D) as a second view of the same program.

Today's editor (keys PR 1) has the right jobs and the wrong look:

- **It follows:** one list with a search, record by pressing, the clash in words, Undo, one live
  region, focus that comes back where it was.
- **It breaks:** it sits over the tiles in the palette's box; everything is mono; Manti's orange
  marks the picked row; each row reads out internals (`split down · tezgah."split --to down" ·
  split --to down · ctrl+b then - · default`); the details repeat the row; Close is a wide button.

```text
how each tool read does a keys editor, one line each
VS Code     one list, with and without keys; a box that listens; Show Same Keybindings; a modal over the editor
Zed         the same list; Enter or a double-click edits; writes the keymap.json a person edits by hand
JetBrains   right-click, Add Keyboard Shortcut, press it; warns on a clash; Reset Shortcuts
macOS       a sidebar of groups; double-click the shortcut, press the new one; a warning icon on a clash, no words
Ableton     Key Map mode marks every part that takes a key; click one, press a key
Linear      a side panel of every shortcut, search on top, groups, keycaps on the right; read only
Raycast     records a physical key or a character; built-ins use the character
Premiere    a drawn keyboard with each key's command (a guess: Adobe's page refused the fetch)
```

## What was read

### The editors

| Tag | Source | What it says |
|---|---|---|
| [k1] | VS Code, Keybindings | The editor "opens by default in a modal overlay on top of the editor area"; the list has commands "with and without keyboard shortcuts"; "Show Same Keybindings"; a Source column says 'User'. |
| [k2] | Zed, Key bindings | Every action with its bindings; edit by "double-clicking the action row or pressing enter"; changes are "reflected on the keymap.json file". |
| [k3] | JetBrains, Keymap | Right-click, "Add Keyboard Shortcut", "press the necessary key combination"; warns on a conflict; Enter and Escape need a button of their own; "Reset Shortcuts". |
| [k4] | Apple, Keyboard Shortcuts settings | A sidebar of groups; "Double-click the current key combination, then press the new key combination"; "Restore Defaults". |
| [k9] | Apple, Change a conflicting keyboard shortcut | "A warning icon is shown next to conflicting keyboard shortcuts." |
| [k5] | Ableton Live manual, Key Map Mode | Parts that take a key "become highlighted in red"; click, then press a key; a Mapping Browser lists them. |
| [k6] | WCAG 2.1.4 Character Key Shortcuts | A single-character shortcut can be turned off, remapped, or works only while its part has focus. |
| [k7] | Linear changelog, 2021-03-25 | The keyboard shortcuts help: a side panel, search on top, groups, the name on the left in sans, keycaps on the right. Read only. |
| [k8] | Linear changelog, 2024-12-18, personalized sidebar | Its image of settings: grouped rows, the control on the right. Linear lets nobody rebind (guess: no Linear page says otherwise). |

### A keyboard map on someone else's keyboard layout

The owner types Colemak-DHm, through Karabiner on a Mac and through QMK on a Corne, so the system
always reports US QWERTY. These sources set how a keyboard map learns the keyboard layout.

| Tag | Source | What it says |
|---|---|---|
| [l1] | WICG Keyboard Map | `getLayoutMap()` gives "mappings from code values to key values", unshifted only; it may report a top ASCII layout to limit fingerprinting. |
| [l2] | MDN, Keyboard.getLayoutMap | Secure context only, not Baseline. |
| [l3] | VS Code, keyboard layouts | Shortcuts are "rendered in the UI using the current system's keyboard layout"; scan codes "do not change with the change of the keyboard layout". |
| [l4] | Linear changelog, 2019-06-20 | "Keyboard shortcuts have been improved for non-US keyboard layouts." |
| [l5] | Raycast manual | Physical Key "stays on the same key position across different layouts"; Key Equivalent "maps to the same character regardless of layout". |
| [l7] | colemakmods, mod-dh | Separate ISO, ANSI and matrix versions; ANSI moves Z (the angle mod); the matrix one is DHm. |
| [l8] | Monkeytype layouts | Keeps `colemak_dh` and `colemak_dh_matrix` apart. |

A probe on the branch: `navigator.keyboard.getLayoutMap()` works in the app's window on Electron
45.2.1 and read 50 keys, `KeyQ` = `q`. On the owner's machines it would say QWERTY on both physical layouts:
right for matching, wrong for the keyboard map.

### Outside software

- **Ableton Live (music):** mark every part that takes a key, then one click and one press. It
  carries over as "record in place". Its red-only mark does not: color is never the only cue.
- **Premiere Pro and DaVinci Resolve (video), a guess, not read:** Adobe's page refused the
  fetch and Blackmagic's keyboard page shows no key map, so this is from memory. A drawn keyboard with each key's command. It shows
  free keys at a glance. It carries over poorly to a prefix key: everything sits under `C-b`, so the
  map shows the keys after the prefix, not the keyboard itself.
- **A cockpit checklist, a guess with no source:** one item per line, read top to bottom, the state in words. It is the list.

## Today's editor

Read on main at `6041f99e`. Today's version.

| What | Today | Where |
|---|---|---|
| Place | A Dialog in the palette's layer, size `lg`, over every tile | `apps/fabrika/src/window/frame.tsx:1104` |
| Width | 900px | `apps/fabrika/src/window/window.css:1346` |
| Font | Mono, from the root; the editor never sets `--font` | `apps/fabrika/src/window/window.css:58` |
| Row | name · command · tsh word · spoken keys · source · moved | `apps/fabrika/src/keys/window.tsx:225` |
| Search | An Input with no key handler, beside the Listbox: after typing, Down and Enter do nothing, so a row is picked only by a click (the shoot pressed both; the screen did not change) | `apps/fabrika/src/keys/window.tsx:190-196`, Listbox at `:205` |
| Details | The row again: name, command, tsh word, source | `apps/fabrika/src/keys/window.tsx:237` |
| Not ours | A `details` at the bottom | `apps/fabrika/src/keys/window.tsx:341` |
| Close | A full-width button | `apps/fabrika/src/keys/window.tsx:363` |

The running example: rebind zoom. `C-b ?`, type `zoom`, pick the row, press Change, press `C-b |`,
Save. `|` belongs to split, so split loses it.

| Principle in the note | Today |
|---|---|
| E1 a tile, not a box | Breaks: two tiles side by side are both covered |
| E2 one list, name left, keys right | Half: one list, but each row reads out six facts in mono |
| E3 record in the row | Half: recording happens in a details pane below the list. Breaks: Down and Enter from the search do nothing |
| E4 every change says what it took | Passes: "close lost ctrl+b then x." and Undo |
| E5 one model, every size | Breaks: the box has one size; a narrow window squeezes it |
| E6 a keyboard map is on the person's own layouts | Not there: today draws no keyboard |
| E7 quiet, with the tile's own edge | Breaks: mono names, Manti's orange row and ring, a wide Close |

## The four designs

Each had its tsh line first. A and B are one program; D is the same program's second view.

| Design | tsh line | What the shots showed |
|---|---|---|
| A. One list in a tile | `keys` | Reads well at every size; recording fits in the row; crowded Save and Cancel in a quarter tile until round 2. **Picked.** |
| B. List and details | `keys` | Best in a big tile; in a narrow one the details drop under the list and repeat the row. |
| C. The palette's box, cleaned up | `C-b ?` | Same list as A, but still over the tiles and over a tile's edge (the edge check fails on t1's right side). |
| D. A keyboard map | `keys --map` | Shows free keys at a glance. On a Corne, digits and `|` sit on another layer, so they go to a list under it. Too wide for a quarter tile until round 2. **Picked as a second view.** |

## The refine rounds

- **Round 1 (borders):** the program's root sat over the tile's edge, so the focus edge lit only
  around the title bar. The root now sits 1px inside the tile and paints no background. Fixed with
  it: the footer line, the scroll bar's track and the search field's filled box. An edge check now
  runs in the shoot: on the left, right and bottom of the tile, the edge pixel differs from the
  pixel 3px inside by at least 6 on some channel. Every tile design passes; C fails by design.
  Main's own tiles pass, so no frame bug.
- **Round 2 (would Linear ship it?):** Cancel and Undo became quiet buttons; the saved line shows
  the lost key as keycaps, not spoken words; F-keys print as `F6`, not `f6`; the search line no
  longer runs past the list on the right; a key's caps are one named image for a screen reader
  (ARIA 1.2 drops `aria-label` on a plain span). D in a narrow tile drops the command names from
  the caps, marks bound keys by fill and bold, and wraps its pickers: the whole Corne now fits a
  quarter of a 1024x700 window, with the record row and the "Not on this map" list (the builds say "Not on this drawing"; the build changes it) a scroll
  below. Zoom (`C-b z`) shows the names on the caps.

What still looks off: in a quarter tile the keys line under the list wraps to two lines; Save and
Undo keep Manti's soft fill.

## What this tells us for fabrika

- The list is the known way and the owner's pick. A tile, not a box, is ours (L5).
- A keyboard map is a view, not the editor: it needs a keyboard layout and a physical layout the
  system cannot tell, so it cannot be the only way in.
- Matching by the character typed (experiment 182) holds for Karabiner and QMK alike, since both
  change what the system hears. Only the keyboard map needs the person's picks.
- The edge check is a law the test writer can hold for every program in a tile, not only keys.

## What it cannot tell us

- No screen reader ran. The recording announcements and the image name on the caps need VoiceOver.
- Only the owner's keyboard layout and physical layouts were drawn. A non-Latin layout, ISO keyboards and thumb-key or
  layer bindings were not shot.
- The shots are of a stand-in: the design is mounted over a tsh tile, not opened as a real program.
- Where `C-b ?` opens the tile (split beside, or in place) was not shot both ways.
- The press graphs stop two presses off the walk's path: any key can be recorded as a new key, so the space has no end. Double-click to record was never pressed.

Dollars: $0. No model ran. The probe and the designs stay on the local branch, not pushed.

## Links

- [k1] https://code.visualstudio.com/docs/editing/keybindings
- [k2] https://zed.dev/docs/key-bindings
- [k3] https://www.jetbrains.com/help/idea/configuring-keyboard-and-mouse-shortcuts.html
- [k4] https://support.apple.com/guide/mac-help/keyboard-shortcuts-mchlp2262/mac
- [k9] https://support.apple.com/en-gb/guide/mac-help/mchlp2864/mac
- [k5] https://www.ableton.com/en/manual/midi-and-key-remote-control/
- [k6] https://www.w3.org/WAI/WCAG21/Understanding/character-key-shortcuts.html
- [k7] https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help
- [k8] https://linear.app/changelog/2024-12-18-personalized-sidebar
- [l1] https://wicg.github.io/keyboard-map/
- [l2] https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/getLayoutMap
- [l3] https://github.com/microsoft/vscode/wiki/Keybinding-Issues
- [l4] https://linear.app/changelog/2019-06-20-international-keyboard-shortcut-improvements
- [l5] https://manual.raycast.com/command-aliases-and-hotkeys.md
- [l7] https://colemakmods.github.io/mod-dh/
- [l8] https://github.com/monkeytypegame/monkeytype/tree/master/frontend/static/layouts
