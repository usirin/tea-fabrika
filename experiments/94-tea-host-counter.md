# 94. A tea-host counter survives its host dying

The question: tea-host's first test ([tea-host](../docs/direction/tea-host.md)).
Three hosts share one ledger. A `counter` tea program, registered as
`counter:1`, runs on exactly one of them at a time. Two senders send it
increments while its host is killed, frozen, and woken late. Does the count
end at exactly the number sent, with every message counted once, and is
every write of a host that lost its place refused?

**Answer: yes, on every run. Three runs of 1,000 increments (2 SIGKILLs and
2 frozen owners each) and one of 10,000 (3 SIGKILLs and 2 frozen owners):
the count ended at exactly 1,000 and 10,000, every message id counted
once, and a fold of the ledger from scratch gave the live owner's final
state. Two hosts never both had a write accepted while both believed they
owned the name. All 16 writes from frozen owners after they woke were
refused: 8 by the rev check (another host had claimed since) and 8 by the
fence alone (nobody had claimed yet). Each frozen owner noticed it had lost
within 4 to 16 ms of waking and stopped the program within 7 to 17 ms.
Takeover after a SIGKILL takes what is left of the lease (ttl 1 s) plus
3 to 8 ms for the claim and 17 to 91 ms more for the first counted message.
A send (one ledger append over HTTP) takes 1.5 ms at p50 and 5 to 7 ms at
p99 locally. The counter catches up at 1,000 to 3,000 messages a second
after a takeover. One real bug found on the way: tea's default error sink
throws a refused final save on a timer, which killed the whole host
process; every run on a fenced store needs its own `onError`. Confidence
80%.**

```ts
// The whole idea: a host is one tea machine per registered name.
watching --claim_due | seen_expiry-->  claiming --claimed-->  owning(fence)
owning   --renew_lost | seen_claim(newer) | seen_expiry(own) | program_ended-->  watching
// The program is a Sub of `owning`: leaving owning stops it. No state runs it without owning.
// Its every save is one fenced, compare-and-set append to registry/counter:1.
// A send is one append to counter:1/inbox with a message id; the mailbox skips repeated ids.
```

## Who did what

- **The ledger:** experiment 93's `Ledger` Durable Object, unchanged
  (`93-ledger/worker.ts`, `sql.ts`). `94-tea-host/daemon.ts` runs it in
  Miniflare on workerd's direct socket (`unsafeDirectSockets`), its data in
  a temporary folder. The harness starts it in its own process group and
  stops the group, and restarts it when workerd passes a memory cap (500 MB
  by default), as the [sync engine note](../docs/direction/a-local-first-sync-engine.md)
  decided.
- **The ledger client (`94-tea-host/ledger.ts`):** an Effect service over
  the ledger's HTTP face, one keep-alive pool of 8 sockets, every answer
  decoded with a Schema, a 3 s timeout. A network error is
  `LedgerUnreachable`, which never says whether a write landed.
- **The counter (`94-tea-host/counter.ts`):** a tea machine (`count`,
  `cursor`, `last`) and a tea program (`defineProgram`) that runs it on a
  `Journal` it is given. It knows nothing of hosts or leases.
- **The journal (`94-tea-host/store.ts`):** a tea `FencedStore` whose save is
  one append to `registry/counter:1` naming the rev it last saw and the
  host's fence. A refusal is tea's `StoreConflictError`. A save whose answer
  never came re-reads the stream end to see if it landed.
- **The host machine (`94-tea-host/host-machine.ts`):** a tea machine with
  three phases. Its Cmds are `claim` and `renew`; its Subs are two clocks,
  the registry tail and the program itself.
- **The host (`94-tea-host/host.ts`):** a process that runs the host machine
  for one name and gives it the ledger. Its program Sub replays (last saved
  state, then the inbox folded with repeated ids dropped), starts the counter
  and feeds it the inbox's tail. A small pause detector logs when the
  process was frozen; it decides nothing.
- **The sender (`94-tea-host/sender.ts`) and attach (`94-tea-host/attach.ts`):**
  a sender appends `COUNT` increments to the inbox at a fixed rate; attach
  prints who holds `counter:1`, its fence and the count, and writes nothing.
- **The laws (`94-tea-host/laws.ts`):** both machines through the repo's
  checker (`wip/src/laws/explore.ts`).
- **The harness (`94-tea-host-counter.ts`):** the runs, the faults and every
  check below. Node at the edge only: process groups, signals, `ps`.
- No model, no key, no network beyond 127.0.0.1. $0. One laptop (Apple
  silicon, macOS), Node 26.12, miniflare 4.20260730.0.

## The run

Each run: a fresh ledger, three hosts (`host-a`, `host-b`, `host-c`), two
senders (`s1`, `s2`), each sending half the increments with ids `s1-1`,
`s1-2`, ... A sender "loses" the answer to 2% of its sends on purpose and
sends the same id again, so the inbox holds real repeats. Lease ttl 1 s,
renewed every 250 ms. Five faults, 3.5 s apart, all while the senders are
still sending:

