# 75b. Machine refs: one declaration per kind, a ref per id

The build of [experiment 75](./75-machine-refs-design.md)'s proposal. Scripted
runs only; no live run, no agent, $0.

```ts
// Before (experiments 72 and 74): a step per machine beside main, and keep.run inside it.
left: {build: {by: "queue"}},
status: {build: buildLine},
main: ({keep}) => keep.run("build", {id, until: "forgotten"}, options,
  (kept) => (kept === null ? start : resume), drawing),

// After: each kind is declared once, and main reaches a run by id.
machines: {
  queue: queueKind,
  build: kind({
    machine: build,
    parent: "main",
    options: ({flags, send, machines}) => ({ctx, interpret, subscribe, terminal}),
    recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
    drawing: ({id, kept, start}) => buildDrawing(...),
    status: buildLine,
  }),
},
main: ({inputs, machines}) =>
  workQueue(machines.queue, inputs.ticket,
    (ticket) => machines.build.get(idOf(ticket)).start({type: "start", ask}).pipe(...),
    (ticket) => machines.build.get(idOf(ticket)).clear),
```

## What was asked

- Step 0: can Effect 4's `Entity` (its cluster module) back machine refs?
- Build the per-kind declaration on `defineProgram`: machine, options,
  recovered, drawing, status, parent. In `main`: `machines.<kind>.get(id)`,
  `.start(msg)`, `.read`, `.clear`, and `machines.<kind>.list`.
- Drop `keep`, `first`, `until`, the `left` steps, and the rule that one id
  started twice at once dies. A second start of a live id with another Msg
  fails `AlreadyStarted` by default, as Temporal does; the same Msg shares
  the live copy.
- Move ship and review onto the kept queue, keeping ship's forget order.
- Name nothing new without prior art.
- Tests 1 to 9, the user's job first, and the different-Msg failure.

## Step 0: no Effect `Entity`; borrow its names, use `RcMap`

`Entity` was read in our own `node_modules` (`effect` 4.0.0, its
`unstable/cluster` module) and bundled to measure it.

| What a ref needs here | Effect `Entity` |
|---|---|
| Keep a machine's state, read back at the next start | Keeps messages, not state. A machine's state would be rebuilt by replaying them. |
| Any `KeyValueStore`, a folder or memory | Its message storage is SQL (`SqlMessageStorage`) or memory. Nothing over `KeyValueStore`. |
| The parent says when a run goes on (the queue, the loop) | Sends unacknowledged messages again on its own. That fights parent-driven resume, ship's one-at-a-time rule, and outputs a waiter sends. |
| One live copy per id, a start Msg checked | No start-once rule. A second message is just another message. |
| A small browser bundle | `Entity` and its test runner: 221 KB. With the single-machine runner: 270 KB, and it needs a `SqlClient`. `RcMap` + `KeyValueStore` + Effect: 38 KB. |
| Stable | Marked unstable. |

So the refs use Effect's `RcMap`: one live copy per key, booted by the first
`get`, shared by every `get` while any caller's scope holds it, and closed
when the last one closes. Its lookup runs with the first caller's context
(its services and its span) and the entry's own scope, so the key carries
nothing but the kind and id. The names come from the systems 75 read:

| Name | From |
|---|---|
| `kind` | Akka's `EntityTypeKey`, Effect's `Entity.make(type)` |
| `get(id)` | Durable Objects' `get`, Orleans' `GetGrain` |
| `start(msg)` | Temporal's `start` |
| `AlreadyStarted`, `use_existing` | Temporal's `WorkflowExecutionAlreadyStartedError` and `USE_EXISTING` |
| `read` | Temporal's `describe` |
| `clear` | Restate's `clearAll`, Orleans' `ClearStateAsync` |
| `list` | Temporal's `list` |
| `parent` | Temporal's parent workflow |
| `recovered` | Akka Persistence's `RecoveryCompleted` |

## What was built

- **`src/program/refs.ts`** (new). `refsOf` builds the ref table per kind and
  the check that runs when `main` returns. `start(msg?, {conflict?})`:
  - looks up the live copy in `RcMap` by kind and id;
  - no Msg, or the Msg the copy started with (`Equal.equals`): shares it;
  - another Msg: fails `AlreadyStarted` (`fail`, the default), or shares it
    and marks `start msg dropped: <id>` on the caller's span
    (`use_existing`);
  - a new copy reads the kept state first. Found part way, the kind's
    `recovered` Msg goes first; found before it began, the caller's; found
    over, none. Listens stay shut until that Msg settles (experiment 72's
    `Latch`, unchanged).
