# A JobRecord holds each host job: its runs' storage and its trace

Decided 2026-10-28 by the owner. First proposed 2026-10-27 as one record per
lane (`LaneRecord`). The owner widened it the next day: traces are for every
program, not only the pipeline; the record is the storage programs already
get; and a job is the host's, not tsh's. Jaeger goes away. Nothing extra runs:
open fabrika and the traces are there.

```ts
// A sketch. One Durable Object per host job, in the project's ledger Worker,
// beside the project's object and each person's.
export class JobRecord extends DurableObject {
	// SQLite inside the object. Nothing here is ever deleted.
	//   job      what was started and how it ended: the line, who, which host
	//   state    each run's Storage: machine runs, outbox, dead letters, how it ended
	//   steps    every Msg each machine folded, with the state after it and its Cmds
	//   spans    one row per span of the job's trace, from every host
	//   beats    the live row while an agent works: "review running 3m · 9 turns"
	//   summary  written when the job ends: time per step, rounds, cost
	//   logs     pointers to each agent's full log, kept in Blobs
}

// A program gets it as its storage layer, the same `Storage` it takes today
// (packages/fabrika/src/program/storage.ts). Only where the data lives changes.
const started = yield* start(double, {}, {}, {id: "double-b71e44d0", storage: jobStorage(job)});

// The Worker takes spans in the standard format and sends each to its job.
// POST /v1/traces  (OTLP over HTTP, through the same door as facts)
const record = env.JOB_RECORD.get(env.JOB_RECORD.idFromName(span.traceId));

// The app reads one job's trace through a service, so the store can change.
const spans = yield* Traces.read(traceId); // the trace tile draws these
```

## Changed 2026-10-28: the host keeps the group, tsh keeps the list

