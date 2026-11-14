---
date: "2026-11-10"
summary: "`next/`, at `f678d742c`, on `node:sqlite`. One tag (`fab.outcome`, the five verbs, else `other`) and one count (a sum point per piece, hour and outcome) in about 100 lines; five tests green. Yes for storage, no for reading. A tagged row grows 48 to 52 bytes; aggregates grow by `P + 6` rows an hour, never with spans; three tags split jointly reach 125 per piece-hour. At 50 spans per run (a guess) over 132 runs a day, about 0.57 MB of measurements a day against 10 GB per object. Missing: a reader across objects, mergeable histograms, a monitor, a window; nothing reads metrics today. The sink drops two outcome tags pieces already write, and a late span is counted nowhere. Lean, about 70%: rows in the sink, tags one by name, next work on the read side. No model, agent time only."
---

# 255. Can `next/`'s span sink, as built, carry the primitives of a metrics product at one team's scale?

Measured on 2026-11-10, on a spike, on main at `f678d742c`. The spike code stays on the branch
`fabrikalfa/exp-metrics-spike`; only this write-up and its index row go to main. **Every claim is
about `next/`** (`next/packages/libfabrika/src/telemetry/`), never today's version. One agent read,
built and counted. No paid model was called beyond the agent itself, and no platform runtime was
started: the store was `node:sqlite`.

**The answer: yes for storage, no for reading.** One tag and one count fit the sink with about 100
lines, and the data is small: a tagged step adds 4 bytes to its measurement row and at most 5 rows an
hour per piece. What a metrics product needs and the sink lacks is on the read side: nothing reads the
metrics today, each object holds only its own, and its percentiles cannot be merged across hours or
objects. The spike also found that the sink already drops the outcome tags two pieces write, and that
a late span is counted nowhere.

```ts
// A span that ends with a step's outcome...
yield* step.pipe(Effect.withSpan("lane.step", { attributes: { "fab.outcome": "stuck" } }));

// ...keeps it in its measurement row (bucketed: a value off the five verbs becomes "other"),
{ piece: "lane.step", at, ms, ok, error, lag, spanId, outcome: "stuck" }

// ...and the hourly rollup writes one sum point per piece, hour and outcome, beside the metric point.
{ _tag: "metric", piece: "lane.step", hour, count: 100, errors, ms: { p50, p95, max }, lag }
{ _tag: "sum", piece: "lane.step", hour, outcome: "stuck", count: 20 }

// A window reads one piece over a range of hours, split by outcome.
yield* sink.sums("lane.step", from, to); // SumPoint[], oldest first, then by outcome
```

## What the spike changed

Four files, all in `next/packages/libfabrika/src/telemetry/`:

- `Trace.ts`: `OUTCOME = "fab.outcome"`, `Outcome` (the five verbs from `.glossary/TERMS.md`,
  "outcome"), `MeasuredOutcome` (a verb, `other`, or null), an `outcome` field on `Measurements`, and
  `SumPoint`, OpenTelemetry's sum point (delta, monotonic) with one attribute.
- `internal/measurements.ts`: an `outcome` column, a `sums` table keyed by piece, hour and outcome,
  the split inside `rollup`, `readSums`, and `measuredOutcome`. The archive line keeps the outcome.
