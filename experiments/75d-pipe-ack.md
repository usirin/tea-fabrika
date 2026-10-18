# 75d. An ack on the pipe: a pass review sent is never lost to a kill

Scripted runs only: fake GitHub, a scripted reviewer, no agent, $0.

```ts
// Before: review sent `passed` in memory, then saved "my work on #14 ended".
// A kill before ship saved #14 lost it. Nobody had it.

// After: ship's input says it acks.
pr: input(toldShape(pullRequest), "...", {ack: "manual"})
// ship's `main` reads deliveries, and acks once its kept queue has saved the value:
inputs.pr  // Stream<{value, ack}>
// review's run keeps each value in its outbox until that ack:
send("passed", v)  // keep in review's record -> hand to ship -> return
                   // ship saves -> ack -> review drops it from its record
```

## What was asked

- 75c's finding 3: review sends `passed` in memory, then saves that its work
  ended. A kill before ship has saved the value loses the pull request. Close
  it with an ack, the Effect cluster way: the receiver's save is the ack, and
  at a start what has no reply is handed back.
- Sender: a value stays in the sender's kept outbox until acked, and is sent
  again at the next start. Receiver: the ack means "saved", not "handled".
- `pipe` must not need to know what values mean. No transactions: order the
  writes so every kill point is safe.
- Decide where dedup lives. Check the 76 kill -9 flake for the same cause.

## The design

`src/program/outbox.ts` (new), `src/program/program.ts`, `src/program/storage.ts`,
`src/program/shape.ts`, `src/stages/queue.ts`, `src/stages/ship/program.ts`.

- **An input says how it acks.** `input(schema, text, {ack: "manual"})`, AMQP's
  two modes. `auto` (the default) is every input as before. A `manual` input
  hands `main` a `Delivery`, `{value, ack}`, and the type of `inputs.<name>`
  follows the declaration, so a `main` cannot read a `manual` input as bare
  values or forget the ack is there.
- **The sender keeps an outbox in its run record.** A pipe into a `manual`
  input makes one (`outboxOf`). `send` waits for room, writes the value into the
  record under a number (`sent`), hands it to the receiver's line with its ack,
  and returns. The ack, run by the receiver, removes the line (`acked`), on a
  fiber of the sender's run. A run that starts with lines left hands them on
  again (`resend`), before `main`, under their old numbers. A run ends only
  once its outbox is empty, or the receiver has ended (`drained`).
- **The receiver acks once its kept queue has saved the value.**
  `workQueue` dispatches `told`, which returns once the state is saved, then
  runs the ack. So the ack means "the queue has it", not "it shipped".
- **Room.** At most `WINDOW` = 5 values per pipe wait on their ack (Kafka's
  default for `max.in.flight.requests.per.connection`). The sixth send waits,
  like a write to a full Unix pipe. So an outbox never holds more than 5 lines,
  and the receiver's line never holds more than 5 values from that pipe.
- **`pipe` does not know what values mean.** It numbers them. The number is
  only for the ack. Two equal values are two lines.
- **Dedup stays in ship.** See below.
- **Into an `auto` input nothing changes.** `tsh`'s `a | b` and every other
  pipe tell and forget, as before. The public run record (`RunRecord`) does not
  show the outbox; a record kept before 75d decodes with an empty one.

### The kill-point table

One pass, #11, as `review | ship` on one storage writes it (the sweep's write
numbers, from a run with no kill). "Kill before" means the write never lands.

| Writes, in order | Kill right before it: what the next start does | #11 enqueued, before 75d | after |
|---|---|---|---|
| review's machine #11 saves its steps, up to `over` (6 to 10) | review goes on from its last kept step; a reviewer that answered is not run again; it sends `passed` | 1 | 1 |
| review's record: `sent`, the outbox line (11) | nothing was sent; review's queue still has #11; its machine is `over`, so it sends `passed` again | 1 | 1 |
| review's queue: `done` (12) | the outbox has #11 and hands it on; review also works #11 again and sends a second copy; ship keeps one (a value told while on its queue is not queued twice; after, its kept run at that head answers). Before 75d, review worked it again alone | 1 | 1 |
| review drops machine #11 and moves on (13 to 19) | review's work on #11 is over; the outbox is the only copy and hands it on. Before 75d, nobody had it | **0** | 1 |
| ship's queue: `told` (20) | the same: the outbox hands it on | **0** | 1 |
| review's record: `acked` (21) | ship has it; the outbox hands it on anyway; ship's queue drops the repeat | 1 | 1 |
| ship's machine #11, before `enqueue` (22 to 25) | ship goes on from its kept step | 1 | 1 |
| ship's machine #11, the first save after `enqueue` reached GitHub (26) | ship sends `enqueue` again: the Act's own window (finding 4) | 2 | 2 |
| ship's later saves, its queue `done` and `cleared` (27 to 31) | ship goes on; nothing is sent twice | 1 | 1 |

The full sweep, every write of three pull requests, killed before each in
turn, one kill per run, then started again and let end:

