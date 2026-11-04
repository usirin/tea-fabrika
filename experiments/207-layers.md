# What can sit over the desk's tiles, how do those layers stack, and what is fabrika's fold-like move for them?

Read 2026-11-03. **This is reading, not a measurement.** Nothing ran but reads of today's code,
the notes, and public docs and source. It is steps 1 to 4 of a guidelines study, plus the names
of the directions for step 5. It will feed a note, "Layers", and a Design canvas, "Layers
guidelines". Neither exists yet. No design is built or shot.

The owner asked for layering principles while walking the frame note
([PR 353](https://github.com/usirin/tea-fabrika/pull/353), proposed). Neovim and tmux both have a
float layer. The question is how fabrika can move layering one step forward, the way
[fold, not tabs](../docs/direction/fold-not-tabs.md) was a new answer for tabs.

**The answer.** The makers agree on a plain shape:

- **A few named layers, in one fixed order.** macOS names its window levels (`floating`,
  `modalPanel`, `popUpMenu`) [a5]. Neovim gives its own parts fixed heights (100, 200, 250) and
  tells plugins "Below 100 is recommended" [n1]. i3: "Floating windows are always on top of tiling
  windows" [i1]. The web puts a modal dialog and a popover in one top layer [h1].
- **Every layer has an owner and goes with it.** A Neovim float is placed `relative` to the
  cursor, a window or the editor [n1]. An Emacs child frame "always appears on top of its parent
  frame", and hides when its parent does [e1]. A macOS sheet blocks only its parent [a2].
- **What is on top and who takes the keys are two facts.** Neovim has `enter` and `focusable` [n1].
  macOS has a main window (the one you look at) and a key window (the one that takes input) [a4].
  Linear's peek sits on top while the list keeps its keys [l1].
- **One modal at a time; Escape closes the top one; focus goes back.** tmux: "A window can only
  have one modal pane" [t1]. Apple: "Let people dismiss a modal view before presenting another
  one" [a1]. HTML: "only one `auto` popover can be shown at a time" [h2]. APG: "Windows under a
  modal dialog are inert" [p1].
- **A float is a tile placed differently, and it moves both ways.** Neovim's `nvim_win_set_config`
  "Can transform a window to/from a float" [n1]. tmux 3.8: "break-pane can float a tiled pane,
  join-pane can tile a floating pane" [t2]. i3's scratchpad window "is just a normal floating
  window" [i1]. i3 is also blunt: floating "violates the tiling paradigm but can be useful for some
  corner cases" [i1].
- **Nothing covers what you are working on.** WCAG 2.4.11: the focused part is "not entirely
  hidden due to author-created content" [w1]. A cockpit's head-up display has the same rule, and
  pilots ask for "Automatic and/or manual declutter modes" [x1].

Today's running example (the asks menu, then the palette, then Escape, on a desk with a ticket
view over a tsh) follows the shape in most ways. One value holds what lies over the desk, Escape
peels one layer at a time, and focus goes back to where it was. It breaks it in two: the order is
three loose CSS numbers, not a named list, and the palette says `aria-modal` while the desk under
it stays live, not `inert`.

**The fold-like move, a guess at 60%: a layer covers only what it is about.** The desk-wide layer
stays the frame's alone. A program's own layer sits on its own tile, as a macOS sheet sits on its
window. A look at another program's thing opens in place, as an unfold beside it, as VS Code's
peek does ("we embed the result inline" [v2]), before it ever floats over a neighbor. Fold kept
the picture by keeping a tile in its place; this keeps the picture by never covering a tile you
did not ask about.

```text
how each tool layers, one line each
Neovim      floats over splits; relative to cursor, window or editor; zindex 50 default; enter, focusable
tmux 3.8    floating panes over the layout; one modal pane per window; break-pane and join-pane; popups
i3 / sway   floating always over tiling; scratchpad shows a hidden window as a float; toggle per window
Emacs       child frames on top of their parent; hidden with it; restacked only among siblings
VS Code     Quick Pick at the top; peek embedded inline in the editor; Escape closes; open to full editor
macOS       named window levels; a sheet blocks only its parent; panels float; main window and key window
the web     a top layer for modal dialogs and popovers; auto, hint and manual popovers; modal is inert under
Linear      fixed CSS ladder, popover 600 to context menu 1200; Cmd-K modal; Space peeks, the list keeps keys
Figma       front and back is the layer list's order; a frame can clip its children (z-order secondary)
elm-ui      a nearby element is an attribute of its owner: above, below, inFront, behindContent
Erlang/OTP  a linked process gets an exit signal when the other side ends
cockpit HUD symbols over the outside view; clutter is a named risk; declutter modes on demand
Ableton     its own devices fold in the chain; only third-party plug-in windows float (secondary)
```

## Which version

- **Today's version (`apps/fabrika`):** the running example, read on main at `d60a005e`.
  Every `path:line` is that commit.
- **`next/`:** not on main. The desk arrives as a program in Tier 2
  ([the desktop layer](../docs/direction/the-desktop-layer.md)), so every `next/` claim here is on
  paper.

## Step 1: what is settled

### Decided

| Point | Source |
|---|---|
| One thing over the desk at a time. Which popover is open lives in the frame's model, one `over`, so two cannot be open at once. | [popovers](../docs/direction/popovers.md), settled 2026-10-30 |
| A popover behaves like its standard: focus moves in, arrows move, Escape closes and puts focus back, a click outside closes it. Roles: `menu`, a `combobox` in a `dialog` for the palette, `dialog`, `tooltip`. | popovers, section 3 |
| Closing is at once, with no fade. The close question stays in the bars, where tmux asks it. Info mode stays on the bottom line. | popovers, section 9 |
| What opens over the desk uses the windows' font and tokens; the bars stay mono. | popovers, settled |
| A popover is not a mode. One mode per program; one Escape leaves one; the prefix and F6 work in every mode; the load refuses a mode with no way out (WCAG 2.1.2). | [modes](../docs/direction/modes.md) M4, M5, decided 2026-11-01 |
| The desk has no tabs. A tile folds into a strip that keeps its place. Focus is always on an open tile; moving focus onto a strip opens it. Zoom draws one tile alone. | [fold, not tabs](../docs/direction/fold-not-tabs.md), decided 2026-10-28 |
| A tile is a region; focus always has a home; a covered terminal goes `inert`; forced colors and zoom rules. | [tile guidelines](../docs/direction/tile-guidelines.md), decided 2026-11-01 |
| Every binding is data; popovers' own keys (arrows, `J`, `K`, Escape) are not modes. | [keybindings](../docs/direction/keybindings-are-configurable.md), decided 2026-11-01 |
| The desktop is layer 5: it places tiles, owns focus and routes keys. A process never knows where its tile is. Each window runs the prefix itself. | [the desktop layer](../docs/direction/the-desktop-layer.md) W3 to W5, decided 2026-10-31 |
| G1, one job, one model, and every size draws it. Composing programs, C1 to C11. | program guidelines, [PR 332](https://github.com/usirin/tea-fabrika/pull/332), decided 2026-11-02 and 2026-11-03 on its branch |

[Windows in `next/`](../docs/direction/windows-in-next.md) was read too. It is about the
Windows OS, not about layers, and decides nothing here.

### Leaned (proposed, not settled)

- **The frame note** ([PR 353](https://github.com/usirin/tea-fabrika/pull/353)): "over the desk"
  is "whatever lies over the tiles now. One at a time", with the sweep's word `overlay` at 70%;
  popover, menu, item lines, palette, shortcuts list, tooltip, keycap and footer are its parts.
  "Popup" goes, except as ARIA's `aria-haspopup` (85%). No frame part is called a panel (65%).
- **Program guidelines** (PR 332): G3, open or focus, then land beside (80%); G4 R2, the new tile
  takes focus (85%); G5, Escape peels from the inside out (70%). Call 7, "a look over the desk, or
  a tile beside", had no lean and moved to the customization study.
- **Customization** (experiment 206, on its own branch, not merged): L7, `float` is one more
  value of ticket 191's `place`, a float is a tile, never the default (65%). Its costs: two kinds
  of thing over the desk, one float per workspace, a popover above it, Escape peels the popover
  first. It found PR 332 wrong on one point: tmux and i3 float too.

### Untouched

- The order of layers as a named list. Today it is CSS numbers only.
- Whether a program may have a layer of its own at all, and whose it is.
- Whether a modal can be scoped to one tile.
- What lies under a modal: `inert` or not.
- What a zoom does to a layer, and what a layer does when its tile closes.

### Where layers ends and customization begins

Customization (206) owns **who picks** where a look opens: the person's `place` setting, its
default, its file. Layers owns **the rules any placement obeys**: which layers exist, their order,
whose each one is, who takes the keys, what Escape does, and what a layer may cover. 206's L7 is an
input here: if a person picks `float`, the float follows L1 to L5 below.

## Step 2: the running example

Today's version. A desk with `asks | ticket` is not built yet, so the case is what is built: a
workspace where `t2`'s ticket view covers its tsh, then `C-b a` (the asks menu), then Cmd-K (the
palette), then Escape twice.

| What | Today | Where |
|---|---|---|
| What lies over the desk | one value, `Over`: none, asks, jobs, palette or an item's lines | `apps/fabrika/src/window/frame.ts:660` |
| A second over | replaces the first: Cmd-K closes the asks menu and opens the palette | `frame.ts:770` (`toggle`) |
| Draw order | the workspace, then the bottom area, then `Over`, last in the page | `apps/fabrika/src/window/desk.tsx:862-878` |
| Heights | scrim 9, popover 10, tooltip 20 | `apps/fabrika/src/window/window.css:1168`, `:842`, `:1299` |
| A tooltip | never shows while anything lies over the desk or info mode is on | `apps/fabrika/src/window/frame.tsx:108` (`quietOf`) |
| Focus | moves in on open, back to where it was on close; a press outside closes | `apps/fabrika/src/window/pop.tsx:127` (`useOverlay`) |
| Keys | the palette takes every key; a menu takes every key but the prefix and the desk's question | `frame.ts:832` (`keyGoesTo`) |
| Escape | closes what lies over the desk; then the desk's prefix or question; then info mode | `frame.ts:798` (`escaped`) |
| A layer inside a tile | a program's view covers its tile's tsh | `desk.tsx:501` (`runOf`) |
| Zoom | draws one tile alone; the over is drawn the same | `desk.tsx:870` |
| Link lost | the workspace is `inert`; the over is outside it and stays live | `desk.tsx:867`, `:877` |
| The close question | in the bottom line as `role="alertdialog"`, and in the tile's title bar; not a layer | `frame.tsx:795-800` |
| The palette | `aria-modal="true"`; the desk under it is not made `inert` | `pop.tsx:534`, `desk.tsx:867` |

The trace, by reading (nothing ran):

```text
C-b a        frame.over = {kind: "asks"}; the menu takes focus; keys go to it but C-b
Cmd-K        toggle: over = {kind: "palette", ...}; the menu is gone; the scrim (9) and the palette (10)
             cover the whole window; every key goes to the palette
Escape       escaped: over = {kind: "none"}; the opener (a row of the gone menu) is no longer in the page,
             so useOverlay does not focus it, and the desk's focus effect puts focus back on t2's view
Escape       nothing lies over the desk and no prefix is armed, so the key goes on to t2
```

The same case against each principle (step 4 names them):

- **L1, named layers in a fixed order: half.** An order exists, and it is right (tooltip over
  popover over scrim over desk). But it is three CSS numbers with no type, and a program's CSS
  could write a fourth.
- **L2, every layer has an owner: half.** A popover knows its item (`aria-controls`, `pop.tsx:148`),
  so a press on the item is left to it. No layer belongs to a tile, so none can go with one.
- **L3, on top and taking keys are two facts: half.** `keyGoesTo` is the right pure function. Nothing
  says in words which layer holds the keys; the box itself is the only cue.
- **L4, one modal, Escape peels, focus goes back: passes, but one break.** One value, so one at a
  time; Escape peels; focus goes back. The palette is modal for keys and for a screen reader, but
  the desk under it is not `inert`, which APG asks for [p1].
- **L5, nothing covers what you work on: passes.** Only the frame's own boxes cover the desk, and
  each takes focus while it does. A tooltip goes quiet while anything else is up.
- **L6, a look opens in place: not reached.** Today has no look. A ticket opens in the tracker's
  tile or a tile of the line (fold, not tabs).

## What was read

### Tiling tools

- **Neovim** [n1], from `runtime/doc/api.txt` on master. "Floating windows ("floats") are displayed
  on top of normal windows." `nvim_open_win` "Opens a new split window, floating window, or
  external window"; "Floats are drawn over the split layout, relative to a position in some other
  window." `relative` is one of `cursor`, `editor`, `laststatus`, `mouse`, `tabline`, `win`.
  `zindex` "(positive integer, default: 50) Stacking order. Floats with higher `zindex` overlay
  floats with lower indices. Below 100 is recommended, unless there is a good reason to overshadow
  builtin elements." Its own: 100 the completion menu, 200 the message pager, 250 the command-line
  completion. `focusable` "(default: true) Enable focus by user actions"; `enter` "Enter the window
  (make it the current window)"; `mouse` false lets events "pass through to the window behind it".
  `nvim_win_set_config` "Can transform a window to/from a float."
- **tmux 3.7 and 3.8** [t1] [t2], from the 3.8 tag's `CHANGES` and `tmux.1`. 3.7 added floating panes:
  "panes which sit above the layout ("tiled panes") like popups but unlike popups are not modal and
  behave like panes". 3.8: "Many improvements to floating panes"; "modal panes may be created with
  new-pane -O"; "A modal pane is always the active pane and prevents interaction with any other
  panes while it is active. A window can only have one modal pane and it must be a floating pane."
  With `-K`, "all keys, including the prefix key, are passed directly to the modal pane"; `-C`
  closes it "when the mouse is clicked outside it"; `-D` closes it on Escape or `C-c`. "new-pane -A
  creates a floating pane which remains above a zoomed pane; modal panes do this by default."
  "break-pane can float a tiled pane, join-pane can tile a floating pane." `choose-tree` gained "a z
  sort order ... so floating panes can be sorted by z-index", and `move-pane` takes `front`, `back`,
  `forward`, `backward`. `display-popup` stays: "A popup is a rectangular box drawn over the top of
  any panes."
- **i3** [i1]. "Floating mode is the opposite of tiling mode. ... Using this mode violates the tiling
  paradigm but can be useful for some corner cases like "Save as" dialog windows". "Floating windows
  are always on top of tiling windows." `focus mode_toggle` moves between the floating and the tiling
  layer. A sticky window shows on every workspace, and "it will only take effect if the window is
  floating". Scratchpad: a hidden window is "shown again, as a floating window, centered on your
  current workspace"; "this is just a normal floating window, so if you want to "remove it from
  scratchpad", you can simple make it tiling again".
- **Emacs child frames** [e1]. "Child frames are objects halfway between windows ... and "normal"
  frames. Like windows, they are attached to an owning frame. Unlike windows, they may overlap each
  other". "A visible child frame always appears on top of its parent frame"; when the parent is made
  invisible, its child frames are not shown either. Restacking "changes only the stacking order of
  child frames with the same parent."

### Apps with a pointer

- **VS Code** [v1] [v2]. Quick Picks are "an easy way to perform actions and receive input from the
  user"; the page does not say whether they are modal. Peek: "we embed the result inline"; Escape
  closes it; clicking the file name or double-clicking a result "will open the reference in the outer
  editor".
- **macOS** [a1] [a2] [a3] [a4] [a5]. Modality: "Present content modally only when there's a clear
  benefit"; "Let people dismiss a modal view before presenting another one"; "Although an alert can
  appear on top of all other content ... you never want to display more than one alert at the same
  time." Sheets: "In macOS ... a sheet is always modal", one that "prevents people from interacting
  with the parent view until they dismiss the sheet"; "Display only one sheet at a time from the main
  interface." Panels: "a panel often floats above other open windows in your app"; "When your app is
  inactive, hide all of its panels." Windows: "There can be only one main window per app"; "Although
  the front app's main window is usually the key window, another window, such as a panel floating
  above the main window, might be key instead." `NSWindow.Level`: `normal`, `floating` ("Useful for
  floating palettes"), `modalPanel`, `mainMenu`, `statusBar`, `popUpMenu`, `screenSaver`.
- **The web** [h1] [h2] [h3]. The top layer "sits on top of all other layers displayed in a web
  document" and holds fullscreen elements, modal dialogs and popovers. Popovers: "only one `auto`
  popover can be shown at a time", except nested ones; a click outside "light-dismisses all open
  `auto` and `hint` popovers that are not its ancestor"; "`hint` popovers do not close `auto`
  popovers when they are displayed", for tooltips over a toolbar's popover; on a close by keyboard,
  "focus is shifted back to the invoker". Dialogs: "Modal dialog boxes block interaction with other
  UI elements, making the rest of the page inert, while non-modal dialog boxes allow interaction with
  the rest of the page."
- **Linear** [l1] [l2] [l3]. "Peek is one the semi-secrets of the Linear UI. It's a quick way to
  glance over the focused issue in issue lists similar to Quicklook in macOS"; "Peek is active while
  you hold down Space, or you can quickly press Space once to toggle it on" (2019 changelog). The peek
  docs page returned 404 again; a search summary says J and K move the peek from item to item, and
  that it opens from the keyboard only (**secondary**). Its stack, from the site's CSS read for
  [popovers](../docs/direction/popovers.md): popover 600, command menu 650, dialog 700, toasts 800,
  tooltip 1100, context menu 1200.
- **Figma** [f1]. A frame holds children and can "Hide any objects within the Frame that extend
  beyond the Frame's bounds". The page read does not say how front and back are ordered. That the
  layer list's order is the stacking order, and `⌘]` and `⌘[` move a layer, is from cheat sheets and
  forum posts (**secondary**).

### Elm and OTP

- **elm-ui** [m1], from `src/Element.elm`. "Let's say we want a dropdown menu. Essentially we want to
  say: _put this element below this other element, but don't affect the layout when you do_."
  `inFront` "will place an element in front of another"; on the root `layout` it is "fixed to the
  viewport which can be useful for modals and overlays". A layer is an attribute of its owner.
- **Erlang** [o1]. "If one of the participants of a link terminates, it will send an exit signal to the
  other participant." A layer linked to its tile goes when its tile goes.

### Accessibility

- **2.4.11 Focus Not Obscured (Minimum)** [w1]: the focused part is "not entirely hidden due to
  author-created content"; "sticky footers, sticky headers, and non-modal dialogs" are the usual
  cause; content the user can move is judged at its first place; Escape that reveals the focused part
  counts.
- **1.4.13 Content on Hover or Focus** [w2]: "Dismissible", "Hoverable", "Persistent". It covers "Custom
  tooltips, sub-menus, and other nonmodal popups"; modal dialogs are out of its scope.
- **2.1.2 No Keyboard Trap** [w3]: keeping focus in a modal dialog is fine "as long as the user knows
  how to 'untrap' the focus and leave that component".
- **APG modal dialog** [p1]: "Windows under a modal dialog are inert"; Escape closes; "When a dialog
  closes, focus returns to the element that invoked the dialog". It shows a dialog over a dialog in one
  example. The popover rules are in [popovers](../docs/direction/popovers.md), section 2.

### Outside software

- **A cockpit's head-up display** [x1]. IFALPA's 2025 position paper: a HUD lets pilots "see the
  outside view and projected infinity image at the same time"; "Automatic and/or manual declutter
  modes should be made available to the crew"; a named risk is "obscuring outside visual details such
  as lighting, traffic and objects by HUD clutter ... leading to loss of positional and traffic
  awareness". **Teaches:** a layer over live work is a safety cost; the person needs a one-press way
  to clear it. **Does not carry over:** a HUD has to stay up while flying; nothing of ours does.
- **Ableton Live** [x2] [x3]. Its own devices fold in place in the device chain (the source of fold,
  not tabs). Hot-Swap mode links the browser to the device in place: "the preset on the track is
  linked to the browser so that you can audition and load different presets". Third-party plug-ins
  open in their own floating windows, with a show and hide command and an auto-hide preference
  (**secondary**: forum posts quoting the manual). **Teaches:** Live keeps what it owns in place and
  floats only what does not fit its chain. **Does not carry over:** plug-in windows float because
  Live cannot draw them; our programs all draw in our views.
- **Picture in picture** was looked for in Apple's video guidance [a6]; the page names the mode and
  no rule worth quoting. Nothing taken from it.

## The plain way they agree on

1. The frame owns a few named layers in a fixed order. Programs do not pick heights.
2. Every layer has an owner and goes with it.
3. What is on top and who takes the keys are separate, and each is a choice.
4. One modal at a time, on the smallest owner the platform has (a window for a macOS sheet, a window
   for tmux's modal pane). Under a modal, the rest is inert. Escape closes the top; focus goes back.
5. A float is a tile placed differently, and it can go back.
6. Nothing covers what the person is working on; a tooltip can be dismissed, hovered and stays put.

Where it clashes with a goal of ours: tmux's `-K` hands the prefix to a modal pane. Our modes M4
keeps the prefix and F6 working everywhere, so we leave tmux there.

## Step 4: the principles tested three ways

Six drafts, each with a lean, a kind (law, lint or taste) and the three tests. They are drafts for
the note; the full wording is in the study's scratch file, not in the repo.

### L1: a few named layers, in one fixed order, owned by the frame. Lean 80%. Law and lint.

- **Linear as the builder.** Linear keeps a fixed ladder in its CSS (popover 600 to context menu
  1200). On our pieces the ladder is one type in the frame, and a program never writes a height. What
  every program gets for free: a place on the ladder (its sheet, its popover), never a number.
- **Elm.** The view's order is the stack: the frame draws the desk, then each layer from one model,
  as today's `Over` is drawn last (`desk.tsx:877`). elm-ui's `inFront` is the same idea.
- **Accessibility.** The page order follows the stack, so a screen reader meets a layer after what it
  covers (1.3.2, meaningful sequence). A lint on `z-index` in a program's CSS holds it.

### L2: every layer has an owner, and goes when its owner goes. Lean 80%. Law.

- **Linear as the builder.** A Linear popover belongs to its trigger, and a peek to its row. On our
  pieces the owner is a tile, a frame item or the window. The desk closes a tile's layers with the
  tile; no program tracks it.
- **OTP.** A link: the layer gets the exit when its tile ends. **Elm:** elm-ui's nearby elements are
  attributes of their owner.
- **Accessibility.** 2.4.3, focus order: when the owner goes, focus goes where the tile guidelines
  send it (`heirOf`, `apps/fabrika/src/desk/desk.ts:415`), never to the page's body.

### L3: what is on top and who takes the keys are two facts, and both are said. Lean 80%. Law.

- **Linear as the builder.** The peek is the clear case: on top, while J and K stay on the list. On
  our pieces a layer says `takes` or `passes`, and `keyGoesTo` reads it. The bottom line names a layer
  that takes keys, as it names a mode (modes M3), 65%.
- **Elm.** The parent's update sends a key to one child. `keyGoesTo` is that function today.
- **Accessibility.** 2.1.2: the prefix and F6 pass through every layer (modes M4), unlike tmux's `-K`.
  4.1.3: a layer that takes keys is said once in the status region. Needs a VoiceOver run.

### L4: one modal at a time, on the smallest owner; Escape peels the top; focus goes back. Lean 85% on Escape and focus, 60% on the tile scope. Law.

- **Linear as the builder.** Cmd-K is Linear's one modal, and Escape closes it. On our pieces the
  palette stays the one desk-wide modal. A program that needs a modal gets a sheet on its own tile
  (direction 3), so two tiles can each ask at once and the desk still works. That last part is a
  **guess**: no maker read scopes a modal to one pane.
- **Elm.** One slot per owner, so two modals cannot be written. Escape is one Msg that clears the top
  slot, as `escaped` does (`frame.ts:798`).
- **Accessibility.** APG: what lies under a modal is `inert`. Today's palette breaks it
  (`pop.tsx:534`, `desk.tsx:867`). 2.1.2: Escape leaves every modal. Needs a run: `inert` and
  `aria-modal` in Electron with VoiceOver.

### L5: nothing covers what you are working on. Lean 80%. Law (a box check in tests) and taste.

- **Linear as the builder.** No Linear answer found in its docs for what a peek may cover. On our
  pieces the desk knows every tile's box and the focused one, so a test can check that no layer that
  passes keys covers the focused tile.
- **Elm.** No Elm answer; it is a law over the boxes the view draws.
- **Accessibility.** 2.4.11 and 1.4.13. At 400% zoom (1.4.10) a float or a sheet has no room, so it
  becomes its tile. The cockpit's lesson: one press clears every layer, which `C-b B` and Escape
  already half do.

### L6: a look opens in place before it floats. Lean 60%, a guess. Taste, with a law for focus.

- **Linear as the builder.** Linear floats its peek (Quick Look style). Building it on our pieces, the
  desk already has a way to show a tile without losing the picture: the fold. So the peek is a strip
  beside the list that opens while the selection rests, and folds back on Escape. **This clashes with
  Linear's answer; the owner picks.**
- **Elm.** The tile's `folded` flips while the desk's `focus` stays on the list. No new type.
- **Accessibility.** 2.4.11 holds by construction, since nothing is covered. A polite status says
  "ticket 117 open beside". Needs a VoiceOver run: whether a strip that opens without focus is heard.

## Directions for step 5 (named, not built)

Each with its pipe line. The full sketches and what each undoes are in the scratch file.

1. **One over, kept.** `asks | ticket`, the ticket a tile beside (G3). Fixes only: `inert` under the
   palette, the layer that takes keys said in words. Undoes nothing.
2. **Floats, tmux 3.8's way.** `asks | ticket` with `[desk] place = "float"` (206). One float per
   workspace under the popover; a key floats or tiles a tile. Undoes popovers' "one at a time" (one
   popover over one float) and needs a G4 R2 exception if focus stays on the list.
3. **Sheets: a layer covers only its tile.** `asks | ticket`; Enter on "Approve plan" opens the answer
   form as a sheet over the asks tile only. Each tile gets one sheet slot. Undoes popovers' rule (one
   over the desk, plus one per tile) and needs modes M5 and the tile guidelines to name a sheet.
4. **A peek unfolds in place.** `asks | ticket`, the ticket starting as a strip; Space opens it in
   place, focus stays, Escape folds it. No new layer. Adds "a strip can open without focus" to fold,
   not tabs, and the same G4 R2 exception as 2, with nothing covered.

3 and 4 together are the fold-like move. 2 is 206's float, as the person's opt-in.

## What this tells us for fabrika

- Today's frame is closer to the makers than its code suggests. One value, Escape peels, focus goes
  back. What it lacks is the order as a type and `inert` under the palette.
- The float is not missing by accident. i3 calls it a break from tiling for corner cases, and Ableton
  floats only what it cannot fold. Our fold already shows a tile without losing the picture, which is
  why the lean reaches for it first.
- A modal scoped to one tile fits a desk of agents: two tiles can each ask, and the person answers
  each where it is, as the asks already say ("in the ticket's own tile", popovers section 1).
- **What the ledger records.** Each layer opened and closed, with `via` (keybindings already records
  it) and how it closed: `why: "escape" | "outside" | "done" | "owner_gone"`. Lost forever if not
  written then. 70%. For direction 4, whether a peek became an open.

## What it cannot tell us

- **Nothing was shot.** Whether a sheet is usable in a 506x314 tile (2x2 at 1024x700) or a 220x120 one
  is the first doubt of the fold-like move.
- **Linear's peek docs did not load** (404). Its key behavior rests on the 2019 changelog and a search
  summary.
- **The Ableton plug-in window rules and Figma's front and back order are secondary.** Both rest on
  forum posts and cheat sheets.
- **No screen reader ran.** `inert`, `aria-modal`, a sheet's name and a strip that opens without focus
  each need a VoiceOver and NVDA run.
- **The line numbers are main's at `d60a005e`.** The trace was read, not pressed.
- **Picture in picture and a game's pause layer** were not read; they may teach something about a
  layer that keeps playing.

## Dollars

$0. No model, no paid service. Public pages and source fetched once each.

## Links

Tiling tools:

- [n1] https://github.com/neovim/neovim/blob/master/runtime/doc/api.txt (`api-floatwin`, `nvim_open_win`, `nvim_win_set_config`)
- [t1] https://github.com/tmux/tmux/blob/3.8/tmux.1 (`new-pane`, `display-popup`, `move-pane`)
- [t2] https://github.com/tmux/tmux/blob/3.8/CHANGES (3.7 and 3.8)
- [i1] https://i3wm.org/docs/userguide.html (2.11 Floating, 6.7 Sticky, 6.21 Scratchpad)
- [e1] https://www.gnu.org/software/emacs/manual/html_node/elisp/Child-Frames.html and its pages Child-Frame-Properties and Child-Frame-Peculiarities

Apps:

- [v1] https://code.visualstudio.com/api/ux-guidelines/quick-picks
- [v2] https://code.visualstudio.com/docs/editing/editingevolved (Peek)
- [a1] https://developer.apple.com/design/human-interface-guidelines/modality
- [a2] https://developer.apple.com/design/human-interface-guidelines/sheets
- [a3] https://developer.apple.com/design/human-interface-guidelines/panels
- [a4] https://developer.apple.com/design/human-interface-guidelines/windows
- [a5] https://developer.apple.com/documentation/appkit/nswindow/level-swift.struct
- [a6] https://developer.apple.com/design/human-interface-guidelines/playing-video
- [h1] https://developer.mozilla.org/en-US/docs/Glossary/Top_layer
- [h2] https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using
- [h3] https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog
- [l1] https://linear.app/changelog/2019-09-23-improved-peek
- [l2] https://linear.app/docs/peek (404 when fetched; **secondary**, from a search summary)
- [l3] the linear.app stylesheet, as read for [popovers](../docs/direction/popovers.md) on 2026-10-30
- [f1] https://help.figma.com/hc/en-us/articles/360039959014-Layer-order (front and back order **secondary**)

Elm and OTP:

- [m1] https://github.com/mdgriffith/elm-ui/blob/master/src/Element.elm (Nearby Elements)
- [o1] https://www.erlang.org/doc/system/ref_man_processes.html (Links)

Accessibility:

- [w1] https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- [w2] https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
- [w3] https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html
- [p1] https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

Outside software:

- [x1] https://ifalpa.org/media/4307/25pos29-head-up-display-hud-and-vision-systems.pdf (IFALPA 25POS29, 2025-11-14)
- [x2] https://www.ableton.com/en/manual/working-with-instruments-and-effects/ (folded devices, Hot-Swap)
- [x3] https://forum.ableton.com/viewtopic.php?p=1754661 (plug-in windows; **secondary**: found by a search whose summary quoted the manual's show and hide command; the thread was not opened)
