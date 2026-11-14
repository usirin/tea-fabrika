---
date: "2026-11-11"
summary: "`next/`'s stack: `effect` 4.1.2, Alchemy beta.84, local workerd through Alchemy's dev deploy. Yes, in our own code with no patch: exporters with no interval plus `OtlpExporter.Flusher.flush` at the end of every wake hibernated 3 of 3 times, with no timer pending, and exported all 4 spans and 6 logs. Effect's PR 10235 (in 4.1.2) already ended alchemy#2878's endless timer for logs and traces. Default intervals still keep the object awake about 5 s after a wake (awake at 12 s idle 2 of 2, asleep at 40 s). The metrics exporter's 10 s timer never stops, and that object never slept. `next/` exports no OTLP today; its span sink already flushes per call with no timer. Lean, about 85%: (a) when `next/` adds an OTLP export, no metrics exporter in an object. Upstream comment drafted, not filed. Local only, no cloud run. $0, no model."
---

# 259. Can a Durable Object export OTLP telemetry from its instance fibers and still hibernate?

Measured on 2026-11-11, on main at `a8c4cd722`, on the laptop's own workerd, started through Alchemy's
dev deploy the way `next/apps/fabrika/src/sibling.laws.test.ts` starts its objects. The script stays
on the branch `fabrikalfa/exp-telemetry-hibernate` (`experiments/259-telemetry-and-hibernation/`);
raw results went to `runs/`. Versions: `effect` 4.1.2, `alchemy` and `@alchemy.run/cloudflare`
2.0.0-beta.84, compatibility date 2026-10-12. **Every claim is about `next/`'s stack**, not today's
version. No model was called and nothing was deployed. Cost: $0, agent time only.

**The answer: yes, with (a), and no patch is needed.** Build the log and trace exporters with no
interval and call `OtlpExporter.Flusher.flush` at the end of every wake. That object hibernated in 3
of 3 runs and exported all 4 spans and 6 logs, each one during the wake that made it. (c) is already
done upstream: Effect's PR 10235, merged 2026-11-01 and shipped in 4.1.2, stops an idle log or trace
exporter from keeping a timer. So the bug that alchemy-run/alchemy#2878 reports on 4.1.1 is gone for
logs and traces on our version. Two things still cost: default intervals keep the object awake about
5 s after each wake's last record, and the metrics exporter keeps a 10 s timer forever. (b), a patch
to Alchemy's bridge, would make (a) the default, but nothing in `next/` needs it today:
`next/` builds no OTLP exporter at all.

```ts
// (a), at instance start, in an Alchemy Effect Durable Object's inner Effect.
const scope = yield* Scope.make(); // nothing closes it: an instance gets no shutdown hook (alchemy #1500)
const telemetry = yield* Layer.buildWithScope(
  Layer.mergeAll(
    OtlpLogger.layer({ url: `${base}/v1/logs`, resource, exportInterval: Duration.infinity }),
    OtlpTracer.layer({ url: `${base}/v1/traces`, resource, exportInterval: Duration.infinity }),
  ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer)),
  scope,
);
const flush = OtlpExporter.Flusher.use((f) => f.flush).pipe(Effect.provideContext(telemetry));
// ...and every handler ends with it: fetch, webSocketMessage, alarm.
webSocketMessage: (socket, message) => work(message).pipe(Effect.andThen(flush)),
```

## What we ran

