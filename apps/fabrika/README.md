# fabrika app: `@kampus/fabrika-app`

The fabrika app, as a walking skeleton: the whole flow, thin. It is one window, tiled like
tmux. Every tile runs its own tsh, with the small programs `counter` and `tracker` loaded. A
program with a view runs inside a tile. The design is
[The GUI is an Electron app first](../../docs/direction/the-gui-is-electron-first.md), section
"Decided 2026-10-25: tiles, like tmux".

```text
pnpm fabrika                 one tile, running tsh
tsh$ seq --to 3 | double
double 2
double 4
double 6
Ctrl-B |                     a second tile on the right, with a fresh tsh, focused
tsh$ counter                 counter covers this tile: 0  [+1] [done]; Ctrl-C and tsh is back
tsh$ tracker &               a job in the background; no tile opens, the prompt is back at once
tsh$ attach %1               the tracker comes into this tile, as bash's fg
Ctrl-B h                     focus moves left
Ctrl-B x                     always asks: "close t2? (y/n)". y, and a busy tile shows "closing"
Ctrl-B x                     on a closing tile: "stop t2 now? (y/n)"
red button, then dock icon   the window closes, the app runs on; a new window on the same desk
Cmd-Q, and open again        the app quits, the host runs on; the same tiles, the runs still up
```

The app is a client. The host is its own process, as the tmux server is: it holds every tile's
tsh, the programs, the history, the jobs, `ledger.sqlite` and the desk. Cmd-Q quits only the
app. The next start attaches to the same host.

```ts
// Between the app and the host (src/link.ts): NDJSON on a Unix socket, `<home>/host/sock`.
type Up = {type: "hello"; version: number} | {type: "page"} | {type: "away"}
	| {type: "on"; port: string; m: unknown};
type Down = {type: "hello"; version: number} | {type: "port" | "gone"; port: string}
	| {type: "to"; port: string; m: unknown} | {type: "close"};

// Between the page and the host, each on its own port (src/messages.ts); main relays them.
// "desk": the desk runs in the host. The page draws it, and sends the keys it takes and clicks.
type FromPage = {type: "press"; id: number; key: string} | {type: "click"; tile: TileId}
	| {type: "resize"; stack: string; sizes: Record<string, number>};
type ToPage = {type: "keys"; prefix: string; table: {key: string; repeats: boolean}[]}
	| {type: "desk"; desk: Desk; takes: {all: boolean; keys: string[]}}
	| {type: "answer"; id: number; took: boolean} | {type: "down"; why: string};
// "tile:t1": t1's terminal, as a terminal is to a pty.
type ToTerminal = {type: "write"; data: string};
type FromTerminal = {type: "keys"; data: string} | {type: "size"; cols: number; rows: number};
// "run:counter:1a2b": one run's view. The host reads `msg` with that run's program (`readInput`).
type ToWindow = {type: "view"; program: string; data: unknown /* its view schema reads it */};
type FromWindow = {type: "msg"; msg: unknown /* one of its run's inputs */};
```

## Where it sits

- The top layer of the workspace (`layer-rules.json`): it imports `@kampus/fabrika`,
  `programs/counter` and `programs/tracker`, and nothing imports it.
- Electron is named only in `src/main.ts` and `src/preload.ts`. Node and
  `@effect/platform-node` are named at the edges: `src/main.ts`, `src/attach.ts`,
  `src/host/main.ts`, `src/host/run.ts` and `src/host/socket.ts`. Everything else is plain
  Effect, tested with no Electron. The page is React, with each terminal made outside it.
- **The host is a process of its own.** It is the app's own binary run as Node
  (`ELECTRON_RUN_AS_NODE=1`, on `dist/host.mjs`), started detached by the first app that finds
  none, and let go. No second runtime ships, and Electron's Node is the one the app was built and
  tested on. It holds the tiles (tsh and the line editor, one of each per tile), the ledger, the
  history and the desk.
- **The link is a Unix socket,** `<home>/host/sock`, mode 0600 in a 0700 folder. No TCP and no
  secret: the file's mode is the lock, as tmux's is. One JSON line a message (NDJSON), each read
  with an Effect Schema at both ends. A version handshake first (`link.ts`): an app of another
  version is not attached, says so, and leaves that host running.