| Fault | What the harness does | What must happen |
|---|---|---|
| kill (2, or 3 on the large run) | SIGKILL the owner's process group; a fresh host starts 300 ms later | another host claims at the lease's end, replays, goes on |
| zombie | SIGSTOP the owner for 2.5 s, wake it after another host took over | its late writes refused; it notices and stops the program |
| alone | SIGSTOP the owner and every other host; wake the owner alone 300 ms after its lease ended | nobody has claimed, so the rev still matches: only the fence can refuse it |

Then the harness waits for the count to cover every id in the inbox, reads
the whole ledger and checks.

## Acceptance

| Check | small 1 | small 2 | small 3 | large |
|---|---|---|---|---|
| Increments sent (distinct ids) | 1,000 | 1,000 | 1,000 | 10,000 |
| Repeats in the inbox (skipped) | 26 | 19 | 22 | 170 |
| Final count | 1,000 | 1,000 | 1,000 | 10,000 |
| Every id counted exactly once (from the chain of saved states) | yes | yes | yes | yes |
| Every saved state under the latest claim's fence | yes | yes | yes | yes |
| Fold from scratch = live owner's final state | yes | yes | yes | yes |
| Late writes from frozen owners accepted | 0 of 4 | 0 of 4 | 0 of 4 | 0 of 4 |
| Two believing owners both with an accepted write | never | never | never | never |
| A host process crashed (other than the killed ones) | no | no | no | no |

How "never two writing owners" is checked: from each host's own log, the
spans when it believed it owned the name; for every pair of overlapping
spans of two hosts, the ledger's accepted saves by each inside the overlap.
Hosts did believe together, about 1.85 s a run: a frozen owner cannot know
it lost. In every overlap only one of them had writes accepted.

One side run with the memory cap set low (`CAP_MB=100`): workerd passed it
mid-run and was restarted in 371 ms. The owner saw two renews with no
answer, kept its lease (ttl 1 s), and went on; the senders saw 14 errors
and sent the same ids again. Every check passed. The default cap (500 MB)
was never reached: workerd ended at 120 MB on the small runs and 332 MB on
the large one.

## Measures

