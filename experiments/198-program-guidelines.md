---
date: "2026-11-02"
scripts: "none; reading only"
summary: "Reading, not a measurement, built on 196's patterns. The makers agree: the caller names the data, a router places it (Plan 9, Android, Emacs); open or focus is one named step (Emacs, Vim, OTP, i3); the way back works because the move wrote down where you were (Emacs, Vim, tmux, i3, Android); commands as data give the shared pieces for nothing (VS Code, Linear, Ableton, a cockpit's soft keys); focus moves only on a press (WCAG, i3, the dark cockpit). Today's asks popup follows the last, and the frame, not the desk, picks a tile; no program can open one. New: tmux and i3 return focus to the tile focused before on a close, where today's close goes by reading order. Seven principles, G1 to G7, leans 65% to 85%. $0."
---

# 198. How should a fabrika program be built, and how do programs fit together?

Read 2026-11-02. **This is reading, not a measurement.** It feeds the note
[program guidelines](../docs/direction/program-guidelines.md) and a private page, "Program
guidelines", with a small fabrika window you can key and click through. It builds on
[experiment 196](./196-ask-desk.md) (the ask desk, round 2, on
[PR 326](https://github.com/usirin/tea-fabrika/pull/326), not merged yet), whose patterns P1 to P8
were found while one program, the asks, opened a tile for the first time. Here they become rules
for every program, each tested three ways, plus what the ask desk could not show.

The running example is the same: the top bar's asks popup, and `Enter` on it opening the asks
program in a tile, with the ticket beside it on a pipe.

## The answer

The makers agree on five things, and every one of them was already half true in fabrika.

- **The caller names the data or the job, never the window.** A router places it. Plan 9's sender
  names the data and a rule file picks the port [x3]; an Android caller sends an intent [x4]; Emacs
  runs a list of tries [x1]. Our [desktop layer](../docs/direction/the-desktop-layer.md) already
  says a process "never knows where its tile is", and
  [tracker views](../docs/direction/tracker-views-are-programs.md#8-the-views-the-facts-and-the-column)
  already proposes an `open` output the desk hears.
- **Open or focus is one named step, not code each program writes.** Look it up, else start it:
  Emacs's `display-buffer-reuse-window` [x1], Vim's `switchbuf=useopen` [x2], Android's
  `singleTask` [x4], OTP's `whereis` and `already_started` [o1], i3's criteria `focus` [k3].
- **The way back works because the step that moved you wrote down where you were.** Emacs keeps
  `quit-restore` [x1], Vim a jumplist [x2], tmux a stack of last panes [k5], i3 a focus stack [k6],
  Android a back stack [x4].
- **A program says its commands as data and gets the shared pieces for nothing.** VS Code's
  contribution points put a command in the palette and its key in the shortcuts list [x5]; Linear's
  command menu opens "pages or run actions" [l6]; Ableton's Key Map mode lights every control a key
  can take [f1]; a cockpit's soft keys ring the page they act on [f4].
- **Focus moves only when the person asks.** WCAG 3.2.1 and 3.2.5 [w2], i3's urgency hint in place
  of a stolen focus [k3], and the dark cockpit, where "all annunciators on the overhead panel will
  be extinguished" when all is well [f4].

Today's example follows the first and the last, and breaks the middle three:

- `Enter` on an ask asks nothing of the desk. The frame itself picks a tile: the one that shows the
  ticket, else the tracker turned to it, else nowhere
  (`apps/fabrika/src/window/frame.ts:365-374`). No program can open a tile with content today.
- Focus never moves on its own, which is right: a new ask is a count and a dot in the top bar.
- The asks list is the frame's menu, not a program (`apps/fabrika/src/window/frame.tsx:433`), so
  nothing else can reuse it, and its footer keys are a list typed by hand (`:421-426`).
- A closed tile gives focus to the next tile in reading order (`apps/fabrika/src/desk/desk.ts:415`).
  tmux and i3, our defaults for tiling, both give it to the tile focused before [k5][k6]. This is
  new: neither the tile guidelines nor experiment 196 read their source.

```text
how each tool opens, focuses and goes back
Emacs      display-buffer: reuse a window that shows it, else split; quit-window undoes what it did
Vim        switchbuf=useopen reuses a window; Ctrl-O and Ctrl-I walk the jumplist
Plan 9     the sender names the data; a running reader on the port gets it, else a rule starts one
Android    an intent; singleTop or singleTask reuses the screen; Back pops the stack
VS Code    commands as data; palette, menus and keys for free; a preview tab for a look
OTP        whereis, else start_child; a second start answers already_started with the pid
i3         [class=..] focus jumps to what is open; a new window splits beside; close: focus stack
tmux       split-window beside; last-pane goes back; kill-pane: the last pane, else layout order
Linear     one command menu for pages and actions; peek with Space is a look, the page is for real
Ableton    one set of tracks, two views; Key Map mode lights every mappable part; hot-swap, Esc back
Eurorack   a tiny shared standard: power, 3U height, 1 V per octave; any module patches to any
cockpit    the basic T: the same instrument in the same place; dark when fine; soft keys per page
fabrika    today: the frame picks a tile; a close goes by reading order; no program opens a tile
```

## What was read

Public docs and source, fetched 2026-11-02. A fetch tool returned the quotes; it cuts them at
about 125 characters, so some are clauses. A claim from a summary, a mirror or Wikipedia is marked
**secondary**; one found nowhere is a **guess**.

### Opening, focusing and going back

| Tag | Source | What it says for us |
|---|---|---|
| [x1] | Emacs Lisp manual, buffer display and quitting windows | `display-buffer-reuse-window` "tries to display buffer by finding a window that is already displaying it"; `display-buffer` "saves information about what it did in the window's quit-restore parameter". Open or focus is a list of tries, and the way back undoes only what the open did. The `pop-to-buffer` page did not load (**guess** that it also selects the window). |
| [x2] | Vim help, `jumplist` and `switchbuf` (a mirror, **secondary**) | "With the CTRL-O and CTRL-I command you can go to cursor positions before older jumps, and back again." `useopen`: "jump to the first open window in the current tab page that contains the specified buffer". Only big moves enter the list. |
| [x3] | Plan 9 `plumber(4)`, `plumb(6)`, and "Plumbing and other utilities" | "If none has it open, and the rule has a plumb client or plumb start rule, that rule is applied." "Most applications work fine in a plumbing environment without knowing about it at all." |
| [x4] | Android, tasks and the back stack | Activities sit "in a stack called the back stack in the order in which each activity is opened". `singleTop` routes a new intent to the instance on top "rather than creating a new instance". The trap: after `onNewIntent()`, "the user can't tap or gesture Back to return to the state of the activity before the new intent arrived". |
| [k2] | tmux manual | `last-pane`: "Select the last (previously selected) pane." The same for windows and sessions. |
| [k5] | tmux source, `window.c`, `window_lost_pane` | When the active pane goes, the new one is the front of `last_panes`, the pane active before; with none, the pane before it in the list, then the one after (our reading of the source). |
| [k3] | i3 user guide | `[class="urxvt" title="VIM"] focus`, "Get me to the next open VIM instance". "i3 will put the created window beside the existing window (on wide displays)". With `focus_on_window_activation smart`, a window out of view gets "the urgency hint" instead of focus. |
| [k6] | i3 source, `con.c`, `con_next_focused` | "Returns the container which will be focused next when the given container is not available anymore." It walks the parent's focus stack (`focus_head`). |
| [o1] | Erlang/OTP, `erlang:register/2`, `whereis/1`, `supervisor`, `gen_server` | A name in a registry; a second start returns `{error,{already_started,Child}}`, so the caller gets a pid either way. Look-up then start in two steps can race, which is why the start does both. |

### Programs, commands and shared pieces

| Tag | Source | What it says for us |
|---|---|---|
| [x5] | VS Code, contribution points and `when` clauses | "By default, commands show in the Command Palette". "Contributing a key binding will cause the Default Keyboard Shortcuts to display your rule". A preview tab "reuses an existing tab". `workbench.editor.revealIfOpen` is named in a pull request, not found in the docs (**secondary**). |
| [x6] | The Art of Unix Programming, chapter 1 (a mirror) | "Write programs that do one thing and do it well." "Write programs to work together." "Rule of Composition: Design programs to be connected with other programs." |
| [e2] | Elm guide, web apps, structure | "Actively trying to make components is a recipe for disaster in Elm." "Just write the helper functions you need." "all modules should be built around a central type." |
| [l6] | Linear, navigating Linear | "Use the command menu to open pages or run actions without leaving your keyboard." The peek page returned 404; from a search summary (**secondary**), Space opens and closes a peek from a list or board. |
| [m1] | Linear Method, introduction | "Your tools should not make you the designer and maintainer of them." |
| [m8] | How we redesigned the Linear UI (from 196) | They defined "the behaviors of the main components of the app" once. |
| [h1] | Apple HIG, panels and keyboards (the JSON behind the pages) | A panel offers "supplementary controls, options, or information related to the active window or current selection". "people generally expect to rely on the standard keyboard shortcuts that work in other apps". |
| [w2] | WCAG 2.2 | 3.2.1: focus "does not initiate a change of context". 3.2.3 and 3.2.4: the same parts "occur in the same relative order" and are "identified consistently". 2.4.11: a focused part "is not entirely hidden". 4.1.3 and 2.4.3 as in 196. |
| [w3] | ARIA APG, developing a keyboard interface | "manage events that effect the currently active element so focus remains visible and moves logically". "the tab sequence should include only one focusable element of a composite UI component." |
| [w4] | ARIA APG, dialog (from 196) | "When a dialog closes, focus returns to the element that invoked the dialog". |
| [w5] | MDN, `aria-keyshortcuts` (from 196) | It only names the key; the handler is still ours. |

### Outside software

| Tag | Source | Teaches | Does not carry over |
|---|---|---|---|
| [f1] | Ableton Live 12 manual: racks, key and MIDI mapping, Live concepts | "The Session and Arrangement share the same set of tracks": one model, two views. "assignable elements of the interface become highlighted in red when you enter Key Map Mode": every part that takes a key is shown at once. Hot-swap is a mode you leave with Esc, back where you were. A rack's title bar folds in place. | A device chain is one fixed signal path. Our handoffs are not always a line. |
| [f2] | Doepfer A-100, technical details | A tiny shared standard lets any maker's module patch into any other: "+12V and -12V", "Module front panels are all 3U high", width in HP, "1 volt" per "one octave". A module picks its width; the height is fixed. | A patch is not type checked: a wrong cable just sounds wrong. Nothing about focus or getting back. |
| [f3] | DaVinci Resolve product page (manual text did not load; **secondary** for the seven pages) | One project, a page per task (Media, Cut, Edit, Fusion, Color, Fairlight, Deliver), "a single click to switch between tasks". Premiere's docked panels did not load (**guess**). | Each page fills the screen. A desk shows several tools at once. |
| [f4] | NASA NTRS, "Douglas flight deck design philosophy"; Wikipedia on flight instruments and MFDs (**secondary**) | Dark cockpit: lights only for what needs the crew. The basic T puts each instrument in the same place in every aircraft. An MFD's soft keys ring the screen and change with its page. | A cockpit is certified and fixed. A desk lets the person move tiles. |

A kitchen brigade (one station per job, one checked pass) was read on a school blog and is too weak
a source to lean on. It is not used.

### Where the makers clash

- **How deep the way back goes.** tmux keeps a last pane, i3 a focus stack [k5][k6]; Vim and Android
  keep a full list [x2][x4]; Emacs keeps a history per window [x1].
- **Reuse loses state.** Android warns that a reused screen cannot go back to its old state [x4];
  Vim and Emacs reuse freely and let the jumplist remember [x1][x2].
- **Who picks the place.** The caller (an Android flag), the person's settings (Emacs
  `display-buffer-alist`, Vim `switchbuf`, VS Code's setting), or the window manager's fixed rule
  (i3). fabrika's desk is the last kind, with the person's keys over it.
- **Shared pieces: stateful parts or helpers.** VS Code and Ableton hand out parts that keep their
  own state; Elm says write helpers around a type [e2]. Our
  [Elm first](../docs/direction/elm-first.md) and its "UI state lives in tea machines" pick Elm's.

## What is settled, and what this builds on

| Point | Status | Where |
|---|---|---|
| A process sends its view and never knows where its tile is; a tile shows one process | decided 2026-10-31 | [the desktop layer](../docs/direction/the-desktop-layer.md), W3 and W4 |
| Every command also has a tsh word and a palette entry | decided, 85% | the desktop layer, W5 |
| A line opens in place, by the split rule; past 220 by 120 the rest fold | decided 2026-10-28 | [fold, not tabs](../docs/direction/fold-not-tabs.md#a-line-opens-in-place) |
| Closing a window ends its one process; neighbors follow the pipe rules | decided 2026-10-25 | fold, not tabs |
| A program declares its keys and modes beside its commands; tile keys only while focused | decided 2026-11-01 | [keybindings](../docs/direction/keybindings-are-configurable.md#keys-and-modes-come-from-programs-not-packs) |
| A program gets `commands` and `mode(state)`; Escape leaves every mode | decided 2026-11-01 | [modes](../docs/direction/modes.md) |
| Closed or folded tile: focus to the next open tile in reading order; `C-b ;` for the tile focused before, a fact stored from the first build | decided 2026-11-01 | [tile guidelines](../docs/direction/tile-guidelines.md#a-tile-is-a-region) |
| A popover closes and focus goes back where it was; today it "never opens a new tile" | settled 2026-10-30 | [popovers](../docs/direction/popovers.md) |
| Parents step children by hand; UI state lives in tea machines; a program may refuse | decided | [Elm first](../docs/direction/elm-first.md) |
| The box decides what crosses, never the program | decided 2026-10-24 | [programs run in a box](../docs/direction/programs-run-in-a-box.md) |
| Saved state and hot reload for every program, in `next/` | decided 2026-11-01 | [saved state](../docs/direction/saved-state.md), [hot reload](../docs/direction/hot-reload.md) |
| A view moves inside its tile with `query` (the note's `navigate`); across tiles it asks with `open`, the desk places it | proposed 2026-10-28 | [tracker views](../docs/direction/tracker-views-are-programs.md#8-the-views-the-facts-and-the-column) |
| A program is flags, inputs, outputs, machines and `main` | proposed | [tea-program](../docs/direction/tea-program.md) |
| An agent is a program; a run gets its id, trace, kept session and a job | proposed 2026-10-30 | [agents are programs](../docs/direction/agents-are-programs.md) |
| Packs are programs in a package | proposed | [packs are programs](../docs/direction/packs-are-programs.md) |
| Each tile keeps its own back and forward; a program says where it is, like a URL | open, tracker ticket 7 | the tracker |
| Programs live in `programs/`, not in the SDK; the SDK holds the tools | open, tracker ticket 93 | the tracker |
| P1 to P8 | proposed 2026-11-02, on PR 326 | [196, patterns found](./196-ask-desk.md#patterns-found) |

Untouched by anyone: a location for every program, who may open a tile and when, what counts as
"the same tile", and the list of what a program gets for free.

## Today's asks popup and `Enter`

Read on main at `0be502bc`. Today's version only.

| What | Today | Where |
|---|---|---|
| The program shape | name, description, flags, inputs, outputs, machines, a view, `main`; the ticket takes `--ticket`, an input `ticket` and sends `ticket` | `programs/ticket/src/index.ts:62-97` |
| Programs together | `tracker \| ticket \| runs`, typed and checked before they run | fold, not tabs; `programs/ticket/src/index.ts:23` |
| The asks list | a menu in the frame, not a program; "You answer in the ticket's own tile, never here" | `apps/fabrika/src/window/frame.tsx:428-433` |
| `Enter` on an ask | the tile that shows its ticket, else the tracker turned to it by `query`, else "no tile shows #N · the tracker opens it" | `frame.ts:365-379`, `frame.tsx:443-457` |
| Focus a tile | `go`: its workspace comes forward, a zoom ends | `apps/fabrika/src/desk/desk.ts:548-556` |
| A new tile with content | no Msg for it: a tile gets a view only from a tsh line (`covered`) | `desk.ts:160-197` |
| A closed tile | focus to the next open tile in reading order, else the one before | `desk.ts:415-420` |
| The way back | `C-b ;` not built; the key is free | `apps/fabrika/src/desk/keys.ts:80-113` |
| The popup's keys | a footer typed by hand: Move, Open, Later, Close | `frame.tsx:421-426` |
| The palette | the desk's commands only, grouped Tile, Focus, Workspace, Window | `frame.tsx:968-973` |
| A new ask | a count and a dot in the top bar, named "N not seen"; focus stays | `frame.tsx:191,268` |

The same case, against each principle of the note:

| Principle | Today |
|---|---|
| G1 one job, one model, every size draws it | **Breaks.** Two codes draw an ask: the frame's menu and the ticket's ask box. The menu cannot answer. |
| G2 a program says where it is; the desk says where its tile is | **Half.** The tracker takes a `query`, a location in all but name; `next/` calls it `navigate`. But the frame picks the tile, and the asks list has no location. |
| G3 open or focus, then land beside | **Half.** The focus half exists (`go`, and the tile that shows the ticket). The open half answers "nowhere". |
| G4 only on a press; focus and selection travel together; say it once | **Half.** Only a press moves focus, and a new ask never steals it. But no selection travels, and `go` is not said. |
| G5 the way back is one key | **Half.** A popover puts focus back. Between tiles there is no `C-b ;`, and a close goes by reading order. |
| G6 programs meet on typed pipes | **Follows** for `tracker \| ticket \| runs`. The asks list is on no pipe. |
| G7 what every program gets for free | **Half.** Every tile gets its frame and name. Its commands do not reach the palette, and no button is made from them. |

## What this tells us for fabrika

- **Give every program a location, now, in `next/`.** It is the one new field, `location`. Open,
  back, saved state, the palette and a link all need it, and ticket 7 already asks for it.
- **The desk is the router and the registry.** A program asks with `open`; the desk answers
  `opened` (with `how: "new"` or `how: "focused"`) or `refused`, in words. This is Plan 9's plumber
  and OTP's `whereis` on our pieces, and it keeps the box rule: the program asks, the app decides.
- **An open is a line the person could have typed.** So a tsh line and a program's `open` share one
  fit check and one placement rule.
- **Write down where the person was, at the moment they move.** `from` on an open, and the focus
  history, exist only then. Every way back the owner might pick needs one of them.
- **The P4 clash is wider than 196 saw.** Our declared defaults, tmux and i3, both return focus to
  the tile focused before on a close. The decided rule, reading order, does not. A third branch,
  focus history, gives the opener back in the common case with no rule per program. It is the owner's call, since
  it reopens a decided rule.
- **Linear clashes once.** Linear opens a look as a peek over the list; tmux and i3 split. The note
  keeps the split for work and leaves the popover glance for a look, and names it for the owner.

## What the demo showed

The page's demo was pressed by a script in headless Chromium: open the asks from t1, then close the
asks tile, in each layout, window size and way back. Every row came out the same at 1440x900 and at
1024x700.

| Layout | What folds on open | Close: A opener | B reading order | C focus history |
|---|---|---|---|---|
| One tile | nothing | t1 | t6, the ticket | t1 |
| Side by side | the ticket | t1 | t2, the next tile | t1 |
| Stacked | nothing | t1 | t6, the ticket | t1 |
| 2x2 | the ticket | t1 | t2, the next tile | t1 |

- **B never gives the opener back** in this case. The line opens after the opener, so the next tile
  in reading order is the ticket, or the tile after the line. A and C agree everywhere here.
- **A guess that was wrong.** The note's first draft said that in a row where the opener is the last
  tile, B and A already agree. They do not: the line itself comes after the opener.
- **Where a fold's space goes matters.** The demo's first draft gave a folded tile's space to the
  whole row. Side by side at 1440x900, that left the asks tile under 220px after the ticket folded, so
  the unrelated t2 folded too. Giving the space to the open tile before it folds only the ticket.
  The note now says so (G3, R4).
- **Open or focus held:** a second open with another tile zoomed ended the zoom, focused the same
  asks tile and made no new tile. A new ask raised the count to 4 with the dot, and focus stayed.

## What it cannot tell us

- **Nothing ran in the app.** The page's demo is a sketch of the desk in a browser page. Its checks
  prove the drawing, not `desk.ts`.
- **No screen reader ran.** What a focus move and a polite status say together, and in which
  order, needs VoiceOver on Electron and NVDA on a browser tab.
- **How the way back feels.** Three branches are on paper. Only a week of use says which one a
  person expects after answering asks.
- **What "the same tile" means for real programs.** One asks tile per workspace is clear. Two
  tickets side by side may want two. No program but the asks was walked.
- **tmux's and i3's close rules are read from source,** by a fetch tool's summary, not run.
- **Linear's logged-in app was not seen,** and its peek page returned 404.
- **`next/` has no desk yet.** It arrives in Tier 2; every `next/` claim is a sketch on the
  decided notes.

## Dollars

$0. No model was called. The reading ran through a fetch tool in one agent session. The page's
checks ran in headless Chromium on the laptop, under `nice`.

## Links

- [x1] https://www.gnu.org/software/emacs/manual/html_node/elisp/Buffer-Display-Action-Functions.html,
  https://www.gnu.org/software/emacs/manual/html_node/elisp/Quitting-Windows.html
- [x2] https://vimhelp.org/motion.txt.html, https://jsr.io/@denops/std/doc/option/~/switchbuf
- [x3] https://9p.io/magic/man2html/4/plumber, https://9p.io/magic/man2html/6/plumb,
  https://9p.io/sys/doc/plumb.html
- [x4] https://developer.android.com/guide/components/activities/tasks-and-back-stack
- [x5] https://code.visualstudio.com/api/references/contribution-points,
  https://code.visualstudio.com/api/references/when-clause-contexts,
  https://code.visualstudio.com/docs/getstarted/userinterface,
  https://github.com/microsoft/vscode/pull/134478
- [x6] https://cscie2x.dce.harvard.edu/hw/ch01s06.html
- [k2] https://man7.org/linux/man-pages/man1/tmux.1.html
- [k3] https://i3wm.org/docs/userguide.html
- [k5] https://github.com/tmux/tmux/blob/master/window.c
- [k6] https://github.com/i3/i3/blob/next/src/con.c
- [o1] https://www.erlang.org/doc/apps/erts/erlang.html,
  https://www.erlang.org/doc/apps/stdlib/supervisor.html,
  https://www.erlang.org/doc/apps/stdlib/gen_server.html
- [e2] https://guide.elm-lang.org/webapps/structure.html
- [l6] https://linear.app/enablement/guide/navigating-linear
- [m1] https://linear.app/method/introduction
- [m8] https://linear.app/now/how-we-redesigned-the-linear-ui
- [h1] https://developer.apple.com/tutorials/data/design/human-interface-guidelines/panels.json,
  https://developer.apple.com/tutorials/data/design/human-interface-guidelines/keyboards.json
- [w2] https://www.w3.org/TR/WCAG22/
- [w3] https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/
- [w4] https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- [w5] https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-keyshortcuts
- [f1] https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/,
  https://www.ableton.com/en/live-manual/12/midi-and-key-remote-control/,
  https://www.ableton.com/en/live-manual/12/live-concepts/
- [f2] https://www.doepfer.de/a100_man/a100t_e.htm, https://www.doepfer.de/a100_man/a100m_e.htm
- [f3] https://www.blackmagicdesign.com/products/davinciresolve
- [f4] https://ntrs.nasa.gov/citations/19910001626, https://en.wikipedia.org/wiki/Flight_instruments,
  https://en.wikipedia.org/wiki/Multi-function_display
