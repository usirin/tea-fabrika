# 75c. Ids on the pipe: ship catches a repeat of review's `passed` by its head

Scripted runs only: fake GitHub, a scripted reviewer, no agent, $0.

```ts
// Before: review sent a bare url. Ship dropped the run once it was over,
// so the same pull request said again was new work.
passed: output(PullRequestUrl, "...")          // "https://github.com/o/r/pull/14"

// After: review sends the pull request with the head it passed at.
// The value cannot be made without its head.
passed: output(Passed, "...")                  // {pr: ".../pull/14", head: "b695a2a..."}
// Ship keeps that run under the url of the commit, until a forget:
keyOf({pr, head}) === `pr/${pr}/commits/${head}`
```

## What was asked

- 75b's finding 4: in `review | ship`, a review that already finished says
  `passed` again after a kill and restart. If ship had already finished that
  pull request and dropped its run, only GitHub saying "merged" stops a second
  enqueue. Does this really happen?
- If it does, fix it with an id on what flows down the pipe: the pull
  request's url plus its head commit, the way Stripe's `Idempotency-Key`
  works. Settle who keeps the "seen" record, how long, what clears it, and
  whether it belongs in the pipe, in every program, or only in ship.
- Look at the 75b kill test that failed once in 4 full runs during
  experiment 76.

## The tests

All in `src/stages/review/program.test.ts`. The fake GitHub never says a pull
request is merged, so nothing but what ship kept can stop a second enqueue.
Each counts reviews and enqueues per pull request, over three pull requests.

| # | The job | Before the fix | After |
|---|---|---|---|
| 1 | Review's save "my work on #14 ended" is slow (its disk stalls). Ship ships #14 and takes it off its queue. Kill. Start again on the same disk. | #14 enqueued **2** times, 3 of 3 runs | each enqueued once; #14 answered from what ship kept, GitHub not read for it again |
| 2 | No kill. #14 is told to review again, at the same head, after ship finished it. | #14 reviewed 2, enqueued **2**, 3 of 3 runs | reviewed 2, enqueued once |
| 3 | The other side: ship's save of #14 is slow, review's is not. Kill. | #14 reviewed once, enqueued **0** | the same: pinned, not fixed (see finding 3) |
| 4 | 75b's test: three pull requests, two kills | flaky under load: once `#15 [1, 0]` | deterministic; each once, in each of 8 full runs |

Before-the-fix counts come from the same tests with ship told to drop the run
again. Test 1 and test 2 failed 3 of 3 that way, and passed 5 of 5 with the
fix.

Ship's own tests (`src/stages/ship/program.test.ts`):

- the same head after a restart is answered from what was kept: said again,
  not read, not queued;
- five pull requests, told twice while queued and once more after all were
  over: each read once and queued once; a new head on #1 is read and queued
  again;
- a bare url told again after it is over ships again, and nothing is kept;
- a `forget` under the id lets the same head ship again;
- a head that is not forty hex digits, a missing head, or an extra field is
  `bad_shape`, and nothing is read.

A real kill -9 run was not added. See finding 2 for why it cannot hit this
moment.

## Is the bug real?

Yes, but not by a plain kill -9 in one process. It needs one of two things:

- **Two disks, or a slow one.** In test 1 review and ship have their own
  storage, as two processes would. Review's save that its work ended stalls.
  Ship finishes #14 meanwhile. A kill there leaves review with #14 unfinished.
  At the next start it reviews #14 again (from what it kept, no agent) and
  says `passed` again.
- **The same pull request told again.** Nothing stops a person or an upstream
  from telling review the same pull request twice. Review takes it as new
  work once its first run ended (`src/stages/queue.ts`, top comment), and
  ship took it as new work too.

## The fix

- `src/stages/ship/program.ts`: `Commit` (forty hex digits), `Passed`
  (`{pr, head}`), and `keyOf`. Ship's `pr` input takes a bare url or a
  `Passed`. A `Passed` run is kept under `pr/<url>/commits/<head>` once it is
  over, exactly as an asked run is kept under its ask id (75b). The queue item
  says `kept` in place of `asked`. A repeat at the same head finds the run
  over and answers from it: `outcome` and `answer` said again, nothing run.
