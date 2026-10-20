# 96. The ledger as a mailbox

The question: experiment 94 ran a tea-host counter on experiment 93's ledger
and found three gaps. A lease guarded one stream only, so the program's
progress had to share the registry stream every host watches. A host had to
read the whole log to follow one stream. And two senders raced on the
inbox's rev, so 42% of sends came back `stale`. Can the ledger close all
three, and does 94's counter test still hold on it?

**Answer: yes. All three gaps are closed, and 94's counter test passed on
every run: three runs of 1,000 and one of 10,000, the owner SIGKILLed twice
(three times on the large run), one owner frozen past its lease, and one
woken alone. The count ended at exactly 1,000 and 10,000, every id counted
once, replay equalled live, and two owners never both had a write accepted.
All 10 late writes from frozen owners were refused, and every one by the
fence, `alone` included. Sends never came back `stale` (94: 42%). A watching
host now reads about 1.2 KB a run to follow the registry (94: about 310 KB),
because progress lives on `counter:1/state`, under the same lease. A send's
p99 fell from 10 to 11 ms to 5 to 6 ms. Takeover time did not change: it is
the lease's ttl. One real bug was found and fixed on the way: a fenced write
must check the fence before the message id. Confidence 80%.**

| Measure (small runs; large run in brackets) | 94 | 96 |
|---|---|---|
| Sends refused `stale` | 42 to 43% (41%) | 0 (0) |
| Registry events per message | 1.01 (1.00) | 0.005 (0.001): claims only |
| Events a watching host reads per message | 2.03 (2.02) | 0.006 (0.001) |
| Bytes a watching host reads per run | about 310 KB (3.1 MB), estimated | 1.2 KB (1.5 KB) |
| A watcher's reads a second | the whole log | 1 to 1.2 (1.1) |
| Send until accepted, p50 / p99 | 2.5 / 10.3 to 11.2 ms (1.1 / 5.6) | 1.2 to 1.5 / 4.8 to 5.7 ms (0.6 / 2.4) |
| One append, p50 / p99 | 1.5 / 5.2 to 6.6 ms (0.6 / 3.0) | 1.2 to 1.4 / 4.2 to 5.2 ms (0.6 / 2.4) |
| Claim after the lease's end | 3 to 7 ms (3 to 8) | 3 to 6 ms (2 to 4) |
| Claim after a kill or freeze (ttl 1 s) | 925 to 962 ms (941 to 967) | 944 to 989 ms (927 to 971) |
| First counted message after the fault | 942 to 1,005 ms (964 to 1,058) | 952 to 1,005 ms (936 to 978) |
| Replay at start | 10 to 32 ms (16 to 71) | 3 to 8 ms (3 to 5) |
| Catch-up, messages a second | 1,042 to 2,182 (2,244 to 2,961) | 1,297 to 1,923 (1,986 to 2,285) |
| Late writes of frozen owners refused | 8 `stale`, 8 `fenced` | 10 `fenced` |
| workerd at the end | 120 MB (332 MB) | 97 to 99 MB (191 MB) |

94 kept no byte counts. Its bytes are 96's row sizes (the new `id` key left
out) times 94's event counts. In 94 a watcher read every event: inbox,
states, claims.

```ts
// The whole change, as a program sees the ledger.
streams("counter:1") = { registry: "counter:1", state: "counter:1/state", inbox: "counter:1/inbox" }
claim("counter:1", host, rev, ttl)            // the lease; its pos is the fence
append("counter:1/state", rev, state, fence)  // checked against the lease on "counter:1"
send("counter:1/inbox", id, msg)              // at the end, deduped by id; never stale
readLast("counter:1/state", 1)                // replay: the last state, then the inbox from its cursor
tail(stream, fromRev)                         // a read per wake-up; wake-ups carry no data
```

## What changed in the ledger

The ledger is a copy of 93's (`96-ledger-mailbox/sql.ts`, `ledger.ts`), each
file headed with what changed.

- **A lease guards a prefix.** A lease on `p` guards `p` and every stream
  under `p/`. It does not guard a sibling such as `p0` or `px`. A fenced
  append to `p/state` is checked against the lease on `p`. This is etcd's
  lease on a key prefix, with Kleppmann's fencing token. The fence is the
  claim's `pos`, which names exactly one lease, so the check needs no
  longest-prefix search. In SQL it is a range, which an index can use:
  ```sql
  stream = p OR (stream >= p || '/' AND stream < p || '0')
  ```
- **Fence before id.** A fenced append checks the fence first, then the
  message id, then the rev. Kafka does the same: it checks the producer
  epoch before the sequence number. Without this a writer that lost its
  lease hears `dup` (ok) for a repeat of a write that landed earlier. See
  the failure below.
