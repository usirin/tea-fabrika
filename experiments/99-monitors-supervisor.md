# 99. Monitors, links and a supervisor on tea-host

The question: can `packages/tea-host` gain OTP's monitors, links and a
supervisor? And do they hold up when hosts are killed, a host freezes, and
one message crashes its program every time?

**Answer: yes.** Monitors, links, `trap_exit` and a `one_for_one`
supervisor are in the package. The supervisor is a tea program like any
other, served under a registered name. Four fault runs (3 small, 1 large)
passed every check, 4 of 4:

- every crash restarted (24 of 24), restart p50 6 ms, p99 8 ms;
- every death reported once, 24 of 24, and none for the 54 host takeovers;
- the poison message set aside after 3 crashes, the tree still running;
- counts exact, no two writers.

OTP's restart intensity alone does not handle a poison message: it only
stops the loop by taking the whole tree down. So the ledger sets the
message aside (a dead letter, as SQS and RabbitMQ do). A supervisor spec
that would let one poison message take the tree down is refused. All laws
hold, and every planted mistake (67) is caught. Confidence 80%.

```ts
const self = yield* Self;
self.incarnation                    // the run number: +1 per restart, the same across a takeover
yield* self.monitor("c:1#1", "c:1") // erlang:monitor: one DOWN in my inbox when c:1's run ends
yield* self.link("c:2")             // link/1, both ways: if one crashes, the other ends too,
yield* self.trapExit(true)          //   unless it traps exits: then it gets an EXIT message
yield* self.startChild("c:1", null) // register c:1 under me and link it, or start it again once down
yield* self.exit("normal", "done")  // end my own run on purpose

const sup = supervisor("sup:1", {strategy: "one_for_one", intensity: 5, periodMs: 5000, children});
if (!sup.ok) console.log(sup.why)   // a spec that cannot work is refused, not warned about
serve({name: "sup:1", holder, program: sup.program});
```

## What "down" means on a durable ledger

- **Down: the program's run ended.** Each run is one incarnation. Three
  reasons, OTP's:
  - `crash`: its update threw, an Effect failed, or it died;
  - `normal`: its main returned;
  - `shutdown`: it was told to stop, or a link took it down.
- **A host dying is not down.** Another host takes the name over and
  replays. Same incarnation, no DOWN, no EXIT. The runs saw 54 takeovers
  and not one DOWN for them.
- **A lease that runs out with nobody to take over is not down either.**
  - Why: a restart cannot fix a missing host. It needs a host too.
  - And a DOWN there would spend the supervisor's restart budget on
    something that is not the program's fault.
  - Orleans says the same: a grain (its actor) always exists. It is just
    not always active.
- **How the three systems compare:**
  - OTP: a process is down when it exits. The node dying gives DOWN
    `noconnection`. Here the node is the ledger, and hosts are not nodes.
  - Akka: `Terminated` when an actor stops. A cluster node that is
    unreachable becomes down only by a decision (a downing provider).
  - Orleans: no "down" for a grain. Callers just call again.
  - Picked: OTP's reasons, Orleans' view of hosts.
- **Only the live lease holder can say its program ended.** An exit is
  fenced on the lease. A program that lost its lease (a refused save, or a
  cause like `Fenced` or `LeaseLost`) does not exit. That would be a host
  problem, not a crash.
- **One ledger transaction per exit.** The `exited` event, the DOWN in each
  monitor's inbox and each link's EXIT (or exit) land together, or not at
  all. That is the job the Erlang VM does in OTP. Each has an id the
  ledger checks (`DOWN:<ref>`, `EXIT:<name>:<incarnation>`), so it lands
  once.
- **A down name takes no claim** (`Down`) until its parent starts it again.
  Only the parent may (`startChild`). A start names the incarnation it
  replaces, so a start sent twice starts once.

## Monitors and links

- **Monitor (`erlang:monitor/2`).** One DOWN, once, in the watcher's inbox,
  with the reason and the incarnation. The caller picks the ref.
  - A monitor of a name that is down, or not registered, answers `noproc`
    at once, and a DOWN `noproc` lands too. As in OTP.
