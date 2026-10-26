# 151. Rule B on the real code: does a lane ride out a wifi drop?

The question: experiment 149 found that a wifi blip costs a lane a restart, and proposed a fix in
two parts. The owner took both, with the ledger's part written as Kafka's rule ("rule B"): a fence
is good until someone newer claims, and the clock plays no part. Rule B never ran in 149. Here it is
built into the real ledger and host, and 149's matrix runs again on that code, plus a 3 minute drop
and a second host that claims during a drop.

**Answer: yes. On the real code, every drop from 2 s to 5 minutes, refused or hung, kept the lane
with no restart while nobody else wanted the ticket: 474 of 474 runs, back in under 1 s at the
median and 2 s at worst. Today's code restarted half the 2 s drops and every longer one (149).
That includes a 3 minute drop on a 30 s lease. The ledger wrote `lease_expired` in the middle,
the lane went on under the same fence, and the late renew wrote `lease_resumed`. With a second
host waiting, a drop shorter than the lease was kept (240 of 240) and a longer one went to the
second host (236 of 236). The away host was refused, stopped cleanly, and nothing of it landed
after. A killed host's ticket frees as fast as before: 24.5 s median on a 30 s lease (149: 25.7 s).
In 1,090 scored runs, nothing landed twice. Lean: keep rule B and the 30 s lease. Confidence
85%.**

```ts
// The whole change. The ledger: packages/fabrika/src/host/rules.ts (memory.ts the same over Maps).
// The newest fence of each name sits on the name's own row, apart from its lease row (the clock).
names.fence                          // set by each claim, cleared by an exit
fencedName(db, fence)                // SELECT name FROM names WHERE fence = ?   (no clock)
fenceHolds(db, rules, stream, fence) // a fenced write is taken while its fence is that name's newest
claim(name, holder, ttl)             // a live lease: refused. Past its end: taken at once, new fence
renew(name, fence, ttl)              // not the newest fence: "lost". The newest: ok, at any time
//   after the 1 s expiry job removed the row: the row comes back, and the ledger writes
//   lease_resumed {fence, holder, expiresAt}

// The host: packages/fabrika/src/host/host-machine.ts and host.ts.
renew_unknown -> {...s, away: true}          // the next renew comes in 1 s, not 10 s
renewed       -> {...s, away: false, until}  // back: the lease runs to the later end
lease_clock   {fence, until: s.until + graceMs} // 10 min: the only place a host that hears nothing stops
seen_expiry      ends nothing any more       // the ledger's lease_expired is not a lost lease
// and every write a lane makes waits and is sent again under the same id, with no try limit.
```

One lease, step by step, in the two ways a drop can end:

```ts
// A, a 30 s lease, cut off for 3 minutes. Nobody else wants the ticket.
claim("lane:7", "A", 30_000)        // {ok: true, fence: 41}
// t = 31 s: the expiry job writes lease_expired {fence: 41} and removes the lease row
append("lane:7/state", row, 41)     // ok: 41 is still the newest fence of lane:7
// t = 3 min: the link is back
renew("lane:7", 41, 30_000)         // {ok: true, written: [lease_resumed {fence: 41, ...}]}

// The same drop, but B claims at t = 31 s.
claim("lane:7", "B", 30_000)        // {ok: true, fence: 57}: past its end, so taken at once
append("lane:7/state", row, 41)     // fenced: 57 is the newest now
renew("lane:7", 41, 30_000)         // {ok: false, why: "lost"}: A's host stops its lane
```

## What a late renew writes, and why

A renew that comes after the expiry job ran puts the lease row back and writes one row on the
name's stream:

```ts
{kind: "lease_resumed", writer: "ledger", data: {fence: 41, holder, expiresAt}} // holder: the claim's
```

- **Why a row at all.** The stream already says `lease_expired {fence: 41}`. A reader that folds
  the stream (the registry tail, a person looking at the ticket) would think nobody holds the
  name, while fence 41 goes on writing. One row says the gap closed, and with which fence.
- **Why not a `claimed` row.** No new fence was given out. Kafka does the same: a producer that
  carries on keeps its epoch, and only a new producer with the same id bumps it.
