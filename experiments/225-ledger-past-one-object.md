---
date: "2026-11-07"
summary: "`next/`'s ledger (P6) and P37's span sink; a reading study plus one local measurement with Python's `sqlite3` on P6's tables, not on workerd. An entry is about 467 bytes on disk in a blend (339 a short letter, 624 a fact, 1,138 a comment), so one project object lasts about 3.9 years at 15,000 entries a day (a guess) and 4 months at 2 writes a second. The first wall is a process's JobRecord: one of today's job records took 117 MB of spans in 42 hours, about 150 days to 10 GB. Kafka orders only inside a partition; KIP-405 and Kurrent's archive move closed stretches out, delete only after the copy, and keep the order. Leans: JobRecord parts (80%), `Blobs` by hash in Tier 2 (80%), sealed stretches before Tier 5 (70%), no stream sharding (85%). No model, $0."
---

# 225. How does the ledger outgrow one 10 GB object?

Measured and read 2026-11-07. About `next/`'s ledger (P6, on main since
[PR 459](https://github.com/usirin/tea-fabrika/pull/459)) and P37's span sink, which is not built
yet. A reading study plus one local measurement: bytes per entry on P6's own tables, with Python's
`sqlite3`. No model, no network, $0.

**Answer: the ledger head lasts years; a process's JobRecord is the first wall, in months.**

- **An entry costs about 467 bytes on disk** in a blend of short letters, facts and comments, on
  P6's `entries` table and its indexes. That is about 40% over the raw text.
- **The project object reaches 10 GB in about 4 years at 15,000 entries a day** (a guess at a
  busy project), 19 years at 3,000, and 4 months at a runaway 2 writes a second.
- **Today's version already has a record that would hit 10 GB in about 150 days:** one job's
  record took 291,979 spans, 117 MB, in 42 hours, almost all of them from a poll about twice a
  second. P37 writes every process's spans into its JobRecord, kept forever, so the same shape in
  `next/` hits the wall first.
- **Nobody who keeps a total order shards it by stream.** Kafka orders only inside a partition.
  Kafka's tiered storage (KIP-405) and Kurrent's archive move old closed stretches out and keep
  every offset and the order. Splitting P6's log by stream drops its one global `rev`, and
  experiment 145 broke 11 of 27 laws when it split the project object.
- **Deleting a sealed stretch frees room.** Experiment 224, the same day, showed `databaseSize`
  drops at once after a `DELETE` and new rows reuse the freed pages.

```ts
// The arithmetic, from the measurement below. 10 GB is Cloudflare's per-object limit.
const perEntry = 467; // bytes on disk, P6's tables, the blend
const fits = 10e9 / perEntry; // about 21.4 million entries in one object
fits / 15_000 / 365; // about 3.9 years at 15,000 entries a day (a guess)
fits / (2 * 86_400); // about 124 days at 2 writes a second (a rate seen today)
10e9 / (117e6 / 42 * 24); // about 150 days for today's busiest job record
```

The leans that come out of it are in
[design for bounded objects](../docs/direction/design-for-bounded-objects.md).

## Who did what

- **This repo's code:** `experiments/225-ledger-past-one-object.py` builds P6's `entries` table as
  `TABLES` in `next/packages/libfabrika/src/data/referee.ts:30` writes it, with its index at `:36`.
  The `rings` table is left out: it holds one row per parked waiter, not one per entry.
- **Python 3.14.3 with SQLite 3.53.0**, on a Mac. Not workerd, not Cloudflare.
- **Today's fabrika:** only one number, the span count of one job record, read from the laptop's
  own local record of today's version.

## How it was measured

100,000 rows per shape, over 400 streams named like `ticket:<n>/inbox`, seed 119120. Every
column is filled as P6 fills it: a `rev`, a `pos` per stream, an id, both clocks, `by`, `for`,
`seen`, `cause`, `build`, `_tag` and a JSON body. Bytes on disk are SQLite's
`page_count * page_size` after the inserts, which is the same sum workerd uses for `databaseSize`
(experiment 224). The payload is the length of every value as text.

| Shape | Body | On disk per entry | Payload per entry |
|---|---|---|---|
| A short letter | 60 bytes | 339 | 218 |
| A fact | 300 bytes | 624 | 458 |
| A comment | 700 bytes | 1,138 | 858 |
| Blend, 70% letters, 20% facts, 10% comments | mixed | 467 | 331 |

The blend's mix is a guess. The two `UNIQUE` constraints, the `entries_by_stream` index and
SQLite's own page room make up the gap between payload and disk.

## How long one object lasts

| Rate | How sure | Time to 10 GB at 467 bytes |
|---|---|---|
| 3,000 entries a day | a guess at a quiet project | about 19 years |
| 15,000 a day | a guess at a busy one | about 3.9 years |
| 50,000 a day | a guess at a very busy one | about 1.2 years |
| 2 writes a second, all day | the poll rate today's job record shows | about 4 months |

The last row is the one to fear: a loop that writes on every tick, not a busy team.

## What the makers do

| Who | What they do at the size wall | Order kept? |
|---|---|---|
| Kafka partitions | Spread a topic over partitions. "Any consumer of a given topic-partition will always read that partition's events in exactly the same order as they were written" ([introduction](https://kafka.apache.org/42/getting-started/introduction/)). Nothing is said for across partitions. | Only per partition |
| Kafka tiered storage, [KIP-405](https://cwiki.apache.org/confluence/display/KAFKA/KIP-405%3A+Kafka+Tiered+Storage) | A rolled, inactive segment is copied to remote storage. "Local logs are not cleaned up till those segments are copied successfully to remote." A fetch for an old offset is served from the remote tier by the broker. | Yes, one offset space |
| KurrentDB 25.0 [archiving](https://docs.kurrent.io/server/v25.0/features/archiving.html) | Uploads complete chunk files. "Chunks are removed only after they have been uploaded to the archive." "Read requests read transparently through to the archive as necessary." | Yes |
| Electric ([v1.1 release](https://electric.ax/blog/2025/08/13/electricsql-v1.1-released), [compaction module](https://hexdocs.pm/electric/Electric.ShapeCache.FileStorage.Compaction.html)) | Compacts a shape's log by merging a key's updates. | Yes, but the merged updates are gone, so it is ruled out here |

## What it means for P6

P6 reads its own table to number a write, so a stretch cannot just be deleted:

- `next/packages/libfabrika/src/data/referee.ts:259` takes the next `pos` as `max(pos)` over the
  stream's rows. If a whole stream's rows were sealed away, it would start again at 1.
- `:245` finds a resend by `(stream, id)` in `entries`. A resend of a sealed id would be taken as
  new.
- `:249` reads the newest row for the next `arrivedAt`. That one is always in the head.

So sealing needs two small tables in the head: `streams`, the last `pos` of each stream, and
`ids`, each id with a hash of its line so a resend is still matched. The study sized the
branches it read, all guesses from reading:

| Branch | What | Lines, a guess | Global `rev` |
|---|---|---|---|
| A1 | Seal old stretches into read-only objects | 400 to 600 | kept |
| A2 | Seal old stretches into files in R2 | 600 to 900 | kept |
| B | Shard the log by stream | 1,200 to 1,750 | lost; experiment 145's 11 of 27 laws break |
| C | Put big bodies in `Blobs` by hash | 100 to 200 | kept |

Also seen:

- **P6's row cap is stale.** `referee.ts:27` and `:28` cap a row at 2,000,000 bytes "(flag 13)".
  Cloudflare's [limits page](https://developers.cloudflare.com/durable-objects/platform/limits/)
  now says 8 MB for a string, BLOB or row. A stricter cap is safe; nothing breaks.
- **At 10 GB, writes fail and reads and deletes still work.** The same limits page:
  "`DELETE` operations will also succeed so that you can remove data to free up space."
- **The span sink must not block a step,** says the OpenTelemetry SDK spec: `OnEnd` "MUST be
  called synchronously within the `Span.End()` API, therefore it should not block or throw an
  exception" ([trace SDK](https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/trace/sdk.md#onendspan),
  read at commit `ba9eb45409`). That is why the lean rolls a JobRecord to a new part before it
  is full, and never stops a step for room.
- **No span for an empty poll.** Today's 117 MB was almost all polls that found nothing. A span
  per poll that changed nothing records no new fact; a count in the hourly summary does.

## Cost

$0. No model, no network, no Cloudflare. The script takes about 6 seconds on the laptop.

## What it cannot tell us

- **Whether Cloudflare's SQLite matches Python's.** The bytes per entry came from SQLite 3.53.0 on
  a Mac. workerd's build, page size and its own bookkeeping may differ; experiment 224 saw
  Cloudflare 4 to 64 KB above local, which is noise at this scale, but it was one table.
- **The real rates.** Every rate but the poll rate is a guess. No `next/` project has written a
  day of entries yet.
- **What the real 10 GB wall does.** Experiment 224 answered the question this study was going to
  leave open: a `DELETE` does lower `databaseSize`, at once. It met `SQLITE_FULL` only under
  workerd's test cap, so nobody has filled a real object, and whether 10 GB means 10^9 or 2^30
  bytes is not on the page.
- **How long sealing a stretch takes.** Moving a million rows into a sealed object and deleting
  them was not tried. About 40 seconds is a guess.
- **The JobRecord number is today's version.** It was read once from one local record and not
  measured again for this write-up. `next/`'s JobRecord does not exist yet, and its spans may be
  larger or smaller.
- **Whether the `ids` table grows too fast.** It keeps one short row per entry forever, so the head
  still grows, only slower: an id, a stream and a hash may be a quarter of an entry, a guess. When
  that matters is not measured.

## How to run it

```sh
nice -n 19 python3 -I experiments/225-ledger-past-one-object.py "$(mktemp -d)"
```

It prints one line per shape. It writes nothing to the repo, and it deletes each throwaway
database after measuring it.