- **Link (`link/1`).** Both ways. When one side exits:
  - a side that traps exits gets an `EXIT` message;
  - any other side exits too, with the same reason;
  - a `normal` exit does not spread.
  - Links are removed on exit. `trap_exit` resets on restart.
- **A hole OTP has, and how it is closed.** A monitor fires once. Between a
  DOWN and the next monitor, a child in a fast crash loop can end runs no
  monitor is on. The escalate run hit it: the poison message crashed c:3
  every 10 to 20 ms, faster than the watcher could monitor again.
  - The fix: incarnations only go up by one, and a restart needs the one
    before it ended. So a monitor that lands on run 6 after a DOWN of run 3
    proves runs 4 and 5 ended.
  - The monitor module reports those as one `gap`. That is sequence-gap
    detection, as a feed reader finds lost messages by their numbers.
  - So every death of a watched name is reported once: as a `down`, or
    inside a `gap`. A gap has no reasons. They are in the name's registry
    stream (`exited`) for a watcher that needs them.
  - Seen in 3 of 4 fault runs (`c:3@2..3`, `c:3@3..3`) and in the escalate
    run (`c:3@2..4`). Without it, 3 of 4 runs would have missed a death.

## The supervisor

- **OTP's `supervisor`, `one_for_one`.** A crashed child is started again,
  alone. Restart types:
  - `permanent`: always started again (the default);
  - `transient`: only after a `crash`;
  - `temporary`: never.
- **Restart intensity:** at most `intensity` restarts within `periodMs`.
  One more and it gives up: it exits `shutdown`, and its links take its
  children down with it. Its own parent decides next (escalation).
  - The window uses the ledger's clock (the EXIT's `at`), so a replay
    decides the same way.
- **It is a tea program on a host,** under a registered name. It traps
  exits first, so a child's exit comes as an EXIT message. It decides in
  its reducer, and the starts are a Sub.
  - A takeover of the supervisor (same incarnation) changes nothing: it
    replays, and a start in flight is sent again.
  - A restart of the supervisor (new incarnation) starts every child from
    the spec, as OTP's `init/1` does.
- **Elixir's `DynamicSupervisor.start_child`** is in, as a cast:
  `{start_child: {name, restart}}` in its inbox. The caller learns the
  child is up with a monitor, not from a reply.
- **Refused specs** (`supervisor(name, spec)` gives `{ok: false, why}`):
  - an `intensity` below `maxDeliveries` (default 3): one poison message
    would take the whole tree down before the ledger sets it aside. So
    OTP's default intensity of 1 is refused, unless dead letters are off;
  - a `periodMs` of 0 or less, a negative or fractional `intensity`;
  - two children with one name, or a child with the supervisor's name.

## The poison message

A pure reducer that throws on message X throws again on every replay. What
others do:

- **OTP:** a restart throws away the mailbox, so the message is gone. Here
  the inbox is durable, so a replay brings it back. Intensity then stops
  the loop only by giving up: the whole tree goes down, and the message is
  still there for the next start.
- **Akka:** a restart drops the message that failed. It is lost unless the
  actor stashed it.
- **Temporal:** a workflow task that fails the same way is retried for
  ever, until someone fixes the code.
- **Orleans:** an exception goes back to the caller. For streams, a failed
  delivery goes to a failure handler.
- **SQS:** after `maxReceiveCount` receives, the message moves to a dead
  letter queue (a redrive policy).
- **RabbitMQ quorum queues:** a `delivery-limit`, then dead-lettered or
  dropped.
- **Kafka:** no broker dead letters. Kafka Connect and Spring Kafka add a
  dead letter topic after N tries.

**Picked: SQS's redrive, in the ledger.**

- A crash names its suspect: the first inbox message past the last saved
  state, not already set aside.
- The same suspect in 3 crashes in a row: the ledger writes `dead_letter`
  to `<name>/dead`, in the same transaction as the exit. Anything between
  resets the count.
- Hosts skip a dead rev. The next run goes on past it.
- Why the ledger and not the supervisor: the ledger sees every exit, the
  supervisor's state can be replayed, and a dead letter must land once.
