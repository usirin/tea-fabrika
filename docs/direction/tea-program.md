# tea-program: programs between tea and a host

**Proposed** 2026-10-15, changed 2026-10-16 and 2026-10-17 (four times). Not settled.

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
const started = yield* start(shipProgram, { mode: "write" }, { outcome: show },
  { id: "ship:desk-1", storage: fileStorage(dir) });   // required when it has machines; or { kind: "bad_shape", name, why }
const { run, close, stop } = started;         // listeners above hear from main's first instant; `close` and `stop` are the starter's alone
tell(run, "pr", url);                         // never waits: "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"
run.listen("outcome", log);                   // from now on; nothing sent before is kept
run.machines.ship.changes;                    // what a late viewer reads: the machine's state now, then every change
close("pr");                                  // stdin's end: main finishes what it holds, the run ends on its own
yield* run.ended;                             // { kind: "ended" }; or yield* stop; run.id is stable

// review | ship: review starts already wired; each pipe is one writer on ship's `pr`,
// and `pr` closes when the last writer ends
yield* pipe({ program: reviewProgram, flags, keeping }, "passed", started, "pr");

// one program waiting on another: ask under an id you keep, hear the answer under it
tell(run, "ask", { id: intent, pr: url });   // asked again after a crash: answered again, nothing runs twice
tell(run, "forget", { id: intent });         // the answer is in your saved state now: ship drops its copy, says `forgot`

// storage, under every kept run: Effect's KeyValueStore, opened like a file
const handle = yield* storage.open("ship:desk-1", flags);   // start does this; the starter's handle holds it
handle.store("ship", { id: intent, until: "forgotten" });   // a tea Store; each save is atomic and fenced
// opened again elsewhere: this handle's next write fails `Stale`, like a stale file handle

