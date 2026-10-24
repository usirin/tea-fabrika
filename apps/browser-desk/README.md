# Run the local desk

This is the experimental browser/Sandbox preview, kept for reviewing its native
terminal, multi-pane and recovery work. The default desktop app is
[`apps/fabrika`](../fabrika/README.md), following the newer Electron-first
direction. Its app and Counter program are unchanged here.

The counter in this preview is a private recovery fixture under `src/counter`.
It runs a five-step job so the browser and host can be stopped during work.

```sh
pnpm install --frozen-lockfile
pnpm --filter @tea-fabrika/gui build
pnpm --filter @tea-fabrika/gui start
```

Use Node 26 or newer. Open <http://127.0.0.1:5200>.

The first pane opens tsh. Type `counter` and press Enter. That pane becomes
the counter's React window. **Back to tsh** returns to the same shell.

Choose **New pane**, type `terminal`, and press Enter. It opens Bash on the
computer running the host. Type commands normally. Browser paste, Ctrl-C
and Escape go to the native terminal. Nothing starts Claude automatically.

Type `pipe` in tsh, or choose **Open terminal pipe**, to open two native
terminals joined by Fabrika. Type a line on the left and press Enter. The
left process is `cat`; its `stdout` feeds the right program's `stdin`. The
right process is `tr`, which prints the same text in uppercase. The wire
animates when real text is queued, and the port values and traffic log show
what passed through.

**Pause connection** discards new text at the link and counts it in the log.
**Resume connection** forwards new text using the same processes. There is
no replay of text discarded while paused. **Restart demo** starts both
processes again and clears the temporary traffic history.

Choose **Close window** to hide a pane. Select it in the pane list to reopen
it. Closing a window or browser keeps its programs running. Counter and pane
records survive restarting Node. A Terminal keeps the same shell while Node
runs; after Node restarts it gets a new shell and empty scrollback.
The terminal pipe also keeps running when its view closes. Host restart or
cloud save starts fresh processes and an empty traffic history.

## Check the browser interaction

```sh
pnpm --filter @tea-fabrika/gui exec playwright install chromium
pnpm --filter @tea-fabrika/gui build
pnpm --filter @tea-fabrika/gui check:browser
```

The check starts its own host on port 5201, with a new SQLite file. It drives
real browsers, closes all of them, and kills its own Node process during a
counter job. It closes its host and browsers at the end. Results and screenshots
go to the ignored `runs/gui-check/` folder. It uses no agent or model provider.

For the normal repository tests, use a terminal type that supports the existing
PTY checks:

```sh
TERM=xterm-256color pnpm test --maxWorkers=2
```

For a second manual desk, set `FABRIKA_GUI_PORT`, `FABRIKA_GUI_DATA`, and
`FABRIKA_GUI_CWD` when starting it. The defaults are port 5200, `runs/gui/`
under the repository, and the repository as the shell's working folder.

Terminal renders through Ghostty's WebAssembly terminal and React hook. The
native shell still runs in the host. The module map and initial local evidence
are in [experiment 130](../../experiments/130-fabrika-gui.md).

For the protected Linux deployment, use the
[Sandbox runbook](../sandbox-desk/README.md). The same host accepts an exact
`FABRIKA_GUI_ORIGIN`, a `FABRIKA_GUI_PATH` ending in `/`, and a validated
`FABRIKA_GUI_BIND`. Loopback remains the default. Loading windows from installed
packages remains separate work.
