# 64. Outputs are events: no replay, listeners at start, closing an input, and `pipe`

```ts
// review | ship, with nothing counted and nothing kept
const ship = yield* start(shipProgram, {mode: "write"}, {outcome: print});   // the listener is in place before main begins
if (ship.kind !== "running") return ship;                                     // or bad_shape
const review = yield* pipe({program: reviewProgram, flags: {}}, "passed", ship, "pr");
// review starts here, already wired: each value it sends on `passed` is told to ship's `pr`

for (const url of urls) tell(review.run, "pr", url);   // "queued"
review.close("pr");          // stdin's end: review finishes, ends, and its end closes ship's `pr`
yield* ship.run.ended;       // { kind: "ended" }: ship finished the last pull request and ended on its own
```

The question: experiment 63's run handle kept every value a program sent, for
as long as the run lived, so that a `listen` added late would first hear the
past. That was there only because `start` begins `main` before anyone can call
`listen`. It mixed events with state, and on a long run it grows without end.
Can outputs be plain events (heard once, kept nowhere), with nothing lost,
and can `review | ship` end on its own the way a Unix pipe does?

**Answer: yes.** The store of sent values is gone. Listeners given to `start`
hear from `main`'s first instant. The starter can close an input, like the end
of stdin, and a `main` that reads it to its end finishes its last value and
returns. `pipe` wires one program into another and closes the downstream input
when the upstream ends. A stand-in review program piped into the real ship
program, on fake services, passed five pull requests through; ship's outcomes
came in order, and when review ended, ship finished the one it was holding
and ended by itself, three runs out of three. `launch.ts` no longer counts
answers. On the same 10 real pull requests as experiment 63, read only, the
new `run.ts` printed the same bytes as the old one. Nothing in `@demlik/tea`
changed.

About 85% sure of the shape. The doubts: `stop` is still on the run handle
anyone holds, a pipe has no back pressure, and a pipe closes its downstream
input even if someone else still writes to it. See the end.

## The rule

**Outputs are events. Anything a viewer who comes late needs lives in a
machine's state**, and the handle already serves that:
`run.machines.<name>.state()` for now, `.changes` for now and then every
change.

- Elm's outgoing ports keep nothing. A value a host needs at start comes in as
  a flag, not as a port message it hopes to catch.
- A Unix pipe is wired before the program runs. Nobody attaches to a pipe
  later and reads what went through it before.
- Replay does harm, not only memory. A program that sends notices, wired late
  to a sender of messages, would send every old notice again.
- A "the newest value" output is a copy of state. When a late reader seems to
  need one, the value belongs in the machine's state instead.

Why listeners at `start` matter: a program that answers what it is told can
be listened to after it starts, since nothing is sent before the first tell.
A program that sends on its own, from a timer or at its start, sends before
any `listen` could run. Listeners at start are how it is heard from the first
value.

## The shape

```ts
type Listeners<O> = {readonly [K in keyof O]?: (value: PayloadOf<O[K]>) => void};   // derived from the outputs

start(program, flags, listeners?, {id?}?)
  // Effect<Running | BadShape, never, R | Scope>

interface Running<F, I, O, Ms, E> {
  kind: "running";
  run: Run<F, I, O, Ms, E>;               // tell, listen (from now on), machines, stop, ended. No close.
  close: (name: keyof I & string) => void; // the starter's alone
}

pipe(from: {program, flags, listeners?}, output, to: Running, input)
  // Effect<Running | BadShape | DoesNotFit, never, R | Scope>

tell(run, "pr", url)  // "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"
```

**`close` is a separate value, not a method of the run.** Three shapes were
weighed:

| Shape | Can a holder of the run close? |
|---|---|
| `run.close(name)` | Yes. Anyone handed the run can cut off every other writer. |
| A `Run` subtype with `close`, handed to the starter | Only the type hides it. The object still has `close`, so `"close" in run` or a cast finds it. |
| `{run, close}`, side by side (chosen) | No. The run has no `close` in its type or on the object. Handing on `close` is a deliberate act, like handing someone a pipe's write end. |

The starter can still pass `close` on. `pipe` needs exactly that, so it takes
the downstream's whole `Running`, and its signature says it acts as the
starter. A test checks both halves: `run.close("name")` on what a non-starter
is given is a compile error (`@ts-expect-error`), and `"close" in run` is
`false`.

