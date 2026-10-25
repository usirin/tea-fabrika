# programs

One package per tea program that runs on its own: a name, typed flags, inputs and outputs, built
on `@kampus/fabrika`. A program here may use `@kampus/fabrika` and its subpaths, and
`@kampus/pipeline` (it sits above the pipeline in `layer-rules.json`), and nothing in `wip/` or
`legacy/`. The stage programs still live in `packages/pipeline/src/` and come out one at a time
(see experiments 82 and 103 in `experiments/README.md`).

- [`counter`](./counter/README.md): the smallest program with a window, the fabrika app's first.
- [`tracker`](./tracker/README.md): tickets on the ledger, one stream of facts each, with a
  window to list, file, read, comment on, close and reopen them.

A program with a window keeps it in its own package, on `<package>/window`: a React component
that draws the program's view. The program itself imports no React.
