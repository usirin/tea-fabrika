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

*Changed 2026-10-31: the app layer (A1 to A5) is decided and written below, in
[the app layer](#decided-2026-10-31-the-app-layer). It is layer 4 of
[the five layers](./a-local-first-sync-engine.md#decided-2026-10-30-and-2026-10-31-five-layers-central-first).*

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
// Changed 2026-10-31: the class stays thin, and these jobs live in plain code behind it
// (object-classes-stay-thin.md).
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
- **Decided since (2026-10-30 and 2026-10-31, in the transport walk):**
  - The hands always dial the brain, never the reverse: a Worker cannot dial
    a laptop (T1 in [the five layers](./a-local-first-sync-engine.md#layer-1-transport-decided-2026-10-30-t3-changed-2026-10-31)).
  - Hands talk to each other only through the brain, gateway to gateway (T2).
  - Each set of hands says what it `has`, and a Cmd says what it `needs`, the
    way GitHub's runner labels pick a machine (A1 below). A Linux VM is one
    more computer with hands: its own files, Docker without a file-sharing
    layer, the same OS as the cloud.
- **Decided: single-purpose objects, plus one project object.** This answers
  "one object per program instance, or one per tree". *Changed 2026-10-31:
  no terminal objects and no presence object. A shell's bytes are never saved,
  and who is online is read from the gateways' last ping. A gateway per peer
  takes their place.*

  ```ts
  // A sketch. One Durable Object per name.
  //   program:build:7   one program instance: its state, update, sleep and wake
  //   job:7             one job's record
  //   desk:<person>     one person's desk: its workspaces, settings, tsh history
  //   gateway:<peer>    one peer's WebSocket: a computer's hands, a window, a browser tab
  //   project           the ledger, slimmed: the log, claims, inboxes, the process tree, limits
  //
  // build:7 crashes. One step inside the project object:
  //   claim on #7 released + "exit" letter in the factory's inbox + build:7 off the tree
  ```

  - **Each thing gets its own object,** so no one object carries the whole
    team, and a busy terminal never slows a claim.
  - **Claims, inboxes and the process tree stay together** in the project
    object, because one action often changes all three. When
    [experiment 145](../../experiments/145-many-objects.md) split them, 11 of
    27 ledger laws broke. Cloudflare's own rule is one object per unit of
    coordination, and these three are one unit.
  - **The project object is today's ledger, nearly unchanged.** Its calls
    already cover the log, claims, inboxes, the process tree and the meter.
    The new objects take what lives on one laptop today, so nobody else can
    see it: program state (the Node host's memory), job records
    (`storage/jobs/`) and the desk (`desk.json` and the history file).
  - **Why it is not a bottleneck** (80%): Cloudflare's soft limit is about
    1,000 requests a second per object, a team makes tens, and experiment 93
    soaked at about 100 times a team's load with nothing lost. The doubt is a
    very busy repo with many agents. The way out, if it gets hot, is an
    outbox in each program object (about 900 to 1,300 lines).
  - ~~**Open:** whether the spend meter (`hold`, `charge`) stays in the
    project object~~ **Answered 2026-10-31:** it stays, as `LimitManager`
    (A2 below), so a hold checks every parent in one step.
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

## Decided 2026-10-31: the app layer

The app is layer 4 of [the five layers](./a-local-first-sync-engine.md#decided-2026-10-30-and-2026-10-31-five-layers-central-first):
tea programs, each in its own object, asking the hands for machine work
through Cmds. It uses only coordination below it. build:7 never touches git:
it asks for a commit, the Mac's hands do it, and the answer comes back as a
Msg to its `update`. The window only shows build:7's model. Every piece of UI
state lives in a tea machine (`useMachine`), never `useState`
([Elm first](./elm-first.md)).

The owner decided A1 to A5 on 2026-10-31, at 80 to 85% for A1 to A3 (the
decision log's number).

### A1: the hands get their Cmds from a queue

```ts
// A sketch. build:7 writes a Cmd; the project object pokes the hands whose `has` matches.
{kind: "cmd", id: "c-41", for: "build:7", cmd: "git_commit", needs: ["git", "repo:acme/widgets"]}
// one set of hands claims it with a lease (C3), does it, posts the answer
{kind: "done", id: "c-41", ok: {sha: "1a2b3c4"}}
// the Mac's hands crash mid-commit: the lease runs out, the VM's hands take c-41
```

- The queue sits on the project object and is our coordination code, the way
  GitHub runner labels pick a machine and Temporal's workers pull a task
  queue.
- tea's pieces ride inside it: `durableCommandCarrier` for owed Cmds,
  `idempotentEffect` keys so a Cmd runs once, and `stepHost`'s `callId` so a
  resent answer counts once.
- The gap: tea's hands loop keeps its "already ran" list in memory only. Filed
  as [kamp-us/demlik#762](https://github.com/kamp-us/demlik/issues/762).

### A2: limits are one primitive up the process tree

```ts
// A sketch. Like Linux cgroups: money is one meter beside turns, seconds and tokens.
yield* LimitManager.setLimits("build:7", {dollars: {soft: 4, hard: 5}, turns: {hard: 200}});
yield* LimitManager.hold("build:7", {dollars: 0.3}); // checks build:7 and every parent, in one step
yield* LimitManager.charge("build:7", {
	tokens: {in: 41_000, out: 2_100, cached: 30_000}, model: "gpt-sol", dollars: 0.27, estimate: 0.3,
});
// crossing the soft line writes, once:
{kind: "limit.crossed", body: {name: "build:7", meter: "dollars", line: "soft", used: 4.02}}
```

- It lives in the project object, so a hold checks every parent in one step,
  and an over-limit charge and the job's exit land together (C1).
- A hard line refuses the hold. A soft line warns, like cgroups'
  `memory.high`: it writes `limit.crossed` and mails the watchers.
- Each charge records tokens in, out and cached, the model, dollars at that
  day's list price, and the hold's estimate.
- The primitive only counts, refuses and tells. What to do about it lives in
  programs on top, the way systemd-oomd decides on top of the kernel's
  cgroups.
- The service is `LimitManager` (`hold`, `charge`, `setLimits`, `usage`),
  renamed from `Budget`, since it covers more than money.
- **A2b: no separate alerting system.** What reaches a person is one of two
  kinds. Needs an answer: an ask (asked, answered), from
  [one ask and one meter](./one-ask-and-one-meter.md); a soft line's "raise?"
  is one, and `setLimits` is the yes. Just so you know: a mail to the person's
  desk. A line fires once, when it is crossed, never on every charge after.
  The desk records when each mail was seen, so noise can be measured before
  grouping or muting (Alertmanager's job) is built.

### A3: how a window shows a process

```ts
// A sketch. A program declares what its window gets, and how to pick it from the state.
const view = {
	data: Schema.Struct({ticket: Schema.Number, stage: Schema.String, log: Schema.Array(Schema.String)}),
	select: (state: BuildState) => ({ticket: state.ticket, stage: state.stage, log: state.log}),
};
// window <- brain: a whole copy at a revision, then JSON patches; logs as streams
{rev: 40, whole: {ticket: 7, stage: "build", log: []}}
{rev: 41, patch: [{op: "replace", path: "/stage", value: "review"}]}
{rev: 42, lines: ["review: 3 findings"]}
// window -> brain: every Msg says which revision it saw
{type: "retry", saw: 41}
```

- **Words,** from the OS and OTP: a **program** is the code; a **process** is
  one running copy of it, with its own pid; a **job** is what one start made,
  a root process and every process under it.
- The process lives in its own object. The window gets a whole copy at a
  revision, then JSON patches; logs come as streams ("add these lines"), as
  Elixir's LiveView does.
- Every Msg from a window carries `saw: <rev>`, and each program decides what
  a stale Msg means.
- Screen state (scroll, hover, the picked row) lives in the window's own tea
  machine (`useMachine`).
- **Three homes for state (decided 2026-10-31).** Who needs it picks the home.

  ```text
  others need it     the log             tickets, claims
  only this process  object's storage    a filter, a search; survives a crash, gone at exit
  only this window   window's machine    scroll, hover; gone on reload
  ```

  So a process wakes from two places, its inbox and its own storage, and
  replaying the log alone no longer rebuilds a filter. A process that moves to
  another brain leaves its filter behind. How a program says what to keep is
  open. Lean, 70%: `keep: {data, select}`, the same shape as `view`, saved by
  the runtime in the same turn as the step, so a crash leaves no gap. Elm's own
  way is a Cmd plus flags at start. The doubt is whether a real program wants
  more than that; the tracker in `next/` will settle it.
- Not now: Relay. A study found it a second store, with no patches and its own
  schema bridge; Linear's own app uses a sync engine, not GraphQL. A later
  look: fate (react-fate), whose views are fragments without a GraphQL server.
- The desktop layer is built on this window protocol
  ([the desktop layer](./the-desktop-layer.md)).

### A4: packs (part decided 2026-10-31)

```toml
# A sketch. Three places for programs, three spellings. A dot means a path; no dot means a pack.
fabrika/tracker      # built-in, ships with the app
pipeline/build       # from a pack the project lists and locks
./programs/deploy    # this repo's own, a path from its .fabrika folder
```

- **Where packs come from (decided).** Copy Cargo and Go. The project lists
  its packs in `fabrika.toml` and commits `fabrika.lock` beside it, with each
  pack's commit and code hash. `~/.fabrika/packs` is only a shared cache, keyed
  by commit. Personal packs sit in the home config with their own lock, and
  the project's pin wins. Written in full in
  [one fabrika.toml per repo](./one-fabrika-toml-per-repo.md#where-packs-come-from-2026-10-31).
- **No "marketplace" (decided).** Any repo can hold packs under
  `.fabrika/packs/<name>/`. The repo address is the name, as in Go:
  `from = "github:acme/tools"`. If browsing ever needs a word, it is "source",
  as in apt.
- ~~Lean: Claude Code's shape, packs under `~/.fabrika/packs/` with no
  project lock (75%)~~ **Replaced 2026-10-31** by the two bullets above.
- **How the code runs (decided for v1).** A pack is a normal program with
  Effect bundled in. The hands fetch the locked commit, bundle it and send it
  keyed by its hash; the brain loads it with Worker Loader, with no network,
  one sandbox per process (`hash:pid`, about 7 MB). From
  [experiment 173](../../experiments/173-worker-loader.md), parts 1 and 2.
  Later, with nothing thrown away: a pure step with Effect once in the core
  (part 2's B, 70%), Cloudflare's real limits, signed bundles, a CPU limit.
- **A repo's own programs are in this version.** They load only from the
  default branch, need trust on first open, and run in workerd, asking only
  for Cmds.
- **Later: how a pinned pack learns of updates (A4c).** Open.

### A5: the builder's gaps

Five fixes to the builder, from a review of how it fails today.

```ts
// A sketch. The builder's "blocked" answer is a closed list, not free text.
type Blocked =
	| {why: "as_written"; evidence: string; rewrite: string} // the plan is wrong: back to plan
	| {why: "misread"}                                       // the reviewer looks again
	| {why: "other_way"};                                    // one more round; replaces "deviations"
```

- **Blocked list,** as above.
- **One re-ask.** A form that fails its schema is asked for once more, in the
  same session, with the exact error. The parse error is always saved.
- **A looser pipe fit.** An output fits when it has every field the next
  input needs; extra fields are dropped. Branded types (`PrId`, `TicketId`)
  keep fields with the same name apart.
- **Refusals.** Read real transcripts first. A one-word refusal class is built
  only if refusals and retries show up.
- **A scout.** The builder gets an `ask_scout` tool, and the scout's spend
  counts under the builder's limit (A2). Scouts are for reach: other repos, CI
  logs, old runs. Agents that explore, like the triager, keep their read-only
  boxes.

**How sure:** A1 to A3 at 80 to 85%. A4's code path rests on experiment 173,
which leaned 70 to 75%: Miniflare does not enforce a CPU limit, and a
Cloudflare run is still owed. A5 has no number of its own in the walk.

## What it cannot tell us

- Nothing in the draft is built or measured. Experiment 148 is the only run of
  a host on Cloudflare, and it set no alarm.
- How noisy a sleeping host's wakes are over a day, and what they cost.
- Whether two hosts' clocks disagree enough to matter for a timer; a busy
  object's `Date.now()` can be about 0.1 s old (experiment 144).
