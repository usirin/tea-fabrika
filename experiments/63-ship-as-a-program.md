# 63. The ship stage as the first real program

```ts
// A program is what you start. It uses machines; it is not one.
const shipProgram = defineProgram({
  name: "ship",
  description: "Puts pull requests in the merge queue, one after another, as it is told them, ...",
  flags:    { mode: flag(Literals(["read", "write"]), "...") },      // argv: once, at start
  inputs:   { pr: input(PullRequestUrl, "A pull request to ship. Tell it any time, ...") },  // stdin: any time
  outputs:  { found: output(Look, "..."), outcome: output(Shipped, "...") },
  machines: { ship },                                                 // a host can watch it by name
  main: ({ flags, inputs, send, watch }) =>
    inputs.pr.pipe(Stream.runForEach((pr) => /* a fresh run of the ship machine for this pull request */)),
});

const started = yield* start(shipProgram, { mode: "write" });   // needs CodeHost, CodeHostWrites, Scope
// -> { kind: "running", run } | { kind: "bad_shape", name: "mode", why }
const run = started.run;
run.listen("outcome", (o) => console.log(o.name));   // any time, more than once; a late listener hears what came before (changed in 64: from now on only)
tell(run, "pr", url);                                // never waits: "queued" | "stopped" | "bad_shape" | "no_cell"
run.machines.ship.state();                           // the newest ship machine's state, or null before the first
run.machines.ship.changes;                           // Stream: the state now, then every change; ends with the run
yield* run.stop;                                     // or yield* run.ended  -> { kind: "ended" | "stopped" | "failed" }
run.id;                                              // "ship:<uuid>", stable for the run's life
```

