---
state: "decided 2026-11-07"
summary: "`next/`. fabrika is built on Durable Objects the way Elixir is built on processes: each object is small and bounded at 10 GB, storage across many is unlimited. No object grows forever; every object that grows names its cap and what it does there, roll to a new part or seal an old stretch into its own object; nothing is dropped to stay under a cap. A full disk fails the step loudly; every span is kept forever, and spans outside any process go to their own record objects, in parts. Proposed leans from [experiment 225](../../experiments/225-ledger-past-one-object.md): a process's JobRecord rolls to `job/<pid>/<part>` with a `rolled` fact (80%), big bodies go to `Blobs` by hash in Tier 2 (80%), old ledger stretches are sealed into read-only objects before Tier 5 or at the first 50% size line (70%), no sharding by stream (85%)."
---

# Design for bounded objects

**Decided 2026-11-07 (owner): the principle, five calls from P37's questions and after, and the
four leans below, after a walk of each part. The leans' confidence numbers stay as written.** `next/`.

Its decided rules are in: [0200](../../.decisions/0200-no-object-grows-forever.md),
[0201](../../.decisions/0201-full-disk-fails-the-step.md),
[0202](../../.decisions/0202-spans-and-measurements-kept-forever.md),
[0203](../../.decisions/0203-archives-go-to-r2.md),
[0204](../../.decisions/0204-process-record-rolls-in-parts.md),
[0205](../../.decisions/0205-big-bodies-go-to-blobs.md),
[0206](../../.decisions/0206-sealed-ledger-stretches-keep-one-order.md).

```ts
// A sketch of the whole idea. Every object that grows names its cap and what it does there.
// Names are the plans' to settle.
interface Bounded {
	readonly cap: number; // bytes, read against ctx.storage.sql.databaseSize
	readonly atCap: "roll" | "seal"; // roll: a new part takes the writes; seal: an old stretch moves out
}

const jobRecord: Bounded = {cap: 1e9, atCap: "roll"}; // job/<pid>/<part>, the 1 GB is a guess
const spans: Bounded = {cap: 1e9, atCap: "roll"}; // spans outside any process, in parts
const projectLog: Bounded = {cap: 5e9, atCap: "seal"}; // old stretches into read-only objects
// Never: { atCap: "drop" }. Nothing is dropped to stay under a cap.
```

## What it says

fabrika is built on Durable Objects the way Elixir is built on processes and GenServers. We
design for the infrastructure we use, not the other way round. One object is small and bounded
at 10 GB; storage across many objects is unlimited. So:

- **No object grows forever.**
- **Every object that grows names its cap, and what it does at that cap:** roll to a new part, or
  seal an old stretch into its own object.
- **Nothing is ever dropped to stay under a cap.**

### Decided the same day, from P37's questions

- **At a full disk, a step fails loudly.** It is "let it crash": the write that met
  `SQLITE_FULL` fails its step, the failure is counted and shown, and nothing is dropped silently.
- **Every span is recorded forever,** including spans from outside any process.
- **Spans from outside a process leave the project object.** They go to record objects of their
  own, in parts, as a JobRecord does.
