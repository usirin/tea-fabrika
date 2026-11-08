# 232. The local stage's first speed bar

This is P12, ticket 270, in `next/`. Nine runs of the real stage on one laptop, in one sitting:
four initial runs, then five head runs, all on branch head `c2a38125`. Medians, initial then head:

- **Start to listener ready:** 3.25 s, then 2.73 s. This includes the brain build that `dev.ts`
  runs on every start. The `brain.start` span alone (deploy, wait for the listener, first call,
  outbox flush) takes 0.45 s, then 0.39 s.
- **Accepted send:** 23.0 ms, then 19.5 ms, pooled. The first send of each run is slower, 57 to
  132 ms.
- **Cross-client publication:** 14.4 ms, then 11.3 ms. That is the time from one client's send
  until another client gets the `view.patch`.
- **Replacement after a killed workerd:** 0.52 s, then 0.47 s, until the same address serves again.
  A new signed wire then takes another 88 ms, then 82 ms.
- **workerd RSS:** 124 MB under traffic and 98 MB after its replacement.
- **Member fold and process history:** below workerd's clock. Every span reads 0 to 2 ms.
- **Sink flush:** missing. It has no span, on purpose.
- **Compiler:** the build tests' `.tsx` input builds in 336 ms with the React Compiler and 243 ms
  without it, a median of five each. That is about 90 ms more.

The laptop was very loaded the whole time. Load average was 25 to 38 on 12 cores, from other
agents. So read this as a bar that holds under load, not as what the stage can do on a quiet
machine.

```ts
// The whole idea: drive the real dev.ts, time each step from outside, read the rest from records.
const child = spawn("nice", ["-n", "15", node, "next/apps/fabrika/dev.ts", "--port", port, ...]);
await until(() => fetch(url).ok);                         // startMs
const a = await connect(url, key, "tab-a");               // signed hello over the wire
const b = await connect(url, key, "tab-b");
await b.call("view.open", {pid});
const sent = now(); await send(a, pid, "p-0");            // sendMs: until `accepted`
await until(() => b.arrived.some(patchFor(rev)));          // publishMs: until b sees the patch
process.kill(workerdPid, "SIGKILL");                       // Alchemy replaces it, same address
await until(() => fetch(url).ok && newWorkerd());          // replaceMs
await connect(url, key, "again");                          // reconnectMs
// After a SIGTERM stop: every object's `health` table gives (piece, ms) per span.
```

## How it was run

- `experiments/232-local-stage-speed-bar.ts` is the driver. It starts the real
  `next/apps/fabrika/dev.ts` with its own `FABRIKA_HOME` from `mktemp -d /tmp/fh.XXXX`. The key is
  unset. Every child runs under `nice -n 15`. Only one stage runs at a time. Before each run, the
  driver waits while 6 or more vitest workers run, and it records `uptime`.
- The wire client is a copy of the one in `next/apps/fabrika/src/stage-wire.test.ts`. It does the
  same SSHSIG-signed `initialize`, `process.send` and `view.open`. It counts the real
  `counter:1` program.
- Each run does this: one hello; 20 sequential sends from client A; 10 sends from A while client B
  watches the view; a SIGKILL of the one workerd under the stage's group; a new wire; one more
  send; a 2.5 s wait so the record loop can flush; then SIGTERM on `dev.ts`.
- RSS is read with `ps` from the workerd process only. The Node child's RSS is saved beside it for
  context. It is not part of the bar.
- Spans are not timed by the driver. They come from the product's own P37 health rows (`piece`,
  `ms`), read only from every object's SQLite file and from the Node side's `brain.record` file.
  This happens after the stop, and then the home is deleted.
- Versions: Alchemy 2.0.0-beta.84 (patched in the repo), workerd 1.20261012.1 (the one Alchemy's
  runtime package pins), Rolldown 1.2.13, Effect 4.1.1, oxc-transform-react 0.157.0, Node 26.13.0,
  and an Apple M2 Max with 12 cores.
- No model was called and nothing left the laptop. The cost was $0. Each set of runs took under a
  minute of wall time.

```sh
env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/232-local-stage-speed-bar.ts stage initial 4
env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/232-local-stage-speed-bar.ts stage head 5
env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/232-local-stage-speed-bar.ts compiler 5
```

Every individual reading is in `results/232-local-stage-speed-bar.json`, including every health
row of every run.

## The readings

The send and publish figures are medians of each run's own samples, pooled. The send figures leave
out each run's first send. Everything else is a median of one reading per run.

| Measure | Initial (4) | Head (5) | Head range | Source |
|---|---:|---:|---|---|
| Start to listener ready | 3249 ms | 2734 ms | 2242 to 6323 | driver |
| `brain.start` span | 455 ms | 389 ms | 375 to 1360 | records |
| Signed hello on a fresh stage | 24.9 ms | 20.9 ms | 17.7 to 30.6 | driver |
| Accepted send, pooled (p90) | 23.0 ms (33.4) | 19.5 ms (34.0) | | driver |
| First send of a run | 63.0 ms | 59.4 ms | 54.1 to 131.9 | driver |
| Cross-client publication, pooled | 14.4 ms | 11.3 ms | per run 9.3 to 16.5 | driver |
| Replacement (kill to same address serving) | 520 ms | 474 ms | 471 to 1535 | driver |
| `brain.restart` span | 373 ms | 364 ms | 346 to 1023 | records |
| Reconnect (new signed wire after replacement) | 88.1 ms | 82.2 ms | 33.8 to 97.4 | driver |
| First send after replacement | 42.6 ms | 39.4 ms | 34.3 to 92.9 | driver |
| workerd RSS under traffic | 124.4 MB | 124.6 MB | 122.5 to 126.8 | `ps` |
| workerd RSS after replacement | 99.0 MB | 98.4 MB | 94.3 to 102.6 | `ps` |
| Member fold (`members.read`, 31 per run) | 0 ms | 0 ms | max 2 | records |
| Process history (`process.info`, 94 per run) | 0 ms | 0 ms | max 2 | records |
| Program fold (`execution.fold`, 31 per run) | 1 ms | 1 ms | max 3 | records |
| Sink flush | missing | missing | | |
| `brain.flush` (lifecycle outbox, not the sink) | 19.5 ms | 20.0 ms | max 37 | records |
| `brain.stop` span | 79.8 ms | 59.4 ms | 54.8 to 96.0 | records |
| Clean stop, SIGTERM to exit | 113 ms | 88 ms | 83 to 140 | driver |

