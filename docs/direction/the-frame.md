---
state: "decided 2026-11-03, undecided parts proposed; today's version; walked if a tryout is picked"
summary: "Both versions, today's app read on main. One place that names the 50 parts of fabrika's window (the top bar, the tiles, the status bar, what opens over the tiles), each with a plain meaning, the industry's word with a source, the note that decides it, and where it is built. Fourteen clashes, each decided with the owner: \"chassis\" becomes frame; \"popup\" goes for popover and menu; the bottom line becomes the status bar; the action bar and the keys line become one toolbar, with key hints for words that press nothing; the ask desk becomes the inbox program; the desk becomes tezgah; the 4px between tiles is the divider, with an i3-style resize mode; \"window\", \"panel\", \"zoom\" and \"ask\" each keep one meaning. The words are in `.glossary/TERMS.md`. The parts nobody decides yet stay proposed. The Design canvas comes next."
---

# The frame: every part of the window, named once

**Decided 2026-11-03.** Today's version; walked if a tryout is picked (owner, 2026-11-08). The words below were picked by the owner one by one and are in the
glossary, [`.glossary/TERMS.md`](../../.glossary/TERMS.md), under Frame. The parts listed under
"Nobody decides these yet" stay **proposed**. Reading only: no code, no tests, nothing ran. This
note names each part of fabrika's window in one place, so the owner and every agent use the same
word for the same part. It decides no look and no behavior. Those stay in the notes it links. The
renames are decided as words; none is in code yet.

Its decided rules are in: [0490](../../.decisions/0490-the-frames-parts-take-one-word.md),
[0491](../../.decisions/0491-window-view-tile-and-tezgah.md),
[0492](../../.decisions/0492-the-divider-and-resize-mode.md),
[0493](../../.decisions/0493-zoom-question-line-words.md).

Gathered from the notes in `docs/direction/` (the desktop layer, tile guidelines, the top bar's
name, popovers, modes, keybindings, the ask desk, fold not tabs, tracker views), from
[experiment 196](../../experiments/196-ask-desk.md), from
program guidelines (pull request 332, proposed, `docs/direction/program-guidelines.md` on its own
branch), from the naming sweep's app rows (proposed), from
[the glossary](../../.glossary/TERMS.md), and from today's
app on main (`apps/fabrika/src/window/frame.tsx`, `frame.ts`, `desk.tsx`, `pop.tsx`,
`apps/fabrika/src/desk/`, `apps/fabrika/README.md`).

The whole frame, as labeled parts. A sketch in the decided words; today's code word is in
brackets where it differs.

```text
window                              the app's one OS window
  top bar                           across the top; on macOS it is also the window's title bar
    window buttons room             84px for macOS's close, minimize and zoom buttons
    workspace list                  1 #7   2 tsh
    the line                        tracker | ticket | trace: the shown tsh line, one item per program
    icon and name                   Tile F and "fabrika", in the middle; gives way first
    items                           2 ask you •  ·  1 agent  ·  syncing  ·  ✓ (host)
  tezgah                            every workspace, its layout and its focus  [desk]
    workspace                       the one shown now
      container                     a row or a column
        tile                        shows one process
          title bar                 slot, program name, state word, tile id
          body                      a terminal, or a program's view
        divider                     4px between two open tiles  [.border]
        strip                       a folded tile, in its place
  status bar                        one line under the tiles  [bottom line]
    left                            here word · job item, or PREFIX keys, or the close question, or INFO
    right                           a note, or the info and keys items
  status region                     unseen; tells a screen reader a mode came on or went off
  over the tiles                    one thing at a time  [over the desk]
    popover                         a raised box of rows
      menu                          the inbox list, the jobs list; in next/ the inbox list is a glance
      item lines                    a few lines under agents, sync or host: a popover too
      toolbar                       buttons built from a program's commands, keys printed on them
      key hints                     words that name keys and press nothing
    palette                         Cmd-K: every command
    shortcuts list                  C-b ?: every key
    tooltip                         a name and its keys
```

## Which version

- **Today's version (`apps/fabrika`):** most parts are built. Each row below gives the file and
  line on main at this commit.