- **`clear` on a live copy dies.** Its next save would keep it again (see
  finding 1). A parent clears a run once every start of it has closed.
- **The parent check.** When `main` returns, each kind with `recovered` is
  listed. A run kept before it began is dropped quietly. One that began, is
  not over and is still kept fails the program:
  `job ended with job run j unfinished: its parent main never took it to its end`.
  That is experiment 74's stranding, made loud.
- **`defineProgram`** takes `machines: {<kind>: kind({...})}`. `status` moved
  onto each kind (73's rule holds: a kind with no line does not compile, and
  is refused past the types). A `parent` that names neither `main` nor
  another kind does not compile and throws. `main` gets `machines`, typed per
  kind; its start Msg is the machine's own Msg type.
- **Queue** (`src/stages/queue.ts`): a `clearing` list, so an `after` cut off
  by a kill is run at the next start; a `dropped` Msg and `drop()`, so a
  forget takes an answered ask off the queue before its run is cleared; the
  queue clears itself once its input has ended and every value is worked.
- **Stages.** build, review, ship and operate declare kinds. Review and ship
  now go through the kept queue: review's id is `review/<url>`, ship's a bare
  pull request's `pr/<url>` or the asker's id. Ship's forget is
  `drop` then `clear` then `forgot`, beside the queue, not behind it. The
  random ids review and ship made per run are gone.
- **tsh**: its jobs table and `tally` are kinds; `Machines` became `Kinds`.

No new Node code. The refs are Effect's `RcMap`, the storage is Effect's
`KeyValueStore`, and the kill tests' disk is a `KeyValueStore` that stops
taking writes. The only Node in the tests is what was there: spawning
`bin/tsh` and reading its log file.

## The tests

