# 276: isolate CPU recording and the first wall measurements

`next/` only, P34c slice 3, tracker ticket 852. The local tail probe received every call's
event, but its CPU and wall fields were always zero. The full measurement is **not yet run**.
No quota or time limit is set by this slice.

## The host probe

The lead ran the probe on 2026-11-11 at commit `3c6238f9c`, through Alchemy
2.0.0-beta.85 and workerd 1.20261026.1. This build uses that record and did not repeat it.
The probe code stays outside the repo.

- A Worker Loader isolate delivered exactly one `TraceItem` for each of 13 RPC calls.
  All 13 events arrived, 0 to 11 ms after the answer. A load with no tails delivered 0 events.
- Props supplied through the `ctx.exports` tail binding reached `this.ctx.props`.
- Six spins of about 1.17 s each, and six idle calls, all reported `cpuTime: 0` and
  `wallTime: 0`. The method and outcome were correct.
- Timing fields were prototype getters. Reading only own properties would miss them.

This selects the plan's zero-CPU branch. The product keeps the platform's zero reading.
U9's spin-above-idle requirement is not met by this probe; its assertion stays unchanged.
The probe did not test a tail bound inside a Process object, a throwing call, `exceededCpu`
or isolate eviction. The host must still run the product's U9 scenario.

## What the product records

Each loaded program gets one tail bound to its project, registered name and process.
The cache key is still the program hash plus the process. A late batch therefore keeps
the process that ran, even after replacement. Bootstrap loads have no tail.

The tail reads only method, CPU, wall time and outcome. It sends one batch to the name's
Process object. That object records one `isolate.cpu` span per call, whose duration is CPU
time. Wall time is `fab.isolate.wall_ms`; method, outcome and process are separate attributes.
The sink writes the batch in one transaction and holds the whole batch after a failed write.

A usage call has its own `process.usage` span in the receiving object's sink. If delivery
cannot reach that object, the tail logs only the error class and drops the batch. It has
no sink of its own. It never reads exception messages, stacks or log lines, and the program
step does not wait for delivery. The measurement must compare calls and rows to count loss
or duplicate delivery.

The receiving object's services enclose `process.usage` itself, so both a decoded batch and
a rejected batch leave that call's span. The tail callback runs through Alchemy's Worker bridge,
which supplies the invocation's props. Alchemy also creates the loopback tail binding and wraps
the usage RPC. The trace adapter takes Alchemy's tail event type. The existing loader still
accepts native code options; the bound Alchemy fetcher's `raw` is passed only at that old boundary.
The host must validate this wiring, including a failed usage call's saved span.

## Measurement still owed on the host

The box cannot open the local instance's ports. No load, fixture run or calibration sample
was taken here. Run one local instance at a time through Alchemy, with Node 26.13.0 and the
locked dependencies. Keep `TYPESAFE_API_KEY` unset. Use an ephemeral test identity and a fresh
scoped home; do not read a person's key or the control token.

First run the existing real-instance scenario on the host or in its test container:

```sh
nice -n 19 pnpm exec vitest run --maxWorkers=1 next/apps/fabrika/src/worker-usage.test.ts
```

It must check checklist step and replay-fold row counts and attribution, including a successor.
Its spin assertion must keep failing if local CPU is zero. Save that reading, rather than
weakening the law.

Keep the measurement script on a separate branch, proposed name `p34c-walls-measurement`.
That branch and script have **not yet been created**. They must not enter main. The host run
needs the following work, using the built program and the existing local-instance test setup:

The approved build paths include only this write-up and its index, with no measurement script
path. Creating `experiments/276-p34c-walls.ts` on that separate branch needs the lead to add it to
the plan. The script is still owed; this checklist is not an executable measurement.

1. Build the checklist and two fixtures. One throws on a chosen message for restart timing;
   one spins a fixed loop and also accepts an idle message. Acquire the instance, homes,
   database handles, clients and timers in scopes.
2. Drive add, rename, check, uncheck and remove from two clients, both at a fixed rate and
   in bursts. Save the actual rate, duration, message counts and fixture loop count with the
   run. A load script stands in for the chaos program, which is not on main.
3. Read raw `isolate.cpu` and `execution.step` health rows. Count them against successful
   execution calls by process and method after delivery has drained. Save missing and surplus
   row counts as well as errors and restarts.
4. Derive writes per minute per program from ledger `arrivedAt`, stored bytes from entry sizes
   and object `size` rows, and restart latency from matching `exited` and `started` entries.
   Keep raw rows private, through an output-path flag. Record date, commit, versions and load.
5. Because local tail CPU is zero, time the same built program's pure step on Node too.
   Label those samples `Node pure-step elapsed`, a different source from platform CPU.
   Include checklist and idle/spin fixture samples. Do not relabel them as cloud CPU.
6. Report sample count, p50, p95, p99 and max for each measure. Use nearest-rank percentiles,
   `sorted[ceil(p * count) - 1]`, and report no percentile for an empty sample. Propose ten
   times each measured p99 for the later slices. Keep the decided storage cap at
   1,000,000,000 bytes. This slice sets none of those limits.

## Results

These are the full run's results, separate from the 13-call probe above. No sample count of
zero is claimed for a run that did not happen.

| Measure and source | Samples | p50 | p95 | p99 | Max | Proposed limit |
|---|---|---|---|---|---|---|
| CPU per call, platform `isolate.cpu` | not yet run | not yet run | not yet run | not yet run | not yet run | not yet run |
| Pure-step elapsed, Node fallback | not yet run | not yet run | not yet run | not yet run | not yet run | not yet run |
| Elapsed per step, `execution.step` | not yet run | not yet run | not yet run | not yet run | not yet run | not yet run |
| Writes per minute per program, ledger | not yet run | not yet run | not yet run | not yet run | not yet run | not yet run |
| Stored bytes per program, entries and size rows | not yet run | not yet run | not yet run | not yet run | not yet run | 1,000,000,000 bytes, decided cap |
| Restart latency, ledger | not yet run | not yet run | not yet run | not yet run | not yet run | not yet run |

The full run's date, instance, commit, load settings, call counts, row counts and private
sample location are **not yet run**. Later slices cannot pin measured limits from this table yet.

## What this cannot tell us

The probe proves local loader tail delivery, not the product's Process-object wiring.
It gives no usable local CPU or wall timing. Node elapsed timings are still owed and will
not establish cloud CPU. Neither the full run nor eviction and duplicate-delivery checks have
run. The extra cloud RPC cost and whether ten times p99 is enough remain unmeasured.
