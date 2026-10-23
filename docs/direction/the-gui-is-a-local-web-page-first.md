# The GUI is a local web page first

Decided 2026-10-22. Typed view data is **proposed**.

```ts
// A sketch. One Node process runs the programs and serves the page.
//   the fabrika app   http://localhost:<port>, tmux-like panes, each starts with tsh
//   a browser tab     only a view, over one WebSocket to that process
//   later, Electron   loads the same page; its main process runs the same host

type ToPage = {type: "view"; pane: PaneId; data: unknown /* typed by the program's view schema */};
type FromPage = {type: "msg"; pane: PaneId; msg: unknown /* decoded by the program's Msg schema */};
```

## What was decided

- **The fabrika app runs first as a web page on localhost.** One Node process
  runs the programs and serves the page. A browser tab is only a view. Closing
  it stops nothing.
- **Electron comes later**, as a thin wrapper around the same page. The page
  should need no change for it.
- **No Rust for now.** The whole thing is built in TypeScript first. A Rust
  port is a later question.
- **Proposed: views are typed both ways.** The page gets view data shaped by
  the program's own schema. Every message from the page is decoded with the
  program's Msg schema before it reaches `update`. One that does not decode is
  refused, never passed on.

## Why

- **Tuval, the earlier GUI in kamp-us/phoenix, already works this way:** one
  Node process, the browser as a view over one WebSocket. The shape is tried.
- **No packaging work while the shape still moves.** Electron brings signing,
  updates and installers. None of that helps us learn what the app is.
- **Electron's main process is Node,** so the host moves into it as it is.
- **Typed views keep the checker honest.** A checker sees only typed messages.
  Tuval sent each window the whole state as `unknown` and took its messages
  back unchecked, so a window could send a message its machine never expected.

## What it costs

- **Keys.** The browser keeps some shortcuts: Cmd+W closes the tab, not the
  pane. There is no global hotkey, no native menu and no tray.
- **An open port.** Any web page in the same browser can try to open a
  WebSocket to localhost, and the browser does not stop it. The host runs
  agents, so the socket must check the `Origin` header and a token made at
  start, from the first version.
- **How sure:** 85%. The doubt is the keys. A week of daily use settles it.

## What would change it

- Key clashes that hurt every day. Then Electron comes sooner.
- A need a browser cannot meet, such as a global hotkey or native file drops.
