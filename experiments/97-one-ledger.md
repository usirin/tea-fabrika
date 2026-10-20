# 97. One ledger

The question: experiments 95 and 96 each grew their own copy of experiment
93's ledger. 95 added `fenceOn`, so a reply into another program's inbox
could be fenced on the replier's own lease. 96 added a prefix lease, append
"any" with a message id, reads of one stream and a live tail. Both left one
rule open: an unfenced write to `counter:1/state` lands, lease or not. Can
the two copies become one ledger, with that rule closed, and do both tests
(94's counter, 95's agents across hosts) still pass on it?

**Answer: yes. One ledger in `97-one-ledger/` passes both tests on every
run, with the faults and pass checks unchanged: 94's counter (three runs of
1,000, one of 10,000) and 95's agents across hosts with stub agents (three
runs of 200 questions, one of 2,000, answerer in Docker). The two fence
ideas were one idea: a fence is a claim's `pos`, so it already names its
lease, and `fenceOn` only repeated that. It is gone; one rule says where a
lease's fence may write: its name, every stream under it, and any inbox.
The open rule is closed: once a name has been claimed, an unfenced write
under it is `denied`, live lease or not; only a stream ending in `/inbox`
stays open to anyone. 93's and 96's laws all still hold, the three new ones
hold, on the Durable Object in Miniflare (in process and across 5 SIGKILLs)
and on node:sqlite, and each of 7 planted mistakes is caught. Numbers are
96's for the counter. The agents test got much faster with no faults
(round trip p50 3 ms, p99 7 ms; 95: 11 and 20 to 21), because hosts tail
instead of polling, and 2 to 3% slower with faults (see below). Confidence
80%.**

```ts
// The whole ledger, as a program sees it (the Effect service is further down).
claim("counter:1", host, rev, ttl)              // the lease; its pos is the fence. Marks the name claimed, for ever.
append("counter:1/state", rev, state, fence)    // only this fence, only while its lease is live
append("counter:1/state", rev, state)           // denied: a claimed name's stream, no fence
send("counter:1/inbox", id, msg)                // anyone, no lease; deduped by id
send("asker:1/inbox", id, reply, myFence)       // a reply: lands while MY lease is live, fenced after
```

## The two tests, side by side

Small runs; the large run in brackets. 94, 96 and 95 are their saved
results files, read by this harness.

| Measure | 94 | 95 | 96 | 97 |
|---|---|---|---|---|
| Counter runs passed | 4 of 4 | | 4 of 4 | 4 of 4 |
| Counter sends refused `stale` | 42 to 43% (41%) | | 0 (0) | 0 (0) |
| Counter send until accepted, p50 / p99 | 2.5 / 10.3 to 11.2 ms (1.1 / 5.6) | | 1.2 to 1.5 / 4.8 to 5.7 ms (0.6 / 2.4) | 1.3 to 2.1 / 4.2 to 5.8 ms (0.7 / 2.6) |
| Counter: events a watching host reads per message | 2.03 (2.02) | | 0.006 (0.001) | 0.006 (0.001) |
| Counter: claim after a kill or freeze (ttl 1 s) | 925 to 962 ms (941 to 967) | | 944 to 989 ms (927 to 971) | 766 to 1,004 ms (948 to 1,002) |
| Counter: claim after the lease's end | 3 to 7 ms (3 to 8) | | 3 to 6 ms (2 to 4) | 5 to 8 ms (3 to 6) |
| Counter: replay at start | 10 to 32 ms (16 to 71) | | 3 to 8 ms (3 to 5) | 5 to 9 ms (7 to 8) |
| Counter: late writes of frozen owners refused | 8 `stale`, 8 `fenced` | | 10 `fenced` | 8 `fenced` |
| Counter: workerd at the end | 120 MB (332) | | 97 to 99 MB (191) | 98 to 99 MB (206) |
| Agents runs passed | | 4 of 4 | | 4 of 4 |
| Agents: round trip Mac to container to Mac, no faults, p50 / p99 | | 11 / 20 to 21 ms | | 3 / 7 ms |
| Agents: the same, both hosts on the Mac | | 11 to 12 / 14 to 15 ms | | 2 / 4 ms |
| Agents: all answered, faulted runs | | 21.1 s (24.4) | | 21.6 to 21.8 s (25.7) |
| Agents: one-send round trip, faulted, p50 / p99 | | 690 / 734 to 737 ms (79 / 1,012) | | 720 to 725 / 781 to 794 ms (87 / 973) |
| Agents: calls sent again | | 32 (8) | | 32 (9) |
| Agents: kill to the new owner's claim | | 840 to 1,031 ms | | 812 to 1,023 ms |
| Agents: pause to the second container's claim | | 865 to 924 ms (889) | | 938 to 996 ms (875) |
| Agents: frozen owner's writes accepted / refused | | 0 / `stale`, `stale` | | 0 / `fenced`, `fenced` |
| Agents: workerd | | 155 to 161 MB (381) | | 85 to 86 MB (148) |

