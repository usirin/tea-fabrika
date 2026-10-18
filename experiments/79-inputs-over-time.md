# 79. Inputs over time: a kept value meets a stricter shape, and a line nobody reads

Scripted runs only: no agent, no GitHub, $0.

```ts
// A value kept in an outbox, sent again at the next start into an input whose
// shape got stricter in between:
//   before: the pipe answered bad_shape, the sender failed before main, and
//           failed the same way at every start after
//   after:  it moves to the run's dead letters with why; the rest go on
record.deadLetters  // [{output: "out", n: 0, value: "Abc", why: "...[a-z]..."}]

// A run started again under its id with other flags:
//   before: main ran with the new flags; the record kept the first ones
//   after:  refused by that flag's name, before the run is opened
start(moder, {mode: "write"}, {}, {id: "moder:1", storage})
// {kind: "bad_shape", name: "mode", why: 'run moder:1 was first started with mode "read", ...'}

// A host tells a run that never reads:
//   before: every tell queued; 1,000,000 tells held 309 MB
//   after:  CAPACITY (1000) queued, the rest answer full at once; 0.4 MB
tell(run, "line", value)    // never waits: "queued" | "full" | ...
offer(run, "line", value)   // waits for room, as a pipe and call do
```

## What was asked

Two rows of the #657 harvest (the issue was only a source of cases; this
repo's decisions stand):

- **Row 6.** #657 says replay never re-checks a shape, so a stricter shape
  never breaks an old log. Here, a value left unacked in a pipe's outbox is
  sent again at the next start and checked again. If the receiver's input got
  stricter in between, what happens? And kept flags: do they come back
  unchecked?
- **Row 11.** Host tells and pipes into auto-ack inputs sit on a line with no
  bound. Does a limit belong here, and what does the sender see when the line
  is full?

## What we found first

Reproduced on main before any change (`src/program/inputs-over-time.test.ts`,
first commit of the branch; `experiments/79-flood.ts`).

1. **A resent value that no longer fits blocks the sender for good.** `relay |
   holder`: holder never acks, so `"Abc"` stays in relay's outbox. At the
   next start, holder's input takes only small letters. The resend answers
   `bad_shape`, relay fails before `main` runs, and it fails the same way at
   the start after that, and every start after. The value never leaves the
   outbox. Only `forget` gets rid of it.
2. **Kept flags never come back at all, and that hides a worse hole.** The
   record keeps the flags of the first start. A later start runs `main` with
   whatever flags it is given now. tsh happens to pass the same ones, from its
   own job record, and checks them again, so a stricter flag shape refuses the
   start by name today. But a host that passes other flags gets a run whose
   machines go on under flags they did not start with, while the record says
   the first ones. The test: started with `mode: "read"`, started again under
   the same id with `mode: "write"`, `main` saw `write` and the record kept
   `read`. A flag whose own description says "for the whole run" could change
   mid-run.
3. **A host can fill memory without limit.** A run whose `main` never reads:
   100,000 tells all answered `queued` and held 30.7 MB; 1,000,000 held
   309 MB, about 310 bytes each.

## What other systems do

