# The desktop layer

**Decided 2026-10-31 by the owner,** in the walk of
[the five layers](./a-local-first-sync-engine.md#decided-2026-10-30-and-2026-10-31-five-layers-central-first).
The desktop is layer 5, on top of the app. It places tiles, owns focus and
routes keys: the part KDE or GNOME plays on Linux. Its codename is Tuval;
users only ever see "fabrika".

*Changed 2026-11-01, for `next/`, from [Tier 1's plan](../plan/tier-1.md), proposed until it
is approved. Tuval is a package, `@kampus/tuval`: fabrika is the logic, and Tuval is what is
drawn from it. The new version's shell is `fabsh`, so below, `tsh` means `fabsh`. The desk is
a program, `next/programs/desk`, built in as `fabrika/desk`, and it arrives in Tier 2 with
split, close and prefix keys. Tier 1 has one fixed layout at wiring, each window keeps its
own focus, and it has no desk process. See [the app and its menu bar](#the-app-and-its-menu-bar).*

```ts
// A sketch. The desktop's own state is one more process in the brain, like a tmux server.
type Desktop = {
	workspaces: Workspace[];              // numbered layouts inside the desk
};
type Workspace = {
	n: 1;
	layout: Split;                        // in percent, never in pixels or columns
	focus: TileId;                        // one per workspace: two windows on it mirror
};
type Split = {dir: "row" | "column"; parts: {percent: number; inner: Split | Tile}[]}; // not `then`: it makes an object look like a promise
type Tile = {id: "t3"; shows: Pid; keep: "never" | "failed" | "always"};

// A window is a client. It picks a workspace, folds the layout to its own size, and runs the prefix.
type Window = {platform: "electron" | "browser" | "headless"; workspace: 1; cannot: Key[]};
```

The floor is the app layer's window protocol (A3 in
[the app layer](./the-cloud-is-one-more-host.md#decided-2026-10-31-the-app-layer)):
a view plus a revision, `saw`, JSON patches and streams. A process sends its
view and never knows where its tile is. Apps and a Wayland compositor split the
same way. Like every layer, it must run in a browser tab
([a browser is always a client](./a-browser-is-always-a-client.md)).

## One example

```ts
// Workspace 1 on the Mac's window: tsh in t1, build:7's view in t2.
did({does: "split_right"});            // Ctrl-B % in the window: t2 opens, running tsh
// in t2, type `attach build:7`          t2 now shows build:7's process
// build:7 crashes: DOWN {pid, why: "limit"} reaches the desktop
//   t2.keep = "failed" (the default) -> t2 stays, with the last view and the reason
// open a browser tab on workspace 1     same layout, same focus, folded to the tab's size
// press Ctrl-B in the tab               only the tab is armed; the Mac's window is not
```

## What was decided

### W1: the layer hides Electron and the browser

- A platform-free core, plus `electron`, `browser` and `headless` backends.
  wlroots does the same (DRM, nested Wayland, headless), and so does VS Code
  (its `browser` and `electron` folders).
- Every window dials the brain over a WebSocket (T3, changed 2026-10-31), so
  the backends differ only in screen things.
- The desktop's own state (tiles, focus, layout) is a process in the brain,
  the way a tmux server holds sessions that any client attaches to. Locally it
  runs in Miniflare; for a public app, on Cloudflare.
- Each backend says which keys it cannot have (a tab cannot own Cmd-W).
- When a quirk shows up, first check how other apps that ship on both handle
  it, before inventing a fix.
- **How sure:** 80% (the decision log's number).

### W2: tsh is a regular program

```ts
// keys go window -> the tsh process; the window draws the letter at once, the process confirms
{port: "tile:t1", m: {type: "keys", data: "l"}}           // drawn now, speculatively
{rev: 88, patch: [{op: "add", path: "/line/-", value: "l"}]} // the process agrees
{type: "submitted", line: "jobs"}                         // a whole line is a Msg: in the log
```

- A tile starts a tsh process in the brain like any other process, with its
  line editor state in its model.
- The window draws typed letters at once and the process confirms them
  (speculative local echo, as mosh does).
  [Experiment 150](../../experiments/150-browser-desk.md): 14 ms instead of
  95 ms, at 80 ms of network delay.
- The hands see only the machine work tsh starts, as Cmds. A real terminal
  program in a tile (zsh, vim) is a pty on the hands, whose bytes stream
  through and are never saved.
- A submitted line is a Msg, so it is in the process's log. Keys typed mid-line
  are not.
- On Cloudflare, what you type crosses Cloudflare, as in any web terminal.

### W3: a tile shows one process

```ts
// The desktop monitors the tile's process (OTP's monitor, from coordination).
{_tag: "DOWN", pid: "build:7#2", why: "crashed"}
// then the tile follows its keep:
//   "never"   close it, as a tmux pane closes when its command exits
//   "failed"  keep it only after a crash, with the final view and the reason (the default)
//   "always"  keep it, for test runs
```

- tsh is only the default process for a new tile.
- tmux's `remain-on-exit` has the same three. The word `keep` reads as a
  sentence: `{keep: "failed"}`.
- A crash's reason is already recorded (C1) and goes to the desk too.

### W4: size belongs to the viewer

- A process never knows its screen size. tsh output is lines, and every
  program draws with a React view, so nothing in the desktop needs a terminal
  size.
- The layout tree stays in percent, one per workspace. Each window folds what
  does not fit its own size. The area moves from the desk onto each window.
- Each window picks its own workspace. Focus stays per workspace, so two
  windows on one workspace mirror, as in tmux.
- We keep our own drag code, not react-resizable-panels.
- **Fast follow, only if two windows on one workspace annoy:** focus per
  window with a last-used list (tmux, i3), and an opt-in follow (Figma, Zed).
- WezTerm's shared focus and last-resize-wins size are open bugs there
  ([#4390](https://github.com/wezterm/wezterm/issues/4390),
  [#2133](https://github.com/wezterm/wezterm/issues/2133)), so on this point we
  lead instead of copying it.

### W5: keys

```ts
// Ctrl-B arms only the window it was pressed in. That window sends one finished command.
{type: "did", does: "split_right"}
// a backend lists the keys it cannot have; a binding on one fails at load
const browser = {cannot: ["Mod-W", "Mod-T", "Mod-N", "Mod-Q"]};
const electron = {cannot: ["Cmd-Q", "Cmd-H"]};
```

- Each window runs the prefix itself, as tmux keeps a key table per client.
  No network wait after the prefix, and only one copy of the prefix, so the
  old desktop's double-key bug cannot come back.
- A binding on a key the backend cannot have fails at load, not with a
  warning.
- Every command also has a tsh word and a palette entry, so losing a key never
  loses a command (85%).
- Linear does not tile, so where its keys clash with ours, the prefix wins.
- **How sure: 70%.** The doubt: "Ctrl-C over a program" reads a desk that may
  be a moment old. A test with a slow fake link would settle it.

## The app and its menu bar

Added 2026-11-01, for `next/`. The owner settled the shape: the menu bar is in the first
slice and part of the Electron app, and a person only opens the app, which starts the brain.
The details are [Tier 1's plan](../plan/tier-1.md), proposed until it is approved.

```text
open   write <home>/brain.plist, then  launchctl bootstrap gui/<uid> <home>/brain.plist
quit   launchctl bootout gui/<uid>/fabrika.brain
```

```ts
// A sketch. The menu is pure Elm, drawn by Electron's Tray and a panel, an array in headless.
export const menuView: (m: MenuModel) => ReadonlyArray<MenuItem>;
// rows: "Chrome on this Mac, 1 tab, says code 482 109. [Deny] [Approve]"
```

- The brain is a plain launchd service, with its plist in the app's home, so nothing starts at
  login. It sits behind `BrainService`, with `launchdBrain`, `childBrain` and a test Layer.
- Approve and Remove ask for a finger. Deny does not, since saying no should be easy.
- On the `cloud` stage the app starts no brain, and keeps only its link to the cloud.
- **Why:** one thing to open, so nobody manages a service by hand. It costs a spike on an
  unsigned build (T8). How sure: launchd working there is the doubt, about 70%, an estimate
  written for this note and not a measure. The spike settles it. If it fails, `childBrain` carries this pass, and the owner is told.

## Notes this changes

- [The host keeps terminals and jobs](./the-host-keeps-terminals-and-jobs.md):
  the brain keeps them now, and a tile shows one process. Its shared front job
  holds, since focus is per workspace (W4).
- [The GUI is an Electron app first](./the-gui-is-electron-first.md): the
  Electron window is one backend of three, and it dials the brain itself (T3).
- [tsh, a shell for tea programs](./tsh-a-shell-for-tea-programs.md): tsh is
  a regular program in the brain (W2).

## What it costs

- A core with three backends, where today there is one Electron window.
- A desktop process in the brain, where today the app keeps the layout.
- Speculative echo in every window, and a test that the process's answer and
  the drawn letter agree.

## What it cannot tell us

- None of it is built. Experiment 150's echo number is from a browser desk on
  a fake delay, not from this design.
- How two windows on one workspace feel day to day. That decides whether the
  focus fast follow in W4 is needed.
- Whether a browser tab's lost keys (Cmd-W and the rest) hurt enough to need
  more than the tsh word and the palette.
