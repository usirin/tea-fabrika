# 63. The ship stage as the first real program

```ts
// A program is what you start. It uses machines; it is not one.
const shipProgram = defineProgram({
  name: "ship",
  description: "Puts pull requests in the merge queue, one after another, and says how each one ended. ...",
  inputs:  { prs: input(NonEmptyArray(PullRequestUrl), "..."), mode: input(Literals(["read", "write"]), "...") },
  outputs: { found: output(Look, "..."), outcome: output(Shipped, "...") },
  main: ({ prs, mode }, send) => /* one run of the ship machine per pull request, on tea's Effect engine */,
});

start(shipProgram, { prs: [url], mode: "write" }, { outcome: (o) => console.log(o.name) })
  .pipe(Effect.provide(Layer.mergeAll(codeHost, codeHostWrites)));   // fakes in a test, GitHub in run.ts
// -> { kind: "ran" } | { kind: "bad_shape", input: "prs", why: "not a pull request url: ..." }
```

The question: experiment 62 built a `defineProgram` that flattened a machine's
fields (types, cmds, init, update, subs) into the program. That shape was
dropped: a machine and a program are different things. A **machine** is a data
structure, a state and the rules that move it (tea's `defineMachine`). A
**program** is the thing you start; it uses one or more machines and does I/O.
Does "a program is a name, a description, inputs, outputs and `main`" hold up on
real code, the ship stage, with no change to `@demlik/tea`?

**Answer: yes.** The ship stage is now a program. `run.ts` is a 50-line
launcher in front of it. On 10 real pull requests, read only, the new `run.ts`
prints the same bytes as the old one, on stdout and stderr. A caller in code
starts it with fake services, hands it six pull requests in one run, and hears
`done`, `send:builder:checks_red`, `ask:owner:approval`, `stuck:enqueue_failed`,
`stuck:read_failed` and `done:part` on its output, in order. Nothing in
`@demlik/tea` changed, and the ship machine (`createShip`, `ship`) is untouched.
About 85% sure the shape is right for one-shot programs like ship. It has not
met a program that takes values while it runs, which is where it is weakest.

## The program, as written

From [`src/stages/ship/program.ts`](../src/stages/ship/program.ts), trimmed only
where the descriptions are long:

```ts
export const createShipProgram = (machine = ship) =>
  defineProgram({
    name: "ship",
    description: "Puts pull requests in the merge queue, one after another, and says how each one ended. In read mode it changes nothing, and says what it would do.",
    inputs: {
      prs: input(Schema.NonEmptyArray(PullRequestUrl), "The pull requests, in order. Each gets a run of the ship machine of its own."),
      mode: input(Schema.Literals(["read", "write"]), "read: change nothing, ... write: run it to its end; ..."),
    },
    outputs: {
      found: output(Look, "Read mode, once per pull request: the facts read, the machine's answer, and the write it would send next. ..."),
      outcome: output(Shipped, "Write mode, once per pull request: how it ended."),
    },
    main: ({prs, mode}, send) =>
      Effect.forEach(
        prs,
        (pr) =>
          mode === "write"
            ? toTheEnd(pr, machine).pipe(Effect.flatMap((outcome) => send("outcome", {pr, outcome, name: nameOf(outcome)})))
            : look(pr).pipe(Effect.flatMap((found) => send("found", found))),
        {concurrency: 1, discard: true},   // one after another: two enqueues on one base branch would race
      ),
  });
```

`toTheEnd` is the old `alone.ts` body, moved: `run(machine, {interpret, subscribe, terminal})`
from `@demlik/tea/effect`, dispatch `start`, wait for `done()`. Its handlers ask
for `CodeHost` and `CodeHostWrites` from Effect's context, so `main`'s type is
`Effect<void, Stopped | StoreFailed, CodeHost | CodeHostWrites>`. `look` is the
read-mode step it always was. `alone.ts` was moved to `program.ts` with
`git mv`; its command-line parts went to `launch.ts`.

The generic part is [`src/program/program.ts`](../src/program/program.ts):

```ts
interface Program<I extends Inputs, O extends Outputs, E, R> {
  readonly name: string;
  readonly description: string;
  readonly inputs: I;    // { [name]: input(schema, description) }
  readonly outputs: O;   // { [name]: output(schema, description) }
  readonly main: (given: Given<I>, send: Send<O>) => Effect.Effect<void, E, R>;
}
start(program, given, hear?)  // Effect<Started, E, R>: checks the inputs, then runs main
readInputs(program, raw)      // a host's JSON: the typed inputs, or bad_shape
listing(program)              // name, description, each input and output with its JSON Schema
```

## The user's job: same answer as today's `run.ts`, on real pull requests

Read only. `--write` was never passed, and nothing was queued. Each pull request
ran through the old `run.ts` (a copy of `main`) and the new one back to back,
with `--own` set to the repo's two owner accounts, and the two outputs were
compared byte for byte, stdout and stderr. The saved answers are in
[`results/63-ship-program-old-vs-new.json`](./results/63-ship-program-old-vs-new.json).

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

One difference on the first pass, and it was time, not code: #675 read
`mergeable: "unknown"` with the old code and `"clean"` with the new one a
minute later. GitHub works mergeability out only once something asks. Run back
to back after that, old and new both read `clean`. None of the ten would have
enqueued or re-run checks, so `wouldSend` is `null` on all of them; that path is
only covered by the scripted tests.

A bad url now answers before anything runs, with the program's own words:

```
$ node src/stages/ship/run.ts https://github.com/kamp-us/demlik/issues/656 --own <account>
bad_shape: the input prs does not fit. not a pull request url: it looks like https://github.com/<owner>/<repo>/pull/<number>
  at [0]
```

The old `run.ts` printed its usage line for the same url. Several urls in one
call now work too: each is looked at in turn, one JSON block each.

## The mechanism rows

| Row | Test | Result |
|---|---|---|
| A caller starts the program from code with fake Layers, six pull requests in one program run, and hears each outcome in order | `src/stages/ship/program.test.ts` | pass: `done`, `send:builder:checks_red`, `ask:owner:approval`, `stuck:enqueue_failed`, `stuck:read_failed`, `done:part`; the writes were exactly one re-run and three enqueues |
| The same run twice gives the same outcomes | same file | pass |
| Read mode over three pull requests: three `found`, no write side made | same file | pass |
| A url that is not a pull request's, an empty list, a mode it does not have: `bad_shape`, nothing read | same file | pass |
| The listing: name, description, inputs and outputs with JSON Schema | same file | pass |
| Every old `alone.ts` test (read mode never makes the write side, write mode to its end, red checks run again once, gh failing on the enqueue, the re-run refused) | `src/code-host-github-writes.test.ts` | pass, through the program now |
| The generic shape on a toy with a service of its own: inputs typed, outputs in order, an output nobody hears, a typed input that fails a check its type cannot hold, a value its own output refuses dies with the output's name | `src/program/program.test.ts` | pass |

The ship machine takes one pull request per run: it ends at `over`. So the
program runs it once per pull request, one after another, inside one program
run. That is why the input is a list.

The listing, as a desktop host like Tuval would get it (the two output schemas
are long, 4,189 and 2,333 characters):

```json
{
  "name": "ship",
  "description": "Puts pull requests in the merge queue, one after another, and says how each one ended. ...",
  "inputs": [
    { "name": "prs", "description": "The pull requests, in order. ...",
      "schema": { "type": "array", "minItems": 1, "items": { "type": "string", "description": "https://github.com/<owner>/<repo>/pull/<number>" }, "prefixItems": [ ... ] } },
    { "name": "mode", "description": "read: change nothing, ...", "schema": { "type": "string", "enum": ["read", "write"] } }
  ],
  "outputs": [ { "name": "found", ... }, { "name": "outcome", ... } ]
}
```

## Experiment 62's code: removed, not kept

`src/program/` held experiment 62's `defineProgram` (machine fields
flattened), `tell`, `connect`, a runner per engine, and three toy programs. All
of it is removed, apart from `shape.ts`: `input`, `fit` and the shape check are
reused, and `output` is now declared the same way as `input`. Why remove:
nothing used it, the shape was rejected, and code kept "for reference" next to
the new shape is what the next agent copies by mistake. The write-up of 62 stays
as the record, and the code is in git at the commit that added it. The tests
that still mean something were ported: all of fit and the shape checks, on
local fixtures. The `tell` tests were not: in this shape inputs are start
values, so there is no `tell` to test yet. The three toys were dropped.

