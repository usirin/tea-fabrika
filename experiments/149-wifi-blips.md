# 149. What does a wifi blip do to a running lane?

The question: the laptop's wifi drops for 2 s to a few minutes while a lane runs. Does the lane
keep its ticket? Does anything land twice? How long until it works again? And what is the
smallest change that makes a blip a non-event?

**Answer: today a blip often costs a restart, never a double. A clean drop of 2 s restarts the lane
half the time, and 10 s always does: a save gives up after about 1 s, the host stops the lane, waits
out its own lease, then claims it again. The lane is back after 15 to 28 s with a 30 s lease, and
after 4 to 5 minutes with a 5 minute lease. So a longer lease alone makes blips worse, not better.
The smallest change that fixes it is two parts. First, the ledger keeps a lease's fence good until
someone else claims, not only until the lease's end. Second, the host keeps the lane running and
keeps asking, instead of giving up. With both, every drop from 2 s to 5 min, of both kinds, kept
the lane with no restart. It was back in under 1 s at the median and 4 s at worst, over 400 runs. A
killed host's ticket is still free after one lease, as before (26 s median with a 30 s lease).
Across 2,496 runs and about 98,000 late deliveries, nothing landed twice: no fact, no answer, no
outside write. Lean: take both parts, keep the 30 s lease. Confidence 80%.**

```ts
// The whole change, as the copies in 149-wifi-blips/patient/ make it. Sketch of the two rules.

// 1. The ledger (patient/rules.ts): a fence holds while its lease row is there.
//    A claim still takes a lease past its end at once, so a dead host is replaced just as fast.
const fenceHolds = (db, fence) =>
	db.all("SELECT stream FROM leases WHERE fence = ?", fence)[0] !== undefined; // was: AND expires_at > now
// renew: a lease past its end that nobody claimed is renewed, not lost.
if (!lease) return {ok: false, why: "lost"}; // was: if (!lease || lease.expires_at <= now)

// 2. The host (patient/host-machine.ts): no word from the ledger is not a lost lease.
leaseClockOf(s, graceMs)  // the program stops at the lease's end + grace (10 min), not at its end
renew_unknown             // -> {...s, away: true}: the next renew comes in 1 s, not 10 s
renewed                   // -> {...s, away: false, until: max(s.until, m.until)}
// and the lane's own writes (the journal save, a fact, the gate's lease check) wait and resend
// under the same id, with no try limit, instead of giving up after 1 to 2 s.
```

## How it was run

All on this laptop, no deploy, no agent, no model, $0.

- The ledger is its real Durable Object in Miniflare, twice: today's code, and a copy with the one
  rule changed (`149-wifi-blips/patient/rules.ts`).
- A scripted lane (`149-wifi-blips/lane.ts`) runs on `serve`. Every 2 s it writes one fenced fact to
  the plan's inbox under the id `note:<k>`. Every 4th step it posts one comment on a fake code host
  through the pipeline's idempotency gate. It takes the owner's answers, sent every 3 s, once each.
- Host A runs the lane through a small TCP proxy (`149-wifi-blips/proxy.ts`), for both the ledger
  and the code host. Host B, in the `withB` cells, serves the same name straight to the ledger and
  waits.
- At a random point 4 to 14 s in, A's link drops for 2, 10, 30, 60 or 300 s, two ways:
  - **refuse**: every connection is reset and new ones are refused at once (the interface is down).
  - **hang**: nothing moves, sockets stay open, bytes are held and sent when the link is back (wifi
    gone quiet). A request the client gave up on still lands, late.
- 20 runs for each drop, kind and setting. One Durable Object per run. Every run is scored from the
  ledger itself: claims, facts by id, answers in the saved state, and comments counted by key.

The settings:

| Name | Host | Ledger rule | Lease | Renew |
|---|---|---|---|---|
| T30 | today | today | 30 s | 10 s |
| T120, T300 | today | today | 2 min, 5 min | 10 s |
| P30h | patient (the host part alone) | today | 30 s | 10 s, 1 s when away |
| P30, P120 | patient | patient | 30 s, 2 min | 10 s, 1 s when away |

