# The GUI is a local web page first

Decided 2026-10-22. How the page loads a window is **open**.

*Replaced 2026-10-24 by [The GUI is an Electron app first](./the-gui-is-electron-first.md):
the app is Electron from the start, with no local port and no secret. The
typed views below carry over unchanged.*

```ts
// A sketch. One Node process runs the programs and serves the page.
//   the fabrika app   http://localhost:<port>, tmux-like panes, each starts with tsh
//   a browser tab     only a view, over one WebSocket to that process
//   later, Electron   loads the same page; its main process runs the same host

type ToPage = {type: "view"; pane: PaneId; data: unknown /* typed by the program's view schema */};
type FromPage = {type: "msg"; pane: PaneId; msg: unknown /* decoded by the program's Msg schema */};
```

```tsx
// A sketch. The program has no React in it, so a host with no screen never loads React.
// @kampus/owner-desk
export const DeskView = Schema.Struct({asks: Schema.Array(AskRow)});
export const Desk = Program.make({
	/* init, update... */
	view: (s) => ({asks: s.asks.map(({id, plan, for: f}) => ({id, plan, for: f}))}),
});

// @kampus/owner-desk/window: plain React, drawing the view data and sending Msgs
export function DeskWindow({view, send}: WindowProps<typeof Desk>) {
	const [why, setWhy] = useState(""); // a draft, not sent yet
	return view.asks.map((a) => (
		<div key={a.id}>
			{a.plan} wants {a.for}
			<input value={why} onChange={(e) => setWhy(e.target.value)} />
			<button onClick={() => send({type: "answered", id: a.id, yes: false, why})}>no</button>
		</div>
	));
}
```

## What was decided

- **The fabrika app runs first as a web page on localhost.** One Node process
  runs the programs and serves the page. A browser tab is only a view. Closing
  it stops nothing.
- **Electron comes later**, as a thin wrapper around the same page. The page
  should need no change for it.
- **No Rust for now.** The whole thing is built in TypeScript first. A Rust
  port is a later question.
- **Windows are React, and views are typed both ways.**
  - The program has a pure `view(state)` that picks what the screen needs,
    with a schema for that shape. No React in it. The checker can call it.
  - The window is a React component in the same package, on its own import
    path (`<package>/window`). It draws the view data and calls `send(msg)`.
  - The host decodes every message with the program's Msg schema before it
    reaches `update`. One that does not decode is refused, never passed on.
  - Anything that matters goes through `send`. React's own state holds only
    drafts, such as text not sent yet.
  - What this gives up: Elm's own answer, a view that returns a tree with
    each button's Msg inside, makes a bad message impossible. Here the page
    can send one and the host refuses it. `update` must also take a click
    from an old screen, such as an ask already answered. The trade is real
    React and no UI library of our own.
- **Open: how the page loads a window** from a program installed as an npm
  package, and whether each window runs in its own sandboxed frame.

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
