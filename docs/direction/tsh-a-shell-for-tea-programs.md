# tsh: a shell for tea programs

Decided 2026-10-17. The MCP part was added 2026-10-18.

```sh
tsh -c 'review --pr 712 | ship'       # typed values down a typed pipe
n=$(count --to 3)                     # call() is $(…)
jobs                                  # a built-in, like ps
```

## What was decided

- **tsh is used like any Unix shell:** a prompt, `-c`, scripts, exit status,
  jobs.
- **It runs only tea programs,** with typed values and typed pipes. tsh is
  itself a tea program.
- **No new concept for commands.** A command is a short program. `call()` is
  `$(…)`. `ps` and `jobs` are built-ins.
- **tsh is fabrika's first client** (2026-10-18).
- **Agents get tsh instead of bash.** tsh is this project's policy layer,
  improved over time. It is not an OS sandbox.
  - Which programs an agent sees is up to whoever sets up that agent.
  - An agent changing its own programs is ordinary user work. Guards come only
    once harm is seen.
  - A value bound to one lane is fabrika's job: narrow the flag or input schema
    to that lane's value.
- **MCP is the tools protocol** (2026-10-18). tsh will serve each listed
  program to an agent as an MCP tool (experiment 78, not built yet).

## Why

- Unix already has the ideas. A new word for them is one more thing to learn.
- Agents starting real, typed programs is the main gain. It is how "typed reads
  become tools" ([helpers](./helpers-and-the-supervisor.md)) gets done.

## Still open

- Whether programs that write must ask a person first, and reading ones are
  free. Planned with experiment 78, not decided.

## What would change it

An agent job that needs a plain shell often enough that tsh gets in the way.