**Close is not stop.** Closing ends the input's stream after the values
already told, so `main` reads those, finishes what it holds, and returns. The
run then ends `ended`, not `stopped`. A `tell` on a closed input of a run
that is still alive answers `closed`, a new word. `stopped` still means the
run is gone. A host that shows why a send failed needs that difference.

**`pipe` takes the upstream before it starts.** `from` is a program and its
flags, not a running program, so there is no moment where it runs without the
wire. Starting it is `pipe`'s job. The mistake "wire it after it already sent
something" cannot be written. The downstream starts first, since it must
exist to be told.

**A refused tell breaks the pipe.** Each value `from` sends on `output` is
told to `to`'s `input`. A word other than `queued` makes `from` fail at that
send, and its end says why: `lines sent line down a pipe that answered
closed`. That is Unix's broken pipe: a write to a pipe nobody reads kills the
writer. It is also how a program's own bad output already ends: a bug, and
the run fails. When `from` ends, however it ends, `to`'s input is closed,
before anyone waiting on `from`'s end hears it.

**The fit check runs first.** `does_not_fit` starts nothing. `cannot_tell`
(a shape with no JSON Schema) goes on, since every value is still checked by
`tell` on the way in. Before that, the types refuse an input whose payload
type cannot take the output's (a compile error, tested).

## The user's job: `review | ship`, on its own to the end

A stand-in review program, shaped like the review stage: told pull requests
on `pr`, it sends each one on `passed`, whose shape is ship's input shape.
Piped into the real ship program in write mode, with fake `CodeHost` and
`CodeHostWrites` Layers. Five pull requests are told to review, then review's
input is closed. The fake queue holds the fifth pull request until review has
ended, so ship is still working when its input closes.

| Run | Outcomes, in order | When review ended | Ship's end |
|---|---|---|---|
| 1, 2, 3 (same each time) | `done`, `send:builder:checks_red`, `ask:owner:approval`, `stuck:enqueue_failed`, `done` | ship had answered fewer than 5; a tell to ship answered `closed` | `ended`, with all 5 outcomes |

The writes were the same in each run: an enqueue for #1, one re-run of red
checks for #2, an enqueue for #4 and one for the held fifth. No line of the
test counts outcomes to decide when to stop: it waits on `ship.run.ended`.

## The launcher, and the real pull requests

`launch.ts` now does what `printf '%s\n' <urls> | ship` does: start the
program with its listeners, tell every url, close `pr`, wait for `ended`. The
answer counter, its `Deferred` and the race between "all answered" and
"ended" are gone, and so is `Hear`, which is now `ListenersOf<ShipProgram>`,
derived from the program's outputs.

Read only, never `--write`. Old `run.ts` (`main`, in a temporary worktree)
and the new one, back to back on each pull request, with `--own` set to the
repo's two owner accounts. Stdout, stderr and the exit code compared byte for
byte. Saved in
[`results/64-outputs-are-events-old-vs-new.json`](./results/64-outputs-are-events-old-vs-new.json).

| Pull request | Name | Old vs new |
|---|---|---|
| kamp-us/demlik#683 | `done` | same bytes |
| kamp-us/demlik#675 | `skip:draft` | same bytes |
| kamp-us/demlik#671 | `done` | same bytes |
| kamp-us/demlik#658 | `done` | same bytes |
| kamp-us/demlik#629 | `done` | same bytes |
| kamp-us/phoenix#10679 | `skip:not_ours` | same bytes |
| kamp-us/phoenix#10580 | `ask:owner:approval` | same bytes |
| kamp-us/phoenix#10567 | `ask:owner:approval` | same bytes |
| kamp-us/phoenix#10313 | `send:builder:conflicts` | same bytes |
| kamp-us/phoenix#10262 | `send:builder:conflicts` | same bytes |

The names are the same as experiment 63's ten. Three told to one run (#683,
#10567, #10262) printed the same bytes old and new, and a url that is not a
pull request's gave the same `bad_shape` line and exit code.

A first pass used the wrong second owner account and was thrown away; it read
the pull requests that owner opened as not ours, on both sides alike. On that
pass #675 read `mergeable: "unknown"` with the old code and `"clean"` with
the new one, seconds later. Run back to back twice more, both read `clean`.
GitHub works mergeability out only when asked, which experiment 63 saw on the
same pull request.

## The mechanism rows

