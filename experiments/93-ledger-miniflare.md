# 93. One Durable Object as the ledger, on Cloudflare and on a laptop

The question: can ONE Durable Object class be our ledger everywhere? On
Cloudflare for a team, and inside Miniflare (Cloudflare's local runtime,
used as a Node library) for one person on a laptop, its data kept on disk.
And is Miniflare light and steady enough to run as a long-lived local
process (a daemon), not only as a dev tool?

**Answer: yes for the ledger; for the daemon, reliable yes, light no. All
10 laws hold. One `Ledger` class with its SQL in one file ran in Miniflare
and, unchanged, on node:sqlite. Claims, compare-and-set appends, fences,
lazy expiry, the alarm and the view all behave as designed. Five SIGKILLs
mid-write, and a 30-minute soak (468,598 events, a SIGKILL every 5
minutes), lost no acknowledged write, made no gap and no duplicate, and
every pending alarm fired by itself after a restart. Miniflare starts in
about 40 ms inside its process and 200 ms as a child process; a call over
HTTP takes about 2 ms. Three things a daemon must handle: (1) a SIGKILL to
the Node process alone leaves workerd running and serving the port, so run
it in its own process group and kill the group; (2) about 200 new
connections at once overrun the listen backlog and get reset, so clients
keep a small pool; (3) workerd's memory grows with traffic and never comes
back (35 MB at start; 650 to 680 MB after 5 minutes of the soak; 1.17 GB
after 15 minutes of reads, still rising), so a daemon needs a memory cap
and a restart, which here costs 200 ms and loses nothing. The install is
160 MB, 109 MB of it the workerd binary; the Node process holding Miniflare
adds 170 MB. Confidence 80%.**

```ts
// The whole idea: one class, its rules in SQL, two places to run it.
export class Ledger extends DurableObject {
	claim(stream, holder, expectedRev, ttlMs)   // {ok, fence} | held | stale
	append(stream, expectedRev, event, fence?)  // {ok, pos, rev} | stale | fenced
	renew(stream, fence, ttlMs)                 // ok | lost | stop
	cancel(stream, writer)
	alarm()                                     // writes lease_expired; only a nudge
}
// Team:  wrangler deploy                        -> Cloudflare
// Solo:  new Miniflare({durableObjectsPersist: "~/.tsh/ledger"})  -> a laptop
// Or:    the same sql.ts on node:sqlite (BEGIN IMMEDIATE), no workerd at all
```

## Who did what

- **The ledger (`93-ledger/ledger.ts`, `93-ledger/sql.ts`):** new. Plain
  Workers TypeScript. All rules are in `sql.ts`, written against a two-call
  driver (`all`, `tx`). `ledger.ts` wires it to `ctx.storage` and to plain
  HTTP (`POST /<ledger>/<method>`, the args as a JSON array).
- **The solo driver (`93-ledger/node-ledger.ts`):** new. The same `sql.ts`
  on a node:sqlite file, `BEGIN IMMEDIATE`, inner transactions as
  savepoints. A pool of worker threads, each with its own connection to the
  one file, makes "50 at once" a real race for SQLite's write lock.
- **The host (`93-ledger/host.ts`):** Miniflare in a child process, data in
  a folder, one JSON line when ready.
- **The harness (`93-ledger-miniflare.ts`):** the laws, the kills, the
  measures and the soak. Results in `results/93-ledger-miniflare.json`.
- No bundler: Node's own `stripTypeScriptTypes` turns the two `.ts` files
  into the modules handed to workerd.
- No model, no key, no network beyond 127.0.0.1. $0.
- Run on one laptop (Apple silicon, macOS), Node 26.12, miniflare
  4.20260730.0 (workerd 1.20260730.1). Not run on Cloudflare itself.

## What was built

The tables, as decided:

```sql
CREATE TABLE events (pos INTEGER PRIMARY KEY, stream TEXT, rev INTEGER, writer TEXT,
                     kind TEXT, at INTEGER, data TEXT, UNIQUE (stream, rev));
CREATE TABLE leases (stream TEXT PRIMARY KEY, holder TEXT, expires_at INTEGER,
                     fence INTEGER /* pos of the claimed event */, stop INTEGER DEFAULT 0);
CREATE TABLE jobs   (id TEXT PRIMARY KEY, due_at INTEGER, kind TEXT, stream TEXT);
CREATE VIEW open_criteria AS ...   -- criterion_added with no criterion_met, by data ->> '$.id'
```

