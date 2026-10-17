# tea-program: programs between tea and a host

**Proposed** 2026-10-15, changed 2026-10-16. Not settled.

```ts
// tea: the kernel. A machine is a data structure: a state and the rules that move it.
const ship = createShip();   // defineMachine({ types, cmds, init, update, subs })

// tea-program: a program is what you start. It uses machines; it is not one.
const shipProgram = defineProgram({
  name: "ship",
  description: "Puts pull requests in the merge queue, one after another, and says how each one ended.",
  inputs:  { prs: input(PullRequestUrls, "The pull requests, in order."), mode: input(Mode, "read or write.") },
  outputs: { outcome: output(Shipped, "How one pull request ended.") },
  main: ({ prs, mode }, send) =>   // an Effect: runs the ship machine on tea's Effect engine, once per pull request
    Effect.forEach(prs, (pr) => runShip(pr).pipe(Effect.flatMap((o) => send("outcome", o))), { concurrency: 1 }),
});

// the host: lists programs, starts them, provides their services.
listing(shipProgram);   // name, description, each input and output with its JSON Schema
start(shipProgram, { prs: [url], mode: "write" }, { outcome: show })
  .pipe(Effect.provide(Layer.mergeAll(codeHost, codeHostWrites)));
// -> { kind: "ran" } | { kind: "bad_shape", input, why }
```

## What is proposed

Three layers, each with one job.

| Layer | Holds |
|---|---|
| tea (the kernel) | machines: `defineMachine`, update, Cmd, Sub, `run` on each engine |
| tea-program | programs: `defineProgram`, typed inputs and outputs with descriptions, `start`, `readInputs`, the listing, the fit check |
| a host (a desktop app like Tuval, or a command line) | lists programs, starts them, provides their services |

- **A program is a name, a description, inputs, outputs and `main`.** No
  machine fields. Changing a machine never changes how a program is declared.
- **`main` is an Effect.** It runs its machines with tea's Effect engine, and
  asks for services (`CodeHost`, `CodeHostWrites`, ...) through Effect's
  context. It never makes a real connection; whoever starts it provides them,
  so a test hands it fake Layers.
- **Inputs are start values, like Elm's flags.** Each has an Effect Schema and a
  description. They are checked before `main` runs. One that does not fit
  answers `bad_shape` with its name and the schema's reason, and nothing runs.
- **Outputs are one-way, like Elm's outgoing ports.** `main` sends, whoever
  started it hears, nothing comes back. A value its own output refuses is a bug
  in the program, and dies.
- **A setting of a service is not an input.** Who the repo treats as its own is
  the GitHub reader's setting, so the host reads it and builds the Layer.
- **A shape only checks**, it never converts. **Fit** stays exact, for when
  programs are wired together.

## Why

- A machine and a program are different things, like an array and a function.
  [Experiment 62](../../experiments/62-tea-program-on-unchanged-tea.md) put a
  machine's fields inside the program, and every program had to be written as
  one machine. The ship stage, the review stage and `operate` were already
  programs written by hand, and `operate` uses two machines.
- [Experiment 63](../../experiments/63-ship-as-a-program.md) made the ship stage
  a program with no change to tea or the ship machine. On 10 real pull
  requests, the new `run.ts` printed the same bytes as the old one.
- Effect's context is already how this repo asks for services. A program adds
  nothing new for that.

## What it costs

- A program's services are one union for every mode. Ship's read mode needs a
  write side that refuses, given by the launcher.
- A listing cannot name the services a program needs, or their settings. They
  live only in the type.
- No shape yet for a value handed to a program while it runs. Experiment 62's
  `tell` answered that for the dropped shape; nothing does for this one.
- No saved state of a program's own. A parent that starts a program from a Cmd
  loses the child's place on a restart, which `operate`'s child machine keeps
  today.
- Fit and the listing are only as good as the JSON Schema Effect writes: it
  leaves out patterns, and writes `Schema.Number` with NaN and Infinity as
  strings.

How sure: about 80% for one-shot programs like ship. Lower, about 60%, for a
program that must take values while it runs or survive a restart: neither has
been built.

## What would change this

- A host that needs to know a program's services, often enough that a `needs`
  list beats reading the type.
- `operate` as a program, with ship as a program it starts: if the restart cost
  is real, a program needs its own saved state, or ship stays a child machine.
- A program that takes values while it runs: that is where `tell` comes back.

## What was proposed first, and dropped

On 2026-10-15 this note proposed a program as "a machine plus its host handlers
plus typed inputs and outputs": `defineProgram` took `types`, `cmds`, `init`,
`update` and `subs` beside `inputs` and `outputs`, an input arrived as a Msg,
and `tell(run, input, payload)` answered `queued`, `stopped`, `bad_shape` or
`no_cell`. It was dropped on 2026-10-16: it made a program a kind of machine.
Its code was removed in experiment 63, apart from the shape check.
