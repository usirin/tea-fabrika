# The cloud is one more host

**Proposed 2026-10-27 by the owner, for the next iteration.** Not built. The
first shared ledger ships as it is today
([the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)); this
note says what replaces its shape after that. The design draft below was
added the same day. The owner walked it on 2026-10-30; the open questions
now carry proposed answers (end of the note). Still proposed.

*Changed 2026-10-30, later: a program is a Durable Object, run by the brain,
with the hands doing its machine work. Open question 1 is answered: the brain
is workerd on the laptop too. See
[the brain and the hands](#decided-2026-10-30-the-brain-and-the-hands).*

```ts
// A sketch. Every place fabrika runs is a host, and every host is the same kind of thing.
type Where = "laptop" | "cloudflare"; // where it runs; nothing else differs
const host = yield* Host.start({where, ledger}); // runs programs and jobs, keeps a ledger
// Two laptops and one Cloudflare host. They meet on the shared ledger the Cloudflare host keeps:
//   laptop A  ->  shared ledger  <-  laptop B
//                      ^
//                Cloudflare host (wakes on its alarm, runs jobs too)
```

- **The leak today.** "The ledger server" (`packages/ledger-server`) is a
  special thing: laptops run hosts, and the cloud runs something else that
  only stores. Two kinds of place, two sets of rules.
- **The change:** there is one abstraction, the host
  ([tea-host](./tea-host.md), OTP's node). A laptop's host keeps a local
  ledger; the Cloudflare host keeps the shared one. The Cloudflare host runs
  programs and jobs in its own environment.
- ~~"like a laptop that never sleeps"~~ **Wrong, marked 2026-10-27.** A
  Durable Object sleeps about 10 s after its last message (experiment 144),
  and experiment 148's host slept whenever it was idle. The Cloudflare host
  is a host that sleeps all the time and wakes on a message or its alarm.
- **What stays:** the shared ledger is still the one meeting point. Hosts do
  not talk to each other directly. The door, the SSH-key login, invites and
  the move of a laptop's tickets carry over as they are.
- **What it reopens:** the host on Cloudflare was parked on 2026-10-25
  ([tea-host](./tea-host.md)). This brings it back, for the shape, not yet for
  running a person's agent there
  ([where a person's login lives](./agents-behind-one-service.md#where-a-persons-login-lives)).
- **Others:** Erlang/OTP nodes are all the same kind of process wherever they
  run; a node's place is configuration, not a different program.

## Where we are today

Hosts are not the same yet. Saying so first, so the draft is read against the
real code.

- **The laptop host is a Node program,** not a Durable Object. It is
  `apps/fabrika/src/host`, with its ledger on node:sqlite in the same thread or
  over HTTP to a server (`apps/fabrika/src/host/run.ts`). Only the ledger was
  run in Miniflare (experiment 93). That already breaks
  [the laptop runs the same setup as Cloudflare](./local-is-the-cloud.md).
- **The Cloudflare side runs only the ledger.** `packages/ledger-server` is a
  config, an Alchemy stack and a Miniflare twin. It runs no programs.
- **A host on Cloudflare was tried once, in experiment 148.** tsh, the
  counter, `jobs`, `tell` and `attach` ran inside one Durable Object, and a
  real Claude Code job ran in a container box. It slept when idle and rebuilt
  its jobs from storage on every wake, in 2 to 11 ms locally and under 300 ms
  more on Cloudflare. It set no alarms.
- **Timers live in memory.** tea's `timer` Sub fires `ms` after it starts and
  dies with the process. The host's renew clock and `poll.ts` both use it.
- **The ledger's Durable Object already shares its one alarm.** Its `jobs`
  table holds `deadline` and `lease_expiry` rows; `alarm()` runs the due rows
  and sets the alarm at the earliest one (`packages/fabrika/src/host/rules.ts`,
  `durable-object.ts`).

## The draft: one host, built for the strictest place

The rule: **every host follows the rules of the strictest place it runs,
which is Cloudflare.** A program that works there works on a laptop, because
the laptop host is the same Durable Object in workerd. OTP does the same: a
node on a laptop and a node in a data center run the same release.

```ts
// A sketch, not built. One Durable Object class, on a laptop (workerd, through
// Alchemy's local stage) and on Cloudflare (the same bundle).
class Host extends DurableObject {
	// wake       a message or the alarm: rebuild every program from storage (148)
	// step       run the program's update; write what it says to the ledger
	// a timer    an absolute `at` in the program's state; the host's one alarm sits at the earliest
	// a machine  a job that needs files or a long process gets a box, one per job (148)
	// idle       nothing due: set the alarm at the earliest timer, or none, and sleep
}
```

### The rules every program lives by

- **A host may sleep whenever it is idle.** Nothing lives only in memory. A
  program's state is rebuilt from storage on each wake. Experiment 148 did
  this already.
- **Time comes from the alarm.** A Durable Object has one alarm, and a new
  `setAlarm` replaces the old one, so the
  [docs](https://developers.cloudflare.com/durable-objects/api/alarms/) say to
  store the events and set the next alarm from `alarm()`. Cloudflare's own
  [Agents SDK](https://developers.cloudflare.com/agents/api-reference/schedule-tasks/)
  works this way: many schedules in a SQLite table, one alarm slot. tea
  already ships the helper: `durableTimer` in `@demlik/tea/do` sets the alarm
  at `nextDeadline(state)` and sets it again after each fire. Its one
  condition is that the deadline is a pure function of saved state, so a timer
  keeps an absolute `at`, never a relative `ms`.
- **Every step is safe to run twice.** An alarm runs "at least once" and is
  retried up to 6 times on a throw (same docs). Writes carry a message id, and
  the ledger answers a second append of the same id without writing it.
- **No files and no long processes in the host.** Work that needs a machine
  runs in a box, one per job, as [programs run in a box](./programs-run-in-a-box.md)
  decided. On Cloudflare the job's object sets its alarm every 5 s while the
  box runs, or Cloudflare cuts the box at about 26 s (experiment 148).
- **Hosts meet only on the ledger.** As today.

### A scheduled job is a program with a timer

Nothing new. In OTP, periodic work is a supervised process that re-arms
`erlang:send_after` after each run, so two runs never overlap
([erlang-questions](https://erlang.org/pipermail/erlang-questions/2017-October/094049.html)).
`poll.ts` is the same loop: it sets the next tick only once a read is over.
The change is where the tick comes from: the host's alarm instead of a
fiber's sleep.

What happens when, for a program whose timer is due:

- **Host awake:** the alarm fires, the host steps the program with its tick,
  the program reads and maybe writes, and the host sets the alarm at the next
  `at`.
- **Host asleep:** the alarm wakes it. It rebuilds the program from storage,
  then the same as above. A wake costs 0.1 to 0.3 s on Cloudflare (experiment
  144).
- **Host died mid-step:** the alarm runs again (Cloudflare retries; the
  ledger's own `alarm()` also sets a 30 s fallback first). The step repeats,
  and the message id keeps its write from landing twice.
- **A laptop is closed:** its host's timers wait until it opens, then fire
  late. A job that must run with every laptop closed lives on the Cloudflare
  host.

### Which programs a host keeps running

OTP's answer is the child spec: a supervisor lists its children, and each is
`permanent` (always restarted), `transient` (restarted only after a crash) or
`temporary` (never restarted). We already built OTP's supervisor on the ledger
(experiment 99).

```ts
// A sketch. The host's top supervisor reads its permanent children from config.
//   fabrika.toml
//   [[host.programs]]
//   name = "pr-watcher"
//   restart = "permanent"     # OTP's word; tsh's `start` stays `temporary`
```

- **tsh starts temporary programs,** as it does today: `pr-watch &` runs until
  it ends or the person stops it.
- **The host's config lists permanent ones,** started on every host start and
  restarted after a crash. This is the "hook" a program needs to run on a
  schedule: be permanent, and keep a timer.
- Lean: the list goes in `fabrika.toml`, since
  [one fabrika.toml per repo](./one-fabrika-toml-per-repo.md) already holds a
  project's knobs. Every host reads that file, so each entry says where it
  runs, or every host would start its own copy:

  ```toml
  [[host.programs]]
  name = "pr-watcher"
  restart = "permanent"
  on = "cloudflare"        # only the Cloudflare host starts it
  ```

- A program for one person only goes in that person's own config, outside
  the repo, as git has `.gitconfig` in a repo and `~/.gitconfig` for one
  person. 80% sure. The doubt: whether "on every laptop" is ever wanted;
  nothing needs it today.

### The first program: the PR watcher

It is the first permanent program, on the Cloudflare host, so a merge marks
its ticket done with every laptop closed.

```ts
// A sketch. poll.ts, with the host's alarm as its clock.
const prWatcher = poll({every: minutes(2), read: openAndMergedPullRequests, by: (pr) => [pr.state, pr.head]});
// a change on a PR that names "ticket N" -> append a `pr` fact on ticket N,
// message id `pr:<url>:<state>:<head>`, as agent:pr-watcher
```

### Order

1. **A `Host` Durable Object with one alarm,** lifted from experiment 148's
   worker, with `durableTimer` behind tea's timer. Its laws run in Miniflare:
   a timer survives the host sleeping, a host killed mid-step does not write
   twice, an idle host sets no alarm.
2. **The PR watcher** on it, with its laws.
3. **The Cloudflare deploy,** after `alchemy plan` and the owner's yes.
4. **The laptop host moves onto workerd.** The biggest step. An experiment
   comes first: the app starts the same `Host` in workerd and uses it for a day.
   Experiment 93 found workerd's memory grows, so it needs a cap and a restart,
   and the app has to reach it with no open port. Its ledger half is being
   probed now (2026-10-30, experiment 171): the app host runs the ledger as
   the local stage of the same Alchemy stack the cloud deploys
   ([local is the cloud](./local-is-the-cloud.md)), not as its own Miniflare.

**Why this order:** steps 1 and 2 build the one host shape on the place that
is strictest anyway, and give a real program running on it every day. Step 4
is where "every host is the same" becomes true, and it is the costly one.

**Cost:** about 2 pull requests for steps 1 and 2, and a Worker secret for the
watcher's GitHub read token. Step 4 is unmeasured.

**How sure: 70%.** The doubts:

- whether the laptop host can be workerd without hurting the app (memory,
  start time, no open port). Step 4's experiment settles it;
- whether the host and the ledger stay two Durable Objects. Experiment 148
  kept them two, so a host can sleep while the ledger serves sockets. Lean:
  two, 70%;
- whether a program on a Cloudflare host needs a lease. A Durable Object id
  already has one instance worldwide, so the id may be the lease, which keeps
  the host free to sleep (148 wrote only to the open inbox for that reason).
  A program that moves between hosts would still need one.

## Notes this draft disagrees with

Each is open until the owner's walk. None is changed yet.

- [Scheduled jobs run on the host's alarms](./scheduled-jobs-on-the-host.md)
  and [tickets start in our tracker](./tickets-start-in-our-tracker.md) say
  each job has its own alarm because the ledger's is for leases. The ledger's
  alarm already serves two kinds of row, and [tea-host](./tea-host.md) sketches
  one alarm at the earliest timer. The draft: one alarm per host.
- The same scheduled-jobs note says jobs that read code cannot run on
  Cloudflare. Experiment 148's box per job did.
- [tea-host](./tea-host.md) parked the Cloudflare host on 2026-10-25, and
  sketches tsh and the app as clients of a separate Node host.

## Proposed answers (2026-10-30 walk)

The seven open questions, each with its lean. Proposed, not decided.

| Question | Lean | How sure |
|---|---|---|
| 1. Laptop host: workerd, or Node for now? | Waits on experiment 171 (its ledger half) and step 4's own experiment | open |
| 2. Host and ledger: two Durable Objects, or one? | Two, as experiment 148 kept them, so the host sleeps while the ledger serves sockets | 70% |
| 3. A timer: an absolute `at` in tea's timer, or a new Sub? | An absolute time kept in the program's state; nothing new in tea | 70% |
| 4. `durableTimer` as it is, or wrapped? | As it is: its one condition, a deadline worked out from saved state, is what 3 gives | 70% |
| 5. Permanent programs: `fabrika.toml`, or a host's own config? | `fabrika.toml`, each entry with `on`; one person's own in their own config | 80% |
| 6. The watcher's GitHub token: whose, and how scoped? | A GitHub App's installation token: short-lived, scoped to the repos it is installed on, the usual way for a bot | 70% |
| 7. Leases on a sleeping host: the object's id, or a ledger lease? | The Durable Object's id, which has one instance worldwide; a program that moves between hosts would still need a ledger lease | 70% |

- **Why 3 and 4 add nothing to tea:** tea stays small, and `durableTimer`
  already sets the one alarm from saved state. The doubt: tea's `timer` Sub
  takes a relative `ms` today, so a program has to keep its own `at`; what
  would settle it is step 1's laws (a timer survives the host sleeping).
- **Why a GitHub App for 6:** its token lasts an hour and names the repos,
  where a personal token is long-lived and as wide as the person. The
  doubt: an App is one more thing to set up for each project; a
  fine-grained token for one repo, read-only, is the fallback.
- **Why the object's id for 7:** Cloudflare runs at most one instance of an
  id, so a second copy of the same program cannot run; a lease would make
  the host wake to renew it, which is what sleeping is meant to avoid.
  The doubt: a rare overlap during Cloudflare's own handover between
  machines, which only a live run would show.

## Decided 2026-10-30: the brain and the hands

```ts
// A sketch, not built. Two parts, on every computer and on Cloudflare.
//   brain   where programs run and keep state: workerd (Miniflare on a laptop,
//           through Alchemy's local stage; Cloudflare when shared)
//   hands   the Node.js part on each computer that does machine Cmds:
//           files, git, Docker, agents, keys, the terminal
//
// One program instance is one Durable Object, its process:
//   wake on a message or its alarm -> rebuild from storage -> update -> save -> sleep
// What the program wants done on a computer is a Cmd, owed until the hands answer:
{kind: "cmd", id: "c-41", for: "build:7", cmd: "git_commit", needs: ["git", "repo:acme/widgets"]}
{kind: "done", id: "c-41", ok: {sha: "1a2b3c4"}}   // the hands' answer, a Msg to the program
```

- **Decided:**
  - **A program instance is a Durable Object.** It is the program's process:
    its own state, its `update`, sleep and wake. Most makers land on the same
    shape, a virtual actor (wake, rebuild, one turn, save, sleep), and tea's
    own `@demlik/tea/do` is built for it.
  - **All machine work is a Cmd the hands do.** Files, git, Docker, agents,
    keys and the terminal live on a computer, so a program never touches one.
    It asks, and the hands answer with a Msg. Every step stays a message, so
    every run can be watched and replayed.
  - **The names are brain and hands.** The brain runs programs and keeps their
    state; the hands act on a computer. "Runner" was dropped, since the hands
    do not run programs. Where this note says "host", read "brain".
  - **The brain is workerd everywhere,** the laptop included. Node runs only
    the hands. This answers open question 1 above.
- **Proposed:**
  - The hands always dial the brain, never the reverse (85%): a Worker cannot
    dial a laptop, and a laptop cannot be dialed from outside anyway.
  - Hands talk to each other only through the brain (80%), as hosts meet only
    on the ledger today.
  - Each set of hands says what it `has`, and a Cmd says what it `needs`, the
    way GitHub's runner labels pick a machine. A Linux VM is one more computer
    with hands: its own files, Docker without a file-sharing layer, the same
    OS as the cloud.
- **Open:** one object per program instance, or one per tree of programs.
  Against one per instance: [experiment 145](../../experiments/145-many-objects.md)
  put one object per lane and broke 11 of 27 ledger laws, and Cloudflare's own
  rule is one object per unit of coordination. An experiment settles it: the
  same small tree both ways, against the laws.
- **What tea already ships** (`@demlik/tea/do`, 0.21.0, unused here so far):
  `stepHost` (the hands pull the next step while the object sleeps),
  `durableTimer`, `doEventSourcedStore`, `acceptDurableCommandSocket`
  (a socket that survives sleep), `sseHub`.
- **What is missing:** a general program host, Subs that turn into the alarm,
  one set of hands serving many objects, links and supervisors across objects,
  and a window that mirrors a model kept in an object.
- **Notes this changes:**
  - [tea-host](./tea-host.md) and [the GUI is an Electron app first](./the-gui-is-electron-first.md):
    a Node host no longer runs programs. Node is the hands.
  - [Programs run in a box](./programs-run-in-a-box.md): the program is in
    workerd now, so the box goes around the hands' work, not around the
    program. Proposed.
- **First experiment:** port the counter and one real program onto
  `@demlik/tea/do`, with its laws, in Miniflare. $0.

## What it cannot tell us

- Nothing in the draft is built or measured. Experiment 148 is the only run of
  a host on Cloudflare, and it set no alarm.
- How noisy a sleeping host's wakes are over a day, and what they cost.
- Whether two hosts' clocks disagree enough to matter for a timer; a busy
  object's `Date.now()` can be about 0.1 s old (experiment 144).