- **The counter is 96's, within noise.** The one low number, 766 ms, is a
  freeze with only 750 ms of lease left; claims came 5 to 8 ms after the
  lease's end, as in 94 and 96.
- **The agents test lost its polling.** 95's hosts read the whole log
  every 5 ms; 97's hosts use 96's live tail, through Docker's port
  forwarding for the container. A no-fault round trip fell from 11 to 3 ms
  at p50, and workerd holds half the memory.
- **Faulted agent runs were 2 to 3% slower.** The container's fenced save
  took p50 4 ms against 95's 2 ms in the small runs (1 ms in both large
  runs). The answerer saves once per answer, one at a time, so 236 saves
  at 2 ms more is about 0.5 s, most of the gap. The guard adds one indexed
  `SELECT` on `acl` per write; I did not find why the container's save
  doubled and the Mac's did not.
- **The frozen owner is now refused by the fence, not by the rev.** In 95
  its late save came back `stale`; here it is `fenced`, save and reply
  alike, and it noticed its loss 31 to 43 ms after waking.
- **The agent's work is still at least once.** The frozen owner ran its
  agent once more after waking in 2 of 4 runs (95: 4 of 4); its answer was
  refused each time.

## One fence mechanism

95's `fenceOn` and 96's prefix lease answered the same question: which
lease does this fence speak for, and may it write here? The first half
needs no answer from the writer. A fence is the `pos` of the claim that
made it, so it names exactly one lease (Kleppmann's fencing token; Kafka's
producer id and epoch in one number). Passing the stream to check it on,
as `fenceOn` did, could only repeat that or contradict it.

So one rule is left, the second half. A fenced write lands only if its
lease is live and the stream is:

- the lease's name, or a stream under it (96's prefix: etcd's lease on a
  key prefix);