The question: experiment 62 built a `defineProgram` that flattened a machine's
fields (types, cmds, init, update, subs) into the program. That shape was
dropped: a machine and a program are different things. A **machine** is a data
structure, a state and the rules that move it (tea's `defineMachine`). A
**program** is the thing you start; it uses one or more machines and does I/O.
Does "a program is a name, a description, flags, inputs, outputs and `main`"
hold up on real code, the ship stage, with no change to `@demlik/tea`?

**Answer: yes.** The ship stage is now a program. `run.ts` is a 51-line
launcher in front of it. On 10 real pull requests, read only, the new `run.ts`
prints the same bytes as the old one, on stdout and stderr. A parent in code
starts it once with fake services, tells it six pull requests in two batches,
and hears `done`, `send:builder:checks_red`, `ask:owner:approval`,
`stuck:enqueue_failed`, `stuck:read_failed` and `done:part` on its output, in
order, while the run keeps going until it is stopped. Nothing in `@demlik/tea`
changed, and the ship machine (`createShip`, `ship`) is untouched.

About 80% sure of the shape. The doubt is in the handle: whether a host needs
to send a machine a Msg of its own (left out on purpose), and whether keeping
every output for late listeners holds up for a program that runs for days.

> **Changed in 64.** Keeping every output for late listeners did not hold up,
> and was removed in [experiment 64](./64-outputs-are-events.md). Outputs are
> events now: a `listen` hears from the moment it is added, and listeners given
> to `start` hear from `main`'s first instant. Whatever a late viewer needs
> lives in a machine's state. The starter can also close an input, so a
> one-shot caller no longer counts answers: it closes the input and waits for
> the run to end. What this write-up says about late listeners, counting and
> stopping below describes the code as it was on 2026-10-16.

## Built twice: start once, then live inputs

The first version took its inputs once at start, like Elm's flags, and ran
`main` to its end: `start(program, {prs, mode}, hear)` answered `{kind: "ran"}`
when it was over. A check against what a desktop host like Tuval needs found
that this loses most of it. Such a host keeps a program running and keeps
feeding it, the way a shell takes prompt after prompt, and its screen keeps
listening to the outputs. So the shape changed:

- **Inputs are live, like stdin.** A running program is told on its inputs at
  any time, with `tell(run, input, value)`, which never waits. `main` reads each
  input as an Effect `Stream`.
- **Flags are argv.** Values needed once, at start, are a separate, optional
  field, checked by a schema the same way. Ship's mode is a flag.
- **`start` answers a run handle at once**, not the end: a stable id, `stop`, a
  way to wait for the end, `listen` on any output at any time, and each machine
  by name, with its state now and a stream of its changes.
- **No `dispatch(machine, msg)` on the handle.** Whether a host may hand a
  machine a Msg of its own is an open question for the owner. Until then, a
  program's inputs are the only way in.

Both versions were compared with the old `run.ts` on the same 10 pull requests,
and both printed the same bytes.

## The program, as written

From [`src/stages/ship/program.ts`](../src/stages/ship/program.ts), trimmed only
where the descriptions are long:

```ts
export const createShipProgram = (machine = ship) =>
  defineProgram({
    name: "ship",
    description: "Puts pull requests in the merge queue, one after another, as it is told them, and says how each one ended. ...",
    flags: {mode: flag(Schema.Literals(["read", "write"]), "read: change nothing, ... write: run it to its end; ...")},
    inputs: {pr: input(PullRequestUrl, "A pull request to ship. Tell it any time, as many as you like: each gets a fresh run of the ship machine once the one before has ended.")},
    outputs: {
      found: output(Look, "Read mode, once per pull request: the facts read, the machine's answer, and the write it would send next. ..."),
      outcome: output(Shipped, "Write mode, once per pull request: how it ended."),
    },
    machines: {ship: machine},
    main: ({flags, inputs, send, watch}) =>
      inputs.pr.pipe(
        Stream.runForEach((pr) =>
          flags.mode === "write"
            ? toTheEnd(pr, machine, watch).pipe(Effect.flatMap((outcome) => send("outcome", {pr, outcome, name: nameOf(outcome)})))
            : look(pr).pipe(Effect.flatMap((found) => send("found", found))),
        ),
      ),
  });
```

**One fresh ship machine per pull request.** The ship machine takes one pull
request from `start` to `over` and then stops; it was built that way and works
that way as the operator's child. So the program is what keeps running, not the
machine. `Stream.runForEach` takes the pull requests one at a time, never side
by side: two enqueues on one base branch would race. A pull request told while
another is running waits on the input's line.

`toTheEnd` is the old `alone.ts` body, moved: `run(machine, {interpret,
subscribe, terminal})` from `@demlik/tea/effect`, then `watch("ship", runtime)`,
then dispatch `start` and wait for `done()`. `alone.ts` was moved to
`program.ts` with `git mv`; its command-line parts went to `launch.ts`.

The generic part is [`src/program/program.ts`](../src/program/program.ts):

```ts
defineProgram({name, description, flags?, inputs, outputs, machines?, main})
main(io)        // io = {flags, inputs: {[name]: Stream}, send(name, value), watch(machineName, runtime)}
start(program, flags, {id?})   // Effect<{kind: "running", run} | BadShape, never, R | Scope>
tell(run, name, value)         // typed; run.tell(name, value) is the same door for a host's JSON
readFlags(program, raw)        // a host's JSON: the typed flags, or bad_shape
listing(program)               // name, description, flags, inputs, outputs (each with JSON Schema), machine names
```

The run lives in the starter's scope: closing it stops the run. `tell` checks
in this order: `no_cell` (the program has no input of that name), `bad_shape`
(the value fails the input's shape), `stopped` (the run has ended or is
stopping), else `queued`. `no_cell` means something smaller here than in 62:
there it meant "the machine's state has no cell for this Msg"; here a program
is not a machine, so it means only "no such input".

## The user's job: same answer as today's `run.ts`, on real pull requests

Read only. `--write` was never passed, and nothing was queued. The launcher
starts the program with the mode flag, tells it each url in order on `pr`,
waits until each has an answer, prints it, and stops the run. Each pull
request ran through the old `run.ts` (a worktree of `main`) and the new one
back to back, with `--own` set to the repo's two owner accounts, and the two
outputs were compared byte for byte, stdout and stderr. The saved answers are
in [`results/63-ship-program-old-vs-new.json`](./results/63-ship-program-old-vs-new.json).

| Pull request | State | Name | Old vs new |
|---|---|---|---|
| kamp-us/demlik#683 | merged | `done` | same bytes |
| kamp-us/demlik#675 | open draft | `skip:draft` | same bytes |
| kamp-us/demlik#671 | merged | `done` | same bytes |
| kamp-us/demlik#658 | merged | `done` | same bytes |
| kamp-us/demlik#629 | merged | `done` | same bytes |
| kamp-us/phoenix#10679 | open, opened by a bot | `skip:not_ours` | same bytes |
| kamp-us/phoenix#10580 | open | `ask:owner:approval` | same bytes |
| kamp-us/phoenix#10567 | open | `ask:owner:approval` | same bytes |
| kamp-us/phoenix#10313 | open | `send:builder:conflicts` | same bytes |
| kamp-us/phoenix#10262 | open | `send:builder:conflicts` | same bytes |

Three of them told to one run (#683, #10567, #10262) printed the same bytes as
the three single runs put end to end.

On the first pass of the start-once version, #675 read `mergeable: "unknown"`
with the old code and `"clean"` with the new one a minute later. GitHub works
mergeability out only once something asks. Run back to back, both read
`clean`. None of the ten would have enqueued or re-run checks, so `wouldSend`
is `null` on all of them; that path is only covered by the scripted tests.

A bad url answers before anything runs, in the input's own words:

```
$ node src/stages/ship/run.ts https://github.com/kamp-us/demlik/issues/1 --own <account>
bad_shape: the input pr does not fit. not a pull request url: it looks like https://github.com/<owner>/<repo>/pull/<number>
```

The launcher asks the input's shape about each url before it starts the
program, so a bad url makes no service at all. A running program answers the
same thing from `tell`: `bad_shape`.

## The mechanism rows

| Row | Test | Result |
|---|---|---|
| A parent starts the program once with fake Layers, tells it three pull requests, waits, tells three more, and hears each outcome in order; the run keeps going until `stop` | `src/stages/ship/program.test.ts` | pass: `done`, `send:builder:checks_red`, `ask:owner:approval`, `stuck:enqueue_failed`, `stuck:read_failed`, `done:part`; the writes were exactly one re-run and three enqueues, two of them before the second batch was told |
| The same six told to two runs give the same outcomes | same file | pass |
| The handle shows the ship machine by name: `null` before any pull request, then each phase from `idle` to `over`; the stream ends with the run | same file | pass |
| `tell` with a url that is not a pull request's: `bad_shape`, nothing read; a name it has no input for: `no_cell` | same file | pass |
| The launcher: read mode over three pull requests, three `found`, no write side made; a bad url, `bad_shape` before any service | same file | pass |
| The listing: flag, input, outputs with JSON Schema, and the machine name | same file | pass |
| Every old `alone.ts` test (read mode never makes the write side, write mode to its end, red checks run again once, gh failing on the enqueue, the re-run refused) | `src/code-host-github-writes.test.ts` | pass, through the launcher now |
| The generic shape on a toy with a service and a machine of its own: names told over time, late and many listeners, a listener that throws hurts nobody, a machine's changes, a stable id, ended / stopped (by `stop` and by closing the scope) / failed, `tell` after the end answers `stopped`, a flag that fails a check its type cannot hold, a program with no flags and no machines | `src/program/program.test.ts` | pass |

The listing, as a desktop host like Tuval would get it (the two output schemas
are long):

```json
{
  "name": "ship",
  "description": "Puts pull requests in the merge queue, one after another, as it is told them, ...",
  "flags":  [ { "name": "mode", "description": "read: change nothing, ...", "schema": { "type": "string", "enum": ["read", "write"] } } ],
  "inputs": [ { "name": "pr", "description": "A pull request to ship. ...", "schema": { "type": "string", "description": "https://github.com/<owner>/<repo>/pull/<number>" } } ],
  "outputs": [ { "name": "found", ... }, { "name": "outcome", ... } ],
  "machines": ["ship"]
}
```

## Experiment 62's code: removed, not kept

`src/program/` held experiment 62's `defineProgram` (machine fields
flattened), `tell`, `connect`, a runner per engine, and three toy programs. All
of it is removed, apart from `shape.ts`: `input`, `fit` and the shape check are
reused, and `flag` and `output` are declared the same way as `input`. Why
remove: nothing used it, the shape was rejected, and code kept "for reference"
next to the new shape is what the next agent copies by mistake. The write-up of
62 stays as the record, and the code is in git at the commit that added it.
The tests that still mean something were ported: all of fit and the shape
checks, on local fixtures. The four words of 62's `tell` came back, on the new
`tell`.

## Where it went against the brief

The brief said the command line's values become the program's. `--write` did,
as the flag `mode`, and each url did, as a value told on `pr`. `--own` and
`--reviewers` did not: they are settings of the GitHub reader (`CodeHost`), who
the repo treats as its own. The machine never reads them, and `main` would have
nowhere to put them. So the launcher reads them and makes the `CodeHost` Layer
with them. About 75% sure this is right. The doubt: a host that lists only
flags and inputs cannot tell a person that ship needs to know the repo's
owners.

## What got simpler, what got harder

Simpler:

- `run.ts` is a launcher: read the command line, check each url, say the mode,
  start the program, tell it the urls, print what it hears, stop it.
- The url check lives in one schema, with its message, and every caller gets
  it: the command line, a parent in code, a host with JSON.
- Ship can be fed later, one pull request after another, while it keeps
  running: `review | ship` has an input to write to.
- Tests start the real program with fake Layers. No scripted `gh` is needed to
  test what ship answers; the scripted `gh` tests still check the GitHub side.
- The read-only promise is a Layer. In read mode the launcher gives the program
  a `CodeHostWrites` that dies if called, and never calls `parts.writes()`.

Harder:

- **Waiting for "done" is the caller's job now.** A program that reads an input
  never ends on its own. The launcher counts the answers it hears and stops the
  run after the last; a parent in code does the same. That is how stdin works,
  but it is a step every one-shot caller has to write. *(Changed in 64: the
  starter closes the input, like stdin's end, and the run ends on its own.)*
- **Every output is kept, for late listeners.** A listener that comes late
  first hears everything sent before it. For ship that is a few values. For a
  program that runs for days it grows without end; a cap, or a "from now" way
  to listen, would be needed. *(Changed in 64: nothing is kept; listeners given
  to `start` hear from the first instant, and a late viewer reads state.)*
- **Read mode shows no machine on the handle.** `look` steps the machine with
  `applyCell` and never starts a runtime, so `run.machines.ship` stays `null`.
- **A program's services are one union for all its modes.** `main` needs
  `CodeHostWrites` in its type even in read mode, so read mode needs a stand-in
  that refuses. Two programs (a read-only `look` and `ship`) would make "read
  mode cannot write" a type fact instead of a Layer.
- **A listing cannot name the services.** `R` lives only in the type. A host
  cannot ask "what does ship need?" and get `CodeHost, CodeHostWrites` back, nor
  the settings those need (`--own`).
- **Two casts with reasons.** `readFlags` says the checked record is a
  `Given<F>`, and `listen` widens a typed listener to the table of all
  listeners. Each is one `as`, in one place, with its reason.
- **JSON Schema from Effect 4.0.0 is not the check.** Patterns are left out
  (the url's pattern is not in the listing, so the description carries the
  form), and `Schema.Number` is written as "a number or one of the strings NaN,
  Infinity, -Infinity". Use `Schema.Finite` or `Schema.Int` in a program's
  shapes.

Fighting tea: none. `run`, `ready`, `dispatch`, `done()`, `getState` and
`subscribe` did the job as published; `subscribe` feeds the machine's view.
Fighting Effect, two small things. A fiber forked into a scope that closes
before the fiber has started is interrupted without running any of it, so an
`onExit` inside it never runs; the run's end is read from outside, with the
fiber's `addObserver`. And a stream of a `SubscriptionRef` cut off with
`interruptWhen` drops values its reader had not pulled yet; the view keeps an
`over` mark instead, and the stream stops after it.

## What wiring `operate` to the ship program would take

Today `operate` steps the ship machine as a child inside the operator's own
`update`, Elm's way: the child's state is part of the operator's saved state,
and its Cmds and Subs are lifted into the operator's. To use the program
instead, the operator would start the ship program once, when it starts, and
its ship stage would become one Cmd:

```ts
// sketch: the handler tells the running ship program, and settles with the outcome it hears for that pull request
ship_run: (cmd) => outcomeFor(shipRun, cmd.pr)   // tell(shipRun, "pr", cmd.pr), then wait on listen("outcome") for that pr
// changed in 64: nothing is kept, so listen first, then tell, or give the listener to `start`
```

What it costs: the ship run's state leaves the operator's saved state. A restart
in the middle of a ship stage could no longer pick the ship machine up where it
stopped (waiting on checks, in the queue); it would tell the program again and
read fresh. The ship machine reads fresh at every step, so that may be fine, but
it has to be tested on a restart. A program also has no saved state of its own
yet.

## What this cannot tell us

- Ten real pull requests, read only, and none would have been enqueued: the
  write path ran only against fakes and the scripted `gh`.
- One real program. Wiring two programs together (`review | ship`) is not
  built; the exact fit check in `shape.ts` is there for it.
- Whether a host needs `dispatch(machine, msg)`. Left out on purpose.
- Whether a host can live without a list of the services a program needs.
- Whether a program needs its own saved state, apart from its machines'.
