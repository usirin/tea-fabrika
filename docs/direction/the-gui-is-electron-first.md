# The GUI is an Electron app first

Decided 2026-10-24. Replaces [The GUI is a local web page first](./the-gui-is-a-local-web-page-first.md)
of 2026-10-22.

*2026-10-25: the window is tiled, as tmux and Tuval are, and every new tile
runs tsh. See [the last section](#decided-2026-10-25-tiles-like-tmux).*

```text
1. fabrika opens as a single window with tsh
2. tsh comes with the owner's programs loaded
3. the owner runs a program
4. if that program has a GUI, it takes over the window; when it ends, tsh is back
```

```ts
// A sketch. One Electron app. No local port, so no secret.
//   main process   Node: runs the host and every program, the process the web note had
//   the window     Electron's renderer: tsh, or the GUI of a program tsh started. Sandboxed, no Node.
//   between them   one MessagePort, carrying the same two message types as before

type ToPage = {type: "view"; pane: PaneId; data: unknown /* typed by the program's view schema */};
type FromPage = {type: "msg"; pane: PaneId; msg: unknown /* decoded by the program's Msg schema */};
```

```ts
// A sketch. The preload, the one bridge between the window and the main process.
// The window gets these two names and nothing else of Electron or Node.
ipcRenderer.once("port", (e) => {
	const [port] = e.ports;
	contextBridge.exposeInMainWorld("fabrika", {
		send: (m: FromPage) => port.postMessage(m),
		onView: (f: (m: ToPage) => void) => port.addEventListener("message", (e) => f(e.data)),
	});
	port.start();
});
```

## What was decided

- **The fabrika app is an Electron app from the start.** `pnpm fabrika` opens
  one window. Its main process is Node, and it runs the host and every
  program: the same process the web note had.
- **No local port and no secret.** The window and the main process talk over
  one Electron [MessagePort](https://www.electronjs.org/docs/tutorial/message-ports).
  Nothing outside the app can open it.
- **One copy at a time.** A second `pnpm fabrika` brings the first one's window
  to the front and quits. Electron gives this as
  [`app.requestSingleInstanceLock()`](https://www.electronjs.org/docs/latest/api/app)
  and its `second-instance` event. Two copies would write the same saved state.
- **Safety is Electron's own
  [checklist](https://www.electronjs.org/docs/latest/tutorial/security),**
  and most of it is on by default:
  - the window runs sandboxed, with context isolation and no Node: Electron's
    defaults since versions 20, 12 and 5;
  - the preload gives the window `send` and `onView`, and nothing else;
  - the main process checks the sender of every message;
  - the app loads only its own files, over its own protocol, not `file://`,
    and never a remote site.
- **Carried over from the web note unchanged:** views are typed both ways. A
  program's pure `view(state)` picks the data, with a schema. Its window is a
  React component on `<package>/window`. The host decodes every message with
  the program's Msg schema before `update` sees it. React holds only drafts.
- **The two message types are the protocol; the MessagePort is one way to
  carry them.** If a web page comes back (below), a WebSocket carries the same
  `ToPage` and `FromPage`, and the secret and the `Origin` check come back with
  it.

## Why

- **Results sooner.** A local port needs a secret made at start and an
  `Origin` check, because any site open in the browser and any program on the
  machine can reach it. Zoom's local server, in 2019, let any website start a
  call with the camera on
  ([report](https://thehackernews.com/2019/07/zoom-video-conferencing-hacking.html)).
  With no port, none of that is built.
- **It ships as an app on the operating system,** most likely packaged with
  Electron. Building for that shape now leaves no port to take out later.
- **The web note's reason to wait was weaker than it said.** Signing, updates
  and installers matter only when the app goes to other people. Running it on
  one's own machine needs none of them.
- **The web note's main doubt was the keys:** Cmd+W closing the tab, no global
  hotkey, no menu. Electron owns its keys and menus.

## What it costs

- **A big dependency.** Electron 45 brings its own Chromium and Node 24. ~~pnpm
  10 blocks install scripts by default, so `electron` has to be allowed in
  `onlyBuiltDependencies`, or its binary never downloads
  ([pnpm](https://pnpm.io/10.x/supply-chain-security)).~~ **Wrong** (found
  by the first build, below): Electron 45 has no install script. It
  downloads its binary the first time it is run, so pnpm has nothing to
  block.
- **Testing the window.** The host and the programs keep their plain tests,
  with no Electron. The window is tested through Playwright's
  [Electron support](https://playwright.dev/docs/api/class-electron), which
  Playwright calls experimental. On Linux CI, Electron needs a virtual display
  such as Xvfb ([Electron](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci)).
- **Child processes.** Inside Electron's main process, `process.execPath` is
  Electron, not Node. The local ledger starts its child with it
  (`packages/fabrika/src/host/local.ts`), so that child needs
  `ELECTRON_RUN_AS_NODE=1`, or Electron's `utilityProcess`.
- **An agent cannot open the app in a browser tab** to look at it. It drives
  the app through Playwright instead.
- **Packaging, signing and updates** still wait until the app goes to someone
  else.
- **How sure:** 80%. The doubt is whether Electron's own Node breaks something
  the host relies on, such as `node:sqlite` or the ledger's child process. The
  first run of the app settles it.

## How a program's window code gets in

- **Built into the app's bundle, for now** (2026-10-24, a build detail, not a
  product one). The programs tsh comes with are known when the app is built,
  so their windows are bundled with it. A new program means rebuilding the
  app.
- **Later, when a program comes from outside the app's own build,** it is
  loaded at run time instead: the app serves each window as its own file,
  over its own protocol, without React inside, and an
  [import map](https://www.mercedes-benz.io/2023/01/05/you-might-not-need-module-federation-orchestrate-your-microfrontends-at-runtime-with-import-maps)
  hands every window the one React. Only the loader changes; a window stays
  the same React component on `<package>/window`.
- **A window someone else wrote** may need its own sandboxed frame, as VS
  Code does with its webviews, so it cannot reach the rest of the app. That
  question comes with the first such window.

## What the first build found (2026-10-24)

The walking skeleton is [`apps/fabrika`](../../apps/fabrika/README.md), with
[`programs/counter`](../../programs/counter/README.md) as its one program with
a window. It answers the doubt above and changes three small things.

```ts
// A program says it has a window with a pure view of one machine (packages/fabrika/src/program/program.ts).
view: {machine: "count", data: Schema.Struct({n: Schema.Int}), of: (s) => ({n: s.n})}

// A message from the page names the run it is for, so one sent as that run ends is refused,
// not handed to whatever is under it. Its msg is one of that run's inputs.
type FromPage = {type: "msg"; pane: PaneId; to: string; msg: unknown};
readInput(counter, {type: "press", value: "plus"});   // {kind: "read", msg: {...}}
```

- **Electron's own Node runs `node:sqlite`.** Electron 45 is Node 24.22.0 and
  Chrome 156. `node:sqlite` opens a database in its main process (SQLite
  3.53.4). The doubt in "How sure" is settled for `node:sqlite`.
- **No install script** (the cost above, marked wrong). The binary downloads
  on first run, in about 6 seconds.
- **The ledgers that start a child or a worker are not used yet.**
  `local.ts` starts `process.execPath` (Electron, in the app) with a file found
  beside its own source, and `sqlite.ts` starts a worker from a file beside its
  own source. Bundled, neither file is beside the bundle. The skeleton keeps
  tsh's run in memory and its jobs in a folder (next bullet), so it needs
  neither. A real ledger in the app needs one of them made to work bundled,
  or `utilityProcess`.
- **tsh's jobs are kept in a folder, as the terminal tsh keeps them.** The
  app hands tsh `fileStorage(<home>/storage)` for its jobs. Quit the app with
  a job running and open it again: tsh says the job is from an earlier tsh,
  not running, and `attach %n` starts it again where it was. The folder
  storage is plain Effect `FileSystem`, so it works bundled. The ledger is
  still not used in the app.
- **Messages name their run** (`to`, above). The note's sketch had only the
  pane.
- **A program's Msg is its inputs.** Its window sends `{type, value}` for one
  of its declared inputs, read by that input's own schema. Inputs stay the
  only way into a program.
- **In tsh's foreground, a program with a window keeps its inputs open,** as
  a terminal feeds a foreground program's stdin; tsh waits for its end or
  Ctrl-C. Ctrl-C in the window goes to tsh.

## Proposed 2026-10-25: a terminal window, and a window per program

**Proposed**, not yet decided. It changes points 1 and 4 at the top of this
note. The build is in [`apps/fabrika`](../../apps/fabrika/README.md).

*Replaced in part the same day: the terminal and its line editor stay, but a
program no longer opens a window of its own. It runs in a tile
([next section](#decided-2026-10-25-tiles-like-tmux)).*

```text
1. fabrika opens as a terminal window, running tsh with a line editor
2. tsh comes with the owner's programs loaded
3. the owner runs a program
4. if that program has a GUI, it opens a window of its own; the terminal stays a terminal
```

```ts
// Two kinds of window, each with its own two message types (apps/fabrika/src/messages.ts).
// The terminal is a terminal and nothing more, as a terminal emulator is to a pty.
type ToTerminal = {type: "write"; data: string};
type FromTerminal = {type: "keys"; data: string} | {type: "size"; cols: number; rows: number};
// A program window draws one run. Its port is that run's, so a message names no run.
type ToWindow = {type: "view"; program: string; data: unknown};
type FromWindow = {type: "msg"; msg: unknown};

// The line editor is a tea machine in the main process: keys in, the bytes a terminal draws out.
replay(editor, {ctx, msgs: [{type: "keys", data: "cou\t"}]});
// writes "tsh$ counter ", Tab put in the one program that starts with "cou"
replay(editor, {ctx, msgs: [{type: "keys", data: "counter\r"}]});
// asks for line {text: "counter"}: tsh runs it, and counter's window opens
```

- **The terminal window runs tsh and nothing else.**
  [ghostty-web](https://github.com/coder/ghostty-web) 0.4.0 draws it:
  Ghostty's terminal, built to WebAssembly, on a canvas. The page sends keys
  and its size, and draws the bytes it is sent.
- **tsh and its line editor stay in the main process.** The editor is what
  readline is to bash, written as a pure tea machine with tests. Its keys are
  readline's emacs keys, by readline's own names. It keeps history across
  restarts, searches it with Ctrl-R, and completes program names, flags and
  job ids with Tab. There is no pty: tsh is not a process, so nothing needs
  one.
- **A run of a program with a window opens a window of its own,** as Unix
  job control would have it: in the foreground the prompt waits; with `&` it
  comes back at once; Ctrl-C in the terminal stops the foreground run, and its
  window closes. Closing a window closes the run's inputs, as the end of
  stdin does. Quitting the app keeps every job for `attach`.
- **Every window keeps the same safety rules:** made by one function,
  sandboxed, on the app's own scheme, every way out refused, and a port only
  for that window's own top frame on its own page.
- **The terminal's page lets in WebAssembly.** Its Content Security Policy adds
  `'wasm-unsafe-eval'` to `script-src`, and nothing else. Chromium compiles no
  WebAssembly without it. It does not let in `eval` or inline script. The
  program windows keep the policy with no WebAssembly.

### Why

- **tsh is never hidden.** When a program took over the one window, tsh was
  gone until it ended, and a program started with `&` covered tsh with no way
  back. A terminal that stays a terminal has no such case.
- **A real terminal is what people already know.** Cursor keys, Ctrl-R, Tab
  and history are muscle memory from bash. An input box gave none of them.
- **Job control is a known answer.** Foreground, background, Ctrl-C to the
  foreground only, and the end of input are Unix's own rules. Nothing new to
  learn, and nothing new to design.
- **The editor is testable as data.** Keys in and bytes out, with no
  Electron and no terminal: 42 tests fold keys through it and read the screen
  back.

### What it costs

- **One more window per run.** The person moves between windows with the
  operating system's own keys. A run with many windows open could get messy.
- **A young dependency.** ghostty-web is at 0.4 (MIT, by Coder), held at an
  exact version. It declares `onRender` but never fires it, so the page reads
  the screen back after each write.
- **The WebAssembly is in the terminal's script twice,** about 1.1 MB of its
  1.5 MB: once in ghostty-web's own bundle as base64, and once as the bytes the
  page compiles, since ghostty-web's own loader fetches a `data:` url, which
  the policy refuses.
- **A line editor of our own to keep.** Wide characters, bracketed paste and a
  redraw on resize are not done yet (the app's README lists them).
- **How sure:** 75%. The doubt is what closing a program's window should mean:
  the end of its inputs (this proposal), or stop, as closing a terminal sends
  `SIGHUP`. Watching people close windows with a job half done would settle
  it.

## Decided 2026-10-25: tiles, like tmux

**Decided** 2026-10-25. It replaces "a window per program" in the section
above. The terminal, ghostty-web and the line editor stay as they are.

```text
1. fabrika opens as one window with one tile, and the tile runs tsh
2. Ctrl-B then | or - splits the focused tile; the new tile runs a fresh tsh
3. a program with a GUI, run in the foreground, takes over its tile; when it ends, tsh is back
4. Ctrl-B then h, j, k or l moves the focus; Ctrl-B then x closes the tile
```

```ts
// A sketch. The layout is a pure tree, ported from Tuval's
// (kamp-us/phoenix, apps/tuval/src/shell/layout): tiles and stacks of tiles.
type Layout = TileNode | StackNode;
type TileNode = {tag: "tile"; id: TileId; shows: {kind: "tsh"} | {kind: "run"; run: RunId}};
type StackNode = {
	tag: "stack";
	id: StackId;
	orientation: "horizontal" | "vertical"; // side by side, or top to bottom
	children: ReadonlyArray<Layout>;
	sizes: ReadonlyArray<number>; // percent of the stack, always summing to 100
};

// The desk is a tea machine. The keys after the prefix are its Msgs.
update(desk, {type: "split", orientation: "horizontal"}); // a new tile beside, running a new tsh, focused
update(desk, {type: "focus", to: "left"});
update(desk, {type: "close"}); // the focused tile goes, and its tsh ends
```

| After Ctrl-B | What it does |
|---|---|
| `\|` or `-` | split side by side, or top to bottom |
| `h` `j` `k` `l`, or the arrows | focus left, down, up, right |
| `z` | zoom the focused tile; again to undo |
| `x` | close the focused tile |
| `N`, `Ctrl-H`, `Ctrl-L` | new workspace, previous, next |

- **One window, tiled the way Tuval was.**
  - Tuval's layout tree comes over as it is, with its tests: split, close,
    focus by direction, resize, zoom. It is pure and imports nothing but one
    Effect guard.
  - A border is dragged to resize. Workspaces work as Tuval's did.
  - The keys are Tuval's table, which is tmux's: Ctrl-B, then one key.
- **Every new tile runs tsh,** as every new tmux pane runs a shell. Each tile
  has its own tsh, with its own jobs.
- **A program with a GUI runs inside its tile,** as vim runs inside a tmux
  pane. In the foreground it covers its tile and tsh waits; Ctrl-C stops it
  and tsh is back. The other tiles stay as they were.
- **The page reads the prefix first.** Ctrl-B never reaches tsh or a
  program. Ctrl-B twice sends one Ctrl-B on, as tmux's `send-prefix` does.

### Why

- **Tuval's tiling was used every day** and its keys are muscle memory. It is
  the tmux model, which most terminal users already know.
- **A tile has its size from the layout,** so no program needs a window size
  of its own. The 520 by 420 windows of the terminal build had room for six
  tickets.
- **tsh is still never hidden.** A program covers one tile, not the app.

### What it costs

- **Many terminals on one page.** Each tile has its own ghostty-web terminal.
  How many one page holds before it slows down is not measured yet.
- **Ctrl-B is also readline's "back one character".** As in tmux, the prefix
  wins. The left arrow does the same, and Ctrl-B twice sends it on.
- **The windows of the terminal build go away,** and their code with them.
- **How sure: 85%.** The doubt is the many terminals on one page. The build
  will measure it.

### Open, with a lean

- **A program started with `&`:** it opens in a new tile beside its tsh, and
  the prompt comes back. This is Tuval's "a window of its own", which split
  the target window and put the run in the new half. 80%.
- **Closing a tile with a run in it:** a y or n question, then the tile's tsh
  and its runs end, as tmux's `kill-pane` hangs up the shell. It settles the
  75% doubt of the section above the tmux way. 75%, because Tuval's detach
  stopped nothing; seeing whether a closed tile's job is ever missed would
  settle it.
- **Quit and open again:** the layout comes back as it was, as Tuval kept its
  desk, and each tile's tsh comes back with its jobs for `attach`. 80%.
- **Closing the last tile quits the app,** as tmux ends with its last pane.
  70%. A fresh tsh in a fresh tile may be kinder; a week of use would show.

### What the build found (2026-10-25)

Each lean was built as written. The answer first: one page holds 16 tiles well
(experiment 141), after one fix to our own code.

```ts
// The desk is a pure tea machine in the page, stepped with applyCell.
// The main process is told what to do; it never keeps a layout of its own.
type FromDesk =
	| {type: "open"; tile: TileId}   // start this tile's tsh
	| {type: "close"; tile: TileId}  // end its tsh and runs, delete its folder
	| {type: "stop"; run: string}    // a covered run's Ctrl-C, or x on a run tile
	| {type: "save"; desk: Saved}    // desk.json in the app home
	| {type: "quit"};                // the last tile closed

type ToDesk =
	| {type: "start"; saved: unknown}                            // the page loaded: here is what was kept
	| {type: "covered" | "beside"; tile: TileId; run: {id: string; program: string}}
	| {type: "over"; run: string}
	| {type: "jobs"; tile: TileId; running: number}              // so x knows to ask
	| {type: "ended"; tile: TileId};                             // Ctrl-D in a tile's tsh
```

- **`&` opens a tile beside its tsh.** The tile is split and the run goes in the
  new half. The focus stays on the tsh, so the prompt is where the keys go.
- **x asks y or n** when the tile's tsh has a running job, or the tile shows a
  run. y ends the tsh and its runs and deletes the tile's own folder under
  `storage/tiles/`. A tile with nothing running closes at once, as tmux does.
- **Quit and open again** brings back the layout from `desk.json`, and each
  tile's tsh opens on its own folder, so `attach` finds the earlier jobs.
  Tiles that showed a run come back as plain tsh tiles: the run did not
  survive the quit.
- **The last tile closing quits the app** and removes `desk.json`, so the next
  start is one fresh tile.
- **The desk machine has a law test.** After every step of a random walk,
  the tree passes Tuval's own checks, and the focus names a tile that exists.
- **A port per tile and per run, plus one for the desk.** A message cannot
  reach the wrong tsh, and the main process routes by the port it came on,
  never by a name inside the message.
- **History is shared, jobs are not.** A line typed in one tile is the next
  tile's Up. Two tiles saving at once: the last write wins.

What was guessed wrong:

- **The guess was that many canvases would be the cost. Wrong.** The cost was
  our own text copy of the screen, read after every write. One tile printing
  2,000 lines froze the whole page for up to 7.8 s. Reading it once a frame
  fixed it.

| Tiles | Renderer MB | Busy frame max ms | Keydown to text median ms |
|---|---|---|---|
| 1 | 150.9 | 18.6 | 52.9 |
| 4 | 162.9 | 18.7 | 48.9 |
| 8 | 176.9 | 33.3 | 47.8 |
| 16 | 193.5 | 33.4 | 47.6 |

- **The 85% doubt of "What it costs" is settled** for this machine: about
  2.8 MB a terminal, and idle frames stay at 16.7 ms at every count.
- **Still open:** x on a run tile stops the run hard, not by closing its
  inputs. A crash leaves tile folders no `desk.json` names; nothing cleans
  them yet. The old single `storage/` folder of the terminal build is not
  moved over. Typing is 30 to 50 ms, mostly the trip to the main process.

## What would change it

- A need to run fabrika on a machine with no screen, such as a remote server.
  Then a web page comes back, with the secret and the `Origin` check.