- **Main is a thin relay.** It checks a page's hello, keeps a port per tile and run for the
  window's own page, and passes lines on. It holds no desk and no tiles.
- A tile's terminal only draws bytes and sends keys, as a terminal does with a pty. There is no
  pty and no `node-pty`: tsh is not a process, so there is nothing to give a pty to.
- **The desk (the layout, the focus, the prefix, the question) is a tea machine in the host.**
  The page only draws it. A reload, a new window or a second client draws the same desk.

## What's in it

| File | What it does |
|---|---|
| `src/main.ts` | The Electron edge, a thin relay. One copy at a time; at most one window, sandboxed, on the app's own scheme; every way out refused. Attaches to the host, or starts it. A port per tile, per run and one for the desk, handed only to the window's own top frame on its own page, and lines passed between them and the host. |
| `src/attach.ts` | The app's side: reach the socket; if no host answers, start one and wait for it to listen; then the link and its handshake. |
| `src/link.ts` | The link's two message types (`Up`, `Down`) and its handshake, a tea machine: `linkMachine`, Model `Link`, Msg `LinkMsg`, Cmds `LinkCmd`. |
| `src/wire.ts` | One link on one socket for either side: NDJSON framing (Effect's `Ndjson`), the handshake stepped on every line, `Unattached` when it does not come up. |
| `src/host/` | The host process. `main.ts` is the entry (`dist/host.mjs`). `run.ts` makes the folder and socket, cleans a stale socket, writes the pid, and opens the ledger, history and desk. `serve.ts` (no platform) runs the desk and the tiles, and serves every client. `socket.ts` reaches a socket: live, absent or stale. |
| `src/preload.ts` | Gives the page `send`, `onMessage` and `forget`, by port name, and nothing else. |
| `src/bridge.ts` | Those names, as the page sees them, the port names it takes, and the IPC channel. |
| `src/tiles.ts` | One tsh per tile, each in its own scope. It tells the desk (`TileNews`) when a run covers a tile, when it is over, and when a closing tile has ended. `close` ends the inputs of the tile's tsh and its runs; `stop` ends its scope and drops its folder. |
| `src/tsh.ts` | One tile's tsh: starts it with the app's programs, runs the line editor between tsh and the terminal, and says whether each run is in the foreground or the background. Each screen shows to every page that asks. It is handed the `Ledger` and gives it to the tracker, which writes as `user:owner`. |
| `src/desk/` | The desk, a tea machine (`desk.ts`): `deskMachine`, Model `Desk`, Msg `DeskMsg`, Cmds `DeskCmd`; `DeskSchema` sends it to a page, and `takenNow` says which keys it takes now. `hold.ts` is the page's key holder: `holdMachine`, Model `Hold`, Msg `HoldMsg`, Cmds `HoldCmd`. `keys.ts` is the prefix and its table. `layout/` is Tuval's layout tree, ported with its tests, the leaf named "tile". |
| `src/editor/` | The line editor, a tea machine: keys in, screen bytes out (`editor.ts`). `keys.ts` names each key, `screen.ts` draws, `history.ts` keeps the history in a file, shared by every tile, `grid.ts` reads bytes back as rows for the tests. |
| `src/messages.ts` | The six message types as Effect Schemas, and their strict readers. |
| `src/files.ts` | What the app's own scheme serves: one page, its script and one stylesheet, with a Content Security Policy. |
| `src/window/` | `desk.tsx`, the page: the tiles, their borders, the question, the status line. `terminal.ts`, a tile's terminal: ghostty-web, made once and moved between slots. `windows.tsx` lists each program view the app knows. |
| `build.ts` | Bundles `dist/` with esbuild: `main.mjs`, `host.mjs`, `preload.cjs`, `desk.js`, and the page's plain files. |
| `e2e.ts` | Drives the built app through Playwright, one screenshot per step: split, focus, a covered run, the close question, `&` and `attach`, zoom, a closing tile, the stop question, Ctrl-B twice, shared history, the safety checks, the red button and the dock icon, then quit with the host and counter running on, open again on the same desk, a split through the host, the last tile closing the window, and a host of another version. It stops its own host by its pid and checks with `pgrep`. Not in `pnpm test`. macOS only. |

## Keys

Ctrl-B, then one key, as in tmux. Tuval had the same table.

| After Ctrl-B | What it does |
|---|---|
| `\|` or `-` | split the focused tile side by side, or top to bottom; the new tile runs a fresh tsh |
| `h` `j` `k` `l`, or the arrows | focus left, down, up, right |
| `z` | zoom the focused tile; again to undo |
| `x` | ask `close t2? (y/n)`, then close the focused tile; on a closing tile, ask `stop t2 now? (y/n)` |
| `N` | a new workspace, with one tile |
| `Ctrl-H`, `Ctrl-L` | the previous or next workspace; press again within 500 ms with no Ctrl-B |
| `Ctrl-B` | send one Ctrl-B on, to tsh or the program (tmux's `send-prefix`) |

- **The host decides keys.** It sends the page the Ctrl-B table, and with every desk the keys
  the desk takes now. The page reads keys first, in the keydown capture phase. A key the desk
  takes goes to the host as a `press`, and neither ghostty-web nor a program's view sees it.
  Keys after it are held, in order, until the host answers (`hold.ts`), with no timer. An answer
  of `took: false` lets the key go on as it was. Any other key after the prefix does nothing, as
  in tmux.
- **Typing in a tile goes to the host,** on the tile's port, to its tsh. A text box in a program's
  view stays in the page; the program gets only the inputs it declares.
- **A click focuses a tile. Dragging a border resizes** the two tiles beside it.
- **Ctrl-B is readline's "back one character" too.** The prefix wins; the left arrow does the
  same, and Ctrl-B twice sends it on.

## Tiles

- **Every new tile runs a tsh of its own,** with its own job table, in
  `storage/tiles/<tile>/` in the app home. History is one file, shared: a line typed in one tile
  is the next tile's Up.
- **A run in the foreground covers its tile.** tsh waits behind it. Ctrl-C stops it, and tsh is
  back. The other tiles stay as they were.
- **A run with `&` is a job in the background, and no tile opens.** The prompt is back at once.
  `attach %n` brings it into the tile, as bash's `fg` does.
- **Ctrl-B x always asks, as tmux's `kill-pane` does:** `close t2? (y/n)`. Only y says yes; any
  other key says no.
  - On a tile with nothing running, y closes it at once.
  - On a busy tile, y gives tsh and every run it started `close`: the end of their inputs, as a
    hung-up terminal gives a shell. It does not stop them. The tile shows "closing" until they
    have all ended, then it goes. There is no timer.
  - Ctrl-B x on a closing tile asks `stop t2 now? (y/n)`. y stops them, and the tile goes.
  - Closing a tile ends only what that tile's tsh started. A run shown in another tile is left
    alone. Its folder is deleted once it goes.
  - Ctrl-D in a tile's tsh closes that tile.
- **The window, macOS's way.** The red button closes the window only: the app stays in the dock
  and everything runs on. The dock icon, or a second start, makes a new window on the same desk,
  with the live runs. Cmd-Q quits the app, and only the app. On Windows and Linux, closing the
  window quits the app, as Electron's own pattern does; the host runs on there too.
- **The host outlives the app.** Quit and open again: the app attaches to the same host, and the
  desk is as it was, with every run still up. A second start while the app runs brings the first
  copy's window forward.
- **No person stops the host;** there is no command for it yet. Tests stop their own by its pid,
  in their own home. A host that stopped leaves `desk.json`: the next host starts the layout from
  it, and each tile's tsh opens on its own folder, so `attach %n` finds the earlier jobs.
- **Closing the last tile closes the window, not the app,** and removes `desk.json`, so the next
  window opens on one fresh tile.

### A port per tile and per run

The page has one port per tile (`tile:t1`), one per run with a view (`run:counter:1a2b`) and
one for the desk (`desk`). Not one port for everything.

- Why: a message can only reach the tsh or the run whose port it came on. Main relays by port,
  and the host routes by port, never by a name inside the message, so a page bug cannot type
  into the wrong tile or press a button in another run.
- What it costs: the preload keeps a small table of ports, and a tile or run closing must
  `forget` its port. The preload takes only names of these three shapes.
- How sure: 85%. A single port with a tile id in each message would be simpler, and safe as
  long as the host checks the id; the port does that check for free.

## The line editor

It is what readline is to bash: it owns the prompt line and hands tsh a whole line on Enter.
Each key does what GNU Readline's emacs keys do, by readline's own command names (`keys.ts`).

- **Moving.** Ctrl-A and Home, Ctrl-E and End, Ctrl-B and Left, Ctrl-F and Right, Alt-B and
  Alt-F by words. A word is letters and digits, as in readline.
- **Cutting.** Ctrl-K to the end, Ctrl-U to the start, Ctrl-W the word before (by spaces, as
  readline's `unix-word-rubout`), Alt-D the word after, Alt-Backspace the word before. Ctrl-Y
  puts back the last cut. Cuts in a row join, as readline's kill ring does.
- **The rest.** Backspace, Delete, Ctrl-T swaps two characters, Ctrl-L clears the screen and keeps
  the line. A key it does not know does nothing, as in fish; readline would insert some of them.
- **Ctrl-C** at the prompt prints `^C` and a fresh prompt, as bash does. While a line runs, it
  stops the program in the foreground, and drops what was typed ahead, as a terminal does.
- **Ctrl-D** on an empty line ends tsh, and its tile closes, as `exit` would. On a line with text,
  it deletes the character under the cursor.
- **History.** Up and Down, or Ctrl-P and Ctrl-N. Ctrl-R searches back, as bash's
  `reverse-search-history`. A line run again moves to the end and is not kept twice (bash's
  `erasedups`). Blank lines are not kept. The last 1000 lines are kept in `history`, in the app's
  home, so Up finds them after a restart.
- **Tab.** Program names first on the line, a program's flags after it (from its own schema), and
  job ids after `%`. One match goes in whole, with a space after it. More than one: the part they
  share goes in, and a second Tab lists them in columns, as readline does. No match rings the
  bell.
- **Type-ahead.** Keys pressed while a line runs wait, and go to the next prompt.
- **Text from tsh while the prompt is up** (a background job ending) goes above the prompt, and
  the prompt is drawn again under it, with what was typed.

## The terminal

- **ghostty-web 0.4.0** (MIT, by Coder): Ghostty's terminal built to WebAssembly, drawn on a
  canvas, with an xterm.js-like API. Held at an exact version in the catalog. It has no
  dependencies.
- **The page's policy allows WebAssembly.** `DESK_CSP` in `files.ts` is the app's policy plus
  `'wasm-unsafe-eval'` in `script-src`, and nothing else. Chromium compiles no WebAssembly under
  `script-src 'self'` alone. `'wasm-unsafe-eval'` lets in WebAssembly and nothing else: no
  `eval`, no `new Function`, no inline script. Program views now share that page, so they share
  its policy.
- **The WebAssembly is compiled from bytes in the page's own script,** once, and every tile's
  terminal shares it. `Ghostty.load()` fetches a `data:` url, which the policy refuses
  (`connect-src` is `'none'`), so `build.ts` bundles the `.wasm` file as bytes and `terminal.ts`
  compiles them. The cost: ghostty-web's own bundle holds the same bytes as base64, so they are
  in `desk.js` twice, about 1.1 MB of its 2 MB.
- **Each terminal is made once, outside React,** and moved into its tile's slot. A split puts a
  tile in a new stack, and React would make it again, with a fresh, empty terminal.
- **The screen is kept as text too,** in a visually hidden region labelled with the tile ("t1
  screen"): the last 200 rows, up to the cursor's. The canvas is blank to a screen reader and to
  a test. Ghostty 0.4 declares `onRender` and never fires it, so the text is read back once a
  frame after a write. After every write, one busy tile froze the whole page for seconds
  (experiment 141).
- **16 tiles hold up** on one laptop: about 2.8 MB of renderer memory a terminal, idle frames at
  16.7 ms, and at most 34 ms with every tile printing at once (experiment 141).

### Taken from pull request 61

Pull request 61 is a draft with a terminal program of its own (`programs/terminal`) on
ghostty-web 0.4.0. Taken from it: the terminal's options (font size 14, a monospace font, a
blinking cursor, 1000 rows of scrollback; the cursor no longer blinks since 2026-10-25), fit on
open and then follow the window's size, the
screen read back as text after each write, the size clamped before it is sent, a length limit on
the keys message (64 KiB here, for a paste), and the test that tsh refuses a line before any window
opens. Left: its pty (`node-pty` and a native shell, a different product), `Ghostty.load()` (it
fetches a `data:` url), its React hook (this page holds no state), and its Esc and Ctrl-C buttons.

## Commands

```sh
pnpm fabrika                                  # build, then open the app
pnpm --filter @kampus/fabrika-app build       # dist/ only
pnpm --filter @kampus/fabrika-app e2e         # the flow end to end, screenshots in a temp folder
SHOTS=<folder> pnpm --filter @kampus/fabrika-app e2e
```

- The first run downloads Electron's binary, about 6 seconds. Electron 45 has no install script:
  it downloads on first use, so pnpm needs no `onlyBuiltDependencies` entry for it.
- `FABRIKA_HOME=<folder>` puts the app's own files there instead of Electron's folder:
  `desk.json`, `storage/tiles/<tile>/`, `history`, `ledger.sqlite`, the one-copy lock, and the
  host's `host/sock`, `host/pid` and `host/log`. A test on its own home can never reach another
  home's host. macOS caps a socket's path at 103 bytes; a home too deep stops the host with a
  plain message.
- The ledger is `ledger.sqlite`, on one node:sqlite connection in the host
  (`layerSqliteSync` from `@kampus/fabrika/sqlite`): the bundle has no worker file beside it, and
  a Miniflare child is more than one person's tickets need. Each call blocks the host while
  SQLite runs it. One host per home means one tsh writes each tile's job table. The end-to-end
  run uses a fresh home.
- `experiments/141-tiles-in-one-page.ts` measures 1, 4, 8 and 16 tiles on the built app.

## What it does not do yet

- **Wide characters.** The editor counts one cell per character, so a CJK character or an emoji
  on the line puts the cursor off.
- **Bracketed paste.** A pasted newline runs the line, as in a terminal with no bracketed paste.
- **An escape sequence cut across two messages** is read as two keys. Keys come from one
  `onData` each, so this has not been seen.
- **A resize does not redraw the line** already on the screen; the next one is drawn at the new
  width.
- **No Ctrl-Z and no `bg`:** a run in the foreground cannot be sent to the background.
- **The screen's text is not a live region**: a screen reader is not told of new text.
- **A program view is built into the app's bundle;** one from outside the app's build cannot be
  loaded.
- **Nothing clears a tile's folder** while the tile lives. Every run its tsh starts keeps its
  record there, ended or not.

Left for later, from Tuval's keys and the build:

- **The rest of Tuval's keys:** `w` (pick a tile from a list), `a` (focus the list), `:` (a
  command line), `r` (reload the config), `p` (the process board).
- **Coming back after a host stop with the runs' state** (the ledger lane). Today a host that
  stops ends its runs; the next one finds their jobs for `attach`, not running.
- **A way for a person to stop the host,** or to see that one runs.
- **A link that drops while the app runs** is not tried again: the page says "Not attached to
  the host" until the app starts again. tmux's client exits here; Tuval tried again.
- **Two apps starting at the same moment** on a home with no host can both start one. One wins
  the socket; tmux takes a lock file first, and so should this.
- **A host of another version is left as it is.** Nothing offers to stop it or to move its jobs.
- **The link's version counts the message shapes, not what they mean.** A change in behaviour
  with the same shapes is not caught.
- **Two windows on one host share each tile's size:** the last one to resize wins, as tmux's
  `window-size latest`.
- **An old `desk.json` with run tiles in it** is not read: the app starts on one fresh tile.
- **A crash leaves tile folders** that no `desk.json` names. Nothing cleans them yet.
- **The terminal build's single `storage/` folder is not moved over.** Its jobs are not found by
  any tile.
- **History: the last write wins.** Two tiles saving at the same moment can drop one line.
- **An unfocused terminal still shows a solid cursor.** ghostty-web 0.4.0 has only filled
  cursors (block, underline, bar) and no focus-aware or hollow one, so the hollow cursor waits
  for a ghostty-web that has it.
- **No packaging, signing or updates.**