## Where it went against the brief

The brief said the url and the flags become the program's input. `--write`
did, as `mode`. `--own` and `--reviewers` did not: they are settings of the
GitHub reader (`CodeHost`), who the repo treats as its own. The machine never
reads them, and `main` would have nowhere to put them. So the launcher reads
them and makes the `CodeHost` Layer with them. About 75% sure this is right. The
doubt: a host that lists only inputs cannot tell a person that ship needs to
know the repo's owners. That is the next point.

## What got simpler, what got harder

Simpler:

- `run.ts` is a launcher: read the flags, check the input, say the mode, start
  the program, print what it hears. The old `Plan.write` boolean is a
  `mode: "read" | "write"` input with a description.
- The url check lives in one schema, with its message, and every caller gets
  it: the command line, a parent in code, a host with JSON.
- Tests start the real program with fake Layers. No scripted `gh` is needed to
  test what ship answers; the scripted `gh` tests still check the GitHub side.
- The read-only promise is a Layer. In read mode the launcher gives the program
  a `CodeHostWrites` that dies if called, and never calls `parts.writes()`.

Harder:

- **A program's services are one union for all its modes.** `main` needs
  `CodeHostWrites` in its type even in read mode, so read mode needs a stand-in
  that refuses. Splitting ship into two programs (a read-only `look` and `ship`)
  would make "read mode cannot write" a type fact instead of a Layer. Not done:
  one program is easier to list and to start. Worth a second look.
