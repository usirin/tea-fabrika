# 100. A supervision tree on tea-host

The question: can tea-host's supervision grow from experiment 99's single
`one_for_one` supervisor into a real OTP supervision tree? And does it still
hold up under kills, freezes and crash loops?

**Answer: yes.** `one_for_all`, `rest_for_one`, a supervisor under a
supervisor, OTP's supervisor calls, a `shutdown` per child, restart backoff,
monitor re-arm backoff, and dead letters sent back are in the package. Four
fault runs (3 small, 1 large) pass every check, 4 of 4, and the escalate run
passes too:

- each strategy stopped and started exactly the right siblings, in the right
  order: 42 of 42 crash episodes;
- escalation went up one level per give-up: sup:rest gave up once per fault
  run and top restarted it once; in the escalate run sup:rest gave up 4 times,
  top restarted it 3 times, then gave up and took its whole tree down;
- one DOWN per real down, none for 86 host takeovers, every DOWN written
  during a freeze read after it, once;
- counts exact, no two writers, the resent dead letter counted once.

All machine laws hold and every planted mistake is caught (82 of 82).
Confidence 80%. $0.

```ts
supervisor("top", {
  strategy: "one_for_one", intensity: 3, periodMs: 60_000,
  children: [
    {name: "sup:all", restart: "permanent", type: "supervisor"},   // shutdown: infinity
    {name: "sup:rest", restart: "permanent", type: "supervisor"},
  ],
});
supervisor("sup:rest", {
  strategy: "rest_for_one", intensity: 3, periodMs: 5000,
  backoff: {minMs: 100, maxMs: 800, resetAfterMs: 5000},          // Akka / Kubernetes style
  children: [
    {name: "r:1", restart: "permanent"},
    {name: "r:2", restart: "permanent"},
    {name: "r:3", restart: "permanent", shutdown: 100},            // shutdown, then kill at 100 ms
  ],
});
// a call: {id, replyTo, req: {op: "terminate_child", name: "r:3"}} → reply lands in replyTo
yield* deadLetters("r:3");                // what the ledger set aside
yield* redrive("r:3", rev, "ops");        // send it back once (SQS redrive to source)
```

## What was built

- **Restart strategies, OTP's.** Child order is the spec's order.
  - `one_for_all`: the others are stopped too, last first, then all start
    again in order.
  - `rest_for_one`: the children after it are stopped, last first, then it
    and they start again in order.
  - Stops go one at a time. Starts wait until nothing is stopping.
- **A supervisor as a child** (`type: "supervisor"`). It is a child like any
  other. A give-up exits `shutdown` (as OTP does), so its parent counts one
  restart and decides. That is escalation: one level per give-up.
  - A supervisor that gives up stops its children first, last first, then
    exits.
  - A parent's shutdown EXIT stops a child supervisor the same way.
- **Child control, OTP's API, as calls.** `start_child`, `terminate_child`,
  `restart_child`, `delete_child`, `which_children`.
  - A call is an inbox message `{id, replyTo, req}`. The reply lands in
    `replyTo` once the work is done: the child is up, or it is stopped.
  - The same id sent again gets the same answer. The work is done once.
- **`shutdown` per child**, OTP's option.
  - `brutal_kill`: killed at once.
  - A number of ms: the child gets a `shutdown` EXIT if it traps exits, and
    is killed when the time is up.
  - `infinity`: it gets the EXIT and is waited for. The default for a child
    supervisor.
  - A child that does not trap exits ends at once.
  - New ledger law 25: only the parent may stop a child, only that run; a
    `shutdown` can be trapped, a kill cannot.
- **Restart backoff, opt-in.** See the backoff section below.
- **Monitor re-arm backoff.** After a `noproc` (the name is down), the
  watcher asks again after 50 ms, then 100, 200, up to 1,000 ms. It starts
  over once the name is back.
- **Dead letters, read and sent back.** `deadLetters(name)` lists what the
  ledger set aside, with the message. `redrive(name, rev, writer)` sends it
  to the end of the inbox under the id `redrive:<rev>`: sent twice, it lands
  once. A DOWN or EXIT is never sent back. SQS calls this a redrive to the
  source queue; RabbitMQ's shovel does the same.

## Backoff: what the industry does, and what was picked

- **Erlang/OTP and Elixir:** no restart backoff, on purpose. A restart is
  instant. The brake is intensity: too many restarts in a period and the
  supervisor gives up, so the parent decides.
