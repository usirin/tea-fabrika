---
date: "2026-11-11"
scripts: "none on main; the script `experiments/258-pipes-on-mail.ts` is on the branch `fabrikalfa/exp-pipes-on-mail`, raw timings under `runs/` on the owner's machine"
summary: "`next/`, PR 929 at `808e954eb`, node:sqlite on real files, five runs per cell. Yes, with batching, once two scans are fixed. The save is cheap: a delivery's two appends alone (a simulation) cost 0.13 to 0.15 ms, flat to 10,000. `deliver` reads the sender's whole outbox and the target's whole inbox per send (2,022,011 rows read for 1,000 mails, against 3,999), and the recovery save rereads every receipt per step (on main too; a finding row). So one line per mail slows with each line: through two real runners, 19 lines/s at 1,000 lines, 85 ms per line in the last tenth against 9 in the first. 100 lines per mail: 8,290 lines/s, 10,000 lines in 1.2 s, 3 KB of WAL per line. Full sync added about 0.08 ms per commit (macOS, a lower bound). The unsaved queue baseline is 60 to 160 times faster than the floor, but the ephemeral lane may not feed a program's input. Lean, about 75%: one transport, lookups by ID, chunked writes, and a bound on unread letters (a pipe's 64 KiB, GenStage's demand). No Durable Object ran. | $0"
---

# 258. Can a pipe between two programs ride on program mail, or does saving each output cost too much?

Measured on 2026-11-11, on PR 929's branch (`fabrikalfa/p41-1`, at `808e954eb`, P41 slice 1). The
script stays on the branch `fabrikalfa/exp-pipes-on-mail`; only this write-up and its index row go to
main, and raw timings stayed under `runs/`
([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)). **Every claim is about
`next/`** (`next/packages/libfabrika/src/processes` and `runtime`), never today's version. One agent
read, wired and timed. No model was called beyond the agent, and no platform runtime was started:
the store was `node:sqlite` (SQLite 3.54.0, Node 26.13.0) on real files, `effect` 4.1.2 and
`@demlik/tea` 0.25.0 from the lockfile, on a 12-core laptop.

**The answer: yes, one path can carry a pipe, but only with batching, and only after two scans are
fixed.** Saving a letter is cheap: the two appends a delivery makes cost 0.13 to 0.15 ms and stay flat
up to 10,000 mails. What makes a chatty stream slow is not the save. It is that
`ProgramMail.deliver` reads the sender's whole outbox and the target's whole inbox on every send, and
the runner's recovery save reads every receipt it ever kept on every step. Both grow with the stream,
so one line per mail gets slower with each line: at 1,000 lines through two real runners, a line in
the last tenth took 85 ms against 9 ms in the first, and at 10,000 mails through the service alone,
418 ms against 18 ms (200 million rows read). With 100 lines per mail, 10,000 lines went
through the same runners in 1.2 s. A lighter, unsaved lane is not needed for speed, and the one the
glossary already has may not feed a program's input.

```ts
// A pipe is shell syntax for Sends to a named inbox. The writer side chunks, as a Unix pipe buffers:
// one letter per chunk of lines, not one per line.
// a | b   becomes, inside a's runner:
send({ to: "b:1", m: { type: "lines", lines: chunk } }); // chunk: up to k lines, or what came in a tick

// The sink folds a chunk in one step.
lines: (s, m) => [{ lines: s.lines + m.lines.length }, []],
```

## What was measured

Four lanes, each fed N log lines of about 75 bytes (`{ seq, text }`). Five runs per cell unless it
says otherwise; numbers are the median, with the range of the five in brackets. "k" is lines per mail.

- **service**: the branch's real `ProgramMailLedger.layer`, `ProcessManager`, `Mailbox` and ledger on
  one SQLite file. `deliver` once per mail, then the target reads its inbox past the last rev it saw.
- **runner**: two real `ProgramRunner`s wired as the branch's own runtime suite wires them, with
  `MailDeliveryLive`, a wake that saves an alarm row before it answers, and one database per part. A
  producer program takes one person input per mail and its step emits the built-in `send`; the sink's
  `due` admits each letter and counts lines. **quiet** is the same producer with no Send, to subtract.
