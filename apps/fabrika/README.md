# fabrika app: `@kampus/fabrika-app`

The fabrika app, as a walking skeleton: the whole flow, thin. It is one window, tiled like
tmux. Every tile runs its own tsh, with the programs `counter`, `tracker`, `ticket`, `map`,
`runs` and `trace` loaded. A program with a view runs inside a tile. The design is
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
// The host's hello names its build too; one built before builds names none.
type Down = {type: "hello"; version: number; build?: string} | {type: "port" | "gone"; port: string}
	| {type: "to"; port: string; m: unknown} | {type: "close"};

// Between the page and the host, each on its own port (src/messages.ts); main relays them.
// "desk": the desk runs in the host. The page draws it, and sends the keys it takes and clicks.
type FromPage = {type: "press"; id: number; key: string} | {type: "click"; tile: TileId}
	| {type: "resize"; container: string; sizes: Record<string, number>}
	| {type: "fold"; tile: TileId} | {type: "unfold"; node: string}
	| {type: "area"; width: number; height: number}; // the workspace's size, so a line can fold
type ToPage = {type: "keys"; prefix: string; table: {key: string; repeats: boolean}[]}
	| {type: "desk"; desk: Desk; takes: {all: boolean; keys: string[]}}
	| {type: "answer"; id: number; took: boolean}
	// Main's own: what it found on attach, or how the link is lost (src/reconnect.ts).
	| {type: "link"; now: LinkNow};
type LinkNow = {kind: "up"} | {kind: "version"; theirs: number; ours: number}
	| {kind: "build"; theirs: string | null; ours: string}
	| {kind: "reconnecting" | "stopped"; why: string} | {kind: "restarting"};
