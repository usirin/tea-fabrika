# 98. The tea-host package

The question: experiments 93 to 97 each proved a piece of a tea host, and
each kept its own copy of the ledger, the host loop and the call machine.
Can those pieces become one package, `packages/tea-host`, that 94's counter
test and 95's agents test run against through its exports alone? And can
97's first hole close on the way: before a name's first claim, anything
could be written under it.

**Answer: yes. `packages/tea-host` holds the ledger (one `Ledger` Effect
service, three implementations and a Miniflare child for local use), the
host (`serve`), the call module and a read-only observer. 94's counter test
passes on it 4 of 4 runs (3 of 1,000, 1 of 10,000; a host killed twice, one
frozen, every count exact). 95's agents test passes 4 of 4 with the
answerer in a Docker container (3 of 200 questions, 1 of 2,000; the
container killed twice and paused once, the asker's host SIGKILLed with 8
calls open; every question one right answer, stub agents). Both tests'
numbers match 97's within a few percent. The experiment's hosts,
senders and checks import only the package's exports. The hole is closed
by deny by default: a name is registered before anything lands under it,
as Kafka creates a topic and OTP calls `register/2`. All 17 ledger laws
hold on the Durable Object (in process and after 5 SIGKILLs), on
node:sqlite and in memory; all 11 planted mistakes are caught. The host
always gives the error sink (demlik issue 728): a program cannot pass one.
Confidence 80%.**

```ts
// A name, its lease and its mailbox, as code sees them.
ledger.register("counter:1", "setup")          // once; before it, every write under the name is UnknownName
serve({name: "counter:1", holder, program})     // any number of hosts; the lease holder runs it
cast("counter:1", "m-7", body, "sender-1")      // gen_server:cast: into counter:1/inbox, once per id
self.send(otherInbox, id, body)                 // from inside a program: fenced on its own lease
self.run(machine, {schema, cursor}, {ctx})      // tea's run; the host fills store and onError
whereis("counter:1"); getState("counter:1", S)  // read-only: holder, fence, lease end; last state
```

## What moved, and from where