One Durable Object, `Probe`, in four modes, one local runtime at a time. At instance start it builds
its exporters into a scope that never closes, logs `instance started`, and forks one instance
fiber. Every wake (the socket's `fetch`, each message, the alarm) hands a job to that fiber, which
records a span and a log, as a loop object would. The test opens a hibernatable WebSocket, sends
`work` (which sets an alarm 1.5 s later), stays idle, then sends `again`. If the instance was rebuilt
in the same isolate, the object hibernated, which is the issue's own test. The module wraps
`setTimeout` and `setInterval`, so a Worker route can list the pending timers every 2 s without
waking the object. A fake OTLP receiver on 127.0.0.1 took every export.

| Mode | Idle 40 s: hibernated | Idle 12 s: hibernated | Pending timers while idle | Exported |
|---|---|---|---|---|
| `plain`, no exporters | yes | not run | none | nothing, by design |
| `defaults`, logs 1 s and traces 5 s | yes | no, 2 of 2 | 1 s and 5 s timers until about 5 s after the last record, then none | all 4 spans and 6 logs, up to 5 s after each wake |
| `metrics`, `Otlp.layerJson` defaults | no | not run | a 10 s timer the whole time, 7.1 s old at the end and re-armed | all, plus 4 metric posts, one every 10 s, empty or not |
| `fixed`, no interval plus a flush per wake | yes | yes, 2 of 2 | none, at every sample | all 4 spans and 6 logs, inside the wake that made them |

The 12 s idle runs show the price of default intervals. The `fixed` object went to sleep by 12 s. The
`defaults` object was still awake: its trace timer ran until about 5 s into the idle, so the local
idle countdown started late. On 40 s both slept, so on 4.1.2 default intervals cost a few seconds of
awake time per wake, not hours. Metrics never let the object sleep. That is the one case left from
the issue's table, and it is alchemy-run/alchemy#2876's ground.

No workerd was left running after any pass (`pgrep -x workerd` found none at the end). The first
40 s run counted 1 workerd before and after each pass, but its check used `pgrep -f`, which also
matches the shell that runs it. The 12 s runs used `pgrep -x`, which counted 0 both times.

## What the source says

- **Effect 4.1.2.** `OtlpExporter.make` starts its export loop only after a push, and closes it again
  once an export empties the buffer: "an idle exporter keeps no timer pending". `Flusher.flush`
  exports at once and stops a pending wait. `Effect.sleep(Duration.infinity)` is `never` and sets no
  timer. Metrics set `exportEmpty: true` with batching off, so their loop never stops.
- **Alchemy beta.84's bridge** builds telemetry once per call into its own scope, then closes that
  scope in `waitUntil` once the call and its background work have settled. That close is the per-call
  flush. The per-call exporters use a 1 hour interval for this reason. The instance initializer gets
  no telemetry and no live scope, and instance fibers record into nothing unless user code builds
  exporters, as above. Its `provideProcessTelemetry` uses default intervals and adds metrics when
  they are configured. In an object, that is the `metrics` row.
- **`next/` today** exports no OTLP. `SpanSink` (`next/packages/libfabrika/src/telemetry/Sink.ts`)
  writes each span to the object's own SQLite before `end` returns, with no timer fiber. The runtime's
  `complete` flushes it at the end of each call (`next/packages/libfabrika/src/cloudflare/runtime.ts`).
  That is already (a)'s shape, and it survives hibernation better, since its queue is a table.

## Lean

The owner decided on 2026-11-11 ([0122](../.decisions/0122-telemetry-goes-out-later-through-a-connector.md)): the first version sends no telemetry out, and when one is added it goes through a connector and follows (a).

**(a), no patch.** Sure: 85%.

- **Why.** It works today on our pinned versions, in our own code. It needs no `pnpm patch`, and it
  matches what `next/`'s span sink already does. (c) is already done upstream. (b) only moves (a) into
  Alchemy.
- **What it costs.** About 10 lines per object kind, done once in a shared helper: one flush at the
  end of every handler. A record made by an instance fiber between wakes waits in memory for the next
  flush, and is lost if the object sleeps first. Spans from a wake are safe, since the wake flushes
  them before it ends.
- **The doubt.** Local workerd is not the cloud. Experiment 174 found the local runtime kinder than
  the docs about eviction. The cloud's 2026-10-01 rule that a pending timer holds off eviction is not
  tested here. The `metrics` result (never slept) and the `defaults` 12 s result (a late sleep) both
  point the same way as the docs, so the lean should hold. A deployed run would settle it.
- **When to do it.** Only when `next/` adds an OTLP export, such as a feed to an outside backend.
  Until then there is nothing to change. The rule to carry over: no metrics exporter inside an
  object, and no exporter with a finite interval in an instance scope.

## What to tell upstream (a draft, not filed)

A comment for alchemy-run/alchemy#2878:

> Update after Effect-TS/effect#10235, which shipped in `effect@4.1.2`: on `alchemy@2.0.0-beta.84`,
> local workerd, exporters built at instance start into a scope that never closes, with a
> hibernatable socket open. Logs and traces at their default intervals no longer block hibernation.
> The object sleeps once the trace timer stops, about 5 s after its last record. Metrics at their
> default interval still keep it awake (a 10 s timer forever, `exportEmpty`), which is #2876. Infinite
> intervals plus `OtlpExporter.Flusher.flush` at the end of each event hibernated in 3 of 3 runs and
> exported every record during its own event. So proposal 3 is done. Proposals 1 and 2 (instance
> telemetry from the bridge, flushed per event) would make that workaround the default, and the docs
> note in 4 still stands for metrics.

## What it cannot tell us

- Nothing ran in the cloud. Whether a 5 s timer delays hibernation there by more or less than here,
  and what a still-pending timer does to billing under the 2026-10-01 rule, is unmeasured.
- Two 12 s runs per mode and one 40 s run per mode. The local idle countdown, about 10 s here, was
  read off these runs, not off a doc.
- The receiver accepted every post. A slow or failing collector was not tried. A flush waits on
  the export, so a slow collector would lengthen each wake by up to the exporter's retry budget,
  unless the flush is bounded with `Effect.timeoutOption` or moved into `waitUntil`.
- Records an instance fiber makes between wakes (a tick, a subscription) were not tried. By the
  source, they wait for the next wake's flush and are lost if the object sleeps first.
- The (b) patch was not written. Nothing here needs it.
