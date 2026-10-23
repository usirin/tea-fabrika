# tea-program: programs between tea and a host

**Proposed** 2026-10-15, changed 2026-10-16, 2026-10-17 (five times) and 2026-10-19. Not settled.

```ts
// tea: the kernel. A machine is a data structure: a state and the rules that move it.
const ship = createShip();   // defineMachine({ types, cmds, init, update, subs })

// tea-program: a program is what you start. It uses machines; it is not one.
const shipProgram = defineProgram({
  name: "ship",
  description: "Puts pull requests in the merge queue, one after another, as it is told them.",
  flags:    { mode: flag(Mode, "read or write, for the whole run.") },          // argv
  inputs:   { pr: input(PullRequestUrl, "A pull request to ship. Tell it any time.") },  // stdin; holds 1000 unread, or {capacity: n}
  outputs:  { outcome: output(Shipped, "How one pull request ended.") },
  machines: {                                 // one declaration per kind of machine run it keeps
    queue: queueKind,                         // the pull requests told and not finished, kept
    ship: kind({
      machine: ship,
      parent: "main",                         // who takes each run to its end: main, or another kind
      options: () => ({ ctx, interpret, subscribe, terminal: (s) => s.phase === "over" }),  // never a store
      recovered: (s) => (s.phase === "idle" ? null : { type: "resume" }),  // found part way: the Msg that goes first
      drawing: ({ id, kept, start }) => shipDrawing(...),                  // how its trace shows it
      status: (s) => `${ref(s.pr)}: ${words(s)}`,   // one line per copy, typed by ship's state: `#8: in the merge queue`
    }),
  },
  main: ({ flags, inputs, send, machines }) =>   // an Effect: a ship run per pull request, through the kept queue
    workQueue(machines.queue, inputs.pr, (pr) => shipOne(machines.ship.get(`pr/${pr}`), pr, send),
      (pr) => machines.ship.get(`pr/${pr}`).clear),
});

// inside main: a ref per run, by id (Durable Objects' get, Temporal's handle)
const ref = machines.ship.get(id);            // nothing read, nothing started
const runtime = yield* ref.start({ type: "start", pr });  // the one live copy of that id, shared by every start
// another start Msg on a live copy fails AlreadyStarted, as Temporal answers; { conflict: "use_existing" } shares it
yield* ref.read;                              // its kept state, or null
yield* ref.clear;                             // its parent is done with it: dropped from storage (refused while live)
yield* machines.ship.list;                    // every run of the kind kept, for a tidy-up

// the host: lists programs, starts them, feeds them, listens, provides their services.
listing(shipProgram);                         // name, description, flags, inputs, outputs (JSON Schema), machine names, and which have a status line
const started = yield* start(shipProgram, { mode: "write" }, { outcome: show },
  { id: "ship:desk-1", storage: fileStorage(dir) });   // required when it has machines; or { kind: "bad_shape", name, why }
const { run, close, stop } = started;         // listeners above hear from main's first instant; `close` and `stop` are the starter's alone
yield* tell(run, "pr", url);                  // never waits: "queued" | "closed" | "stopped" | "bad_shape" | "no_cell"; a full line fails Full
yield* offer(run, "pr", url);                 // the same, but waits for room on a full line
run.listen("outcome", log);                   // from now on; nothing sent before is kept
run.machines.ship.changes;                    // what a late viewer reads: the machine's state now, then every change
run.machines.ship.copies();                   // every copy this start showed: [{ id, line: "#8: in the merge queue", live }]
run.machines.ship.lines;                      // those copies now, then again each time a line changes
close("pr");                                  // stdin's end: main finishes what it holds, the run ends on its own
yield* run.ended;                             // { kind: "ended" }; or yield* stop; run.id is stable

// review | ship: review starts already wired; each pipe is one writer on ship's `pr`,
// and `pr` closes when the last writer ends
yield* pipe({ program: reviewProgram, flags, keeping }, "passed", started, "pr");

// one program waiting on another: ask under an id you keep, hear the answer under it
yield* tell(run, "ask", { id: intent, pr: url });   // asked again after a crash: answered again, nothing runs twice
yield* tell(run, "forget", { id: intent });         // the answer is in your saved state now: ship drops its copy, says `forgot`