- **Why not nothing.** Then `lease_expired` would be the last word about fence 41, and wrong.
- **What it costs.** One more kind in `LEDGER_KINDS`, and a waiting host that read
  `lease_expired` tries a claim, which the ledger refuses while the lease is live again.

## How it was run

All on this laptop, no deploy, no agent, no model, $0, under `nice -n 15`.

- 149's rig, on the real code only. The ledger is its real Durable Object in Miniflare, with the
  expiry job at its 1 s grace (149's patient copy ran at 10 minutes; this one does not). The host
  is the real `serve`, with its grace at the default 10 minutes and a renew every second while it
  hears nothing.
- The scripted lane (`151-patient-lease/lane.ts`) is 149's: every 2 s one fenced fact into the
  plan's inbox under the id `note:<k>`, every 4th step one comment on a fake code host through the
  pipeline's gate, and the owner's answers, sent every 3 s, taken once each. It writes through the
  pipeline's own `sendFact` and gate, not copies.
- Host A runs behind 149's TCP proxy. At a random point 4 to 14 s in, A's link drops for 2 s,
  10 s, 30 s, 60 s, 3 min or 5 min, two ways: **refuse** (every connection reset at once) and
  **hang** (nothing moves, bytes held and sent when the link is back).
- In the `withB` cells, host B serves the same name straight to the ledger and waits.
- Both hosts come in through the ledger's door with their own agent token (`agent:host-a` and
  `agent:host-b`, both `for:owner`), so every row says which host wrote it.
- 20 runs a cell, one Durable Object a run, all runs of a cell at once. Every run is scored from
  the ledger: claims, facts by id, answers in the saved state, comments by key. New in the score:
  whether `lease_expired` landed during the drop and `lease_resumed` after it; when B took over,
  whether A's writes were refused, whether A stopped, and whether anything A tried after B's claim
  landed.
- Two settings: R30 (30 s lease, renew every 10 s) and R120 (2 min lease). They sit beside 149's
  patient P30 and P120, and its today T30 and T120.
- First a sample on R30 (3 runs a cell, drops of 2 s, 40 s and 3 min, both kinds, alone and with
  B, 36 runs), read by hand, then the full matrix. The sample agreed with the matrix in every cell. The matrix ran on the code at commit `8280dd0`. One change came
  after it: the host machine's lease clock now carries the lease's end plus the grace itself, and
  `awayRenewMs` is named `retryRenewMs`, as 149 named it. The timing is the same: `serve` already
  slept to the end plus the grace.

A control with no cut (100 runs at once) kept every lane, with no restart, and nothing doubled or
missing. Back time there is 1.0 s at the median and 2.0 s at worst: the 2 s step pace. 149's control
gave the same.

## What a drop does to a lane alone

"Kept" means no restart: the first claim lasts the whole run. "Back" is the time from the link
coming back until the next new step lands, the median and (in brackets) the worst. 149's columns
are its today T30 and its patient copy P30, refuse.

| Drop | 149 today, refuse | 149 patient, refuse | R30, refuse | R30, hang | R120, refuse | R120, hang |
|---|---|---|---|---|---|---|
| 2 s | 10/20, 20.3 s (28.0) | 20/20, 0.4 s (1.0) | 20/20, 0.3 s (0.8) | 20/20, 0.0 s (0.1) | 20/20, 0.3 s (0.9) | 19/19, 0.0 s (0.0) |
| 10 s | 0/20, 18.9 s (21.8) | 20/20, 0.7 s (1.0) | 20/20, 0.5 s (0.9) | 20/20, 0.0 s (0.3) | 20/20, 0.4 s (1.0) | 20/20, 0.0 s (0.4) |
| 30 s | 0/20, 2.0 s (2.1) | 20/20, 0.4 s (0.9) | 20/20, 0.7 s (1.0) | 20/20, 0.0 s (0.9) | 20/20, 0.5 s (0.9) | 20/20, 0.1 s (0.9) |
| 60 s | 0/20, 2.1 s (2.1) | 20/20, 0.7 s (2.9) | 20/20, 0.5 s (1.0) | 15/15, 0.0 s (0.0) | 20/20, 0.6 s (1.0) | 20/20, 0.0 s (0.1) |
| 3 min | not run | not run | 20/20, 0.5 s (0.9) | 20/20, 0.0 s (0.0) | 20/20, 0.6 s (1.0) | 20/20, 0.0 s (2.0) |
| 5 min | 0/20, 2.0 s (2.1) | 20/20, 0.7 s (0.9) | 20/20, 0.5 s (1.0) | 20/20, 0.0 s (2.0) | 20/20, 0.5 s (1.0) | 20/20, 0.0 s (0.0) |