The patient host has a 10 minute grace. A control with no cut (100 runs at the same time) kept every
lane, with no restart, and nothing doubled or missing.

## What a blip does today, and with the change

The lane alone, as it is today (nobody else wants the ticket). "Kept" means no restart: the first
claim lasts the whole run. "Back" is the time from the link coming back until the next new step
lands: the median, and the worst of 20. In the control with no cut, it is 1.0 s and 2.0 s, which is
just the 2 s step pace.

| Drop | Today, refuse | Today, hang | Patient P30, refuse | Patient P30, hang |
|---|---|---|---|---|
| 2 s | 10/20 kept, back 20.3 s (28.0) | 20/20, back 0.0 s (0.1) | 20/20, back 0.4 s (1.0) | 20/20, back 0.0 s (2.0) |
| 10 s | 0/20, back 18.9 s (21.8) | 20/20, back 0.0 s (2.1) | 20/20, back 0.7 s (1.0) | 20/20, back 0.0 s (2.0) |
| 30 s | 0/20, back 2.0 s (2.1) | 0/20, back 2.0 s (2.3) | 20/20, back 0.4 s (0.9) | 20/20, back 0.2 s (4.0) |
| 60 s | 0/20, back 2.1 s (2.1) | 0/20, back 2.0 s (4.6) | 20/20, back 0.7 s (2.9) | 20/20, back 0.0 s (3.1) |
| 5 min | 0/20, back 2.0 s (2.1) | 0/20, back 2.0 s (2.1) | 20/20, back 0.7 s (0.9) | 20/20, back 0.0 s (0.0) |

Doubled, in every cell of this table and every other: 0 facts, 0 answers, 0 outside writes. Missing:
0. Steps redone: 0. No host died.

What each line means, in steps:

- **Today, refuse, short drop.** The journal saves the state before each step. A save that gets no
  answer is sent again 20 times, 50 ms apart, then given up: about 1 s. The program ends as `lost`.
  The host cannot reach the ledger to claim again, so it waits until its own lease runs out (up to
  30 s), claims again under a new fence, and replays. Half of the 2 s drops missed every save, so
  they were kept. Every 10 s drop hit one.
- **Today, hang, short drop.** Each call waits 3 s before it counts as no answer, so 20 tries take
  about 60 s. A 10 s hang fits inside that. This is luck from the timeout, not a design.
- **Today, 30 s or more.** The lease ran out during the drop. When the link is back, A claims at once
  and replays: a restart, back in about 2 s. Alone, nothing worse happens.
- **Patient.** No save gives up and the program never stops. After the link is back, the next renew
  (1 s later) is answered, and the same fence keeps writing. With the old ledger rule (P30h), drops
  under the lease are kept. Drops over it still restart, because the fence fails once the lease's
  end has passed. Both parts are needed.

The longer leases, today's code, alone, refuse: T120 kept 16/20 of the 2 s drops, then restarted
every time, back after 106 s (10 s drop), 87 s (30 s) and 57 s (60 s). T300 was back after 288 s,
269 s and 237 s. A longer lease only makes the wait for a restart longer. P120 kept 20/20 of every
drop length, refuse and hang, back in under 1 s at the median.

## When another host is waiting

Host B serves the same name. Here the lease length is a real trade, and the change does not remove
it. A drop longer than the lease lets B take the ticket, by design: from the ledger, a host that is
away looks the same as one that died.

| Drop | Today T30, refuse | Today T30, hang | P30, both kinds | P120, both kinds |
|---|---|---|---|---|
| 2 s | 8 kept, 7 restart, 5 to B | 20 kept | 20 kept | 20 kept |
| 10 s | 0 kept, 14 restart, 6 to B | 20 kept | 20 kept | 20 kept (18 of 18 under hang) |
| 30 s | 20 to B | 20 to B | 20 to B | 20 kept |
| 60 s | 20 to B | 20 to B | 20 to B | 20 kept |
| 5 min | 20 to B | 20 to B | 20 to B (19 of 19 under hang) | 20 to B |

- Today a short refuse drop gives the ticket to B in about a quarter to a third of runs. A stops its
  own lane, then A and B race for the claim when the lease ends.
