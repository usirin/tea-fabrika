---
date: "2026-11-03"
scripts: "`207-layers/designs.patch` (the four designs, on today's app at `711ddaa4`, never pushed), `207-layers/shots/` (62 dark states, one folder a design, each with `presses.json`)"
summary: "Today's version; reading plus four designs shot, not a measurement. About 20 makers (NSWindow levels, Neovim floats, Emacs child frames, tmux 3.8, i3, elm-ui, OTP links, VS Code's peek, Apple's HIG, Linear, APG, WCAG, Ableton, an IFALPA HUD paper) agree: a few named layers in one fixed order nobody picks a number for, each with an owner it goes with, on top and taking keys as two facts, one modal at a time with the rest inert. They split on a look: VS Code embeds it, Linear floats it. Four designs on the asks menu and ticket #117, at five layouts: D1 one over with fixes, D2 floats (hid a whole tile in a small 2x2, and Esc never peeled it), D3 a sheet per tile, D4 a peek that unfolds in place (its menu covered the peek's title; a zoom hid it). Today breaks two rules: the palette is `aria-modal` with a live desk under it (ticket 203), and the status bar never names the layer. Feeds [layers](../docs/direction/layers.md), decided 2026-11-03. $0."
---

# What sits on top of what in the desk, and who takes the keys?

Read and built 2026-11-03. **This is reading plus four designs shot in today's app, not a
measurement.** Nobody used the designs on real asks. It feeds [layers](../docs/direction/layers.md),
decided the same day, and a private Design canvas, "Layers guidelines", with a pressable page of
every design and layout.