- **A listing cannot name the services.** `R` lives only in the type. A host
  cannot ask "what does ship need?" and get `CodeHost, CodeHostWrites` back, nor
  the settings those need (`--own`). A `needs` list on the program would fix
  that, at the cost of one more field that can drift from the type.
- **tea's errors show through.** `main`'s error type is tea's
  `Stopped | StoreFailed`, from `run`. Honest, but every program that runs a
  machine will carry them unless it maps them.
- **One cast.** `readInputs` checks each declared input and then says the
  record is a `Given<I>` with a single `as`: the compiler cannot add up the
  checks. It is in one place, with its reason.
- **JSON Schema from Effect 4.0.0 is not the check.** Patterns are left out
  (the url's pattern is not in the listing, so the description carries the
  form), and `Schema.Number` is written as "a number or one of the strings NaN,
  Infinity, -Infinity". Use `Schema.Finite` or `Schema.Int` in a program's
  shapes.

Fighting tea: none. `run`, `ready`, `dispatch`, `done()` and the `terminal`
predicate did the job as published. Fighting Effect: only small things.
`Effect.provide` builds a Layer before the program runs, so the launcher checks
the input first, so that a bad url makes no service at all. `Effect.forEach`
is serial by default, and the repo's lint rule wants that said, so it says
`concurrency: 1` with the reason.

## What wiring `operate` to the ship program would take

Today `operate` steps the ship machine as a child inside the operator's own
`update`, Elm's way: the child's state is part of the operator's saved state,
and its Cmds and Subs are lifted into the operator's. To use the program
instead:

```ts
// sketch: the operator's ship stage becomes one Cmd whose handler starts the program
ship_run: (cmd) =>
  start(shipProgram, {prs: [cmd.pr], mode: "write"}, {outcome: (o) => (heard = o)})
    .pipe(Effect.map(() => heard))   // settles as ship_run_ok with the outcome
```

What it costs: the ship run's state leaves the operator's saved state. A restart
in the middle of a ship stage could no longer pick the ship machine up where it
stopped (waiting on checks, in the queue); it would start the program again and
read fresh. The ship machine reads fresh at every step, so that may be fine, but
it has to be tested on a restart. It also needs a way for the program to save
its own state, which this shape does not have yet.

## What this cannot tell us

- Ten real pull requests, read only, and none would have been enqueued: the
  write path ran only against fakes and the scripted `gh`.
- One real program. A program that takes values while it runs (a live input,
  like experiment 62's `tell`) has no shape here yet; inputs are start values,
  like Elm's flags.
- Whether a host can live without a list of the services a program needs.
- Whether a program needs its own saved state, apart from its machines'.
