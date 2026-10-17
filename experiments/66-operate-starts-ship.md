# 66. Operate starts ship: can programs compose and still survive a crash?

```ts
// the starter hands the run a stable id and a shelf; without them a program with machines does not type-check
const ship = yield* start(shipProgram, {mode: "write"}, {}, {id: `ship:${run}`, shelf: fileShelf(dir)});

// the operator's ship stage is one Cmd: ask under an id it picked, wait for the answer under that id
tell(ship.run, "ask", {id: cmd.intent, pr});        // the intent is in the operator's saved state before the Cmd runs
ship.run.listen("answer", (a) => a.id === cmd.intent && resume(a));

// after a crash both sides start again from what they kept:
//   the operator finds its ask in flight and asks again, under the same id
//   ship finds the machine run kept under that id: unfinished, it goes on from where it stood;
//   over, it answers again from the shelf and runs nothing
```

Two parts.

**Part 1: many writers, and only the starter stops.** Each `pipe` into an
input is one writer on it, as a write end of a Unix pipe is. The input closes
when the last writer ends, or at once when the starter closes it. `stop` moved
off the run, beside `close`, in what `start` hands the starter. Two reviews
piped into one ship both got through, whichever ended first. Committed first,
on its own.

**Part 2: the question.** `operate` today runs the ship machine inside its own
state, as a child. If ship is a program instead, started beside the operator,
does a crash lose anything? I killed the process at five points of a ship, for
three ways of filling the ship stage, and started it again from what was saved.

**Answer: programs compose and survive a crash, but only with two fixes.**
Started naively, the ship program got 4 of 10 crash cells wrong: it put an
ejected pull request back in the merge queue, or wrote `ALREADY-MERGED` on the
lane for a pull request it had just landed itself. With the two fixes, all 10
cells end right, the same as the child machine: the lane finishes as it
should, the pull request is put in the queue once, and the lane line is
written once.

The two fixes:

1. **A run is kept: a stable id and a shelf.** The starter names the run and
   says where its machines keep their state. Each machine run keeps its state
   there under a key, and an input the starter closed is marked there before
   the close returns. A program with machines cannot be started without both:
   the type refuses it, and a call from past the type checker dies before
   `main` runs.
2. **Ask and answer, under the asker's id.** The ship program has a second
   input, `ask {id, pr}`, and a second output, `answer {id, pr, outcome}`. The
   asker picks the id and asks again under it after a crash. Ship keeps each
   machine run under that id, takes an unfinished one on from where it stood,
   and answers a finished one again from the shelf without running anything.

All on fakes. No call left the process. The live sanity run was skipped.

## The setup

One test file, `src/operator-ship-crash.test.ts`, runs the real operator
machine and the real ship machine on tea's Effect engine, with fake GitHub,
fake fabrika and a scripted Jev.

**A kill** ends everything in the process at once: the operator, the ship
program, every handler in flight. Each life is one scope raced against a kill
signal; a hook at the chosen point fires the signal. What lives on is what
lives outside the process: the operator's saved state (as JSON), the shelf,
fabrika's lane and GitHub.

**GitHub, faked as it behaves.** An enqueue reads first, and a pull request
already queued or merged is answered `queued` with no write. While the process
is down, the world goes on: a pull request in the queue lands or is ejected.

**Three ways to fill the ship stage:**

- **child**: the ship machine inside the operator's state. Today's way.
- **naive**: the ship program started beside the operator, keeping nothing.
  The ship stage is one Cmd that tells `pr` and waits on `outcome` for that
  pull request.
- **kept**: the ship program with a stable id and a shelf. The Cmd asks under
  its intent and waits on `answer` under the same id.

**Five crash points:** before the enqueue write, just after it, while the pull
request sits in the queue, just after ship sent its outcome, and while the
operator's lane line is being written. Each against a queue that lands and one
that ejects.

## The crash table

"Right" means: the lane ends in the right state with the right line, the pull
request was put in the queue once, and one lane line was written.

| Crash point, queue result | Child (today) | Naive program | Kept program |
|---|---|---|---|
| before enqueue, either | right | right | right |
| after enqueue, either | right | right | right |
| in queue, landed | right | **wrong**: line `ALREADY-MERGED` | right |
| in queue, ejected | right | **wrong**: queued a second time | right |
| outcome sent, landed | no such point | **wrong**: line `ALREADY-MERGED`, facts read twice | right, facts read once |
| outcome sent, ejected | no such point | **wrong**: queued a second time | right |
| lane line in flight, either | right | right | right |

28 cells, each its own test, plus four that pin the details: the answer sent
while the operator was down is heard on the restart and the machine does not
run again; the naive restart reads the facts twice; a kept run in the queue is
taken on with no second read; and the operator's saved phase at each kill
(`handed`, `handed`, `recording`).

Why the naive one goes wrong: it keeps nothing, so a restart starts a fresh
ship machine. That machine reads the pull request from scratch. A landed one
reads as "found merged", as if someone else had merged it, and the lane gets
`ALREADY-MERGED` in place of `LANDED`. An ejected one reads as open and ready, so it goes in the
queue again. The lane still ends in the right state in the landed cells, so a
test that only checks the lane's state passes it.

The child has no "outcome sent" point: its outcome and the lane line it causes
are one fold of one state. That is its real advantage.

