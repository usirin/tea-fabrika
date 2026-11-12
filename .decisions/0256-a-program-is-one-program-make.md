---
id: 0256
title: In next/, a program is one typed Program.make over its own exported Machine.make value, with every type inferred from the machine and nothing written twice, never defineProgram or a plain object
status: accepted
date: 2026-11-07
tags: [programs, program-make, machine, types, tea, next]
---

# 0256: In next/, a program is one typed Program.make over its own exported Machine.make value, with every type inferred from the machine and nothing written twice, never defineProgram or a plain object

**What this decides:** how a person writes a program in `next/`: one constructor, a machine that
stands on its own, and types that come from it.

## Context

Decided by the owner in [a program is one typed Program.make](../docs/direction/program-make.md).
The owner then had the shape inside `Program.make` rethought; the pick is
[a program's shape](../docs/direction/program-shape.md), in
[0257](0257-a-programs-api-has-one-way.md) to [0260](0260-an-output-is-a-model-value.md). The
note's sketch of inputs as keys matched to Msgs is replaced there. Today's version keeps
`defineProgram` until that code goes.

```ts
export const counterMachine = Machine.make({ model, msg, cmds: [], init, update });

export const counter = Program.make({
  name: "counter",
  machine: counterMachine,
  view: (m) => ({ count: m.count }), // a wrong field fails tsc, not a run
  // inputs and the rest: see 0257 to 0260
});
```

## Decision

**A program is one `Program.make`, in Effect's `X.make` style.**

- Never `defineProgram`, another `defineX`, or a plain object literal.
- The machine is its own `Machine.make` value, exported beside the program, so a parent steps it as
  Elm does and laws fold it.
- Nothing is written twice. TypeScript infers the model, the Msg and the view from the machine, and
  the runner reads the schemas off it.
- The view is a typed function of the model, `view: (m) => ...`, so a window gets typed props.
- The `Program` Schema stays only as the load-time check `Program.make` runs, never the shape a
  person writes.
- Fields such as `location`, `prefix`, `index`, `find` and `commands` join only with the tier row
  that builds them.

## Consequences

- tea's `Machine.make` keeps no schemas on its machine today; it is patched locally, and
  [demlik#897](https://github.com/kamp-us/demlik/issues/897) asks upstream.
- Not decided here: the exact generic signature, which its plan settles with type tests.
