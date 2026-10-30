# Naming sweep: the app, the programs, the packs

**Proposed.** Part of [the naming sweep](./README.md), which holds the status,
the marks, every pick and the open list. This file holds the rows for
`apps/fabrika`, `programs/*` and `packs/*`: 274 rows, one `##` per module. A
row marked **picked 2026-10-28** is the owner's pick and is not proposed
again. A row marked **open (#32)** is a word the owner still holds: it gets a
row and no pick. A confidence under 80% is a lean.

## The ten worst

1. **`Shown`** is exported four times with four shapes (layout, counter,
   tracker, ticket). Each program's view data -> `View`.
2. **Two desks.** The app's `Desk` / `DeskMsg` / desk machine and
   owner-desk's have the same names and different shapes. Rename the pack to
   an inbox.
3. **window / view.** `defineProgram` says `view`, but every program says "It
   has a window", `ToWindow`, `windows.tsx`. And owner-desk's `view` setting
   is an output format.
4. **`attach`** is tsh's `attach %n` (decided 2026-10-28: a tile attaches)
   and also the app reaching the host. The app's -> `connect`.
5. **`wire.ts`** is socket framing, not the picked pipe. -> `transport`,
   MCP's word. Do not rename it to pipe.
6. **step vs stage.** The tracker's nine "steps" are the pipeline's stages
   (`Head` says `stage` for the same thing), and `Step` is also every
   machine's `[state, cmds]`.
7. **`fold`**, picked 2026-10-28 for the desk (fold per tile, double-click a
   title bar) and for reading the ledger into state. The tracker re-exports
   the ledger's `fold`; both now mean the picked ideas, so only the old
   pipeline's "ticket joins a plan" fold is left, and it is rebuilt.
8. **`Head`** (a ticket's top line) clashes with a PR's head commit. ->
   `Status`, Linear's word.
9. **`TSH`, `Edge`, `Key`, `Heard`, `Page`, `Row`, `Plan`, `Opened`** are
   each exported twice or more in this area with different shapes.
10. **`answer` and `over`** carry four or five meanings each: an owner's
    answer, the host's reply to a key, serving a file, a probe's results, a
    pack's outputs; ended, the end state, and "drawn on top".

## Sources used again and again

Written once here, and named by site in the rows.

- tmux: [tmux(1) manual](https://man7.org/linux/man-pages/man1/tmux.1.html) (pane, window, session, client, server, prefix, `send-prefix`, `confirm-before`, `kill-pane`, `repeat-time`, `bind-key -r`, `next-layout`, `resize-pane -Z`, `attach-session`, `send-keys`, status line).
- i3: [i3 user guide](https://i3wm.org/docs/userguide.html) (container, split container, splith/splitv, stacking, tabbed, `layout toggle`, `fullscreen toggle`, workspace, focus).
- AeroSpace: [AeroSpace guide](https://nikitabobko.github.io/AeroSpace/guide) (every non-leaf node is a "container"; `tiles` and `accordion` layouts; orientation `horizontal` / `vertical`).
- WezTerm: [WezTerm, multiplexing](https://wezterm.org/multiplexing.html) and [Pane](https://wezterm.org/config/lua/pane/index.html) (pane, tab, window, workspace, mux server, domain, attach).
- bash: [Bash manual, job control basics](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html) (job, `%n`, foreground, background, `fg`, `bg`, `jobs`).
- readline: [GNU Readline, bindable commands](https://tiswww.case.edu/php/chet/readline/readline.html#Bindable-Readline-Commands).
- Electron: [process model](https://www.electronjs.org/docs/latest/tutorial/process-model) (main, renderer, preload), [MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports), [`shell.openExternal`](https://www.electronjs.org/docs/latest/api/shell#shellopenexternalurl-options).
- Elm: [Elm guide, architecture](https://guide.elm-lang.org/architecture/) (Model, Msg, update, view), [flags](https://guide.elm-lang.org/interop/flags.html).
- Linear: [creating issues](https://linear.app/docs/creating-issues) (`C`, "Create new issue", an issue's "properties"), [inbox](https://linear.app/docs/inbox), [filters](https://linear.app/docs/filters).
- GitHub: [REST, issues](https://docs.github.com/en/rest/issues/issues), [timeline events](https://docs.github.com/en/rest/issues/timeline), [`gh issue`](https://cli.github.com/manual/gh_issue).

## 1. The desk machine (`apps/fabrika/src/desk/desk.ts`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| desk / `Desk` / `deskMachine` | the one window's tiles, workspaces, prefix and question, as a tea machine in the host | tmux's server-side session state; i3's tree (i3 guide, "tree"); WezTerm's mux. No tool says "desk" | two-ideas | also the owner-desk pack's `Desk`, `DeskMsg`, `desk` machine (section 13), the port name `"desk"`, `desk.tsx`, `files.ts` `DESK` (a URL), and "a person's desk" in `host/move.ts`. Lean: keep "desk" for the app, rename the pack (section 13). 65%: settled by asking which one a reader meets first |
| `Workspace` | a layout and its focused tile; Ctrl-B N makes one | workspace (i3 guide, 2.6; AeroSpace guide) | ok | |
| `Workspace.id` / `.layout` / `.focused` | `w1`, its tree, the tile with focus | `focus` (i3 guide, 6.4); tmux "active pane" | ok | |
| `Prefix` / `Prefix.armed` / `.until` | the Ctrl-B key state; `until` the repeat window's deadline | prefix key; `client_prefix` "1 if prefix key has been pressed" (tmux manual, FORMATS) | ok | |
| `Open` (desk state) | the desk while it has tiles | none needed | two-ideas | `open` is also a desk Cmd, a tracker Msg, a ticket's state and a Show value. Lean `Live` 50%: low cost, only a local type |
| `Desk.at: "open" \| "over"` | the desk's state tag | the tag key (open #32) | two-ideas | **open (#32)**: in the same file `DeskMsg.key.at` is a time in ms, so `at` is a tag and a timestamp side by side |
| `Open.active` | the active workspace's id | focused workspace (i3); active window (tmux) | ok | |
| `Open.ask` | the tile asking y or n, or none | tmux `confirm-before` prompt | two-ideas | **open (#32)**, `ask`. Inside the desk it is also called a "question" (`questionOf`), so `ask` / question is two words here too |
| `questionOf` | the prompt text: `close t2? (y/n)`, `stop t2 now? (y/n)` | `confirm-before -p` prompt (tmux manual) | two-words | with `Open.ask`; `promptOf` would match tmux. 60% |
| `Open.running` | jobs running per tile | `jobs -r` count (bash) | ok | |
| `Open.closing` | tiles whose programs were given end of input, waiting for them to end | none standard; a hung-up session draining | ok | |
| `Open.next` | the counter every `t<n>`, `s<n>`, `w<n>` id comes from | WezTerm's ids from one counter (see `docs/direction/the-host-keeps-terminals-and-jobs.md`) | ok | |
| id prefix `s<n>` | a stack's id | follows the container pick | differs | **follows the pick 2026-10-28** (stack -> container): the desk fold branch still mints `s1` for a container. `c<n>` |
| `DeskMsg` | the desk's Msgs | Msg (Elm guide) | ok | |
| `DeskMsg` `key` (`key`, `at`) | a key and when it was pressed | keydown | ok | `at` is a time here, a tag elsewhere (row above) |
| `DeskMsg` `click` (`tile`) | a tile was clicked | click to focus (tmux `mouse` option) | ok | |
| `DeskMsg` `resize` (`stack`, `sizes`) | a border was dragged | `resize-pane` (tmux) | ok | `stack` follows the container pick: `container` |
| `DeskMsg` `covered` (`tile`, `run`) | a process with a view is in a tile's foreground | foreground job (bash) | differs | `foreground`, bash's own word, which `Placed` already uses. 65%. `run` follows **picked 2026-10-28**: `process` / pid |
| `DeskMsg` `over` (`run`) | a process with a view ended | job done (bash `jobs`: "Done") | two-ideas | `over` is also the desk's end state, the tracker's `over` predicate and `linkView`'s `{kind: "over"}` (drawn over the desk). `ended`, as tsh says. 65% |
| `DeskMsg` `jobs` (`tile`, `running`) | how many jobs run in a tile | `jobs` (bash) | ok | |
| `DeskMsg` `closing` | said by nobody since the desk moved to the host | none | differs | delete it; dead word. 85% |
| `DeskMsg` `ended` (`tile`) | a tile's tsh ended | the shell exited (tmux `pane-exited` hook) | ok | |
| `TileIdSchema` | `t` and a number | pane id `%n` (tmux) | ok | |
| `Saved` / `save` / `savedOf` / `restore` / `desk.json` | the desk kept between host starts | save and restore (tmux-resurrect's words, [tmux-resurrect](https://github.com/tmux-plugins/tmux-resurrect)) | ok | |
| `DeskSchema` | the desk as sent to a page | none needed | ok | |
| `Takes` / `takes.all` / `takes.keys` | which keys the desk takes now | a key table (tmux `-T` key tables) | two-words | `takes` and `claims` (and `takenNow`) name one idea. Pick `takes`. 70%. `claim` is also the ledger's lease |
| `takenNow` / `claims` | does the desk take this key now | as above | two-words | `claims` -> `takes(s, key, at)`. 70% |
| Cmd `open` (`tile`) | start a tile's tsh, or show the one that runs | `split-window` / `new-window` start a shell (tmux) | two-ideas | after `the-host-keeps-terminals-and-jobs.md` (decided 2026-10-28) a tile attaches to a terminal: `attach`. 60% (would `attach` clash with tsh's `attach %n`? see section 6) |
| Cmd `close` (`tile`) | give the tile's tsh and programs the end of their inputs, softly | hangup, SIGHUP (POSIX `kill -HUP`); tmux has no soft close | two-ideas | `close` is also the editor's Cmd, the link's `Down` `close` (the window) and the tracker's ticket write. `hangup`. 55% |
| Cmd `stop` (`tile`) | the tile is gone: stop what still runs | `kill-pane` (tmux) | differs | `kill`, tmux's word. 60%: "stop" is plainer, and Effect says interrupt |
| Cmd `send` (`tile`, `data`) | bytes for the tile's tsh, as if typed | `send-keys` (tmux) | differs | `send_keys`. 70% |
| Cmd `save` (`desk`) | keep the desk for the next start | save (tmux-resurrect) | ok | |
| Cmd `empty` | the last tile closed; the window closes | Electron `window-all-closed` ([app events](https://www.electronjs.org/docs/latest/api/app#event-window-all-closed)) | two-words | the link says the same thing as `Down` `close`. One word: `close_window`. 60% |
| `fresh` | a new desk: one workspace, one tile | none | two-ideas | the editor exports `fresh` too, for a new editor. Both local; ok to keep. 50% |
| `tilesOf` / `activeOf` / `whereIs` / `focusedOf` | lookups | none needed | ok | |
| `Routed` (`kind: "desk" \| "tile"`) / `route` | where a key goes | key dispatch | ok | |
| `yes` / `goneTile` / `busy` / `closingNow` | local helpers | none | ok | |
| status line text: workspace numbers, `t2 · 1 running`, the prefix | what the footer shows | status line (tmux manual, STATUS LINE) | ok | `running` shows jobs; "jobs" would match bash `jobs`. 55% |
| on-screen `close t2? (y/n)` / `stop t2 now? (y/n)` | the question a tile shows | tmux's own `kill-pane #P? (y/n)` | ok | |
| on-screen `closing` (tile label and empty desk) | a tile waiting for its programs to end | none | ok | |

## 2. The layout tree (`apps/fabrika/src/desk/layout/`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `LayoutTree` / `.root` / `.zoomed` | the tree, its root, the tile drawn alone | the tree (i3 guide, section 3); zoom (`resize-pane -Z`, tmux) | ok | |
| `LayoutNode` | a tile or a stack | node (AeroSpace guide: "node") | ok | |
| `TileNode` / `createTile` / `isTileNode` / `TileId` | the leaf | pane (tmux, WezTerm); window (i3); "tile" is AeroSpace's layout word | ok | kept: the app's own word since 2026-10-25, and Tuval's "window" was the clash |
| `StackNode` / `SplitStack` / `StackId` / `createStack` / `isStackNode` / `findStack` | an inner node | container (i3, AeroSpace) | differs | **picked 2026-10-28:** container (`ContainerNode`, `ContainerId`, `createContainer`) |
| `TabbedStack` / `createTabbed` / `findTab` / `reveal` / `Tabbed` (desk.tsx) / `active` | the tabbed stack | tabbed layout (i3) | differs | **picked 2026-10-28:** tabbed is removed |
| `Orientation` / `Axis` | `horizontal`, `vertical` (and `tabbed`) | orientation (AeroSpace); splith / splitv (i3) | two-words | **picked 2026-10-28:** `Orientation = "horizontal" \| "vertical"`; `Axis` folds into it |
| `turned` / `turn` / `Does.turn` / Space | turn a stack: tabbed, horizontal, vertical | `layout toggle split` (i3 guide, 6.3); `next-layout` (tmux) | differs | with tabbed gone it swaps two orientations: `toggle`, i3's word. 60%. The fold branch adds `across` for the other orientation |
| fold / `folded` (on the desk fold branch) | a tile drawn as a thin strip in its own place | window shading, `_NET_WM_STATE_SHADED` ([EWMH](https://specifications.freedesktop.org/wm-spec/latest/)); AeroSpace's `accordion` shows the others as thin edges | collides | **picked 2026-10-28:** fold per tile: double-click a title bar folds that tile. `fold` also stays for reading the ledger into state (a left fold), as the tracker's re-exported `fold` does; the two are kept on purpose |
| `Direction` (`left`, `right`, `up`, `down`) | focus moves | `focus left` (i3) | ok | |
| `Edge` (`start`, `end`) | which end a descent enters | none needed | two-ideas | `tiles.ts` exports another `Edge` (the ports to the page). Rename that one (section 5) |
| `Shows` (`kind: "tsh"`, `run`) / `setShows` / `isShows` | what a tile shows | a pane shows a terminal (WezTerm); since #175 a tile shows a terminal or a job's window | differs | `kind` has one value. After `the-host-keeps-terminals-and-jobs.md`: `shows: TerminalId`, with the front job the terminal's. 60% |
| `Shown` (`id`, `program`) | a process with a view, in a tile | none | collides | three other exported `Shown`s mean a program's view data (counter, tracker, ticket). And `id` follows **picked 2026-10-28** (run -> process): `pid`. Lean: drop the type with `Shows` above. 60% |
| `TSH` (layout) | a tile with nothing over it | none | two-ideas | `tsh.ts` exports another `TSH`, tsh's own pid `"tsh:p1"`. One of them moves: layout's -> `BARE`. 65% |
| `sizes` / `resolveSizes` / `SIZE_TOLERANCE` | children's share, in percent | `resize set N ppt` (i3) | ok | |
| `split` / `SplitIds` | split a tile | `split-window` (tmux), `split` (i3) | ok | |
| `remove` / `resize` / `zoom` / `unzoom` | tree changes | tmux's `kill-pane`, `resize-pane`, `-Z` | ok | |
| `find` / `findTile` / `findChildTile` / `findSibling` / `tiles` | lookups | none needed | ok | |
| `Arrangement` / `arrange` / `show` | what an arrange changes | layout (i3) | ok | `show` goes with tabbed |
| `layoutSignature` | the tree's shape as a string | none | ok | |
| `checkTree` / `Violation` / `invariants.ts` | the tree's laws | invariant | ok | the repo calls them laws (`every-machine-has-laws.md`); fine |
| `node.tag: "tile" \| "stack"` | the node's tag | the tag key (open #32) | two-words | **open (#32)**: one more tag key, `tag` |

## 3. Keys and the key holder (`desk/keys.ts`, `desk/hold.ts`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `PREFIX` | `<c-b>` | prefix (tmux) | ok | |
| `REPEAT_MS` | how long a repeatable key keeps the prefix armed | `repeat-time` (tmux) | ok | |
| `Binding` / `BINDINGS` / `bindingOf` / `repeats` | a key after the prefix and what it does | `bind-key -r` (tmux); `bindsym` (i3) | ok | |
| `Does` | what a binding does | a command (tmux, i3) | differs | `Action`. 55%: `Command` is taken twice (readline's in `editor/keys.ts`, `effect/cli` in `cli.ts`) |
| `Does.kind: split, focus, turn, tab, zoom, close, new, step` | the actions | `split-window`, `select-pane`, `next-layout`, `resize-pane -Z`, `kill-pane`, `new-window`, `next-window` (tmux) | differs | `step` -> `workspace` (`to: next \| previous`), as i3's `workspace next`. 60%. `tab` goes with tabbed (picked). `turn` above |
| `Press` (keys.ts: `key, ctrl, alt, meta`) | a key event | `KeyboardEvent` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent)) | two-words | hold.ts has `KeyPress`, the same shape as a schema. One name: `KeyPress`. 75%. `press` is also hold's Cmd and counter's input |
| `keyName` / `<c-b>`, `<arrowleft>` | a key's one spelling | Vim key notation (`:help key-notation`, [Vim docs](https://vimhelp.org/intro.txt.html#key-notation)) | ok | |
| `Hold` / `holdMachine` | the page's key holder while the host decides | none standard; type-ahead buffer | ok | |
| `Hold.takes`, `.waiting`, `.held`, `.next`, `.up` | its state | none needed | ok | |
| `Key` (hold.ts: `name`, `press`) | a named key press | none | two-ideas | `editor/keys.ts` exports another `Key` (`text \| command \| unknown`). Hold's -> `NamedKey`. 60% |
| `HoldMsg` `takes`, `key`, `answer`, `down` | its Msgs | none needed | two-ideas | `answer` also means the owner's answer (tracker, owner-desk). Here it is the host's reply to a press: `reply`. 55% |
| Cmd `press` (`id`, `key`) | send a key to the host | none | two-ideas | see `Press` |
| Cmd `pass` (`key`, `held`) | the key goes on to the tile | event passthrough | ok | |

## 4. The page and its messages (`messages.ts`, `bridge.ts`, `preload.ts`, `files.ts`, `outside.ts`, `window/`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| page | the renderer document | renderer (Electron process model) | two-ideas | also the tracker's `Page`, the ticket's `Page` and owner-desk's `Page` (a screen of a program's view). Lean: "page" for the renderer is fine in prose; rename the view types (sections 9, 11, 13). 55% |
| `ToTerminal` / `FromTerminal` (`write`, `keys`, `size`) | a tile's terminal port | pty write, input, resize (xterm.js `onData`, `resize`; [xterm.js API](https://xtermjs.org/docs/api/terminal/classes/terminal/)) | ok | |
| `ToWindow` / `FromWindow` (`view`, `msg`) | a process's view port | a view (Elm) | two-words | "window" here is a program's view; `defineProgram` says `view`. `ToView` / `FromView`. 75% |
| `ToPage` (`keys`, `desk`, `answer`, `link`) | what the host tells the page | none needed | ok | `answer` as in `HoldMsg` |
| `ToApp` (`again`, `restart`) | what the page tells main | none | ok | |
| `FromPage` (`press`, `click`, `resize`) | what the page tells the host | none needed | ok | `resize.stack` follows container |
| `Found` (`up`, `version`, `build`) / `Lost` (`reconnecting`, `stopped`, `restarting`) / `LinkNow` / `Attached` | what the window shows of the link | connection state | ok | |
| `theirs` / `ours` | the other side's and our version | ours / theirs (git merge, [git checkout](https://git-scm.com/docs/git-checkout#Documentation/git-checkout.txt---ours)) | ok | |
| `Read` (`read`, `refused`) / `reader` / `readFrom*` / `readTo*` | a strict reader | decode result | two-words | `tsh.ts` `Heard` is the same union. One: `Read`. 70% |
| port names `desk`, `tile:t1`, `run:counter:1a2b` | one MessagePort each | MessagePort (Electron) | ok | `run:` follows **picked 2026-10-28**: `process:<pid>` |
| `Bridge` / `send` / `onMessage` / `forget` / `PORT_CHANNEL` / `isPortName` | what the preload gives the page | `contextBridge` ([Electron](https://www.electronjs.org/docs/latest/api/context-bridge)) | ok | |
| `SCHEME` / `CSP` / `DESK_CSP` / `FILES` / `Served` / `isOurs` / `fileOf` / `isDesk` | the app's own scheme | `protocol.handle` ([Electron](https://www.electronjs.org/docs/latest/api/protocol)) | ok | |
| `DESK` (files.ts) | the desk page's URL | none | two-ideas | five `desk`s (section 1). `DESK_URL`. 75% |
| `answer` (files.ts) | serve one request | respond (`protocol.handle` returns a Response) | two-ideas | `answer` is an owner's answer elsewhere. `respond`. 70% |
| `Outside` / `Outward` (`open`, `refused`) / `outsideOf` / `openOutside` / `NotOpened` / `Browser` | a URL handed to the person's browser | `shell.openExternal` (Electron); "open external links" (Electron security checklist) | differs | `External`, `openExternal`, as Electron says. 70% |
| `window/` folder, `desk.tsx`, `windows.tsx` | the renderer's code; the list of program views | renderer; views | two-ideas | "window" is the OS window, a program's view and this folder. `windows.tsx` -> `views.tsx`. 70% |
| `linkView` (`instead`, `over`) | how the link changes what is drawn | overlay | two-ideas | `over` is "ended" elsewhere. `overlay`. 70% |
| on-screen "The host runs older code", "Not attached to the host", "Stopping the old host…", "Try again", "Connecting / Reconnecting to the host…" | the link's words | reconnecting banner | ok | |
| on-screen "no view for X in this app", aria `X view`, `tile t1, counter, closing`, `t1 screen` | labels | none | ok | |
| on-screen "Its running jobs stop. Their saved lists stay, and each comes back with attach %n." | the restart warning | none | ok | "saved lists" is unclear: "job records". 55% |

## 5. The tiles and tsh in the host (`tiles.ts`, `tsh.ts`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `Tiles` / `startTiles` / `.open` / `.close` / `.stop` | one tsh per tile | one shell per pane (tmux) | ok | `open` / `close` / `stop` as the desk's Cmds |
| `Place` (`jobs`, `drop`) | where a tile keeps its jobs | none | two-ideas | `tsh.ts` `Placed` is foreground or background. `TileFolder`. 60% |
| `TileNews` | the desk Msgs the tiles send | events | ok | |
| `Edge` (`tell`, `terminal`, `view`, `gone`) | how the tiles reach the desk and the pages | none | two-ideas | the layout's `Edge` is start or end. `Ports`. 65% |
| `Heard` (`read`, `refused`) | what became of a page's message | decode result | two-ideas | owner-desk's `Heard` is `{on: msg \| reply \| typed}`. This one -> `Read` (section 4). 70% |
| `Screen<To>` / `.show` / `.heard` / `WindowScreen` / `.closed` | a page channel for a terminal or a view | a client attached to a pane (tmux) | two-words | `WindowScreen` follows `ToView`: `ViewScreen`. 65% |
| `Placed` (`foreground`, `background`) | where a job runs | foreground, background (bash) | ok | |
| `Runs` / `.began` / `.forward` / `.ended` / `.running` | what tsh tells its tile of its processes | job control notifications (bash) | differs | **picked 2026-10-28** run -> process: `Processes`. `forward` -> `foreground`, bash's word. 70% |
| `Tsh` / `.terminal` / `.close` / `.ended` / `startTsh` | one tile's shell | shell | ok | |
| `TSH` (`"tsh:p1"`) | tsh's own pid | pid | two-ideas | see layout `TSH`; this one -> `TSH_PID`. 65% |
| `SCREEN_KEPT` / `RESET` | bytes kept, terminal reset | scrollback; RIS `ESC c` ([xterm ctlseqs](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)) | ok | |
| `appPrograms` | the programs tsh starts with | none needed | ok | |
| stage (in the shell's job record) | dropped | none | ok | **picked 2026-10-28:** dropped |

## 6. tsh words a person types

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| job / `%n` / `jobs` | a tsh line is one job | job (bash) | ok | **picked 2026-10-28:** job stays |
| run (a program's run) | one running program | process | differs | **picked 2026-10-28:** process; run id -> pid; a job lists its processes |
| `&` | start in the background | `&` (bash) | ok | |
| `attach %n` | bring a job into this tile | `fg %n` (bash); `attach-session` (tmux) attaches a client to a session | two-ideas | `attach` is also the app reaching the host (`attach.ts`, reconnect's `attach`). Decided 2026-10-28 (`the-host-keeps-terminals-and-jobs.md`): a tile attaches. So keep `attach` for tile-to-terminal-or-job, and rename the app's: `connect` (section 7). 70% |
| pipe `\|` | one program's output into the next's input | pipe (POSIX) | ok | **picked 2026-10-28:** wire -> pipe |
| `tsh$ ` prompt | the prompt | PS1 (bash) | ok | |
| `desk`, `answer` (owner-desk's shell words) | open the owner's asks; reply to one | none | two-ideas | `desk` is the app's desk too. Follows section 13: `inbox`. 65% |

## 7. The link, attach and reconnect (`link.ts`, `wire.ts`, `attach.ts`, `reconnect.ts`, `start-host.ts`, `launch.ts`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `Link` / `linkMachine` / `LinkMsg` / `LinkCmd` / `LinkCtx` | the app-to-host connection and its handshake | connection; handshake (LSP `initialize`, [LSP spec](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#initialize)) | ok | |
| `Link.at: hello, up, refused, closed` | its states | none needed | ok | tag key, open #32 |
| `Up` / `Down` | app-to-host and host-to-app lines | upstream, downstream | two-ideas | `up` is also a connected state (`Link.at`, `Found.kind`, `Hold.up`). `AppLine` / `HostLine`. 55% |
| `Up` `hello`, `page`, `away`, `on` | hello, a page loaded, the page went, a message on a port | tmux `attach` / `detach`; `client-attached` hooks | differs | `away` -> `detach`, tmux's word. 60% |
| `Down` `hello`, `port`, `to`, `gone`, `close` | hello, a new port, a message, a port went, the window closes | none needed | ok | `close` see `empty` |
| `PROTOCOL` / `version` / `build` / `BUILD` | the message shapes' version, and the code's build | protocol version; build id | ok | |
| `Side` (`host`, `app`) | who runs the link | server, client (tmux) | differs | `server` / `client`, tmux's words. 55%: "host" is the repo's word for the server and is settled elsewhere |
| Cmd `greet`, `deliver`, `refuse`, `drop` | the link's Cmds | send hello, forward, reject, close | two-ideas | `deliver` is also the lane's run in the pipeline (`deliver`, `deliverProgram`, map's `deliver` box). `forward`. 70% |
| `wire.ts` / `Wire` / `hostWire` / `appWire` / `MAX_LINE` / `Unattached` | NDJSON framing on one socket | transport (MCP, [transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)); NDJSON ([spec](https://github.com/ndjson/ndjson-spec)) | two-ideas | the 2026-10-28 pick wire -> pipe is about program outputs piped into inputs. This wire is not a pipe: `transport.ts`, `Transport`. 70% |
| `attach` / `restart` / `AttachOptions` / `Attachment` / `NoHost` / `NoHello` (`attach.ts`) | the app reaching the host, or starting one | `attach-session` (tmux); `wezterm connect` | two-ideas | `attach` is tsh's job word (section 6). `connect`, `Connection`. 65%: `host/connection.ts` already means the ledger connection, so that one moves too. `Attachment` is also the pipeline's picture attachment (ui-verification) |
| `Reconnect` / `reconnectMachine` | the app's retry above the link | reconnect with backoff | ok | |
| `Reconnect.at: attaching, up, waiting, stopped, refused, restarting` | its states | none needed | ok | `attaching` follows `connect` |
| `ReconnectMsg` `ended`, `due`, `again`, `restart` | its Msgs | retry | differs | `again` -> `retry`. 60%: the button says Try again |
| Cmd `attach`, `restart`, `jitter` / `POLICY` / `Tried` | its Cmds | full jitter ([AWS, backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)) | ok | `attach` follows `connect` |
| `noteOf` | what the window says meanwhile | status | ok | |
| `LinkSub` | the link's watch | Sub (Elm) | ok | |
| `HostStart` / `startHost` / `StartFailed` | start a host process | spawn a server (`tmux start-server`) | ok | |
| `Launch` (`owner`, `quiet`, `foreground`) / `launchOf` / `QUIET_SWITCHES` | how this start shows itself | none | two-ideas | `foreground` is also a job's place. `quiet` / `shown`. 50% |

## 8. The host process and the CLI (`host/`, `cli.ts`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| host | the server process that holds the tiles, jobs, ledger, desk | server (tmux); mux server (WezTerm) | ok | the repo's settled word |
| home / `FABRIKA_HOME` / `--home` | the app's own folder | `CODEX_HOME`, `CARGO_HOME` ([Cargo env](https://doc.rust-lang.org/cargo/reference/environment-variables.html)) | two-ideas | packs get `places.home`, the pack's own folder (section 13). That one -> `places.own`. 55% |
| `HostPaths` / `pathsOf` / `host/sock` / `host/mcp` / `host/pid` / `host/log` / `host/lock` | the host's files | socket, pidfile, lockfile | ok | |
| `Reached` (`live`, `absent`, `stale`) / `reach` | a socket's state | stale socket | ok | |
| `Locked` / `alive` / `holdLock` | the start lock | lockfile (tmux's `<socket>.lock`) | ok | |
| `stopHost` / `NotStopped` / `runHost` / `HostAnswers` / `serve` / `DeskHome` | run, stop, serve | `kill-server`, `start-server` (tmux) | ok | |
| `Connection` / `CONNECTION_FILE` (`ledger.json`) / `connect` / `connectAndRestart` / `keepConnection` / `ConnectFailed` / `addressOf` / `loginWith` / `hostLedger` | the home's ledger server | remote; connection | two-ideas | the app's attach would become `connect` (section 7); this one -> `LedgerRemote`, as `git remote`. 55% |
| `OWNER` (`host/connection.ts`) | `user:owner` | none | two-words | `programs/tracker/src/seven.ts` exports another `OWNER`. One, in `@kampus/fabrika`. 75% |
| `DoorRefused` / "door" | the ledger server's login gate refused | auth gateway; 401/403 | differs | in-house word: `AuthRefused`. 60% |
| `invite` / `members` | add and list people | invite, members (GitHub orgs) | ok | |
| `fabrika move` / `move` / `MoveStopped` / `MoveTarget` / `MOVED` / `CHUNK` / `copyInto` / `readLaptop` / `dryRun` / `--dry-run` | copy a laptop ledger to a server | migrate ([Prisma migrate](https://www.prisma.io/docs/orm/prisma-migrate)), import; `--dry-run` (git, kubectl) | differs | `migrate`. 60%. `--dry-run` is ok |
| `Plan` / `planOf` / `reportOf` (move) | the copy's plan | migration plan | two-ideas | `Plan` is the pipeline's plan. `MovePlan`. 75% |
| `--founder` | with `--dry-run`, your id on the ledger | owner | differs | `--owner`. 55% |
| `Seal` / sealed | the hash check after a copy | checksum verification | ok | |
| `LinkDropped` (move) | the server link dropped | none | ok | |
| `fabrika post file \| comment \| close \| list` / `post` / `posting` / `PostFailed` / `asAgent` / `AGENT_KEY` | an agent writes to the tracker | `gh issue create \| comment \| close \| list` | differs | `fabrika ticket create \| comment \| close \| list`, as `gh issue`. 65%. `post list` posts nothing, so "post" is wrong for it (two-ideas) |
| `--as` | the agent's name | `--author` (git commit) | ok | |
| `--body-file` | the text, in a file | `--body-file` (`gh issue create`) | ok | |
| `fabrika connect <address> --login --key` | join a ledger server | `gh auth login`; `git remote add` | ok | |
| `fabrika mcp --as` / `serveAgents` | the MCP bridge | stdio transport (MCP) | ok | |
| MCP tool `runs` / `<program>_<input>` | list programs, their tools, processes | `tools/list` (MCP) | differs | **follows the pick 2026-10-28:** `ps` or `processes`. 60% |

## 9. The line editor (`editor/`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `Editor` / `editor` / `EditorMsg` / `EditorCtx` | the line editor | line editor; readline | ok | |
| `Mode` (`prompt`, `search`, `busy`, `ended`) | what it is doing | readline's modes | ok | |
| `Line` (`left`, `right`) | text around the cursor | the line buffer (readline `rl_line_buffer`) | two-ideas | the plan's `Line` (a line an owner approves) is another export, used by owner-desk. Editor's -> `Buffer`. 55% |
| `Recall` (`back`, `typed`) | a history line on the prompt | history position | ok | |
| `history` / `killed` / `last` / `cols` / `resized` / `jobs` / `programs` | its state | kill ring, history (readline) | ok | |
| Msgs `keys`, `size`, `printed`, `ready`, `ended`, `jobs`, `history` | what it hears | none needed | ok | |
| Cmds `write`, `line`, `interrupt`, `close`, `keep` | bytes out, a line to tsh, Ctrl-C, end, save history | `accept-line`, SIGINT | two-words | `keep` saves history and the desk says `save`. `save`. 60%. `close` see desk |
| `KEPT` | history lines kept | `HISTSIZE` (bash) | ok | |
| `Command` (`beginning-of-line` ...) | readline's command names | the same names (readline) | collides | `cli.ts` imports `Command` from `effect/cli`. Only a clash if one file imports both. 50% |
| `Key` (`text`, `command`, `unknown`) / `keyOf` / `keysIn` / `printable` / `KILLS` | a decoded key | none | two-ideas | hold's `Key` (section 3) |
| `Facts` / `factsOf` / `factsFrom` (`cells.ts`, `cells.probe.ts`) | a code point's width and grapheme class | Unicode properties (East Asian Width, Grapheme_Cluster_Break, [UAX 29](https://www.unicode.org/reports/tr29/)) | two-ideas | `factsOf` is also the pipeline's ticket helper (imported by the tracker), and facts are the ledger's word. `CodePoint` / `propertiesOf`. 70% |
| `runsOf` (cells.ts) | runs of code points with the same facts | run-length table | two-ideas | `run` is now a process (picked). `rangesOf`. 65% |
| `Class` / `CLASSES` / `Wide` (`narrow`, `wide`, `tail`, `head`) / `Cell` / `BLANK` / `Pen` / `print` / `cells` | cell layout | wcwidth ([POSIX wcwidth](https://pubs.opengroup.org/onlinepubs/9699919799/functions/wcwidth.html)) | ok | `head` and `tail` are a wide cell's halves |
| `spot` | the column a text ends at | display width | differs | `columnOf`. 55% |
| `Answers` / `Probed` / `probeAll` / `packedFrom` / `modelAnswersOf` / `answersOf` | the wasm probe's results | probe | two-ideas | `answer` again. `Probe` results: `Measured`. 50% |
| `PROMPT` / `draw` / `back` / `fitsRow` / `redrawRow` / `CLEAR` / `NEWLINE` / `BELL` / `CLEAR_BELOW` / `shown` / `columns` | screen bytes | CSI sequences (xterm ctlseqs) | ok | `shown` is one more `Shown`; it is a function, keep |
| `History` / `memoryHistory` / `fileHistory` / `SharedHistory` / `sharedHistory` | the history file | history file (bash `HISTFILE`) | ok | |
| `Grid` / `gridOf` | bytes read back as rows, for tests | screen buffer | ok | |

## 10. counter (`programs/counter`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `counter` | the smallest program with a view | the Elm guide's counter ([Elm guide, buttons](https://guide.elm-lang.org/architecture/buttons.html)) | ok | |
| input `press` / `Press` (`plus`, `done`) | a button press | Elm's `Increment` Msg | two-ideas | `Press` is also the page's key event (section 3). `Button`. 55% |
| output `n` | the count, once done | none needed | ok | |
| `Shown` (`n`) | the view data | Elm's Model as shown by `view` | collides | four exported `Shown`s. Each program's view data -> `View`, as `defineProgram`'s `view` says. 70% |
| kind `count` / machine `count` | its machine | `kind` (open #32) | ok | `kind` is open (#32) |
| status `N so far` | its status line | none | ok | |
| "It has a window" (description) | it has a view | view | two-words | every program says "window"; `defineProgram` says `view`. "It has a view". 70% |

## 11. tracker (`programs/tracker`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| program `tracker` / machine `tracker` exported as `tickets` / `ticketsKind` / `ticketsOptions` / kind `tickets` | one machine, two names | issue tracker (GitHub, Linear) | two-words | one name: `tracker` everywhere (kind `tracker`). 75% |
| input `do` / `Do` | what the view does | Msg (Elm); user action | two-words | ~~One word for "the view's input": `do`. 65%~~ Wrong: the owner rejects `do` (2026-10-28). Done 2026-10-30 ([PR 164](https://github.com/usirin/tea-fabrika/pull/164)): one input per command, named by its verb (`file`, `comment`, `close`, `reopen`, `answer`, `rate_duplicate`, `query`, `quit`), each the command's own struct. |
| `Do` `list`, `open`, `show`, `find`, `quit` | navigate, filter, search, quit | Linear: views, filters, search | two-words | Gone: `list`, `open`, `show` and `find` are now shapes of `query` (`{ticket}`, or `{status, find}`); `quit` is its own input. `find` vs the key help "/ search" and the box "Search titles" stays open: `search`. 75% |
| `Write` / `factOf` | one change a person asks for, as a fact | mutation ([Zero, mutators](https://zero.rocicorp.dev/docs/writing-data)); command (CQRS) | ok | plain |
| `Write.kind: file` | file a new ticket | "Create new issue", key `C` (Linear); "New issue" (GitHub); `gh issue create` | differs | `create`. 70%. On screen it says "new ticket" and "files it": two words |
| `Write` `comment` (`asks: "changes"`) | a comment, or "Request changes" | request changes (GitHub reviews, [reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)) | two-ideas | `asks` is one more meaning of ask (open #32). `requests: "changes"`. 55% |
| `Write` `answer` (`ask`, `pick`, `note`, `saw`) | answer an open ask | none | ok | `ask` open (#32) |
| `Write` `close` / `reopen` | close, reopen | close, reopen (GitHub) | ok | |
| Cmd `load`, `save`, `pull_requests` | read the ledger, write a fact, read open PRs | none needed | ok | |
| Sub `poll`, `pull_requests_wait`, `clock` / `POLL` / `CLOCK` / `PULL_REQUESTS_EVERY` | polls | polling | ok | |
| `Show` (`open`, `closed`, `all`) | which tickets the list shows | `state=open\|closed\|all` (GitHub REST, list issues) | ok | |
| `Find` / `finds` | the title search | search | two-words | see `find` |
| `PullRequestsRead` (`ask: idle \| busy`, `list`, `why`) | the PR read's state | request state | two-ideas | `ask` here is a request in flight; `load` says the same with `idle \| busy \| again`. `read`. 70% |
| `Saving` / `Failed` | a write on its way; one that did not land | pending mutation | ok | |
| `Tracker` (state) `ready`, `load`, `seen`, `tickets`, `open`, `saving`, `failed`, `problems`, `unreachable`, `quitting`, `show`, `find`, `pullRequests`, `now` | its Model | Model (Elm) | ok | |
| `Tracker.seen` | the last ledger position read | offset ([Kafka, consumer offsets](https://kafka.apache.org/documentation/#design_consumerposition)); cursor | two-words | `Row.pos` is a position too, and ui-verification's `Seen` is a pattern service. `cursor`. 60% |
| `Tracker.open` | the ticket open in the view | none | two-ideas | `open` is also a ticket's state and a `Show` value in the same state. `opened`. 55% |
| `TrackerMsg` `list`, `open`, `write`, `quit`, `moved`, `show`, `find`, `refresh`, `tick` | its Msgs | none needed | differs | `moved` means "the ledger has new rows": `news`, or `changed`. 60%. "move" is also `fabrika move` |
| `PROBLEMS` / `problems` | rows that did not fit, newest few | problems (VS Code) | ok | |
| `over` | it may end now | `terminal` predicate (tea) | two-ideas | see the desk's `over` |
| `statusOf` | its status line for a host's list | status | two-ideas | the head (below) is what a person calls a ticket's status. Fine for the program; `statusLineOf`. 50% |
| `Listed` | a ticket on the list | list item | ok | |
| `Opened` / `openedOf` | one ticket's page: ticket, head, rows, asks | issue page | two-ideas | build's `Opened` is a pull request (pipeline.md, section 3). `TicketPage`. 70% |
| `Page` (`list`, `ticket`) | what the view shows | route / screen | two-ideas | the ticket program's `Page` and owner-desk's `Page` differ. `Screen`. 55% |
| `Shown` (`page`, `filter`, `github`, ...) / `shownOf` | the view data | view | collides | see counter: `View`. 70% |
| `Shown.github` (`read`, `why`) | whether PRs were read | none | ok | |
| `Head` / `headOf` / `lineOf` / `waits` | a ticket's top line: `done`, `closed`, `asks`, `running`, `stuck`, `idle`, `next` | status (Linear issue status, [Linear, workflows](https://linear.app/docs/configuring-workflows)) | two-ideas | `head` is a PR's head commit everywhere else in the repo. `Status`. 65% |
| `Head` tags via `_tag` | the tag key | Effect `_tag` | two-words | **open (#32)**: the tracker uses `_tag` here and `kind` / `type` around it |
| `Head` `running` (`run`, `stage`, `task`, `since`) / `stuck` (`stage`) / `next` (`stage`) | which pipeline stage | stage | two-words | the pipeline stage (triage, plan, build, review, ship) is not the shell's dropped stage. But `steps.ts` calls the same thing a step (row below). `run` follows the pick |
| `OpenAsk` (`ask`, `what`, `picks`, `by`, `whose`, `at`) / `openAsksOf` | an ask with no answer yet | none | ok | `ask` open (#32) |
| `HOUR` | idle after an hour | none | ok | |
| `prRefOf` / `words` | `owner/repo#12`; `_` to spaces | none | ok | |
| `STEPS` / `StepName` / `stepsOf` / `currentOf` / `stepWords` | the plan's nine steps for a ticket | stage, as the pipeline's stages (`docs/direction/outcome-names.md`); GitHub Actions jobs and steps | two-ideas | a step is a stage here (`Head` says `stage`), a `[state, cmds]` pair in the machines (`type Step`), and an entry in `kind`'s `drawing.steps`. `STAGES` / `StageName`. 65% |
| `StepState` (`none`, `running`, `you`, `stuck`, `done`) | where a step stands | job status queued, in_progress, completed ([GitHub, workflow jobs](https://docs.github.com/en/rest/actions/workflow-jobs)) | differs | `you` -> `waiting`, as the ledger's waiting asks. 65% |
| `StepNow` (`step`, `state`, `runs`, `usd`, `last`) | one step's state | none | ok | `usd` is the money question (open #32); `runs` follows the pick |
| `Row` (`pos`, `type`, `by`, `whose`, `at`, `text`, `more`, `body`) / `rowOf` / `rowsOf` | one short row per fact | timeline event (GitHub REST, timeline) | two-ideas | owner-desk exports another `Row` (an inbox row). Tracker's -> `TimelineRow`. 60% |
| `checksLine` | a PR's checks in one line | check runs (GitHub REST, [check runs](https://docs.github.com/en/rest/checks/runs)) | ok | |
| `Summary` (`number`, `title`, `state`, `comments`, `at`) / `summaryOf` | a ticket on the list | issue (GitHub REST) | ok | |
| `Piece` (`text`, `link`) / `piecesOf` | a body cut into text and URLs | autolink ([GitHub, autolinked references](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls)) | two-ideas | the promises package's `Piece` is a piece of code. `Segment`. 60% |
| `Author` | who the tracker writes as | author (git) | ok | the ledger says `Writer`; `Author` is a service holding one. Fine |
| `loadCell` / `saveCell` / `pullRequestsCell` / `pollRunner` / `clockRunner` / `pullRequestsWaitRunner` | its interpreters | Cmd and Sub runners (tea) | ok | |
| `PullRequest` (`repo`, `number`, `title`, `url`, `draft`, `at`) / `PullRequests` (`open`) / `pullRequestsOf` / `nameOf` / `PullRequestsUnreachable` | open PRs | pull request (GitHub REST, pulls) | ok | |
| `GitHubSettings` / `GITHUB` / `gitHubPullRequests` | reads PRs through GitHub | none needed | ok | |
| `SEVEN` / `SEVEN_NOW` / `SEVEN_TITLE` / `SEVEN_BODY` / `atSeven` / `trackerAtSeven` / `LANE` / `OWNER` | the stand-in ticket #7 | fixture ([Wikipedia, test fixture](https://en.wikipedia.org/wiki/Test_fixture)) | ok | `OWNER` twice (section 8) |
| on-screen key help: `j k pick`, `Enter open`, `o x a open, closed, all`, `/ search`, `c new ticket`, `q quit`, `Ctrl Enter files it`, `Ctrl Enter comments` | the list's keys | Linear's `J`/`K`, `C`, `/` | two-words | the ticket view says `J K move` and `⌘ ↵ to send` for the same moves. One spelling: `j k move`, `Ctrl Enter send`. 70% |
| on-screen "Reading the ledger…", "No open tickets. Press x to see the closed ones.", "No pull request has that in its title." | empty and loading states | none | ok | |

## 12. ticket, map, trace (`programs/ticket`, `programs/map`, `programs/trace`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| `ticket --ticket 7` / `map --ticket 7` / `trace --ticket 7` | the ticket, by number | `gh issue view 7` (positional) | differs | a positional argument, `ticket 7`. 60%: needs tsh to take positional args |
| ticket input `do` / `Do` (`comment`, `answer`, `close`, `reopen`, `quit`) / `writeOf` | what the ticket view does | as the tracker's `Do` | two-words | Done 2026-10-30 ([PR 164](https://github.com/usirin/tea-fabrika/pull/164)): inputs `comment`, `answer`, `close`, `reopen`, `quit`, by the tracker's names and structs; `writeOf` stays. |
| map, trace input `in` (`kind: "quit"`) | quit | none | two-words | the others say `do`. `do`. 65% |
| ticket `Plan` (`version`, `tasks`) | the newest plan's version and tasks | none | collides | `Plan` is the pipeline's plan. `PlanLine` or `LatestPlan`. 75% |
| ticket `Pr` (`url`, `state`, `checks`) | the newest PR fact | pull request | ok | |
| ticket `Page` (`opened`, `body`, `filed`, `steps`, `plan`, `pr`, `usd`) / `pageOf` | the ticket's page | issue page | two-ideas | see the tracker's `Page`. `TicketPage` and fold `Opened` into it. 60% |
| ticket `Shown` / `shownOf` | its view data | view | collides | `View`. 70% |
| `filed` (`by`, `at`) | who filed it, when | "opened by" (GitHub) | differs | follows `file` -> `create`: `created`. 65% |
| on-screen "Whose turn" / "Your turn" / "waits on you" / "Nothing waits on you." | whose move it is | Linear's "assignee"; GitHub "awaiting your review" | ok | plain, and the direction docs use it |
| on-screen "Properties" panel | the ticket's fields | properties (Linear, creating issues) | two-ideas | `Property` was picked 2026-10-24 for a check a tool runs. The panel keeps Linear's word on screen, or says "Details" (GitHub's sidebar). 55%: settled by whether a property (check) ever shows in that panel |
| on-screen "Made of" | the lane and steps behind a ticket | none | differs | "How it runs". 50% |
| on-screen "Activity", "Leave a comment", "Comment", "Request changes", "Close ticket", "Reopen ticket", "No description." | the page's words | Linear and GitHub's same words | ok | |
| on-screen `J K move`, `↵ open`, `⌘ ↵ to send` | key help | as the tracker's | two-words | see the tracker's key help row |
| `map` | a React Flow map of today's programs | a graph of nodes and edges ([React Flow, concepts](https://reactflow.dev/learn/concepts/terminology)) | ok | |
| `Port` (`name`, `type`) | one input or output of a program box | handle (React Flow); port (dataflow) | two-ideas | a port is also an Electron MessagePort in the same app. `Pin`, or keep. 45%: settled by how often both meet in one file |
| `ProgramName` / `ProgramNode` (`at`, `ins`, `outs`) / `PROGRAMS` | a program's box | node (React Flow) | two-words | `ins` / `outs` vs `defineProgram`'s `inputs` / `outputs`. Use those. 70% |
| `Wire` (`from`, `into`, `why`) / `WIRES` | a typed output piped into an input | pipe | differs | **picked 2026-10-28:** pipe (`Pipe`, `PIPES`) |
| `Call` (`from`, `what`) / `LEDGER_CALLS` | a program that asks the Ledger service | service call; edge | ok | |
| `Where` (`stepped`, `apart`, `missing`) / `SPOTS` | where each of the nine steps lives today | none | two-words | `SPOTS` keyed by step: `PLACES`. 50%. `kind` here is open (#32) |
| `Family` (`fact`, `turn`, `checks`, `step`) / `familyOf` | a schema's family, for colour | none | differs | `turn` means plan and ask schemas, unclear. `ask`? no: open (#32). Lean `owner`. 40%: settled by the map's legend |
| map on-screen "ledger: a service, not a program", "in: inbox", "deliver", "hosted", "operate" | box labels | none | ok | `deliver` is the lane run (pipeline.md, section 7) |
| `trace` (program) / `Trace` / `traceOf` | one ticket's runs over time, tracks and clips | trace = a tree of spans ([OpenTelemetry, traces](https://opentelemetry.io/docs/concepts/signals/traces/)); `a-job-record-holds-its-trace.md` uses the OTel meaning | two-ideas | `timeline`? taken by `Ticket.timeline`. Lean keep `trace` once it reads OTel spans; else `Gantt`. 45%: settled by whether the view moves onto JobRecord traces. **Since [#172](https://github.com/usirin/tea-fabrika/pull/172):** this view is the program `runs` (`programs/runs`), and `trace` is one job's trace from its record |
| `Track` (`name`, `who`, `clips`, `waits`, `usd`) / `Clip` (`run`, `task`, `from`, `to`, `open`, `ended`) | a step's row; one run on it | track and clip ([Ableton manual, clips](https://www.ableton.com/en/manual/clip-view/)) | ok | `Clip.run` follows the pick |
| `Trace.spans` | how many runs | span (OTel) | two-words | it counts clips: `clips`. 75% |
| `Trace.upTo` | the playhead's time | playhead (on screen "Playhead") | two-words | `playhead`. 70% |
| `Wait` (`ask`, `what`, `from`, `to`, `pick`) / `Marker` (`at`, `kind: answer \| changes`, `says`) | an ask's wait; an answer on the ruler | marker (DAW) | ok | |
| `Who` (`agent`, `code`, `person`, `none`, `ticket`) | who works a track | none | two-ideas | `none` and `ticket` are not "who". Split `ticket` out as its own row kind. 55% |
| `axisOf` / `placeOf` / `ticksOf` / `stopsOf` | the time axis, positions, ticks, fact times | axis, ticks | ok | `stopsOf` are the facts' times the playhead steps to: `momentsOf`. 45% |
| on-screen "one ticket, one trace", "Live. The playhead follows now.", "run", "step", "time", "ended", "cost", "in", "out" | the trace's words | none | ok | `run` follows the pick on screen too |

## 13. The packs (`packs/ask-log`, `packs/owner-desk`, `packs/ui-verification`)

| name | means here | industry (with a source link) | mark | proposal |
|---|---|---|---|---|
| pack / `Pack` / `program` / `listens` / `answers` / `layer` / `holds` / `shell` | an add-on program that hears the core | plugin; extension (pipeline.md, section 9) | two-ideas | `answers` names a pack's outputs into core inputs, and an answer is also the owner's reply. `sends`. 60% |
| `Places` (`home`, `folder`) | the pack's own folder, the config's folder | none | two-ideas | `home` is the app's home elsewhere. `own`, `config`. 55% |
| `ask-log` / `logProgram` / `LogFile` / `lineOf` | one line per ask and per answer | audit log | ok | `lineOf` is also the tracker head's printer; both local |
| ask-log inputs `ask`, `settled` / settings `file` | the asks and settled answers | none | ok | `ask` open (#32) |
| `owner-desk` / `deskProgram` / `desk` (machine) / `deskKind` / `Desk` (`open`, `refused`, `closed`) / `DeskMsg` (`waiting`, `settled`, `refused`) / `DESK` | the owner's inbox of asks, one page each | inbox (Linear inbox); notifications (GitHub) | two-ideas | the app exports `Desk`, `DeskMsg` and a desk machine with other shapes. `owner-inbox`, `Inbox`, `InboxMsg`, `inbox` machine. 70%: the README already says "shows an inbox" |
| `Closed` (`ask`, `said`) / `GONE` | an ask that stopped waiting | none | ok | |
| `Page` (`inbox`, `ask`, `closed`) / `inboxPage` / `askPage` / `pagesOf` | one rendered page | none | two-ideas | three `Page`s (tracker, ticket, here). Keep here; rename the tracker's and ticket's. 50% |
| `Row` (`id`, `for`, `title`, `at`) | one inbox row | none | two-ideas | the tracker's `Row`. `InboxRow`. 55% |
| `PlanBody` (`whole`, `sections`, `approved`, `added`, `removed`, `reworded`, `same`) / `Section` / `planBody` | a plan's lines, whole or the diff | a diff (git) | ok | |
| `answersFor` / `saidOf` / `whereOf` | the replies an ask takes, what an answer said, where it lives | none | ok | |
| `answerOf` / `typedAnswerOf` / `/approve`, `/yes`, `/no`, `/change`, `/remove`, `/keep-going`, `/reword`, `/rule` | the owner's typed replies | slash commands ([Slack, slash commands](https://api.slack.com/interactivity/slash-commands)) | ok | `keep_going.rounds` vs `tries` is the tries question (open #32) |
| `Heard` (`on: msg \| reply \| typed`) | what the desk program heard | none | two-ideas | tsh's `Heard` (section 5). Keep here once tsh's becomes `Read` |
| `Settings.view` (`markdown`, `comment`) / `DeskView` / `ViewFailed` / `viewFailed` / `markdownView` / `commentView` | how pages are written out | renderer; output format | two-ideas | `view` is a program's UI everywhere else. `format`. 65% |
| `Settings.dir` | where pages go | none | two-words | ask-log says `file`, ui-verification says `shots`. Fine per pack; `dir` -> `folder`, the word `Places` uses. 50% |
| `Comment` (`marker`, `body`) / `markerOf` / `threadFile` / `threadOf` / `commentOf` | a comment-thread stand-in | issue comment (GitHub REST) | ok | |
| `ui-verification` / `uiProgram` | holds each build, asks yes or no when what a user sees changed | UI Review ([Chromatic, UI Review](https://www.chromatic.com/docs/review/)); visual tests | differs | `ui-review`. 60%: the direction note names it ui-verification |
| input `built` / outputs `cleared`, `raise` | each build; a build with no visible change; a check to raise | none | ok | `raise` is in pipeline.md (section 9) |
| "raises one check" (comment and description) | asks the owner | review request | two-ideas | `check` is only the move now (picked 2026-10-24). "asks one question". 75% |
| `BY` | who raises | none | ok | |
| `Shots` / `fakeShots` / settings `shots` | before and after pictures | screenshots, snapshots (Chromatic) | ok | |
| `Seen` (service: `patterns`) / `visibleOf` / settings `seen` | which paths a user sees | none | two-ideas | the tracker's `seen` is a ledger position. `Visible`. 65% |
