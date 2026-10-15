# tea-program: programs and pipes between tea and a host

**Proposed** 2026-10-15. Not settled.

```ts
// tea: the kernel. A machine is pure logic.
const machine = defineMachine({ types, cmds, init, update, subs });

// tea-program: a program is a machine, plus its host handlers,
// plus typed inputs and outputs with descriptions.
const ship = defineProgram({
  name: "ship",
  description: "Puts one pull request at a time in the merge queue.",
  inputs: { hand: input(PR, "A pull request to put in the merge queue.") },
  outputs: [announced],
  /* types, cmds, init, update, subs, as in defineMachine */
});
const shipRun = startPromise(ship, { interpret, subscribe });   // you start a program, never a bare machine

// the host: finds, starts and shows programs, and wires them in plain code.
connect(operatorRun, handoff, shipRun, "hand");
tell(shipRun, "hand", { pr: "#7", head: "abc1234" });   // "queued" | "stopped" | "bad_shape" | "no_cell"
```

## What is proposed

Three layers, each with one job.

| Layer | Holds |
|---|---|
| tea (the kernel) | machine, update, Cmd, Sub, run, Elm ports, and a `tell` that never waits |
| tea-program | programs and pipes: `defineProgram` with typed inputs and outputs plus descriptions, wiring in code, the fit check, queues and drop rules |
| a host (a desktop app, say) | finds programs, starts them, shows them |

Tuval is a host that will build on this.

- **A machine is pure logic.** It knows nothing about where its Cmds go.
- **A program is a machine plus its host handlers plus typed inputs and
  outputs.** You start a program, never a bare machine.
- **An input is an ordinary Msg**, `{ type: "hand", payload }`. Its type comes
  from the schema; the author writes no Msg type for it.
- **An output is one-way, like an Elm outgoing port.** It is a plain Cmd,
  `announced(value)`. Any number of listeners hear it, none is fine, nothing
  comes back. There is no `_ok` or `_err` for it.
- **A value that must arrive goes through a Cmd whose handler calls `tell`.**
  The program defines that Cmd itself, and its ok or err comes back as a Msg,
  like Elm's Http. So the sender learns what became of it, in its own update.
- **`tell(run, input, payload)` answers exactly one of four words**, at once,
  and never waits:

  ```ts
  type Word = "queued" | "stopped" | "bad_shape" | "no_cell";
  ```

- **Tea puts no limit on inputs.** If a line needs a limit or a drop rule, it
  belongs to tea-program.
- **No ask/reply helper.** A question and its answer are two values, one each
  way, wired like any others.
- **Wiring is plain host code**, plus a fit check: the output's shape must be
  exactly the input's. More fields does not fit. Descriptions do not count.
  A shape with no JSON Schema answers "cannot tell". No registry, no lookup, no
  route graph.
- **A shape only checks**, it never converts. The value passed on is the value
  that came in.

## Why

- It is Elm. Ports out, Msgs in, Cmds for anything that must come back. No new
  shape was needed.
- Tea stays small. [Experiment 62](../../experiments/62-tea-program-on-unchanged-tea.md)
  built all of tea-program on `@demlik/tea` 0.20.0 with no change to tea, apart
  from the never-wait `tell`. That fix is already approved and tracked in tea.
- A host gets descriptions and JSON Schemas for every input and output, so it
  can list and show programs without reading their code.

## What it costs

- Tea must give a `tell` that never waits and knows when a run has stopped,
  including when tea stopped it itself. Until then, `tell` can say `queued` for
  a dead run (experiment 62).
- Fit is only as good as the JSON Schema Effect writes. Effect 4.0.0 leaves out
  patterns, so a looser output can "fit" and then every value comes back
  `bad_shape` at tell time.
- `defineProgram` is typed on its outside and loose inside, because of how
  tea's `update` type is built.

How sure: about 75%. The layering held for three small programs in tests. It
has not met a real host.

## What would change this

- A host that needs to ask a program and wait for its answer often enough that
  two one-way values feel wrong.
- Exact fit turning out too strict once people wire real programs.
- Tea's `tell` fix needing more than a sync answer at the moment a Msg goes on
  the line.