- **Correctness is one INSERT.** The compare-and-set append lands only if
  the stream still ends at `expectedRev` and, with a fence, that fence holds
  a live lease. `UNIQUE (stream, rev)` backs it up.

  ```sql
  INSERT INTO events (stream, rev, writer, kind, at, data)
  SELECT ?1, ?2 + 1, ?3, ?4, ?5, ?6
  WHERE (SELECT coalesce(max(rev), 0) FROM events WHERE stream = ?1) = ?2
  AND (?7 IS NULL OR EXISTS (
      SELECT 1 FROM leases WHERE stream = ?1 AND fence = ?7 AND expires_at > ?5))
  RETURNING pos, rev
  ```

- **A claim** checks for a live lease (`expires_at > now`, in SQL), writes a
  `claimed` event through the same INSERT, and its `pos` is the fence. The
  lease row is replaced only `WHERE leases.expires_at <= now`. So a lease
  that ran out can be taken at once, whether or not the alarm has run: lazy
  expiry.
- **A renew** must echo the fence: `lost` if the fence is not the lease's
  or it ran out, `stop` after a cancel. It writes no event (a heartbeat
  would flood the log).
- **The alarm** is a nudge for the log. It is always set to `MIN(due_at)`
  of `jobs`, with a 30 s fallback set before due jobs run. For each due
  lease job it writes `lease_expired` and drops the lease, guarded `WHERE
  fence = ?` on the fence it read. It waits a grace (1 s here) past
  `expires_at`, so a reclaim can come first; then it finds a new lease and
  writes nothing.
- **Migrations** are numbered, all run in one transaction, the last id kept
  in a `migrations` table.
- No signing, no WebSocket tail. Not needed to answer the question.

## The laws

Laws 1 to 6 ran against Miniflare in the harness's own process. Law 9 ran 1
to 3 (and 5, 6) against node:sqlite with 8 threads on one file.

| Law | Result | Numbers |
|---|---|---|
| 1. 50 claims at once on one ticket | pass | 1 ok, 49 held; one `claimed` event |
| 2a. 50 appends at once, 50 tickets | pass | 50 ok, 50 distinct `pos` |
| 2b. 50 appends at once, one ticket, same `expectedRev` | pass | 1 ok, 49 stale; one row |
| 3. stale rev refused; old fence refused after expiry and reclaim | pass | stale; fence 55 then 57; the old fence `fenced`, the new one ok |
| 4a. ttl 2 s, no renew: the alarm writes `lease_expired` | pass | after 3,047 ms (ttl 2,000 + grace 1,000); lease row gone |
| 4b. claim after `expires_at`, alarm not yet run | pass | ok, fence 62 then 63; no `lease_expired`, before or after the alarm ran; holder the new one |
| 5. renew says `stop` after cancel | pass | ok before; wrong fence `lost`; `stop` after cancel |
| 6. writing to the view fails | pass | "cannot modify open_criteria because it is a view" |
| 7. SIGKILL the child Miniflare mid-write, restart, 5 times | pass | 0 acknowledged writes lost, 0 pos gaps, 0 rev gaps; each pending alarm fired by itself, about 1,004 ms after `expires_at` (the grace) |
| 8. two Node processes race claims over HTTP, 32 in flight each | pass | 20 tickets x 10 claims from each: one winner on all 20 |
| 8b. the same, no cap: 200 new connections at once from each | pass, with errors | never two winners; 254 of 400 requests reset (`ECONNRESET`); 6 tickets got no winner |
| 9. laws 1-3, 5, 6 on node:sqlite, 8 threads, one file | pass | the same answers as the Durable Object |
| 10. after stopping Miniflare, the `.sqlite` is a plain file | pass | 101 events through the DO, 101 read by node:sqlite read-only |

- **Law 7 in detail.** Eight writers append as fast as they can; the
  harness SIGKILLs the whole process group (Node and workerd) at a random
  0.8 to 1.5 s; it restarts on the same folder and port; it touches nothing
  until the lease and its grace are past; then it reads every event.
  - 5,000 to 25,000 events in the file by the end of each round; each
    round, 8 writes were in flight and their callers saw an error.
  - "Fired by itself": the `lease_expired` event's time is before the
    harness's first call after the restart. The alarm is kept by workerd
    on disk and comes back with no request.
