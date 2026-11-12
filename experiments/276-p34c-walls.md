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
or isolate eviction. The later host check below covers the Process-object wiring.

## The host product check

The lead's 2026-11-12 host record confirms that the product's tail works on the real local
instance. A probe using U9's setup recorded 8 `isolate.cpu` rows for `checklist:1`: describe 1,
init 1, admit 3 and step 3. Each had the right process and outcome `ok`. A successor after
restart recorded 2 rows with its own process id, and `spin:1` recorded 6 rows.

Removing the `tails` line from `cloudflare/index.ts` made every count 0 with no other change.
The lead restored it after the plant. This proves the metadata bindings reach the prebuilt
Worker, the loader delivers to the bridge class, and the init listener runs in that bundle.

All 16 of 16 rows reported CPU 0 and wall time 0. The spinning step used 40,000,000 loop turns;
its enclosing-span readings were 37 ms and 272 ms. Local platform CPU therefore remains an
unusable measurement. The Node pure-step timing source is still needed.

The corrected U9 sends through the signed door and separates row checks from the CPU
comparison. The lead's 2026-11-12 08:40 host record reports 1 passing test and 1 expected
failure. The passing test covers checklist steps and successor replay folds. Only the CPU
comparison is an expected failure, with its assertion unchanged and local CPU still 0.
The lead also confirmed that removing the loader tail makes U9 fail.

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
a rejected batch leave that call's span. The app exports Alchemy's Worker bridge as `IsolateTail`.
Worker init registers its tail listener through Alchemy's `listen`; the library reads each
invocation's props from `WorkerExecutionContext` and bindings from `WorkerEnvironment`.
The tail has no deploy-time Worker import and runs no Promise bridge of its own.
`IsolateTail` and `RecordPart` share one entrypoint and metadata object. The stack name and
instance come from Alchemy's `ALCHEMY_STACK_NAME` and `ALCHEMY_STAGE` bindings, checked as
nonempty strings at module load. Neither is fixed to the laptop's values.
Alchemy also creates the loopback tail binding and wraps
the usage RPC. The trace adapter takes Alchemy's tail event type. The existing loader still
accepts native code options; the bound Alchemy fetcher's `raw` is passed only at that old boundary.
The Process caller supplies the sink's batch operation; the runtime value imports no telemetry.
The host check above confirmed the metadata bindings, loader tail delivery and init listener.
A failed usage call's saved span still needs a host check. Missing metadata fails decoding
with the missing binding's name. With debug logging enabled, `isolate.tail listener registered`
marks init and `isolate.tail received` gives the incoming event count, without trace content.

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
Its separate spin comparison is declared an expected failure while local CPU is zero. The
assertion stays unchanged, so a real CPU reading that passes it will fail the expected-failure
test. Connection, delivery and health-row checks run outside that expected failure.

Keep the measurement script on a separate branch, proposed name `p34c-walls-measurement`.
That branch and script have **not yet been created**. Amendment A4 assigns them to the lead
after this lane; the review does not wait for the script. It must not enter main. The host run
needs the following work, using the built program and the existing local-instance test setup.
The script is still owed; this checklist is not an executable measurement.

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

The host product check and corrected U9 prove local Process-object tail wiring, including
successor replay-fold rows. Neither gives usable local CPU or wall timing. Node elapsed
timings are still owed and will not establish cloud CPU. Neither the full
run nor eviction and duplicate-delivery checks have run. The extra cloud RPC cost and whether
ten times p99 is enough remain unmeasured.

## Slice 4 calibration, 2026-11-12

Version: `next/`. This section records the lead's A-Numbers amendment, using
`2026-11-12-host-3`, `r3-ep`, `r3-h10`, `r3-h100` and `r3-h350`. It supersedes the
unrun write-quota rows above. Raw samples remain private. The script is
`experiments/p34cs4-measure/measure.ts` on `fabrikalfa/p34cs4-measure`, commit
`9fd36948756dd1277875b484fdd40b14d6da1266`. The product source anchor was
`c000da09677e9a9008837e93b474f26e9ac477ed`.

The host used Node 26.13.0, Effect 4.1.2, tea 0.25.0, Vitest 5.0.5 and
Alchemy 2.0.0-beta.85 with the locked patches. Two clients drove steady and burst
checklist work. Recovery samples cover fresh throws, saved-letter throws, poison
completion and person restarts. The supplied amendment does not give the elapsed
run duration or the ordinary-load p50 and p95. No value is inferred for them here.

Percentiles use nearest rank, `sorted[ceil(p * count) - 1]`. Program inbox p99
was 688 over 561 rolling-minute samples, with maximum 720. Each accepted letter
had exactly one `stepped` record. Its two-write charge gives
`ceil(10 × 2 × 688) = 13,760` program writes per minute. The storage ceiling stays
the decided decimal 1,000,000,000 bytes.

| Account | Minute p99 writes / bytes | Complete chain writes / bytes | Largest replay-letter writes / bytes | Default writes / bytes / letter writes / letter bytes |
|---|---|---|---|---|
| Project recovery | 16 / 7,408 | 16 / 7,398 | 1 / 546.83 | 160 / 74,080 / 10 / 5,469 |
| Process recovery | 29 / 20,741 | 28 / 19,870 | 5 / 1,879 | 290 / 207,410 / 50 / 18,790 |

Recovery defaults are `ceil(10 × max(minute p99, complete chain))`, separately
for writes and bytes. Replay defaults are `ceil(10 × largest replay-letter cost)`.
The Process chain includes 25 changed rows and three checkpoint copies for its
write count. The three copies' 567 bytes are counted separately from the byte
window. The first delivery receipts belong to ordinary Process-local work.
Process writes therefore use 28, rather than the withdrawn 32. All recovery p99
values equal their maxima. Each name had 20 scripted minute windows; this does
not measure sustained daily use.

Restart histories of 2, 4, 9, 10, 100 and 350 letters cost exactly five Process
writes and one Project write per replayed letter. A 1,000-letter fill failed
three times when the local control door refused connections. The assumption
beyond 350 letters remains for Q18 to test. IDs were under ten bytes. Longer
IDs and longer restart histories can require larger replay settings. Monitor
fan-out, saved-state upgrades and remembered refusals have no sample here.

The withdrawn defaults are Process/Project recovery writes 48,330 / 3,710,
recovery bytes 12,029,030 / 4,638,130, Process writes 320 and Project replay bytes
5,500. Ordinary work and accumulated retained data had distorted those readings.
Recovery bytes now measure a rolling-minute rate; retained totals stay recorded
without that limit, under decision 0152. The door's envelope is infrastructure
work under decision 0153 and does not add a third program write.