- **Akka:** `BackoffSupervisor` (now `BackoffOpts`): min, max, a random
  factor, and a reset after a run that lived long enough.
- **Kubernetes:** CrashLoopBackOff. 10 s, doubling, up to 5 minutes; reset
  after 10 minutes of a good run.
- **systemd:** `RestartSec` (a fixed wait), plus `StartLimitBurst` and
  `StartLimitIntervalSec` (OTP's intensity and period, in effect).

**Picked: OTP by default, Akka's and Kubernetes' backoff as an option.**

- With `backoff: {minMs, maxMs, resetAfterMs}`, the n-th restart in a row
  of one child waits `min(maxMs, minMs * 2^(n-1))`. A run that lived
  `resetAfterMs` or more starts the count again.
- Why opt-in: OTP's instant restart plus intensity is the tested default.
  On a durable ledger a restart is cheap, and a wait slows recovery from a
  one-off crash.
- Why have it at all: a child that dies at boot (a bad config, a missing
  service) burns its intensity in milliseconds and takes its supervisor down
  before anything outside could recover. A wait gives the outside a chance.
- **A spec whose backoff spreads `intensity` restarts past `periodMs` is
  refused.** The brake could then never trip, and a crash loop would never
  reach the parent. Make the mistake impossible, not warned about.
- No jitter yet. The waits are exact.
- Tradeoff: two knobs that can fight. The refusal is what keeps them
  honest. Confidence 75%.
- **Monitor re-arm:** 99's watcher asked every 50 ms and got 117 `noproc`
  DOWNs in 1.5 s. Now 50 ms doubling to 1,000 ms. In the escalate run (the
  whole tree down at the end): 120 `noproc` over 23.7 s of names being down,
  where a fixed 50 ms re-arm would give about 474. In the fault runs names
  are down only for a few hundred ms, so it changes little there (55 to 61
  against about 47 to 73).

## The fault runs

Three host processes serve every name: top, sup:all (`one_for_all`: a:1,
a:2, a:3), sup:rest (`rest_for_one` with backoff: r:1, r:2, r:3), the
workers, and watcher:1 (a monitor on all 9). Whoever wins a name's lease runs
it. a:2 traps exits and stops itself on shutdown (`shutdown: 300`); a:3 and
r:3 trap and ignore it (a:3 is `brutal_kill`, r:3 has `shutdown: 100`, so it
is killed). A sender writes 100 messages a worker (small) or 1,000 (large).
The script:

- calls: `which_children`, `start_child` t:1, `terminate_child` r:3 (twice,
  the same id), `restart_child` r:3, `terminate_child` and `delete_child`
  t:1, `which_children` again;
- a planted crash in a:2 (`one_for_all`);
- SIGKILL the host holding sup:all, start a new host;
- a planted crash in r:2 (`rest_for_one`);
- SIGSTOP the watcher's host for 0.7 s (under the lease) with a crash 50 ms
  in, then for 2.5 s (over the lease) with a crash 500 ms in. The crash is
  in a worker with a live lease on another host (8 of 8 this batch);
  other children on the frozen host stay frozen with it;
- a poison message to r:3: 3 crashes, then the ledger sets it aside;
- a crash loop: r:2 dies at boot (a flag in the ledger). It backs off 100,
  200, 400 ms, sup:rest gives up, top restarts sup:rest; the flag is
  cleared;
- the poison bug "fixed" (a flag), then `redrive` of the dead letter, twice;
- SIGKILL the host holding r:1;
- SIGKILL every host at once, then start one new host.

Every check reads the ledger.

| Check | small 1 | small 2 | small 3 | large 4 |
|---|---|---|---|---|
| Crash episodes: right siblings, right order | 11 of 11 | 10 of 10 | 10 of 10 | 11 of 11 |
| Stops or starts nothing explains | 0 | 0 | 0 | 0 |
| sup:rest give-ups / top restarts of it / top exits | 1 / 1 / 0 | 1 / 1 / 0 | 1 / 1 / 0 | 1 / 1 / 0 |
| Calls answered right, one reply per id | 8 of 8 | 8 of 8 | 8 of 8 | 8 of 8 |
| r:3 killed after its shutdown signal | 100–104 ms | 102–105 ms | 101–103 ms | 101–103 ms |
| a:2 (`shutdown: 300`, traps): ends itself / killed at 300 ms | 1 / 1 (its host frozen) | 2 / 0 | 1 / 0 | 0 / 0 |
| Backoff waits (planned 100 / 200 / 400) | never early | never early | never early | never early |
| Real DOWNs / `noproc` DOWNs | 21 / 57 | 20 / 56 | 20 / 55 | 18 / 61 |
| DOWN read after written, p50 / p99 | 4 / 663 ms | 6 / 663 ms | 6 / 655 ms | 3 / 652 ms |
| Every death reported once, none twice, none phantom | yes | yes | yes | yes |
| Host takeovers (no DOWN, no exit for any) | 16 | 21 | 18 | 31 |
| Exits after every host was killed | 0 | 0 | 0 | 0 |
| Counts (count / inbox less dead) | 6 of 6 exact | 6 of 6 | 6 of 6 | 6 of 6 (1,000 to 1,009) |
| Dead letter: set aside / redrive / landed | once, 3 strikes / sent, dup / once | same | same | same |
| Saves not under the latest claim | 0 | 0 | 0 | 0 |
| Host errors | 0 | 0 | 0 | 0 |

Pooled over the four runs (ms):

| What | n | p50 | p99 |
|---|---|---|---|
| Restart: a worker's exit to its `restarted` row, backoff included | 98 | 64 | 768 |
| DOWN: written to first read | 79 | 4 | 663 |
| Backoff wait under sup:rest | 32 | 201 | 768 |
| Backoff wait less the planned one | 32 | 3 | 568 |
| The same, sup:rest's own host awake | 30 | 3 | 20 |
| DOWN written during a freeze, to first read | 21 | 507 | 663 |

- The DOWN p99 is the freezes. Outside them DOWN p99 is under 10 ms.
- **The short freeze (0.7 s):** the frozen host kept its lease. Its watcher
  read the DOWNs itself on waking, 359 to 663 ms after they were written.
- **The long freeze (2.5 s):** the lease ran out, another host took
  watcher:1 over and read the DOWNs 3 to 510 ms after they were written. The
  frozen host, on waking, was fenced out. Nothing was reported twice.
- A crash during a freeze took 2 to 16 ms to land as an exit.
- **A frozen supervisor restarts late, and that is right.** In the large
  run sup:rest sat on the frozen host when r:2 crashed: its restart came
  768 ms after the crash (planned 200), once the host woke. Leave those
  out and a backoff wait is at most 20 ms late.
- **A frozen child is killed at its timeout.** In small 1, a:2 sat on the
  frozen host when sup:all had to stop it. It could not trap the shutdown,
  so it was killed at its 300 ms timeout: OTP's `shutdown` timeout doing its
  job.
- Each run took about 44 s (large 48 s). The tree came up in 2.4 s.

### Escalate

The crash loop is never fixed: r:2 dies at every boot.

- sup:rest backs off 100, 200, 400 ms, then gives up (4 restarts in 5 s).
  Each time it stops r:3 then r:1, then exits.
- top restarts it. It happens again: 4 give-ups in all, 3 restarts by top.
- The 4th give-up is past top's intensity (3 in 60 s). top gives up: it
  stops sup:all, which stops a:3, a:2, a:1 (last first), then sup:all
  exits, then top exits. One DOWN for top. Every name down.
- About 3.6 s from the first crash to top's exit. The same backoff waits
  each time: 111 to 116 / 201 to 203 / 402 to 404 ms.

## The laws

| Machine | Laws | States walked | Planted mistakes caught |
|---|---|---|---|
| The ledger (`packages/tea-host/src/laws.ts`) | 98's and 99's, plus 25 (`exit_child`) | on the Durable Object, node:sqlite, memory | 24 of 24 (3 new) |
| Host machine | 18 | 2,876 (depth 9) | 19 of 19 |
| Supervisor, under each strategy | 19 (8 new) | 51,145 (depth 6) | 22 of 22 (11 new) |
| Monitor module | 10 (1 new) | 34,957 (depth 8) | 10 of 10 (1 new) |
| Call module | 7 | 7,786 (depth 7) | 7 of 7 |

- New supervisor laws: a restart takes exactly the strategy's siblings; a
  running child is stopped before it starts again; a start in flight from
  before a group restart is not kept running; a restart waits between
  `minMs` and `maxMs`; a crash again soon waits twice as long, a long run
  starts over; a call sent again gets the same answer; a terminated child
  stays stopped; it exits only once every child is stopped.
- Some planted mistakes they catch: `one_for_all` restarting only the
  child, `rest_for_one` restarting the ones before it, a group restart that
  starts siblings without stopping them (two runs at once), a late start
  taken as the restart, no backoff, a fixed wait, a wait that never starts
  over, a call done twice, a terminated child started again, a give-up that
  exits with its children still running.
- Ledger plants: a kill that can be trapped, a shutdown that kills a child
  that traps exits, an exit signal to an old run that takes down the new
  one.
- Monitor plant: 99's fixed re-arm.
- Unit tests in `packages/tea-host/src/supervisor-tree.test.ts`: each
  strategy's order, the shutdown kinds, backoff, calls, and four runs on
  the in-memory ledger (strategies, calls past a shutdown timeout, a boot
  crash loop that escalates, a redrive).

## What went wrong, and surprises

- **The laws found four real bugs in the new supervisor**, before any
  fault run:
  - a restarted supervisor reloaded its saved `shutdown` state and stopped
    at once (a new incarnation must start from the spec);
  - a `terminate_child` caught by a group restart was never answered;
  - **a start in flight when a group restart caught it** could land after
    a sibling it must follow, so a `rest_for_one` child ran before the one
    it depends on. OTP does not have this race (its `start_child` is
    synchronous). Fixed with a count per child of group restarts, a
    `generation`, as Kafka's consumer group generation goes up at each
    rebalance: a start from an old generation is stopped and started again;
  - that fix at first restarted a `temporary` child through a late start.
- **The harness crashed children on the frozen host, three times over.** A
  frozen child cannot crash until a takeover or the wake, so no DOWN was due
  during the freeze. That was the "slow crash" seen in earlier batches (300
  to 730 ms instead of about 10).
  - First: the pick took the first child, often on the frozen host.
  - Then: it skipped children on the frozen host, but a lease that read as
    lapsed (`null`) counted as "another host". It was the frozen host's.
  - Then: all of the pick's children were on the frozen host. Hosts pile
    names up: in one run all 6 workers sat on the watcher's host.
  - Now: any worker with a live lease on another host; the run records who
    held every name as each freeze began, and which host wrote the exit.
    8 of 8 crashes landed in 2 to 16 ms.
- **The shutdown check was too strict.** It wanted a:2 to always end itself.
  With its host frozen it cannot, and the kill at its timeout is the right
  end. The check now allows that kill only when the run shows a:2's host
  was frozen at that moment.
- **A backoff wait was 1 ms early once** (199 of 200). The wait is a host's
  timer against the ledger's clock, two processes; Node's timers can fire a
  millisecond early. The check allows 2 ms.
- **The sup:rest backoff check first planned 800 ms for a restart that was
  not a backoff:** after a give-up, the new sup:rest starts every child
  from the spec. The check now skips those.
- **The re-arm backoff barely helps in the fault runs.** Names are down for
  a few hundred ms, so 50 then 100 ms asks about as often as a fixed 50 ms.
  It pays off when names stay down (escalate: about 4 times fewer).

## Direction

- No decision changes. OTP's names throughout; backoff is not OTP's, so
  it takes Akka's and Kubernetes' (use the industry's names).
- Two small updates for the owner, not made here (`docs/direction` is not
  edited): the tea-host note's opening line and its map's `supervisor` row
  could name experiment 100 (strategies, trees, calls, backoff).

## Package size

Lines in `packages/tea-host/src` without tests: 3,710 at 98, 6,180 at 99,
7,196 now (+1,016). The supervisor grew from 404 to 943 lines. `rules.ts` is
1,157, `laws.ts` 985, `host.ts` 763.

- Split candidates: `supervisor.ts` into the pure machine (spec, state,
  reducer: about 775 lines) and the inbox and program (about 170);
  `rules.ts` into the core rules and the exit, link and monitor rules. Not
  done here.
- `laws.ts` is a test suite in the package's exports. It could move to its
  own `@tea-fabrika/tea-host-laws` package.

## What is not in yet

- OTP's `simple_one_for_one` / `DynamicSupervisor` (many children of one
  spec). `start_child` adds one named child at a time.
- `significant` children and `auto_shutdown` (OTP 24+).
- `count_children`, `get_childspec`, changing a running supervisor's spec.
- Jitter in the backoff.
- A call's own deadline. The caller waits for the reply; the call module
  from 98 could carry it.
- Who may call a supervisor. Like sending, anyone can.

## What this does not show

- One laptop, one clock, one local ledger (the Durable Object in a
  Miniflare child). No partitions, no deployed Durable Object.
- No Docker run.
- Two levels, six workers. No deep or wide tree.
- Stub programs only. No agent, no model, no key. $0.
