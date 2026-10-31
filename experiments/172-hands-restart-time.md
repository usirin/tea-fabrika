# 172. When the hands die, how long until the window is back?

**Answer.** Well under a second. The app's host stands in for the hands. When it
is killed with a window attached, the window is back and caught up in a median
of 0.40 s (p95 0.59 s) with 10 open asks on the ledger. With 1,000 asks it is
0.55 s (p95 0.67 s), and with 10,000 it is 0.79 s (p95 0.98 s). That is under
Node. Under Electron's own binary, as the app runs it, it is 0.45, 0.56 and
0.80 s. About half of each number is a wait the app picks on purpose (the
reconnect jitter, 0 to 500 ms). The extra hop through the hands' socket costs
about 0.02 to 0.04 ms a message: nothing.

**The surprise is the brain.** A Miniflare that the hands run in their own
process does **not** die with them. workerd is left running, still answering on
its port, 20 runs of 20, and still there 30 s later. New hands then cannot start
their own brain on that port: 20 of 20 failed with `ERR_ADDRESS_IN_USE`. So in
that shape a hands crash cuts the window off from the brain until someone kills
the orphan by hand. Today's daemon shape (`packages/fabrika/src/host/daemon.ts`,
Miniflare in a child that watches its parent) does die with the hands, in about
0.26 s, 20 of 20. It then costs a fresh brain start of about 0.46 s.