// Main's own too: Try again, and "Stop the old host and start this one". The host never sees them.
type ToApp = {type: "again"} | {type: "restart"};
// "tile:t1": t1's terminal, as a terminal is to a pty.
type ToTerminal = {type: "write"; data: string};
type FromTerminal = {type: "keys"; data: string} | {type: "size"; cols: number; rows: number};
// "run:counter:1a2b": one run's view. The host reads `msg` with that run's program (`readInput`).
type ToWindow = {type: "view"; program: string; data: unknown /* its view schema reads it */};
type FromWindow = {type: "msg"; msg: unknown /* one of its run's inputs */};
```

## Where it sits

- The top layer of the workspace (`layer-rules.json`): it imports `@kampus/fabrika` and the
  programs in `programs/`, and nothing imports it.
- Electron is named only in `src/main.ts` and `src/preload.ts`. Node and
  `@effect/platform-node` are named at the edges: `src/main.ts`, `src/attach.ts`,
  `src/host/main.ts`, `src/host/run.ts`, `src/host/socket.ts`, `src/host/lock.ts` and
  `src/host/stop.ts`. Everything else is plain
  Effect, tested with no Electron. The page is React, with each terminal made outside it.
- **The host is a process of its own.** It is the app's own binary run as Node
  (`ELECTRON_RUN_AS_NODE=1`, on `dist/host.mjs`), started detached by the first app that finds
  none, and let go. No second runtime ships, and Electron's Node is the one the app was built and
  tested on. It holds the tiles (tsh and the line editor, one of each per tile), the ledger, the
  history and the desk.
- **One host per home.** Apps that find no host at the same moment each start one. The hosts
  take turns under `<home>/host/lock`, from the look at the socket until they listen, as tmux's
  `<socket>.lock` does: one listens, the rest find it answering and step aside, and every app
  attaches to it. No host removes a socket another one listens on.
- **The link is a Unix socket,** `<home>/host/sock`, mode 0600 in a 0700 folder. No TCP and no
  secret: the file's mode is the lock, as tmux's is. One JSON line a message (NDJSON), each read
  with an Effect Schema at both ends. A version handshake first (`link.ts`): an app of another
  version is not attached, says so, and leaves that host running.
- **Main is a thin relay.** It checks a page's hello, keeps a port per tile and run for the
  window's own page, and passes lines on. It holds no desk and no tiles. When the link drops,
  it attaches again (`reconnect.ts`), and the window keeps the desk drawn, dimmed, meanwhile.
- A tile's terminal only draws bytes and sends keys, as a terminal does with a pty. There is no
  pty and no `node-pty`: tsh is not a process, so there is nothing to give a pty to.
- **The desk (the layout, the focus, the prefix, the question) is a tea machine in the host.**
  The page only draws it. A reload, a new window or a second client draws the same desk.

## What's in it

| File | What it does |
|---|---|
| `src/main.ts` | The Electron edge, a thin relay. One copy at a time; at most one window, sandboxed, on the app's own scheme; every way out refused, and a link's URL handed to the person's own browser (`outside.ts`). Attaches to the host, or starts it. A port per tile, per run and one for the desk, handed only to the window's own top frame on its own page, and lines passed between them and the host. On macOS the window hides its title bar and keeps the system's buttons in the page's top bar. It sets the Dock badge to the asks count, and notifies a new ask only when the window is not focused. |
| `src/outside.ts` | What leaves the window: a link's URL, to the person's own browser (`Browser`, which main gives `shell.openExternal`). Only http and https, and only from the desk page; any other scheme is refused. |
| `src/launch.ts` | How this start shows itself, decided once from the environment: the owner's, quiet (a home of its own), or in the foreground on a home (`FABRIKA_FOREGROUND=1`). |
| `src/attach.ts` | The app's side: reach the socket; if no host answers, start one and wait for it to listen; then the link and its handshake. A host that says no hello within 10 s fails the try (`NoHello`), and the try closes its socket. A host it started that steps aside for another is no failure: it attaches to the one that answers. |
| `src/reconnect.ts` | When the app attaches again, a tea machine above the link: `reconnectMachine`, Model `Reconnect`, Msg `ReconnectMsg`, Cmds `ReconnectCmd`. A link that ends is tried again after a wait (AWS's full jitter, 0.5 s doubling to 30 s), the same way as at the start; five minutes on it stops and waits for Try again. A host of another version is never tried again; once the person confirms, it and a host of another build are stopped and this build's is started (`restart` in `attach.ts`). `noteOf` is what the window says meanwhile. |
| `src/link.ts` | The link's two message types (`Up`, `Down`) and its handshake, a tea machine: `linkMachine`, Model `Link`, Msg `LinkMsg`, Cmds `LinkCmd`. |
| `src/wire.ts` | One link on one socket for either side: NDJSON framing (Effect's `Ndjson`), the handshake stepped on every line, `Unattached` when it does not come up. |
| `src/host/` | The host process. `main.ts` is the entry (`dist/host.mjs`). `run.ts` makes the folder, and under the start lock (`lock.ts`) cleans a stale socket, listens and writes the pid; then it opens the ledger, history and desk. `serve.ts` (no platform) runs the desk and the tiles, and serves every client. `socket.ts` reaches a socket: live, absent or stale. `agents.ts` serves each agent's MCP bridge on `host/mcp` (see [An agent drives a program](#an-agent-drives-a-program)). `jev.ts` turns on Jev, for the tracker's duplicate hint, only when the home holds `jev.key`; a test's home never does, so no test spends. |
| `src/cli.ts` | The command line: `connect`, `invite`, `members`, `move`, `post`, and `mcp`, the bridge an MCP client starts. |
| `src/preload.ts` | Gives the page `send`, `onMessage` and `forget`, by port name, and nothing else. |
| `src/bridge.ts` | Those names, as the page sees them, the port names it takes, and the IPC channel. |
| `src/tiles.ts` | One tsh per tile, each in its own scope. It tells the desk (`TileNews`) when a run covers a tile, when it is over, the tile's jobs, and when a closing tile has ended. `close` ends the inputs of the tile's tsh and its runs; `stop` ends its scope and drops its folder. `end` and `kill` do the same for one process of a line, by its pid: a window of the line closed. |
| `src/tsh.ts` | One tile's tsh: starts it with the app's programs, runs the line editor between tsh and the terminal, and says whether each run is in the foreground or the background. Each screen shows to every page that asks, starting with a terminal reset, so a page that still holds the screen draws it once. It tells its tile its jobs (`src/tile-jobs.ts`): each job of the host's table it started that still runs, with when it began by the host's clock, and the last to end, with how (`done`, `failed`, `stopped`, read off its runs' ends). The table keeps neither. It is handed the `Ledger` and gives it to the tracker, which writes as `user:owner`, and the tracker's `PullRequests`, which the host makes on the pipeline's `CodeHost` and the person's own `gh` login (`src/host/main.ts`). |
| `src/desk/` | The desk, a tea machine (`desk.ts`): `deskMachine`, Model `Desk`, Msg `DeskMsg`, Cmds `DeskCmd`; `DeskSchema` sends it to a page, and `takenNow` says which keys it takes now. `hold.ts` is the page's key holder: `holdMachine`, Model `Hold`, Msg `HoldMsg`, Cmds `HoldCmd`. `keys.ts` is the prefix and its table. `layout/` is Tuval's layout tree, ported with its tests, the leaf named "tile". A container runs `horizontal` or `vertical`, and nested containers alternate; any tile can fold into a strip, and a container whose tiles are all folded counts as folded (`isFolded`) ([fold, not tabs](../../docs/direction/fold-not-tabs.md)). `layout/line.ts` opens a tsh line's windows in place (`openLine`), folds them past `MIN_WINDOW`, and drops them from a kept desk (`quiet`). |
| `src/editor/` | The line editor, a tea machine: keys in, screen bytes out (`editor.ts`). `keys.ts` names each key, `screen.ts` draws, `cells.ts` lays text out in cells as ghostty-web does, from a table of its wasm's answers (`cells.table.ts`), `history.ts` keeps the history in a file, shared by every tile, `grid.ts` reads bytes back as rows for the tests. |
| `src/messages.ts` | The seven message types as Effect Schemas, and their strict readers. |
| `src/files.ts` | What the app's own scheme serves: one page, its script and one stylesheet, with a Content Security Policy. |
| `src/asks.ts` | The one count of asks, a tea machine in the host (`asksMachine`): it reads the ledger's facts once a second when there is news and folds what waits on the person. Main reads the same value off the desk port for the Dock badge and the notification. The person's later and seen (`Marks`) come in as its flags from `asks.json`, and the host writes them back on each change (`src/host/serve.ts`). |
| `src/window/` | `desk.tsx`, the page: the tiles, their title bars and borders, the strips of folded tiles. `frame.ts` and `frame.tsx`, the window's frame: the top bar, the bottom line, the asks list and the palette (see [The window's frame](#the-windows-frame)). `pop.ts` and `pop.tsx`, what opens over the desk: one raised box of rows for every popover (`Menu`, `Palette`, `Panel`, `useTip`), its keys as one pure function (`menuKey`), by [the popover rule](../../docs/direction/popovers.md). `terminal.ts`, a tile's terminal: ghostty-web, made once and moved between slots. `windows.tsx` lists each program view the app knows. `window.css` holds the app's color tokens at its top; a program's view uses them and has no theme of its own. |
| `build.ts` | Bundles `dist/` with esbuild: `main.mjs`, `host.mjs`, `preload.cjs`, `desk.js`, and the page's plain files. |
| `table.ts` | Writes `src/editor/cells.table.ts`: asks ghostty-web's wasm the width and grapheme class of every code point (`cells.probe.ts`). Run it with `pnpm table` after a new ghostty-web; `cells.test.ts` fails until then. |
| `shots.ts` | The page alone in headless Chromium, with no Electron and no host: the built `dist/`, handed a desk and the tracker, ticket, map and runs views of the stand-in ticket #7 and the trace of `seq --to 3 | tally` (as it opens, and opened down to the step add 2), as the host would send them. Two of its desks come from the desk machine's own steps: `tracker | ticket | runs` opened beside the map, and in a spot too tight, its extra windows folded. Writes `docs/round-6/*.png`. No window, no network. Not in `pnpm test`. |
| `e2e.ts` | Drives the built app through Playwright, one screenshot per step: split, focus, the asks list and the palette (focus in, no key through to the tile under them, Escape and a click outside giving focus back, one open at a time), a covered run, the close question, `&` and `attach`, a link in a ticket clicked, zoom, a closing tile, the stop question, Ctrl-B twice, shared history, the safety checks, the red button and the dock icon, then quit with the host and counter running on, open again on the same desk, a split through the host, the last tile closing the window, a host of another version, and the link dropping: the socket cut, the host killed, and no host until Try again. It stops its own hosts by their pids and checks with `pgrep`. Not in `pnpm test`. macOS only. It swaps main's `shell.openExternal` for a list first, so it never opens a real browser. |

## Keys

Ctrl-B, then one key, as in tmux. Tuval had the same table.

| After Ctrl-B | What it does |
|---|---|
| `\|` or `-` | split the focused tile side by side, or top to bottom; the new tile runs a fresh tsh |
| `h` `j` `k` `l`, or the arrows | focus left, down, up, right; focus on a strip opens it |
| `Space` | turn the focused tile's container: horizontal, then vertical (tmux's next-layout) |
| `f` | fold the focused tile into a strip; not the last open tile on the workspace |
| `z` | zoom the focused tile; again to undo |
| `x` | ask `close t2? (y/n)`, then close the focused tile; on a closing tile, ask `stop t2 now? (y/n)` |
| `N` | a new workspace, with one tile |
| `1` to `9` | go to that workspace |
| `Ctrl-H`, `Ctrl-L` | the previous or next workspace; press again within 500 ms with no Ctrl-B |
| `a` | open the asks list, or close it |
| `J` | open the jobs list, or close it |
| `?` | every key, with its name |
| `i` | info mode: the bottom line explains whatever the pointer is over; again to stop |
| `B` | hide both bars; again to show them |
| `Ctrl-B` | send one Ctrl-B on, to tsh or the program (tmux's `send-prefix`) |

`Cmd-K` (no prefix) opens the palette: every command by name, in groups (Tile, Focus,
Workspace, Window), with its keys as Mac keycaps (`⌃B` `Z`). Type to narrow it, the matched
letters bold; Enter runs one as its key would, and the bottom line then says `next time: C-b z`.
`C-b ?` opens the same list as "Keyboard shortcuts".
This is the app-level palette that tracker ticket 71 asked about. Today it lists the window's
commands; programs' inputs join it later, from the same list that makes the agent tools.
Ghostty's own palette opens with Cmd-Shift-P and takes user entries (`command-palette-entry`);
ours opens with Cmd-K, as Linear's does.

- **The host decides keys.** It sends the page the Ctrl-B table, and with every desk the keys
  the desk takes now. The page reads keys first, in the keydown capture phase. A key the desk
  takes goes to the host as a `press`, and neither ghostty-web nor a program's view sees it.
  Keys after it are held, in order, until the host answers (`hold.ts`), with no timer. An answer
  of `took: false` lets the key go on as it was. Any other key after the prefix does nothing, as
  in tmux.
- **Typing in a tile goes to the host,** on the tile's port, to its tsh. A text box in a program's
  view stays in the page; the program gets only the inputs it declares.
- **A click focuses a tile. Dragging a border resizes** the two open tiles beside it. A
  double-click on a tile's title bar folds it, as in Ableton Live; one click there only focuses.
- **A folded tile is a thin strip in its place,** standing up in a row and lying down in a
  column, named by its program. A column whose tiles are all folded is one strip with all their
  names. A click on a strip opens it. A folded tile keeps its size; the open tiles share the
  space. Focus is always on an open tile.
- **Ctrl-B is readline's "back one character" too.** The prefix wins; the left arrow does the
  same, and Ctrl-B twice sends it on.

## The window's frame

Two plain lines around the tiles (`src/window/frame.ts` for the words, `frame.tsx` to draw them):

```text
● ● ●  1 #7   2 tsh   tracker | ticket | runs                                            2 ask you •
...tiles...
t2 ticket #7 · takes ticket · sends ticket · from tracker → runs                C-b i info · C-b ? keys
```

When something is wrong, its word joins the top bar's right end, in red where it is broken:

```text
                                               2 ask you · ledger unreachable · host down · try again
```

- **The top bar is the whole desk:** the workspaces, the focused workspace's line, then what
  needs you. On macOS it is the window's title bar (`hiddenInset`): the system's three buttons
  sit in its first 84 px, its empty stretch moves the window, and its items are buttons that
  never do. Other platforms keep the system's own frame above it.
- **A part that works says nothing.** The host shows up only when it is not up: `connecting`,
  `host down`, `host older`, `host restarting`, or the other link version. A click opens its few
  lines, with the restart or Try again where one applies. The ledger shows up only when a read
  failed, as `ledger unreachable`; a click says why. The asks it last read stay, drawn faint
  while the host is down.
- **The bottom line is where you are:** the focused tile, what it takes and sends, its
  neighbors in its line, and its job. What it takes is the data a pipe can feed it,
  by tsh's own rule (`Shell.fedBy`: an input some program's output fits), never its commands:
  the ticket takes `ticket`, not `close` or `quit`. After Ctrl-B it lists the keys (`PREFIX`); your
  own close question is asked here (and in the tile's title bar), as tmux asks it. An agent's
  ask never shows here.
- **The job item names the job the tile runs,** from the host's table: `%3 seq --to 9 | tally
  2m`, and `+2` when two more run there. It is the job tsh waits for, as tmux's status line names
  a pane's foreground command, or else the newest one, as bash's current job. How long it has
  run is said calmly: seconds in the first minute (`14s`), then minutes (`2m`), then `1h 5m`.
  A job that ended says so for 5 seconds (`done in 2m`, `failed after 14s`, `stopped after 1s`,
  or `failed at once` within its first second), in plain words and never in red, then the item clears; one that ended in the foreground in
  under 5 seconds is not said, as tsh printed how under the cursor. With nothing running there
  is no item. There is no clock: the system's menu bar has one.
- **A click on the job item, or `C-b J`, lists the jobs,** as tsh's `jobs` lists the table: a
  menu over the bottom line, with focus in it. The tile's own jobs come first, then its last to
  end (under Last ended), then each other tile's (under Other tiles). A row is the job's line as
  typed, its `%n` and tile under it, and at the right how long it has run (or how long ago it
  ended, `2m ago`). The head counts the running jobs it lists. A part with no rows is left out,
  so a tile that runs nothing opens straight on Other tiles. `↑` `↓` or `J` `K` move, `↵`
  focuses the tile the job runs in, `Esc` or a click outside closes it and gives focus back.
  With nothing running anywhere, the head has no count and one calm line says so, with tsh's
  `jobs` and `attach %n`. There is no
  trace to open for a job yet: the app's `trace` reads only records held in memory, until the
  host keeps each job's record.
- **One count of asks.** The host folds the ledger's facts as the tracker does (`src/asks.ts`):
  each open ask on an open ticket, and each run that ended stuck. The top bar, the Dock badge
  and the asks list all read that one value. A click on the count, or `C-b a`, opens the list,
  a menu with focus in it: one row per ask (what it asks, its ticket and tile under it, its
  time), `↑` `↓` or `J` `K` to move, `↵` to open, `H` to set the ask aside (Later) or bring it
  back, `Esc` or a click outside to close, focus back where it was. `↵` focuses the tile that
  shows the ticket; when none does, it turns the tracker to the ticket and focuses the tracker;
  with no tracker on the desk, the bottom line says so. You answer in the ticket's own tile. A
  set-aside ask leaves the count and waits under Later, at the list's foot. While the list or
  the palette is open, no key it reads reaches a tile. A new ask never moves focus; with the
  window not focused, the system notifies once.
  Later and seen are yours, not the ticket's: the host keeps them in your home's `asks.json`,
  so a host restart keeps them, and two people on one shared ledger each keep their own. An
  ask answered meanwhile drops out of the file at the host's first read. A file that does not
  read starts with every ask counted and new, and the host's log says why.
- **Every item is a button with a tooltip:** its name and its keys as keycaps (`Asks` `⌃B`
  `A`), after the pointer rests 700 ms, at once within 300 ms of the last one, as Radix does;
  keyboard focus shows it too. The bars themselves keep tmux's spelling, `C-b a`.
- **Color is never alone.** The accent says "asks you" and red says "broken", each beside its
  word; running and done are gray words.

## Tiles

- **Every new tile runs a tsh of its own,** with its own job table, in
  `storage/tiles/<tile>/` in the app home. History is one file, shared: a line typed in one tile
  is the next tile's Up.
- **A run in the foreground covers its tile.** tsh waits behind it. Ctrl-C stops it, and tsh is
  back. The other tiles stay as they were.
- **A line with several windows opens in place,** in the tile it was typed in
  ([a line opens in place](../../docs/direction/fold-not-tabs.md#a-line-opens-in-place)).
  `tracker | ticket | runs` in t2: the tracker covers t2, and the ticket and the runs open as
  new tiles beside it, in t2's place, each with a third of its space. In a row they become
  siblings; in a column they nest as a row. Past 220 by 120 px a window, all but the first open
  folded. Unfolding one takes space only from the line's other windows.
- **The line carries the ticket picked.** Pick #7 in the tracker, and the ticket and the runs
  both show #7; pick another, and both follow. Each sends the ticket it is on, by its number,
  each time that changes ([the pipe the line carries](../../docs/direction/fold-not-tabs.md#the-pipe-the-line-carries)).
  The line can go on: in `tracker | ticket | runs | trace`, a run picked in the runs opens its
  job's trace in the fourth window.
- **A line's tiles and strips share one faint tint,** one of six, the first no other line has.
  A run alone has none.
- **A line's other windows have no tsh.** Ctrl-C in one goes to the typed-in tile's tsh. A
  window goes when its run ends, and a kept desk reads back without them.
- **A run with `&` is a job in the background, and no tile opens.** The prompt is back at once.
  `attach %n` brings it into the tile, as bash's `fg` does.
- **Ctrl-B x always asks, as tmux's `kill-pane` does:** `close t2? (y/n)`. Only y says yes; any
  other key says no.
  - On a tile with nothing running, y closes it at once.
  - On a busy tile, y gives tsh and every run it started `close`: the end of their inputs, as a
    hung-up terminal gives a shell. It does not stop them. The tile shows "closing" until they
    have all ended, then it goes. There is no timer.
  - Ctrl-B x on a closing tile asks `stop t2 now? (y/n)`. y stops them, and the tile goes.
  - On one window of a line, y ends that one process: it gets the end of its inputs (`end`), and
    its window goes when it is over. Its neighbours follow the pipes. In
    `tracker | ticket | runs`, closing the ticket's window leaves the runs on the last ticket,
    and the tracker's next pick fails: `tsh: tracker failed: tracker sent ticket down a pipe that
    answered stopped`. Asked again, `stop t3 now?`, y stops the process (`kill`).
  - The typed-in tile of a line holds its tsh: closing it ends tsh and every process of the line.
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
- **A person stops the host only from the window,** when it runs another version or build: "Stop
  the old host and start this one" (`src/host/stop.ts`). Tests stop their own by its pid, in their
  own home. A host that stopped leaves `desk.json`: the next host starts the layout from
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

## Links

A link in a program's view opens in the person's own browser, never in the app's window, as
Electron's security checklist has it (items 13 to 15).

```ts
// In a view: a plain link that asks for a new window.
<a href="https://example.com/a" target="_blank" rel="noreferrer">https://example.com/a</a>

// In main: no window is ever made. The URL goes to outside.ts, then to shell.openExternal.
openOutside({url: "https://example.com/a", from: DESK})  // {kind: "open", url: "https://example.com/a"}
openOutside({url: "file:///etc/hosts", from: DESK})      // {kind: "refused", why: "file: is not http or https"}
```

- **Only http and https open,** read by the URL parser, and opened as it writes the URL back, so
  the URL checked is the URL opened. Anything else (`file:`, `javascript:`, `fabrika:`, a custom
  scheme) is refused, and main says so on its console.
- **Only the desk page may ask.** A window open from any other page is refused.
- **The window never navigates.** A link with no `target="_blank"` does nothing: main refuses the
  navigation, and nothing opens outside.
- The tracker links URLs in a ticket's and a comment's body (`programs/tracker/src/links.ts`),
  and each open pull request on its list.

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
- **Wide characters and accents.** The editor counts cells as ghostty-web does: a CJK character
  or an emoji takes two, an accent joins the letter before it, an emoji with U+FE0F takes two.
- **A resize** leaves the line to the terminal, which reflows it. The editor writes nothing then;
  its next redraw finds the prompt by the new width. A blank after the line keeps the cursor on
  a written cell, which the reflow carries with the text.

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
  tile in a new container, and React would make it again, with a fresh, empty terminal.
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

## An agent drives a program

Claude Code (or any MCP client) can drive the app's programs while you watch. Tell it once
where the app's home is:

```sh
claude mcp add --transport stdio --env FABRIKA_HOME=<home> fabrika -- \
  node <repo>/apps/fabrika/src/cli.ts mcp --as claude
```

- `fabrika mcp` is a stdio bridge: it passes MCP's lines to the running host on
  `<home>/host/mcp`, a socket only you can open (mode 0600). The host serves MCP itself, with the
  official SDK (`@kampus/fabrika/mcp`, spec 2026-07-28). With no host running, the bridge says so
  on stderr and ends: open the app first.
- **The tools are the programs' inputs.** One tool per input, named `<program>_<input>`, with
  the input's own description and its schema as JSON Schema (`tracker_file`, `tracker_query`,
  `ticket_comment`, `ticket_ticket`, `counter_press`). Each command is its own input, named by
  its verb, so each is its own tool. An input declared `{writes: false}` carries MCP's
  `readOnlyHint` (`tracker_query`, and `runs`). One more, `runs`, lists every program and its
  tools, the agent's own runs, and what runs in your tiles.
- **The agent writes as itself.** Its calls go to its own run of the program, started on first
  use, whose writer is `agent:claude` for you. Nothing it sends can name you: the bridge's
  handshake holds only an agent's name, and the host makes the writer. An agent has no
  `tracker_answer`, `ticket_answer` or `tracker_rate_duplicate`: each is an input only a person
  tells (`{personOnly: true}`), so no tool is made for it. Behind that, the tracker refuses an agent's answer, as it
  refuses any agent's.

What you see: type `tracker` in a tile. Ask Claude Code "file a ticket for X under #44". It calls
`tracker_file` with `{value: {title: "X", body: "Under #44."}}`, and within a second the ticket
is on your tile's list; its first row says `agent:claude`.

Not yet: a home connected to a ledger server has no agents' socket (there the server's door
would stamp what the host writes as you). The agent's runs end when its client goes.

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
  `desk.json`, `asks.json`, `storage/tiles/<tile>/`, `history`, `ledger.sqlite`, the one-copy lock, and the
  host's `host/sock`, `host/mcp` (agents, on a home with its own ledger), `host/pid`, `host/log`, and `host/lock` while a host starts. A test on its own home can never reach another
  home's host. macOS caps a socket's path at 103 bytes; a home too deep stops the host with a
  plain message.
- **A start with `FABRIKA_HOME` is quiet** (`src/launch.ts`): no Dock icon, and its window shows
  without taking focus and keeps drawing when covered, so an agent's test never takes the
  person's keys. `FABRIKA_FOREGROUND=1` shows it as a normal window.
- The ledger is `ledger.sqlite`, on one node:sqlite connection in the host
  (`layerSqliteSync` from `@kampus/fabrika/sqlite`): the bundle has no worker file beside it, and
  a Miniflare child is more than one person's tickets need. Each call blocks the host while
  SQLite runs it. One host per home means one tsh writes each tile's job table. The end-to-end
  run uses a fresh home.
- `experiments/141-tiles-in-one-page.ts` measures 1, 4, 8 and 16 tiles on the built app.

## What it does not do yet

- **One real line only.** `tracker | ticket | runs` is the one line whose programs pipe a
  ticket, and `runs | trace` the one that pipes a run's trace id. The map takes no ticket from
  a pipe yet; `trace` takes a trace id, never a ticket.
- **An upstream ends on its next send, not at once.** With the ticket's window closed, the
  tracker in `tracker | ticket | runs` looks alive until the next pick, then fails.

- **The cursor moves one code point at a time.** It can stop between a letter and its accent,
  which readline steps over, or inside an emoji made of several.
- **A line with a wide character is drawn whole on each key,** not one row: the one-row redraw
  is for lines with no character at or past U+1100.
- **Bracketed paste.** A pasted newline runs the line, as in a terminal with no bracketed paste.
- **An escape sequence cut across two messages** is read as two keys. Keys come from one
  `onData` each, so this has not been seen.
- **No Ctrl-Z and no `bg`:** a run in the foreground cannot be sent to the background.
- **The screen's text is not a live region**: a screen reader is not told of new text.
- **A program view is built into the app's bundle;** one from outside the app's build cannot be
  loaded.
- **Nothing clears a tile's folder** while the tile lives. Every run its tsh starts keeps its
  record there, ended or not.

Left for later, from Tuval's keys and the build:

- **The rest of Tuval's keys:** `w` (pick a tile from a list), `:` (a command line), `r`
  (reload the config), `p` (the process board). Tuval's `a` (focus the list) is the asks list
  here.
- **The frame's own gaps,** each a tracker ticket, built as its own change once it has a real
  source: the outbox count, `N to send` (ticket 101); answering from the asks list (ticket
  102); the agents item, today's cost, and keys and tsh words for the frame's items (ticket
  103).
- **Later and seen are kept per home, not per person.** The same person on two machines sets an
  ask aside on each. They move with the desk if the desk moves onto the ledger (ticket 3).
- **The job item opening the job's trace,** once the host keeps each job's record
  (`packages/fabrika/src/host/traces.ts`) and the app's `trace` reads it. Today it lists the jobs.
- **Coming back after a host stop with the runs' state** (the ledger lane). Today a host that
  stops ends its runs; the next one finds their jobs for `attach`, not running.
- **A way for a person to stop the host,** or to see that one runs.
- **Keys typed while the link is down go nowhere.** The desk is out of reach until it is back;
  nothing is kept to send later.
- **A host that dies while it holds the start lock,** in the few ms it takes to start, leaves the
  lock with its pid. The next host takes it over. Two hosts that take over the same dead lock at
  the same moment can both get through, as with Chromium's and proper-lockfile's own locks. A
  lock whose pid was given to another live process is waited on for 10 s, then the host stops
  and names the lock.
- **A host of another version or build is stopped only when the person confirms,** and its running
  jobs stop with it. They come back with `attach %n`. A job whose kind's `recovered` sends a
  call that was out sends it again
  ([an old host is named, then restarted](../../docs/direction/an-old-host-is-named-then-restarted.md)).
- **An old app that meets a newer host** reads the build in its hello as a bad line, and closes
  the link.
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
