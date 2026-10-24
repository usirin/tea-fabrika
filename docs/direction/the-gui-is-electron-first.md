# The GUI is an Electron app first

Decided 2026-10-24. Replaces [The GUI is a local web page first](./the-gui-is-a-local-web-page-first.md)
of 2026-10-22. How the window loads a program's window code is still **open**.

```ts
// A sketch. One Electron app. No local port, so no secret.
//   main process   Node: runs the host and every program, the process the web note had
//   the window     Electron's renderer: tmux-like panes, each starts with tsh. Sandboxed, no Node.
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

- **A big dependency.** Electron 45 brings its own Chromium and Node 24. pnpm
  10 blocks install scripts by default, so `electron` has to be allowed in
  `onlyBuiltDependencies`, or its binary never downloads
  ([pnpm](https://pnpm.io/10.x/supply-chain-security)).
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

## Still open

- **How the window loads a program's window code.** Three ways:
  - built in: the app's bundle holds every window it knows. Simplest. A new
    package means rebuilding the app;
  - loaded at run time: the app serves each window as its own file, over its
    own protocol, without React inside, and an
    [import map](https://www.mercedes-benz.io/2023/01/05/you-might-not-need-module-federation-orchestrate-your-microfrontends-at-runtime-with-import-maps)
    hands every window the one React;
  - one sandboxed frame per window, as VS Code does with its webviews. A
    window cannot reach another pane. Each frame loads its own React.

## What would change it

- A need to run fabrika on a machine with no screen, such as a remote server.
  Then a web page comes back, with the secret and the `Origin` check.
