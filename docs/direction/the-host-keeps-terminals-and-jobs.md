# The host keeps terminals and jobs; a tile attaches to one

Decided 2026-10-28 by the owner. The WezTerm model: the host keeps every
terminal and every job, each with its own id, and a tile only shows one. Any
tile, in any window, can attach to a terminal or a job that is already running.
The layout is the app's, the way i3 arranges windows it does not own.

```ts
// A sketch. The host keeps this, one per host process.
type Host = {
	terminals: Terminal[]; // "term-1", "term-2": ids count up, never reused
	jobs: Job[];           // %1, %2: one list for the whole host, ids count up, never reused
};
type Terminal = {
	id: "term-3";
	shell: RunId;          // the tsh it runs
	front: JobId | null;   // its foreground job, the same for every tile that shows it
	screen: Bytes;         // what is on it, so a tile that attaches can draw it
};
type Job = { n: 2; text: "counter"; state: "running"; trace: TraceId };

// The app keeps only the layout.
type Tile = { id: "tile-a"; shows: "term-3" };
```

## One example

```ts
// Tile A: a new tile, so a new terminal running tsh, as a new tmux pane runs a shell.
tiles.open("tile-a");           // host: terminals = [term-1], tile-a shows term-1
// In it, type `counter`.         host: jobs = [%1 counter], term-1.front = %1
tiles.attach("tile-b", "term-1"); // tile B shows the same terminal, counter in front
// A key typed in B moves A too: one terminal, one front job.
// Quit the app: nothing stops. Open it again, attach a tile to term-1: counter, still %1.
```

## What was decided

- **The host keeps terminals.** A terminal is one tsh, its front job and what
  is on its screen. This is WezTerm's pane: it "tracks the pseudo terminal ...
  and associated process(es) and the parsed screen and scrollback"
  ([WezTerm, Pane](https://wezterm.org/config/lua/pane/index.html)), and it
  lives in the mux server, not in the window
  ([WezTerm, multiplexing](https://wezterm.org/multiplexing.html)). VS Code's
  pty host keeps its terminals the same way, apart from the window
  (`terminal.integrated.enablePersistentSessions`).
- **The host keeps jobs, one list per host process.** Not one per tile, not
  one per tsh. Every tile sees the same `%n`. tsh starts jobs on the host and
  shows them; it keeps no job table of its own.
- **Ids count up and are never reused.** WezTerm's window, tab and pane ids
  each come from a counter that only counts up (its `mux` crate), and tmux's
  `$`, `@` and `%` ids are fixed for an object's life. So a `%2` you remember
  always means the same job.
- **A tile attaches.** A tile shows one terminal, or one job's window. Two
  tiles, in one window or two, can show the same one.
- **The front job is the terminal's, so it is shared.** Every tile that shows
  a terminal sees the same front job, and a key typed in any of them goes to
  the same tsh. WezTerm does this: focus set by one client is sent to every
  client (its `sessionhandler.rs`). tmux does it for clients of one session.
- **The layout is the app's.** Which tile sits where, splits and folds, as in
  [fold, not tabs](./fold-not-tabs.md). The host knows
  no layout, the way an X server knows nothing of i3's tree.
- **Traces do not change.** A job's trace id is still its JobRecord's key
  ([a JobRecord holds its trace](./a-job-record-holds-its-trace.md)), and a
  child run still joins its leader's trace.

## What it changes

- **[Tiles, like tmux](./the-gui-is-electron-first.md#decided-2026-10-25-tiles-like-tmux)
  said each tile has its own tsh with its own jobs.** A new tile still starts
  a new terminal running tsh. The jobs are now the host's, and a tile can also
  attach to a terminal that exists.
- **Part A ([#170](https://github.com/usirin/tea-fabrika/pull/170))** goes
  back to its first version, the host keeps the job table, with one table per
  host process, not one per tile.
- **The Unix model was weighed and dropped.** In Unix the kernel keeps process
  groups and each shell keeps its own job table, which dies with it. That fits
  short jobs tied to one terminal. A lane runs for hours, may move to the
  cloud host, and no tsh started it, so its job cannot belong to a shell.

## Why

- **Attach from anywhere.** The point is to open a running program or
  terminal in another tile or window. That needs the host to keep it, under an
  id of its own, apart from where it is shown.
- **Most of it exists.** Since 2026-10-25 `apps/fabrika/src/tiles.ts` keeps
  one tsh per tile in the host process, quitting the app stops nothing, and
  `apps/fabrika/src/tsh.ts` keeps the screen's bytes for a page that loads
  again. What is missing is a terminal id apart from the tile, and attach.
- **One rule for numbers.** Same numbers in every tile, never reused, as in
  WezTerm and tmux.

**Cost:** a terminal id and attach and detach between the layout and
`tiles.ts`; the job table on the host (A's first version); one table per host
process. Many tiles on one terminal also means many people's keys into one
prompt, as WezTerm and tmux allow.

**How sure: 80%.** The doubts:

- **Closing a tile.** The 10-25 rule is a y or n question, then the tile's
  tsh and its runs end, as tmux's `kill-pane`. With attach, a lean: closing a
  tile that is one of several on a terminal only detaches it, and closing the
  last one asks and ends the terminal, as tmux's `unlink-window -k` kills a
  window only when it was linked once. 70%. A week of use would show.
- **What `jobs` lists.** Every job on the host, or only the ones started from
  this terminal. A lean: every job, marked with its terminal, as
  `wezterm cli list` lists every pane. 65%.
- **A terminal ended on purpose.** Its jobs are the host's, so a lean: they
  keep running, and its front job loses its screen and goes to the
  background. 65%. Unix would hang them up.

## What it cannot tell us

- How it feels with two tiles on one terminal. Nothing is built yet.
- The WezTerm parts come from reading its docs and code, not from running it.
