# 102. Limits a run cannot pass, kept by the ledger

The question: can a tea program run under `limits` its host enforces, the way a
container's `resources.limits` are kept by its cgroup?

- Kinds: dollars and tokens a run reports, wall time, children at once.
- Do they nest, like cgroups?
- Do they hold across crashes, restarts, takeovers and nesting?
- Where should the declaration live?

**Answer: yes.**

- 4 of 4 fault runs passed every gate: 3 small, 1 large, 3 host processes each,
  SIGKILLs and a SIGSTOP freeze mid-spend, a crash loop, children over their cap.
- The limits are declared on the **child spec** (tea-host's supervisor spec), and
  the **ledger** counts and enforces them. tea-program is unchanged.
- With admission (a hold before each turn), spend never passed a cap: 0 of 35
  limits. It stopped 0.1 to 2.4 turns early.
- Without admission, one agent went over by up to 0.7 of a turn, and four agents
  under one limit by up to 2.9 turns.
- The spend was never reset and never counted twice: crash loops of up to 39 runs
  and takeovers kept it.
- Limit exits: 71 in all, none restarted, each with one record in `<name>/dead`.
- Children over the cap: 10 asks at once, 3 started and 7 refused with
  `{error: "max_children"}`, every time.
- Soft limits are not needed yet.

Confidence 85%. No model, no key, $0.

## The set-up

- **Hosts.** Three host processes on one machine. They serve every name:
  supervisors and stub agents. Only tea-host's public exports are used.
- **The ledger.** 98's local Durable Object (workerd), reached over HTTP.
- **Stub agents.** Each turn takes 150 ms and reports a made-up cost: $0.01 to
  $0.05 and 500 to 2500 tokens, from a hash of the name, the turn and the fence.
  The harness logs each turn's bill when it starts, so it can check the ledger's
  count against what was "paid".
- **The tree.** One `top` supervisor. Under it one ticket per case (four in the
  large run). Each ticket is a supervisor over a builder and a scouts supervisor.

```text
top (one_for_one, $1000)
└── t:<case>:<i>   ticket supervisor, limits per case
    ├── ss:<case>:<i>   scouts supervisor, {children: 3}
    │   └── sc:<case>:<i>:<k>   scouts the builder asks for (temporary)
    └── b:<case>:<i>   builder: a stub agent
```

- **The cases.** Dollar limits are tripled in the large run.

| Case | What it tests | Limits |
|---|---|---|
| `own` | a builder's own dollar limit | builder $0.5 |
| `ownn` | the same, no admission | builder $0.5 |
| `tok` | a token limit | builder 20,000 tokens |
| `sum` | builder and 3 scouts together cross the ticket's limit | ticket $1, builder $0.6, scouts $0.4 each |
| `sumn` | the same, no admission | the same |
| `loop` | a builder that crashes every turn | builder $0.4 |
| `kill` | the builder's host is SIGKILLed at turn 5, frozen 2.5 s at turn 12 | builder $0.8 |
| `wall` | wall time on the ticket, and on a builder that crashes once | ticket 4 s, builder 2 s |
| `burst` | 10 scout asks at once, twice | scouts supervisor `{children: 3}`, scouts $0.2 |

- **Faults.** A SIGKILL of the host running `b:kill:*` in its turn 5 (a new host
  is started in its place). A 2.5 s SIGSTOP of the host running it in turn 12. The
  lease is 1 s, renewed every 250 ms.

## The rules, with numbers

- **A dollar or token limit ends the run `limit:usd` or `limit:tokens`.** Every
  case ended by its own limit, in all 4 runs.
- **Limits nest.** A charge counts on the name and every name above it. In `sum`
  the ticket ended `limit:usd` while no child had reached its own limit. Its
  builder and scouts went down with it.
- **The count is the ledger's.** `usage(name)` matched the sum of the charge rows
  for every name in every run: 0 mismatches.
- **Never reset.**
  - `loop` builders ran 11 to 14 times (small) and 34 to 39 times (large). Each one
    ended `limit:usd` at its limit, on the run that crossed it.
  - `kill` builders had 3 leases each (the SIGKILL and the freeze both handed it to
    another host). Each ended `limit:usd` within one turn of its limit.
  - A restart of a `wall` builder did not restart its clock.
- **Never double-counted.** Each charge was sent twice; the second answered `dup`
  every time. A turn charged by a host that had lost its lease replaced its own
  hold and nothing else.
- **Limit exits are never restarted.** 10 limit exits a small run, 41 in the large
  one. 0 started again. 0 without a `limit` record in `<name>/dead`. 0 records
  without an exit.
- **Wall time.** The ledger ended the name 0 to 1 ms after its deadline (lazily, or
  by the deadline job). For the tickets, the host stopped the program 2 to 11 ms
  after the deadline. 0 turns were billed after it.
  - Each `wall` builder crashed once and was restarted. Its clock ran on: it ended
    2,000 ms after its first start, 370 to 505 ms after the restart.
  - The restarted run had not been claimed by a host yet, so there was no program
    to stop.
- **Children over the cap are a refusal.** Each burst: 10 answered, 3 `ok`, 7
  `{error: "max_children"}`. The live count never passed 3. Nothing exited.

| Run | Turns | Billed | Limit exits | Held only | Lost | Ledger peak | Time |
|---|---|---|---|---|---|---|---|
| small 1 | 171 | $5.25 | 10 | 5 (+$0.11) | 1 ($0.035) | 381 MB | 8.6 s |
| small 2 | 170 | $5.10 | 10 | 6 (+$0.10) | 1 ($0.038) | 377 MB | 8.7 s |
| small 3 | 177 | $5.26 | 10 | 2 (+$0.04) | 1 ($0.035) | 377 MB | 8.6 s |
| large | 1909 | $57.45 | 41 | 15 (+$0.31) | 4 ($0.14) | 816 MB | 18.0 s |

- **Held only:** turns a SIGKILL or a freeze cut after the hold. They stay counted
  at the hold ($0.05), not at what they cost.
- **Lost:** turns with no hold, cut by a SIGKILL. Never counted. All of them were
  on a SIGKILLed host (0 elsewhere).

## Where `limits` lives, and why

```ts
{name: "t:sum:1", restart: "permanent", type: "supervisor", limits: {usd: 1}}
{name: "ss:sum:1", restart: "permanent", type: "supervisor", limits: {children: 3}}
```

- On the **child spec**, not the program. Kubernetes puts `resources.limits` on the
  pod spec, not in the image. The same program runs as a $0.5 builder or a $5 one.
- The **parent** decides its children's limits. A child cannot raise its own.
- The **ledger** counts and enforces. A host can die mid-spend, and the Agent SDK's
  own `maxBudgetUsd` starts again on resume. The count has to outlive both.
- A top name gets limits from a desk: `setLimits(name, limits, writer)`. The same
  call raises a limit, which is the only way a name a limit ended starts again.
- **tea-program is unchanged.** A program only reports: `self.hold` and
  `self.charge` on tea-host's `Self`.
- **A decision should change.** `docs/direction/helpers-and-the-supervisor.md`
  says "a program's `limits`, enforced by its host". It should say: a child spec
  declares them, the ledger enforces them, the host only reports.

## How far over a cap a run can go

- **With admission** (`hold` before each turn): never over, as long as a turn costs
  no more than its hold. Over at most `actual − hold` if it does.
  - Measured: 35 of 35 limits ended at or under the cap.
  - The price: it stops up to one hold early per agent under the limit. One agent:
    0.1 to 1.1 turns early. Four agents under one ticket: 1.3 to 2.4 turns.
  - A turn a SIGKILL cuts stays counted at its hold. Over-counted by `hold − cost`
    ($0.31 over 15 turns in the large run). Never under-counted.
- **Without admission**: over by the turns in flight when it is crossed. At most
  one turn per agent under the limit.
  - One agent: 0.3 to 0.7 turns over ($0.013 to $0.037).
  - Four agents: 2.1 to 2.9 turns over ($0.106 to $0.147).
  - A turn a SIGKILL cuts is lost: 1 to 4 turns a run.
- **The host should check before a turn.** Admission costs one ledger write per
  turn, and it is the only mode where the cap is a cap. LiteLLM's `max_budget`
  is checked the same way, at request time.

## Soft limits

- Not needed yet. A soft limit is a warning at a share of the limit (cgroup's
  `memory.high`, a budget alert at 80%).
- `usage(name)` already gives a desk the used and max for every kind. A desk can
  warn from that.
- Cheap later: one more number in `Limits`, and a `warned` record the first time
  a charge passes it. Nothing in this experiment needed one.

## The industry

- **cgroup v2:** `memory.max` (a hard limit), hierarchical counts, `memory.oom.group`
  (the whole group ends), `pids.max` (a fork over it fails; nothing is killed).
- **Kubernetes:** `resources.limits` on the pod spec; `ResourceQuota` refuses at
  admission; `activeDeadlineSeconds` counts from the first start, across restarts;
  a ReplicaSet tries again after `FailedCreate`.
- **OTP:** `max_children` on a DynamicSupervisor; `start_child` answers
  `{error, max_children}`.
- **LiteLLM:** `max_budget` per key, checked before each request.
- **Claude Agent SDK:** `maxBudgetUsd` is per query and starts again on resume.

## Laws and planted mistakes

- **The ledger's rules.** 5 new laws (26 to 30) on all three ledgers: the Durable
  Object, node:sqlite and memory.
  - 26: spend counts up the tree, once per id, and a restart keeps it.
  - 27: a hold over a limit up the tree is refused and ends that run, once, for
    good.
  - 28: a late charge from a lost lease counts, once, and only replaces its own
    hold.
  - 29: children count at every depth; one too many is a refusal, not an exit.
  - 30: wall time runs from registration, across restarts.
  - 10 new planted mistakes (34 in all), each caught.
- **The supervisor machine.** 2 new laws (21 in all), 3 new planted mistakes (25 in
  all), each caught. 60,762 states.
  - A limit exit is never started again and never counts toward intensity.
  - A start a limit refused: a new child is answered and dropped; a known one
    waits for room, or stays stopped.
  - Planted: a limit exit restarted like a crash; a limit exit counted toward
    intensity; a refused restart dropped.
- Host (18 laws, 19 plants), monitor (10, 10) and call (7, 7): all hold, all
  caught.

## What went wrong on the way

- **A charge cut by a stop.** In the first large run, 40 turns with no hold were
  never counted. A host woke from the freeze with its lease gone, and stopped its
  program while the charge for the cut turn was still being sent. `Self.charge`
  is now uninterruptible. After the fix, only turns on a SIGKILLed host are lost.
- **The fault race.** The harness killed or froze the same host twice. It now
  keeps a set of busy hosts.
- **Too many reads at once.** Reading about 200 names' streams together made the
  ledger unreachable, and the run died with the ledger still running. The reads
  are one at a time now, retried while unreachable, and the ledger is closed on
  every exit.
- **The ledger's clock under workerd.** It read 0 to 1 ms late every time. That
  says little: a Worker's clock only moves on I/O. Lateness is also measured from
  the host side: 2 to 11 ms.

## Package size

- tea-host's source, tests left out: 7,196 to 8,608 lines (+1,412, +20%). Most of it
  is the rules in three writings: `rules.ts` (SQL) and `memory.ts`.
- tea-program: unchanged.
- `@demlik/tea`: unchanged.

## Not in yet

- Soft limits.
- A hold that expires. A hold whose host died stays counted at its full amount.
- Memory or CPU limits. The ledger only counts what runs report.
- Real agents. The stubs report a cost; a real agent's cost comes after its turn,
  and a turn can cost more than its hold.
- A deployed Durable Object.

## How to run it

```sh
node experiments/102-limits.ts
# ONLY=plants|machine|runs  RUNS=small,small,small,large  KEEP_LOGS=<dir>
# HOST_DEPTH=8 SUP_DEPTH=6 MON_DEPTH=7 CALL_DEPTH=6
```

About 3 minutes. No Docker, no key, no model. Results:
`experiments/results/102-limits.json`.

## What this cannot tell us

- How a real agent's cost compares with its hold. The stubs never cost more than
  $0.05, so admission never went over.
- How the counts hold on a deployed Durable Object, with real network delays.
- Whether a desk can live without soft limits. No one watched a run here.
- How many writes per turn a real tree can afford. 1,909 turns in 18 s on one
  machine is not a load test.