// storage, under every kept run: Effect's KeyValueStore, opened like a file
const handle = yield* storage.open("ship:desk-1", flags);   // start does this; the starter's handle holds it
handle.store("ship", intent);                 // a tea Store; each save is atomic and fenced. Only a ref's start uses it
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
  `tell`, an Effect that never waits and answers one of five words. `main`
  reads each input as a `Stream`.
- **Each input's line has a size limit, its `capacity`** (2026-10-19). An
  Effect bounded `Queue` of the input's capacity: 1000 (`CAPACITY`, Akka's
  default mailbox) unless the program says another where it declares the
  input, `input(Line, "...", {capacity: 16})`. A program fact, not a host
  setting. One that is not a whole number, 1 or more, is refused when the
  program is defined. A `tell` past it never waits and fails with a tagged
  error, `Full` (`{input, capacity}`), not a word: a caller that does not
  handle it fails, and its type says `Full`. One that expects a full line
  says so with `Effect.catchTag("Full", ...)`. `offer` waits for room, and a
  pipe, its outbox's resend and `call` use it. No dropping or sliding line
  yet. Because `tell` is an Effect, a bare `tell(...)` statement would be
  made and dropped; `pnpm lint` refuses one.
- **A program declares its `limits`; its host enforces them** (decided
  2026-10-20). A container's `resources.limits` and the cgroup that enforces
  them, for tea programs: dollars or tokens, wall time (Kubernetes'
  `activeDeadlineSeconds`), how many children run at once (OTP's
  `max_children`). The numbers come from `fabrika.toml`.
  - **Limits nest like cgroups.** A parent's limit caps itself and every child
    under it in the supervision tree, so a ticket's limit covers its builder
    and the scouts it asks for.
  - **Spend is kept in the ledger, per name.** A restart does not reset it;
    otherwise a crash loop could spend without end.
  - **Going over ends the run, like `OOMKilled`,** with exit reason
    `limit:<kind>`. Its supervisor does not restart a limit exit; it goes to the
    program's dead-letter stream, so the desk shows it to raise or drop.
  - Same shape as an input's `capacity`: a program fact, enforced by the host,
    answered with a typed reason. This replaces fabrika's own supervisor as the
    one that says no ([helpers](./helpers-and-the-supervisor.md)).
  - Open: soft limits (warn before the end), as cgroups have.
- **Only the starter closes an input, like stdin's end.** The stream ends after
  the values told before the close, so a `main` that reads it to its end
  finishes what it holds and returns, and the run ends `ended`. Close is not
  stop. A `tell` on a closed input answers `closed`; `stopped` still means the
  run is gone. Never closed, an input stays open until the run is stopped.
- **Outputs are events, one-way, like Elm's outgoing ports.** `main` sends,
  whoever listens at that moment hears, nothing comes back, nothing is kept
  (but a pipe into an input that acks, below). A
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
  The id is the same at every start of the run. A program with machines
  does not type-check without both, and dies before `main` if started from
  past the type checker. One that keeps nothing past the process says so
  with `memoryStorage()`; `fileStorage(dir)` keeps in a folder. A program
  with no machines may be given an id, or nothing.
- **Each kind of machine run is declared once, on `defineProgram`.** A kind
  is its machine, its `parent` (`main`, or another kind of the program), its
  `options` (built from the flags, `send` and the refs; never a store), what
  goes first when a run is found part way (`recovered`), its `drawing`, and
  its `status` line. `main` gets a ref table per kind: `get(id)` is a ref,
  as Durable Objects' `get` and Temporal's handle are; `start(msg)` runs it
  (next bullet), `read` its kept state, `clear` drops it, `list` names every
  run kept. A parent that names no kind or `main`, a start Msg the machine
  does not take, or a store in `options`, does not compile. Added in
  experiment 75b, in place of experiment 72's `keep`.
- **A kept machine starts from its kept state, like Elm's `init`.** A ref's
  `start` is the only way a program hands a machine its storage. It reads the
  kept state before the machine is booted: found part way, the kind's
  `recovered` Msg goes first; found before it began, the caller's; found
  over, none. Every Listen and timer stays shut behind an Effect `Latch`
  until that Msg has settled, so a Listen tea opens again on a loaded state
  can never move the machine before `resume`, and no write goes out twice.
  Added in experiment 72.