Doubled, in every cell of this table and every other: 0 facts, 0 answers, 0 outside writes. Missing:
0. No host died. The cells with fewer than 20 runs lost runs to the rig, not the lane (the last
section says how).

- **Every drop is kept, both kinds, up to 5 minutes, on both leases.** 474 runs alone, and 240
  more with B waiting on drops shorter than the lease: 0 restarts. Back in under 1 s at the median
  everywhere, and 2.0 s at worst, which is one step's pace. That matches 149's patient copy, now on the real code.
- **The 3 minute drop on a 30 s lease.** The lease ran out about 2.5 minutes before the link came
  back. The ledger wrote `lease_expired` and removed the row in the middle of the drop (20 of 20,
  both kinds). When the link came back, the host's next renew, a second later, put the row back and
  the ledger wrote `lease_resumed`. The lane took its next step with the same fence and no restart.
- **The expiry job in the middle, counted.** On R30, `lease_expired` landed during the drop in 18
  of 20 refused 30 s drops (the other 2 ended just before the job ran) and in every drop of 60 s
  or more. `lease_resumed` came after it every time. On R120 the job ran in every 3 and 5 minute
  drop. No run was hurt by it. This is the case 149's patient copy could not cover with the
  expiry job at 1 s, and rule B does.

## When another host is waiting

Host B serves the same name and waits. A drop longer than the lease lets B take the ticket, by
design: from the ledger, a host that is away looks the same as one that died. Both kinds of drop
gave the same split, so they share a column.

| Drop | 149 today T30, refuse | 149 P30 | R30 | R120 |
|---|---|---|---|---|
| 2 s | 8 kept, 7 restart, 5 to B | 20 kept | 40 of 40 kept | 40 of 40 kept |
| 10 s | 0 kept, 14 restart, 6 to B | 20 kept | 40 of 40 kept | 40 of 40 kept |
| 30 s | 20 to B | 20 to B | 40 of 40 to B | 40 of 40 kept |
| 60 s | 20 to B | 20 to B | 40 of 40 to B | 40 of 40 kept |
| 3 min | not run | not run | 40 of 40 to B | 40 of 40 to B |
| 5 min | 20 to B | 20 to B | 40 of 40 to B | 36 of 36 to B |

The new case: B claims while A is away. In each of the 236 runs that went to B:

- **A was refused.** Once back, its writes and renews met `fenced` or `lost`.
- **A stopped cleanly.** Its host turned the program off on `lost` or on B's claim in the tail,
  and went back to watching. No crash, no exit row.
- **Nothing of A's landed after B's claim.** 0 facts, 0 saved states, 0 outside writes. The hang
  runs held A's writes and delivered them late; the fence refused each one.
- **One run did a step again.** In one 30 s refused drop on R30, B redid one step A had done just
  before the cut: A's saved state for it had not landed. The step's fact and its comment each
  landed once, by id and by key. That is at-least-once work with exactly-once effects, the same
  as experiment 95's takeover. 149 saw none. It needs the cut to fall between a step and its
  save, a short window, so one in 236 is not surprising.

## How long a dead host holds a ticket

Host A is killed with SIGKILL while B waits. The time from the kill until B's lane starts, 20 runs
each:

| Lease | 149 today | 149 patient | Rule B, real code |
|---|---|---|---|
| 30 s | 25.7 s (29.2) | 26.3 s (29.7) | 24.5 s (29.5) |
| 2 min | 114.0 s (119.3) | 114.8 s (119.0) | 115.2 s (119.9) |

Rule B frees a dead host's ticket as fast as today: one lease, less the time since the last renew.
A claim past a lease's end is taken at once, so nothing waits for the expiry job. Nothing doubled
in any kill run.

## What the window's Link shows now

