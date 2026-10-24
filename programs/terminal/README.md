# Terminal program

```ts
const program = terminal({cwd, shell: "/bin/bash", env});
const started = yield* start(program, {}, {}, {id: "terminal:one", storage: memoryStorage()});
if (started.kind === "running") {
  yield* tell(started.run, "stdin", "pwd\r");
}
```

`@tea-fabrika/terminal` starts one native process with `node-pty`. The caller
provides its working folder, executable and environment. Optional `args`
replace the default interactive Bash arguments. The program owns the PTY and
stops it when the run stops.

| Port | Value |
|---|---|
| `action` input | `{type: "input", data}` or `{type: "resize", cols, rows}`. |
| `stdin` input | Text written to the native PTY, including text from a pipe. |
| `stdout` output | Text read from the PTY, including terminal control sequences. |

The program declares a typed `view` of its `session` machine. The React
`TerminalWindow` on `@tea-fabrika/terminal/window` accepts the core's
`WindowProps<ReturnType<typeof terminal>>`. It sends named program inputs:

```ts
send({type: "action", value: {type: "input", data: "pwd\r"}});
```

The window also accepts optional `connected` and `active` flags for the
browser preview's connection and focus controls. Both default to true for a
host using only the standard window props. It uses Ghostty 0.4.0. The hook's
provenance is recorded in `src/use-terminal.ts`.

The pure schema and view types are on `@tea-fabrika/terminal/view`. A browser
imports the window and schemas; the native program entry belongs on the host.
This draft uses it in the experimental browser desk. It does not register a
new command or window in the default Electron app.

Keyboard input and terminal output stay in memory. The output tail is bounded,
and each native session has a UUID so replacing a process resets its display.
Ordinary shell input is not copied into a preview. `observeInput: true` opts
into showing input values for the fixed `cat`/`tr` demo.

These are PTY text ports, not binary pipes or a process checkpoint. Closing a
Fabrika input does not send native EOF. Consumers that wait for EOF need a
separate lifecycle decision. Large continuous output and assistive-technology
journeys have not been checked. Local checks cover Bash on macOS and Linux;
the shell choice and arguments remain the caller's responsibility.