- **Law 8b** is not a ledger failure. None of the reset requests landed (no
  claim is in the log without its caller hearing ok). macOS's listen
  backlog is 128 (`kern.ipc.somaxconn`). A client with a pool of 32 lost
  nothing. A real host keeps one pool, so this only bites a burst.

### The daemon finding: a SIGKILL to Node leaves workerd running

- Miniflare starts workerd as a child process. A SIGKILL to Node (what a
  crash, an OOM kill or `kill -9` does) leaves workerd alive, adopted by
  init, still serving the port. 11.5 s later it was still there.
- Then a second Miniflare started on the same folder (a restart that does
  not know about the old one). Two workerds served one ledger file:
  - 20 tickets, 5 claims each through each process at once: one winner
    on all 20, never two. SQLite's file lock and the SQL compare-and-set
    held.
  - But 16 of 200 calls failed with `SQLITE_BUSY` (a 500), and the
    Durable Object's promise of one request at a time is gone. Nothing in
    workerd stops this.
- **What a daemon must do:** start Miniflare in its own process group and
  kill the group, as the harness does; or keep a lock file in the data
  folder and refuse to start while another holder lives. On Cloudflare this
  cannot happen: one object lives in one place.

## Measures

| Measure | Value |
|---|---|
| Install: miniflare and everything it pulls in | 160 MB, 26 packages |
| of which the workerd binary (`@cloudflare/workerd-darwin-arm64`) | 109 MB |
| of which miniflare itself / sharp and libvips / workerd's package | 22 MB / 18 MB / 4.6 MB |
| Cold start, `new Miniflare` to ready, in process | 28 to 38 ms |
| Cold start, child process spawn to ready (Node boot included) | 200 to 212 ms (Miniflare's part 40 ms) |
| First call on a fresh folder (object made, migrations run) | 15 ms in process, 5 ms in the child |
| First call after a restart on existing data | 3.5 ms |
| Sequential appends, one stream | 1,548/s in process; 525/s over HTTP to the child |
| Appends, 50 in flight on 50 streams | 3,324/s in process; 4,004/s over HTTP |
| node:sqlite, one connection, no HTTP | 10,790/s |
| node:sqlite, 8 threads: sequential / 50 in flight | 6,071/s / 2,239/s (threads wait on the write lock) |
| RSS of the child: workerd idle / after 3,000 appends | 35 MB / 157 MB |
| RSS of the child: the Node process holding Miniflare | 171 MB |
| SQLite inside the DO | 3.47.0 (2024-10-21; `sqlite_version()` is not allowed, read from the file header and the binary) |
| SQLite in node:sqlite | 3.54.0 |

- At start, the Node process that holds Miniflare costs five times what
  workerd does (171 MB against 35). A daemon that only hosts the ledger
  pays that for Miniflare's library, not for the ledger.
- Sharp (18 MB) is there for Cloudflare Images; the ledger never uses it.

## The soak

30 minutes against the child host, one data folder, a SIGKILL to the whole
process group every 5 minutes and an immediate restart. **Pass: nothing
lost, nothing twice, no gap.**

- **The traffic.** Six writers, each in a loop: claim a fresh ticket (ttl
  3 s), append 1 to 5 notes with the fence, renew after every other note
  (or, one time in five, never: the lease is left to run out), and one time
  in ten a cancel by "owner" and a renew that must say `stop`. Every 20th
  ticket instead gets 5 claims at once. A tail reader follows the log from
  `pos` 0, 1,000 at a time. About 260 calls a second: some 100 times what
  a busy team's ledger would see.
- **The check at the end:** let every lease and its grace run out, then
  read the whole log.

| Measure | Value |
|---|---|
| Events in the log | 468,598 (15,620 a minute), on 94,891 tickets |
| Acknowledged appends | 269,784; lost 0; at a different `pos` or `rev` 0 |
| The same write twice | 0 |
| Gaps in `pos`, in `rev` per ticket | 0, 0 |
| The tail reader: a gap seen, or a seen event later gone | 0, 0 |
| Writes in flight at a kill (caller saw an error) | 17; landed 0 |
| Claim races (5 at once) without exactly one winner | 0 of 4,742 |
| Claims; `lease_expired` written by the alarm | 94,891; 94,891 |
| Leases overdue at the end; jobs left | 0; 0 |
| Network errors (all during the 5 kills); unexpected answers | 23; 0 |
| Restart after each kill | 199, 220, 285, 248, 241 ms |
| Data folder | 0 to 54 MB |
| workerd RSS in each 5-minute life | 35 MB at start, about 230 at 30 s, 620 to 680 MB at the kill |

- Every claim's lease ran out in the end and every one got its
  `lease_expired`, across five restarts: the alarm and its jobs table keep
  up under load and survive a kill.
- "Landed 0" is luck of timing, not a promise: a write can commit and its
  answer be lost. The caller then sees an error and must read the ticket
  again. Law 8b counts that case too (there, 0 as well).

### Memory: grows with traffic, not given back

The soak's RSS curve rose in every life and was still rising slowly at
each kill. A separate run (`ONLY=memory`), one host, no kills, three
6-minute phases:

| Phase | workerd RSS |
|---|---|
| Steady appends, about 100 a second (36,577 in all) | 36 to 310 MB |
| Read the whole log (36,577 events) again and again, 2,738 times | 383 to 727 MB |
| Idle | 743 to 737 MB, flat for 6 minutes |

- Both writing and reading grow it; nothing gives it back. The data on
  disk is 3 to 7 MB, so this is not the database's size.
- **It does not level off.** A second run (`MEM_MIN=1 MEM_READ_MIN=15`):
  1 minute of appends (6,058 events, 141 MB), then 15 minutes of reading
  that small log over and over (38,761 full reads). RSS went from 172 MB to
  1,169 MB, still rising about 35 MB a minute at the end, and stayed at
  1,174 MB when idle. About 26 KB kept per full read of 6,058 rows. That
  looks like a leak, in workerd or in the Miniflare layer in front of the
  object; this run cannot tell which.
- workerd is built to be one of thousands on a server, recycled often; as a
  daemon on a laptop, it needs the same: a restart when RSS passes a cap.
  Law 7 and the soak show a restart is safe and takes 200 ms.

## Same SQL, two drivers: every difference hit

The ledger's own SQL needed no change: `?NNN` numbered parameters, `->>`,
`RETURNING`, `ON CONFLICT ... DO UPDATE ... WHERE`, a view. The differences
are all around it:

| | Durable Object | node:sqlite |
|---|---|---|
| A transaction | `transactionSync(fn)` only; `BEGIN` and `SAVEPOINT` refused; nests by itself | `BEGIN IMMEDIATE` / `COMMIT` by hand; nesting by savepoints, in the driver |
| `PRAGMA journal_mode`, `busy_timeout` | not allowed (workerd runs WAL itself) | the driver must set WAL and a busy timeout, or a second connection fails at once |
| `sqlite_version()` | not allowed | 3.54.0 |
| `ATTACH`, a table named `_cf_...` | not allowed | allowed |
| `VACUUM` | refused (every statement runs inside a transaction) | allowed |
| An integer above 2^53 | rounded silently (9007199254740993 read as ...992) | an error ("too large to be represented") |
| `sqlite_master` | also lists `_cf_METADATA` | only our tables |
| Foreign keys | on by default | on by default (Node's choice) |
| SQLite version | 3.47.0 | 3.54.0 |

- **Two of these matter.**
  - The transaction is the driver's job, and that is already the shape:
    `sql.ts` calls `db.tx(fn)` and never says `BEGIN`.
  - The version gap. A feature newer than 3.47 (for example a JSON
    function added later) would work on the laptop's node:sqlite and fail
    in the Durable Object. The law suite run against both catches that,
    as long as it runs against both.
- The rounding of big integers is silent in the DO. Positions and revs stay
  far below 2^53; times are milliseconds. No risk here, but a law should
  not rely on it.

## Just a file

After Miniflare stops, the data folder holds, relative to it:

```
-Ledger/<object id, 64 hex>.sqlite        the ledger: events, leases, jobs, migrations, the view, _cf_METADATA
-Ledger/<object id, 64 hex>.sqlite-wal    left non-empty after a clean stop
-Ledger/<object id, 64 hex>.sqlite-shm
-Ledger/metadata.sqlite (+ -wal, -shm)     workerd's own: alarms and object names
```

- The folder name is `<unique key>-<class name>`; Miniflare's unique key
  is empty here, so `-Ledger`. The file name is the object id: a hash of
  the name `acme-app`, not the name.
- node:sqlite opened it read-only, with the WAL beside it, and read all 101
  events. A person can open their ledger with any SQLite tool.
- Copy all three files, or none: the newest writes sit in the `-wal` file
  even after a clean stop.

## What this means

- **One Durable Object everywhere: yes.** The same class and the same
  `sql.ts` ran in workerd and on node:sqlite with the same answers to every
  law. Cloudflare's own runtime on a laptop is the same runtime, so the
  team ledger and the solo ledger are one piece of code. This backs the
  decision in [a local-first sync engine](../docs/direction/a-local-first-sync-engine.md).
- **Correctness in SQL works as designed.** Even with two workerds wrongly
  on one file, no ticket got two winners. The alarm is only the log's
  nudge; lazy expiry did the real work in law 4b.
- **Miniflare as the solo daemon: reliable, not light.** It starts in
  200 ms, survives SIGKILL with nothing lost, brings its alarms back by
  itself, and held every law for 30 minutes of heavy traffic with five
  kills. But it costs 160 MB on disk, 170 MB for the Node process, and a
  workerd whose memory only grows (past 1 GB in 15 minutes of reads). The
  rules a daemon needs:
  - run it in its own process group and stop the group, or hold a lock on
    the data folder (the orphan workerd);
  - talk to it through one pooled client, not a burst of new connections;
  - restart it when workerd's RSS passes a cap.
- **Or skip workerd for solo.** node:sqlite with the same `sql.ts` is 160 MB
  lighter, 7 to 20 times faster per call, and needs no daemon at all: each host
  opens the file. What it lacks is the alarm, so `lease_expired` would be
  written lazily (by the next claim, or a timer in whichever host is up)
  and the log would not record an expiry nobody looked at. Recommendation:
  keep both, as the direction already says, and pick per user: a laptop
  person gets node:sqlite; someone who wants a shared team ledger without
  Cloudflare runs the Miniflare daemon. Why: same code, and each is
  proven here. Cost: two drivers to keep in step, held by one law suite.
  Confidence 75%; what would settle it is a week of a real host on each.

## What this does not show

- **Not run on Cloudflare.** Every Durable Object number here is workerd on
  a laptop. Cloudflare adds the network, a different SQLite build maybe,
  storage limits, and real placement. Laws 1 to 6 should hold there for
  the same reason they hold here, but that is a claim, not a measure.
- **One machine, macOS.** The listen backlog and the orphan behaviour may
  differ on Linux (the backlog there is often 4,096).
- **Two hosts, not twenty.** And all on one laptop: no slow links, no
  partitions.
- **The soak is 30 minutes at about 100 times a real load.** It shows
  nothing about a ledger that runs for weeks at a low rate: WAL growth,
  disk full, a workerd upgrade over old files, or where the memory curve
  ends at a real rate.
- **Why workerd's memory grows** was not found: V8's heap, SQLite's cache,
  workerd's own buffers and Miniflare's entry worker (every request passes
  through it) look the same from outside. The next probe: plain `workerd
  serve` with the same bundle and no Miniflare, and the same read loop.
- **No power loss.** A SIGKILL keeps the OS's file cache; pulling the plug
  does not. workerd's fsync settings were not tested.
- **The node:sqlite side ran laws 1-3, 5 and 6, not 4, 7, 8 or 10.** It has
  no alarm (4), and its kill and two-process laws were not built here.
- **Two workerds on one folder was tried once** (20 tickets). It held, but
  it is a misuse and was not made safe; the fix is not to allow it.

## How to run it

```sh
node experiments/93-ledger-miniflare.ts
# ONLY=install|laws|kill|hosts|node|file|measure|soak|memory (comma list), SOAK_MIN=30,
# KILL_EVERY_MIN=5, KILLS=5, MEM_MIN=3, MEM_READ_MIN=, MEM_TAG=memory.
# About 45 minutes with the defaults; ONLY=install,laws,kill,hosts,node,file,measure
# is under 3 minutes. The memory table above is MEM_MIN=6; the long read run is
# MEM_MIN=1 MEM_READ_MIN=15 MEM_TAG=memoryLongRead.
# No key, no model, no network beyond 127.0.0.1. Leaves nothing behind: each part
# makes its own temporary folder and removes it.
```