- It is kept, not dropped, so someone can look at it and send it again.

What happened:

| Run | Dead letters | What it did with one poison message |
|---|---|---|
| Fault runs (maxDeliveries 3, intensity 5 in 5 s) | on | 3 crashes, 3 restarts, set aside once (`strikes: 3`); the tree kept running; c:3 counted every other message |
| Escalate (dead letters off, intensity 3 in 5 s) | off | 4 crashes in 57 ms; the supervisor gave up (`reached_max_restart_intensity`) and took c:1 and c:2 down with it; the poison is still in the inbox |

Is intensity enough? No. It is a brake, not a fix. It turns a crash loop
into a whole tree down, and the next start of the tree meets the same
message. A durable inbox needs a dead letter step. Intensity is still
needed for crashes that are not one message's fault.

## The fault runs

Three host processes serve every name: `sup:1`, `watcher:1` and the
children `c:1`, `c:2`, `c:3`. Whoever wins a name's lease runs it. A
sender writes 100 messages a child (small) or 1,000 (large). The script:

- a planted crash in c:1 (it saves the message, then dies);
- SIGKILL the host that holds sup:1, start a new host;
- a planted crash in c:2;
- SIGSTOP the host that holds watcher:1 for 2.5 s, then SIGCONT;
- the poison message to c:3 (its reducer throws on it);
- a planted crash in c:1 again;
- SIGKILL the host that holds c:1, start a new host;
- SIGKILL every host, wait 3 s, start one new host.

Every check reads the ledger.

| Check | small 1 | small 2 | small 3 | large 4 |
|---|---|---|---|---|
| Exits: 3 planted + 3 poison, nothing else | 6 | 6 | 6 | 6 |
| Restarted | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| Restart (exit to `restarted`), p50 / p99 | 7 / 8 ms | 5 / 8 ms | 6 / 8 ms | 6 / 7 ms |
| Back up (exit to running again), p50 / p99 | 15 / 20 ms | 11 / 15 ms | 14 / 20 ms | 14 / 14 ms |
| Deaths reported once (down + gap) | 6 of 6 | 6 of 6 | 6 of 6 | 6 of 6 |
| Seen by a monitor / inside a gap | 4 / 2 | 5 / 1 | 6 / 0 | 4 / 2 |
| DOWN read after it was written, p50 / p99 | 5 / 6 ms | 4 / 5 ms | 4 / 5 ms | 4 / 5 ms |
| Host takeovers (no DOWN, no exit for any) | 15 | 13 | 14 | 12 |
| Exits after every host was killed | 0 | 0 | 0 | 0 |
| Poison set aside | once, 3 strikes | once | once | once |
| Counts (count / inbox less dead) | 102, 101, 100 exact | exact | exact | 1,002, 1,001, 1,000 exact |
| Saves not under the latest claim | 0 | 0 | 0 | 0 |
| Supervisor at the end | running, 6 restarts | same | same | same |

Pooled over all four runs: restart p50 6 ms, p99 8 ms (24 samples); back
up p50 13 ms, p99 20 ms (24); DOWN read p50 4 ms, p99 6 ms (19). Each run
took about 28 s. The tree came up in 1.34 to 1.35 s.

## The laws

| Machine | Laws | States walked | Planted mistakes caught |
|---|---|---|---|
| The ledger (`packages/tea-host/src/laws.ts`), new 21 to 24 | 21 to 24 plus 98's | on the Durable Object, node:sqlite, memory | 21 of 21 (10 new) |
| Host machine | 18 (9 new) | 2,876 (depth 9) | 19 of 19 (10 new) |
| Supervisor | 11 | 12,324 (depth 5) | 11 of 11 |
| Monitor module | 9 | 30,371 (depth 8) | 9 of 9 |
| Call module (98's) | 7 | 7,786 (depth 7) | 7 of 7 |

- Ledger laws:
  - 21: DOWN once per monitor, on an exit only; a takeover is no DOWN.
  - 22: linked names exit together; `trap_exit` turns it into an EXIT.
  - 23: only the parent restarts a child, once per incarnation.
  - 24: three crashes in a row on one message set it aside; anything
    between resets.
- Some planted mistakes they catch: an exit under any fence, a lease
  running out told as DOWN, a normal exit that kills its links, a down name
  that can be claimed, anyone restarting a child, a poison message never
  set aside, or set aside at its first crash, anyone writing a DOWN.
- Supervisor plants: no brake, a count that never forgets old restarts,
  a temporary child restarted, a transient child restarted after a clean
  exit, starts after giving up, a stale EXIT restarting a child, and more.
- Monitor plants: OTP's monitor alone (no gap: deaths between a DOWN and
  the next monitor go unseen), a death reported twice, a report past what
  its message proves, a noproc counted as a death, and more.