Head run 5, the first head run, was slow across the board: start 6.3 s, replacement 1.5 s and
`brain.start` 1.36 s. The load average was 31 just then, and other agents were starting work. Its
siblings were 2.2 to 3.6 s and 0.47 to 0.59 s. The medians keep it. I did not drop it.

There were also two smaller findings:

- **Nothing was left behind.** All nine runs left no process in the stage's group after the stop.
- **Restart facts land late.** In 7 of 9 runs, a `door/brain` read right after the reconnect
  showed only the first `started` fact. The `exited` and second `started` facts reached the
  ledger later, through the 1 s outbox loop. In one run, `exited` was there and the new `started`
  was not yet. Test p81 already waits for these facts. A reader that wants the restart's cause at
  once must wait for the next outbox turn, up to about 1 s.

## Why the fold costs read as zero

workerd does not move its clock forward during compute. That is how Workers block timing
attacks: `Date.now()` and `performance.now()` move only at I/O. Every span that ends inside a
Durable Object without I/O therefore reads 0 ms. That covers `members.read`, `process.info` and
`ledger.append` (the last does SQLite work, which is synchronous). So these readings do not
measure CPU. What they do say: on a ledger this small (about 70 appends per run), no fold waited on
I/O, and no fold crossed a clock step large enough to show. A real member-fold or history cost
needs either the same pure fold timed on Node, or a ledger large enough to cross a clock step.
Neither was in scope here.

## Sink flush: why it is missing

`SpanSink.flush` has no span by design. The plan's recording law forbids "trace the sink's own
delivery", and test `stage-records.test.ts` fails if `sink.flush` or `record.write` shows up as a
span. The driver cannot see the flush from outside either, since it runs inside the 1 s loop in
`node/stage.ts` and inside each object. So no reading was taken. The nearest one is
`brain.flush`, about 20 ms, but that is the lifecycle outbox, a different queue. To measure the sink
flush, it needs a counter or a timing that is not a span: a health row the sink writes about
itself after a flush, outside the traced path. That is a product change, out of scope for this
step.

## Compiler on and off

The input is the build tests' clean `hidden.tsx`, imported by a program beside the real counter.
"On" is the real `build()` from `next/apps/fabrika/src/build.ts`: the Compiler plugin, the full
`check` and the publish of the compiled files. "Off" makes the same two Rolldown passes
(`bundlePrograms`, then `bundle` of `brain.ts` with the program table) without the Compiler plugin
and check, and writes `brain.mjs`. The load average was 20 to 26.

```text
on   431  197  319  348  336   median 336 ms
off  282  242  273  200  243   median 243 ms
```

With one small `.tsx`, the Compiler adds about 90 ms, and the first "on" run is the slowest. "Off"
also skips the atomic rename publish that "on" does, so part of the 90 ms is that step, not the
Compiler. P14 records the first real window bundle.

## Against experiment 171

Experiment 171 measured Alchemy's local stage on today's ledger bundle, already built. It took 1.2
to 1.4 s to first answer, with replacement in 0.3 to 0.5 s. This stage builds on every start, so
its 2.2 to 3.6 s is not comparable one to one. `brain.start` (0.39 s) is the part that compares to
171's deploy. Replacement here is 0.47 to 0.52 s, at the top of 171's range, under a much heavier
load. The plan says not to reuse raw Miniflare numbers as this stage's baseline, so 171's numbers are
here only as context.

## What this cannot tell us

- **This is a loaded laptop, not a quiet one.** Load was 25 to 38 on 12 cores for every stage run.
  The bar is honest for this machine today. A quiet machine would likely be faster. I did not run
  one.
- **There was no tuning between "initial" and "head".** Both sets ran on the same code, so the
  head being a little faster is drift and load, not a change. Together they are nine readings of
  one build.
- **Member fold and process history are not measured as CPU.** See above.
- **Sink flush is missing.** See above.
- **The ledger is small.** 31 inputs and about 70 appends per run. It shows nothing about the
  cost when one part holds thousands of entries.
- **The sample is small.** Nine starts, nine replacements and five Compiler pairs. A blocking bar
  wants more runs on a quieter machine before it blocks on a few percent.
- **One probe run was left out.** It came before the saved runs, to check the driver, and was
  cold: start 7.46 s, replacement 0.64 s. It was not saved, since it used the same code with a cold
  build cache.
- **Not the window.** Click-to-count, browser rendering and Electron are P14 and P19.
- **The Node child is about 660 MB RSS.** That is beside the bar, which counts workerd only. It is
  large next to 171's whole-twin figure of about 395 MB. Nothing here says why.
