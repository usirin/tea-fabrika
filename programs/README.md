# programs

One package per tea program that runs on its own: a name, typed flags, inputs and outputs, built
on `@kampus/fabrika`. A program here may use `@kampus/fabrika` and its subpaths, and
`@kampus/pipeline` (it sits above the pipeline in `layer-rules.json`), and nothing in `wip/` or
`legacy/`. The stage programs still live in `packages/pipeline/src/` and come out one at a time
(see experiments 82 and 103 in `experiments/README.md`).

- [`counter`](./counter/README.md): the smallest program with a window, the fabrika app's first.
- [`tracker`](./tracker/README.md): tickets on the ledger, one stream of facts each, with a
  window to list, file, read, comment on, close and reopen them.
- [`ticket`](./ticket/README.md): one ticket in a tile, laid out like a Linear issue, that
  answers its open ask and comments. It runs the tracker's machine, opened on one ticket.
- [`map`](./map/README.md): a React Flow map of today's programs, with their real inputs,
  outputs and wires, lit by one ticket's facts.
- [`runs`](./runs/README.md): one ticket's runs in time, a track per step, with a playhead
  that replays the facts. It was `trace` until the job record.
- [`trace`](./trace/README.md): one job's trace from its record, a bar per span, and every
  grouped row opening down to one step: its Msg, the state before and after, and its Cmds.
- [`experiments`](./experiments/README.md): every experiment on the ledger, one row each, then
  the list as markdown. No window.
- [`experiment`](./experiment/README.md): one experiment, its write-up drawn from data, and its
  runs. No window.
- [`compare`](./compare/README.md): two runs of one experiment, metric by metric, then the
  cases whose scores changed. No window.
- [`markdown`](./markdown/README.md): draws any markdown it is told, as `glow` or `less` does,
  in a window. `experiment --n 170 | markdown` draws a page.
- [`claude`](./claude/README.md) and [`codex`](./codex/README.md): a coding agent as a program,
  each prompt a turn on one session through the `Agents` service. The two wire the same parts
  from `@kampus/fabrika/agents/program`; only the provider differs.

A program with a window keeps it in its own package, on `<package>/window`: a React component
that draws the program's view. The program itself imports no React.