| | Writes | Kill points that lost a pull request | Kill points that enqueued one twice |
|---|---|---|---|
| Before 75d, one storage | 79 | **26** (8 for #11, 8 for #14, 10 for #15) | 3, all in the act window |
| Before 75d, a storage each | 79 | **26** | 3, all in the act window |
| After, one storage | 85 | **0** | 3, all in the act window |
| After, a storage each | 85 | **0** | 3, all in the act window |

"Before" is the same test with the outbox switched off.

## What was borrowed from Effect cluster, and what was left

`effect/src/cluster/MessageStorage.ts` was read for the design. No code was
copied.

| Cluster | Here | Why |
|---|---|---|
| `saveRequest` keeps a message before it is delivered | `sent` keeps the value before it is handed on | Borrowed: this is the whole fix. |
| A reply (`saveReply` with an exit) marks the message processed | `acked` removes the line | Borrowed. The ack carries no result: ship's answer is its `outcome`, an output. |
| `unprocessedMessages` hands back what has no reply, at a start | `resend` hands on what `unacked` holds, before `main` | Borrowed. Cluster also polls storage while running; here only a start sends again, since in one live process the hand-off cannot be lost. |
| Messages live in a shared mailbox, the receiver's | The outbox lives in the sender's run record | Left. Review and ship may have two storages, and a `KeyValueStore` cannot write two keys at once. The sender's outbox is the transactional outbox, without the transaction. |
| `saveEnvelope` with a `primaryKey`: a repeat answers `SaveResult.Duplicate` | Ship's kept run under `pr/<url>/commits/<head>` (75c) | Left in the pipe, kept in the receiver. See "Where dedup lives". |
| Snowflake ids, shards, runners, entity addresses, RPC envelopes, reply chunks, interrupts | none | Left. A pipe joins two runs; nothing here is sharded or remote. |
| SQL transactions around a save | none | Left, by the brief. The kill-point table is the order instead. |

Also prior art: AMQP's `basic.ack` and its auto and manual modes (the names);
Akka's `AtLeastOnceDelivery`, `deliver` and `confirmDelivery`, with a cap on
unconfirmed messages (the same shape); Kafka, which commits a consumer offset
after the record is processed and caps a producer's unacked requests (the
window); TCP's send window.

## Where dedup lives

In ship, the receiver, as 75c left it. Three reasons:

1. **A pipe's numbers miss half the repeats.** A kill before review's `done`
   makes review work the pull request again and send a new `passed`, under a
   new number. The outbox's own resend is only the other half. Only an id
   that comes from the value (the head) catches both. A person telling the
   same head again is a third repeat no pipe sees.
2. **Only the receiver knows what "the same work" is.** A bare url from a
   person must ship each time; `{pr, head}` ships once per head.
3. **Dedup in the pipe needs a retention rule it has no way to choose.**
   Cluster keeps message rows until the entity's address is reset; a pipe
   has no such end.

So the pipe gives at-least-once, and the receiver makes it effectively once,
as with Kafka's consumer and Akka's `confirmDelivery`.

## The tests

The user's job first.

1. **`review | ship`, killed before every write in turn**
   (`src/stages/review/program.test.ts`, "killed at every write in turn").
   Three pull requests sit on review's kept queue. Each run kills before one
   write (1 to 85), starts again, and lets both end. GitHub never says merged.
   Run for one storage (as tsh gives a job) and a storage each. It prints the
   table and asserts: every pull request enqueued once, both runs end, and a
   2 only where the kill came right after that pull request's `enqueue`.
   Before: 26 losses per mode. After: 0.
2. **75c's loss test flips.** "a pull request lost": #14 reviewed once and
   now enqueued once (was 0), sent again from review's outbox.
3. **75c's repeat tests stay at 1.** Both pass. Test 1 there stalled every
   write of review's; it now stalls only review's queue writes, since
   review's send now waits on its own outbox write.
4. **A slow receiver** (`src/program/program.test.ts`). A receiver holds its
   acks; the sender has sent 5 and waits on the 6th, and the receiver has 5.
   Let go, all 20 arrive once and in order, both runs end, and never more than
   5 were unacked.
5. **A pipe into an input that does not ack** never waits: 20 values sent
   before the receiver reads one, then all 20 read.
6. **The outbox in storage** (`src/program/storage.test.ts`, both kinds): what
   was sent and not acked is what the next open finds; an ack heard twice
   changes nothing; a stale handle can neither send nor ack; the host's record
   has no outbox.
7. **Everything else stays green**: the tsh kill -9 test, the 72 race tests,
   68a's crash table, 75b's and 75c's proofs. `pnpm typecheck`, `pnpm lint`,
   and `pnpm test` (1522 tests): 5 full runs, 4 green, the last two in a
   row on the final code. The other failed once on 76's acp kill test
   (finding 6).

## Findings

1. **The loss is gone.** 26 of 79 kill points lost a pull request before,
   in both modes; 0 of 85 after. The window was always the same: from
   review's `done` to ship's `told`.
