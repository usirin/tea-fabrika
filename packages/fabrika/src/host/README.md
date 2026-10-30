# host: `@kampus/fabrika`

A part of [`@kampus/fabrika`](../../README.md). It was the package `@tea-fabrika/tea-host` until
experiment 103.

Runs a tea program under a registered name, on one shared ledger. Any number of hosts can serve
the same name. One of them holds its lease and runs it. When that host dies or freezes, another
takes the name over and replays from the ledger. OTP's node, for tea programs.

```ts
import {cast, Ledger, serve, whereis} from "@kampus/fabrika";
import {layerLocal} from "@kampus/fabrika/local";
import {Effect} from "effect";

const main = Effect.gen(function* () {
	const ledger = yield* Ledger;
	// Deny by default: nothing lands under a name until someone registers it.
	yield* ledger.register("counter:1", "setup");
	// Run it here. Start the same thing in two more processes, and they wait as standbys.
	yield* serve({name: "counter:1", holder: `host-a@${Date.now()}`, program: counterProgram});
	// gen_server:cast from anywhere: one message, sent again under the same id until it lands.
	yield* cast("counter:1", "m-1", {id: "m-1"}, "sender-1");
	// Read-only: who holds it, under which fence, until when.
	console.log(yield* whereis("counter:1"));
}).pipe(Effect.scoped);

// A local ledger: the Durable Object in Miniflare, in its own child process.
Effect.runPromise(main.pipe(Effect.provide(layerLocal({persist: ".ledger", ledger: "tea-host"}))));
```

`counterProgram` is a program (`../program`). It asks for `Self` and runs its machine with
`self.run`. The host fills in where the state is saved and where errors go. The program cannot
pass either one: `self.run` types `store` and `onError` as `never`. See
`experiments/98-tea-host-package/counter.ts` for the whole program.

## Where it sits

- Above `program` in `layer-rules.json`. It imports that part, `@demlik/tea` as published,
  `effect`, `@effect/platform-node`, `miniflare` and `esbuild`. Nothing else of this repo.
- tea does not change for it.

## What's in it

The service and the code that runs anywhere are on the top level. Each platform's `Ledger` is a
Layer on its own subpath.