**Elm first.** An incoming port refuses a value that does not decode at the
boundary: the JavaScript `send` throws ("Trying to send an unexpected type of
value through port"). Flags that do not decode stop the program at init
("Problem with the flags given to your Elm program on initialization"). Elm's
advice is to take `Json.Value` and decode inside, so a failure becomes a Msg.
Elm keeps nothing between runs, so it has no "the shape changed while a value
waited" case. Our first send already does what Elm does: a value that does not
fit fails the sender, at the boundary, by name. The over-time case needs prior
art from systems that keep messages.

| System | A kept message that no longer decodes | Input fixed per run | A full mailbox or queue |
|---|---|---|---|
| Effect cluster `MessageStorage` (our outbox's model, 75d) | `decodeMessages` skips it and saves a failed reply (a defect) for it, so it is never delivered again; the others are delivered | n/a | n/a |
| AMQP / RabbitMQ | rejected, or past the delivery limit, goes to the dead-letter exchange | n/a | publisher flow control blocks the publisher |
| Akka | undeliverable goes to `DeadLetters`; persistence event adapters convert old events on recovery | n/a | bounded mailbox, `mailbox-capacity` 1000 by default; a `tell` to a full one goes to dead letters and never blocks (push timeout 0) |
| Kafka Schema Registry | an incompatible new schema is refused when registered, before anyone reads with it | n/a | the producer blocks up to `max.block.ms` |
| Temporal | n/a | a workflow's input is part of its history; starting a running id again fails `WorkflowExecutionAlreadyStarted` | n/a |
| Effect `Queue` | n/a | n/a | `bounded`: `offer` waits for room, `offerUnsafe` answers false; `dropping` / `sliding` drop |
| Unix | n/a | a process keeps its argv | a writer on a full pipe blocks |
| Erlang | n/a | n/a | no bound at all |

## The decisions

**1. A kept value the receiver no longer takes becomes a dead letter**
(`src/program/outbox.ts`, `src/program/storage.ts`).

At a later start, each outbox line is checked against the receiver's input
before it is sent again. A line that no longer fits leaves the outbox and
joins `deadLetters` on the sender's run record, `{output, n, value, why}`, in
one write. The others are sent again in order, and the sender runs on.

- **Why:** the value was right when it was sent; the receiver changed. Failing
  the sender blames the wrong side and leaves it stuck at every start. Sending
  it anyway would hand `main` a value its type says cannot exist. Effect
  cluster, the design the outbox already copies, does exactly this with a kept
  message that no longer decodes. AMQP and Akka have the same idea under
  "dead letter".
- **Kept, not dropped:** the record shows it, with why. A host can list it and
  a person can tell it again after fixing it. The why stays off the span: a
  shape's words can quote the value, and spans carry no values.
- **A first send that does not fit still fails the sender.** That is the
  sender's bug at the boundary, Elm's rule. Only a value that waited across a
  change becomes a dead letter.
- **What `fit` already catches stays caught.** A change the JSON Schema shows
  makes `pipe` answer `does_not_fit` before the upstream starts, as Kafka
  refuses an incompatible schema up front. The dead letter is for what JSON
  Schema cannot show (Effect 4.0.0 leaves patterns out of it).
- **Not taken:** Akka's event adapters, converting old values into the new
  shape. A shape here only checks and never converts (`shape.ts` refuses a
  converting schema), so an adapter would be a second kind of shape.

**2. A run keeps the flags it was first started with** (`src/program/program.ts`).

A start under an id that already has a record must give the same flags, by
value, in any key order. Other flags are refused by the first flag that
differs: `{kind: "bad_shape", name: "mode", why: 'run moder:1 was first
started with mode "read", and a run keeps the flags it was first started
with'}`. The record is read before the run is opened, so a refused start
fences nothing and leaves the record as it was. Kept flags that a stricter
shape no longer takes are refused by that flag's name too, since the given
ones are the same ones and are checked first.

- **Why:** Temporal's rule, and 75b's rule for a machine run's start Msg
  (`AlreadyStarted`): an id names one run with one input. A new run takes a
  new id. Elm's flags are also fixed for the program's life.
- **No change for tsh:** it already passes its job record's flags. Nothing in
  the 1,544 tests before this started a run again with other flags.

**3. Every input's line holds `CAPACITY` = 1000 values `main` has not read**
(`src/program/program.ts`).

- **A host's `tell` never waits.** Past the limit it answers a new word,
  `full`, and keeps nothing. That is Akka's bounded mailbox with its default
  capacity, except the sender is told instead of the value going quietly to
  dead letters.
- **`offer` waits for room.** It is new, on `Run` and as `offer(run, name,
  value)`. Effect's `Queue.offer` on a bounded queue does the same. A pipe into
  an `auto` input, a pipe's outbox resend, and `call`'s told values all use it
  now, as a writer on a full Unix pipe blocks. A pipe never breaks on `full`.
- **tsh:** a script file's lines are offered, so a script longer than 1000
  lines waits for the shell. Stdin (Node's readline, at the edge) tells each
  line. On the first `full` it pauses stdin and offers the rest in order. The
  close comes after the last line. Values given on a job's command line are
  told before any upstream starts, so they are never waited on: past the
  limit, the job does not start, and tsh says which input answered what.
- **At a run's end its lines are shut, not ended.** An offer still waiting is
  let go with `stopped` instead of waiting forever. Values still on a line
  were dropped at the end before too (row 27, experiment 80, counts them).
- **A starter's close while an offer waits:** the offer was in line before the
  close, so it is read before the end, as Effect's queue does. A tell after
  the close answers `closed`.

Two limits now sit side by side, and they do different jobs. `WINDOW` (5,
Kafka's in-flight cap) counts values one manual-ack pipe sent and has not
heard acked. `CAPACITY` (1000, Akka's mailbox) counts values on one input's
line, from every writer.

## The tests

`src/program/inputs-over-time.test.ts` (10), and one more in
`src/program/storage.test.ts` (it runs for each storage kind).

- **Dead letters:** `relay | holder` with `"Abc"` and `"abc"` left unacked.
  The next start, with small letters only: `"Abc"` is a dead letter with why,
  `"abc"` is sent again, a new `"xyz"` goes through, and relay does not fail.
  The start after that sends `"abc"` again and never `"Abc"`. A value that
  does not fit when it is first sent still fails the sender.
- **Flags:** other flags are refused by name, `main` does not run, and the
  record still says `ended` with the first flags. The same flags in another
  key order start it. Kept flags a stricter shape refuses are refused by name.
- **Capacity:**
  - 100,000 tells to a run that never reads: 1000 `queued` and 99,000 `full`.
  - 3,000 offers to a reader that starts late: none read before it starts,
    then all arrive once, in order.
  - A pipe of 3,000 into a late `auto` input: both runs end, all arrive in
    order.
  - `call` with 3,000 told values: all 3,000 heard.
  - An offer waiting when the run stops answers `stopped`. One waiting when the
    starter closes the input is read. A tell after the close answers `closed`.
- **Storage:** a dead letter moves out of the outbox in one write. Moving it
  twice, or one never sent, changes nothing. A stale handle moves nothing. A
  record kept before 79 reads with no dead letters.

## Findings

| | Before | After |
|---|---|---|
| Resent value, stricter input | sender fails before `main`, at every start | dead letter with why; sender runs on |
| Restart with other flags | runs with them; record disagrees | refused by flag name; record untouched |
| 100,000 tells, nobody reads | all queued, 30.7 MB | 1000 queued, 99,000 `full`, 0.4 MB |
| 1,000,000 tells, nobody reads | all queued, 309 MB | 1000 queued, 999,000 `full`, 0.4 MB |
| tsh, 1,500 and 3,000 lines piped to stdin | all run | all run |
| tsh, a 2,500-line script file | all run | all run |
| Full suite | 1,544 | 1,556, twice |

## Recommendations

| # | Do | Why | Tradeoff | Confidence |
|---|---|---|---|---|
| 1 | Keep dead letters on the sender's record; show them in tsh's `jobs` and drop them with the run on `forget`. | Effect cluster's own answer, and the sender stops being stuck. Today only a record read shows them. | One more thing `jobs` shows. | 80% |
| 2 | Keep flags fixed per run id. | Temporal's and 75b's rule; closes the mid-run mode change. | A host that wants other flags must start a new id. | 85% |
| 3 | Keep `CAPACITY` at 1000 for every input, with no per-input setting until a program needs one. | Akka's default; bounds memory at about 0.3 MB per input. | The number is borrowed, not measured on our programs. | 65% |
| 4 | Put the capacity in the listing once there is a per-input setting. | A host can show why it got `full`. | A field nobody reads yet. | 50% |

Doubts for the ones under 80%:

- **3.** The number comes from Akka, not from our runs. Counting the longest
  line in a 5-ticket operate batch would show whether 1000 is far from real
  use or close to it.
- **4.** Only matters if recommendation 3 grows a per-input setting.

## Holes

- **A `tell` and an `offer` on one input are not ordered against each other.**
  Offers keep their order among themselves, and so do tells. A tell can pass
  an offer that waits. tsh never mixes them on one input. The stdin path sends
  every line after the first `full` as an offer.
- **An upstream piped into a stuck downstream now waits forever,** where before
  its values piled up in memory. That is a full Unix pipe. Stopping either run
  lets it go.
- **A dead letter's why can quote the value.** It sits in the run's own
  record, which already holds the value, and stays off spans.
- **The flags check compares the JSON form**, since that is what is kept. A
  flag value that changes under JSON, such as a Date, compares as its JSON
  text.
- **Values on a line at the run's end are still dropped without a count.** Row
  27 is experiment 80's.

## Not done

- tsh's `jobs` does not show dead letters yet (recommendation 1).
- No per-input capacity (recommendation 3).

## After 79: jobs shows a full line

The hole above, a writer that waits forever on a stuck reader, was silent:
nothing failed and nothing printed. A full Unix pipe is just as quiet, and a
Unix shell shows it only in `ps`, as a writer asleep in the pipe. So tsh
shows it in `jobs`, with no timeout, since a timeout would need a number we
have not measured.

A run now says, per input, how long its line is and how many writers sleep on
it: `run.queues()`, `{length, waiting}`, Erlang's `message_queue_len` beside
the sleeping writers. A writer counts only while it waits on a full line. A
`tell` that answered `full` never waits, so it never counts. `jobs` reads it
when asked:

```
[1] running   seq --to 3000 | lazy
      seq   waiting for room: lazy's input n is full
      lazy  input n full: 1000 unread, 1 waiting
```

The first row names the stage whose pipe is the waiting writer, read from the
job's own pipe, not from the run. A waiting writer into the first stage is
tsh itself, offering a script's or stdin's lines, and only the full line
shows. Both rows go once the reader reads again.

Tests: `src/program/inputs-over-time.test.ts` (empty, a tell answering
`full` not counted, two offers asleep, nothing after the end) and
`src/tsh/full-line.test.ts` (the rows above, then gone once `lazy` reads).

Left: the feeder side is known only to tsh, from its pipes. A host that wires
runs itself sees the full line and the count, not who waits. `ps` does not
show it.