- **floor (a simulation)**: only the two appends `deliver` makes, by ID, in one `LedgerTransaction`,
  with none of its stream reads. It is what the save alone costs, not a product path.
- **queue (the baseline, not a proposal)**: an Effect `Queue.bounded(1024)` between two fibers. At most
  once: nothing is saved, and a crash loses what is in it.

Sync: the product's ledger runs only in a Durable Object (`cloudflare/CloudflareSql.ts`); `next/` sets
no SQLite sync mode, the platform owns durability. The branch's node tests use WAL with
`synchronous=OFF` (`node/ProgramMail.test.ts:27`), so that is the default here. `full` is WAL with
`synchronous=FULL`, a sync per commit. On macOS SQLite's sync is `fsync`, which does not flush the
drive's cache without `PRAGMA fullfsync`, so `full` here is a lower bound. Bytes are the WAL bytes
the run wrote, with auto-checkpoint off: every page each commit wrote, before any copy back.

## The numbers

| Lane | N | k | lines/s | per mail p50 / p99 (ms) | first tenth → last tenth (ms) | WAL bytes per line |
|---|---|---|---|---|---|---|
| queue | 1,000 | 1 | 345,000 [323,000–394,000] | 1.47 / 1.68 (time in queue) | – | 0 |
| queue | 10,000 | 1 | 1,070,000 [1,010,000–1,160,000] | 0.40 / 1.35 | – | 0 |
| floor | 1,000 | 1 | 5,745 [3,680–5,958] | 0.15 / 0.56 | 0.21 → 0.17 | 35 KB |
| floor | 10,000 | 1 | 6,575 [4,854–6,902] | 0.13 / 0.48 | 0.16 → 0.13 | 39 KB |
| floor, full sync | 10,000 | 1 | 3,887 [2,557–4,853] | 0.20 / 1.19 | 0.35 → 0.20 | 39 KB |
| service | 100 | 1 | 354 [325–375] | 2.68 / 11.6 | 1.9 → 3.8 | 23 KB |
| service | 1,000 | 1 | 53 [29–57] | 17.2 / 47.5 | 3.0 → 33.5 | 37 KB |
| service | 10,000 | 1 | 5 (one run) | 173 / 705 | 18.3 → 418 | 40 KB |
| service | 1,000 | 10 | 3,289 [2,934–3,537] | 2.82 / 5.79 | 2.3 → 4.2 | 2.5 KB |
| service | 1,000 | 100 | 36,195 [30,527–37,361] | 2.41 / 6.18 | – (10 mails) | 0.3 KB |
| service | 10,000 | 10 | 520 [369–565] | 18.8 / 41.3 | 3.0 → 35.1 | 3.8 KB |
| service | 10,000 | 100 | 19,411 [14,697–23,356] | 4.75 / 14.8 | 4.0 → 7.0 | 0.35 KB |
| quiet (no Send) | 1,000 | 1 | 63 [46–70] | 14.5 / 36.1 | 3.9 → 30.0 | 110 KB |
| runner | 100 | 1 | 109 [91–116] | 8.7 / 25.9 | 8.6 → 11.7 | 254 KB |
| runner | 1,000 | 1 | 19 [17–24] | 41.9 / 177 | 9.1 → 85.4 | 288 KB |
| runner | 1,000 | 10 | 1,266 [1,214–1,310] | 7.7 / 21.3 | 7.6 → 10.1 | 26 KB |
| runner | 10,000 | 10 | 212 [186–226] | 44.5 / 119 | 9.4 → 82.7 | 29 KB |
| runner | 10,000 | 100 | 8,290 [8,138–8,556] | 11.7 / 27.8 | 10.7 → 14.7 | 3.0 KB |

Per mail is one `deliver` plus the read in **service**, and one producer input plus the sink's `due`
in **runner**. Other cells, all five runs each:

- **One drain at the end** instead of one per mail (runner, 1,000 lines, k = 1): 39.0 s [37.5–44.2]
  against 53.5 s [41.1–60.2]. Waking the sink less helps a little; the scans stay.