| Import | File | What it gives |
|---|---|---|
| `@kampus/fabrika` | `ledger.ts` | `Ledger` (the service), its tagged errors, `Row`, `Lease`, `streams(name)`, `inboxOf` |
| `@kampus/fabrika` | `writer.ts` | `Writer`: who wrote a row, a user, an agent for a user, or an agent from before the door. `writerOf` reads it from a row's `writer` text (`user:<id>`, `agent:<id> for:<user id>`, old `agent:<id>`); any other text names neither. `writerText` writes that text |
| `@kampus/fabrika`, the names | `door.ts` | The door: the one way into a ledger from the network. It turns a credential into a person, an agent for a person, or a refusal, and stamps that as the writer and in the holder. Members as facts on the ledger (`door/members`), SSH-signed logins checked against the keys `Keys` lists, sessions, and `trustedArgs`: what a request may say. `PERSON_KINDS`: the kinds only a person writes (today `answered`, the owner's answer to an ask, and `duplicate_rated`, a person's accept or dismiss on a duplicate hint), refused from an agent's session; `Writes`: a program's table of who writes each of its facts, held to that list by its type. workerd runs it, bundled into the ledger's Worker. The top level exports the names a host signs and reads (`challengeText`, `grantText`, `holderOf`, `hostOf`, `namesOf`: each member's GitHub login by id, ...) |
| `@kampus/fabrika` | `keys.ts` | `Keys`: the two questions the door asks about a person. `byId`: who has an id now, by what name, and which keys may sign for them, asked at a login about people this ledger already knows. `of`: the same for a name, asked only by a member's invite. The id is what the ledger keeps. `layerNobody`: nobody has any id or name |
| (inside the ledger) | `keys-github.ts` | `layerGitHub`: `Keys` from GitHub. A name is a login, the id is `github:<GitHub's numeric id>`, so a renamed login stays the same person. Answers kept 5 minutes (`KEYS_CACHE_MS`), a failure 30 seconds (`KEYS_FAIL_MS`). When GitHub says its limit is spent, nothing is asked until the reset it names. With a token (`token`, the Worker's `GITHUB_TOKEN` secret) the ledger has its own budget of 5,000 calls an hour; without one it shares 60 an hour with its outgoing address. A token GitHub refuses is dropped for that call, with a warning in the log |
| `@kampus/fabrika` | `sshsig.ts` | SSH signatures as `ssh-keygen -Y sign` makes them (SSHSIG), Ed25519, on WebCrypto. `keyLineOf`, `keyOnly` are exported. `keyFileOf` reads an OpenSSH private key file with no passphrase, `keyFileText` writes one |
| `@kampus/fabrika` | `signer.ts` | `Signer`: what signs a login, an SSH key. `layerSignerKey` over a WebCrypto Ed25519 pair, `layerSignerFile` over a key file on disk; `grant` signs a person's grant to an agent |
| `@kampus/fabrika/local` | `local.ts`, `worker-options.ts` | `layerLocal`: the ledger in a Miniflare child, with a local door whose secret is in the data folder. Own process group, a fixed direct socket, restarted past 500 MB. `LocalLedger` is the handle on the child. `layerAttach`: the same ledger from another process, by its secret. `ledgerOptions`: Miniflare options for the Durable Object and its door, for a caller that runs it itself. `LEDGER_ENTRY` and `ledgerBindings`: the Worker file and its bindings, for a deploy that runs the same Worker on Cloudflare (`packages/ledger-server`). The Worker is bundled by esbuild (an optional peer, beside miniflare), as Cloudflare's own tools bundle one |
| `@kampus/fabrika/local` | `inside.ts` | `layerInside`: a `Ledger` over the Durable Object's binding, past the door, for tests that name their own writers (the laws) |
| `@kampus/fabrika/http` | `http.ts` | `layerHttp`: a `Ledger` over HTTP to any running ledger, with a token and a small pool of connections. It sends no writer. `renewing`: a person's session that logs in again before its end and on a 401, as `layerHttp`'s token. `doorOf`: the door's steps (login, agent login, who, members, invite, remove, agent token). `answers`: does anything answer on a URL |
| `@kampus/fabrika/memory` | `memory.ts` | `layerMemory`: the rules written a second time over Maps, for tests |
| `@kampus/fabrika/sqlite` | `sqlite.ts` | `layerSqlite`: the same SQL as the Durable Object, on a node:sqlite file. `layerSqliteSync`: the same, on one connection in the caller's thread, for a host bundled into one file with no worker beside it (the fabrika app) |
| `@kampus/fabrika` | `rules.ts` | The SQL and its migrations, shared by the Durable Object and node:sqlite |
| `@kampus/fabrika` | `tail.ts` | `tail`: a live read of one stream, in order, once each. `meter` counts what it read |
| `@kampus/fabrika` | `host.ts` | `serve`, `Self`, `cast`, `envelope`, `savedState`, and the host machine with its laws' inputs |
| `@kampus/fabrika`, and `Shell` | `jobs.ts` | The job table: what a job is, its machine, its `next` number, and `traceIdOf`, a job's trace. Moved here from tsh |
| `@kampus/fabrika` | `host-jobs.ts` | Where a host keeps its jobs. `openJobs` and `HostJobs`: the one table a host keeps and every tsh on it shows |
| `@kampus/fabrika` | `leader.ts` | `leaderOf`: the name that leads a name's job on the ledger, up its parents. `serve` starts each program in its leader's trace |
| `@kampus/fabrika`, as `Call` | `call.ts` | gen_server:call as a tea module: send, a reply-to, a deadline, a retry under the same id. `Call.update`, as Elm names a module's update |
| `@kampus/fabrika`, as `Monitor` | `monitor.ts` | Monitors as a tea module: keep watching a name, monitor again after each DOWN, and report every death once (a `down`, or a `gap` of deaths no monitor was on) |
| `@kampus/fabrika` | `supervisor.ts` | OTP's `supervisor` as a tea program: `one_for_one`, `one_for_all`, `rest_for_one`, a supervisor under a supervisor, its calls, `shutdown` per child, opt-in restart backoff. `supervisor(name, spec)` gives the program, or refuses the spec |
| `@kampus/fabrika` | `dead-letters.ts` | `deadLetters(name)` lists what the ledger set aside; `redrive(name, rev, writer)` sends one back once (SQS's redrive to source; behind a door, only a person may); `limitEnds(name)` lists the runs a limit ended |
| `@kampus/fabrika` | `observer.ts` | `whereis` and `getState`: who holds a name, and its last saved state. Writes nothing |
| `@kampus/fabrika/laws` | `laws.ts` | The ledger's law suite, `runLaws`, and `layerPlanted` (the SQL with one mistake) |
| `@kampus/fabrika` | `traces.ts` | A job's record, read: `JobTrace` (job, runs, spans, steps, opened) and its parts as Effect Schemas, the shape the trace tile draws. `Traces`, the service that reads one by trace id, and follows one (`watch`): read again at each beat, polled where the records say nothing of their writes. `jobStorage`: the `Storage` of a job's runs, in its record, with one step per Msg. `jobWrites`: the host's `began` and `ended`, and `opened` and `spanOf`: the span a run's work hangs under, kept as it opens, so a child run started on any host nests under its parent's span before that span ends. `JobCall`: one call as it crosses the door |
| `@kampus/fabrika` | `records.ts` | `Records`: a host's own jobs' records, one per job by its trace id, each write ringing the job's beat. `keepJobs`: the job table, writing each job's start and end. `stepsInto`: the runs' storage, writing each step into its job's record. `layerRecordTraces`: `Traces` over them |
| `@kampus/fabrika/records` | `sqlite-records.ts` | `sqliteRecords`: the laptop's records, one node:sqlite file per job (`<dir>/<trace>.sqlite`), the same SQL as the Durable Object. A record exists once its job began: a write to any other trace is let go, a read of one is empty |
| (inside the ledger) | `job-record.ts` | `JobRecord`: one Durable Object per host job, named `<ledger>/<trace id>`, in the ledger's own Worker and its Miniflare twin (bound as `JOB_RECORD`). SQLite inside, nothing ever deleted. No request reaches it but through the ledger's door |
| (inside the ledger) | `job-rules.ts` | The record's SQL: the `job`, `state`, `steps`, `spans` and `opened` tables, and every call on them in one transaction. A step is kept as a JSON Patch of the one before, or whole once the patches since the last whole state would outweigh it, or after 100 (experiment 166) |
| (inside the ledger) | `otlp.ts` | OTLP over HTTP, JSON, decoded with Effect Schema: each span by its trace id, its service, tags and events, at most 5,000 spans a request and 1 KiB a tag |
| `@kampus/fabrika/http` | `http.ts` | `recordsHttp`: calls to the jobs' records through the door, untraced, so a record's own writes are not spans of its job. `layerTracesHttp`: `Traces` over them |
| `@kampus/fabrika/local` | `inside.ts` | `recordsInside`: the same calls past the door, as a writer the test names. `recordInside`: one record's every row (`dump`) and its steps' bytes (`sizes`), for the laws and experiment 166 |

A job's record has two doors in the ledger's Worker, both behind the ledger's own door, which
stamps who sent each write:

```text
POST /<ledger>/job/<trace>    one JobCall as JSON: the runs' Storage, a step, began, ended, opened, spanOf, read
POST /<ledger>/v1/traces      OTLP/HTTP JSON, as any OpenTelemetry exporter sends it (protobuf: 415)
```

The direction note is `docs/direction/a-job-record-holds-its-trace.md`. Its `beats`, `summary`
and `logs` tables are not built yet: each comes with its writer (the host's heartbeats, the
job's end, a run's output lines), so no table is made before something writes it.

To make the GitHub token: create a fine-grained personal access token with public repositories
(read-only) and no permissions, and set it as the Worker's `GITHUB_TOKEN` secret.

Some names were in two files. On the top level, the ledger's records win: `DeadLetter`, `Stale`,
`Fenced`, `EndReason`, `LimitKind` and `Over` are `ledger.ts`'s. A program's run wins over the
supervisor's record: `Run` and `Ended` are `../program`'s (`../index.ts` says which).

The rules, in short:

- A name is registered before anything is written under it. A write under a name nobody
  registered answers `UnknownName`.
- Only the newest fence of a name writes its streams. Anyone may send to its `<name>/inbox`,
  once per message id.
- A fence is good until someone newer claims, at any time (Kafka's producer epoch, experiment
  151). A claim takes a lease past its end at once, with a bigger fence. A renew by the newest
  fence works past the end too; after the expiry job wrote `lease_expired`, it writes
  `lease_resumed`.
- A host stops its program when the ledger says its lease is lost (a renew answers `lost`, or a
  newer claim shows), or at its lease's end plus the grace (10 minutes) with no word from the
  ledger. While it hears nothing it renews every second.

## Jobs

A job is what one start on a host made: a root run and every run it started, like a Unix process
group. The host keeps them, as WezTerm's mux keeps every pane; a shell only shows them
(`jobs.ts`, `host-jobs.ts`, and
[the decision](../../../../docs/direction/the-host-keeps-terminals-and-jobs.md)).

```ts
const jobs = yield* openJobs(fileStorage(home)); // a host in one process: one table, kept
yield* leaderOf("lane:700:build");                // on the ledger: "lane:700", up the parents
```

- **In one process** (tsh's launcher, the app's host process) the host keeps one job table, one
  tea machine, in the storage it is handed. Every tsh on the host is handed the same table, so
  each tile in the app sees the same `%n`. tsh's `jobs`, `&`, `attach %n` and `fg` are views of
  it and Msgs to it.
- **Numbers count up and are never given twice**, as WezTerm's and tmux's ids: the table keeps
  `next`, and a job that ended does not free its number. A table kept before `next` reads back
  with `next` after every number in it.
- **On the ledger** the registry is the table already. A name with no parent leads a job;
  `startChild` puts the child in its parent's job, as a forked child keeps its parent's process
  group. `leaderOf` reads it, and nothing more is written.
- **One job, one trace.** `serve` starts each program under its leader's trace (`traceOf`), so a
  lane's stages are in the lane's trace on any host, and a name taken over goes on in it. The
  law is `packages/pipeline/src/hosted/lane-trace-id.laws.test.ts`.

## Monitors, links and the supervisor

OTP's names, on a durable ledger. Each call is one ledger transaction, fenced on the caller's own
lease, so it lands once or not at all.

```ts
const self = yield* Self;
self.incarnation                    // the run number: +1 per restart, the same across a takeover
yield* self.monitor("c:1#1", "c:1") // erlang:monitor: one DOWN in my inbox when c:1's run ends
yield* self.link("c:2")             // link/1, both ways: if one crashes, the other ends too,
yield* self.trapExit(true)          //   unless it traps exits: then it gets an EXIT message
yield* self.startChild("c:1", null) // register c:1 under me and link it, or start it again once down
yield* self.exit("normal", "done")  // end my own run on purpose
```

- **Down** means the program's run (its incarnation) ended: `crash` (its update or an Effect
  failed, or it died), `normal` (its main returned) or `shutdown` (it was told to stop, or a link
  took it down).
- **A host dying is not down.** Another host takes the name over and replays: same incarnation, no
  DOWN, no EXIT. A lease that runs out with no host to take over is not down either: restarting
  the program cannot fix a missing host (Orleans' virtual actor: a grain always exists, it is just
  not always active).
- A down name takes no claim until its parent starts it again. Only the parent may.
- **Poison messages.** When the same inbox message is the first unread one in three crashes in a
  row, the ledger sets it aside in `<name>/dead` (`dead_letter`), and hosts skip it. SQS's redrive
  policy and RabbitMQ's delivery limit do the same. `maxDeliveries: null` turns it off.
- **The supervisor** traps exits and starts a crashed child again (`permanent`, `transient`,
  `temporary`), by its strategy. Child order is the spec's order.
  - `one_for_one`: only that child starts again.
  - `one_for_all`: every other child is stopped too, last first, then all start again, in order.
  - `rest_for_one`: the children after it are stopped, last first, then it and they start again.
- **Stopping a child** is OTP's `shutdown` per child. `brutal_kill`: killed at once. A number of
  ms: the child gets a `shutdown` EXIT (if it traps exits) and is killed when the time is up.
  `infinity`: it gets the EXIT and is waited for (the default for a child supervisor). A child
  that does not trap exits ends at once. The ledger writes `killed` or `shutdown`, by the parent.
- **The brake.** More than `intensity` restarts within `periodMs` and it gives up: it stops every
  child, last first, then exits `shutdown`. Its own parent decides next. That is escalation: one
  level per give-up. A top supervisor that gives up takes its whole tree down.
- **Calls**, OTP's supervisor API: `start_child`, `terminate_child`, `restart_child`,
  `delete_child`, `which_children`. A call is an inbox message `{id, replyTo, req}`. The reply
  lands in `replyTo` once the work is done (the child is up, or stopped). The same id sent again
  gets the same answer, and the work is done once.
- **Restart backoff** is off by default, as in OTP. With `backoff: {minMs, maxMs, resetAfterMs}`
  the n-th restart in a row of one child waits `min(maxMs, minMs * 2^(n-1))` (Akka's
  BackoffSupervisor, Kubernetes' CrashLoopBackOff). A run that lived `resetAfterMs` starts the
  count again.
- A start that was in flight when a group restart caught it may land after a sibling it must
  follow. The supervisor counts group restarts per child (a `generation`, as Kafka's consumer
  group generation counts rebalances); a start from an old generation is stopped and started
  again, in order.
- `supervisor(name, spec)` refuses a spec it knows cannot work: an `intensity` below
  `maxDeliveries` (one poison message would take the whole tree down before the ledger sets it
  aside), a backoff that spreads `intensity` restarts past `periodMs` (the brake could never trip,
  so a crash loop would never reach the parent), a `periodMs` of 0 or less, two children with one
  name, a child with the supervisor's own name.
- **Dead letters.** `deadLetters(name)` lists what the ledger set aside, with the message.
  `redrive(name, rev, writer)` sends that message back to the end of the inbox under the id
  `redrive:<rev>`: sent twice, it lands once. A DOWN or an EXIT is never sent back.
- **Monitor re-arm backoff.** The monitor module asks again after a `noproc` (the name is down)
  every `retryMs`, doubling up to `maxRetryMs` (default 1000 ms), and starts over once the name is
  back.
- The ledger refuses an `append` that writes its own words (`exited`, `DOWN`, `EXIT`,
  `dead_letter` and the rest): only the ledger writes those.
- A monitor fires once, so between a DOWN and the next monitor a fast crash loop can end runs no
  monitor sees (OTP has the same hole). The monitor module closes it: incarnations only go up by
  one, so a monitor that lands on run 6 after a DOWN of run 3 proves runs 4 and 5 ended. It
  reports them as one `gap`.

## Limits

A container's `resources.limits`, kept by the ledger the way a cgroup keeps them (experiment 102).
A child spec declares them; the ledger counts and enforces them, because a host can die mid-spend
and the count must not die with it.

```ts
// In a supervisor's spec: the ticket may spend $5 and run 30 minutes; its scouts at most 3 at once.
{name: "ticket:7", restart: "permanent", type: "supervisor", limits: {usd: 5, wallMs: 1_800_000}}
{name: "scouts:7", restart: "permanent", type: "supervisor", limits: {children: 3}}

// In an agent program, around each turn:
const h = yield* self.hold("t3", {usd: 0.05, tokens: 2500}) // admission: the turn's upper bound
if (h.how !== "ok") return yield* Effect.never              // `limit`: the run under `over.at` has ended
// ... the turn ...
yield* self.charge("t3", {usd: 0.031, tokens: 1550})        // what it spent; it replaces the hold
```

- **Kinds.** `usd` and `tokens`: what runs report (`hold` before a turn, `charge` after).
  `wallMs`: from the name's first start, across restarts (Kubernetes' `activeDeadlineSeconds`).
  `children`: names running under it at any depth (`pids.max`; OTP's `max_children`).
- **They nest.** A charge counts on the name and every name above it (cgroup v2's hierarchical
  accounting). A limit anywhere up the chain applies.
- **The count is the ledger's.** A restart and a takeover keep it. One hold and one charge per
  `(fence, turn)`; a resend answers `dup`. A charge from a host that lost its lease still counts
  (the money is spent), and only replaces its own hold.
- **Over a limit**, the outermost name at or under that limit ends `limit:usd`, `limit:tokens` or
  `limit:wall` (cgroup's `memory.oom.group`: the whole group). Its links that do not trap exits are
  `killed`; a trapping parent gets an EXIT with the limit reason. One `limit` record goes to
  `<name>/dead`. A supervisor does not restart a limit exit and does not count it toward intensity.
  The ledger refuses that name's restart until `setLimits` raises it (a desk's call; also how a
  top name gets limits).
- **Children over the cap** is a refusal, not an exit: the start answers `limit` with
  `over.kind: "children"`, and the supervisor answers the caller `{error: "max_children"}`. A
  child from the spec, or a restart, waits `LIMIT_RETRY_MS` and tries again (a ReplicaSet's retry
  after `FailedCreate`).
- **Admission.** With a hold before every turn, spend never passes the cap: a turn that does not
  fit is refused before it starts. Without one, the overshoot is the turns in flight when it is
  crossed. A turn a SIGKILL cuts is counted at its hold; with no hold, it is lost.
- `charge` is sent until the ledger answers, and a stop does not cut it.

## Tests

`pnpm test` runs the law suite on the Durable Object, node:sqlite and memory, every planted
mistake, a counter handed from one host to another, a supervisor restarting a child, each
strategy's stops and starts in order (`supervisor-tree.test.ts`), setting a
poison message aside and giving up, a watcher seeing one DOWN per death and none for a
takeover, and a local ledger on a taken port failing as soon as its child ends (`local.test.ts`).
The machine laws for the host, the supervisor and the monitor module are in
`packages/pipeline/src/laws/tea-host.ts`, beside the law checker, which is the pipeline's (it
walks fabrika's machines through its public names). The long fault runs are in `experiments/98-tea-host-package.ts`
(killed hosts, a frozen host, a host in a Docker container) and
`experiments/99-monitors-supervisor.ts` (a supervisor, its children and a watcher on three hosts,
with kills, a freeze, crashes and a poison message) and `experiments/100-supervision-tree.ts` (a
two-level tree on three hosts, with calls, kills, freezes, a crash loop that backs off and
escalates, and a dead letter sent back) and `experiments/101-real-agents-faults.ts` (real Claude
Code agents in containers, their hosts killed mid-question) and `experiments/102-limits.ts` (dollar,
token, wall and children limits on a tree of tickets on three hosts, with a crash loop, a SIGKILL
and a freeze mid-spend).

A job's record is tested from `../shell`, since its tests run tsh's programs and its tracer, and
the shell sits above the host. `../shell/job-record.test.ts` runs `seq --to 3 | tally` against the
Miniflare twin, through the door, and reads back one record with both runs, every span and
tally's three `add` steps. `../shell/job-record.laws.test.ts` is the secret law: a state that holds a `Redacted`, under each of Effect
Schema's ways to write one, leaves no secret text in any row of any table, over HTTP and past the
door. With the refusal planted out, 9 of its 11 cases fail.

## Not in it yet

- OTP's `simple_one_for_one` / `DynamicSupervisor` (many children of one spec). `start_child` adds
  one named child at a time.
- `significant` children and `auto_shutdown` (OTP 24+).
- `count_children`, `get_childspec`, and changing a running supervisor's spec.
- Backoff with jitter. The wait is exact, so children in one crash loop restart in step.
- A deployed Durable Object. Only the local one has been run.
- A real agent in the package's own tests. They use a stub. Experiment 101 runs Claude Code
  behind the package, with hosts killed mid-question, and resumes a dead host's session from a
  transcript kept in the ledger. That code lives in the experiment, not here.
- Laws for a parent machine that keeps a window of calls open. The call module has laws; the
  window around it in experiment 98 does not.
- An unregister, and a name's metadata (who may send to it).
- Soft limits (a warning at a share of a limit). `usage(name)` gives what a desk needs to watch.
- A hold that expires. A hold whose host died stays counted at its full amount.
- Limits on memory or CPU: the ledger only counts what runs report.
