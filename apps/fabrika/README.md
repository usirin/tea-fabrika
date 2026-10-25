# fabrika app: `@kampus/fabrika-app`

The fabrika app, as a walking skeleton: the whole flow, thin. It opens as a terminal window
running tsh, with the small programs and `counter` loaded. A program with a window opens a window
of its own; the terminal stays a terminal. The design is
[The GUI is an Electron app first](../../docs/direction/the-gui-is-electron-first.md).

```text
pnpm fabrika
tsh$ seq --to 3 | double
double 2
double 4
double 6
tsh$ cou<Tab>                Tab puts in the one program that starts with "cou"
tsh$ counter                 counter's own window opens: 0  [+1] [done]; the prompt waits
                             +1: 1; close the window (or press done): its count, and the prompt
1
tsh$ <Up>                    the last line again: counter
tsh$ counter                 +1: 1; then quit the app, and open it again
tsh: 1 job from an earlier tsh, not running: %1. attach %n starts one again; jobs lists them.
tsh$ attach %1               counter's window opens again, at 1
```

```ts
// What goes between the windows and the main process (src/messages.ts). Each kind of window has its own two types.
type ToTerminal = {type: "write"; data: string};                       // bytes to draw, as from a pty
type FromTerminal = {type: "keys"; data: string} | {type: "size"; cols: number; rows: number};
type ToWindow = {type: "view"; program: string; data: unknown /* its view schema reads it */};
type FromWindow = {type: "msg"; msg: unknown /* one of its run's inputs */};

// A program window's port is its run's: the host reads `msg` with that run's program (`readInput`).
screen.heard({type: "msg", msg: {type: "press", value: "plus"}});   // {kind: "read"}; the window is shown {n: 1}
screen.heard({type: "msg", msg: {type: "press", value: "minus"}});  // {kind: "refused", why: "counter's press does not fit: ..."}
```

## Where it sits

- The top layer of the workspace (`layer-rules.json`): it imports `@kampus/fabrika` and
  `programs/counter`, and nothing imports it.
- Electron and Node are named only in `src/main.ts` and `src/preload.ts`. Everything else is
  plain Effect, tested with no Electron. The windows are a terminal (no React) and React.
- tsh and the line editor run in the main process. The terminal window only draws bytes and
  sends keys, as a terminal does with a pty. There is no pty and no `node-pty`: tsh is not a
  process, so there is nothing to give a pty to.

## What's in it

| File | What it does |
|---|---|
| `src/main.ts` | The Electron edge. One copy at a time; every window made by one function, sandboxed, on the app's own scheme; every way out refused; one MessagePort per window, handed only to that window's own top frame on its own page. |
| `src/preload.ts` | Gives a window `send` and `onMessage`, and nothing else. |
| `src/bridge.ts` | Those two names, as a window sees them, and the IPC channel the port is asked on. |
| `src/host.ts` | Starts tsh with the app's programs, runs the line editor between tsh and the terminal, and opens a window for each run of a program with a window. |
| `src/editor/` | The line editor, a tea machine: keys in, screen bytes out (`editor.ts`). `keys.ts` names each key, `screen.ts` draws, `history.ts` keeps the history in a file, `grid.ts` reads bytes back as rows for the tests. |
| `src/messages.ts` | The four message types as Effect Schemas, and their strict readers. |
| `src/files.ts` | What the app's own scheme serves: two pages, their scripts and one stylesheet, each with a Content Security Policy. |
| `src/window/` | `terminal.ts`, the terminal page: ghostty-web, no React. `program.tsx`, a program's window: React, with `windows.tsx` listing each window the app knows. |
| `build.ts` | Bundles `dist/` with esbuild: `main.mjs`, `preload.cjs`, `terminal.js`, `program.js`, and the pages' plain files. |
| `e2e.ts` | Drives the built app through Playwright, one screenshot per step, then quits it with a job and opens it again. Not in `pnpm test`. |

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
- **Ctrl-D** on an empty line ends tsh, and the app quits, as `exit` would. On a line with text,
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

## One window per program

A run of a program with a window opens a window of its own, titled with the program's name. The
terminal stays a terminal. It follows Unix job control: a window is to a run what a terminal is to
a foreground process.