- **Raw health rows are kept forever, the old ones archived to R2.** At the hourly roll-up, raw
  rows older than about 2 weeks are written to one R2 file per object per day, and the local rows
  are deleted only after the file's hash matches. Recent rows stay in the object for fast reads.
  R2 stores data for $0.015 per GB-month against Durable Object storage's $0.20, with 10 GB-month
  free, and no egress charge ([R2 pricing](https://developers.cloudflare.com/r2/pricing/),
  [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
  read 2026-11-07). Miniflare emulates R2 on the laptop.
- **Each object uploads its own archive files** (decided by the owner, 2026-11-07). It checks the
  file's hash before it deletes its local rows. There is no shared archive object. *It said: left
  for P37's plan, whether each object writes its own archive or hands rows to one archive object.*
- **One R2 bucket per kind of data,** such as health and blobs. A lean, under 80% sure, for the owner to
  confirm. The doubt: whether one bucket with a prefix per kind is simpler to grant and to clean up.
- **Where data lives:** archives in R2, everything live in Durable Objects, and anything global
  across projects in Cloudflare D1, only once a real need appears. None is known today: a
  person's devices and projects fit an object of their own. (Cloudflare D1 is not the five
  layers note's decision label D1.)

```ts
// A sketch: one span with no process behind it, such as a door call before any process starts.
// It goes to the current part of the project's span record, never into the project object.
const record = env.SPANS.get(env.SPANS.idFromName(`spans/${part}`));
```

## Decided after the walk, with leans from experiment 225

| Lean | What | Sure |
|---|---|---|
| A process's JobRecord rolls | At its cap it writes a `rolled` fact and the next writes go to `job/<pid>/<part + 1>`. The 1 GB cap is a guess. | 80% |
| Big bodies go to `Blobs` | An entry above a size keeps a hash; the bytes go to the `Blobs` service. Tier 2. | 80% |
| Old ledger stretches are sealed | Into read-only objects, as Kafka's KIP-405 and Kurrent's archive do, before Tier 5 or at the first 50% size line, whichever comes first. P6's global order stays. | 70% |
| No sharding by stream | It loses the global order, as Kafka's partitions do. | 85% |

### A JobRecord rolls to a new part

```ts
// A sketch, in next/'s Schema. P37's plan names the fields.
const Rolled = Schema.TaggedStruct("rolled", {
	part: Schema.Number, // this part
	next: Schema.String, // "job/<pid>/<part + 1>"
	bytes: Schema.Number, // databaseSize when it rolled
});

// The record checks its size before each batch of spans, with room to spare.
if (sql.databaseSize >= CAP) return {_tag: "rolled", next: `job/${pid}/${part + 1}`};
// The sink sends this batch and every later one to `next`. A reader walks the parts in order.
```

- **Why parts and not one record:** a busy process writes spans for as long as it lives, and
  experiment 225 found one of today's job records on course to fill 10 GB in about 150 days.
- **Why roll before the wall:** the OpenTelemetry SDK spec says a span processor's `OnEnd` "should
  not block or throw an exception". If a part rolls with room left, a span write never meets a
  full disk, so the sink never blocks a step.
- **The `<part>` key is new.** P37's row in `docs/plan/tier-1.md:302` says "one object per run" and
  "The run number is P33's". The word "run" there is being swept to "process", as
  `.glossary/TERMS.md` has it; a restart is a new process, as in OTP.

### Old ledger stretches are sealed

```ts
// A sketch. The head keeps what P6 needs to number a write; a sealed object is read-only.
// head:   entries (rev > sealedTo), streams (stream, pos), ids (stream, id, rev, hash)
// sealed: ledger/<project>/sealed/<fromRev>-<toRev>, entries only, never written again
const read = rev <= sealedTo ? sealedObjectFor(rev).read(stream, after) : head.read(stream, after);
```

- The head needs `streams` and `ids` because P6 numbers a write from its own rows:
  `next/packages/libfabrika/src/data/referee.ts:259` takes `max(pos)` and `:245` finds a resend by
  `(stream, id)`. Deleting a sealed stretch would break both.
- A stretch is deleted from the head only after its sealed object has it, as KIP-405 and Kurrent
  delete only after the upload. Experiment 224 showed a `DELETE` frees room at once.
- A sealed object, not an R2 file, because old stretches are still live data: any state rebuilds by
  replaying the log from its start, so every rebuild reads them. A sealed object answers with the
  same read code, order and rules as the head; an R2 file would be a second read path on every
  replay. R2 is for what nobody replays: raw health rows, agent logs, big bodies. 75%. What would
  change it: replays that start from a snapshot, which would make old stretches cold. *Corrected
  2026-11-07 (owner): this bullet first chose by the study's line counts, which is no way to pick a
  design; judged by what each way keeps true, the choice stayed and the reason changed.*

### The OpenTelemetry clash, settled by parts

The OpenTelemetry SDK spec says a span processor should not block. The owner decided that a full
disk fails the step. Both hold because a record rolls to a new part before its disk fills: the
loud failure is the second net, for a bug, and never the daily path (owner, 2026-11-07, after the
walk).

## Why

- **Cloudflare's own rules.** The
  [rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
  say "Create one Durable Object per logical unit that needs coordination" and "Do not put all
  your data in a single Durable Object." The
  [limits page](https://developers.cloudflare.com/durable-objects/platform/limits/) gives 10 GB per
  SQLite-backed object and unlimited storage per account on the paid plan. At the limit, writes
  fail with `database or disk is full: SQLITE_FULL`; "Read operations ... will continue to work,
  and `DELETE` operations will also succeed so that you can remove data to free up space."
- **OTP builds the same way.** Erlang's
  [efficiency guide](https://www.erlang.org/doc/system/eff_guide_processes.html) says "A newly
  spawned Erlang process uses 327 words of memory", small so that a system can run "hundreds of
  thousands or even millions of processes". A process can be given a cap:
  [`process_flag(max_heap_size, ...)`](https://www.erlang.org/doc/apps/erts/erlang.html#process_flag/2)
  "sets the maximum heap size for the calling process", and when it is reached the runtime "sends
  an untrappable exit signal with reason `kill`" and logs an error event. *A guess, not sourced:*
  "a process whose state grows without bound is a bug" is common Erlang lore; no primary source
  found says it in those words, and the cap is off by default.
- **The makers keep the order and move old stretches out.** Kafka promises order only inside a
  partition. KIP-405 and KurrentDB 25.0 move closed stretches to other storage, delete locally
  only after the copy, and read through. [Experiment 225](../../experiments/225-ledger-past-one-object.md)
  has the quotes.
- **The numbers.** An entry is about 467 bytes on P6's tables, so the project object lasts years
  at a busy rate and months under a write-every-tick loop (experiment 225).

## Where this differs from settled notes

- **[The five layers](./a-local-first-sync-engine.md#decided-2026-10-30-and-2026-10-31-five-layers-central-first)**
  say "The log stays in the one project object". That still holds for the head: every write is
  still numbered there, and claims, inboxes and the process tree stay together. Only sealed,
  read-only stretches leave.
- **The same note** calls moving old stretches to R2 "a later-tier proposal, not decided". It
  moves toward the sealed-object lean above, still proposed, with a size line that can pull it
  before Tier 5.
- **[A JobRecord holds its trace](./a-job-record-holds-its-trace.md)** has one object per job, and
  Tier 1 one per process. This adds parts: one process's record is many objects, chained by
  `rolled`.
- **Raw health rows are no longer deleted after about 2 weeks**
  ([monitoring](../plan/tier-1.md#monitoring-is-in-tier-1) said so). From 2026-11-07 (owner) they
  move to R2 instead; the hourly summary is still written first.
- **P6's row cap** of 2,000,000 bytes (`referee.ts:28`, "flag 13") is stricter than Cloudflare's
  8 MB today. It is safe and does not change here.

## What it costs

- **Rolling parts:** a size check before each batch of spans, a `rolled` fact, and a reader that
  walks parts. Small, inside P37; not sized.
- **Sealing:** 400 to 600 lines (a guess from reading), two new head tables, and a read that may
  call a second object. The `ids` table still grows, only slower.
- **`Blobs` by hash:** 100 to 200 lines in Tier 2, and a body that is no longer in the entry.
- **A full disk fails a step,** so a bug that fills a part stops work loudly instead of losing data
  quietly. That is the point, and it is still a stop.

## What would change our mind

- A real object at 10 GB that behaves unlike the limits page says.
- A sealed read that is too slow for a window, which would push sealed stretches to R2 or to fewer,
  larger objects.
- Rates far above the guesses, which would pull sealing into Tier 1.

## What it cannot tell us

- No `next/` object has grown past a few megabytes. Every cap here is a guess until one does.
- Whether 10 GB means 10^9 or 2^30 bytes, and what Cloudflare bills for stored data after a
  delete (experiment 224's open questions).
- How long sealing a million rows takes, and what a read across the seal costs.
- Whether the OTP lore above has a primary source; it is marked as a guess.