149 found a false "slow" after about 9 of 10 hangs: calls that waited out the drop landed with
long times and lifted the p99. The fix in `link.ts`: a call sent before the Link went `away` does
not count once it is back.

- **Hangs of 10 s or more: no false slow**, 0 of 391 runs. The Link goes `away` at the 3 s call
  timeout, and the calls held through the drop no longer count.
- **A 2 s hang still shows slow**, for about 4 to 5 s, in 55 of 79 runs. The drop is shorter than
  the 3 s timeout, so the Link never went `away`, and those calls really were slow. Telling a
  short hang from a slow ledger needs a ping, which the Link does not have.
- **Refused drops: no slow**, as in 149.

## Weak spots in the code

The brief named four. All four were true. Reading the code turned up three more.

- **`steady()` died after about 2 s.** The pipeline's ledger calls (`sendFact`, `appendFact`)
  tried 40 times, 50 ms apart, then died with a string the host did not count as a lost lease.
  Now: no try limit, the wait doubles from 100 ms to 1 s, and the id makes each resend safe.
- **The gate's lease check went `Effect.never`.** After 40 reads with no answer it said
  `refused_lease` and waited forever for a host that had no reason to stop it. Now it waits with
  no limit, and refuses only when another fence holds the lease.
- **`Lanes.renewing` had no lease clock** (`asks/claims.ts`). With no answer it kept its ticket
  forever. Now it lets the ticket go at the lease's end plus the grace, 10 minutes, and says so.
- **The journal save** gave up after 20 tries, 50 ms apart. Now: no limit, the same backoff, and
  a save still waiting stops when the program stops.
- **Found by reading: the program's own calls.** `startChild` and `trapExit` on `Self` answer
  `unreachable` after 1 s. A lane whose child start met a 1 s drop ended stuck ("did not start"),
  and a stage whose `trapExit` met one ran on without the trap. A new `steadyCall` in
  `asks/ledger.ts` asks again while the answer is `unreachable`.
- **Found by reading: the supervisor's start.** Its first `processInfo` and `trapExit` tried 19
  times, 50 ms apart, then died, which restarted the program. Now they ask again with no limit.
- **Found by reading: the agent's answers.** Read and written with 40 tries, 100 ms apart. Now
  through `steady`.

## Writes with no fence

Every ledger write a lane or stage makes, sorted:

- **Fenced now.** `sort.ts` sent its facts with no fence. Now each goes on the stage's hold, so a
  stage whose name another host claimed sends nothing. `review-local`'s `judged` was fenced already.
- **No fence, by design.** These come from programs that hold no lease: `asks/program.ts`'s
  `keep` (writer `asks`), `criteria/record.ts`'s `judged` (writer `review`), and `newLane`'s fact,
  sent before any lane exists. Each has an id, so a resend is safe.
- **Reads that take a blip for "nothing there".** Not writes, but they decide what is written.
  Listed, not changed here:
  - `lane.ts` `planned` reads the plan stage's outcome. On a blip it reads none, and the lane's
    step fails `no_plan`. This one can break a lane.
  - The starts of `lane.ts` and `stage.ts` read whether a stage is over. On a blip a stage that is
    over can start again. It checks again itself, so the cost is one start, not a double.
  - The end of a stage reads its agent's process. On a blip the agent is not stopped, and the
    `exitChild` after it is not sent again either.

## The laws