- **One live copy per id.** Every start of one id while it runs gets the
  same copy, kept in Effect's `RcMap`: booted once, closed when the last
  start's scope closes. A start with another Msg than the one the copy began
  with fails `AlreadyStarted`, the way Temporal answers a second start of a
  running workflow id; `{conflict: "use_existing"}` shares the copy and drops
  the Msg, marked on the caller's span. `clear` on a live copy dies: its next
  save would keep it again.
- **A run its parent left unfinished fails the program.** When `main`
  returns, each kind with `recovered` is listed: a run that began, is not
  over and is still kept names itself and its parent, and the program fails.
  One kept before it began is dropped quietly. Experiment 74's stranding is
  an error, not a run waiting for a start that never comes.
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
- **A machine run is kept until its parent clears it, never by time.** An
  asked run until its asker says `forget`, or the whole run is removed
  (`storage.remove(run)`). A bare run, which nobody can ask about again, is
  cleared once its work has left the kept queue. The queue clears itself
  once its input has ended and every value is worked.
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
- **A pipe into an input that acks loses nothing to a kill.** An input
  declared `{ack: "manual"}` hands `main` deliveries, `{value, ack}`, and
  `main` acks each once it is in its own saved state (the kept queue does it
  right after its `told` is saved): the ack means saved, not done. A pipe into
  such an input keeps each value in the sender's outbox, in the sender's run
  record, before it hands it on, drops it on the ack, and hands on again at
  the next start what is still there. The sender ends only once its outbox is
  empty, or the receiver has ended. At most 5 values wait on their ack; the
  next send waits, like a write to a full Unix pipe. Into an input that does
  not ack, a value is told and gone, as before. The design is Effect
  cluster's `MessageStorage` (kept before it is delivered, a reply marks it
  done, the rest handed back at a start), kept by the sender and with no
  transaction. Ship's `pr` acks. Added in experiment 75d.
- **What flows down a pipe carries its own id, when a repeat would do harm.**
  A value can come twice: sent again from the outbox when a kill cut off the
  ack, or sent anew when a kill made the sender do its work again. Review's `passed` is
  `{pr, head}`, a type that cannot be made without its head, and ship keeps
  that run under the url of the commit, `pr/<url>/commits/<head>`, like an
  ask's id: the same head said again is answered from what ship kept, and a
  new head is new work. It is kept until a `forget` under that id. A bare url
  told by a person has no id, and ships each time. The id lives in the
  receiver, not in `pipe`: only the receiver knows what makes two values the
  same work, and a pipe's own numbers would miss a repeat the sender's
  re-run sends anew. Added in experiment 75c; kept there in 75d.
- **A run is a span.** `start` opens one span per run, `run <program>`, with
  the run id as an attribute, under whatever span is current. With none
  current, its trace is named by its run id the way tea's `runTraceId` does
  it, so a kept run killed and started again goes on in the same trace. A
  pipe is a link between the two run spans, both ways; each value told or
  sent is an event on the run's span, by name only, never the value. Spans
  are Effect's: a host decides where they go, or turns Effect's tracer off and
  every span is a no-op. Added in experiment 68.
- **A view is the host's, not the program's.** A window, a panel, a page: each
  is a client of the program, like tsh. It reads the program's state or
  outputs and tells its inputs. tea-program carries no renderer and no UI
  type. What it may carry is plain text a program declares about itself, the
  way Tuval's `title` and `status` are `state => string` lines sent only when
  they change, so every host can show the same line.
  *Changed 2026-10-22 by [the GUI note](./the-gui-is-a-local-web-page-first.md):
  a program may declare a pure `view(state)`, with a schema for the data it
  picks, and its window is a React component in the same package, on
  `<package>/window`. The program itself still holds no renderer and no
  React.*
- **A status line is declared on each kind, one per machine.** `status` is
  a `state => string`, typed by that machine's state, so the line is said
  once, where the program is read, and `--describe` can show it. tea is
  unchanged. It is required on every kind: a kind with no line does not
  compile, and is refused past the types. A program that runs many
  copies of one machine (one review per pull request) shows one line per
  copy, keyed by the id it is kept under, so a stuck copy is not hidden by a
  newer one. The run's view of a machine lists them: `copies()`, each with
  its id, its line and whether it still runs, and `lines`, sent only when one
  changes. A copy that ended keeps its row until the run ends. tsh's `jobs`
  shows them under the job. The line is also the `tea.status` tag on the
  copy's span. Added in experiment 73.