| Package file | From | What changed on the way |
|---|---|---|
| `rules.ts` | 97 `sql.ts` (93's SQL, 96's prefix and tail, 95's reply fence) | Deny by default; migrations (1: events, leases, jobs; 2: names) |
| `durable-object.ts`, `worker-options.ts` | 97 `worker.ts` | Runs `rules.ts` and its migrations |
| `ledger.ts` | 97 `service.ts`, `client.ts` | `register`; new tagged error `UnknownName`; one mapping (`fromRaw`) for every driver |
| `http.ts`, `local.ts`, `daemon.ts` | 97 `client.ts`, 93/94 `daemon.ts`, 97 `harness.ts` | The child, its process group and the 500 MB restart are a Layer now (`layerLocal`) |
| `sqlite.ts`, `sqlite-driver.ts` | 97 `node-ledger.ts` | Gained an alarm, so leases expire as on the Durable Object |
| `memory.ts` | new | The rules written a second time, over Maps |
| `tail.ts` | 97 `tail.ts` | Unchanged in shape |
| `host-machine.ts` | 94 `host-machine.ts` | The lease clock (below) |
| `host.ts`, `journal.ts` | 97 `counter-host.ts`, `agents-host.ts`, `store.ts`, `serving.ts` | One `serve` for both programs; the journal and sink are the host's |
| `call.ts` | 95 `call-machine.ts` | An Elm module a parent embeds, not a machine of its own |
| `observer.ts` | 94/97 `attach.ts` | `whereis` and `getState` |
| `laws.ts` | 93, 96, 97 `laws.ts` | One suite against the service; each law registers its names first |

The machine laws (host and call) are in `wip/src/laws/tea-host.ts`, beside
the other machine laws, and run in `pnpm test`.

## Deny by default

97 let anything land under a name until its first claim. Three ways to
close that were on the table:

- **Explicit register, then write.** Kafka with
  `auto.create.topics.enable=false`: a topic is made with `CreateTopics`,
  and a produce to a topic nobody made answers
  `UNKNOWN_TOPIC_OR_PARTITION`. OTP: `register(Name, Pid)` before
  `Name ! Msg`, and a send to a name nobody registered fails (`badarg`).
- **Stream metadata.** EventStoreDB sets an ACL on a stream (`$acl`) and
  answers `AccessDenied`. It decides who may write a stream that exists,
  not whether a name exists.
- **Claim registers.** The first claim makes the name. That is 97's shape,
  and it keeps the window: a stray write before the claim still lands.

Picked: explicit register (Kafka plus OTP). It closes the window, it has
one clear answer for "nobody made this" (`UnknownName`), and it keeps
registering apart from holding: a name can be registered with no host up,
and senders can queue into its inbox before any host claims it. Stream
metadata is the step after, for who may send (see what is not in yet).

The rules now:

- A write under a name nobody registered is `UnknownName`: its streams, its
  inbox, a claim, a cancel.
- A registered name is guarded from its registration: only its lease's
  fence writes its streams. An unfenced write is `Denied`.
- Its one open door is exactly `<name>/inbox`. 97 opened any stream whose
  last segment was `inbox`, so `counter:1/x/inbox` was open too.
- Registering is idempotent. A name inside a registered name, around one,
  or shaped like an inbox is `Denied`.

Two new laws, 19 and 20, and five new planted mistakes check this: no
registration at all (97's rule), a claim that registers (Kafka's
auto-create), an unregistered inbox left open, nested names allowed, and a
second register that writes again.

## The host

`serve({name, holder, program})` runs 94's host machine with one change.
94 stopped the program when a renew answered "lost". A host frozen past its
lease could wake and run until that answer came. Now the machine keeps a
lease clock: at the lease's own end, by this host's clock, the program
stops, renew answer or not. The frozen owners in the counter runs were all
stopped by the clock (`lease_due`), 2 to 9 ms after they woke, and their
late writes were all refused `fenced` (97: stopped by `renew_lost`).

The error sink: `self.run` is tea's `run` with `store` and `onError` typed
`never`. The host fills both. A save refused inside a dispatch fails the
program, which stops (OTP: the process exits) and waits for the lease
again. A failure with no caller, such as a refused save at stop, goes to
the host's sink: it becomes a `tea_error` host event and the host goes on.
It never reaches tea's default sink, which rethrows on a timer and kills
the whole process (demlik issue 728). tea did not change.

The call: `call.ts` is gen_server:call as an Elm module. A parent keeps
`Calls` in its state, calls `call(s, id, req)`, feeds replies and
deadlines to `update`, and subscribes to `deadlines(deadlinesOf(s))`. A
timed-out call is sent again under its own id with the next try; a reply
at or behind the cursor changes nothing.

## The two tests, side by side

Small runs; the large run in brackets. 97 is its saved results file.

| Measure | 97 | 98 |
|---|---|---|
| Counter runs passed | 4 of 4 | 4 of 4 |
| Counter sends refused `stale` | 0 (0) | 0 (0) |
| Counter send until accepted, p50 / p99 | 1.3 to 2.1 / 4.2 to 5.8 ms (0.7 / 2.6) | 1.7 to 1.8 / 6.2 to 6.4 ms (0.7 / 2.6) |
| Counter: events a watching host reads per message | 0.006 (0.001) | 0.005 (0.001) |
| Counter: claim after a kill or freeze (ttl 1 s) | 766 to 1,004 ms (948 to 1,002) | 759 to 1,002 ms (935 to 995) |
| Counter: claim after the lease's end | 5 to 8 ms (3 to 6) | 4 to 8 ms (4 to 6) |
| Counter: replay at start | 5 to 9 ms (7 to 8) | 6 to 10 ms (7 to 11) |
| Counter: frozen owner's program gone after waking | 4 to 5 ms (10 to 11) | 4 to 12 ms (5 to 6) |
| Counter: late writes of frozen owners refused | 8 `fenced` | 8 `fenced` |
| Counter: workerd peak | 98 to 99 MB (206) | 97 MB (195) |
| Agents runs passed | 4 of 4 | 4 of 4 |
| Agents: all answered, faulted runs | 21.6 to 21.8 s (25.7) | 21.6 to 21.7 s (25.7) |
| Agents: one-send round trip, faulted, p50 / p99 | 720 to 725 / 781 to 794 ms (87 / 973) | 717 to 720 / 770 to 792 ms (86 / 983) |
| Agents: calls sent again | 32 (9) | 32 (8) |
| Agents: kill to the new owner's claim | 812 to 1,015 ms (817 to 1,023) | 830 to 1,028 ms (843 to 1,026) |
| Agents: pause to the second container's claim | 938 to 996 ms (875) | 932 to 969 ms (879) |
| Agents: the paused owner's late saves refused | `fenced` | `fenced`, 2 a run (1) |

The memory cap never fired: the peak was 195 MB against a 500 MB cap.

## The laws

| Where | Laws | Result |
|---|---|---|
| Durable Object, Miniflare in process | 1, 2a, 2b, 3, 4a, 4b, 5, 11a, 11b, 12, 14, 16 to 20, T, and 15 (the doorbell) | all hold; tail wake-up p50 4 ms, p99 6.5 |
| The local child across 5 SIGKILLs | 7, 11c, 13, 16k, then the whole suite again | all hold; restart 188 to 195 ms |
| Two Node processes over HTTP | 8 | 20 names, one winner each |
| node:sqlite, 8 threads, one file | the suite | all hold |
| memory | the suite (vitest) | all hold |
| The Durable Object's file after stopping | 10 | a plain SQLite file, migrations at 2 |
| Planted mistakes in the SQL | the suite | 11 of 11 caught |
| Host machine | 9 laws | hold; 9 planted mistakes caught |
| Call module | 7 laws | hold; 7 planted mistakes caught |

Law 6 (a SQL view) is retired: this ledger has no views. The old laws were
ported with one change each: they register their names first, and a write
under a name nobody registered now answers `UnknownName` where it used to
land.

## What went wrong, and surprises

- **A pass check was loosened.** 97 required the woken owner to try a late
  write and be refused by the fence. With the lease clock, the program can
  be gone before it tries one, so the check now passes when no late write
  landed and every one tried was `fenced`. In these runs it made no
  difference: every woken owner still tried one write before the clock
  stopped it, and each was `fenced` (8 in all, as in 97). It is said here
  so it is not missed.
- **The send p99 is about 1 ms higher in small runs** (6.2 to 6.4 against
  4.2 to 5.8). Not looked into. The large run is the same as 97.
- **The package is not small.** About 3,700 lines without tests. Most is
  the rules (written twice on purpose: SQL and memory) and the laws.
- **201 agent runs for 200 questions** in each small run, as in 95. The
  stub ran twice for one question: an owner was stopped after the agent
  answered and before the save landed (the paused owner's saves were
  refused `fenced`), and the new owner asked again. No answer is on record
  twice. I did not trace which fault caused it in each run. With a real
  agent that is one paid run wasted per takeover.

## What is not in yet

- **Who may send.** Any process that reaches the ledger can cast into any
  registered inbox. Only the exact `<name>/inbox` is open, so 97's hole 2
  is half closed. A sender list per name (stream metadata) comes next.
- **Unregister**, and moving a name.
- **Supervisors, links, monitors.** A name with no live host waits.
- **Laws for the asker's window.** The call module has laws; the parent
  that keeps 8 calls open around it (`98-tea-host-package/asker.ts`) has
  none.
- **A deployed Durable Object, a real agent, the latency presets.** Only
  the local ledger and stub agents ran here.
- **No identity.** `Denied` stops a mistake, not an attacker.

## What this does not show

- **One laptop, one clock, Docker Desktop's forwarding.** No partitions, no
  clock skew. Not run on Cloudflare.
- **Many names per host.** Each test runs one or two names.
- **That the API is right.** Two programs use it. A third shape of program
  may want `serve` to take more, or less.

## How to run it

```sh
nice -n 19 node --no-warnings experiments/98-tea-host-package.ts
# ONLY=laws|plants|kill|hosts|node|file|machine|counter|agents (default all), KILLS=5,
# RUNS=small,small,small,large (counter: 1,000 / 10,000), AGENT_RUNS=small,small,small,large
# (agents: 200 / 2,000 questions), KEEP_LOGS=<a folder>, KEEP_IMAGE=1.
# agents needs Docker. No key, no model. Removes every process group, container, image and
# volume it made (label exp98).
```