A second agent wrote the laws for this lane, and this lane did not change them
([pull request 112](https://github.com/usirin/tea-fabrika/pull/112)). Each law that today's code
broke was kept as a known bug. The fix turned these red, and each moved to its laws list with its
body unchanged:

| Law file | Moved |
|---|---|
| `fence.laws.test.ts` | the newest fence writes past the end, and after the alarm; it renews (K1 to K3) |
| `host-machine.laws.test.ts` | the ledger's own `lease_expired` does not stop the program (H7) |
| `journal.laws.test.ts` | a save waits out any drop (W5) |
| `lane-writes.laws.test.ts` | a fact, and the gate, wait out any drop (W6, W7) |
| `laws.test.ts` | the ledger suite's laws 12 and 18 |
| `host-machine.laws.test.ts`, after the host change | the program runs through the grace (H5); a renew every second while away (H6) |
| `laws/tea-host.test.ts`, after the host change | the pipeline's lease law: stop at the end plus 10 minutes, or on a newer claim or a lost renew |

The host change, after the matrix: the lease clock's Sub carries the lease's end plus the grace
itself, so the machine, not `serve`, says when a host that hears nothing stops.

```ts
export const HOST_GRACE_MS = 600_000; // the host's grace; not the ledger's 1 s expiry grace
leaseClockOf(s, graceMs) // {fence, until: s.until + graceMs}; serve sleeps to `until`
losesLease(fence, until, m, graceMs) // renew_lost, a newer seen_claim, or
//                                      lease_due with m.until >= until + graceMs
```

Two things the laws agent was told, and is judging:

- **W8 looks wrong.** It wants the gate to send once a renew came back after a lease ran out. Its
  world never renews the real row, so after `back` the gate reads a lease that ran out and keeps
  waiting. Its lease is 10 s and `back` goes up to 599 s. The gate is right to wait: a comment on
  GitHub cannot carry a fence, so sending on a lease past its end lets a host that claims at that
  moment send it too.
- **The planted mistakes are text edits on the old code**, and the fix moved that text. Their
  anchors need moving: 6 tests, in the four new law files. The laws themselves run, and pass.
  `journal.laws.test.ts` also builds a journal without the new `signal` (the program's stop), so
  `pnpm typecheck` fails there until it passes one.

What the laws agent found, judged by the rule and not by the code:

- **W8: the world was wrong, not the gate.** The world now renews the row when the network comes
  back, as rule B lets the newest fence do. W8 passes and moved to the laws. The gate still waits
  for a live lease.
- **Every plant points at the line that does its job now**, and each is still caught. Laws that
  were known bugs now also catch older plants (no dedupe also breaks the newest fence's writes);
  each list says so beside it.
- **New plants, so every law is seen to fail.** 149's rule as a plant (memory and SQL); the
  ledger's own `lease_expired` stops the program; being away keeps the regular pace; the gate
  takes a run-out lease for lost.
- **The host's plant test took 88 s**, past the 60 s limit. Its world's queue scanned for the
  next event, and a world at the lane's pace with a renew each second holds tens of thousands.
  A heap with the same order made it 18 s. The fence's plant checks stop at the first failing
  run and do not shrink, as the editor's laws do: no law's answer changes.
- **A gap no law covers:** W8 checks that the write was sent, not that it waited for the renew,
  so a gate with no lease check passes it. Only G3 catches that plant.
- **The gap, closed by W9** (G5 in `lane-writes.laws.test.ts`, written by a third agent from the
  rule): while the lease has run out, or the alarm took its row, the gate sends nothing; once the
  renew lands, the write goes out once. Each send is judged on the ledger's own row at that
  moment, in a world where the lease really runs out. The code keeps it. Its plant (the gate takes
  rule B for an outside write and sends on a run-out lease) is caught by W9 alone. W9 also
  catches the no-lease-check plant and the run-out-is-lost plant.

```ts
// W8's world (lane-writes.laws.test.ts, `runGate`, the "late" case), cut short: before each
// lease read, the host's renew lands on the real row, once, when the network is back.
const renewBack = Effect.suspend(() =>
	renewed || Date.now() < backAt
		? Effect.void
		: Effect.orDie(l.renew(NAME, c.fence, ttl)).pipe(Effect.andThen(Effect.sync(() => (renewed = true)))),
);
ledger = {...seen, lease: (name) => Effect.andThen(renewBack, /* the read as before */ seen.lease(name))};
```

## What the industry does

- **Kafka's producer epoch** ([KIP-98](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging)):
  a transactional producer gets an epoch. A new producer with the same id bumps it, and from then
  on the broker refuses the old one's writes: `InvalidProducerEpochException` when the epoch is
  lower ([ProducerAppendInfo](https://github.com/apache/kafka/blob/trunk/storage/src/main/java/org/apache/kafka/storage/internals/log/ProducerAppendInfo.java)).
  No clock in that check. Rule B is this: `names.fence` is the epoch, and only a claim bumps it.
- **Where Kafka goes further** ([KIP-588](https://cwiki.apache.org/confluence/display/KAFKA/KIP-588%3A+Allow+producers+to+recover+gracefully+from+transaction+timeouts)):
  when a transaction times out, the coordinator bumps the epoch itself, and the producer
  recovers by asking for its id again with its current epoch. The ledger never bumps on a
  timeout. Only a claim does, so a host that is away gets its lane back with no new fence.
- **Fencing tokens** ([Kleppmann, 2016](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)):
  a lease alone is not safe, because a paused client may still write after it ends. The storage
  must check a token on every write. The ledger does. That is why it can let a lease past its end
  write on: the newer claim, not the clock, is what makes a write unsafe. It is also why the gate
  still waits for a live lease: GitHub checks no token.
- **Chubby** ([Burrows, OSDI 2006](https://research.google/pubs/the-chubby-lock-service-for-loosely-coupled-distributed-systems/),
  §2.8): when a client's lease runs out it is in *jeopardy* and waits a *grace period* (45 s by
  default) before it gives up. The host's `away` and its 10 minute `graceMs` are this.
- **Kubernetes leader election** ([client-go](https://pkg.go.dev/k8s.io/client-go/tools/leaderelection)):
  a leader that misses a renew retries every `retryPeriod` (2 s) instead of waiting for the next
  regular one. `retryRenewMs`, 1 s, copies that. Kubernetes then stops the leader at
  `renewDeadline`. Here the fence does the stopping, so a laptop that comes back carries on.

## The lean

**Keep rule B and the patient host. Keep the 30 s lease.**

- **Why.** It does what 149's copy did, now in the real code, with the expiry job at 1 s and one
  rule instead of two graces to keep in step. Blips no longer depend on the lease's length.
- **What it costs.** A name's row carries its newest fence, one new row kind (`lease_resumed`),
  retry loops with no limit in seven places, and a 10 minute grace a person may wait out when a
  laptop is gone for good. The reads that take a blip for "nothing there" are still open.
- **How sure: 85%.** The doubts are 149's: one laptop over loopback, not a real wifi drop, and a
  scripted lane with no 20 minute agent turn. A run over a real interface turned off and on, or a
  cloud ledger, would settle the first.

## Not tested

- **The long offline lane** (149's part 4: an outbox and an upload when back). Still open.
- **An agent's long turn.** The scripted lane steps every 2 s. A 20 minute agent turn that ends
  while away is not tried.
- **TCP's own retransmit backoff, a real interface going down, sleep and wake.** The proxy sends
  held bytes at once.
- **Many lanes on one host during a drop.** One lane a host here.

## What this cannot tell us

- Whether real drops look like `refuse`, `hang` or a mix. 149's part A, the link log, will say how
  often and how long, but not which kind.
- How rule B behaves on Cloudflare's real Durable Object, with its own latency and timeouts.
  Miniflare runs the same code, not the same network.
- Whether a 10 minute grace is the right length. Nothing here comes near it: every drop was over
  in 5 minutes. It only bounds how long a laptop that is gone for good keeps a program running
  that can no longer write.
- 10 runs of 960 broke in the rig, not in the lane, and are left out. In 7 the door refused one of
  the harness's token calls; in 3 a harness call straight to the ledger timed out at 3 s. All 10
  were in hang cells. The cause was not found: the door's answer was not kept. If it is the door
  under load, it is a door bug this experiment did not chase.

## Files

- `151-patient-lease.ts`: the harness. `STEP=blips` (default), `control`, `kill`, `report`.
- `151-patient-lease/lane.ts`, `pool.ts`, `link.ts`: the scripted lane, one host process, and the
  Link machine. The TCP proxy is 149's (`149-wifi-blips/proxy.ts`).
- `results/151-patient-lease.json`: every cell's summary, and the report beside 149's.
- The code: `packages/fabrika/src/host/` (`rules.ts`, `memory.ts`, `host-machine.ts`, `host.ts`,
  `journal.ts`, `supervisor.ts`) and `packages/pipeline/src/` (`asks/ledger.ts`, `asks/claims.ts`,
  `hosted/idempotency.ts`, `hosted/lane.ts`, `hosted/stage.ts`, `hosted/agent.ts`,
  `hosted/sort.ts`).