- **`next/`:** nothing is on main yet. `next/` keeps today's frame rules (bars mono, words joined by
  ` · `, no item backgrounds), as [Tier 1's detail](../plan/tier-1-detail.md) says, and adds parts
  of its own: tezgah as a program in Tier 2, the inbox program's glance in Tier 5, the menu bar
  extra's icon in Tier 1. A row says `next/` when only `next/` has decided it.
- **Proposed only:** a row says so when its only source is a proposed note or an experiment.

## The parts

Each table: our word, what it is in one line, the industry's word with a source, the note that
decides it, and where it is built today. "Nobody" means no note decides it yet: today's code and
README have it, and no direction note owns the word.

### The window and the top bar

| Our word | What it is | Industry's word | Decided by | Built today |
|---|---|---|---|---|
| window | The app's one OS window. In `next/`, also the client that draws it and sends a person's keys. A program draws a view; a line's windows are tiles. | window ([macOS HIG, windows][hig-win]) | [GUI is Electron first](./the-gui-is-electron-first.md); `next/`: [brain, hands, window, agent](./brain-hands-window-agent.md) | `apps/fabrika/src/main.ts:189` |
| top bar | The bar across the top: the workspaces, the line, then what needs you. | top app bar ([Material][m3-top]); title bar ([VS Code][vsc-ux]); tmux's status line can sit on top ([tmux][tmux]) | [popovers](./popovers.md) (stays mono), [top bar's name](./top-bar-name.md) | `frame.tsx:182-351` |
| window buttons room | The 84px at the left kept for macOS's three window buttons. | window controls: close, minimize, zoom ([macOS HIG, windows][hig-win]) | Nobody | `frame.tsx:204`, `frame.ts:51` (`LIGHTS`) |
| workspace list | One item per workspace, numbered and named by what it holds. | workspace buttons ([i3bar][i3]); window list in the status line ([tmux][tmux]) | Nobody | `frame.tsx:206-221` |
| the line | The shown workspace's tsh line, one item per program, with a pipe between. | none found | Nobody (pipe colors and tile guidelines note its gaps) | `frame.tsx:223-246`, `frame.ts:214` |
| icon and name | Tile F and the word "fabrika", centered; it does nothing and goes first. | none needed | [Top bar's name](./top-bar-name.md) | `frame.tsx:345-348` |
| item | One word on a bar that says how a part is and opens its lines on a click or a key. | status bar item ([VS Code][vsc-status]) | Nobody | `frame.tsx:118` (`Item`) |
| asks count | The asks item: `2 ask you`, with a dot for one not seen. The Dock badge says the same number. | badge ([Material][m3-badge]) | [Ask desk](./ask-desk.md) (the count stays in the top bar) | `frame.tsx:255-272`, `frame.ts:232`, `main.ts:347` |
| agents, sync, host | Three items: agents attached, the ledger's sync, the host's link. Only the host's icon shows at rest. | status bar items ([VS Code][vsc-status]) | Nobody | `frame.tsx:273-343` |
| drag area, band | The bar's empty stretch that moves the window, and the thin band left when the bars are hidden. | draggable region ([Electron, frameless windows][el-drag]) | Nobody | `frame.tsx:247`, `frame.tsx:416-418` |
| bars hidden | `C-b B` hides both bars; the status bar comes back while you are mid-key or in a mode. In code, `barsHidden`. | status off ([tmux][tmux]); Zen Mode ([VS Code][vsc-ui]) | [Modes](./modes.md), M3 (a mode shows with the bars hidden) | `frame.ts:704` (`bare`, to become `barsHidden`), `keys.ts:107` (`bars`) |
| menu bar extra | `next/`: the app's icon in macOS's menu bar, with its popover of rows (approve a tab, quit). Not "menu bar": on macOS that is the system's bar. | menu bar extra ([macOS HIG, the menu bar][hig-menubar]) | [The desktop layer](./the-desktop-layer.md#the-app-and-its-menu-bar), `next/` | Not built |

### The desk and its tiles

| Our word | What it is | Industry's word | Decided by | Built today |
|---|---|---|---|---|
| tezgah | Tuval's window manager: every workspace, its layout, its focus, the prefix and the close question, as one machine. Codename, as Mutter is GNOME's and KWin is KDE's. In `next/`, the program `fabrika/tezgah`. Today's code and notes say desk. | window manager ([i3][i3]); session ([tmux][tmux]) | [Glossary](../../.glossary/TERMS.md), [the desktop layer](./the-desktop-layer.md) | `apps/fabrika/src/desk/desk.ts:134` (`Open`), still named desk |
| desktop | `next/`: only layer 5, Tuval, the desktop environment. Its window manager, tezgah, places tiles, owns focus and routes keys. | the part KDE or GNOME plays (the note's own words) | [The desktop layer](./the-desktop-layer.md), `next/` | Not built |
| workspace | One numbered layout inside the desk, with one focused tile. | workspace ([i3][i3]); window ([tmux][tmux]) | [The desktop layer](./the-desktop-layer.md), W4 | `desk.ts:122` |
| container | A row or a column of tiles; nested ones alternate. | container ([i3][i3], AeroSpace) | [Fold, not tabs](./fold-not-tabs.md) | `desk/layout/node.ts:96`, `desk.tsx:626-693` |
| tile | One rectangle of a workspace. It shows one process. | pane ([tmux][tmux]); window ([i3][i3]) | [Tile guidelines](./tile-guidelines.md), [the desktop layer](./the-desktop-layer.md) W3 | `desk.tsx:553-604` |
| title bar | The tile's own bar: slot, program name, state word, tile id. Never the app's icon. | pane border status ([tmux][tmux]); title bar ([i3][i3]) | [Tile guidelines](./tile-guidelines.md#title-bar) | `desk.tsx:578-594` (a `button` today; the guidelines say `header`) |
| slot | The title bar's first mark: a pipe's letter, or a dot for a plain tile. | none found | [Tile guidelines](./tile-guidelines.md#pipe-marker), [pipe colors](./pipe-colors.md) | Not built: only the tint, `desk.tsx:570` |
| program name | What runs here, in the same words as the status bar: `ticket #7`. The title bar's word. | none needed | [Tile guidelines](./tile-guidelines.md#program-name) | `desk.tsx:589` (`nameOf`; should be `tileWord`, `frame.ts:182`) |
| tile id | `t2`, at the far right; the handle other text uses. | pane id `%n` ([tmux][tmux]) | [Tile guidelines](./tile-guidelines.md#tile-id) | `desk.tsx:593` |
| edge | The tile's 1px outline, apart from the divider. | pane border ([tmux][tmux]) | [Tile guidelines](./tile-guidelines.md#edge) | `window.css:279` (box-shadow today) |
| tile states | Focused, asking the close question, closing, zoomed, and the dimmed tiles when the link is lost. | active pane ([tmux][tmux]); focused ([i3][i3]) | [Tile guidelines](./tile-guidelines.md) | `desk.tsx:568,592,597-601,854,867` |
| accessible name | What a screen reader hears entering a tile: `tracker, t2, pipe A, 1 of 2, sends to ticket`. The older notes say "the region's name". | accessible name ([APG, names][apg-name]); region landmark ([APG][apg-land]) | [Tile guidelines](./tile-guidelines.md#a-tile-is-a-region) (`tileName`) | Old words only, `desk.tsx:571` |
| divider | The 4px between two open tiles; drag it to resize. At rest it is not a Tab stop. In resize mode (decided, not built) it is a focused `role="separator"` that `h j k l` move. Code calls it `.border`. | divider ([macOS HIG][hig-split], `NSSplitView`); window splitter ([APG][apg-split]) | [Glossary](../../.glossary/TERMS.md), [tile guidelines](./tile-guidelines.md#resize-gap) (its gap section changes: focusable only in resize mode) | `desk.tsx:674-679`, `window.css:258` (`.border`) |
| resize mode | i3's resize mode. A prefix key enters it; the status bar shows RESIZE and a screen reader hears "Resize mode on". `h j k l` move the focused tile's divider; Escape or Enter leave. Needs a Manti `Splitter` option so the trigger is not a Tab stop at rest: a `pnpm patch` first, then a Manti pull request with the owner's yes. | resize mode ([i3][i3]); `resize-pane` ([tmux][tmux]) | [Glossary](../../.glossary/TERMS.md) | Not built |
| split | Make a new tile beside (`C-b \|`) or under (`C-b -`) the focused one. | split-window ([tmux][tmux]); split ([i3][i3]) | [Fold, not tabs](./fold-not-tabs.md) | `desk/keys.ts:82-83` |
| turn | `C-b Space` swaps a container between row and column. | layout toggle split ([i3][i3]) | [Fold, not tabs](./fold-not-tabs.md); the sweep leans `toggle`, 60% | `keys.ts:93` |
| fold, strip | `C-b f` folds a tile into a thin strip that keeps its place; a click opens it. | none in the list; window shading (EWMH), Ableton Live's fold ([fold note](./fold-not-tabs.md#why)) | [Fold, not tabs](./fold-not-tabs.md) | `keys.ts:94`, `desk.tsx:699-715` |
| zoom | Alone, always tile zoom: `C-b z` draws one tile alone; again to undo. Page zoom and window zoom are always written in full. | zoom, `resize-pane -Z` ([tmux][tmux]); fullscreen ([i3][i3]) | [Tile guidelines](./tile-guidelines.md#zoomed-and-lost-link) | `keys.ts:95`, `desk.tsx:882-891`, `node.ts:106-109` |

### The status bar

| Our word | What it is | Industry's word | Decided by | Built today |
|---|---|---|---|---|
| status bar | The one line under the tiles: where you are, and the key you just pressed. Stays monospace. Today's code and the older notes say bottom line. | status bar ([VS Code][vsc-status]); status line ([tmux][tmux]) | [Glossary](../../.glossary/TERMS.md), [popovers](./popovers.md) (stays mono), [tile guidelines](./tile-guidelines.md#bottom-status-line) | `frame.tsx:787-893` (`BottomLine`) |
| here word | The focused tile, what it takes and sends, its neighbors in its line. | none found | Nobody | `frame.tsx:824-826`, `frame.ts:426` |
| job item | The job the tile runs: `%3 seq --to 9 \| tally 2m +1`. | the pane's current command in the status line ([tmux][tmux]) | Nobody | `frame.tsx:947-965` |
| prefix line | After `C-b`: `PREFIX · N new · x close · ...`, from the key table. A key hint. | none in the list; which-key in Emacs and Neovim | [Keybindings](./keybindings-are-configurable.md) (one table, shown everywhere) | `frame.tsx:801-812`, `frame.ts:112` |
| close question | `close t2? (y/n)`, asked here and in the tile's title bar. In code, `question`. | confirm-before ([tmux][tmux]) | [Popovers](./popovers.md#9-what-the-build-decided), [tile guidelines](./tile-guidelines.md#asking-marker) | `frame.tsx:795-800` |
| mode word | `INFO ·`, the mode's name first, its keys, the way out at the right. | mode indicator (i3bar's binding mode, [i3][i3]) | [Modes](./modes.md), M3 | `frame.tsx:813-820` (info mode only) |
| note | A short word at the right after the palette ran a command: `next time: C-b z`. | status bar message ([VS Code API][vsc-msg]) | Nobody | `frame.tsx:839`, `frame.ts:705` |
| status region | An unseen polite region: "Info mode on. Escape leaves." | live region, `role="status"` ([MDN][mdn-live]) | [Modes](./modes.md) M3, [tile guidelines](./tile-guidelines.md#what-a-screen-reader-is-told) | `frame.tsx:903-909` |

### What opens over the tiles

| Our word | What it is | Industry's word | Decided by | Built today |
|---|---|---|---|---|
| over the tiles | Whatever lies over the tiles now. One at a time. Code says `Over`. | overlay (the sweep's lean for `over`, 70%) | [Popovers](./popovers.md) | `frame.ts:660` (`Over`), `frame.tsx:399-413` |
| popover | A raised box of rows, in the windows' font. Focus moves in; Escape puts it back. | popover ([macOS HIG][hig-pop], HTML `popover`) | [Popovers](./popovers.md) | `pop.tsx` |
| menu | A popover whose rows each do something: the inbox list, the jobs list. | menu button ([APG][apg-menu]) | [Popovers](./popovers.md#3-the-rule) | `pop.tsx:208`, `frame.tsx:433-479`, `frame.tsx:510` |
| item lines | A few lines and maybe a button, under the agents, sync or host item. A popover. Code calls it `Panel`, a word no frame part keeps. | non-modal dialog ([APG][apg-dialog]) | [Popovers](./popovers.md#5-the-parts-as-a-type) (`dialog`) | `pop.tsx:619`, `frame.tsx:550` |
| palette | Cmd-K: every command by name, grouped, with its tsh word and keys. | Command Palette ([VS Code][vsc-palette]); command menu (Linear, [popovers](./popovers.md#2-what-linear-and-the-standards-do)) | [Popovers](./popovers.md#7-keys-in-the-palette-and-the-keys-panel) | `frame.tsx:984-1025`, `pop.tsx:514` |
| shortcuts list | `C-b ?`: every key, in the palette's box, titled "Keyboard shortcuts". The older notes say "keys panel"; `next/` makes it the `keys` program. **Changed 2026-11-08** ([keys editor](./keys-editor.md) E1): it opens as the `keys` program in a tile, not in the palette's box; today's app moves when that build lands. | keyboard shortcuts help ([Linear][lin-keys]); `list-keys` ([tmux][tmux]) | [Popovers](./popovers.md), `next/`: [keybindings](./keybindings-are-configurable.md#k3-a-program-for-keys) K3 | `frame.tsx:1005` |
| tooltip | A name and its keys, after 700ms, on hover or focus. | tooltip ([APG][apg-tip]) | [Popovers](./popovers.md#7-keys-in-the-palette-and-the-keys-panel) | `pop.tsx:675` (`useTip`) |
| keycap | One key drawn as a cap, with the Mac's glyphs: `⌃B` `A`. The bars write `C-b a`. | `kbd` (HTML); keycaps (Linear's stylesheet, [popovers](./popovers.md)) | [Popovers](./popovers.md#3-the-rule) | `pop.tsx:47` (`Caps`) |
| footer | A popover's last row only: the key hints its rows do not show. Once the inbox list is a program, its footer is that program's toolbar. | none in the list | [Popovers](./popovers.md#3-the-rule) (a key no row shows sits in the footer) | `pop.tsx:157-170`; typed by hand in `frame.tsx:421-426` (`ASKS_FOOT`) |
| glance | `next/`: a program's small view in the top bar's popover; the inbox list becomes the inbox program's glance. Keeps this meaning (decided). | none found; Linear's peek is the nearest (program guidelines, call 7, now moved to experiment 206) | [Ask desk](./ask-desk.md#one-asks-program-two-views); "any program may have one" moved to experiment 206 | Not built: today the inbox list is the frame's own menu |
| toolbar | A row of buttons built from a program's `commands`, each with its key printed on it, `role="toolbar"`. It is the action bar and the keys line in one. | toolbar ([APG][apg-toolbar]; view toolbar, [VS Code][vsc-ux]) | [Glossary](../../.glossary/TERMS.md); proposed in [experiment 196](../../experiments/196-ask-desk.md#patterns-found) P8 (75%), program guidelines G7 R1 and C11 | Not built |
| key hints | Words that name keys and cannot be pressed: the prefix line, a mode's keys on the status bar. | none needed | [Glossary](../../.glossary/TERMS.md) | `frame.tsx:801-820` |

That is 50 parts in four tables.

## Clashes

Each is one word for two things, or two words for one thing
([use the industry's names](./use-the-industrys-names.md): "a bug to fix"). The owner picked each
one on 2026-11-03. **Decided 2026-11-03** below means the word is settled and is in the
[glossary](../../.glossary/TERMS.md); the percent is the lean the owner was shown. None is in code
yet.

### 1. "Frame" and "chassis"

```text
frame.ts:12       the top bar, the bottom line, the asks list and the palette
popovers.md       the bars are the frame; what opens over it is the product
guidelines skill  the chassis: the top bar, the bottom line, each tile's title bar, the desk
```

- **Decided 2026-11-03** (lean was 75%): one word, **frame**: everything the app draws that is not a
  program's view. The bars, each tile's title bar, edge, strips and dividers, and what opens over
  the tiles. "Chassis" goes.
- **Why:** three scopes for one idea. "Frame" is plain and already in the code and this note's
  title. VS Code says "workbench" for the same thing ([VS Code][vsc-ux]); browsers say "chrome".
- **Doubt kept:** popovers' line between "frame" and "product" is about the font, not the name. The
  font rule stays as it is; only the word changes.

### 2. "Popup" and "popover" and "menu"

```text
ask-desk.md, program guidelines   "the top bar's popup"
popovers.md, pop.tsx              a popover; the asks list is a menu
frame.tsx:264                     opens={{popup: "menu", ...}}   ARIA's aria-haspopup
```

- **Decided 2026-11-03** (lean was 85%): **popover** for the box, **menu** when each row does
  something, and "popup" only as ARIA's attribute, `aria-haspopup`. In the ask desk and program
  guidelines, "the top bar's popup" becomes "the inbox menu", or "the glance" when the point is that
  it is a program's view.
- **Why:** popovers is decided and uses Apple's and HTML's word. "Popup" names nothing ours that
  "popover" does not.

### 3. "Bottom line", "status line" and "footer"

```text
the bottom line         popovers, modes, the README, BottomLine in frame.tsx:787
"bottom status line"    tile guidelines' heading for the same part
"what the footer shows" the naming sweep's row for the same part; also <footer> in frame.tsx:888
status line             experiment 73: one line per running copy of a machine, packages/fabrika/src/program/program.ts:309
status line             tracker views 5.1: a ticket page's first line, whose turn it is
"its status line"       program guidelines G7, for a mode, which modes calls the status region
footer                  a popover's last row of key hints, pop.tsx:157
```

- **Decided 2026-11-03** (lean was 65%): the bottom line becomes the **status bar**, VS Code's word.
  "Status line" keeps one meaning: one line that says how one thing is (a machine's copy, a
  ticket). "Footer" means only a popover's last row.
- **Why:** tmux's word, "status line", is taken twice in our own code. "Status bar" is the word
  most people know, it pairs with "top bar" ("the bars" still reads), and nothing of ours uses it.
- **Cost:** `BottomLine`, `bottomLineShows`, `.bottomline` and their tests, about 40 lines, and one
  pass over the notes. "Bottom line" is in eleven notes and the owner's own rulings.

### 4. Five places draw keys with names

```text
popover footer     ↑ ↓ Move   ↵ Open   H Later   Esc Close     typed by hand, ASKS_FOOT, frame.tsx:421
prefix line        PREFIX · N new · x close · z zoom           from the key table, frame.tsx:801
mode word          INFO · point at anything      esc leaves    modes M3
action bar         [Take rec  Y] [Not the rec  N]              experiment 196's P8, proposed
keys line          y only · d done                             program guidelines C11
```

- **Decided 2026-11-03** (lean was 70%): two words. A **toolbar** is a row of buttons built from a
  program's `commands`, each with its key, `role="toolbar"`. That is the action bar and the keys
  line, which C11 itself calls "G7 R1", one part. **Key hints** are words with keys that nothing
  presses: the prefix line and a mode's keys on the status bar.
- **Why:** APG names a row of buttons a toolbar, and VS Code puts a program's actions on a "view
  toolbar" ([VS Code][vsc-ux]). "Action bar" is Android's old word.
- **The popover footer:** today it is hand-typed and `aria-hidden` (`pop.tsx:159`). Once the inbox
  list is the inbox program's glance, its footer becomes that program's toolbar, from its
  `commands`, and `ASKS_FOOT` goes. Program guidelines already says "no program writes a footer of
  keys by hand".
- **Still open, a test and not a word:** whether a popover footer should be pressable at all, since
  its rows already take the keys. A screen reader run settles whether a second set of buttons is
  noise.

### 5. "Glance" means two things

```text
ask-desk.md            a glance view: the inbox program's small view in the top bar's popover
tracker views 5        Glance = Schema.Union([...]): what a ticket shows at a glance, its status line
```

- **Decided 2026-11-03** (lean was 60%): "glance" keeps the ask desk's meaning. The tracker's
  `Glance` becomes `Status`, since its section already calls it "the status line", and the sweep
  picks `Status` (Linear's word) for a ticket's top line.
- **Doubt kept:** `Status` sits close to experiment 73's `status`. Both mean "how one thing is
  now", and the glossary now keeps them in two contexts, but a reader may stop on it.

### 6. "Window" means four things

```text
the OS window                      main.ts:189
next/'s client                     brain, hands, window, agent: "what draws and sends a person's keys"
a program's drawing                "program windows", <package>/window, windows.tsx
a tile of a tsh line               "a line's windows", desk/layout/line.ts:20, desk.tsx:565
```

- **Decided 2026-11-03** (lean was 80%): **window** is the OS window and the client that draws it,
  which agree. What a program draws is its **view** (Elm's word, and `defineProgram`'s `view`). A
  line's windows are its **tiles**.
- **Why:** the sweep found the same, at 70% (`windows.tsx` to `views.tsx`).

### 7. "Desk" means five things

```text
today's desk machine          apps/fabrika/src/desk/desk.ts
next/'s desk program          fabrika/desk, Tier 2
the desktop                   layer 5, Tuval
the ask desk                  ask-desk.md, which is one asks program
the owner's desk              every-wait-is-a-queue.md, and the owner-desk pack
```

- **Decided 2026-11-03:** the owner picked a codename, **tezgah**, for Tuval's window manager
  (the machine that was "the desk"), as Mutter is GNOME's and KWin is KDE's. Tuval stays layer 5,
  the desktop environment, and people see only "fabrika". `next/`'s `fabrika/desk` becomes
  `fabrika/tezgah`. Today's code keeps `desk` until that code goes. **Desktop** is only layer 5.
  "The ask desk" becomes **the inbox program**, and the owner's desk is **the inbox** (Linear's
  word; the program is `inbox`, in [We follow DDD](./we-follow-ddd.md)).
- **Why:** "desk" meant five things, and a codename names one machine without borrowing a word the
  industry uses for something else.
- **Still to do:** the ask desk note keeps its title until the rename pass; renaming a decided
  note's title is a separate change.

### 8. "Panel" means four things

```text
Panel in pop.tsx:619          the item lines: a non-modal dialog
"keys panel"                  C-b ?, the palette today; a tile from the keys editor build (E1)
the menu bar's panel          next/, Tier 1's detail: "the panel's status line"
properties panel, agent panel inside the ticket's view (tracker views)
```

- **Decided 2026-11-03** (lean was 65%): no frame part is called a panel. The item lines are a
  popover (popovers' own type says `dialog`). `C-b ?` is the shortcuts list. The menu bar extra's
  rows are its popover. Whether a side panel inside a view is a program waits on call 8 of program
  guidelines, now moved to experiment 207, the layers study.
- **Why:** VS Code's Panel is a docked area under the editor ([VS Code][vsc-ux]), which we do not
  have, so the word would mislead a VS Code user in the frame.

### 9. "Menu bar" in `next/`

- **Decided 2026-11-03** (lean was 80%): `next/`'s "menu bar" (the icon and its rows, drawn by
  Electron's Tray) becomes the **menu bar extra**. On macOS, the menu bar is the system's bar across
  the screen, and Apple calls an app's icon in it "a menu bar extra" ([macOS HIG][hig-menubar]).
- **Cost:** words only; nothing is built.

### 10. The divider between tiles, and the tile's edge

```text
.border, desk.tsx:676         the 4px you drag
resize gap                    tile guidelines, for the same
"split gutters"               tile guidelines, Linear's section
edge                          the tile's own outline, --tile-edge
```

- **Decided 2026-11-03:** the 4px between tiles is the **divider**, Apple's word for it
  (`NSSplitView`, [macOS HIG][hig-split]). Not "gap", which this note had leaned to (60%), and not
  "border": tmux draws a real line there, and ours has the tiles' edges. The code's `.border`
  becomes `divider`. "Edge" stays the tile's outline.
- **Resize mode:** at rest the divider is not a Tab stop. In Tier 2, a prefix key enters an
  i3-style **resize mode** ([i3][i3]): the status bar shows RESIZE, a screen reader hears "Resize
  mode on", `h j k l` move the focused tile's divider (it is a focused `role="separator"` while you
  move it), and Escape or Enter leave. This changes the tile guidelines' "no focusable separators"
  to "focusable only in resize mode". It needs a Manti `Splitter` option so the trigger is not a Tab
  stop at rest: a `pnpm patch` first, then a Manti pull request with the owner's yes.
- **Why not APG's "window splitter":** "splitter" promises the APG keys at rest, which the divider
  does not have.

### 11. "Zoom" means three things

- Tile zoom (`C-b z`, tmux's word), page zoom (tile guidelines' Zoom section, WCAG 1.4.10), and
  macOS's window zoom (a double-click on the drag area, `frame.ts:644`).
- **Decided 2026-11-03** (lean was 85%): "zoom" alone is the tile's. The other two are always
  written "page zoom" and "window zoom".

### 12. "Asking" and "ask"

```text
an ask                 what an agent asks the owner: the asks count, the asks list, the ask desk
asking marker          tile guidelines: the tile waits for y or n on close t2?
questionOf, question   desk.ts, frame.ts: the same y or n
```

- **Decided 2026-11-03** (lean was 75%): the tile's y or n is **the close question** everywhere, so
  the tile guidelines' "asking marker" becomes "question marker", and `Open.ask` becomes
  `question` (the sweep's row was open on this). "Ask" means only what an agent or a step asks a
  person.
- **Why:** the asks count and the asking marker sit on the same screen and mean different things.

### 13. "Line" means seven things

```text
a tsh line, the line           tracker | ticket | trace: the line typed, and the top bar's part showing it
bottom line, status line       see clash 3
prefix line, keys line         see clash 4
item lines                     the few lines under an item
```

- **Decided 2026-11-03** (lean was 75%): after clashes 3 and 4, "line" means the tsh line and a plain
  line of text. The top bar's "the line" stays, since it shows the tsh line. "Item lines" can stay:
  they are lines of text.

### 14. Smaller pairs

- **`bare` and `bars`.** Code says `bare` (`frame.ts:704`); the key and its tsh word say `bars`.
  The sweep also proposes renaming the layout's `TSH` to `BARE`, a third meaning.
  **Decided 2026-11-03** (lean was 70%): `barsHidden` in code, and the layout's one gets another
  word.
- **"Keys panel" and "Keyboard shortcuts" and `keys`.** One part, `C-b ?`.
  **Decided 2026-11-03** (lean was 80%): the shortcuts list today; the `keys` program in `next/`,
  as K3 decided.
- **"The region's name" and "program name".** **Decided 2026-11-03** (lean was 75%): "accessible
  name" for what a screen reader hears ([APG][apg-name]); "program name" for the title bar's word.
- **`%3`.** Our job ids look like tmux's pane ids (`%n`). A tmux user may read `%3` as a pane.
  **No lean, not decided:** noted only, since tsh's `%n` follows bash's job numbers.

## The renames, in one list

All decided as words on 2026-11-03. None is in code or in another note yet; one rename pass does
that.

| Today | Decided | Was the lean |
|---|---|---|
| chassis | frame | 75% |
| the top bar's popup | the inbox menu, or the glance | 85% |
| bottom line | status bar | 65% |
| action bar, keys line | toolbar; unpressable keys are key hints | 70% |
| tracker's `Glance` | `Status` | 60% |
| program windows, a line's windows | views, tiles | 80% |
| desk | tezgah | picked by the owner |
| ask desk | the inbox program; the owner's desk is the inbox | 70% |
| `Panel`, keys panel | item lines popover, shortcuts list | 65% |
| menu bar (`next/`) | menu bar extra | 80% |
| `.border`, "gap" | divider, with an i3-style resize mode | 60% for gap, changed by the owner |
| asking marker, `Open.ask` | question marker, `question` | 75% |
| `bare` | `barsHidden` | 70% |
| the region's name | accessible name | 75% |

**What it costs:** words, not behavior. About 120 lines of code renames in `apps/fabrika` and one
pass over about fifteen notes, 2 to 3 agent hours, a guess from the file list above. The resize
mode is new work in Tier 2, not a rename.

## Nobody decides these yet

**Proposed.** The workspace list, the line in the top bar, the item, the agents, sync and host
items, the drag area and band, the window buttons room, the here word, the job item, the note, bars
hidden, and the jobs menu. Each is built and described in `apps/fabrika/README.md`, and no
direction note owns its word. Glance views beyond the inbox program (program guidelines call 6,
moved to experiment 206) and the toolbar's first use (P8) are proposed only.

## What the ledger records

Nothing new. These are words for parts of a screen. No fact is lost by waiting.

## What comes next

The Design canvas, "The frame", drawn on Claude Design with the design system installed
([drawn on Claude Design](./design-on-claude-design.md)): the window at the five layouts with each
part labeled by the word above, so the owner can point at a part and read its name. It is not drawn
yet.

## What it cannot tell us

- **Whether the words read well in use.** The owner picked them in a walk; nobody has used them
  for weeks of work yet. The first test was the walk that started this note, where one word had no
  place anyone could point to.
- **Industry words were read, not compared with people.** Each source was read once on 2026-11-03.
  Material's pages and Linear's app did not load as text, so their rows rest on the page names and
  on what earlier notes quoted.
- **Line numbers are main's at this commit.** Some older notes cite lines that have moved; the
  rows here were read fresh.
- **`next/` parts are on paper.** `next/` is not on main, so every `next/` row comes from a note or
  the plan, not from code.
- **The count of 50 depends on how parts are cut.** Edge and the tile states could be one part or
  six.

[hig-win]: https://developer.apple.com/design/human-interface-guidelines/windows
[hig-pop]: https://developer.apple.com/design/human-interface-guidelines/popovers
[hig-menubar]: https://developer.apple.com/design/human-interface-guidelines/the-menu-bar
[hig-split]: https://developer.apple.com/design/human-interface-guidelines/split-views
[m3-top]: https://m3.material.io/components/top-app-bar/overview
[m3-badge]: https://m3.material.io/components/badges/overview
[vsc-ux]: https://code.visualstudio.com/api/ux-guidelines/overview
[vsc-status]: https://code.visualstudio.com/api/ux-guidelines/status-bar
[vsc-palette]: https://code.visualstudio.com/api/ux-guidelines/command-palette
[vsc-ui]: https://code.visualstudio.com/docs/getstarted/userinterface
[vsc-msg]: https://code.visualstudio.com/api/references/vscode-api#window.setStatusBarMessage
[tmux]: https://man.openbsd.org/tmux.1
[i3]: https://i3wm.org/docs/userguide.html
[apg-name]: https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/
[apg-land]: https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/
[apg-split]: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/
[apg-menu]: https://www.w3.org/WAI/ARIA/apg/patterns/menubutton/
[apg-dialog]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
[apg-tip]: https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/
[apg-toolbar]: https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
[mdn-live]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
[el-drag]: https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions
[lin-keys]: https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help