- **No `dispatch(machine, msg)` on the handle** (decided 2026-10-19). Inputs
  are the only way in, for a host and for a view alike.
- **A setting of a service is not a flag.** Who the repo treats as its own is
  the GitHub reader's setting, so the host reads it and builds the Layer.
- **A shape only checks**, it never converts. **Fit** stays exact, for when
  programs are wired together, with one widening: an input that is a union
  takes an output equal to any one of its members, as a TypeScript union
  does. Ship's `pr` takes a bare url or `{pr, head}`. Added in experiment 75c.

## Parts already decided

The note as a whole is still proposed. These parts were agreed on the day
given:

- ~~**No size limit on an input, and no "full" answer** (2026-10-15). A sender
  never waits. A host that wants a bound, like Tuval, builds its own.~~
  *Superseded 2026-10-19* by the next item.
- **Experiment 79's input limit holds, per input, and a full line is an
  error** (2026-10-19). Each input is an Effect bounded `Queue`. `tell`
  never waits; `offer` waits for room. The limit is the input's `capacity`,
  declared where the program declares the input, optional, 1000 when left
  out; a program fact, not in `fabrika.toml` and not global, checked to be a
  whole number, 1 or more, when the program is defined. A `tell` past it
  fails with the tagged error `Full`, carrying the input's name, so a full
  line nobody handles fails the caller and shows in its type. No dropping or
  sliding strategy yet. This settles the conflict the 2026-10-15 item had with
  experiment 79.
- **Outputs are events** (2026-10-17), as in the rule above.
- **Storage** (2026-10-17): renamed from "shelf" and reshaped in the same
  step, not only renamed; atomic and fenced writes; one record per run; a run
  kept until its parent clears it, never by time.
- **Ask and answer under the asker's id stay plain inputs and outputs for now**
  (2026-10-17). A helper comes once enough programs need it.
- **A host never tells inputs again when it reattaches** (2026-10-17). A
  program that keeps state finds its own unfinished runs at start. Whatever
  must outlive a restart lives in a machine.
- **`workQueue` takes only inputs that ack** (2026-10-18), by type.
- **A status line per machine copy lives in tea-program** (2026-10-18).
- **A view belongs to the host, not the program** (2026-10-18). It was decided
  as views that read state and send messages.
- **A view sends messages only through declared inputs; there is no
  `dispatch`** (2026-10-19). A window that answers a permission prompt tells
  the program's `permission` input, and `main` hands it to the machine. Handing
  a machine a Msg directly would break the program's boundary: a view could
  send a Msg only the system should send (a made-up "tool finished"), and it
  would skip the input's schema, capacity and `Full`. This is Elm's answer:
  outside code reaches a program only through ports. Tuval's chat window sends
  raw Msgs in three places (permission answer, paging, keys); each becomes a
  declared input.
- **Traces are kept on disk and made as readable as possible** (2026-10-18).
  Seeing what a run did is a main part of the developer experience.

Built since, in experiments 79, 80 and 83, and not yet confirmed: only a
program made by `defineProgram` runs; a run's end counts what each input left
unread; a kept value a now-stricter receiver refuses becomes a dead letter; a
run keeps the flags of its first start and refuses others; flags may have
defaults.

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
- A pipe into an input that does not ack has no back pressure: `tell` never
  waits, so nothing slows a fast upstream, and its downstream's line holds
  what is not yet read. Into one that acks, the sender waits at 5 values not
  acked.
- Each value down a pipe that acks costs the sender two record writes (kept,
  then acked), each a rewrite of the whole record.
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
- A pipe into an input that does not ack can lose a value: when the sender
  keeps that its work ended before the receiver has kept the value, a kill
  between the two loses it.
  [Experiment 75c](../../experiments/75c-pipe-ids.md) found it; with ship's
  `pr` acking, [experiment 75d](../../experiments/75d-pipe-ack.md) kills
  `review | ship` before each of its writes in turn and loses none.
- An outbox line for an output nobody wires at the next start stays in the
  record, unsent, until the run is removed. A `manual` reader that acks only
  after it has read more than 5 values never gets them: it must ack each one
  once saved.
- Ship keeps one run per head it was piped, until a `forget` under its id, and
  nothing says `forget` for a pipe yet. Like an answer never forgotten, it
  stays until the whole run is removed.
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