- or any inbox (95's reply: an actor sends from its own identity to
  another's mailbox).

Anywhere else, or after the lease ends, it is `fenced` (Kafka's
`ProducerFenced`). The check order is 96's: fence first, then message id,
then rev, as Kafka checks the epoch before the sequence. A planted copy
that checks the id first lets a lost owner hear `dup` for a reply that
landed earlier (law 18 catches it, as 96's law 12 did for saves).
Confidence 85%: the fence-names-its-lease fact is the core of 93's design;
the doubt is whether "any inbox" is too wide (see the holes).

## The refusal rule

Once a name has been claimed, only that name's live lease writes under it.
An unfenced write to the name or any stream under it is `denied`, with a
live lease or with none. The one open door is the mailbox: a stream whose
last segment is `inbox` takes appends from anyone, fenced or not. A claim
inside a claimed name, around one, or of an inbox is also `denied`, so no
second lease can reach the owner's streams.

- **The shape is the actor's.** Erlang and Orleans keep an actor's state
  private and its mailbox open to all. The ledger holds that as a write
  rule on a prefix, like Kafka's `PREFIXED` ACLs and EventStoreDB's stream
  `$w` (who may write), where the one writer is whoever holds the live
  lease. The refusal word is EventStoreDB's: `AccessDenied`, kept apart
  from `fenced` so a host can tell "you lost your lease" from "you never
  had one".
- **Claimed for ever, not only while leased.** A planted copy that guards
  only while a lease is live lets a write slip in between a crash and the
  next claim, and the next owner's claim then comes back `stale` (law 16
  catches it).
- **How it is kept.** Migration 4 adds `acl (prefix, since)`, one row per
  name ever claimed, filled from old claims. A claim adds its row in the
  same transaction. The check is one `SELECT` over the stream's prefixes.
  The ledger's own writes (expiry, cancel) bypass it.

Confidence 80%. It makes the mistake impossible for every name that has
been claimed once. It does not cover a name before its first claim.

## The laws

All PASS: 93's 1 to 10 and 96's 11 to 15, unchanged, on the Durable Object
in Miniflare (laws 1 to 6, 11, 12, 14, 15 in process; 7, 11c, 13 across 5
SIGKILLs; 8 two processes racing; 10 the file) and on node:sqlite (law 9:
1, 2, 3, 5, 6, 11, 12, 14, 16, 17, 18). 93's and 96's laws were written
before `denied` existed; they run on a view of the client that fails the
law if it ever meets `denied`. None did.

- **16. An unfenced write under a claimed name is refused, live lease or
  not.** The state, the name itself, a deeper stream and a stream that
  existed before the claim: all `denied`, before and after the lease ran
  out and after a reclaim. The fence writes; a sibling `p0/state` is open;
  claims inside, around, and of the inbox are `denied`. Also after 5
  SIGKILLs of the child Miniflare (law 16k).
- **17. An inbox append with no lease lands.** With the lease live, after
  it ran out, with an id, without one, at a rev, and to an inbox nobody
  claimed. A repeated id is `dup`.
- **18. A reply into another program's inbox, fenced on the replier's
  lease, is refused once that lease is lost.** It lands while the lease is
  live; the same fence into the asker's state or a non-inbox is `fenced`;
  after the lease ran out, a repeat of a landed reply, and the old fence
  after a reclaim are all `fenced`; the new fence lands; an unleased sender
  still lands.

Planted mistakes, each caught on node:sqlite:

| Planted in the rules | Laws that fail |
|---|---|
| No guard (95's and 96's ledger) | 16 |
| Guard only while a lease is live | 16 |
| The inbox closed too (deny with no open door) | 17, 18 |
| A fence reaches only its own name (96's prefix lease) | 18 |
| An inbox ignores the fence it is given | 18 |
| The id checked before the fence (96's first run) | 12, 18 |
| A claim under a claimed name allowed | 16 |

The host, counter, call and answerer machine laws of 94 and 95 hold, with
their planted mistakes caught. The tail woke p50 4 ms, p99 8 ms after a
write (200 events, 202 reads), and handed on 34,136 events across 5 SIGKILLs with none skipped or
repeated.

## The `Ledger` service tea-host gives programs

From `97-one-ledger/service.ts`. Every refusal is a tagged error in the
error channel; nothing throws. The hosts here run on it.

```ts
class LedgerUnreachable { _tag: "LedgerUnreachable"; method; message } // no answer, 500, timeout: resend with the id
class Stale     { _tag: "Stale"; stream; rev }              // EventStoreDB WrongExpectedVersion
class Fenced    { _tag: "Fenced"; stream }                  // Kafka ProducerFenced: stop writing
class Denied    { _tag: "Denied"; stream }                  // EventStoreDB AccessDenied: a claimed name's stream, no fence
class Held      { _tag: "Held"; name; holder; expiresAt }   // etcd: the lock is held
class LeaseLost { _tag: "LeaseLost"; name }                 // etcd: lease not found
class Cancelled { _tag: "Cancelled"; name }                 // the lease is live, the work was cancelled

type Inbox = string & { kind: "inbox" }                     // only from streams(name).inbox or inboxOf(replyTo)
type Call<A, E = never> = Effect<A, E | LedgerUnreachable>

class Ledger extends Context.Service<Ledger, {
  append(stream: string, expected: number | "any", event: NewEvent, fence?: number):
    Call<Appended, Stale | Fenced | Denied>
  send(inbox: Inbox, id: string, event: Omit<NewEvent, "id">, fence?: number):
    Call<Appended, Fenced | Denied>                         // at the end: Stale cannot happen
  claim(name: string, holder: string, expectedRev: number, ttlMs: number):
    Call<Claimed, Held | Stale | Denied>
  renew(name: string, fence: number, ttlMs: number):
    Call<{ expiresAt: number }, LeaseLost | Cancelled>
  read(fromPos: number, limit: number, prefix?: string): Call<readonly Row[]>
  readStream(stream: string, fromRev?: number, limit?: number): Call<readonly Row[]>
  readLast(stream: string, count: number): Call<readonly Row[]>
  lease(name: string): Call<Lease | null>
}>()("tea-host/Ledger") {}

streams(name) = { registry: name, state: `${name}/state`, inbox: `${name}/inbox` as Inbox }
// Appended = { pos, rev, dup }; Claimed = { fence, rev, expiresAt }
```

`send` takes an `Inbox`, not a string, so a reply-to read from a message
must pass `inboxOf`, which returns `null` for anything that is not an
inbox. A host cannot be talked into sending a "reply" into someone's state
with a fence; if it tried, the ledger would answer `fenced` anyway.

## What went wrong, and surprises

- **Law 16's first draft stopped at the reclaim.** It aborted when the
  reclaim failed, so a planted copy with no guard showed one failure
  instead of the whole list. It now records the reclaim as a step.
- **The guard broke the old law harness in one place.** 93's and 96's law
  types do not know `denied`. Rather than edit them, a typed view throws
  if an old law meets `denied`; the harness counts a throw as a failure.
- **The faulted agents runs are slower, and I did not find all of why.**
  See the table; the container's saves doubled in the small runs.
- **No refusal in a normal run.** Every `denied` or `fenced` in the test
  runs came from a frozen owner or from a law. The hosts never sent an
  unfenced write to a claimed name, so the guard cost nothing in
  behaviour.

## Holes this leaves

- **Before a name's first claim, unfenced writes under it land.** Kept so
  96's laws stay as they were. A program's host claims before it writes,
  so nothing here hits it; a stray writer that creates `p/state` first
  makes the first claim on `p` start from a rev it did not expect. Fixes:
  deny by default under a registered prefix, or a `register(name)` call
  before any claim.
- **"Any inbox" is wide.** A live lease may append to every inbox, and so
  may anyone with no lease. The fence adds no reach over an unleased
  sender; it only adds the refusal once the lease is lost. A stream such
  as `p/x/inbox` under a claimed name is also open.
- **No identity.** `denied` stops a mistake, not an attacker: anyone who
  can reach the ledger can claim an unclaimed name. Who may claim what is
  a later step (an auth token per host).

## What this does not show

- **One laptop, one clock, Docker Desktop's forwarding.** No partitions,
  no skew. Not run on Cloudflare.
- **Stub agents only.** No real model ran.
- **One name per program kind.** Many names, deep prefixes and many
  inboxes per host are not tested.
- **Docker build cache.** The image, the volume and the containers were
  removed; any build cache layers the image build left were not pruned,
  since cache from other builds on the machine cannot be told apart.

## How to run it

```sh
node experiments/97-one-ledger.ts
# ONLY=laws|plants|kill|hosts|node|file|machine|counter|latency|agents (default all), KILLS=5,
# RUNS=small,small,small,large (counter: 1,000 / 10,000), AGENT_RUNS=small,small,small,large
# (agents: 200 / 2,000 questions), TTL_MS=1000, RENEW_MS=250, STOP_MS=2500, RESTART_MS=300,
# CAP_MB=500, DUP_RATE=0.02, LATENCY=200, WINDOW=8, TIMEOUT_MS=1500, KEEP_LOGS=<a folder>,
# KEEP_IMAGE=1. About 6 minutes. latency and agents need Docker. No key, no model.
# Leaves nothing behind: temporary folders, process groups, and every container, image and
# volume it made (label exp97) are removed.
```
