---
date: "2026-11-07"
scripts: "`224-do-size-after-delete.ts`, `224-do-size-after-delete/` (`worker.ts`, `alchemy.run.ts`), `results/224-do-size-after-delete-local.json`, `results/224-do-size-after-delete-cloud.json`"
summary: "About Cloudflare, for `next/`'s ledger; workerd 1.20261012.1 through Alchemy's `alchemy dev`, then Cloudflare through `alchemy deploy`, destroyed after. Yes for `databaseSize`, no for the file: workerd computes it as (page_count - freelist_count) x page_size, so on Cloudflare it went 51.39 MB, 25.74 MB after deleting the older half, 0.04 MB after the rest. The local file stayed at 51.33 MB and new rows reused its free pages. `VACUUM` fails (\"cannot VACUUM from within a transaction\"), every `auto_vacuum` and `incremental_vacuum` pragma fails with SQLITE_AUTH, on a new object too. Under workerd's test cap a delete made room (7,500 rows where 6,000 fit); past it, SQLITE_FULL rolled the request back and restarted the object. Moving closed ranges to R2 and deleting them works, 85%; the real 10 GB limit and what storage is billed on were not tested. No model; $0 billed, about $0.06 at list price past the included rows."
---

# 224. Does deleting rows shrink a Durable Object?

Measured 2026-11-07. About Cloudflare itself, for `next/`'s ledger: no code from either version of
fabrika ran. One throwaway Worker, on workerd on the laptop and on Cloudflare. No model. $0 billed.

**Answer: yes for `databaseSize`, no for the file, and deleting does make room.**

- **`databaseSize` drops the moment rows are deleted.** On Cloudflare: 51.39 MB with 25,000 rows,
  25.74 MB after deleting the older half, 0.04 MB after deleting the rest. workerd computes it as
  `(page_count - freelist_count) * page_size`, so it counts only the pages in use.
- **The file does not shrink.** Freed pages stay in the file as free pages. Locally the file
  stayed at 51.33 MB through both deletes. New rows reuse the free pages before the file grows:
  writing 10 MB back left the file at 51.33 MB.
- **No vacuum works.** `VACUUM` fails with `cannot VACUUM from within a transaction: SQLITE_ERROR`.
  Every `auto_vacuum` and `incremental_vacuum` pragma fails with `not authorized: SQLITE_AUTH`,
  on a brand-new object as on a full one, locally and on Cloudflare alike.
- **A delete makes room under the size cap** (local only, through workerd's own test hook). Under
  a 3,000-page cap, 7,500 rows went in where about 6,000 fit, because the delete's free pages were
  reused. Past the cap: `database or disk is full: SQLITE_FULL`, the whole request's writes rolled
  back, and the object restarted.
- **`storage.deleteAll()` gives everything back:** `databaseSize` 4,096 bytes, and locally the
  file is one 4 KB page again.

```ts
// What workerd computes (src/workerd/api/sql.c++, cloudflare/workerd at 4b41965b96, read 2026-11-07):
//   select (select * from pragma_page_count) - (select * from pragma_freelist_count)   times page_size
sql.exec("DELETE FROM t WHERE id < 12500"); // 25,000 rows of 2,000 random bytes, now 12,500
sql.databaseSize; // 51,392,512 -> 25,739,264 on Cloudflare
sql.exec("VACUUM"); // Error: cannot VACUUM from within a transaction: SQLITE_ERROR
sql.exec("PRAGMA incremental_vacuum"); // Error: not authorized: SQLITE_AUTH
```

So the plan to move closed old ranges to R2 and delete them locally works: the space they held
is free for new appends. 85% sure. The doubt is that nobody filled a real object to 10 GB; see
[what it cannot tell us](#what-it-cannot-tell-us).

## Who did what

- **This repo's code:** `experiments/224-do-size-after-delete/` holds the Worker (one SQLite-backed
  class, `Sizer`) and its Alchemy stack. `experiments/224-do-size-after-delete.ts` is the driver.
  The Worker's door is experiment 144's: a random key per run, the Worker holds only its SHA-256.
- **Alchemy 2.0.0-beta.84** ran workerd locally (`alchemy dev`, its bundled workerd
  1.20261012.1) and deployed and destroyed the Worker on Cloudflare (`alchemy deploy`,
  `alchemy destroy`), with local state, as experiment 144 did.
- **Today's fabrika:** nothing. Compatibility date 2026-07-01 on both stages.

## How it was run

One object, `size`, went through the same steps on both stages. Every step is one request, and
the object reads `databaseSize` and its row count after it. Rows are `randomblob(2000)`, two to a
4 KB page, written 5,000 to a request. Locally the driver also opens the object's file read-only
with `node:sqlite` after each step and reads SQLite's own `page_count` and `freelist_count`,
which the object itself may not read.

A second object, `cap`, ran only locally. workerd exposes `sql.setMaxPageCountForTest(n)` only
under the `experimental` compatibility flag, which Cloudflare does not accept, so the local stage
alone sets that flag. It is how workerd's own tests (`src/workerd/api/tests/sql-test.js`) make
`SQLITE_FULL`.

The cloud run used the Worker as first written. After it, the object's constructor was changed to
keep `ctx` under a narrow type without an `as` cast, for a lint rule; the local run after that
change gave the same bytes at every step.

## The numbers, per step

`databaseSize` in MB. "File" is the local object's main SQLite file, without its WAL (the WAL sat
at about 10.3 MB while data was written, and at 0 after `deleteAll`).

