# 74. A program finds its own unfinished kept runs, every start

```sh
pnpm vitest run src/tsh/kill.test.ts src/program/kept.test.ts \
  src/stages/build/program.test.ts src/stages/operate/program.test.ts
# The live check, on a sandbox ticket. A build job with its input closed, killed, then attached bare:
TSH_HOME=<home> TSH_WORK=<folder> TSH_OWN=<your login> bin/tsh -c \
  'build --model opus --effort medium --budget 3 ticket=<sandbox ticket> & close %1 ticket; attach %1'
kill -9 <the tsh processes>
TSH_HOME=<home> TSH_WORK=<folder> TSH_OWN=<your login> bin/tsh -c 'jobs; attach %1'
```

## What broke

Experiment 71, finding 5. `build` got work only from its input `ticket`.
Each ticket ran a kept build machine under `build/<ticket>/1`. When tsh was
killed mid build and the job was attached again, the input was still closed
(`close %1 ticket` is kept in the run's record). Nobody could tell the
ticket again. `main` read an input that had already ended, and returned. The
job ended, tsh dropped it without a word, and the half-done build stayed in
storage with no job to reach it.

The direction was set before this experiment: fix it in the program, not in
tsh. A program that keeps state finds its own unfinished runs when it
starts, because the machine already holds the ticket. Whatever must outlive
a restart lives in a machine. tsh telling the first line's values again on
reattach was turned down.

## Canon checked

Elm's answer: `init` gets the state back before any `update`. What was
saved comes back first, then new messages. The work waiting is part of the
model. The input is only where new work comes from.

Two places were short of that:

- **The machine run itself was in storage**, but no code was made to look
  for it. ship, review and operate each had a hand-written `leftOver` loop
  at the top of `main`. build had none. Nothing made a program write one.
- **The tickets told and not yet started were nowhere.** They sat in the
  input's in-memory queue. A kill lost them, closed input or not.

## Storage: how kept runs are listed

Effect's `KeyValueStore` cannot list keys. Storage already works around
that: each run has one record that holds an index of its machine runs,
`machines: [{machine, id, until}]`. It is written atomically (two slots and a
checksum) and fenced (a stale handle fails). `handle.left(machine)` reads
that index and loads each run's state. So no new index was needed. This
experiment reads `handle.left` and adds nothing to storage.

## What was built

### 1. A required `left` step per machine (`src/program/program.ts`)

`defineProgram` now takes `left`: one step for each machine the program
runs. A step is one of:

```ts
left: {
  // a function: run for each kept run of this machine, before main
  ship: (run, {flags, send, keep}) => run.state.phase === "over" ? Effect.void : shipped(...),
  // or who runs it again under the same id
  queue: {by: "main"},
  build: {by: "loop"},
}
```

tea-program calls each function step for every kept run of its machine, one
at a time, in machine order, before `main` begins. Values told meanwhile
wait on their input. That is Elm's `init` before `update`.

How forgetting is made impossible:

- **The type.** A program with machines and no `left`, or with one machine
  left out, does not compile. A `by` must name `"main"` or another machine
  of the same program.
- **At definition.** `defineProgram` throws on a missing step or a `by` that
  names no machine. So the check holds past the types too.

Each step takes a `Kit` (flags, send, watch, keep). That is `main`'s `Io`
without the inputs: a left step cannot read new work.

Why a step, not tea-program carrying every kept run on by itself. To run a
machine again you need its handlers, its Subs, its first Msg, and what to
send when it ends. Only the program knows those. A step is the smallest
thing that keeps the decision in the program and still cannot be skipped.

### 2. `keep.run` guards (`src/program/kept.ts`, `src/program/program.ts`)

- **A run kept already over is finished.** It is booted and shown, and
  `first` is never asked, so no Msg goes to it. tea's `done()` answers at
  once with the kept state.
- **One run per machine and id at a time.** A second `keep.run` of the same
  machine under the same id, while the first is going, dies with `<program>
  ran <machine> under <id> twice at once`. A left step and `main` cannot
  both drive one build.

### 3. A kept queue (`src/stages/queue.ts`)

A tiny tea machine, `queue`, holds the values a stage was told and has not
finished. `workQueue(keep, input, work, after)`:

- Each value read from the input is put on the queue, and kept, before the
  next one is read.
- One worker takes the head, runs `work`, takes it off the queue, then runs
  `after` (the tidy-up).
- It ends once the input has ended and the queue is empty.
- A value told again while it is on the queue is the same work: it is not
  queued twice. Told again after its work ended, it is new work.

A start after a kill finds the queue in storage. The value being worked is
still at the head, so it goes first, from where its machine stood. The rest
follow, input closed or not.

### 4. The stages

| Program | Machines | `left` |
|---|---|---|
| build | queue, build | `queue: {by: "main"}`. `build`: a round on the queue is left to the queue's work; a round off the queue only lost its drop, so it is forgotten; a round the queue never held (kept before this change) is taken to its end. |
| operate | queue, loop, build, review, ship | `queue: {by: "main"}`. `loop`: the same rule as build's, with operate's tidy-up. `build`, `review`, `ship`: `{by: "loop"}`, since the loop's Act runs each again under its intent. |
| ship | ship | the old `leftOver` loop, moved here as is: an unfinished run with a pull request goes to its end, a bare run that never started is dropped. Read mode keeps nothing. |
| review | review | an unfinished review goes on from where it stood; one that never started is dropped. |
| tsh's own `jobs`, the small `tally` | one each | `{by: "main"}` |

### 5. tsh says why a job ended (`src/tsh/execute.ts`)

When a job ends, background or attached in the foreground, tsh prints its
end and one line per stage:

```
[1] ended  build --model opus --effort medium --budget 3 ticket=https://github.com/kamp-us/tea-fabrika-sandbox/issues/13
[1] build ended: its input ticket was closed, and it finished all it held
```

The closed inputs are read from the run's record. A stage that failed or
was stopped says so on the same line shape: `[1] build failed: ...`,
`[1] build stopped`. A foreground attach used to print nothing on a clean
end. That was the silent drop.

### 6. `build-scripted` (`src/tsh/scripted-build.ts`)

The build program with a scripted builder (1.5s, then `built`), every ticket
ready, and writes that go nowhere. Each write and each builder start is
noted in `<folder>/log`. It is listed only when tsh starts with
`TSH_SCRIPTED=<folder>`. It is what the kill test drives.

## Proofs

The user's job, end to end (`src/tsh/kill.test.ts`). The real `bin/tsh`, its
own `TSH_HOME`, file storage, `build-scripted`:

1. tsh A: `build-scripted ... ticket=1 ticket=2 ticket=3 & close %1 ticket; attach %1`.
   `kill -9` once ticket 2's builder starts.
2. tsh B: `attach %1`. `kill -9` once ticket 3's builder starts.
3. tsh C: `attach %1`. It runs to the end and exits 0.

What the test reads:

- Each ticket was copied, pushed and opened exactly once across the three
  lives.
- Tickets 2 and 3 started their builder twice each, the second time on the
  same conversation id.
- A printed `built #1001`, B `built #1002`, C `built #1003`.
- C printed `[1] build-scripted ended: its input ticket was closed, and it finished all it held`.
- A fourth tsh's `jobs` prints nothing.

The same three tests were run against the old build (`main` reading the
input, no queue). All three failed. In the tsh test, tsh B never started
ticket 2 again: the log stopped at `start 2`.

Mechanism rows:

| Test | Shows |
|---|---|
| `kept.test.ts` · a kept run left working | its `left` step runs before `main`, and takes it to its end; one write |
| `kept.test.ts` · a run kept already over | `first` is never asked, nothing starts, nothing writes; `done()` answers the kept state |
| `kept.test.ts` · one run per id | a second `keep.run` of one id at once fails the run with `twice at once` |
| `kept.test.ts` · cannot be forgotten | no `left` step, or a `by` naming no machine: does not compile (`@ts-expect-error`), and throws |
| `build/program.test.ts` · three tickets, cut twice | starts that nobody tells carry every ticket to its end, one copy, push and open each |
| `build/program.test.ts` · told again | a ticket told again while waiting or building is built once |
| `operate/program.test.ts` · three tickets, cut mid review | the next start, told nothing, ends all three loops; the first is not built again |

Every ship, review, operate and tsh test from before passes unchanged.

## Live

On the sandbox only, opus at medium effort, a budget of $3 a run. A watch
read `ps` every second and counted the guards on the work folder and the
builders under them. tsh's own processes were killed with `kill -9`. The
guard was left to stop the builder by itself (experiment 71).

| Ticket | Copy of | What happened |
|---|---|---|
| sandbox 10 | demlik 563 (an ADR text fix) | Not killed: the builder finished in about 30s, before the kill was due. Pull 11, one commit. tsh printed the new end line. |
| sandbox 12 | demlik 642 (a type error) | Killed 15s into the builder, attached bare, killed again 20s in, attached bare. The third start found the build in `building` with `run 2` and ended it `stuck`: the build machine starts a builder at most twice a round (`MAX_RUNS = 2`). It said so and ended, not stranded. |
| sandbox 13 | demlik 621 (a code-graph bug) | Killed 20s into the builder, attached bare (`jobs; attach %1`). The build carried on to the end on the same conversation: `built #14 done`, `runs 2`, pull 14, one commit. tsh printed both end lines. |

The watch never saw two guards: 0 of 301 ticks on tickets 12 and 13 (ticket
10's ticks were not kept). It saw `builders=2` on 4
ticks, each with one guard. That is the guard's own short `ps` child, which
it starts every 2s (experiment 71), not a second builder. After each kill the
guard and builder were gone within 1s.

Cost, from the builders' own session totals: $0.18 (ticket 10), $0.24
(ticket 12, two lives), $0.74 (ticket 13, two lives). About $1.16 in all,
for builders only: no reviewer ran.
Pulls 11 and 14 were closed unmerged with their branches deleted. The three
tickets were closed. The local home and work folder were removed.

## Findings

1. **ship, review and operate each carried their own left-over loop, and
   build forgot one.** That is the whole bug. Nothing asked a program to
   write it. Now the compiler asks.
2. **Tickets told but not yet started were lost on any kill**, closed
   input or not. They lived only in the input's memory. build and operate
   now keep them on a queue. ship and review still do not (see Holes).
3. **A second kill in one round ends the build `stuck` with the reason
   `over_budget`.** The cause is `MAX_RUNS = 2` ("cut off 2 times"), not
   money. Live, ticket 12 spent $0.24 of $3. The reason's name misleads.
4. **`{by}` is a claim, not a check.** It must name a real machine, but
   nothing checks that the named one really starts the run again. While
   testing the old build, `build: {by: "main"}` over a `main` that never
   looked compiled fine and stranded the run.
5. **A program's failure type is inferred from `main`.** A left step that
   can fail, in a program whose `main` cannot, does not compile until the
   step handles its failure (`Effect.orDie` in the test). It is safe, but the
   error message points at the step's whole type.
6. **`@demlik/tea` did not change.** `done()` already answers at once for a
   run booted straight into a terminal state.

## Recs

1. **Keep `left` required on `defineProgram`** (85%). It is the only thing
   here that makes forgetting fail to compile. Cost: every program with
   machines writes one more field, and a small one writes `{by: "main"}`.
   Owner: tea-program.
2. **Put ship and review on the kept queue too** (65%). The reason is
   finding 2: a pull request told and not yet started is lost on a kill.
   Cost: ship's `ask` answers and `forget` must keep their order with the
   queue. That is a careful change, not a quick one. The doubt: the merge
   queue may make an unread `pr` cheap to tell again, so it may not be
   worth it. A kill test on ship with three pull requests would settle it.
   Owner: tea-fabrika's stages.
3. **Name the stuck reason for a twice-cut builder `cut_off`, not
   `over_budget`** (80%). The reason is finding 3: a reader of `built`
   would think money ran out. Cost: one more outcome name in build and in
   operate's stop rule. Owner: tea-fabrika's build stage.
4. **Check `{by}` at the end of a start** (55%). A kept, unfinished run of
   a `by` machine that nobody ran during the start would end the run with a
   failure that names it. The reason is finding 4. The doubt: a run can
   legally wait a long time (a queue behind a slow ticket), so "nobody ran
   it" needs a precise moment, and I did not find one I trust. Writing the
   check against operate's tests would show whether one exists. Owner: tea-program.

## Holes

| Hole | Owner |
|---|---|
| ship and review still read work straight from their inputs. A value told and not yet started is lost on a kill. | tea-fabrika's stages |
| A tell answers `queued` once the input holds the value, a few milliseconds before the queue keeps it. A kill in that window loses it. | tea-program |
| After a restart, ship's `forget`s wait until its left steps finish. Before, the same wait happened inside `main`. | tea-fabrika's ship stage |
| A ticket told again after its build ended is built again. That is on purpose ("new work"), but a pipe that repeats values would build twice. | tsh / the pipe's writer |
| `{by}` is not checked at run time (finding 4). | tea-program |
| The build's left step decides "on the queue" by the ticket url alone. Two rounds of one ticket in one program would share it. build runs one round, so not today. | tea-fabrika's build stage |

## Not done

- A live kill on operate. The operate tests cover the case. A live run
  costs a review and a merge-queue wait on top of the build.
- ship and review on the queue (rec 2).

## Where Node is used

- `src/tsh/scripted-build.ts`: the log is written with Effect's
  `FileSystem`, given by `@effect/platform-node`'s `NodeFileSystem` layer at
  that one spot.
- `src/tsh/kill.test.ts`: `node:child_process` `spawn` (it must send
  `SIGKILL` to a real tsh) and `node:fs` to read the log, as
  `src/tsh/pty.test.ts` does. Test harness only.
- Everything else in this change is Effect: `Queue`, `Stream`, `Effect.all`,
  the storage handle.