2. **`pipe` did not need to know what values mean.** It numbers them, and the
   receiver's only new job is to call `ack` after its save. So the ack lives
   in `pipe`, not in the receiver's input logic. The only per-program part is
   one word on ship's input and one line in `workQueue`.
3. **The cost.** Two writes per value on the sender (`sent`, `acked`): 79 to
   85 for three values. Each rewrites the whole run record. Code: 349 lines
   added and 61 removed outside tests, about half of it comments; 135 of
   them are `outbox.ts`. Tests: 286 added.
4. **The act window is ship's, not the pipe's.** In 3 kill points per mode
   (one per pull request) the fake GitHub saw a second `enqueue`: the kill
   came after ship's `enqueue` reached GitHub and before ship saved that it
   did. That is the Act's at-least-once from 68a. The live enqueue reads
   first and finds its own first write (`src/code-host-github-writes.ts`, "in
   the queue already"), so GitHub absorbs it. The fake never says queued or
   merged, so the sweep counts it, and asserts it happens only there.
5. **Two kills in one review make it stuck.** The first sweep showed #11
   lost at one kill point. It was not the pipe: the setup run had started
   #11's reviewer, the kill cut a second run, and review ends `stuck`
   `over_budget` after two reviewer runs (`MAX_RUNS`). The sweep now holds the
   setup run before any reviewer starts. A user who kills a job twice during
   one review has to tell that pull request again.
6. **76's acp kill test is likely the same class of bug, not this one.** It
   failed once in 5 full runs here, and passed 6 of 6 alone. tsh tells a
   job's `prompt=` values in memory at start (`src/tsh/execute.ts`, the tell
   loop), and acp keeps each prompt only when its reader saves `told`. A kill
   between the two loses a prompt, and nothing tells it again: a value handed
   over in memory before the receiver saved it, as here. The test cannot
   tell which prompt went missing: it checks the first word, and the cut
   prompt and the third both start with "slowly". 75d does not touch it: tsh's
   tell is not a pipe. No change made in `src/agents/acp/`.
7. **A `manual` reader must ack each value once saved.** One that waits for
   a 6th value before acking the first never gets it. The type cannot say
   this; `workQueue` does it right.

## Recommendations

| # | Do | Why | Tradeoff | Confidence |
|---|---|---|---|---|
| 1 | Keep the outbox in `pipe`, switched on by `{ack: "manual"}` on the receiver's input. | The loss is gone at every kill point, and `pipe` stays blind to what values mean. | 2 record writes per value; a slow receiver slows the sender. | 85% |
| 2 | Keep dedup in the receiver, by an id in the value. | Half the repeats are new sends the pipe cannot tell from new work. | Every receiver that must not repeat needs its own id rule. | 85% |
| 3 | Make `workQueue` take only deliveries, so a kept queue cannot read an input that does not ack. | Any input read by a kept queue then gets the outbox when piped; forgetting `manual` cannot compile. | Host tells pass a no-op ack; review's and operate's inputs change type. | 70% |
| 4 | Look at 76's flake as a lost host tell: log the whole prompt in the fake agent, and check `opened.resent`. If it is the third prompt, give tsh's `input=value` tells the same outbox, with tsh's job record as the sender. | Finding 6. | tsh would keep what it tells until acked. | 50% |
| 5 | Show outbox lines that no wire will take (a run started again, not piped) in `jobs`, or drop them on `forget`. | Hole 1: they stay unsent and unseen. | One more thing a host shows. | 60% |

Doubts for the ones under 80%:

- **3.** Unsure every kept-queue reader wants the outbox: operate's inputs are
  told by a host, not piped. A pass over every `workQueue` caller would settle it.
- **4.** The cause is a guess from reading, not from a failing run: the test's
  log cannot tell the two prompts apart. The fake agent logging the whole
  prompt, plus 20 full suite runs, would lift it.
- **5.** Unsure a stranded line happens outside a test: tsh always starts a
  job's pipe the same way. A tsh test that attaches a job with a lost wire
  would show whether it can.

## Holes

1. Outbox lines for an output nobody wires at the next start stay in the
   record, unsent, until the run is removed. Wired to a different receiver,
   they go there.
2. The sweep kills once per run, at write boundaries. Two kills in one run,
   and a kill between two writes of one save, are not covered.
3. "A storage each" is two storage values in one process, not two processes.
4. `WINDOW` is per pipe. An input with many writers holds up to 5 per writer.
5. A record write now carries the outbox: the bigger the values, the bigger
   every record rewrite. Fine for `{pr, head}`.
6. The act window (finding 4) is only absorbed because the live `enqueue`
   reads first. A write that cannot read first would repeat.
7. Field note ids start at `2026-10-18-40`, leaving room after 75c's
   `2026-10-18-07` for parallel work.

## Not done

- No change to `@demlik/tea`, `src/agents/acp/` or `src/stages/build/`.
- No live run: scripted only.
- Host tells (tsh, operate) still have no ack (recommendation 4).