- **Full sync**: floor at 1,000 went from 0.15 to 0.23 ms p50. Service at 1,000 did not move (16.4 s
  against 19.0 s, inside the spread), and runner at 1,000 (three runs) took 59.8 s against 53.5 s. The
  sync per commit is small next to the scans.
- **The pipe's own share** in the runner: 53.5 s with Send against 16.0 s without at 1,000 lines, so
  about 37 ms per line on top of the producer's step; at 100 lines, 5.4 ms.

### Where the time goes

Rows that SELECTs returned, per run, against what a lookup by ID would return:

- **service, 1,000 mails: 2,022,011 rows read**, against 3,999 for the floor. `saved()` in
  `ProgramMailLedger.ts` runs `turn.read(outbox(...), 0)` and `turn.read(inbox(...), 0)` and then a
  `find` by ID, twice per delivery (the first check, and again inside the commit). That is about 2n
  rows per send, so n²: a line in the last tenth costs 10 times one in the first. Each delivery is
  also 6 transactions (6,006 for 1,000), against 1 for the floor.
- **quiet, 300 inputs: 270,600 rows** from `SELECT value FROM process_receipts WHERE name=? AND
  letter=?`, against 4,804 for the next query. `RecoveryStore.ts:118` loops over every receipt the
  process kept, one SELECT each, on every save. This is on main too, not PR 929, so any chatty program
  slows with age. It is written as a finding row
  (`field/findings/2026-11-11-recovery-save-rereads-every-receipt.json`).
- **runner, 300 lines**: the same receipts query (361,191 rows) plus the ledger's full stream reads
  (195,608 rows).

### What one line costs to keep

A line through two runners writes 7 ledger entries against 2 without the pipe: the producer's input
letter and its step's entry (both there without a pipe), plus the letter in `sink:1/inbox`, the
receipt in `producer:1/outbox`, the `send_ok` answer letter back in the producer's inbox, the
producer's answer entry and the sink's step entry. That is 37 write statements per line against 17,
one alarm row per wake, about 930 bytes of entry bodies, and 288 KB of WAL pages against 110 KB.
With 100 lines per mail, a line costs 3.0 KB of WAL.

## What is known elsewhere