| Measure | small (3 runs) | large |
|---|---|---|
| Send: one append, p50 / p99 | 1.5 / 5.2 to 6.6 ms | 0.6 / 3.0 ms |
| Send: until accepted (with `stale` retries), p50 / p99 | 2.5 / 10.3 to 11.2 ms | 1.1 / 5.6 ms |
| Appends refused `stale` (the two senders race the inbox's rev) | 42 to 43% | 41% |
| Lease left at the fault | 910 to 955 ms | 937 to 984 ms |
| Claim by another host after a kill or a zombie freeze (ttl 1,000 ms) | 925 to 962 ms | 941 to 967 ms |
| That claim after the lease's end | 3 to 7 ms | 3 to 8 ms |
| First counted message after the fault | 942 to 1,005 ms | 964 to 1,058 ms |
| Replay at start (read registry and inbox, fold) | 10 to 32 ms | 16 to 72 ms |
| Catch-up after a takeover, messages a second | 1,040 to 2,280 | 2,240 to 2,960 |
| Live rate (the send rate) | 50 a second | 300 a second |
| Frozen owner: noticed it lost, after waking | 4 to 6 ms | 9 to 16 ms |
| Frozen owner: program stopped, after waking | 7 to 8 ms | 14 to 17 ms |
| workerd RSS at the end | 120 MB | 332 MB |
| The ledger's Node process (Miniflare) | 158 to 171 MB | 171 MB |
| Each host process | 203 to 233 MB | 223 to 324 MB |

"Catch-up" is the backlog a new owner finds (47 to 66 messages on the small
runs, 287 to 416 on the large) over the time it took to count them. Each
message is one tea dispatch and one fenced append over HTTP, so this is the
counter's real top speed here; the live rate only follows the senders.

The "alone" fault's claim comes later (1.27 to 1.35 s): every other host is
still frozen, so the woken owner claims again itself once it sees it lost.

## The laws

Run by the harness, in the style of [every machine has laws](../docs/direction/every-machine-has-laws.md):
every Msg order to a bound through the real reducers, each law after every
step, each law seen to fail once on a planted mistake.

| Machine | Law | Planted mistake it caught |
|---|---|---|
| host | the program runs only under the claim this host won last | told the name is held, runs the program anyway |
| host | losing the lease stops the program | ignores a `renew_lost` |
| host | it renews only the fence it holds | renews the first fence it ever held |
| host | it claims only while it holds nothing | claims again on any expiry it sees while owning |
| host | word about another fence changes nothing | a `renew_lost` about any fence stops the owner |
| host | while the program runs, the lease is renewed | the renew clock waits for the program to say it started |
| counter | the cursor never goes back | the cursor follows each message |
| counter | a message at or behind the cursor changes nothing | counts repeats |
| counter | each message counts once, exactly when it moves the cursor | counts twice |
| counter | the state names the message counted last | names the first id it counted |

Host: 370 states at depth 10, 15 ms, every Msg type sent; not complete,
because the renew tick and the claim tries are counters that grow without
end. Counter: 13 states, complete. All 10 laws hold; all 10 planted
mistakes caught.

The law that matters most is a shape, not a check: the program is a Sub of
`owning`. tea turns a Sub off when the state stops asking for it, so a host
that left `owning` cannot still be running the program. There is no state
to write that does. (Elm: something that stays open is a Sub.)

## What went wrong, and surprises

- **The frozen owner's whole host died, on the first run.** When it lost,
  its program stopped, and tea's run flushed its final state on the way
  out. The fence refused it (correctly), but that save has no caller to
  fail, so it went to tea's default `onError`, which throws it on a timer.
  The process exited. Fixed here by making `onError` part of the `Journal`
  service the counter needs, so a host cannot start the program without
  saying where those errors go; the host logs them (`tea_error`,
  `phase: stop-save`) and goes on watching. Every run on a fenced store
  will hit this the first time it loses.
- **The fence almost never did the refusing.** A takeover always appends a
  claim to the same stream, so the frozen owner's next save names a rev
  that is no longer the end and is refused `stale` before the fence is
  looked at. The fence alone refuses only between the lease's end and the
  next claim. The "alone" fault was added to hit that window on purpose,
  and it did: 8 of 8 refused `fenced`.
- **A harness mistake looked like a slow host.** With faults spaced by
  fraction of the send time, the "alone" fault froze every host about 1 ms
  after the zombie had been woken, and the zombie seemed to need 1.5 s to
  notice. The pause detector showed the second freeze. Faults are now
  3.5 s apart, one over before the next.
- **No `lease_expired` event was ever written.** Hosts claim by their own
  clock at the lease's end, well inside the alarm's 1 s grace, so the
  alarm found nothing to do. The tail's `seen_expiry` path ran only in the
  laws.
- **Hosts are heavy:** 200 to 330 MB each for Node, Effect, tea and an HTTP
  pool, the owner the largest.

## What this means

- **The registry: a lease on `registry/<name>` is OTP's registered name.**
  It worked with no other registry. One finding for the ledger: 93's fence
  guards only the lease's own stream (`leases.stream = ?1`), so the
  program's progress had to go on the registry stream itself. That works,
  but it puts one event per message on the stream every host watches.
  Recommendation: let a lease guard a stream prefix (`counter:1/*`), so
  progress gets its own stream under the same fence. Why: the fence then
  covers what the program writes, wherever. Tradeoff: one more rule in
  `sql.ts` and its laws. Confidence 75%.
- **The supervisor: no supervisor host is needed.** Every host runs the
  same machine, watches the registry, and claims at the lease's end; the
  ledger's compare-and-set picks one. Takeover is the lease's ttl plus
  about 20 to 90 ms. A shorter ttl buys a faster takeover for more renew
  traffic (4 renews a second per owned name at 250 ms).
- **The send path: a ledger append with a message id is enough for test 1.**
  p99 under 7 ms locally, far below the 50 ms line in
  [tea-host](../docs/direction/tea-host.md) (a deployed ledger is not
  measured here). Replay and takeover came for free, as that note leaned.
  Two changes the ledger wants for a mailbox: an "append at the end"
  (today an append must name the rev, so senders race and 41% of tries
  come back `stale`), and a tail of one stream (today a host reads the
  whole log, every stream, to watch one).
- **tea stays small.** Nothing here needed a change to tea. The one rule
  for tea-host: every run gets an `onError`, enforced by the service shape,
  not by a note.

## What this does not show

- **One laptop, one machine's clock.** No network between hosts, no
  partitions, no clock skew. The overlap check compares host and ledger
  times from the same clock.
- **Not a deployed ledger.** Every latency is workerd on 127.0.0.1.
- **Only the owner was faulted.** Senders were not killed, and the ledger
  was restarted only by the memory cap (once, in the side run), not killed.
- **Three hosts and one name.** Many names per host, and many hosts racing
  for many leases, are not tested.
- **Sender ids are unique by construction.** A real sender must mint ids
  that stay unique across its own restarts.
- **The host machine's laws are bounded**, not complete (370 states at
  depth 10).

## How to run it

```sh
node experiments/94-tea-host-counter.ts
# ONLY=laws|runs, RUNS=small,small,small,large (small: 1,000 increments, 2 kills; large:
# 10,000, 3 kills; each with both frozen owners), TTL_MS=1000, RENEW_MS=250, STOP_MS=2500,
# RESTART_MS=300, CAP_MB=500, DUP_RATE=0.02, HOST_DEPTH=10, KEEP_LOGS=<a folder>,
# SAVE_AS=runs. About 2 minutes. The memory-cap side run is
# CAP_MB=100 RUNS=small ONLY=runs SAVE_AS=capRuns.
# No key, no model, no network beyond 127.0.0.1. Leaves nothing behind: each run makes its
# own temporary folder, stops every process group it started, and removes the folder.
```