// a program run like a command: flags, its inputs told and closed, wait, hear everything it sent
const called = yield* call(seq, { to: 3 }, { told: {}, stopOn: ctrlC });
// { kind: "called", ended, heard: [{ name: "n", value: 1 }, ...] } | { kind: "bad_shape", name, why }
```

**The rule: outputs are events.** Heard once, by whoever listens at that
moment, and kept nowhere. Anything a viewer who comes late needs lives in a
machine's state, which the handle serves as `run.machines.<name>.state()` and
`.changes`. Elm's ports keep nothing, and a Unix pipe is wired before the
program runs.

## What is proposed

Three layers, each with one job.

| Layer | Holds |
|---|---|
| tea (the kernel) | machines: `defineMachine`, update, Cmd, Sub, `run` on each engine |
| tea-program | programs: `defineProgram`, typed flags, inputs and outputs with descriptions, `start` and its run handle, `tell`, `pipe`, `call`, `readFlags`, the listing, the fit check |
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
  `tell`, which never waits and answers one of five words. `main` reads each
  input as a `Stream`.
- **Only the starter closes an input, like stdin's end.** The stream ends after
  the values told before the close, so a `main` that reads it to its end
  finishes what it holds and returns, and the run ends `ended`. Close is not
  stop. A `tell` on a closed input answers `closed`; `stopped` still means the
  run is gone. Never closed, an input stays open until the run is stopped.
- **Outputs are events, one-way, like Elm's outgoing ports.** `main` sends,
  whoever listens at that moment hears, nothing comes back, nothing is kept. A
  value its own output refuses is a bug in the program, and it fails the run.
- **`start` takes the listeners**, one optional callback per output, typed from
  the program's outputs, in place before `main` begins. It answers at once with
  the run and, beside it, `close` and `stop`. The run is a stable id, `ended`,
  `tell`, `listen` (from now on), and each declared machine by name, with its
  state now and a stream of its changes. It has no `close` and no `stop`:
  whoever is handed the run can tell it and listen to it, nothing more. The
  run lives in the starter's scope.
- **`pipe(from, output, to, input)` is `from | to`.** It starts `from` itself,
  so the wire is in place before `from` runs, and hands back `from`'s
  `Running`, `close` and `stop` included. Each value is told to `to`'s input; a
  word other than `queued` fails `from` at that send, like a broken pipe. Each
  pipe into an input is one writer on it, like a write end of a Unix pipe:
  when the last writer ends, the input closes. The starter's `close` closes it
  at once, for every writer. The fit check runs first, and `does_not_fit`
  starts nothing.
- **`call(program, flags, options)` runs a program like a command.** Its
  inputs are told `told` and then closed, like stdin from a file; `call`
  waits for the end and answers `called`: how the run ended and every value
  it sent, in order (`heard`). A flag or told value that does not fit answers
  `bad_shape`, and nothing runs. `stopOn` is an Effect that stops the run with
  the starter's `stop` when it finishes first: a terminal's Ctrl-C. The run
  lives inside the call, so interrupting the call stops the run. `keeping` is
  required exactly as `start` requires it. Added in experiment 67, for tsh's
  foreground lines and `$(…)`.
- **A run with machines is kept: the starter hands it an id and a storage.**
  The id is the same at every start of the run. `main` gets `keep`:
  `keep.store(machine, {id, until})` is a tea `Store` for one machine run,
  `keep.kept(machine)` lists what an earlier start left, `keep.find` reads one
  by id, and `keep.forget` drops one. A program with machines does not
  type-check without both, and dies before `main` if started from past the
  type checker. One that keeps nothing past the process says so with
  `memoryStorage()`; `fileStorage(dir)` keeps in a folder. A program with no
  machines may be given an id, or nothing.
- **Storage is Effect's `KeyValueStore`, opened like a file.** `memoryStorage()`
  is its memory layer, `fileStorage(dir)` its file layer on Node's
  `FileSystem` (the one Node import, in `storage-node.ts`), and
  `storageOf(layer)` takes any other: SQL, Web Storage, a browser
  `FileSystem`. Each start calls `storage.open(run, flags)` and gets a handle,
  the only way to write to the run. The starter's handle (`{run, close, stop}`)
  holds that storage handle; a program never sees it.
- **One record per run.** It holds the flags of the run's first start, the
  inputs its starter closed, how its last start ended (`ended`, `stopped`,
  `failed`, or `running` when it never said: a crash), and the index of its
  machine runs, since a `KeyValueStore` cannot list its keys. A close is
  written there before the input's stream ends; how the run ended is written
  before its end is told.
- **Every write is atomic.** The file layer writes in place, so a crash can
  leave half a value. Each value is kept in two slots, each with a checksum
  and a count; a write goes to the slot not holding the newest value, and a
  read takes the newest slot whose checksum holds. A torn write reads as the
  value before it. Index first, then the state; drop the state, then its
  index line; `open` drops an index line with no state behind it.
- **Every write is fenced.** The record counts the run's opens and names the
  newest with a random name. Each write through a handle first checks that
  the record still names its open; when a newer open has taken the run, the
  write fails `Stale` and nothing is written, and the program's machine stops
  with tea's `StoreFailed`. No process id is used.
- **A machine run is kept until it is not needed, never by time.** `until:
  "forgotten"`: until its asker says `forget`, or the whole run is removed
  (`storage.remove(run)`). `until: (state) => boolean`: a bare run, which
  nobody can ask about again, is dropped on the save that finds it over.
- **One program waits on another by ask and answer, under the asker's id.**
  An input that takes `{id, ...}` and an output that answers under the same
  id. The asker picks the id, keeps it in its own saved state, and asks again
  under it after a crash. The answerer keeps its work under that id: an
  unfinished one goes on from where it stood, and a finished one is answered
  again from storage, with nothing run twice. Once the answer is in the
  asker's own saved state, the asker says `forget {id}`, and the answerer says
  `forgot {id}` when the drop is kept. Ship is the first: `ask {id, pr}`,
  `answer {id, pr, outcome, name}`, `forget {id}`, `forgot {id}`. `operate`
  waits for `forgot` before it writes the answer on the lane, so a lane that
  has ended has left nothing in ship's storage. It stays plain inputs and
  outputs for now, the way request ids work over a socket. Count each program
  that needs the pattern; when there are enough, it gets a helper with good
  DX.
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
- Outputs are events because a late viewer wants "now, then every change",
  which is state, and the handle already serves it. Keeping every output for
  late listeners grew without end, and replaying old events to someone wired
  late does harm: a notifier wired late would send every old notice again.
  Listeners at start are what keeps the first values: a program that sends on
  its own, from a timer or at its start, sends before any `listen` could run.
- Only the starter closes, because an input can have many writers (a pipe, a
  person, a window). If any writer could close it, one pipe ending would cut
  off the rest. A pipe only ends its own writer; the input closes after the
  last one, as Unix does. Two review runs piped into one ship both got through,
  whichever ended first ([experiment 66](../../experiments/66-operate-starts-ship.md)).
- Only the starter stops, for the same reason. A run handed on is how others
  tell it and listen to it, and a holder of a run that could stop it would cut
  off every other writer at once. `stop` moved off the run in experiment 66;
  `"stop" in run` is `false`, not only hidden by the type.
- [Experiment 64](../../experiments/64-outputs-are-events.md) piped a stand-in
  review program into the real ship program: five pull requests through,
  outcomes in order, and the pipe ended on its own when review did. `launch.ts`
  stopped counting answers, and the 10 real pull requests printed the same
  bytes again.
- A run is kept, and asks carry the asker's id, because without both a crash
  loses work. Experiment 66 killed `operate` at five points of a ship and
  started it again. The ship program started with nothing kept got 4 of 10
  cells wrong: an ejected pull request put in the queue again, or a landed one
  written up as `ALREADY-MERGED`, as if someone else had merged it. Kept, with ask and answer,
  it got 10 of 10 right, the same as the child machine `operate` runs today.
  This is the end-to-end argument (the asker retries, the answerer drops
  repeats by id) and a daemon handed its spool directory.
- The keeping argument is required by type, not by a rule written down,
  because a run that forgets it works in every test until the first crash.
- Storage is atomic and fenced because the folder outlives the process in
  every way a crash can leave it: [experiment 68a](../../experiments/68a-storage.md)
  ran experiment 66's table on a real folder and added four kills that tear a
  write in half (the record as the run opens, as an ask is indexed, as an
  answer is forgotten, and the state as the pull request enters the queue).
  18 of 18 kept cells ended right, each pull request queued once, and nothing
  left in storage once the lane was done.
- Fencing has no process id because a folder can move between machines and a
  process id can be reused; an open count and a random name are in the folder
  itself.
- Effect's context is already how this repo asks for services. A program adds
  nothing new for that.

## What it costs

- A listener has to be known at start to hear the first values. One that comes
  later hears from then on, and reads state for the rest.
- A pipe has no back pressure: `tell` never waits, so nothing slows a fast
  upstream. Its downstream's line holds what is not yet read.
- A program's services are one union for every mode. Ship's read mode needs a
  write side that refuses, given by the launcher.
- A listing cannot name the services a program needs, or their settings. They
  live only in the type.
- A kept program is a second store beside its parent's, and an id both sides
  must keep. A child machine is one state and one store, with no gap between
  "the child said it" and "the parent heard it".
- An answer whose asker never says `forget` (it crashed for good, or was not
  written to say it) stays until the whole run is removed, and nothing removes
  a run yet: `operate` keeps one ship run per operate run.
- The fence is check-then-write: a `KeyValueStore` has no compare-and-set. In
  one process a lock makes the two one step; two processes on one folder can
  both pass the check before either writes. Only a store with compare-and-set
  (SQL) or a lock file closes that.
- Each write is two or three reads and one write, and every record write
  rewrites the whole index. Fine for tens of machine runs; not for thousands.
- Only the starter's close is kept. Values told and not yet read are lost in a
  crash (an asker asks again), and a pipe's writer ending is not marked.
- The type requires a storage at start, not that `main` keeps each machine run
  in it.
- Fit and the listing are only as good as the JSON Schema Effect writes: it
  leaves out patterns, and writes `Schema.Number` with NaN and Infinity as
  strings.

How sure: about 85% for the shape, now that outputs are events and a pipe ends
on its own. About 80% for a program that must survive a restart: it is built
and right at every crash point tried, torn writes included, on a real folder
but fake services. About 70% that a parent
should still embed the machine when it is the only one feeding it, and start
the kept program when many feed one.

## What would change this

- A host that needs to send a machine a Msg directly, often enough that
  inputs feel like a detour: then `dispatch` comes up again.
- A host that needs to know a program's services, often enough that a `needs`
  list beats reading the type.
- `operate` with `SHIP=program` live: if queue waits pile up because ship goes
  one pull request at a time, the child machine stays the default.
- The real review stage as a program, piped into ship: the stand-in in
  experiment 64 shows the wiring, not a real upstream.
- An output that a late viewer needs and that cannot be machine state: then
  the rule "outputs are events" needs an exception, and one has not been found.

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

Until 2026-10-17 the run handle kept every value a program sent, so a late
`listen` first heard the past. It was dropped in experiment 64: it mixed events
with state and grew without end. Listeners at start took its place.