- **Append at the end.** `append` takes `expected: number | "any"`. This is
  EventStoreDB's `ExpectedRevision.Any`. An event may carry an `id`. A second
  append of the same id to the same stream writes nothing and answers with
  the first one's place, `dup: true` (EventStoreDB's event id; Kafka's
  idempotent producer). Migration 3 adds the `id` column and
  `UNIQUE (stream, id) WHERE id IS NOT NULL`. Claims and fenced state keep
  the compare-and-set.
- **Reads.** `readStream(stream, fromRev, limit)` reads one stream forwards.
  `readLast(stream, n)` reads its last `n` events, as EventStoreDB reads
  backwards. `read(fromPos, limit, prefix)` filters the whole log by prefix.
- **The live tail.** `GET /<ledger>/tail?stream=..&prefix=..` opens a
  WebSocket the Durable Object holds through its hibernation API (Miniflare
  supports it on the direct socket). After each write the DO sends
  `{stream, rev, pos}`, with no event in it, to every socket watching that
  stream or a prefix of it, once per socket. The client (`tail.ts`, on
  Effect's `Socket`) is EventStoreDB's catch-up subscription. It reads
  `readStream` from its cursor on every wake-up, on every reconnect, and
  every second anyway. So a lost or doubled wake-up costs at most one read.
  It dies if an event is not the one after its cursor.
- **The mailbox send.** The service has `send(stream, id, event)`: an append
  "any" whose id is required, so a sender cannot forget it.

Long-polling was set aside: the [sync engine note](../docs/direction/a-local-first-sync-engine.md)
already chose sleeping WebSockets for the live tail.

## The counter test, again

The run is 94's. Three hosts and two senders. Each sender sends the same id
again for 2% of its sends on purpose. Five faults, 3.5 s apart: kill, kill
(and a third on the large run), zombie (frozen 2.5 s, woken after a
takeover), alone (every host frozen, the owner woken alone 300 ms after its
lease ended). 94's counter, host machine and laws run unchanged. The store,
host, sender and attach are copies; each says what changed.

| Check | small 1 | small 2 | small 3 | large |
|---|---|---|---|---|
| Final count | 1,000 | 1,000 | 1,000 | 10,000 |
| Every id counted exactly once | yes | yes | yes | yes |
| Repeats sent / answered `dup` / in the inbox | 26 / 26 / 0 | 19 / 19 / 0 | 22 / 22 / 0 | 170 / 170 / 0 |
| Fold from scratch = live final state | yes | yes | yes | yes |
| Late writes of frozen owners accepted | 0 of 2 | 0 of 2 | 0 of 2 | 0 of 4 |
| `alone` refused by the fence | yes | yes | yes | yes |
| Two believing owners both with an accepted write | never | never | never | never |
| Registry stream holds only claims | 5 | 5 | 5 | 6 |
| A host process crashed | no | no | no | no |

The host now keeps no set of seen ids: the ledger dedupes. Replay reads the
last state with `readLast`, then tails the inbox from that state's cursor.
A save's id is `<fence>:<cursor>`, so a save whose answer was lost is just
sent again. The owner tails the inbox: about 82 KB for 590 messages, 140
bytes each. Each frozen owner noticed it had lost 3 to 13 ms after waking
and stopped the program 4 to 15 ms after.

The "alone" claim comes 360 ms after the lease's end, as in 94: every other
host is still frozen, so the woken owner claims again itself.

## The laws

93's laws 1 to 6 run unchanged against the new ledger (every API change is
additive). Then the new laws, all PASS:

- **11a.** 50 appends "any" at once on one stream: ok 50, revs 1..50, no
  gaps, no `stale`.
- **11b.** One id appended 50 times at once, then once later, then once with
  a stale rev: one row; ok 1, dup 51. The same id on another stream lands.
- **11c.** After a SIGKILL of Miniflare, 40 sends whose answers the kill
  swallowed were sent again with their ids: 26 ok, 14 dup, no id twice.
- **12.** A lease on `p` guards `p/*` and nothing else. An old fence is
  refused under the prefix after a reclaim and alone (before anyone
  reclaims, while the rev still matches). A repeat of a landed save under
  the old fence is `fenced`; under the live fence it is `dup`. Siblings
  `p0/state` and `px` are refused. A fence that is no lease is refused.