Decided by the owner the same day, after part A
([#170](https://github.com/usirin/tea-fabrika/pull/170)) moved tsh's job
table onto the host. Unix has two layers here, and the first version of this
note merged them:

- **The kernel keeps process groups:** which process is in which group. That
  is the host's part. A job is a leader run and every run it started, and they
  share one trace.
- **The shell keeps the job table:** `%1`, `%2`, which job is in front,
  `jobs`, `fg`. bash's table is its own and goes when bash goes. That is tsh's
  part, kept in tsh's own state on the ledger, as before part A.

```ts
// The host: which job a run is in, and the job's trace. No numbers, no foreground.
yield* leaderOf("lane:700:t2:r1:build"); // "lane:700"
// serve starts every run under traceOf(its leader), so a job is one trace

// tsh: its own job table, in its own state (packages/fabrika/src/shell/jobs.ts)
{ jobs: [{ n: 1, text: "seq --to 3 | tally", state: "done", background: false, stages: [/* … */] }] }
```

Keeping jobs alive with no shell open is a multiplexer's work. tmux is a
program that keeps terminals and runs a shell in each: OS, then bash, then
tmux, then bash, then the program. WezTerm's mux server and VS Code's pty host
do the same. Here it already exists: `apps/fabrika/src/tiles.ts` keeps one
tsh per tile in the host process, as tmux runs one shell per pane, and the app
is only a client. Each tile's tsh keeps its own jobs in the tile's folder, like
each pane's bash. Where it keeps its layout is its own business, not the
host's. Part A's table on the host was the one layer too many.

What this changes below:

- "A job is the host's, not tsh's" (What was decided) now means the group and
  its trace. `jobs`, `&`, `attach %n` and detach stay on tsh's own table.
- "tsh's job table moves to the host" (What it changes) is dropped, with its
  part of the cost and the "moving the job table" doubt.
- Nothing else moves. The record's key is still the job's trace id, from its
  leader's first run.

## Words

- **Program:** the code. `seq`, `double`, the lane, the tracker.
- **Run:** one start of a program until it ends, like a process. It has its
  own id (`seq-3f9a1c02`), its own state, its own end.
- **Job:** what one start on the host made: a root run and every run it
  started, like a Unix process group. A tsh line is a job. A lane is a job.
  `hello world` is a job of one run.

## One example, all the way

`seq --to 3 | double`, typed in tsh. Both programs are in
`packages/fabrika/src/shell/small.ts`.

```ts
// The host makes job 1: two runs. The job's trace id comes from its first run.
runTraceId("seq-3f9a1c02"); // "9c41…e07a": the record's key

// What the record holds when the line ends
job:   { n: 1, text: "seq --to 3 | double", by: "owner", host: "laptop", ended: "done" }
state: { run: "seq-3f9a1c02",    status: "done", flags: { to: 3 }, machines: [] }
state: { run: "double-b71e44d0", status: "done", flags: {},        machines: [] }
spans: { name: "seq --to 3 | double", service: "tsh",    start: 0, end: 14 }
spans: { name: "run",                 service: "seq",    start: 1, end: 9,  events: ["sent n", "sent n", "sent n"] }
spans: { name: "run",                 service: "double", start: 1, end: 13, events: ["told n", "sent n", "told n", "sent n", "told n", "sent n"] }
```

The trace tile draws one bar per span, one colour per program, with the sent
and told events as dots. When the line ends, `jobs` no longer lists it, as
today. The record stays, so the trace opens again from history.

A lane is the same, bigger: the lane is the job, triage, build and review are
its runs, and each agent's turns are spans inside its run.

## Every step is kept, and the tile opens it

A tea program is a state machine: a Msg comes in, `update` gives the next
state and the Cmds to run. So what happened is the list of steps, and the
record keeps every one. This is Elm's own debugger, and Redux DevTools: a list
of Msgs, and clicking one shows the state at that point.

`double` has no machine, so its run shows only spans. `tally` has one
(`count`, in the same file): `seq --to 3 | tally` folds three `add`s.

```ts
// A sketch. One row per step of every machine run, appended, never replaced.
steps: { run: "tally-5d02c7a1", machine: "count", id: "total", n: 1, at: 4,
         msg: { type: "add", n: 1 }, state: { total: 1 }, cmds: [] }
steps: { run: "tally-5d02c7a1", machine: "count", id: "total", n: 2, at: 6,
         msg: { type: "add", n: 2 }, state: { total: 3 }, cmds: [] }
steps: { run: "tally-5d02c7a1", machine: "count", id: "total", n: 3, at: 8,
         msg: { type: "add", n: 3 }, state: { total: 6 }, cmds: [] }
```

In the tile: the `tally` row opens to `count total`, which opens to its
three steps. Clicking `add 2` shows `{ total: 1 }` before, `{ total: 3 }`
after, and no Cmds.

- **Nothing is hidden, everything opens.** A row in the tile that groups
  others (a run, a round, an agent's turns) opens with a click to show what
  is inside, down to one step. A step opens to its Msg, the state before and
  after, and the Cmds it started.
- **Values live in the record, not in spans.** Spans keep "names, tags and
  ids, never values" (`packages/fabrika/src/program/trace.ts`): that rule was
  made for spans that leave for Jaeger or any other backend. Steps are written
  by the run's `Storage` into our own record, behind the same door as facts.
  A span names its steps by run and number, so the tile finds them.
- **Storage keeps only the newest state today** (two slots, the newest whole
  one wins). The record appends a row per step instead. Restarts still read
  the newest.

**Doubts for this part:**

- **Size.** The tracker's state holds every ticket, so a full state per step
  is large. A step can keep only what changed (a JSON Patch,
  [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)) with a full state every
  so many steps, the way video keeps key frames. The build measures which.
- **Secrets.** A state that holds a `Redacted` value must not write its text
  into a step. Storage writes states to disk today too, so the hole would not
  be new, but the record keeps them forever. The build adds a law: a state
  with a `Redacted` in it writes no secret text into any row.

## What was decided

- **A job is the host's, not tsh's.** *Changed 2026-10-28, see above: the
  host keeps the group and its trace; the job table stays tsh's.* Today a job lives in tsh's job table
  (`packages/fabrika/src/shell/jobs.ts`) and leaves it when it ends. Now that
  we have hosts, the host keeps jobs, the way a kernel keeps process groups
  and a shell only shows them. Anything that starts a program makes a job: a
  tsh line, the app starting a lane, a scheduled run. tsh's `jobs`, `&`,
  `attach %n` and detach become views and calls on the host's jobs.
- **One `JobRecord` per job, for every program.** Traces are a program's, not
  the pipeline's.
- **Its key is the job's trace id.** That id already comes from the first
  run's key (`runTraceId`, `packages/fabrika/src/program/trace-id.ts`), the
  same in any process. So a job that moves from a laptop to the cloud host, or
  whose host restarts, stays one trace in one object.
- **A child run joins its parent's job.** Today a run joins its parent's trace
  only when it starts inside the parent's span, as tsh's lines do
  (`packages/fabrika/src/program/program.ts`, the run's span). On the host, a
  lane's stages start later from a row (`startChild`), so each starts a trace
  of its own. The host now hands the job's trace id to every child it starts,
  the way a Unix child keeps its parent's process group, and OpenTelemetry
  passes a trace's context along.
- **It is the runs' storage.** Programs already get a `Storage` per run: its
  machine states, its outbox, its dead letters, how it ended. The record
  becomes where that lives, so each run's state and the job's trace sit side
  by side. Memory and file storage stay for tests.
- **This is not "every program is a Durable Object".** That idea stays parked:
  it carries the serverless-versus-own-server problem. Programs still run in
  their host, on the laptop or in the cloud. Only their storage lives in the
  object.
- **Jaeger goes.** tsh and every program send their spans to the record.
  `trace:up`, `trace:down`, `trace:wipe`, `jaeger/` and the docs that point at
  them are removed once the trace tile shows a tsh line.
- **It lives in the project's ledger Worker.** On 2026-10-25 each project got
  one Worker with an object for the project and one per person
  ([the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)). This
  is a third kind of object: the same deploy, the same Alchemy stack, the same
  Miniflare twin on the laptop
  ([the laptop runs the same setup](./local-is-the-cloud.md)).
- **Spans come in through the same door as facts.** The door stamps who sent
  them. An exporter sends the login in a header, the way OTLP exporters already
  send headers. Cloudflare can send a Worker's own traces to any OTLP address
  ([Cloudflare](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data)),
  so the cloud host's spans can land here too.
- **Nothing is deleted.** A job's record is kept forever. This repo is a lab
  notebook, and a trace is how we see where a job's time went.
- **The name.** `JobRecord`, after the job: the record a job leaves behind.
  `LaneRecord` is dropped, since a lane is only one kind of job.

## What it holds

| Part | Written by | Read by |
|---|---|---|
| `job` | the host, when the job starts and ends | `jobs`, history |
| `state` | each run, through `Storage`, at each step | the host, at a restart |
| `steps` | each run, through `Storage`, one row per Msg | the tile, when a row is opened |
| `spans` | every host's exporter, as the job goes | the trace tile |
| `beats` | the running agent's harness, newest wins | the ticket's live row |
| `summary` | the job, once, when it ends | the numbers page |
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
  the job's record. It is the same idea: a stream nobody folds, kept beside
  the ticket, readable from any machine.
- **tsh's job table moves to the host.** *Dropped 2026-10-28, see above: the
  table stays tsh's.* The 10-25 tile decisions (`&` makes
  a background job, `attach %n` brings it into a tile) stay as they are. They
  now act on the host's jobs.
- **Slice 3t of the v1 plan** ([a ticket runs from the app](./a-ticket-runs-from-the-app.md))
  becomes the `JobRecord`, its `Storage`, host jobs, and the trace tile. Its
  "done when": #7's whole lane shows as one trace in the tile, read from the
  Miniflare twin, after its host was killed halfway; and a tsh line shows the
  same way, with Jaeger stopped.
- **The trace tile reuses the view rules that exist**
  (`packages/fabrika/src/shell/trace/view.ts`): one colour per service, red
  when a run went wrong, an agent's turns folded into one row.

## Why

- **Nothing extra to run.** Jaeger was never opened because it lives outside
  fabrika: one more thing to host and start. The record runs where the ledger
  already runs.
- **One rule for everything.** A tsh line, a lane and `hello world` are each a
  job with one record. The trace ids already line up that way.
- **One store for every host.** A job that hops from laptop to cloud is still
  one trace, and the other person can open it from their machine.
- **Others keep a run this way.** Cloudflare Workflows keeps each run in its
  own Durable Object ([Workflows](https://developers.cloudflare.com/workflows/)),
  Temporal keeps one history per run
  ([Temporal](https://docs.temporal.io/workflow-execution)), and Jaeger and
  Tempo store spans by trace.
- **Size is not a worry.** One lane is a few dozen spans, a few thousand with
  every agent turn. Each object holds one job, so no table grows with every
  job ever run.

**Cost:** host jobs (tsh's table, `&`, `attach` and detach move onto the
host; *dropped 2026-10-28, the table stays tsh's*), the child's trace id on `startChild`, a step row per Msg, a small OTLP receiver in the
Worker, the object, a `Storage` over it, the `Traces` service, and the tile. We
give up Jaeger's search and compare. A bad deploy of the record's code
redeploys the ledger too, the same risk the per-project Worker already takes.

**How sure: 75%.** The doubts:

- **Write time.** `Storage` keeps each write before it returns. On the laptop
  the object is in Miniflare, close by. From the laptop to Cloudflare each
  write is a trip over the network. A timing test settles it: writes per lane,
  and time per write, on Miniflare now and on Cloudflare once a deploy is
  agreed.
- **Moving the job table.** *Gone 2026-10-28: the table no longer moves.*
  tsh's jobs carry detach and attach across a tsh
  restart today. The host has to keep the same promises. tsh's existing tests
  for them are the bar.
- A span that arrives before its job's object exists. The object is made on
  the first write it gets, so the order should not matter. Slice 3t shows it.

## What it cannot tell us

- How the tile reads on a long lane with many rounds. No real lane has run.
- What Cloudflare charges for this at all-day volume. It is small by the count
  above, but nothing has been measured.