Two cells send the lane line twice under the same intent (child, in queue,
ejected; and every mode's lane-line-in-flight). Fabrika keeps the first. One
line is written, which the tests check.

## The shape of the fix

The starter must say how the run is kept. A program with machines takes it as
a required argument; one with none may leave it out:

```ts
export interface Kept { readonly id: string; readonly shelf: Shelf }
export type KeepingOf<Ms> = keyof Ms extends never ? {readonly id?: string} | Kept : Kept;

start(program, flags, listeners, ...keeping: keyof Ms extends never ? [KeepingOf<Ms>?] : [KeepingOf<Ms>])
```

A run that keeps nothing past the process says so with `memoryShelf()`. It is
never started that way by leaving something out. Both command-line launchers
now say it, with a comment.

`main` gets `keep`: `keep.store(machine, key)` is a tea `Store` for one
machine run, and `keep.kept(machine)` lists what an earlier life left. Ship's
`main`, in write mode:

```ts
for (const {key, state} of yield* keep.kept("ship"))            // first, what the last life left unfinished
  if (state.phase !== "over") yield* shipped(key, prOf(state));
yield* told.pipe(Stream.runForEach(({id, pr}) =>                  // then each ask, in order
  over(id) ? send("answer", fromShelf(id)) : shipped(id, pr)));   // over: answer again, run nothing
```

The operator's side is one new turn phase, `handed`, which holds the ask Cmd.
Its intent is made from the run, the pass, the task and `"ship"`, so it is the
same in every life. A restart finds the turn in `handed` and sends the same
ask again. The handler listens on `answer` before it tells `ask`, so the
answer cannot slip past, and it fails `ended` if the ship run ends first.

The shelf is `memoryShelf()` for tests and `fileShelf(dir)` for `operate`: one
file per machine run under `<dir>/<run>/<machine>/<key>.json` through tea's
`fileStore`, and the closed marks in `<dir>/<run>/closed.json`, written
synchronously.

`@demlik/tea` did not change. `SHIP=program` is a new setting of `operate`,
beside `agent` and `machine`. It has never run live.

## The canon

- **The end-to-end argument.** Only the two ends can make a request
  reliable: the asker retries, the answerer drops repeats by request id.
  At-least-once delivery plus idempotent handling gives exactly-once in
  effect. That is fix 2.
- **Idempotency keys, as in Stripe's API.** The client picks the key, so a
  retry after a crash names the same request. The operator's intent is that
  key.
- **Elm's Cmd and its answer Msg.** Ports are one-way, so a request that wants
  an answer gets it back as a Msg. Here `ask` and `answer` are two one-way
  ports joined by an id.
- **A Unix daemon's spool directory.** The daemon is started with where its
  queue lives and finds unfinished jobs there at boot, as `lpd` or a mail
  queue does. That is fix 1.
- **A Unix pipe's last writer.** EOF comes when every write end is closed,
  not the first. That is part 1.

The mistake is made impossible where it can be (poka-yoke): a program with
machines cannot be started without an id and a shelf. Where it cannot, it is
a declared failure: an ask the program will not take fails `refused`, and a
ship run that ends before it answers fails `ended`. The operator stops the
turn on either, with the reason.

## Should a parent compose a program or embed the machine?

**Recommendation: keep the child machine as `operate`'s default for now, and
use the kept program where a ship is fed by more than one parent.**

- **Why:** both are right in every cell. The child is simpler: one state, one
  store, and no gap between "ship said it" and "the lane heard it". The
  program pays for a second store, an id discipline on both sides, and kept
  records. What it buys is one ship run that many writers feed (review,
  operate, a person), one pull request at a time.
- **Cost of the program:** the shelf grows without end today, since finished
  runs are never removed. And ship goes one pull request at a time, so a lane
  whose pull request sits in the merge queue holds up every other lane's ship.
  The child runs side by side.
- **Confidence:** about 70%. The table settles "can it survive a crash" on
  fakes. It does not settle which is better on a busy board; one live run of
  `SHIP=program` and a look at queue waits would.

## What fought me

- **A type error that still runs.** The tests that prove the type refuses a
  start without a shelf also ran that start, which then died. Calls kept only
  for the type checker now sit in a function that is never called.
- **Lint bans.** `Effect.promise` and a bare `throw` inside `Effect.gen` are
  both banned here. The shelf's reads became `Effect.tryPromise` with a
  declared `shelf_unreadable` error, and a missing shelf is an `Effect.die`
  before anything starts.
- **A kill that is really a kill.** Killing only the operator would leave the
  ship program running in the same process, and it would finish the job and
  hide every naive failure. The kill has to end the whole scope at once, and
  the world has to move while the process is down, or "in queue" is not a
  real crash point.
- **A wrong answer that looks right.** Naive "in queue, landed" ends the lane
  in `shipped`. Only the line's word shows it is wrong.
- **The lifeline.** Ship reads `pr` and `ask` as one stream that ends when
  `pr` closes. So an ask still in the line when `pr` closes goes unanswered,
  and the asker hears `ended`.

## Where this leaves tea-program

`docs/direction/tea-program.md` now proposes the shelf, `keep`, the keeping
argument on `start`, and ask and answer as the way one program waits on
another.

## What this cannot tell us

- **Nothing here ran live.** GitHub and fabrika are fakes. The fake enqueue
  reads first and writes only for an open pull request not in the queue, as
  `src/code-host-github-writes.ts` does. If GitHub's own answer lagged behind
  a write it had just taken, the "after enqueue" cells could change.
- **One kill per test, one pull request per lane.** Two kills in a row, a
  kill during a shelf write, or two lanes shipping at once were not tried.
- **What is not kept.** Values told on an input and not yet read are lost in
  a crash; the asker asking again covers it. A pipe's writer ending is not
  marked on the shelf; only the starter's close is.
- **Nothing stops a `main` from running a machine without `keep.store`.** The
  type requires a shelf at start, not that `main` uses it.
- **Finished runs are never removed from the shelf.** How long to keep an
  answer is a choice not made here.
- **Whether serial shipping hurts.** One ship run for every lane means one
  merge queue wait at a time. On a quiet board that is nothing; on a busy one
  it is not known.