| Row | Test | Result |
|---|---|---|
| A listener given to `start` hears a value `main` sends at its first instant, before anything is told | `src/program/program.test.ts` | pass: `[0, 1]` |
| A late `listen` hears only what is sent after it came; `off()` stops it; a listener that throws hurts nobody | same file | pass: early `[1, 2, 3, 4]`, late `[3]`, nothing at once |
| Nothing is kept: 10,000 values sent and heard, then a forced garbage collection while the run is still going | same file | pass: 0 of 10,000 alive. With a store put back on purpose, all 10,000 stayed alive, so the test can fail |
| Close: every value told before it is read, the run ends `ended`, a tell after answers `closed`, after the end `stopped`; closing twice is harmless | same file | pass |
| Close is not stop: the value `main` holds when the input closes is finished and its answer sent | same file | pass |
| Only the starter may close: `@ts-expect-error` on `run.close`, and `"close" in run` is `false` | same file | pass |
| `pipe`: three values through, the upstream's end closes the downstream's input, both end `ended` | same file | pass |
| `pipe` surfaces a refused tell: into a closed input the upstream fails with `answered closed`; a value whose pattern fit cannot see fails it with `answered bad_shape`, after the value before it went through | same file | pass |
| `pipe` refuses `does_not_fit` (any number into whole numbers) before the upstream starts; an input of another payload type does not compile | same file | pass |
| Every experiment 63 row, moved to listeners at start | `src/program/program.test.ts`, `src/stages/ship/program.test.ts`, `src/code-host-github-writes.test.ts` | pass |

## Required later: a closed mark survives a restart

Programs have no saved state of their own yet. Once they do, **the closed
mark on an input must be saved with the run and restored with it.** A run
brought back after its input was closed has to start with that input closed.
Otherwise its `main` waits for values nobody will send, and never ends. The
starter (or the host that keeps the list of runs) owns that mark, since it
owns `close`.

## What got simpler, what got harder

Simpler:

- **A one-shot caller ends a run by closing its input.** `launch.ts` went from
  163 lines to 152. The counter, the `Deferred` and the race are gone.
- **Memory is bounded by what is unread, not by what was sent.** A program
  that runs for days keeps nothing it sent.
- **`review | ship` is one call**, and the pipe ends itself.
- **Tests wait for what they mean.** Each listener is given at start, so no
  test depends on a listener being added before the scheduler runs `main`.

Harder:

- **You must know your listeners at start** to hear the first values. A host
  that wires later hears from then on, by design, and reads state for the
  rest.
- **Every test helper that relied on replay had to change.** The old helpers
  added a listener after telling, and counted "the ones before". They are now
  one small `ear` (`src/program/ear.ts`) given to `start`.
- **The order of starting matters for a pipe.** The downstream starts first,
  then `pipe` starts the upstream. That is forced by the types, which is the
  point, but it is a rule a reader has to learn.

What fought back:

- **`closed` is only seen by a run that stays alive.** A first test closed a
  downstream echo's only input and piped into it. The echo read its input to
  the end and ended at once, so the tell answered `stopped`, not `closed`.
  That is right, but it means `closed` shows up only for a program that keeps
  running after an input closes (it has other inputs, or other work).
- **One cast stays.** The listeners record is typed by output name; the table
  that holds every listener is keyed by string. One `as`, with its reason, in
  one place, like `listen`'s.
- **A forced garbage collection in a test** needs Node's `gc` turned on at run
  time, and a `WeakRef` keeps its value alive until the task that made it
  ends, so the test waits a moment first.

## What this cannot tell us

- **No back pressure.** `tell` never waits, so a fast upstream fills the
  downstream's line as fast as it sends. The line holds only what is not yet
  read, so it is bounded by the gap between the two, but nothing slows the
  writer. A Unix pipe blocks the writer when its buffer is full.
- **One pipe's end closes the input for every writer.** With two programs
  piped into one input, the first to end cuts off the second, and anyone
  else telling it. Unix closes the read end only when every writer has
  closed. Not built: no program here has two writers yet.
- **`stop` is still on the run handle.** Anyone handed the run can stop it.
  Only closing was made the starter's. Whether stopping should be too is
  open.
- **The review program is a stand-in.** The real review stage is not a
  program yet.
- **Ten real pull requests, read only.** None would have enqueued or re-run
  checks; the write path ran only against fakes, as in 63.
- Left for later on purpose: a title and status as functions over a run's
  machine states, a raw `dispatch` on the handle, and a program's own saved
  state.
