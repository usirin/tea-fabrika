---
id: 0038
title: The span sink's raw row per ended span is a measurement and its hourly row per piece is a metric, OpenTelemetry's words, never health row and summary
status: accepted
date: 2026-11-09
tags: [names, measurement, metric, health, summary, opentelemetry, span-sink, next]
---

# 0038: The span sink's raw row per ended span is a measurement and its hourly row per piece is a metric, OpenTelemetry's words, never health row and summary

**What this decides:** in `next/`, the row the span sink writes for each ended span is called a
measurement, and the hourly row it rolls those up into, one per piece, is called a metric.

```ts
// A sketch of the two shapes, before and after. Only the names change, no field.
// before (data/trace.ts on main)
const Health = Schema.Struct({ piece, at, ms, ok, error, lag, spanId })
const Summary = Schema.TaggedStruct("summary", { piece, hour, count, errors, ms: { p50, p95, max }, lag })

// after (the type names in code are the rename plan's to pick, see Consequences)
const Measurement = Schema.Struct({ piece, at, ms, ok, error, lag, spanId })
const Metric = Schema.TaggedStruct("metric", { piece, hour, count, errors, ms: { p50, p95, max }, lag })
```

## Context

P37 built the span sink with "health in two levels": a raw `health` row per ended span, and an
hourly `summary` per piece (`next/packages/libfabrika/src/data/health.ts`, `trace.ts`, `sink.ts`).
The owner renamed both words on 2026-11-09, by
[use the industry's names](../docs/direction/use-the-industrys-names.md). Tracker ticket 494.

Two reasons:

- **"Health" already means something else in the industry:** a health check, an up-or-down answer,
  as in Kubernetes'
  [liveness, readiness and startup probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/).
  Our rows hold timing, success and an error class per piece. The industry calls that metrics.
- **"Summary" clashed with Effect.** Effect's own `Metric` module has `Metric.summary`, one specific
  meter that "calculates quantiles over a sliding time window of observations" (`effect@4.1.2`,
  `src/Metric.ts`). Ours is an hourly rollup, not that meter.

**What the OpenTelemetry specification says,** read from its source on 2026-11-09:

- A measurement is one recorded value.
  "A `Measurement` represents a data point reported via the metrics API to the SDK", and it holds
  a value and attributes
  ([Metrics API, Measurement](https://opentelemetry.io/docs/specs/otel/metrics/api/#measurement)).
  The API's first purpose is "capturing raw measurements"
  ([Metrics, concepts](https://opentelemetry.io/docs/specs/otel/metrics/#api)).
- A metric is what aggregation makes of them. An `Aggregation` "informs the SDK on the ways and
  means to compute Aggregated Metrics from incoming Instrument Measurements"
  ([Metrics SDK, Aggregation](https://opentelemetry.io/docs/specs/otel/metrics/sdk/#aggregation)).
- A metric is a named stream of points. "Metric streams are grouped into individual `Metric`
  objects", and "Metric points are the basic building blocks of metrics"
  ([Metrics data model](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#opentelemetry-protocol-data-model)).

So the split fits: a measurement goes in, an aggregation runs, a metric comes out. Two places where
the specification is more exact than our two words, written down so nobody is surprised later:

- **One hourly row is one metric point, not a whole metric.** In the specification the metric is
  the whole stream for a piece, and each closed hour is one point of it. We say "a metric" for the
  row in everyday talk, and "metric point" when it matters.
- **One of our rows carries more than one value.** A specification measurement is one value with
  attributes. Our row has two values (`ms`, `lag`) and three attributes (`piece`, `ok`, `error`).
  It is the measurements of one ended span, kept as one row.

One more thing the specification says, about the old word: its data model also has a `Summary`
point, for "quantile summaries", which is "not recommended for new applications"
([Summary (Legacy)](https://opentelemetry.io/docs/specs/otel/metrics/data-model/#summary-legacy)).
Our hourly row holds a p50, a p95 and a max, so it is close to that point kind. That matters only
when we send these rows in OTLP, and it is part of the experiment below.

## Decision

**In `next/`, a measurement is the span sink's raw row for one ended span, and a metric is its
hourly aggregation per piece; nothing in `next/` calls them a health row or a summary.**

- **measurement** replaces **health row**: one row per ended span, in the object that ended it.
- **metric** replaces **summary**: one piece's closed hour. One row is a metric point.
- "Health" is kept for an up-or-down check, if `next/` ever has one.
- The fields, the tables' contents, how long rows are kept and P37's laws do not change. Only the
  names do.
- `piece`, `lag`, `rollup`, `archived` and `sizes` keep their names.
- **The rename itself is code and is not in this pull request.** It rides with the library layout
  move. It is cheap now, because nothing real is stored in `next/` yet. Later it needs a data
  migration: the table names and the archive keys are stored.

What the rename covers, read from main on 2026-11-09. Paths are under
`next/packages/libfabrika/src/` unless they start with `next/`.

| What | Today | Becomes |
|---|---|---|
| File | `data/health.ts` and its test `data/health.test.ts` | a name without "health", picked with the layout move |
| Table and index | `health`, `health_by_at` | `measurement`, `measurement_by_at` |
| Table | `summary` | `metric` |
| Table | `summarized`, the hours already rolled up | a name without "summary", picked in the rename's plan |
| Type | `Health` (`data/trace.ts`, exported by `data/index.ts`) | `Measurement` |
| Type and tag | `Summary`, `_tag: "summary"` (`data/trace.ts`, `data/index.ts`) | `Metric`, `_tag: "metric"` |
| Service call | `SpanSink.summaries(from, to)` (`data/sink.ts`) | `SpanSink.metrics(from, to)` |
| Functions and constants in `data/health.ts` | `HEALTH_TABLES`, `HealthColumns`, `decodeHealth`, `healthRows`, `toHealth`, `writeHealth`, `summarize`, `decodeSummary`, `readSummaries` | the same with measurement and metric |
| Field | `Ended.health` (`data/sink.ts`) | `Ended.measurement` |
| Archive key | `health/<object>/<day>.jsonl` (`partKey` in `data/health.ts`) | `measurement/<object>/<day>.jsonl` |
| R2 bucket and binding | `Health`, `health` (`next/apps/fabrika/alchemy.run.ts`), `env.HEALTH` (`workers/runtime.ts`, `workers/control.ts`) | follows the archive key; picked in the rename's plan |
| Glossary rows | `health row`, `summary`, and the words inside `piece`, `archived`, `lag` | done in this pull request |
| P37's laws | p101, "health in two levels" in [the detail](../docs/plan/tier-1-detail.md), and the old words in p98 and p99 | renamed with the code |

The tests that say the old words change with the code: `data/health.test.ts`, `data/sink.test.ts`,
`app/effect-functions.test.ts`, `app/runner-supervision.test.ts`,
`coordination/process-spans.test.ts`, `node/stage-secrets.laws.test.ts`,
`node/supervision-spans.test.ts`, `workers/readers.laws.test.ts`,
`next/apps/fabrika/src/stage-records.test.ts` and `next/apps/fabrika/src/exam/twin.test.ts`. The
last is an exam file, so that part goes through the test writer.

Not renamed: `healthy` and `healthyAt` in the supervisor (`app/supervisor.ts`,
`coordination/recovery.ts`) mean a process stayed live long enough to reset its backoff. That is a
health check in the industry's sense, so the word is right there. The job's own `summary` in
[a JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md) is another thing
and is not touched here.

**Binding constraints:**

- No new code, note or plan in `next/` says health row or summary for these two rows.
- The rename lands before anything real is stored in `next/`. If it has not, it comes with a data
  migration and its own plan.
- The rename changes no law: same fields, same rules, new names.

## Consequences

- One code change is owed, with the layout move. Until it lands, the code and the plan rows still
  say `health` and `summary`, and the glossary rows say so.
- A type named `Metric` in our code meets Effect's module `Metric` in any file that imports both.
  The word is decided here; the name in code (for example the module it is read through) is the
  rename plan's to pick so the two do not collide.
- The plan rows and notes that say the old words
  ([Tier 1](../docs/plan/tier-1.md), [its detail](../docs/plan/tier-1-detail.md),
  [the five layers](../docs/direction/a-local-first-sync-engine.md),
  [design for bounded objects](../docs/direction/design-for-bounded-objects.md)) are changed with
  the rename, not here.
- Coming, not decided here: the layout decision will name the folder that holds spans plus these
  rows `telemetry/`.
- Not decided here:
  - **Why ours are saved rows and not Effect's in-memory `Metric`.** The lean: an object is shut
    down between requests, so meters in memory reset. Nobody has written that up or tested it.
  - **Sending in OTLP at flush,** so any OpenTelemetry collector, including one of our own objects,
    can receive them. An idea to try later. Effect ships `effect/observability/OtlpMetrics` in the
    installed 4.1.2, marked `@stability unstable`, and its own doc says it is "meant for
    long-running services". Tracker ticket 495 is that experiment.

## Records

- [`.glossary/TERMS.md`](../.glossary/TERMS.md): `measurement` (renamed from `health row`) and
  `metric` (renamed from `summary`), with the new words in `piece`, `archived` and `lag`.
