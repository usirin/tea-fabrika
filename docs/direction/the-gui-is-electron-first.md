# The GUI is an Electron app first

Decided 2026-10-24. Replaces [The GUI is a local web page first](./the-gui-is-a-local-web-page-first.md)
of 2026-10-22.

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

## What would change it

- A need to run fabrika on a machine with no screen, such as a remote server.
  Then a web page comes back, with the secret and the `Origin` check.