```text
tsh$ counter                 its window opens; the prompt waits until the run ends
1
tsh$ counter &               its window opens; the prompt is back at once
[1] counter:7f3a
tsh$ say --text meanwhile
meanwhile
tsh$                         done in its window: its count and its end print above the prompt
```

- **Foreground.** `counter` opens its window, and the prompt waits for it to end, as a shell waits
  for a foreground process. Keys typed in the terminal meanwhile wait for the next prompt.
- **Background.** `counter &` opens its window and gives the prompt back at once. Its end is
  printed above the prompt, as bash prints `[1]+ Done` before its next prompt.
- **Ctrl-C in the terminal** stops the foreground run only, as `SIGINT` reaches only the
  foreground process group. Its window closes. A background run is not touched.
- **Closing a run's window closes its inputs,** as the end of stdin does: the program sees no more
  presses. Counter ends on that and says its count. A program that ends only on `done` would keep
  running with no window; Ctrl-C (in the foreground) or `stop %n` stops it.
- **Quitting the app** keeps every job, window or not, as a `nohup` job outlives its terminal. The
  next start lists them, and `attach %n` opens the window again where it was.

Why this pick, and not a window that takes over the terminal (the first build): the terminal is
always there, so tsh is never hidden behind a program, and a background job's window no longer
covers tsh with no way back. It costs one more window per run, and the person moves between
windows with the operating system's own keys.

How sure: 75%. The doubt is what closing a window should mean: the end of its inputs (this), or
stop (as a terminal's close sends `SIGHUP`). Watching people close windows with a job half done
would settle it.

## The terminal

- **ghostty-web 0.4.0** (MIT, by Coder): Ghostty's terminal built to WebAssembly, drawn on a
  canvas, with an xterm.js-like API. Held at an exact version in the catalog. It has no
  dependencies.
- **The terminal page's policy allows WebAssembly.** `TERMINAL_CSP` in `files.ts` is the app's
  policy plus `'wasm-unsafe-eval'` in `script-src`, and only the terminal's page gets it. Chromium
  compiles no WebAssembly under `script-src 'self'` alone. `'wasm-unsafe-eval'` lets in
  WebAssembly and nothing else: no `eval`, no `new Function`, no inline script. The program
  windows keep the policy with no WebAssembly.
- **The WebAssembly is compiled from bytes in the page's own script.** `Ghostty.load()` fetches a
  `data:` url, which the policy refuses (`connect-src` is `'none'`), so `build.ts` bundles the
  `.wasm` file as bytes and `terminal.ts` compiles them. The cost: ghostty-web's own bundle holds
  the same bytes as base64, so `terminal.js` carries them twice, about 1.1 MB of its 1.5 MB.
- **The screen is kept as text too,** in a visually hidden region labelled "tsh screen": the last
  200 rows, up to the cursor's. The canvas is blank to a screen reader and to a test. Ghostty 0.4
  declares `onRender` and never fires it, so the text is read after each write.

### Taken from pull request 61

Pull request 61 is a draft with a terminal program of its own (`programs/terminal`) on
ghostty-web 0.4.0. Taken from it: the terminal's options (font size 14, a monospace font, a
blinking cursor, 1000 rows of scrollback), fit on open and then follow the window's size, the
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
- `FABRIKA_HOME=<folder>` puts the app's own files there instead of Electron's folder: its
  `storage/`, its `history` and its one-copy lock. One copy per home means one tsh writes that
  home's job table. The end-to-end run uses a fresh one.

## What it does not do yet

- **Wide characters.** The editor counts one cell per character, so a CJK character or an emoji
  on the line puts the cursor off.
- **Bracketed paste.** A pasted newline runs the line, as in a terminal with no bracketed paste.
- **An escape sequence cut across two messages** is read as two keys. Keys come from one
  `onData` each, so this has not been seen.
- **A resize does not redraw the line** already on the screen; the next one is drawn at the new
  width.
- **No Ctrl-Z and no `bg`:** a run in the foreground cannot be sent to the background.
- **A window closed while its run keeps going** (a program that ignores the end of its inputs)
  cannot be opened again until the app restarts and `attach` reopens it.
- **The screen's text is not a live region**: a screen reader is not told of new text.
- **A program window is built into the app's bundle;** one from outside the app's build cannot be
  loaded.
- **Nothing clears the folder.** Every run tsh starts keeps its record there, ended or not.
- **No packaging, signing or updates.**
