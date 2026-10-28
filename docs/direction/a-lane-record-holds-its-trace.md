# A LaneRecord holds each lane's trace

Proposed 2026-10-27. The owner picked the same day: our own store instead of
Jaeger, the name `LaneRecord`, the project's ledger Worker as its home, and
every trace kept forever.

```ts
// A sketch. One Durable Object per lane, in the project's ledger Worker,
// beside the project's object and each person's.
export class LaneRecord extends DurableObject {
	// SQLite inside the object. Nothing here is ever deleted.
	//   spans    one row per span of the lane's trace, from every host
	//   beats    the live row while an agent works: "review running 3m · 9 turns"
	//   summary  written when the lane ends: time per step, rounds, cost
	//   logs     pointers to each agent's full log, kept in Blobs
}

// The Worker takes spans in the standard format and sends each to its lane.
// POST /v1/traces  (OTLP over HTTP, through the same door as facts)
const record = env.LANE_RECORD.get(env.LANE_RECORD.idFromName(span.traceId));

// The app reads one lane's trace through a service, so the store can change.
const spans = yield* Traces.read(traceId); // the trace tile draws these
```

## What was decided

- **Lanes stop sending spans to Jaeger.** They go to a `LaneRecord` instead.
  Jaeger stays only for what still sends to it (tsh today) until that moves
  too.
- **One `LaneRecord` per lane.** Its key is the lane's trace id. That id
  comes from the lane's run id (tea's `runTraceId`), so a lane that moves from
  a laptop to the cloud host, or whose host restarts, stays one trace in one
  object.
- **It lives in the project's ledger Worker.** On 2026-10-25 each project got
  one Worker with an object for the project and one per person
  ([the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)). That
  note already said "one object per lane later". This is it: a third kind of
  object, the same deploy, the same Alchemy stack, the same Miniflare twin
  ([the laptop runs the same setup](./local-is-the-cloud.md)).
- **Spans come in through the same door as facts.** The door stamps who sent
  them. A program's exporter sends the login in a header, the way OTLP
  exporters already send headers. Cloudflare can send a Worker's own traces to
  any OTLP address
  ([Cloudflare](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data)),
  so the cloud host's spans can land here too.
- **Nothing is deleted.** A lane's record is kept forever. This repo is a lab
  notebook, and a trace is how we see where a lane's time went.
- **The name.** `Lane` stays free for the lane program and anything else about
  a lane. `LaneRecord` is the record a lane leaves behind, like a CI run's
  record of its logs and timings.

## What it holds

| Part | Written by | Read by |
|---|---|---|
| `spans` | every host's exporter, as the lane runs | the trace tile |
| `beats` | the running agent's harness, newest wins | the ticket's live row |
| `summary` | the lane, once, when it ends | the numbers page |
| `logs` | the harness, a pointer per agent run | "open log" in a tile |

- **A ticket finds its records through its facts.** Every `started` fact holds
  the run id and the trace id
  ([what a ticket shows](./what-a-ticket-shows.md)). A ticket with two lanes,
  say after a reassign, has two records, and its facts name both.
- **Full logs stay in `Blobs`,** with a pointer here. A transcript can be
  larger than a SQLite row should hold.
- **No search across records in v1.** The ticket gives the trace id, and the
  numbers page reads the summaries. A question such as "every slow review this
  week" waits until someone asks it.

## What it changes

- **Beats move.** The 10-25 note put beats on the ledger in a side stream per
  run, `runs/r-7/beats`, that the ticket's fold never reads. They now sit in
  the lane's record. It is the same idea: a stream nobody folds, kept beside
  the ticket, readable from any machine.
- **Slice 3t of the v1 plan** ([a ticket runs from the app](./a-ticket-runs-from-the-app.md))
  becomes the `LaneRecord` and the trace tile. Its "done when": #7's whole lane
  shows as one trace in the tile, read from the Miniflare twin, after its host
  was killed halfway.
- **The trace tile reuses the view rules that exist**
  (`packages/fabrika/src/shell/trace/view.ts`): one colour per service, red
  when a run went wrong, an agent's turns folded into one row.

## Why

- **One store for every host.** A lane that hops from laptop to cloud is still
  one trace, and the other person can open it from their machine.
- **No Docker.** The store is a Durable Object we already know how to run,
  with its local twin.
- **Size is not a worry.** One lane is a few dozen spans, a few thousand with
  every agent turn. Each object holds one lane, so no table grows with every
  lane ever run.

**Cost:** a small OTLP receiver in the Worker, the object, the `Traces`
service, and the tile. We give up Jaeger's search and compare. A bad deploy of
the trace code redeploys the ledger too, the same risk the per-project Worker
already takes.

**How sure: 80%.** The doubts:

- A span that arrives before its lane's `started` fact. The object is made on
  the first span it gets, so the order should not matter. Slice 3t shows it.
- Spans that belong to no lane, such as tsh's own. They keep going to Jaeger
  for now. Where they go later is open.

## What it cannot tell us

- How the tile reads on a long lane with many rounds. No real lane has run.
- What Cloudflare charges for this at all-day volume. It is small by the count
  above, but nothing has been measured.