**The answer.** The makers agree on four things. A few named layers sit in one fixed order that no
part picks for itself (NSWindow levels, Neovim, i3, Linear's CSS). Every layer belongs to something
and goes when it goes (Emacs child frames, Neovim's `relative`, OTP links). What is on top and what
takes the keys are two facts (macOS's main and key window, Neovim's `enter` and `focusable`). And
one modal at a time, with everything under it inert (APG, Apple). They differ on scope: macOS scopes
a sheet to one window and tmux a modal pane to one window; nobody read scopes a layer to one pane.
On a look at something, they split: VS Code embeds a peek inline, Linear floats it.

Today's example, the asks menu and then the ask about ticket #117, follows half of this:

- **It follows:** `Esc` peels one layer and focus goes back to the opener; one pure function decides
  where a key goes; only the palette covers tiles, and it takes the keys while it is up.
- **It breaks:** the palette says it is modal but the desk under it is not inert; the order is three
  loose CSS numbers; the status bar never says which layer takes the keys; Enter on an ask opens
  nothing beside the list.

```text
how each tool read stacks its layers, one line each
NSWindow   named levels: normal, floating, modalPanel, popUpMenu; the app picks a name, not a number
Neovim     a float has a zindex; "Below 100 is recommended"; relative to the editor, a window or the cursor
Emacs      a child frame "always appears on top of its parent frame", and hides with it
tmux 3.8   a modal pane per window; -K passes "all keys, including the prefix key" to it
i3         "Floating windows are always on top of tiling windows."
elm-ui     "put this element below this other element, but don't affect the layout"
OTP        a link: when one side ends, it will "send an exit signal to the other"
Apple HIG  a sheet is modal to its window; "Display only one sheet at a time"
APG        "Windows under a modal dialog are inert."
VS Code    peek: "we embed the result inline"; Escape closes it
Linear     Space peeks the focused issue in a list; a CSS ladder from popover 600 to context menu 1200
Ableton    folds its own devices in the chain; third-party plug-in windows float (secondary)
IFALPA     a HUD can obscure what is outside "by HUD clutter"; asks for "declutter modes"
```

Which version: the tools are outside the repo. "Today" means today's version (`apps/fabrika`, read
on main at `1942afc8`). The four designs were built on today's version at `711ddaa4`, on a local
branch that was not pushed. Their code is kept here as `207-layers/designs.patch`. The sketches in
the note are for `next/`, where nothing about layers is built.

## What was read

About 20 public pages and manuals, and seven files of today's code. Quotes are short and checked
against the page or file as fetched. A claim found only on a summary or a forum is marked
**secondary**. One found nowhere is marked **guess**.

## Tools with layers

- **NSWindow levels** [m1]. A window has a level, picked by name: `normal`, `floating`,
  `modalPanel`, `popUpMenu`, and more. A higher level is always drawn over a lower one. The app
  never picks a raw number.
- **Neovim floats** [m2]. `nvim_open_win` takes a `zindex`: "Floats with higher `zindex` overlay
  floats with lower indices. Below 100 is recommended, unless there is a good reason to overshadow
  builtin elements." Its own parts sit at fixed numbers above that. A float is `relative` to the
  editor, a window or the cursor, and `focusable` and `enter` are two separate options: a float can
  be on top without taking the keys.
- **Emacs child frames** [m3]. "A visible child frame always appears on top of its parent frame",
  and it is hidden when its parent is.
- **tmux 3.8** [m4]. Floating panes, and "a window can have one modal pane and it prevents
  interaction with the other panes while it is active". With `-K`, "all keys, including the prefix
  key, are passed directly to the modal pane." `new-pane -A` makes a float that "remains above a
  zoomed pane".
- **i3** [m5]. "Floating windows are always on top of tiling windows."
- **elm-ui** [m6]. Nearby elements: "put this element below this other element, but don't affect the
  layout when you do". The layer is a child of the thing it is about.
- **Erlang/OTP** [m7]. A link: "If one of the participants of a link terminates, it will send an exit
  signal to the other participant."
- **VS Code peek** [m8]. Peek shows a reference without leaving the file: "we embed the result
  inline". "The peek window is closed if you press Escape or double-click in the peek editor
  region."

## Apps with a pointer

| Tool | What it does with layers | Tag |
|---|---|---|
| Apple HIG, modality | "Let people dismiss a modal view before presenting another one." | [p1] |
| Apple HIG, sheets | "In macOS ... a sheet is always modal", to its parent window; "Display only one sheet at a time from the main interface." | [p2] |
| Linear, peek | "Peek is active while you hold down Space", or "press Space once to toggle it on", for "the focused issue in issue lists". That J and K keep moving the list is **secondary** (program guidelines' [l6]). | [p3] |
| Linear, command menu | One desk-wide command menu, page dimmed under it. | [p4] |
| Linear, CSS | A fixed ladder, low to high: popover 600, command menu 650, dialog 700, toasts 800, tooltip 1100, context menu 1200 (read for [popovers](../docs/direction/popovers.md)). | [p5] |

## Outside software

- **Ableton Live** [o1]. "A device can be collapsed by double-clicking its title bar or by choosing
  Fold." Its own devices fold in the chain and never cover each other. Third-party plug-in windows
  float over the set (**secondary**, forum reports [o2]). What carries over: the look opens in its
  own place. What does not: a plug-in's window is someone else's program, which in fabrika is a tile.
- **A cockpit's head-up display** [o3]. IFALPA's 2025 position paper warns of "obscuring outside
  visual details such as lighting, traffic and objects by HUD clutter" and says "Automatic and/or
  manual declutter modes should be made available to the crew." What carries over: a layer must not
  cover what you are working on, and there is one press that clears it. fabrika's is `C-b B` and the
  rule that a tooltip goes quiet while anything else is up.

## Accessibility

- **APG, the modal dialog** [a1]: "Windows under a modal dialog are inert." Today's palette is
  `aria-modal` while the desk under it is live.
- **WCAG 2.4.11, focus not obscured** [a2]: a focused part "is not entirely hidden due to
  author-created content". A layer that leaves the keys below must not cover where they go.
- **WCAG 1.4.13, content on hover or focus** [a3]: a tooltip is dismissible, hoverable and
  persistent. Today's tooltip meets two; hoverable needs a check.
- **WCAG 2.1.2, no keyboard trap** [a4]: the prefix and F6 work under every layer, as modes M4
  already says. Here we leave tmux, whose `-K` passes the prefix too.

## Four designs, built and shot

Each design is a setting of the same build (`fabrika.layers` in the page's local storage, made up),
so all four and today draw the real chassis with the real tokens. Each was pressed through the same
walk: the asks menu (`C-b a`), Enter or Space on the ask about #117, the palette (`Cmd-K`), then
`Esc` twice. 62 states, dark, at five layouts: side by side at 1440x900, one tile, stacked, a 2x2
grid, and a 2x2 grid at 1024x700. The shots and what each press did are in `207-layers/shots/`.

```text
the pipe line each design writes first
D1  asks | ticket     one over, today's rule kept; Enter turns the ticket tile and focuses it
D2  asks | ticket     the ticket tile floats over the workspace (206's place = "float")
D3  asks | ticket     Enter: the answer opens as a sheet over the ticket's tile only
D4  asks | ticket     the ticket tile waits as a strip; Space unfolds it in place, focus stays
```

| Design | What the shots showed | Kept for |
|---|---|---|
| D1, one over | The desk is inert under the palette. The status bar names the layer that takes the keys: `ASKS · the menu takes the keys · esc closes it`, `PALETTE · takes every key · the desk waits under it`. Nothing else changes. | L1, L3, L4: fixes now |
| D2, floats | The float covers its neighbors: in the 2x2 at 1024x700 it hides t4 whole. After `Cmd-K`, `Esc`, `Esc`, the palette goes and the float stays: the float has no `Esc` of its own. | Lost: L4 and L5. Floats stay opt-in (206) |
| D3, sheets | The sheet covers only t2; t1 keeps its half-typed line and works. `SHEET · on t2 · takes t2's keys · esc closes it`. `Esc` peels the palette, then the sheet, and focus lands in t2's ticket. In a 2x2 tile the sheet covers the tile whole. | L2, L4: built next |
| D4, unfold | Space opens the strip in place; focus stays in the menu; the arrows move the peek with the row; Enter moves focus in. Two breaks: the menu covers the peek's title (side by side), and when t1 is zoomed the peek opens behind the zoom while the menu still says `Space Peek`. | L6: built after two fixes |

**Why D2 lost.** It breaks L5 at the smallest layout (a whole tile hidden) and L4 (a layer with no
way to peel it). It also needs the most new code: the desk model would hold floats in an order.
206 keeps it as the person's opt-in.

## Today's asks menu and the ask about #117

| What | Today | Where (`apps/fabrika/src/window/`) |
|---|---|---|
| Enter on an ask | Turns the tracker, or says "no tile shows #117 · the tracker opens it" | `frame.ts:378` |
| Who gets a key | One pure function | `frame.ts:832`, `keyGoesTo` |
| `Esc` | Peels one layer | `frame.ts:798`, `escaped` |
| Focus in and back | Moves into a layer and back to its opener | `pop.tsx:127`, `useOverlay` |
| The palette | `aria-modal`, but the workspace is `inert` only when the link is down | `pop.tsx:534`, `desk.tsx:867` |
| The order | Three CSS numbers: `.scrim` 9, `.pop` 10, `.tip` 20 | `window.css:1166`, `:840`, `:1297` |

Checked against each principle:

- **L1, a fixed order the frame owns: half.** The order exists, as three loose numbers in one file.
- **L2, every layer has an owner: no case yet.** Every layer is the frame's; no tile owns one.
- **L3, say who takes the keys: breaks.** With the asks menu or the palette open, the status bar
  still says `t1 tsh`.
- **L4, one modal, inert under it, `Esc` peels: half.** `Esc` and focus are right; the desk under the
  palette is live.
- **L5, nothing covers what you work on: follows.** Only the palette covers tiles, and it takes the
  keys while it is up.
- **L6, a look opens in place: no case yet.** Today has no look at all.

## What this tells us for fabrika

- A layer is a short list of names in one order, owned by the frame. That is what every tool read
  does, and it is a type and a lint, not a convention.
- A program's own layer belongs on its own tile. D3 showed it at every layout; at a 2x2 tile it
  covers the tile whole, which is still only its own tile.
- A look at another thing opens in place, beside the list, before it ever floats. D4 showed it with
  no new layer at all, once its two breaks are fixed. This is a clash with Linear's float; the
  owner took the unfold, since program guidelines G3 (land beside), fold, not tabs, and L5 point
  there.
- Two plain fixes in today's version: the desk inert under the palette (tracker ticket 203), and the
  status bar naming the layer that takes the keys.

## What it cannot tell us

- Nobody used these designs on real asks. Every lean is a reading of shots, not a measurement.
- Only one ask was seeded, so the menu never showed a peek following a second, different ticket.
- No screen reader ran. The sheet, the inert desk and the layer words need a VoiceOver run.
- Whether a peek that keeps focus confuses people, with two ways to open a strip. A week of use
  would tell.
- Whether a sheet sits under or over a float: no float is built in the same app as a sheet.
- The Linear claims are read from its changelog and stylesheet, not from using it on our kind of
  work.

## Links

- [m1] https://developer.apple.com/documentation/appkit/nswindow/level
- [m2] https://neovim.io/doc/user/api.html#nvim_open_win()
- [m3] https://www.gnu.org/software/emacs/manual/html_node/elisp/Child-Frames.html
- [m4] https://github.com/tmux/tmux/blob/master/CHANGES (3.7c to 3.8), and the `new-pane` entry in
  tmux(1)
- [m5] https://i3wm.org/docs/userguide.html
- [m6] https://package.elm-lang.org/packages/mdgriffith/elm-ui/latest/Element#nearby-elements
- [m7] https://www.erlang.org/doc/system/ref_man_processes.html
- [m8] https://code.visualstudio.com/docs/editing/editingevolved
- [p1] https://developer.apple.com/design/human-interface-guidelines/modality
- [p2] https://developer.apple.com/design/human-interface-guidelines/sheets
- [p3] https://linear.app/changelog/2019-09-23-improved-peek
- [p4] https://linear.app/changelog/2019-12-18-new-command-menu
- [p5] [popovers](../docs/direction/popovers.md), Linear's layers, read from linear.app's CSS
- [o1] https://www.ableton.com/en/live-manual/12/, chapter 23, "Using Devices"
- [o2] forum reports on plug-in windows, **secondary**
- [o3] IFALPA position paper 25POS29, "Head-Up Display (HUD) and Vision Systems", 14 November 2025
- [a1] https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- [a2] https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- [a3] https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
- [a4] https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html

**Cost: $0.** No model and no key. The four designs were built and shot on Electron on a laptop,
from a local branch that was not pushed; the patch here is that branch's whole change.
