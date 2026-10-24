# fabrika app: `@kampus/fabrika-app`

The fabrika app, as a walking skeleton: the whole flow, thin. It opens as one Electron window
running tsh, with the small programs and `counter` loaded. A program with a window takes the
window over; when it ends, tsh is back. The design is
[The GUI is an Electron app first](../../docs/direction/the-gui-is-electron-first.md).

```text
pnpm fabrika
tsh> seq --to 3 | double
double 2
double 4
double 6
tsh> counter                 counter's window takes over: 0  [+1] [done]
                             +1: 1; done: tsh is back
1
tsh> counter                 +1: 1; then quit the app, and open it again
tsh: 1 job from an earlier tsh, not running: %1. attach %n starts one again; jobs lists them.
tsh> attach %1               counter's window takes over again, at 1
```

```ts
// What goes between the window and the main process (src/messages.ts): two message types.
type ToPage = {type: "view"; pane: "p1"; data: PaneView};
type FromPage = {type: "msg"; pane: "p1"; to: string /* a run */; msg: unknown /* one of its inputs */};

type PaneView = {
	tsh: {run: string; lines: Line[]; state: Tsh};
	front: {program: string; run: string; data: unknown /* its view schema reads it */}[];
};

// The main process reads every message twice: the envelope (`readFromPage`), then `msg` by the
// named run's own program (`readInput` from @kampus/fabrika). Either refuses: nothing is told.
host.heard({type: "msg", pane: "p1", to: "counter:1a2b", msg: {type: "press", value: "plus"}});
// {kind: "read"}; then a view with front [{program: "counter", ..., data: {n: 1}}]
host.heard({type: "msg", pane: "p1", to: "counter:1a2b", msg: {type: "press", value: "minus"}});
// {kind: "refused", why: "counter's press does not fit: ..."}
```

## Where it sits

- The top layer of the workspace (`layer-rules.json`): it imports `@kampus/fabrika` and
  `programs/counter`, and nothing imports it.
- Electron and Node are named only in `src/main.ts` and `src/preload.ts`. Everything else is
  plain Effect and React, tested with no Electron.

## What's in it

| File | What it does |
|---|---|
| `src/main.ts` | The Electron edge. One copy at a time, one sandboxed window, the app's own scheme, every way out refused, one MessagePort handed only to our own window's top frame. It hands the host the folder tsh keeps its jobs in. |
| `src/preload.ts` | Gives the window `send` and `onView`, and nothing else. |
| `src/bridge.ts` | Those two names, as the window sees them, and the IPC channel the port is asked on. |
| `src/host.ts` | Starts tsh with the app's programs, on the job storage it is handed, folds what tsh and each window program say into the pane, and reads and routes what the window sends. |
| `src/pane.ts` | The pane as a tea machine: tsh's lines and state, and the program windows over it. |
| `src/messages.ts` | `ToPage` and `FromPage` as Effect Schemas, and their strict readers. |
| `src/files.ts` | What the app's own scheme serves: three files, with a Content Security Policy. |
| `src/window/` | The window: plain React. `windows.tsx` lists each program window the app knows, built into its bundle. |
| `build.ts` | Bundles `dist/` with esbuild: `main.mjs`, `preload.cjs`, `window.js`, and the page's two plain files. |
| `e2e.ts` | Drives the built app through Playwright, one screenshot per step. Then it quits the app with counter at 1, opens it again on the same home, and attaches counter. Not in `pnpm test`. |

- **How a program gets a window.** It declares a pure `view` in `defineProgram`, with an Effect
  Schema for its data (see `packages/fabrika/src/program/view.ts`). Its window is a React
  component on `<package>/window`. The app lists that component in `src/window/windows.tsx`.
- **What tsh does with one.** In the foreground, tsh keeps its inputs open, since its window
  tells them, and waits for its end or Ctrl-C, as for any foreground line.
- **Storage.** A folder, `storage/` in the app's home, as the terminal tsh keeps one in its own
  home. tsh keeps its job table there, and each job keeps its record and its machines. Quit the
  app with a job running, and the next start finds it: not running, until `attach %n` starts it
  again where it was. `main.ts` hands the folder to the host (`startHost(jobs)`); the host's tests
  hand it memory, or one folder to two hosts in turn.
- **No ledger.** tsh's own run stays in memory, as in the terminal. The app uses no ledger, so it
  needs no worker thread and no child process.
- **Keys.** Enter sends the line to tsh. Ctrl-C sends tsh `signal: interrupt` from tsh or from a
  program's window: it stops what runs in the foreground.

## Commands

```sh
pnpm fabrika                                  # build, then open the app
pnpm --filter @kampus/fabrika-app build       # dist/ only
pnpm --filter @kampus/fabrika-app e2e         # the flow end to end, screenshots in a temp folder
SHOTS=<folder> pnpm --filter @kampus/fabrika-app e2e
```

- The first run downloads Electron's binary, about 6 seconds. Electron 45 has no install script:
  it downloads on first use, so pnpm needs no `onlyBuiltDependencies` entry for it.
- `FABRIKA_HOME=<folder>` puts the app's own files there instead of Electron's folder: its
  `storage/` and its one-copy lock. One copy per home means one tsh writes that home's job
  table. The end-to-end run uses a fresh one.

## What it does not do yet

- One pane only. No layouts, no keys of its own, no owner's desk.
- A program with a window started with `&` takes the window over too, but Ctrl-C reaches only
  the foreground: such a window goes only when its program ends on its own.
- A program window is built into the app's bundle; one from outside the app's build cannot be
  loaded.
- Only jobs are kept between starts. The lines on the window are not: the next start shows a
  fresh tsh, with one line about the jobs it found.
- Nothing clears the folder. Every run tsh starts keeps its record there, ended or not.
- No packaging, signing or updates.