- **OTP: a send never waits, and nothing bounds a mailbox.** "All communication between Erlang
  processes ... is done by sending and receiving asynchronous signals"; the only suspension is a full
  distribution buffer between nodes ([Erlang reference manual, processes](https://www.erlang.org/doc/system/ref_man_processes.html)).
  A fast producer grows the receiver's queue until memory runs out. OTP's answer for streams is
  outside the mailbox: [GenStage](https://gen-stage.hexdocs.pm/GenStage.html) (v1.3.2) has the
  consumer send demand upstream, and "the producer will emit events, never emitting more events than
  the consumer asked for", bounded by `:max_demand`. [Broadway](https://hexdocs.pm/broadway) builds
  batching on it. Program mail is OTP's mailbox, saved: it has no demand either.
- **Unix: a pipe is a small bounded buffer, and a full one blocks the writer.** Linux: "Since Linux
  2.6.11, the pipe capacity is 16 pages (i.e., 65,536 bytes ...)", and "If the pipe is full, then a
  write will block or fail" with `O_NONBLOCK`; writes under `PIPE_BUF` (4,096 bytes on Linux) are
  atomic ([pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html)). macOS starts at
  `PIPE_SIZE 16384` and grows to `BIG_PIPE_SIZE (64*1024)`
  ([xnu `bsd/sys/pipe.h`](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/pipe.h)).
  The reader gets bytes in chunks, never one `write` per line: `a | b` batches by nature.
- **Cloudflare: a pipe in the cloud is writes in one object, billed by row.** SQLite-backed Durable
  Objects bill rows written, $1.00 per million after 50 million a month on the paid plan, and "each
  `setAlarm()` is billed as a single row written"
  ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). "Every row update
  of an index counts as an additional row"
  ([SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)),
  and the ledger's `entries` table has three indexes beside its rowid, so one entry is about 4 rows
  written. An object has "a soft limit of 1,000 requests per second", and a string or row may be 8 MB
  ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)); the ledger caps a
  row at 2,000,000 bytes (`ledger/internal/ledgerStore.ts:21`). Writes with no `await` between them
  coalesce into one transaction, and output gates hold the reply until they are stored
  ([rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).
  A guess from those numbers, not measured: a one-line-per-mail pipe writes about 5 entries, 1 alarm
  and a few state rows per line, so 25 to 40 rows; 1 million lines a month would be about $25 to $40
  past the free rows. At 100 lines per mail it is under $0.50.

## What it tells us

- **One path works with batching.** At k = 100 the runner moved 8,290 lines a second, even with both
  scans in place, and wrote 3 KB per line. That is far past a person reading a log, and a pipe batches
  by nature, as a Unix pipe hands the reader a buffer, not a line.
- **One line per mail does not work as built**, and not because of the save. The floor shows a
  saved, ordered, exactly-once letter costs about 0.15 ms on this laptop and does not grow. The
  growth is two reads: `deliver`'s whole-stream scans and the recovery save's receipt loop. Both are
  O(n) per message where an indexed lookup would do: the ledger already has `UNIQUE (stream, id)`.
- **A lighter lane is not needed for speed, and the one we have may not carry a pipe.** The baseline
  queue is 60 to 160 times faster than the floor, but the glossary's ephemeral lane is "show it, never
  save it, never decide with it". A pipe feeds a program's input, and the program folds it into a
  saved model, so a pipe decides. An at-most-once pipe would make a crash drop lines the sink half
  counted.
- **What program mail lacks for a stream is a bound, not speed.** Like an OTP mailbox, an inbox has
  no limit and a Send never waits. A fast writer and a slow reader means an inbox that grows without
  end, in a 10 GB object.

## The lean

**Build pipes on program mail, one transport, with three changes before it carries a stream:**
`deliver` looks its receipt up by ID instead of reading both streams; the recovery save stops
rereading every receipt; and the pipe's writer side sends chunks (up to k lines, or what arrived in
one tick, under the ledger's 2,000,000-byte row cap), with a bound on unread letters in the target's
inbox so a writer waits or gets a typed answer when it is full, as a full Unix pipe blocks and as
GenStage's demand caps a producer.

- **Why:** it keeps the owner's one-transport idea, `|` stays shell syntax, and a pipe gets ordered,
  exactly-once, durable delivery and the host's grant for free. The numbers say the cost is in two
  fixable reads, not in the save.
- **What it costs:** the two lookups are small changes in `ProgramMailLedger.ts` and
  `RecoveryStore.ts`, each needing a law that n sends read O(1) rows (a pinned count, say). The chunk
  size and the inbox bound are choices, so they are `fabrika.toml` settings with defaults
  ([0069](../.decisions/0069-choices-are-settings.md)). The bound is a new state for a Send (a fourth
  answer next to `queued`), which is a design call for the owner.
- **How sure:** about 75%. The node numbers are clear, and the scans are read in the code and counted
  in rows. The doubt is the cloud: one ledger object carries every pipe, it has a 1,000 requests a
  second soft limit, and a Durable Object's write path was not timed here. One run of this script on
  Alchemy's local runtime and one on Cloudflare would settle it.

## What it cannot tell us

- **No Durable Object ran.** Every time here is node:sqlite on a laptop SSD. The object's storage,
  its output gates and its write coalescing may make a commit cheaper or dearer; the cloud cost above
  is a guess from the price page.
- **The floor is a simulation.** It skips the grant, the sender check and the lifecycle check that
  `deliver` does; a fixed `deliver` will cost somewhat more than 0.15 ms.
- **Full sync on macOS is not a real flush**, so the sync cost is a lower bound.
- **The service lane at 10,000 lines, one per mail, ran once**, since one run takes about 32
  minutes; the runner at 10,000 lines, one per mail, was not run at all (it would take
  over an hour).
- **One producer, one sink, no restarts and no faults.** A crash in the middle of a stream, two
  writers into one inbox, and the cost of a growing inbox on the sink's reads were not measured.
- **No backpressure was built or tried**, so how a bound feels in a shell line is unknown.