- `Sink.ts`: the measurement reads `fab.outcome` from the span's kept tags, and `SpanSink.sums(piece,
  from, to)` rolls up closed hours first, as `summaries` does.
- `internal/sums.test.ts`: five tests, all green. A fast-check property (seed 119120, 20 runs, up to 60
  spans over two pieces) checks every count per piece, hour and outcome against the spans written. One
  test reads a range and split. One sends `"maybe"` and `7` and gets `other`, with the raw values still
  in the span rows. One shows the late span. One prints the counts below.

**An unknown value is bucketed as `other`, not refused.** A span's `end` cannot fail, and the sink's
rule is that nothing is dropped (`Sink.ts:5-8` on main). Bucketing caps the split at 6 values, and the
span row keeps the raw value for anyone who needs it.

**A late span is counted nowhere, as the sink already does it.** A span whose end reaches the sink
after its hour rolled up is kept raw and archived, but neither the metric point nor the sum counts it:
an hour in `aggregated` never rolls up again (`internal/measurements.ts:117-125` on main). The spike
keeps that, so the metric's `count` and the sums agree. A sum could take a late row by an upsert; a
p95 cannot. It is rare: the end time comes from the same clock that drives the rollup, so it needs a
span ended with an explicit older time.

## The numbers

Each number is a count of rows from `count(*)`, or bytes from SQLite's own `dbstat` table (`payload`
is the stored record, `pgsize` the pages). No clock was read (0065). The run: 1,000 spans of one
piece over 10 hours, 100 an hour, the five verbs in turn; once without the tag, once with it.

| Per 1,000 spans | Without the tag | With the tag |
|---|---|---|
| measurement rows | 1,000 | 1,000 |
| unsent span rows, until the next flush | 1,000 | 1,000 |
| metric rows (10 hours x 1 piece) | 10 | 10 |
| sum rows (10 hours x 5 verbs) | 0 | 50 |
| measurement record, bytes per row | 48 | 52 |
| measurement table pages, bytes per row | 57.3 | 65.5 |
| `measurements_by_at` index pages, bytes per row | 20.5 | 20.5 |
| unsent span row record, bytes per row | 378 | 398 |
| metric record / sum record, bytes per row | 49 / none | 49 / 25 |

"Without the tag" ran the spike's schema with a null `outcome`. Main's schema has no such column; a
null costs one header byte in an SQLite record, so main's row is about 47 bytes (arithmetic from the
record format, not measured).

**Rows grow with hours, pieces and values, never with spans.** Per hour, the sink writes at most
`P + T x V` aggregate rows: `P` metric rows for the pieces that ended a span, plus `V` sum rows for
each of the `T` pieces that carry the tag. Only values that occur get a row.

- One tag, 5 values (6 with `other`), only the step piece tagged: `P + 6` rows an hour at most.
- The same tag on all 123 distinct span names in `next/` product code (counted with `rg` over
  `Effect.fn("…")` and `withSpan("…")`): at most 123 + 738 = 861 an hour.
- Three tags of 5 values each, split one tag at a time: 15 sum rows per tagged piece-hour. Split by
  all three at once: 5^3 = 125 (216 with `other`), so 123 pieces could reach 15,375 sum rows an hour.
  This is where it grows, and it is the industry's cardinality problem: OpenTelemetry's SDK caps each
  metric at 2,000 attribute sets by default
  ([Metrics SDK, cardinality limits](https://opentelemetry.io/docs/specs/otel/metrics/sdk/#cardinality-limits)). A split by all tags at once should not be the default.

**One team's volume.** `field/runs.jsonl` holds 1,324 agent run rows dated 2026-11-01 to 2026-11-10,
10 days: 132 a day on average. The busiest day in the file is 2026-10-30, with 2,059. My assumption,
a guess: one agent run ends 50 spans in `next/` (its step, ledger appends, gateway envelopes, tool
calls). At 86 bytes per measurement row (table plus index pages):

- An average day: 6,620 spans, about 0.57 MB of measurements. The 336 local hours hold about 8 MB; a
  month writes about 17 MB, most of it gone to R2 after two weeks.
- A day like 2026-10-30: 102,950 spans, about 8.9 MB. Two weeks of such days: about 124 MB.
- At 500 spans per run instead of 50, everything raw is ten times that: still about 1.2 GB for two
  weeks of peak days.
- The aggregates are small. Sums for the step piece: at most 120 rows a day, 3,600 a month, about 90 KB.
  Metric points for 30 pieces active every hour: 720 a day, about 1 MB a month, kept forever.

**The store's limits,** from Cloudflare's Durable Objects limits page (last updated 2026-11-07, read
2026-11-10): 10 GB of SQLite per object, unlimited per account on the paid plan, 8 MB per row, string or
BLOB, 100 columns per table, 100 KB per statement and 100 bound parameters per query. Each object holds
only the rows of the spans it ended, so the real load per object is a share of the numbers above.

## Each primitive of a metrics product

Line numbers are on main at `f678d742c`, under `next/packages/libfabrika/src/` unless the path says
otherwise.

- **Traces: have it.** `SpanRow` in OTLP's field names (`telemetry/Trace.ts:40-55`), shipped to each
  process's record by `flush` (`telemetry/Sink.ts:358-387`).
- **Logs: have it,** as span events: `Effect.log*` lands on its span, and the sink keeps the events
  (`telemetry/Sink.ts:123-127`, decision 0024). There is no search over them.
- **A count: have it** per piece and hour, with errors (`telemetry/internal/measurements.ts:107-108`).
  The split by a tag is a small change: this spike.
- **A gauge: have two, fixed.** The object's size, at most once an hour (`writeSize`,
  `internal/measurements.ts:151`), and the worst `.lag` tag per hour (`:110`, from
  `telemetry/Sink.ts:109-114`). A general gauge is a small change: keep a numeric tag the way `lag` is
  kept.
- **A histogram or percentile: have exact p50, p95 and max per piece-hour**
  (`internal/measurements.ts:109`). Real work to make them merge: a p95 over a day or over objects
  cannot come from hourly p95s, and the raw rows leave for R2 after 336 hours. OpenTelemetry's answer
  is a bucketed histogram point (explicit or exponential buckets), which adds up.
- **Tags: the span keeps them, the measurement drops them.** Span tags are kept on the span row
  (`telemetry/Sink.ts:122` and `:139-143`), but the measurement keeps only the error class and the
  lag (`:167-175`). Two pieces already tag an outcome that no metric can split by:
  `fab.gateway.outcome` (`gateway/Gateway.ts:1375`) and `fab.authorization.outcome`
  (`access/Authorization.ts:43` and `:47`). One tag is a small change; a general list of kept tags is
  real work, because it needs a cardinality rule.
- **A query by range and split: small change inside one object, real work across them.**
  `SpanSink.summaries(from, to)` reads one object's points, with no piece filter and no split
  (`telemetry/Sink.ts:215`, `:389-397`). The spike adds `sums(piece, from, to)`. Across objects
  nothing exists: each object's SQLite holds its own rows, and no reader fans out.
- **A monitor: not there, real work.** No product code calls `summaries`: the only callers are tests.
  A check over the rollup that raises an ask needs a place to run. The rollup runs inside a span's end
  (`telemetry/Sink.ts:274-280`), with no timer by design (`:5-6`), so a quiet object would never check.
- **A dashboard: not there, real work.** No window reads a metric. It needs the cross-object reader
  first, then a program's window. Volume is not the obstacle at this scale.

Effect's own `Metric` module (`effect@4.1.2`, `node_modules/effect/src/Metric.ts`) has the same
primitives: `counter`, `gauge`, `histogram`, `summary`, `frequency` (a count per string value, the
same shape as this split, `:2592`) and `withAttributes` (`:3668`). Its registry is a `Map` in memory.
0038's lean, that an object's memory resets between requests so saved rows are needed, is still untested.

## What it tells us for fabrika

**Lean: keep metrics as rows in the span sink, add tags one at a time by name, and spend the next
work on the read side,** in this order: a reader that merges one piece's points across objects, a
bucketed histogram beside the exact percentiles, then a monitor, then a window.

- **Why:** the storage cost is small and known (4 bytes a row, `P + 6` rows an hour), and the gaps
  that block a product are all on reading. A closed list per tag keeps cardinality bounded by type,
  which is how the sink already treats `error` (a class, never a message).
- **What it costs:** this spike's shape is about 100 lines in four files. A stored column needs a data
  migration once real rows exist, since `CREATE TABLE IF NOT EXISTS` does not add a column to an old
  table; 0038 says the same of the rename.
- **How sure: about 70%.** The doubts: the 50 spans per run is a guess; the bytes come from
  `node:sqlite`, not workerd's SQLite; and only one piece was tagged. Counting the spans of one real
  `next/` lane, and reading `Sql.size()` on workerd before and after a tagged day, would settle the
  first two.

Two smaller findings:

- `field/runs.jsonl`'s step rows are today's version and mostly do not use the five verbs: of 327 rows
  with a step, 176 say `pass`, 58 `stopped`, 57 `fail`, 24 `parked`, and only 12 use a verb (8 `skip`,
  3 `done`, 1 `stuck`). A closed list on `next/`'s side would bucket all of today's words as `other`.
- The late span is counted nowhere. Fine while it stays rare; it should be a written rule before a
  monitor reads counts.

## Added 2026-11-11: counts from today's recorded runs

Today's version, not `next/`. Read-only, from the 85 job records today's app keeps on the owner's
laptop, one SQLite file per job.

- **An agent run holds few spans.** 121 spans named `run` were found. Counting each with the spans
  under it: the median is 1, nine in ten hold 10 or fewer, and the largest holds 86. So the guess
  above of 50 spans per run is high for today's recording. `next/` records more inside a run
  (ledger appends, envelopes), so this bounds the guess from below and does not replace it.
- **One poll is nearly everything.** Of 2,047,223 saved spans, 2,046,647 are named `POST`: the
  ledger read poll, about 1.9 a second, traced by the HTTP client. One tracker window open for 62
  hours wrote 432,501 spans and a 173 MB record. The volume risk is a span per poll, not agents.
- The owner decided the rule the same day:
  [0124](../.decisions/0124-metrics-stay-rows-and-reading-comes-next.md), a poll with no news is
  never a saved span.

## What it cannot tell us

- How many spans a real `next/` lane ends. No real lane runs on `next/` yet, so every day and month
  number rests on a guess.
- Workerd's real bytes. `dbstat` ran on `node:sqlite`; workerd may not offer it, and the sink there
  sees only `Sql.size()`.
- Whether a merged read across many objects is cheap. Nothing like it was built or counted.
- Whether a monitor fits the "no timer" rule. The spike did not try one.
- Whether the spike is fit for main. It is not meant to be: `pnpm typecheck` passes, but `pnpm lint`
  fails its layer gate on one edge, the test's import of the Node SQLite driver from the ledger room.
  The sink's own tests make the same import and are on the gate's declared list; a real build would
  read the driver through a suite, as 0062 says.
