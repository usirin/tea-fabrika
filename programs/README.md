# programs

One package per tea program that runs on its own: a name, typed flags, inputs and outputs, built
on `@kampus/fabrika`. A program here may use `@kampus/fabrika` and its subpaths, and
`@kampus/pipeline` (it sits above the pipeline in `layer-rules.json`), and nothing in `wip/` or
`legacy/`. Empty for now: the stage programs still live in
`packages/pipeline/src/` and come out one at a time (see experiments 82 and 103 in
`experiments/README.md`).