| # | The job | Where | Result |
|---|---|---|---|
| 1 | tsh killed with kill -9 mid build, twice, three tickets: each built once | `src/tsh/kill.test.ts`, unchanged | green |
| 2 | review piped into ship, three pull requests, killed once the first review had finished and again with the second in the merge queue | `src/stages/review/program.test.ts` | each reviewed once, queued once, said shipped once; both runs keep nothing after |
| 3 | operate, three tickets, killed mid review of the first and again mid ship of the second | `src/stages/operate/program.test.ts` | each push, open, posted verdict and enqueue once; each loop `done` once; storage empty after |
| 4 | a parent that leaves a begun run unfinished | `src/program/kept.test.ts` | fails, naming the run and its parent |
| 5 | two starts of one id at once | `src/program/kept.test.ts` | one copy, the work starts once, the write goes once |
| 6 | experiment 72's race: bare, through a ref, three restarts | `src/program/kept.test.ts` | green; bare still writes twice, a ref once |
| 7 | what does not compile | `src/program/kept.test.ts`, `src/program/status.test.ts` | a store in options, a start Msg the machine does not take, a kind as its own parent, an unknown parent, a kind with no status line |
| 8 | status lines per copy after kill and attach | `src/tsh/status-attach.test.ts` (73's, now on kinds) | green: the same rows come back from the kept state |
| 9 | lines removed | below | |
| + | another start Msg on a live copy | `src/program/kept.test.ts` | `AlreadyStarted`; the same Msg, no Msg, and `use_existing` share |

In test 2 the first life is killed the instant the first verdict is out,
before review's queue hears the work ended. The next life, told nothing,
finds that review kept over: it says the verdict again from what was kept,
with no reviewer run, and ship gets the pull request for the first time. In
test 3 the reviewer of ticket 1 was cut off by the kill and ran again in the
next life; that is the only thing that ran twice, and it writes nothing.

Tests 2 and 3 kill in process: the disk stops taking writes and the fakes
stop counting at the kill, then the scope closes. Test 1 is the one real
SIGKILL.

Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test` green; the full suite ran
green three times in a row (1485 tests).

## Lines (test 9)

Against `main` at the start of the build:

| | Added | Removed |
|---|---|---|
| Code (not tests) | 981 | 732 |
| Tests | 781 | 250 |

The code grew by 249 lines. The program layer (`program.ts`, `kept.ts`,
`storage.ts`) went from 1861 lines to 1768, and `refs.ts` is 234 new ones.
The queue grew by 56 (`clearing`, `drop`, its own clear) and operate by 30
(five kinds declared). Gone: `keep` with `run`, `kept`, `find` and `forget`;
the `Keep` and `Key` types; `until`; `first` as an argument; the `left` steps
and `Showing`/`StatusOf`; the "twice at once" death; the random run ids in
review and ship. New: `AlreadyStarted`, the conflict policy, the parent
check, the clear-while-live refusal.

So the refs did not make the code smaller. They made it say more in one
place: what a kind is, who finishes it, and what goes first after a crash.

## Findings

1. **A clear under a live copy does not hold.** The queue cleared itself while
   its copy was still open; the copy's next save put it back in the index.
   Test 2 found it (both runs kept `queue` after ending). Fixed twice over:
   the queue clears after its scope closes, and `clear` on a live copy now
   dies, so the mistake cannot pass quietly.
2. **An answered ask a kill left on ship's queue could ship again.** A forget
   cleared its run while the queue re-worked it, and the re-work found
   nothing kept and started fresh. Fixed: forget drops it from the queue
   first, and waits for the one being worked.
3. **73's status view threw on close.** Its finalizer ran
   `Effect.runSync` on a `SubscriptionRef` update; with copies now closing
   together, one closed while another held the view and the run threw
   `AsyncFiberError`, unhandled. Test 3 found it. Fixed: the finalizer is an
   Effect. The per-change callback still uses `runSync`.
4. **The review to ship pipe is at least once.** A review killed after it
   finished says `passed` again at the next start. Ship drops the repeat only
   while the pull request is still on its queue. Once ship has finished it
   and cleared the bare run, a repeat is new work: the gate reads GitHub
   again, and only the pull request being merged stops a second enqueue.
5. **A start Msg with something random in it defeats the default.** Build's
   start Msg carries a fresh session, so every start differs and the default
   `fail` would fire at every restart. Build uses `use_existing`.
6. **The parent check is coarser than the design.** It runs once, when
   `main` returns, over every kind with `recovered`. A kind whose parent is
   `loop` is checked at `main`'s end, not at the loop's.
7. **Behavior that changed**, each in a test:
   - an ask again under an answered id says `outcome` as well as `answer`;
   - a pull request told twice while it waits on review's or ship's queue is
     one piece of work;
   - the queue clears itself once its input ended, so a run whose input is
     open keeps its queue: experiment 68a's crash table now counts ship runs
     left, not every machine, and its two record tears are aimed by what they
     do to the ship run's index line (the queue's line comes first now).

## Recommendations

1. **Keep refs as the program surface, in place of `keep`.** Why: one
   declaration per kind says the machine, its options, who finishes it, what
   goes first after a crash and its line; a start Msg is typed; no store can
   be handed in; a stranded run fails by name. Cost: 249 more lines, and
   experiment 76 renames `keep.run` to a kind and a ref. Confidence 75%. The
   doubt: the parent check only runs at `main`'s end (finding 6); a kind owned
   by a long-lived child is only checked when the whole program ends. A test
   with a child kind stranded mid run would lift it.
2. **Keep `clear` on a live copy as a death.** Why: the bug it guards against
   passes every test that does not read storage after the end. Cost: a parent
   must close its starts before it clears. Confidence 85%.
3. **Make review to ship idempotent by id, not by the gate.** Pipe review's
   pass into ship's `ask` under `review/<url>/<head>`, or keep bare runs until
   ship's input closes. Why: today a repeat after ship's clear is stopped only
   by GitHub saying merged (finding 4). Cost: ask ids on the pipe, or more
   kept runs. Confidence 70%: the doubt is whether a repeat can arrive after
   ship cleared in practice; a kill test that times it there would say.
4. **Take the random session out of build's start Msg.** Why: then the
   default `fail` holds for build too, and a real second start with other
   settings is caught (finding 5). Cost: the session moves into the kept
   state or the kind's `recovered`. Confidence 70%: the doubt is whether a
   resumed builder needs the session before its first Msg.
5. **Turn 73's per-change `runSync` into a queued update.** Why: the same
   contention that broke the finalizer can hit it. Cost: small. Confidence
   80%.

## Holes

- A `forget` that lands just as ship's queue clears itself would hold the
  queue open and hit the clear-while-live death. Narrow; not tested.
- `RcMap` runs a copy with the first starter's services. A second starter
  with other services gets the first one's.
- Tests 2 and 3 kill in process. Only test 1 is a real kill -9.
- `AlreadyStarted` compares Msgs structurally. A Msg holding something with
  no structural equality (a class instance, a Date) counts as different.
- Field note ids here follow the last merged ones; a parallel experiment
  writing the same day may need them renumbered.

## Not done

- No live run: the scripted runs prove the claims, and a live one would add
  only the agents, which these changes do not touch.
- Recommendations 3, 4 and 5.
- A per-parent check (finding 6).
