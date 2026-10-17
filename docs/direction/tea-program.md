# tea-program: programs between tea and a host

**Proposed** 2026-10-15, changed 2026-10-16. Not settled.

```ts
// tea: the kernel. A machine is a data structure: a state and the rules that move it.
const ship = createShip();   // defineMachine({ types, cmds, init, update, subs })

// tea-program: a program is what you start. It uses machines; it is not one.
const shipProgram = defineProgram({
  name: "ship",
  description: "Puts pull requests in the merge queue, one after another, as it is told them.",
  flags:    { mode: flag(Mode, "read or write, for the whole run.") },          // argv
  inputs:   { pr: input(PullRequestUrl, "A pull request to ship. Tell it any time.") },  // stdin
  outputs:  { outcome: output(Shipped, "How one pull request ended.") },
  machines: { ship },
  main: ({ flags, inputs, send, watch }) =>   // an Effect: a fresh ship machine per pull request it reads
    inputs.pr.pipe(Stream.runForEach((pr) => runShip(pr, watch).pipe(Effect.flatMap((o) => send("outcome", o))))),
});

// the host: lists programs, starts them, feeds them, listens, provides their services.
listing(shipProgram);                         // name, description, flags, inputs, outputs (JSON Schema), machine names
const { run } = yield* start(shipProgram, { mode: "write" });   // or { kind: "bad_shape", name, why }
run.listen("outcome", show);                  // any time, more than once; late listeners hear what came before
tell(run, "pr", url);                         // never waits: "queued" | "stopped" | "bad_shape" | "no_cell"
run.machines.ship.changes;                    // the machine's state now, then every change
yield* run.stop;                              // or run.ended; run.id is stable
```

## What is proposed

Three layers, each with one job.

| Layer | Holds |
|---|---|
| tea (the kernel) | machines: `defineMachine`, update, Cmd, Sub, `run` on each engine |
| tea-program | programs: `defineProgram`, typed flags, inputs and outputs with descriptions, `start` and its run handle, `tell`, `readFlags`, the listing, the fit check |
| a host (a desktop app like Tuval, or a command line) | lists programs, starts them, feeds their inputs, listens to their outputs, provides their services |

- **A program is a name, a description, flags, inputs, outputs, the machines it
  shows, and `main`.** No machine fields. Changing a machine never changes how
  a program is declared.
- **`main` is an Effect.** It runs its machines with tea's Effect engine, and
  asks for services (`CodeHost`, `CodeHostWrites`, ...) through Effect's
  context. It never makes a real connection; whoever starts it provides them,
  so a test hands it fake Layers.
- **Flags are argv.** Values needed once, at start. Each has a schema and a
  description, and is checked before `main` runs. One that does not fit answers
  `bad_shape` with its name and the schema's reason, and nothing runs.
- **Inputs are stdin.** A running program is told on an input at any time with
  `tell`, which never waits and answers one of four words. `main` reads each
  input as a `Stream`. A program that reads an input runs until it is stopped.
- **Outputs are one-way, like Elm's outgoing ports.** `main` sends, whoever
  listens hears, nothing comes back. A value its own output refuses is a bug in
  the program, and it fails the run.
- **`start` answers a run handle at once**: a stable id, `stop`, `ended`,
  `listen` on any output at any time, and each declared machine by name, with
  its state now and a stream of its changes. The run lives in the starter's
  scope.
- **No `dispatch(machine, msg)` on the handle.** Open: whether a host may hand
  a machine a Msg of its own. Until it is settled, inputs are the only way in.
- **A setting of a service is not a flag.** Who the repo treats as its own is
  the GitHub reader's setting, so the host reads it and builds the Layer.
- **A shape only checks**, it never converts. **Fit** stays exact, for when
  programs are wired together.

## Why

- A machine and a program are different things, like an array and a function.
  [Experiment 62](../../experiments/62-tea-program-on-unchanged-tea.md) put a
  machine's fields inside the program, and every program had to be written as
  one machine. The ship stage, the review stage and `operate` were already
  programs written by hand, and `operate` uses two machines.
- A desktop host like Tuval keeps programs running and keeps feeding them, like
  a shell takes prompt after prompt, and its screen keeps listening. Inputs
  taken once at start lose that; live inputs and a run handle keep it.
- [Experiment 63](../../experiments/63-ship-as-a-program.md) made the ship stage
  a program with no change to tea or the ship machine. On 10 real pull
  requests, the new `run.ts` printed the same bytes as the old one, in both
  the start-once and the live-input versions.
- Effect's context is already how this repo asks for services. A program adds
  nothing new for that.

## What it costs

- A one-shot caller has to stop the run itself: it counts the answers it is
  waiting for, then calls `stop`.
- Every output is kept for late listeners. Fine for ship; a program that runs
  for days needs a cap or a "from now" listen.
- A program's services are one union for every mode. Ship's read mode needs a
  write side that refuses, given by the launcher.
- A listing cannot name the services a program needs, or their settings. They
  live only in the type.
- No saved state of a program's own. A parent that hands ship to a running
  program loses the child's place on a restart, which `operate`'s child machine
  keeps today.
- Fit and the listing are only as good as the JSON Schema Effect writes: it
  leaves out patterns, and writes `Schema.Number` with NaN and Infinity as
  strings.

How sure: about 80% for the shape. About 60% for a program that must survive a
restart: that has not been built.

## What would change this

- A host that needs to send a machine a Msg directly, often enough that
  inputs feel like a detour: then `dispatch` comes up again.
- A host that needs to know a program's services, often enough that a `needs`
  list beats reading the type.
- `operate` as a program, with ship as a program it feeds: if the restart cost
  is real, a program needs its own saved state, or ship stays a child machine.
- `review | ship` wired by the fit check: the first test of two programs
  talking.

## What was proposed first, and dropped

On 2026-10-15 this note proposed a program as "a machine plus its host handlers
plus typed inputs and outputs": `defineProgram` took `types`, `cmds`, `init`,
`update` and `subs` beside `inputs` and `outputs`, an input arrived as a Msg,
and `tell(run, input, payload)` answered `queued`, `stopped`, `bad_shape` or
`no_cell`. It was dropped on 2026-10-16: it made a program a kind of machine.
Its code was removed in experiment 63, apart from the shape check.

The same day, the first version of the new shape took its inputs once at start
and ran `main` to its end. It was changed before it merged: inputs became live,
flags took the start-once values, and `start` began to answer a run handle.