| Step | Local `databaseSize` | Local file | Local free pages | Cloudflare `databaseSize` |
|---|---|---|---|---|
| New object | 0.00 | 0.00 (1 page) | 0 | 0.00 |
| Create the table | 0.01 | 0.00 | 0 | 0.01 |
| Insert 25,000 rows (5 requests) | 51.33 | 51.33 (12,531 pages) | 0 | 51.39 |
| Delete ids below 12,500 | 25.67 | 51.33 | 6,263 | 25.74 |
| Delete the rest | 0.01 | 51.33 | 12,529 | 0.04 |
| Insert 5,000 rows again | 10.27 | 51.33 | 10,023 | 10.29 |
| `storage.deleteAll()` | 0.00 | 0.00 (1 page) | 0 | 0.00 |

- Each insert of 5,000 rows added 10.27 MB on both stages, so the two runtimes count alike.
  Cloudflare's numbers sit 4 to 64 KB above local's (64 KB at 25,000 rows, 32 KB once the table is
  empty). Its own bookkeeping is the likely reason; a guess.
- On Cloudflare, `databaseSize` fell by 32 KB between "delete the older half" and the probe right
  after it, with no write of ours in between. Not explained.
- Five seconds after `deleteAll`, both stages still read 4,096 bytes.

The probe (each statement on its own, on the new empty object and again after the first delete)
gave the same answer both times on both stages:

| Statement | Answer |
|---|---|
| `PRAGMA page_size` | 4096 |
| `PRAGMA page_count`, `PRAGMA freelist_count`, and the `pragma_page_count()`, `pragma_freelist_count()` table forms | `not authorized: SQLITE_AUTH` |
| `PRAGMA auto_vacuum`, `= 1`, `= 2`, `= INCREMENTAL` | `not authorized: SQLITE_AUTH` |
| `PRAGMA incremental_vacuum`, `PRAGMA incremental_vacuum(100)` | `not authorized: SQLITE_AUTH` |
| `VACUUM` | `cannot VACUUM from within a transaction: SQLITE_ERROR` |
| `SELECT count(*) FROM dbstat` | `no such table: dbstat: SQLITE_ERROR` |