- **Make the mistake impossible:** the ledger refuses an `append` that
  writes its words (`exited`, `restarted`, `DOWN`, `EXIT`, `dead_letter`,
  and the rest), so no program can fake a death. The spec refusals above
  do the same for the supervisor.

## The naming clash

fabrika's direction (`helpers-and-the-supervisor.md`) has a "supervisor"
that starts every machine and agent run, picks the harness and model,
holds the budget and the record, and can say no.

- **It is not OTP's supervisor.** OTP's restarts what crashed, by a fixed
  spec. It never picks, budgets or refuses.
- **Closest in OTP:** `DynamicSupervisor.start_child`, which starts things
  on request. But it does not choose or refuse either.
- **Closest in the industry:** a scheduler with admission control, as in
  Kubernetes: an admission controller says yes or no, a `ResourceQuota`
  holds the budget, the scheduler picks where it runs.
- **They fit together:** fabrika's "supervisor" admits a run, then asks an
  OTP supervisor (a `DynamicSupervisor`) to start it; the OTP one restarts
  it if it crashes.
- Lean: two names for two jobs. Confidence 70% that "scheduler" (with
  admission) is the right industry name; 90% that it is not OTP's
  supervisor. Not renamed here: `docs/direction` is not edited.

## What went wrong, and surprises

- **The monitor gap** above. Found by the escalate run, not by design:
  c:3@3 and c:3@4 were seen only as `noproc`, or not at all.
- **The first gap fix had a hole.** Two monitors on one run (a lost
  answer, then its retry) give two DOWNs. The second one was dropped as a
  repeat, and it took the watch with it: no new monitor. Found by reading
  the code, before a run. The law "after a death it monitors again" now
  covers it.
- **A false alarm in the harness.** Two runs showed a child "back up"
  2.3 s and 14 s after its restart. The harness read host lines grouped by
  host, not by time, and took a later host's start. The program had
  started in 6 ms. Fixed; the numbers above are from the fixed harness.
- **Noprocs pile up.** In the escalate run, the watcher monitored the down
  names again every 50 ms: 117 DOWN `noproc` in its inbox in 1.5 s. A
  watcher of a name that stays down needs a backoff.
- **The freeze landed between exits.** No DOWN was due while the watcher's
  host was stopped, so DOWN delivery across a freeze is not measured here.
  Takeover of the watcher itself is (it replays and reports nothing twice).
- **The supervisor's give-up reason says "4 restarts".** It counts the
  restart it refused. OTP says only `reached_max_restart_intensity`.

## What is not in yet

- `one_for_all` and `rest_for_one`.
- `terminate_child`, `which_children`, a shutdown timeout. A child taken
  down by its supervisor ends at once.
- `start_child` with a reply. Today it is a cast, and the caller watches
  with a monitor.
- A backoff between restarts, and between monitors of a down name.
- Looking at and sending again a dead letter. They are kept in
  `<name>/dead`; nothing reads them yet.
- Exit reasons inside a gap (they are in the registry stream).
- Who may monitor or link to a name. Like sending, anyone can.

## What this does not show

- One laptop, one clock, one local ledger (the Durable Object in a
  Miniflare child). No partitions, no deployed Durable Object.
- No Docker run. Docker was not used and was left as found.
- Three children, one supervisor, one level. No tree of supervisors.
- Stub programs only. No agent, no model, no key. $0.