- **13.** A live tail of one stream across 5 SIGKILLs of Miniflare (a child
  process, as 93's law 7): 23,237 events, revs 1..23,237 handed on each
  once, in order, the same events as the stream. 6 connects, 3,291 reads,
  22,972 wake-ups.
- **14.** Reads from a rev, the last `n`, and under a prefix return exactly
  what they name. Siblings are left out.
- **15.** A write wakes watchers of its stream and of its prefixes, once
  each, and no others. A repeated id wakes nobody. 11 tags are refused.

Also: 93's law 7 (5 SIGKILLs, 23,237 acknowledged, lost 0, no gaps, the
alarm fired alone 5 of 5, restart 199 to 307 ms), law 8 (two processes race
claims: one winner on every ticket), law 10 (the `.sqlite` file holds the
`id` column and migration 3), and 94's host and counter machine laws (10
hold, 10 planted mistakes caught). Law 9 runs 1, 2a, 2b, 3, 5, 6, 11a, 11b,
12 and 14 on node:sqlite with 8 threads on one file: all PASS, so the new
SQL is portable.

The tail's wake-up latency, write to handed-on: p50 3.6 ms, p99 7.6 ms over
200 events, one read per wake-up.

## What went wrong, and surprises

- **The first run failed: a zombie heard `dup` and thought its save
  landed.** Both frozen owners' only late write was tea's stop-flush,
  re-saving a state it had already saved (same id). The ledger checked the
  id first and answered `dup` (ok). Nothing new was written, so the count
  stayed right. But the zombie was told its write was accepted after it had
  lost. Kafka checks the epoch before the sequence for this reason. Fixed:
  the fence comes first. Law 12 now holds it. That run is kept in the
  results as `firstRun`.
- **The judge first called an in-flight save "late".** A save sent just as
  the freeze came landed while the lease held, and its answer arrived after
  the wake. The judge now asks the ledger's clock: a write is late only if
  its row is missing or was written after the lease's end.
- **Prefix fencing made `stale` rare for zombies.** In 94 a takeover's
  claim moved the registry stream, so the zombie's next save was refused
  `stale`. Now progress is on `state`, and the fence answers first, so
  every late write is `fenced`.
- **tea's refused save reads oddly.** The store maps `fenced` to tea's
  `StoreConflictError`, whose message says "expected version 413, found
  413". tea's store error has no fenced case.
- **One host printed a `RuntimeDiscardedError` on the way out** (small run 1):
  the harness stopped it with one host-machine Cmd in flight. Nothing was
  lost. The host machine's own run, like the program's in 94, wants an
  `onError` that ignores the `discard` phase.
- **At the end of every run the live owner's stop-flush repeats its last
  save**, and the ledger answers `dup` and writes nothing. Dedupe makes
  that free.

## What this means for the ledger tea-host gives programs

- **The `Ledger` service gains `send`, append "any", `readStream`,
  `readLast` and a tail.** Programs see `streams(name)`: the registry (the
  lease), `name/state` (fenced) and `name/inbox` (open to senders).
  Recommendation: make this the shape tea-host gives programs. Why: it fixed
  all three gaps with no change to tea or to the counter. Tradeoff: one more
  column, a unique index and a WebSocket endpoint on the DO. Confidence 80%.
- **A fenced write checks the fence before the id.** Make this a law of the
  ledger, not a detail. Without it a lost owner can be told its write
  landed. Confidence 90%.
- **Not enforced: unfenced writes under a leased prefix.** The inbox has to
  be open to senders, so the ledger still accepts an unfenced append to
  `counter:1/state`. Only the host's code keeps state writes fenced. A
  later step could let a lease name which children need its fence.
- **tea-host's tail wants a prefix client too.** The DO already wakes
  prefix watchers (law 15); no client follows a prefix here.
- **Takeover stays the lease's ttl.** Nothing here makes it faster; a
  shorter ttl does, at more renew traffic.

## What this does not show

- **One laptop, one clock.** No network between hosts, no partitions, no
  clock skew.
- **Not a deployed ledger.** Every latency is workerd on 127.0.0.1, and the
  hibernation API ran in Miniflare, not on Cloudflare.
- **The DO never hibernated with sockets open long enough to evict.** Law 13
  kills the process; it does not test a real hibernation and wake.
- **One name, three hosts.** Many names per host and many prefixes are not
  tested.
- **94's byte counts are estimates**, made from 96's row sizes.
- **Unfenced writes to a fenced child are allowed** and nothing here tries
  them.

## How to run it

```sh
node experiments/96-ledger-mailbox.ts
# ONLY=laws|kill|hosts|node|file|machine|runs (default all), KILLS=5,
# RUNS=small,small,small,large, TTL_MS=1000, RENEW_MS=250, STOP_MS=2500, RESTART_MS=300,
# CAP_MB=500, DUP_RATE=0.02, HOST_DEPTH=10, KEEP_LOGS=<a folder>, SAVE_AS=runs.
# About 15 minutes for everything. No key, no model, no network beyond 127.0.0.1.
# Leaves nothing behind: each part makes its own temporary folder, stops every process
# group it started, and removes the folder.
```