- `src/stages/review/program.ts`: `passed` is `Passed`. It sends
  `{pr, head: report.head}`. A pass with no head dies: the machine only ends
  `done` from a review at a head.
- `src/program/shape.ts`: `fit` takes an output that equals one member of a
  union input (`anyOf`), as a TypeScript union takes each member. Without
  this, `review | ship` would not wire.
- `src/program/mortal.ts`: the test disk takes a `before` hook per life, to
  stall a write.

Code (not tests): 110 lines added, 34 removed. Tests: 509 added, 111 removed.

### The questions, settled

- **Who keeps the "seen" record?** Ship, the receiver. It is the only one
  that knows what makes two values the same work. This is the transactional
  inbox: the receiver records the ids it has handled, beside its own state.
  Here the record is the ship run itself, so the work and "I did this" are
  one save.
- **How long, and what clears it?** Until a `forget` under its id, or until
  the whole run is removed. Never by time. Stripe may drop keys after 24 hours
  and Restate after a set retention time, because a caller retries within
  minutes. A pipe's sender has no such bound: a review
  can come back after any outage. A shorter time is not safe without an ack.
- **A new head is new work.** The id has the head in it. Tested.
- **Pipe, every program, or only ship?** Only ship. Three reasons. A bare url
  from a person must ship each time, so the pipe cannot dedup blindly. The
  kept queue already drops a value told again while it waits; keeping
  finished values there forever would need a retention rule the queue does
  not have, and the queue clears itself when its input ends. And the "same
  work" rule differs per receiver. What is general and small is the type:
  `Passed` cannot exist without its id.
- **Invalid states.** `Passed` needs a whole commit. A short sha, a missing
  head or an extra field is `bad_shape` at `tell`, before any run. Review's
  side is checked at runtime, not by type (hole 1).

### Prior art

| What | How it maps here |
|---|---|
| Stripe `Idempotency-Key` | The client picks a key; the same key again gets the first result back, errors included. Here the key is the url of the commit, and a repeat gets `outcome` again from the kept run. |
| Temporal workflow id reuse policy | `RejectDuplicate`: a closed workflow's id cannot start again within the namespace's retention. Ship's kept run at a head is that, and `forget` is the end of retention. `AllowDuplicateFailedOnly` is not copied: a pull request stuck once stays answered until forgotten. |
| Restate idempotency keys | The same shape as Stripe, with the result kept for a retention time. We keep it until `forget`. |
| Kafka idempotent producer | A producer id and a sequence number let the broker drop a resent batch. That is dedup on the hop, by the receiver; our id is the content's own, not a sequence. Kafka's `acks=all` is what the loss in finding 3 needs. |
| Transactional inbox | The receiver records each message id it handled in the same write as the effect. Ship's kept run is that record. |
| Akka `AtLeastOnceDelivery` | The sender resends until `confirmDelivery`; the receiver must dedup by id. Review is the sender that resends; ship now dedups. The confirm step is still missing (finding 3). |
| TypeScript and JSON Schema unions | A member is assignable to its union. `fit` now says the same. |

## Findings

1. **The repeat is real, and an id stops it.** Before: #14 into the merge
   queue twice, in test 1 and test 2, 3 of 3 runs each. After: once, 5 of 5
   alone, and in each of 8 full suite runs.
2. **A plain kill -9 in one process cannot hit the repeat.** tsh gives a job
   one storage, with one write lock. Review sends `passed` in memory
   (`src/program/program.ts:771`, `wire.writer.tell`, then `Queue.offerUnsafe`
   at `:924`), and on the same fiber saves that its work ended
   (`src/stages/queue.ts:117-118`). That save is queued on the lock before
   ship's first save of the pull request. So review's "ended" always lands
   before ship can finish the pull request. bin/tsh has no hook to stall one
   key's write, so a real kill -9 test cannot be aimed there either. Test 1
   stands in with two storages and a stalled write.
