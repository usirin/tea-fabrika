---
date: "2026-11-07"
scripts: "none; reading only"
summary: "Reading, not a measurement; `next/`. tea 0.23.0's `./otel` traces agent runs only, so steps, Msgs and Cmds get spans from Effect's own `withSpan`. Alchemy's local instance has no trace viewer, so we keep our own sink. Cloudflare's tracing keeps 7 days on the paid plan, and a span with no I/O reads 0 ms. Three facts were being lost: each throw's error before `dead`, `down`'s retry `until`, and a failed Cmd's reason. The study sized P37 at 450 to 600 lines, and the whole job at 700 to 1,000 lines, 1.2 to 1.7 agent hours, 60%. Built: about 3,500 lines, 2,130 of them tests (PR 475), about six times the guess. Wrong and kept: each object pruning its own spans at 7 days. A decided note keeps a job's spans forever; corrected the same day. 0016 dropped `until`. No model, $0."
---

# 273. What must Tier 1 record to be observable, where do the spans land, and how big is the work?

Read on 2026-11-07; moved here on 2026-11-11. **This is reading, not a measurement.** Nothing ran:
no span was written on workerd or Cloudflare, and every size is a guess from reading code and
docs. It is about `next/`; claims about `packages/` and `programs/` say "today's". No model was
called beyond the one agent that read, and it cost $0. This is the study that sized P37, the span
sink, in [Tier 1](../docs/plan/tier-1.md#monitoring-is-in-tier-1). P37 is built
([PR 475](https://github.com/usirin/tea-fabrika/pull/475)); where the build differs from the
guesses below, the section "What was built" says so.

**The answer: spans come from Effect's own tracer, not tea's `./otel`; one sink of our own keeps
them, the same on both instances; three facts were lost and had to be recorded now; and the work
is a new row of 450 to 600 lines plus 10 to 80 lines in ten other rows, about 700 to 1,000 lines
and 1.2 to 1.7 agent hours, 60% sure.** The study's first lean, each object keeping its own spans
for 7 days, was **wrong**: it walked back a decided note, and the lead corrected it the same day.

```ts
// A sketch of the whole idea. One span per unit of work, many tags: a wide event.
const msg = (letter: Letter) =>
  step(letter).pipe(
    Effect.withSpan("runner.step", {
      attributes: { "fab.pid": pid, "fab.run": run, "fab.msg.type": letter.body.type,
        "fab.letter.id": letter.id, "fab.cause": letter.cause, "fab.build": build },
      links: [linkTo(letter.cause)], // the inputs note's span link
    }),
  );
// The trace id comes from the cause, as tea's runTraceId comes from a run id, so the door's span
// and every step it causes share one trace with no context passed between objects.
```

## What tea 0.23.0 gave

The study read tea 0.23.0's `dist/`; the lockfile is at 0.25.0 today, not reread.

- **`@demlik/tea/otel` traces agent runs only:** a run span, a span per model call and a span per
  tool call. Its exports were `traceAgent(runtime, {tracer})`, `agentSpans({tracer})`,
  `runTraceId(runId)` (SHA-256 of the run id cut to 32 hex, one trace across a kill) and
  `maskBase64DataUris`. Attributes are OpenTelemetry's GenAI ones (`gen_ai.*`) plus Langfuse's.
  Spans are timed by each event's `at`; spans a killed process never ended are never exported. It
  needs a `Tracer` from `@opentelemetry/api` (pinned 1.9.1 then and now).
- **No span for a program step, a Msg or a Cmd.** Nothing else in the package calls `withSpan`
  or OpenTelemetry. Tier 1 runs no agent inside fabrika, so `./otel` had nothing to trace there,
  and the plan's line "Monitoring through tea's `./otel`" named the wrong tool. Tier 1 now marks
  that line as changed.
- **What tea's engine offers a host instead:** `telemetry`, a fire-and-forget sink of
  `{seq, msgType, at}` per applied transition; `observe(msg, state)`; and `onError(error,
  {phase})` with 13 phases, among them `reduce`, `interpret`, `sub` and `discard`. The loop's ten
  extension points are not a public plugin API, so a host wraps its own `interpret`, as today's
  `runTraced` does (`packages/fabrika/src/program/trace.ts`).
- **For `next/`:** the runner is our own over a stepper, and the program runs in a box that
  returns Cmds as data with `globalOutbound: null`. So spans belong in the runner, outside the
  box, with `Effect.withSpan`. **Guess:** the runner does not call tea's `run`, so `telemetry` is
  out.

## Where spans land

| Place | What it gives | Keeps | Cost | Source |
|---|---|---|---|---|
| Local, Alchemy's instance | No trace viewer: Alchemy left out wrangler's Local Explorer | nothing | free | Alchemy `src/vite/PARITY.md` (beta.84, in `node_modules`) |
| Local, Alchemy's instance | Tail and streaming-tail Workers do run locally | what we keep | free | Alchemy `src/core/Runtime.ts` |
| Cloudflare, Workers tracing | Automatic spans for handlers, fetch, bindings, Durable Object and RPC calls; custom spans with `tracing.startSpan` | 7 days | paid plan; from 2026-12-01 Observability pricing: 50 GB ingest and 10 GB-month included, then $0.25/GB and $0.10/GB-month | [traces](https://developers.cloudflare.com/workers/observability/traces/), [custom spans](https://developers.cloudflare.com/workers/observability/traces/custom-spans/), [pricing](https://developers.cloudflare.com/observability/pricing/) |
| Cloudflare, Workers Logs | `console` lines and invocation logs | 7 days paid, 3 free | 20 M events a month included, then $0.60 per million | [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Cloudflare, OTLP export | Traces and logs sent to any OTLP address; `persist: false` skips storing | the far end's | the far end is a new account, ruled out | [export](https://developers.cloudflare.com/workers/observability/opentelemetry-export/) |
| Our own SQLite, both instances | Our spans as rows | what we choose | 50 M rows written a month included, then $1.00 per million | [Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |

Prices as fetched on 2026-11-07. What the docs say that bites:

- **A Workers span with no I/O reads 0 ms** (timers move only at I/O, against Spectre), so a pure
  `update` shows 0 ms on Cloudflare
  ([known limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/)).
- **No manual parent and no outside context** in Workers custom spans; the API has
  `setAttribute(s)`, `recordException` and `end`, no `addEvent`.
- **The OTLP exporter inside an object holds a timer forever** (Effect issue 10234), so it must be
  flushed by hand ([experiment 174](./174-effect-on-cloudflare.md)). A SQLite sink has no exporter
  and no timer. Experiment [259](./259-telemetry-and-hibernation.md) later measured this.
- **The stack set `observability: {enabled: true}`**, which turns on logs only; traces need
  `observability.traces.enabled` too.

**Lean then: our own sink, plus Cloudflare's tracing on the cloud.** One Effect `Tracer` writes
each ended span as a row in the object's own SQLite. Why: the same on both instances
([local is the cloud](../docs/direction/local-is-the-cloud.md)); a browser tab can read it through
the door; no exporter, no timer, no new account. Cost: about 150 lines and a door method. Sure
65%. Doubt: rows per step; 4 spans a step at 500 steps a day is 2,000 rows a day, far under the
allowance (**guess** at the load).

**Wrong: "each object keeps its own spans 7 days, pruned on the next write."** Corrected by the
lead on 2026-11-07. It walked back [a JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md)
(decided 2026-10-28), which sends every span of a job to its JobRecord, kept forever ("Nothing is
deleted"). Only health noise (lease renews, pings) is kept about a week. The study had flagged
the clash with the five layers' "about a week" and asked the owner to confirm a reading; the
correction settled it the other way. The owner then decided the same day: full observability
from Tier 1 (record wide applies to traces), and a thin JobRecord in Tier 1, one object per
process, holding its spans forever.

## What each Tier 1 piece records

"Ledger" means a permanent fact, already in the plan. "Span" means health. **LOST** marks a fact
that existed only at write time and was in neither. Plan line numbers the study cited are
dropped: the plan has moved since.

| Piece | Already a ledger fact | A span adds | Lost |
|---|---|---|---|
| The runner's step (P11, P34), `runner.step` per letter | The letter (Msg, `by`, `for`, `cause`, `sentAt`, `seen`, `arrivedAt`), `build`, dead letters in `<pid>/dead`, `restarted`, `down {why, crashes}`; state and Cmds out fold from letters | Time to load, step, append and run each Cmd; a refusal's reason; Cmd count | **Each throw's error before the third** (only a count was kept; `dead` kept no error); **why a Cmd failed**, unless the failure comes back as a letter; **when a down process tries again** (`down` had no `until`) |
| ProcessManager (P33), `process.exit`, `process.start`, `process.monitor` | `exited`, `restarted {run, why, build}`, `down`, the run number; `DOWN` reaches a monitor as a letter | How long a wake took, and evicted or crashed | Who is online is never written; a span per ping change would give a week of presence |
| The door's envelope (P10), `door.envelope` per input | Grants, `revoked`, `denied`, `door/hellos` | Method, `InputId`, key fingerprint, `as`, target, answer, refusal reason, time to answer | Reads write no letter, so who read what lives only as long as spans: a choice, not a loss |
| Ledger calls (P6), `ledger.append`, `read`, `wait`, `ring` | The entry | Rev, stream, rows, bytes, time, the error case; for a wait, how long it parked and whether the object slept | |
| Chaos (P17, P27), `nemesis.fire` with the tick as id | `tick`, `did`, `checked` | What the fault really did: the close code, the abort, the delay | |
| The MCP bridge (P25) | Each tool call reaches the door as an envelope | A refused save's count | **Gap:** the bridge's own wall time and its wait for Approve had no home; P25's plan picks |

**Rules every span keeps** (today's, rethought): names, tags and ids, never values (a Msg's tag,
not its fields, as `packages/fabrika/src/program/trace.ts` does), never a `Redacted` value. Error
text is the risk, since a throw's message can quote a note. **Lean:** a span keeps the error's
class and a message cut to 200 characters, and `dead` gains the class only. 60%; a data-shape call
for the owner.

## Today's `trace` program, and what a reader in `next/` needs

Today's version: `Traces.read(traceId)` returns a `JobTrace` `{trace, job, runs, spans, steps,
opened}` (`packages/fabrika/src/host/traces.ts`); a record is read again every second, a ticket's
facts every 1 s, then 5 s when calm; two views, a job waterfall where a step opens to its Msg,
state before and after, a JSON Patch and its Cmds, and a ticket view with a fact stepper
(`programs/trace/README.md`). It joins facts to spans by tags, else by time overlap.

What `next/` keeps is every step opening to its Msg and state, as Elm's debugger does. The steps
are letters kept forever and the state is a fold, so the reader needs no `steps` table:

```ts
// A sketch. Two reads, both through the door, both a browser can make.
yield* ledger.read({ stream: `${pid}/inbox`, after: 0 }); // letters: Msg, by, cause, arrivedAt, build
yield* spans.read({ trace });                              // timing and errors, by trace id
// state at step n = fold(letters[0..n]) on each letter's build. Live: ledger.wait, never a 1 s poll.
```

A `ps` window, Kubernetes style: `kubectl get pods` shows `NAME READY STATUS RESTARTS AGE`, with
`CrashLoopBackOff` while a backoff runs (10 s, doubling, capped at 300 s, reset after 10 minutes
up) ([pod lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)). Today's
`ps` prints `RUN PROGRAM JOB STATE`. Every column folds from ledger facts (name, run, status,
restarts, dead letters, age); only steps per minute needs spans. So `ps` never goes blank when
health rows age out.

## Size

**Lean: one new row, P37, the span sink, after P6 and before P10 and P11;** each later row adds its
own spans and laws in its own pull request, so each builder sees spans in the exam it already
takes. 70%.

| Row | What it adds | Lines with tests (guess) |
|---|---|---|
| P37 (new) | Effect `Tracer` to SQLite, prune, a memory Layer for tests, `spans.read` at the door; laws: no values, no `Redacted`, prune, trace id from cause | 450 to 600 |
| P6 | spans on `append`, `read`, `wait`, rings | 30 to 50 |
| P10 | `door.envelope`; the span link | 40 to 60 |
| P11 | `runner.step`, Cmd child spans, a Cmd's failure reason | 50 to 80 |
| P33 | process spans; `down` gains `until` | 30 to 50 |
| P34 | `recordException` per throw; `dead` gains the error class | 30 to 50 |
| P12 | the sink Layer wired in `brain.ts`; workerd restart span | 10 to 20 |
| P17, P27 | `nemesis.fire` spans | 20 to 40 |
| P24 | `observability.traces.enabled` | 1 to 5 |
| P25 | bridge calls | 10 to 40 |

About 700 to 1,000 lines, **1.2 to 1.7 agent hours** at 600 lines an agent hour. A trace view
window is not in it: today's `programs/trace` is about 30 files, so a **guess** of 2 to 3 agent
hours for a first `next/` version, which fits Tier 2's desk better.

## What was built (from Tier 1's P37 row, 2026-11-11)

- **Sized 450 to 600 lines; planned at 2.6 to 3.1 agent hours** (the row had said 0.75 to 1);
  **built about 3,500 lines, 2,130 of them tests.** The guess was low by about six times.
- **Where spans land changed with the correction:** a span goes to its process's record,
  `job/<process>/<part>`, or `spans/<part>` outside a process, kept forever; no 7-day prune.
- **Health:** a raw health row per ended span, plus an hourly summary per piece, both kept; raw
  rows older than 336 hours go to R2 and are deleted locally only after R2's hash matches. Each
  object writes its own size row at most once an hour.
- **`spans.read` at the door moved to P10,** and the record objects, the R2 binding and the
  wiring in `brain.ts` to P12.
- **The three lost facts:** a throw's error class on `dead` and a failed Cmd's reason as a letter
  are recorded. `down {until}` was dropped by [0016](../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md):
  past its brake a name is `failed` until a person restarts it.
- **Error text:** a failure's class is the tag `error.type`, and its message is the record part's
  `content`, the one part a person can delete, in place of the study's 200-character cut.

## What it cannot tell us

- Nothing ran. Whether an Effect `Tracer` writing SQLite rows works in a Durable Object with no
  timer or held fiber was untested then; P37's laws and experiment 259 answer parts of it now.
- Whether Cloudflare's custom spans can carry Effect's spans one to one: no `addEvent`, no manual
  parent. Mirroring was left out for that reason.
- Whether the 0 ms rule makes step timing useless on the cloud. Ledger I/O should carry real time;
  not measured.
- The real span count per day; 2,000 rows a day was a guess.
- Whether the owner wants error text in spans at all.
- Cloudflare's prices are as fetched on 2026-11-07; Observability pricing changes on 2026-12-01.
- The size guess was about six times low; the study gives no way to tell which part was missed.