- With the change, a drop under the lease is always kept, and a drop over it always goes to B, once.
- After B took over, A's late writes (the hang held them) landed nothing: no extra fact, no
  doubled outside write, and no step done twice by A and B. The fence and the gate's key on the code
  host did their job.

## How long a dead host holds a ticket

Host A is killed with SIGKILL; B waits. The time from the kill until B's lane starts, 20 runs each:

| Setting | Median | Worst |
|---|---|---|
| T30 / P30 | 25.7 s / 26.3 s | 29.2 s / 29.7 s |
| T120 / P120 | 114.0 s / 114.8 s | 119.3 s / 119.0 s |
| T300 | 297.5 s | 300.0 s |

The changed rule frees a dead host's ticket exactly as fast as today: one lease, less the time since
the last renew. Nothing doubled in any kill run.

## What the window's Link would show

A small machine (`149-wifi-blips/link.ts`) turns every ledger call's answer into `live | slow |
away`, as the app would.

- **away** shows 0.3 to 0.8 s after a refuse drop (calls fail fast) and about 3.4 s after a hang
  (the 3 s call timeout).
- **live** comes back 20 to 90 ms after a refuse drop ends. After a hang it takes 2 to 4 s, and in
  about 9 of 10 hang runs the Link passed through **slow** on the way: the held calls land with long
  times and lift the p99. That is a false "slow" after every hang. The fix is to count only calls
  sent after the last answer, not ones that waited out the drop.

## The doorbell

The live tail's WebSocket doorbell has no ping or heartbeat.

- Under **refuse** it was reset, and opened again within its 100 ms retry once the link was back (2
  sockets before, 2 more after, in nearly every run).
- Under **hang** the 2 sockets stayed open for the whole drop, 5 minutes included, and were used again
  after. The doorbell never knew. Nothing was lost, because `tail` reads the ledger every 1 s anyway.
  But a doorbell on a dead socket rings nothing. On a real network, a socket kept through a long hang
  may also be closed by the OS or a router, which this proxy does not model.

## What the industry does

- **Chubby** ([Burrows, OSDI 2006](https://research.google/pubs/the-chubby-lock-service-for-loosely-coupled-distributed-systems/),
  §2.8): a session lease (12 s by default). When the client's local lease runs out, it is in
  *jeopardy*: it empties its cache and waits a *grace period*, 45 s by default. If a KeepAlive gets
  through in time, the session is safe and nothing restarts. Locks carry a *sequencer* (a fence)
  that servers check (§2.4). The patient host is this: jeopardy is `away`, and the grace is
  `graceMs`. One difference: Chubby's server holds the session through the grace. Here B may claim
  after one lease, and the fence makes that safe.
- **Kubernetes leader election** ([client-go](https://pkg.go.dev/k8s.io/client-go/tools/leaderelection),
  [kube-controller-manager flags](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/)):
  `leaseDuration` 15 s (others wait this long before taking over), `renewDeadline` 10 s (the leader
  retries this long, then stops leading), `retryPeriod` 2 s (time between tries). The leader keeps
  retrying every 2 s instead of waiting for its next regular renew. `retryRenewMs` copies that.
  Kubernetes then stops the leader, which suits a server in a rack. A laptop that comes back
  after a minute wants to carry on, so the fence does the stopping, not the clock.
- **etcd leases** ([API](https://etcd.io/docs/v3.5/learning/api/#lease-api)): a lease with a TTL,
  kept alive by a stream. Keys attached to it go when it expires. Same shape as today's rule:
  expiry is final.
- **Kafka** ([KIP-98](https://cwiki.apache.org/confluence/display/KAFKA/KIP-98+-+Exactly+Once+Delivery+and+Transactional+Messaging)):
  a producer's epoch is bumped only when a new producer with the same id starts. That fences the
  old one, whatever time it is. A producer id plus a sequence number drops resent batches. That is
  the changed rule: fence on "someone newer claimed", not on the clock. Ids on every write make a
  resend safe.
- **Fencing tokens** ([Kleppmann, 2016](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)):
  a lease alone is not safe, because a paused client may still write after it ends. The storage
  must check a token. The ledger checks the fence on every write. That is why it can let an expired
  lease write on until someone else claims: the claim, not the clock, is what makes a write unsafe.

## The lean

**Take both parts. Keep the 30 s lease.**

- **Why.** Alone, which is how a lane runs today, every drop up to 5 minutes, of both kinds, kept the
  lane with no restart and came back in about a second. A dead host's ticket is freed as fast as
  before. With a second host waiting, a drop under the lease is kept, and one over it hands the ticket
  over cleanly, once. Nothing doubled in any run.
- **What it costs.** A few dozen changed lines in `rules.ts` and `host-machine.ts`. Three retry loops
  also lose their limits: the journal save, `steady()` in the pipeline's ledger calls, and the
  gate's lease check. A program that waits forever needs a way out that a person can see: the grace
  (10 minutes) ends it. Plus the false "slow" fix in `Link`.
- **Lease length.** A longer lease only matters when a second host waits. P120 kept 60 s drops with B
  waiting, but a dead host then holds its ticket for 2 minutes. Pick the lease for "how long may a
  dead laptop block a teammate", not for blips. Blips no longer depend on it.
- **How sure: 80%.** The doubt: everything here is one laptop over loopback. A real wifi drop is a
  mix: new connections fail fast while old sockets hang, with TCP's own retransmit backoff on top. A
  run over a real interface turned off and on (or a cloud ledger, after experiment 144) would settle
  it. The second doubt is that the scripted lane does not do an agent's long steps: a 20-minute agent
  turn that ends while away is not tested.

## Part A: how often does the link really drop?

`149-wifi-blips/link-log.ts` turns the link logger's lines plus `pmset -g log` into counts only:
hours awake, drops a day, drop length (median, p95), and how often Cloudflare had no answer while
Anthropic did. It never prints a time or a log line.

On what there is now: 249 samples, 0.7 hours awake, **0 drops**, 0 Cloudflare-down-Anthropic-up.
That is far too little to say anything. Re-run it after a few days of logging; the counts it gives
are the ones to publish.

## Not tested

- **The long offline lane** (part 4: a checked-out lane with an outbox and a fast-forward upload).
  Not tested. The five cases in the brief are still open.
- **The tracker's `saving`.** Read, not run: on a failed save it marks the write `failed` and drops
  it, with no retry. That goes against the direction ("writes wait"). Its `file` takes a number before
  it sends, so a lost answer can leave an empty ticket number.
- **`steady()` dying.** In code, the pipeline's `sendFact` and `appendFact` die after 40 × 50 ms (about
  2 s under refuse) with a string the host does not count as a lost lease. In these runs the journal
  always gave up first, so it never showed. A lane whose step writes facts right before a drop could
  still meet it.
- **TCP retransmit backoff, real interfaces, sleep and wake.** The proxy sends held bytes at once.
- **Answers while away.** The owner's answers kept coming during drops (they go straight to the
  ledger), and none was taken twice. A person answering *from* the laptop that is away was not
  tried.

## What this cannot tell us

- Whether real drops look like `refuse`, `hang` or a mix. Part A's counts will say how often and how
  long, but not which kind.
- How the change behaves on Cloudflare's real Durable Object, with real latency and its own
  timeouts. Miniflare runs the same code, but not the same network.
- What happens with many lanes on one host during a drop. Up to 100 ran at once per host here, all
  with a cheap step. An agent host does more per step.
- Four runs of 2,500 failed in the rig, not in the lane: three harness calls straight to the ledger
  timed out under load, and one port was taken. They are left out.

## Files

- `149-wifi-blips.ts`: the harness. `STEP=blips` (default), `control`, `kill`, `report`.
- `149-wifi-blips/lane.ts`, `pool.ts`, `proxy.ts`, `link.ts`: the lane, a host process, the TCP proxy,
  and the Link machine.
- `149-wifi-blips/patient/`: copies of `rules.ts`, `durable-object.ts`, `journal.ts`, `host-machine.ts`,
  `host.ts` (cut to `serve`) and the gate, each with a header and "149" marks on what changed.
- `149-wifi-blips/link-log.ts`: part A.
- `results/149-wifi-blips.json`: every cell's summary.