3. **The other side is a loss, and it is the more likely one.** The same
   order means review's "ended" can land before ship has kept the pull
   request at all. A kill between the two loses it: review never says it
   again, ship never had it. Test 3 pins it: #14 reviewed once, enqueued 0
   times. The fix here does not touch it. Only an ack closes it: ship says
   "kept", and review marks its work ended only after that (Kafka `acks=all`,
   Akka's `confirmDelivery`).
4. **The 75b flake was finding 3, not the repeat.** Under full-suite load
   (150 repeats of that test) the only failure was `#15: [1, 0]`: reviewed,
   never enqueued. The old test killed by watching for #15's verdict from a
   poll, so the kill could land after review's "ended" save and before ship's
   save of #15. Now the kill is made inside the verdict listener, before
   `passed` is sent, and #15's reviewer is held until #14 is in the merge
   queue. The test passed 8 of 8 full suite runs since. The window itself
   now has its own test (test 3). One of those 8 runs failed elsewhere:
   76's `src/agents/acp/kill.test.ts` (a real kill -9 mid turn) saw the cut
   prompt sent once, not twice. It passed 5 of 5 alone. This experiment does
   not touch that code; it is 76's to look at.
5. **`fit` was exact, and a union input could not be wired.** Fixed with the
   member rule. The reverse is still refused: an output that may send either
   does not fit an input that takes one.
6. **A failing write on stop crashes the process.** Making a test write fail
   (not stall) gave an uncaught `StorageBroken`. tea's Effect engine reports a
   failed final save as `stop-save` through `onError`, and its default
   rethrows on a macrotask. `src/program/kept.ts` passes no `onError`. So a
   disk that fails for good crashes the process: a kill, not a repeat. No tea
   change made.
7. **A repeat at the same head is answered, not refused.** Ship says the
   kept `outcome` again, like an ask asked again and like Stripe's replay. So
   a deliberate retry of the same head must use a bare url, or `forget` first.

## Recommendations

| # | Do | Why | Tradeoff | Confidence |
|---|---|---|---|---|
| 1 | Keep the id on `passed` and the kept run in ship. | A repeat is caught by the head, not by GitHub's state. Tests 1 and 2 flip from 2 enqueues to 1. | One kept run per head shipped, until forgotten. | 85% |
| 2 | Add an ack to `pipe` next: the receiver says "kept" before the sender marks its work ended. | It is the only fix for finding 3, the loss, which a plain kill -9 can hit. | `tell` stops being fire-and-forget; a slow receiver slows the sender (Reactive Streams backpressure has the same trade). | 70% |
| 3 | Give `runKept` an `onError` that fails the run instead of the process. | Finding 6: one bad disk write kills every program in the process. | A failed final save becomes a run that ended `failed`, which a host must show. | 75% |
| 4 | Make review's `done` Report carry a non-null head in its type. | Then `passed` at no head cannot be written, not only checked at runtime. | A change to the review machine's Report union. | 70% |
| 5 | Say `forget` for piped runs when the lane ends, as `operate` does for asks. | Otherwise kept runs grow by one per head shipped. | Someone must own the end of a lane in `review \| ship`. | 65% |

Doubts for the ones under 80%:

- **2.** Unsure an ack belongs in `pipe` and not in the receiver's input. A
  sketch of `tell` returning after the receiver's `told` save, run against
  test 3, would settle it.
- **3.** Unsure whether tea should own this default instead. A tea issue
  asking whether `stop-save` should go to the scope's error channel would
  lift it; this experiment does not change tea.
- **4.** Unsure the machine never ends `done` without a head in a replay
  path. A property test over the review machine's ends would lift it.
- **5.** Unsure who that owner is with no `operate` in the loop. A tsh job
  that tells `forget` on its own `pr`'s close would be one answer; it may
  instead keep everything until the run is removed, which is today's rule
  for an ask never forgotten.

## Holes

1. Review's `done` with a null head dies at runtime; the type still allows it.
2. The id's head is the reviewed head; ship enqueues the head it reads from
   GitHub. If the pull request moved between the two, the gate reads reviews
   at the new head (`reviews` is per commit) and stops unless that head has
   passed too. Either way the run is kept under the old head's id. Not tested.
3. Ship's kept queue items changed from `asked` to `kept`. A queue kept by an
   older build fails to decode at the next start. No migration; nothing kept
   outside tests yet.
4. Test 1 uses two storages in one process. It shows the moment can happen
   with two disks; it is not a real two-process run.
5. Field note ids start at `2026-10-18-01` after 76's `2026-10-17-33`.

## Not done

- An ack on the pipe (recommendation 2), so finding 3 stays pinned, not fixed.
- A real kill -9 run of the repeat (finding 2).
- Any change to `@demlik/tea`.