**For L3** (its lean was replaced on 2026-10-31, see Leans): talking to the
brain only through the window's own hands is cheap. A
crash costs under a second, and the app already restarts the hands by itself.
That holds only if the brain's lifetime is tied to the hands on purpose. Either
kill it with them (today's daemon guard), or let the new hands adopt the brain
still running. An unguarded in-process Miniflare breaks it. I am about 85% sure
of the "under a second" part on a laptop like this one. The doubt is a real desk
with many tiles and running jobs, which I did not build (see the end).

```ts
// The whole measurement, shortened from 172-hands-restart-time.ts: a window attached to the
// host, the host killed, then what the app's reconnect machine and attach do, by hand.
const t0 = now();
process.kill(host.pid, "SIGKILL");
await link.ended;                                // the window sees the socket end: ~2 ms
await sleep(backoffDelay(1, POLICY, rng));       // the app's first wait: full jitter, 0 to 500 ms
const back = await attach(home, sock);           // stale socket: start host.mjs, look every 50 ms, hello
back.link.send({type: "page"});
await caughtUp(back.link, size);                 // the desk, the asks read off the ledger, tsh's prompt
const total = now() - t0;                        // 10 asks: median 401 ms, p95 586 ms (Node)
```

Who did what: everything here is this repo's code. The hands are the app's host,
`apps/fabrika/dist/host.mjs`, built from main and unchanged. The window is a
hand-written JSON Lines client (`lib/host-link.ts`) that does what
`apps/fabrika/src/attach.ts` and `src/reconnect.ts` do. No agent, no model, no
ledger server, no network. $0.

## How it was run

```sh
pnpm --filter @kampus/fabrika-app build
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY SIZES=10,1000,10000 \
	nice -n 15 node experiments/172-hands-restart-time.ts
# then RUNTIME=electron PARTS=cold,crash (the app's Electron as Node), and
# RUNS=3 WATCH_MS=30000 PARTS=brain (the long watch of an orphaned brain)
```

- One MacBook (Apple silicon), idle, every process under `nice -n 15`. Node
  26.12.0. Electron 45's own binary with `ELECTRON_RUN_AS_NODE=1`, which is
  Node 24.22.0, as the app starts its host.
- 20 runs of each measurement, 2,000 messages for the hop. Medians and p95s
  (nearest rank) are below; min and max are in the results file.
- Each run has its own app home in a temp folder (`FABRIKA_HOME`), never the
  real one. Every process started is tracked by pid and killed at the end. The
  temp folder is removed. The last runs ended with 0 of our processes alive and
  no temp folder left.
- The host is started the way `src/start-host.ts` starts it: detached, stdin
  and stdout ignored, stderr appended to `<home>/host/log`. One difference: the
  app lets the child go (`unref`) and this script does not, since it waits for
  the exit.
- The ledger is the home's own node:sqlite file, seeded before the first
  start. Each ticket has a `filed` fact and one open `asked` fact, as
  `host.test.ts` writes them. So N asks means 2N rows.
- The jitter uses tea's own `backoffDelay(1, POLICY, rng)` with the app's
  policy copied, and a seeded random number, so a rerun waits the same.

Results: `experiments/results/172-hands-restart-time.json`.

## 1. Host cold start

From spawn until the socket answers a hello, looking every 5 ms. The home had a
ledger already. The first start on a new home is not counted (158 ms).

| Host runs on | median | p95 |
|---|---|---|
| Node 26 | 158 ms | 164 ms |
| Electron 45 as Node | 186 ms | 199 ms |

## 2 and 3. Crash, reconnected, caught up

`SIGKILL` on the host while a window is attached and caught up. Then the app's
own steps: see the end, wait the jitter, look at the socket (it is stale), start
a host, look every 50 ms until it listens, say hello, send `page`, and wait for
the window's state.

"Caught up" means three things have come: the desk (`desk`, open), the asks
read off the ledger (`asks`, `reach: "ok"`, all N of them), and a tile's
terminal showing `tsh$`. That is what the host really serves a page
(`host/serve.ts`, the `page` case). The host serves no list of ledger entries
to the page. The asks are the part of the page that grows with the ledger.

Node, median and p95 in ms:

| Asks on the ledger | Kill to hello | The same, no jitter | Hello to caught up | Kill to caught up |
|---|---|---|---|---|
| 10 | 399 / 585 | 170 / 182 | 0.4 / 0.5 | **401 / 586** |
| 1,000 | 543 / 664 | 200 / 213 | 1.2 / 1.5 | **545 / 666** |
| 10,000 | 766 / 957 | 468 / 501 | 19.6 / 21.9 | **786 / 977** |

Electron as Node: kill to caught up 449 / 634, 556 / 687 and 802 / 964 ms.
Without the jitter: 214 / 217, 222 / 244 and 474 / 490 ms.

Where the time goes, with 10 asks under Node:

- **The window sees the end:** 2.2 ms (p95 2.8). The kernel closes the
  socket when the process dies, so the window knows at once.
- **The jitter:** median 237 ms, uniform from 0 to 500 ms. This is the app's
  `POLICY` (AWS full jitter, base 250 ms). It is the largest single part.
- **Start until the socket takes a connection:** 155 ms. The 50 ms look in
  `attach` rounds this up: the host itself listens a little sooner.
- **Socket open to hello answered:** 13 ms with 10 asks, 42 ms with 1,000,
  305 ms with 10,000. The host listens early but answers the hello only once
  its server runs, and that comes after it has read the whole ledger for the
  asks. So the ledger's size shows up before the hello, not after it.
- **Hello to caught up:** under 1.5 ms up to 1,000 asks. The page gets
  everything in one burst.

Does the app restart the hands today? **Yes.** When the link ends, the reconnect
machine waits, then tries `attach`. `attach` finds a stale socket, starts a new
host and waits for it to listen. The new host removes the stale socket file
first. Nobody has to press anything. It keeps trying for five minutes, then
asks the person.

The host had no child processes of its own at the time of the kill (0 in every
run). Every tile's tsh runs inside the host process, so nothing was left behind.

## 4. The brain: does workerd die with the hands?

Two stand-in hands, each started 20 times, each killed with `SIGKILL` once its
brain answered. Then a watch for 3 s: do the brain's processes go, and does its
port stop answering?

| Shape | workerd under the hands | Spawn to first answer | Brain after the hands' SIGKILL |
|---|---|---|---|
| Miniflare in the hands' own process, no guard (`hands-miniflare.ts`, the smallest Worker) | 1 | 214 / 235 ms | **left running, answering: 20 of 20**; 3 of 3 still answering after 30 s |
| Today's daemon as a child, in a group of its own, as `local.ts` starts it (`hands-daemon.ts`, the ledger's Durable Object, from source) | 1 | 463 / 482 ms | gone, 20 of 20, in 262 / 264 ms |

- **In-process Miniflare orphans workerd.** Miniflare starts workerd as a plain
  child. Nothing in workerd watches its parent. When the Node process is
  killed, workerd is re-parented to launchd and keeps serving.
- **The orphan holds the port.** New hands starting their brain on the same
  fixed port failed 20 of 20, with `MiniflareCoreError [ERR_ADDRESS_IN_USE]`.
  A fixed port is what the local plan wants, so the URL stays the same across a
  restart (`local.ts`). So in this shape the new hands come back in 0.2 s, but
  their brain does not come back at all.
- **Today's daemon dies with its parent** because of its own guard: it checks
  `process.ppid` every 250 ms and disposes Miniflare when it changes. That is
  the 235 to 264 ms. The brain's data is in its persist folder, and 171 saw it
  kept across a crash (not checked again here). But the brain must cold start
  again (about 0.46 s), so the brain is back about half a second after the
  hands.