Experiment 93 already saw `VACUUM` refused in Miniflare for the same reason
([its table](./93-ledger-miniflare.md#same-sql-two-drivers-every-difference-hit)). This run adds
the vacuum pragmas, a brand-new object, and Cloudflare itself.

## Does a delete make room under the cap?

Local only, the `cap` object, with the page cap set to 3,000 pages (12.3 MB), room for about
6,000 rows.

| Step | `databaseSize` | File pages | Free pages |
|---|---|---|---|
| Insert 5,000 rows | 10.27 | 2,508 | 0 |
| Delete the older 2,500 | 5.14 | 2,508 | 1,253 |
| Insert 2,500 more (7,500 written in all) | 10.27 | 2,508 | 0 |
| Insert 2,500 more, past the cap | `database or disk is full: SQLITE_FULL` | | |
| The next request | 10.27, 5,000 rows | 2,508 | 0 |

- The insert after the delete fit into the freed pages: the file did not grow by a page.
- Past the cap, the failure was not a caught error inside the object. The Worker's call to the
  object threw, the 2,500-row batch was rolled back whole, and the next request met a fresh
  instance (its WAL was empty). workerd's own test says the same: `SQLITE_FULL` is a critical
  error that breaks the object's output gate.

## What it means for moving ledger ranges to R2

- **The plan holds.** Deleting a closed range frees its pages, and the next appends fill them
  before the file grows. So the room left is the limit minus `databaseSize`, whether Cloudflare's
  10 GB limit counts live pages or all pages in the file.
- **`databaseSize` is the right gauge,** and the only one: the object may not read `page_count`
  or `freelist_count`.
- **Never meet the limit.** `SQLITE_FULL` throws away the whole request's writes and restarts the
  object. The ledger should move and delete ranges while there is still room, with a margin. This
  run does not set the number.
- **Delete whole ranges.** A range of consecutive ids empties whole pages, which go to the free
  list. Scattered deletes (not tried) would leave half-empty pages that do not show up as free.
- **On the laptop the file never shrinks** after a delete. The local stage's file keeps its high
  mark until `deleteAll`. That is disk on the person's machine, not a limit.

```ts
// Sketch, not a design: the one check the ledger needs before a batch of appends.
const roomLeft = LIMIT_BYTES - ctx.storage.sql.databaseSize; // LIMIT_BYTES from Cloudflare's limits page
if (roomLeft < margin) yield* moveClosedRangesToR2; // then DELETE them; the pages are reused
```

## Cost

| Item | Amount | Price (Workers Paid, pricing page updated 2026-10-18) |
|---|---|---|
| Rows written | about 60,000 (deletes count as writes) | 50 million a month included, then $1.00 per million |
| Rows read | about 130,000 (a `count(*)` after each step) | 25 billion included, then $0.001 per million |
| Requests | 15 to the Worker, 14 of them on to the object | 1 million included |
| Stored | 51 MB for under a minute | 5 GB-month included |

Before the run, the account's GraphQL analytics showed 96,734 rows written this month, far under
the 50 million included. So the bill is $0. At list price past the included amounts it would be
about $0.06. The local runs cost nothing. No model was called. Prices from
<https://developers.cloudflare.com/durable-objects/platform/pricing/>, read 2026-11-07.

The Worker `tf-exp-224-size` was deployed, run once, and destroyed by `alchemy destroy` (exit 0).
A listing of the account's Workers and Durable Object namespaces right after found none with
`tf-exp-224` in its name. Alchemy's state stays in the git-ignored `.alchemy/` folder.

## What it cannot tell us

- **The real 10 GB limit was not reached.** The cap test used workerd's test hook, which sets
  SQLite's `max_page_count`. That the production limit works the same way is a guess from
  workerd's code and tests. Filling one object on Cloudflare would settle it: about 5.2 million
  rows of 2 KB, which is inside the included rows written, so about $0 and some minutes of
  requests. Not done here.
- **What storage is billed on.** The pricing page bills "SQL stored data" and does not say
  whether that is `databaseSize` or the file with its free pages. If it is the file, deleting
  stops the growth of the bill but does not lower it.
- **Scattered deletes, indexes and small rows.** Rows here were 2,000 bytes with no index but the
  primary key. A ledger row is smaller and has indexes; pages freed per row deleted will differ.
- **Timing.** Inside the object, Cloudflare's clock does not move while code runs without I/O, so
  every per-step time on Cloudflare reads 0 ms. Times were not the question.
- **One run per stage.** The numbers are byte-exact and repeatable locally (two local runs gave
  the same sizes); on Cloudflare it ran once.

## How to run it

```sh
(cd experiments/224-do-size-after-delete && nice -n 15 pnpm install --ignore-workspace)   # once
env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/224-do-size-after-delete.ts local
env -u TYPESAFE_API_KEY CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account> \
	nice -n 15 node --no-warnings experiments/224-do-size-after-delete.ts cloud
```

Each writes `results/224-do-size-after-delete-<stage>.json`. The local run takes about 10 s; the
cloud run about 15 s, deploy and destroy included.