- Experiment 171 found the same for Alchemy's local stage: a killed parent
  leaves workerd running but unreachable, because Alchemy's relay died with
  the Node process. It needed the same one-line ppid guard.

**This changes the L3 answer.** "The window talks only through its hands" is
fine only if the hands own the brain's life on purpose. There are two ways to do
it:

- **Kill it with them**, as the daemon does today. The window is back in about
  0.4 s. The brain is back about 0.5 s after the new hands start it. Simple, and
  already written. Cost: every hands crash is also a brain restart.
- **Let it outlive them and adopt it**, as tmux's server outlives its clients.
  The new hands find workerd still answering on the fixed port and use it,
  instead of starting a second one. The brain never goes down. But it needs a
  way to tell "our brain, same build" from a stale one, and a way to stop it on
  purpose. None of that exists. I am under 50% sure this is worth it. A test
  that adopts an orphan and checks its build would settle it.

## 5. The extra hop

One small message there and back, 2,000 times. Median and p95:

| Path | median | p95 |
|---|---|---|
| Window to host and back: a desk key it does not take, and its `answer` | 0.035 ms | 0.064 ms |
| Window to an echo process and back, on a Unix socket: the hop alone | 0.020 ms | 0.031 ms |
| A function call, with JSON both ways, in one process | 0.001 ms | 0.001 ms |

The socket hop is about 20 microseconds. A frame at 60 Hz is 16,700. The hop does
not matter for L3.

## Leans

- **L3: keep the window behind its own hands.** Why: a crash costs under a
  second, the app already restarts the hands, and the hop is free. Cost:
  nothing new, as long as the brain is guarded (next lean). Confidence 85%. The
  doubt is a heavy desk, which I did not test.
  **Replaced 2026-10-31, after this was written:** every window, Electron's
  too, now dials the brain over its own WebSocket and signs its hello; it does
  not talk through the hands. What this experiment still settles: the hands
  own the local brain's life, so a hands crash must take the brain down with
  it, or the new hands adopt it (the next lean).
- **Never run Miniflare unguarded inside the hands.** Why: its workerd outlives
  a crash and blocks the next brain's port, 20 of 20. Cost: the daemon's
  250 ms ppid guard, or a guard of our own around in-process Miniflare.
  Confidence 95%: it failed every time, on one machine and one Miniflare
  version (4.20260730.0).
- **Maybe: try the first reconnect at once when the host is on the same
  machine.** Why: the jitter is half of the outage (median 237 ms). It exists
  to spread many clients over time, and one laptop has one or two windows. The
  start lock (`host/lock.ts`) already makes two windows starting at once safe.
  Cost: one line in `reconnect.ts`'s policy, and a law test. Confidence 65%:
  I have not checked what else leans on the first wait. A run with two windows
  on one home, both reconnecting at 0 ms, would settle it.
- **Maybe: answer the hello before the ledger is read.** Why: with 10,000 asks
  the hello waits about 300 ms for the asks' first read. The page already has a
  `reading` state for the asks. Cost: a change in `run.ts` and `serve.ts`.
  Confidence 60%: 10,000 open asks is far more than a real desk has today.

## What this cannot tell us

- **A real desk.** One tile, one tsh, no running job, no program window. The
  desk did not grow across restarts, and each tile's terminal was a fresh
  prompt. A desk with many tiles, long scrollback and live program views may
  take longer to send. I did not measure that.
- **What a crash loses.** A job running in a tile dies with the host, since it
  runs in the host's process. I measured how fast the window comes back, not
  what the person loses.
- **The window's own drawing.** The "window" here is a socket client. The real
  page has to redraw the desk, the terminals and the frame. That is not in
  these numbers.
- **The packaged app, a slow disk, or load.** One idle laptop, from the repo's
  build. Each run had its own ledger file, warm in the disk cache.
- **A hang.** Only `SIGKILL`. A host that hangs with its socket still open
  would not end the link, and the window would wait. Nothing here notices that.
- **The brain under the real plan.** The in-process shape ran the smallest
  Worker, not the ledger. The daemon shape ran the ledger's Durable Object from
  source, so it bundles the Worker with esbuild at each start. A built
  `daemon.mjs` may start faster (171 saw 0.3 to 0.4 s). Adopting an orphaned
  brain was not tried.
- **Other machines.** The hands on a VM, a remote brain, or a network between
  them are all out of scope here.
