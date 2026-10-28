# The services fabrika needs, and CI on our own machines

**Proposed 2026-10-25. Decided the same day: every edge is a service now,
even one with a single Layer, and `Ci` leaves `CodeHost`** (the next section
after the sketch). Our own machines as CI hosts are still proposed. Nothing
here is built.

```ts
// A sketch. Every edge fabrika crosses, as one Effect service. A repo picks a Layer for each.
Ledger          // the record: facts, leases, inboxes, the tail       built (tea-host)
CodeHost        // pull requests, can it merge, the merge queue       built (GitHub, local git)
CodeHostWrites  // push, open, enqueue, merge                         built (GitHub)
Ci              // run checks at one commit; say how they went        new: the check half of CodeHost
Harness         // run one agent turn                                 built (Claude over ACP, a fake)
Models          // one model call, the key kept outside the box       built for Jev; relay in experiment 137
Sandbox         // the box a program runs in                          sketched (docker, os, none)
Copies          // working copies of a repo                           built (Worktrees)
Blobs           // big bytes kept by their hash: logs, screenshots    new
Clock           // a scheduled job's alarm                            proposed (Durable Object alarms)
Keys            // the app's logins; who signed a fact; who may write logins built; signing new
Traces          // what each run did                                  built (OpenTelemetry)
// Under them all: the network the ledger is reached over. HTTPS to Cloudflare, or WireGuard at home.

// CI on our own machines is one more Layer of Ci. A repo picks; no stage changes.
const onGithub = Ci.githubActions; // the push starts GitHub's runs; we read its check runs
const here = Ci.local;             // today's [[checks.run]], in this process
const hosts = Ci.ownHosts;         // a job is a lease on the ledger; our machines pull it
```

## Decided 2026-10-25: every edge is a service, even with one Layer

```ts
// A sketch. Ci is a service now, with GitHub as its first Layer. A stage asks Ci, never GitHub.
interface Ci {
	readonly results: (at: Commit) => Stream<Result>; // how each check went at one commit
}
const demlik = Layer.mergeAll(Ci.githubActions, CodeHost.github, Ledger.local); // one Layer each, for now
const inTests = Layer.mergeAll(Ci.fake, CodeHost.fake, Ledger.memory);         // the same stages, no network
```

- **Every edge fabrika crosses is a typed service, even where only one Layer
  exists.** That covers all twelve in the table below. A stage talks to the
  service, never to GitHub, a command-line tool or a file.
- **`Ci` comes out of `CodeHost` now.** GitHub Actions and today's
  `[[checks.run]]` are its first Layers. This settles the 70% doubt under
  "How sure".
- **Our own machines as CI hosts wait** until the new lane merges its first
  ticket. Then they are one more `Ci` Layer, and no stage changes.
- **Why:** a second backend then costs one Layer, not a change to every stage
  that called the first. Tests get a fake Layer with no network. The shape
  exists before the second backend does ([backend as a library](./backend-as-a-library.md)).
- **Cost:** a service and a Layer for each edge, even where GitHub is the only
  backend for now.
- **How sure: 85%.** The doubt: a service designed around one backend tends
  to take that backend's shape. The second Layer of each one will show it.

## The answer

- **Twelve services take a ticket to a merged change and run the scheduled
  jobs.** Eight are built or already proposed. Four need new work: `Ci` (split
  out of `CodeHost`), `Blobs`, signing in `Keys`, and the network under the
  ledger, which we pick but do not build.
- **Each sits behind an existing standard where one fits.** git for code,
  ACP and MCP for agents, OCI for Linux boxes, OpenTelemetry for traces, SARIF
  for findings. Two have no standard that fits: the ledger, and pull requests
  with their merge queue. Those keep our own typed contract.
- **CI on our own machines works, and it is mostly parts we already have.**
  - A job is a lease on the ledger: the same lease a lane takes on a ticket.
  - A machine pulls the job, runs it in a fresh box, and writes the result
    as a signed fact. Nothing ever connects into the machine.
  - A Mac mini runs macOS jobs in a throwaway VM. A Linux machine runs Linux
    jobs in a container with a stronger wall.
  - It sits behind the same `Ci` service as GitHub Actions. `fabrika.toml`
    says which a check uses.
- **How sure: 70% on the shape, 50% that it is worth building before the first
  release.** The doubts are under "How sure".

## Which step needs which service

```ts
// One ticket, start to merge, and the scheduled jobs. A sketch.
triage    : Ledger, Harness, Models, Sandbox
plan      : Ledger, Harness, Models, Sandbox, Copies
build     : Ledger, Harness, Models, Sandbox, Copies   (its own checks run inside its box)
review    : Ledger, Harness, Models, Sandbox, Copies, Ci
push + PR : CodeHostWrites, Keys (the app's login, and the leak check that knows it)
CI        : Ci, Blobs (logs), Copies
ship      : CodeHost, CodeHostWrites, Ci, Ledger
scheduled : Clock, Ledger, Ci (a job that reads code runs as a CI job), then what else it reads
every run : Traces, Keys (each fact signed by who wrote it)
```

Not services: the tracker is facts on the `Ledger`
([tickets start in our tracker](./tickets-start-in-our-tracker.md)), and the
desk and every window are views.

## The services

| Service | Today | Standard it should sit behind | Other backends that could plug in |
|---|---|---|---|
| `Ledger` | tea-host's `Ledger`: memory, node:sqlite, a Durable Object in Miniflare or on Cloudflare, over HTTP | None fits whole. Its append with an expected revision and its tail are EventStoreDB's shapes. Our own HTTP contract. | workerd on our own machine, Postgres, LiveStore's sync server (to test, per the sync note) |
| `CodeHost`, `CodeHostWrites` | GitHub through `gh` (`code-host-github*.ts`, `Outside`); a local git copy (`code-host-local.ts`) | git's own protocol for fetch and push. Nothing for pull requests: [ForgeFed](https://forgefed.org/), an ActivityPub extension, is the nearest and early. | GitLab, Forgejo, Gerrit, a bare git repo with fabrika's own ship |
| `Ci` (new) | Inside `CodeHost`: GitHub's check runs. `[[checks.run]]` run here by `local-checks.ts` | Results out: GitHub's [commit status](https://docs.github.com/en/rest/commits/statuses), the de facto one. Findings: SARIF (decided). Events: [CDEvents](https://cdevents.dev/) if we ever export them. Signed results: [SLSA's build record](https://slsa.dev/spec/v1.0/provenance), an in-toto attestation. | GitHub Actions, our own hosts (below), Buildkite, GitLab CI, Forgejo Actions |
| `Harness` | Claude Code through the Agent SDK; Zed's Claude ACP adapter; a fake ACP agent (`agents/acp/harness.ts`) | [ACP](https://agentclientprotocol.com/overview/introduction) for the harness; MCP for tools (decided in the tsh note); [A2A](https://a2a-protocol.org/latest/) for agents outside the system | Codex once it can be contained, Gemini CLI, any ACP agent |
| `Models` | `Jev`, one HTTP call (`services.ts`); the model relay of experiment 137 | Anthropic's Messages API, the de facto shape; OpenAI's as a second | Bedrock, Vertex, an LLM gateway, a local model |
| `Sandbox` | Sketched: `docker`, `os` (sandbox-runtime), `none` (experiments 127, 128) | The OCI runtime and image specs for Linux. None for macOS. | gVisor's `runsc`, Firecracker, Tart VMs, Apple's `container`, cloud sandboxes |
| `Copies` | `Worktrees`: git worktrees on this machine | git | a fresh clone, a runner's own clone |
| `Blobs` (new) | None. Check logs are not kept (`local-checks.ts`, `NOT_READ`) | S3's API, or the OCI distribution spec for files in a registry | a folder, R2, MinIO, an OCI registry |
| `Clock` | Proposed: one Durable Object alarm per job ([scheduled jobs](./scheduled-jobs-on-the-host.md)) | cron's syntax for "when" | systemd timers, launchd |
| `Keys` (signing is new) | Logins from the environment and `gh`'s own store, kept outside the box (`hostEnv`); a writer's name on each fact, not signed | Ed25519 signatures, in the SSH signature format git already uses; the OS keychain to hold them | 1Password, Vault, a hardware key |
| Network | One machine; the ledger on `127.0.0.1` | WireGuard, through [Tailscale](https://tailscale.com/kb/1068/tags); plain HTTPS to Cloudflare | [Headscale](https://github.com/juanfont/headscale), NetBird, Cloudflare Tunnel |
| `Traces` | `@kampus/fabrika/otel` | OpenTelemetry (OTLP); its [CI/CD conventions](https://opentelemetry.io/docs/specs/semconv/cicd/) are a release candidate | Jaeger, Grafana Tempo, Honeycomb, a file |

- **`Ci` comes out of `CodeHost`.** Today a check is read through the code
  host (`prFacts.checks`, `change.checks`, `checksSettled`) and run again
  through its writes (`rerunChecks`). `local-checks.ts` already wraps a
  `CodeHost` to add checks that fabrika runs itself. With our own CI, the place
  that ran a check is not the code host, so the check gets its own service.

  ```ts
  // A sketch, not built. The check half of today's CodeHost, keyed by commit, not by pull request.
  class Ci extends Context.Service<
  	Ci,
  	{
  		/** Ask for the repo's checks at this commit. Safe to repeat: the same commit and recipe are the same jobs. */
  		readonly start: (at: {readonly repo: Repo; readonly commit: string}) => Effect.Effect<void, Unknown>;
  		/** How each named check went at this exact commit. None yet: pending. */
  		readonly at: (commit: string, names: readonly string[]) => Effect.Effect<Checks, Unknown>;
  		/** Says once, when no check of this commit is still running: today's checksSettled. */
  		readonly settled: (commit: string, after: readonly Rerun[]) => Stream.Stream<void>;
  		/** Start the red ones again, once: today's rerunChecks. */
  		readonly rerun: (commit: string) => Effect.Effect<readonly Rerun[], Unknown>;
  	}
  >()("Ci") {}
  ```

  - Keyed by commit: a task of a plan has no pull request, and CI does not
    need one.
  - `Ci.githubActions`: `start` does nothing, since the push starts the runs;
    `at` reads GitHub's check runs for the commit.
  - `Ci.ownHosts`: `start` files one job per check; `at` folds the results
    with `check-runs.ts`'s `checksAt`, as the local checks already do.
  - Two at once: the union, red if either is red, as `local-checks.ts` merges
    GitHub's and its own today.
- **`Blobs` exists because the ledger holds no big bytes.** A log, a
  screenshot or a patch goes in by its hash; the ledger keeps the hash. That is
  the claim-check pattern [push after review](./push-after-review.md) already
  uses for commits.
- **`Keys` grows because a fact that crosses machines must say who wrote it,
  and prove it.** The [sync engine note](./a-local-first-sync-engine.md) names
  signed lines as the step after "every fact says who wrote it". Own CI is the
  first place that needs it. The app's logins already stay outside every box
  ([programs run in a box](./programs-run-in-a-box.md)); they move behind the
  same service.
- **The network is picked, not built.** With the ledger on Cloudflare, a
  machine needs only HTTPS out. With the ledger on one of our own machines,
  the others reach it over a private WireGuard network.

## CI on our own machines

The Elm answer first. The pipeline's machines already Listen for "a CI result"
(`primitives.ts` names it). Nothing in them changes. The runner is a program:
its Subs are the ledger's tail and the clock, and it answers with Cmds: claim
a job, run it in a box, write the result. In OTP terms a runner is a node, and
the job queue is Elixir's [Oban](https://oban.hexdocs.pm/Oban.html) shape: jobs
in the database, workers that fetch them, and a rescue for jobs orphaned when
a node shuts down. Our lease running out is that rescue.

### A machine joins

```ts
// A sketch. Each machine has a name on the ledger, hosts/<name>, with a ticket's two streams.

// On the new machine, `fabrika runner join <code>` makes a key pair. The private half never leaves.
// The one-time code lets this one unknown key send this one fact, and nothing else.
{type: "asked", host: "linux-1", key: "ed25519:9f3c1a7b…", can: "ci",
 has: {os: "linux", arch: "arm64", boxes: ["docker", "gvisor"], slots: 4}}

// The owner's approval, in a box on the desk that shows the key's short print. Signed by the owner.
{type: "joined", host: "linux-1", key: "ed25519:9f3c1a7b…", can: "ci", by: "owner", sig: "…"}

// One fact takes it back. The ledger refuses that key's writes from then on.
{type: "left", host: "linux-1", by: "owner", why: "replaced"}
```

- **A machine joins only with the owner's approval, and the approval names its key.**
  - The code is good for one use and a few minutes, like Tailscale's
    one-off [auth keys](https://tailscale.com/kb/1085/auth-keys).
  - The approval is a separate step on purpose, like Tailscale's device approval.
    [Tailnet Lock](https://tailscale.com/kb/1226/tailnet-lock) goes one step
    further: a new node key must be signed by a key already trusted. Here the
    owner's signed `joined` fact is that signature.
- **`can` says what the machine may do.** A CI runner may write only to the
  jobs it holds and to its own name. It never files a job, and never writes a
  ticket fact.
- **`has` routes jobs**, the way Forgejo's runner labels, Nix's system and
  features, and the Remote Execution API's platform properties do. The runner
  finds it; the owner sees it in the box.
- **This answers part of an open question of the sync note**, "how keys are
  given out and taken back", for machines only. People's and agents' keys stay
  open.

### A job is a lease on the ledger

```ts
// A sketch. A job is a name on the ledger, ci/<repo>/job/<n>, with the two streams a ticket has.

// The app files it, outside any box, after the push. It signs it. The recipe is read from the
// default branch's fabrika.toml, never from the commit under test.
ledger.register("ci/acme/app/job/j-41", "app");
{type: "queued", job: "j-41", repo: "acme/app", asked: "a1b2c3", check: "test",
 install: ["pnpm", "install", "--frozen-lockfile"], run: ["pnpm", "test"],
 needs: {os: "linux"}, recipe: "acme/app@main (9f8e7d)", by: "app", sig: "…"}

// A runner that has what it needs takes the lease, as a lane takes a ticket.
ledger.claim("ci/acme/app/job/j-41", "linux-1", rev, 60_000); // a fence, or Held {holder}
ledger.renew(name, fence, 60_000);                             // every 20 s while the box runs
// The app can stop it: ledger.cancel(name, "app"). The runner's next renew is Cancelled,
// and it ends the box.
// A runner that dies stops renewing. The lease runs out, another runner claims, and every
// write under the old fence is refused.
```

- **Yes, a job is a lease on a stream.** It is the claim the ledger already
  has (`ledger.claim`, `renew`, `cancel`, fences), on a name of its own.
  - Google's Remote Workers API, which sits beside Bazel's remote execution
    API, has the same shape: a bot holds leases that are pending, active,
    completed or cancelled, and must keep calling the server to keep them
    ([bots.proto](https://raw.githubusercontent.com/googleapis/googleapis/master/google/devtools/remoteworkers/v1test2/bots.proto)).
    Its own repo calls it "too heavyweight for most use-cases"
    ([remote-apis](https://github.com/bazelbuild/remote-apis)), so we take
    the lease, not the protocol.
- **The runner pulls.** It follows the ledger's tail over one outgoing
  WebSocket and claims what it can run. A Durable Object keeps such sockets
  open while it sleeps
  ([Cloudflare](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
  - Many runners can race for one job. The claim's compare-and-set lets one
    win; the rest hear `Held` and move on.
- **The runner checks the job's signature before it runs anything.** That is
  Buildkite's rule: "Agents then verify the signature before running the job"
  ([Buildkite](https://buildkite.com/docs/agent/v3/signed-pipelines)).
- **Cut off from the ledger, a runner starts nothing new.** That is the sync
  note's rule for a split: read and plan, start nothing.

### The result is a fact

```ts
// A sketch. Under its lease, the runner writes, and signs.
{type: "started", job: "j-41", by: "linux-1", box: "docker+gvisor", sig: "…"}
{type: "finished", job: "j-41", for: "sha256:<the queued fact>", asked: "a1b2c3", at: "a1b2c3",
 state: "red", why: "failed", took: 84_000, log: "sha256:5d1e…", by: "linux-1", sig: "…"}

// How the pipeline reads it: the same fold as today's local checks (check-runs.ts).
checksAt(runs, "a1b2c3", ["test"]); // {state: "red", required: [{name: "test", state: "red"}]}
```

- **`for` names the exact job it answers**, by the hash of the `queued` fact.
  A result cannot be moved to another job or another commit.
- **`at` is the commit the box's copy stood at from start to end**, read from
  the copy, as `check-runs.ts` does today. `null` when it moved. Only `at` says
  what the result is about.
- **`state` is green or red; `why` says what kind of red:** `failed` (a
  command did not answer 0), `timed_out`, or `no_box` (the box would not
  start). GitHub's statuses split `failure` from `error` the same way.
- **The log goes to `Blobs` by hash.** The ledger holds the hash and the size.
- **A result only sets a check's state.** It never merges, pushes or files
  anything. Ship reads it like any other check.

### Where a job runs

Every job runs in a fresh box that is thrown away after it. That is the box
note's rule ("code that comes out of a box runs only in a box") and GitHub's
own advice for self-hosted runners: one job per runner, then gone
([GitHub](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)).

| A job that needs | On the Linux machine | On the Mac mini |
|---|---|---|
| Linux | Docker, hardened as in experiment 127, with gVisor's `runsc` as its runtime | Sent to the Linux machine first. Else Apple's `container`, which runs each container as a light VM (macOS 26) |
| macOS | Cannot | A Tart VM, cloned from a base image for the job and deleted after. At most two at once. |

- **Linux: Docker with gVisor.**
  - gVisor is a kernel in user space, written in Go. A job's system calls go
    to it, not to the host's kernel ([gVisor](https://gvisor.dev/docs/)).
  - Its default platform needs no hardware virtualization and works inside a
    VM ([gVisor platforms](https://gvisor.dev/docs/architecture_guide/platforms/)).
  - It is an OCI runtime, so it is one flag on the Docker box we already ran:
    `--runtime=runsc`.
  - Firecracker is the stronger wall: a microVM that boots in under 125 ms,
    under KVM ([Firecracker](https://firecracker-microvm.github.io/)). It needs
    more of our own code (a root file system, a network). Later, if gVisor
    breaks a job.
- **macOS: a Tart VM per job.**
  - Tart runs macOS and Linux VMs on Apple Silicon through Apple's own
    Virtualization framework, and keeps images in OCI registries
    ([Tart](https://tart.run/)).
  - It is Fair Source: free up to 100 CPU cores
    ([Tart licensing](https://tart.run/licensing/)). A Mac mini is far below.
  - Apple's license allows two extra macOS copies on one Mac, and the
    framework refuses a third: "The maximum supported number of active
    virtual machines has been reached"
    ([Eclectic Light](https://eclecticlight.co/2022/08/04/virtualisation-on-apple-silicon-macs-8-how-apple-limits-vms/)).
    So the Mac mini has two macOS slots.
- **The copy goes in from outside.** The runner fetches the commit from the
  code host, outside the box, as `local-checks.ts` does today: a clone, then a
  detached worktree at the commit. The box gets that copy and nothing else.
- **No network in the box by default.** The install step reaches only the
  package registry, through a proxy on the host with an allow list, the way
  sandbox-runtime and experiment 137's relay do. The checks run with none.
- **Caches follow GitHub's rule.** A job reads caches of its own branch and
  the default branch only, and only the default branch's jobs write the
  shared one ([GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)).

### Behind the same `Ci` as GitHub Actions

```toml
# fabrika.toml. A sketch: two new keys on today's [[checks.run]].
[checks]
github = "none"           # today's key: GitHub's checks do not count

[[checks.run]]
name = "test"
run = ["pnpm", "test"]
on = "hosts"              # new: "here" (today's way, and the default) or "hosts"
needs = "linux"           # new: "linux" (the default) or "macos"

[[checks.run]]
name = "safari"
run = ["pnpm", "test:safari"]
on = "hosts"
needs = "macos"
```

- **The repo picks per check.** `github` stays as it is. `on = "hosts"` sends
  a check to our machines. Both together are the union.
- **A pick that cannot run says so at the start.** No joined machine has
  `needs = "macos"`: the start prints it, and says the check will wait, as
  [one fabrika.toml per repo](./one-fabrika-toml-per-repo.md) asks.
- **Results go back to GitHub when GitHub needs them.** A repo whose branch
  rules require checks gets each of our results as a commit status
  (`context: "fabrika/test"`), posted by the app, outside any box, with the
  app's own login. That is how outside CI reports to GitHub; Buildkite does
  it. It is one new write on `CodeHostWrites`. A runner never holds a GitHub
  login.
- **A merge queue needs one more job.** GitHub's queue tests a temporary
  branch, `gh-readonly-queue/<base>/…`, and waits for the required checks there
  ([GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
  The PR watcher would see that branch and file the jobs. Or the repo turns
  its queue off, and ship merges straight in on a proof tested on main
  ([ship stage rules](./ship-stage-rules.md)). Open.
- **The order stays as decided:** push, PR, CI
  ([push after review](./push-after-review.md)). The runner fetches from the
  code host. CI before the push is possible later, since our machines are our
  own; that would change the decided order, so it is not proposed here.

### What the owner does to add a machine

1. Install the runner and its box on the machine: fabrika's package, plus
   Docker and gVisor on the Linux machine, or Tart on the Mac mini.
2. Only if the ledger is not on Cloudflare: put the machine on the private
   network with a one-off, tagged auth key (`tag:fabrika-runner`). The
   network's rules let that tag reach the ledger's port and nothing else.
3. In the app, pick "Add a machine". It shows a one-time code.
4. On the machine, run `fabrika runner join <code>`. It prints what it found:

   ```text
   fabrika runner: key 9f3c 1a7b, linux arm64, boxes docker+gvisor, 4 slots
   fabrika runner: asked to join; waiting for approval in the app
   ```

5. In the app, a box: "A machine asks to run CI jobs: linux arm64,
   docker+gvisor, key 9f3c 1a7b. Yes / No." Check the print matches, say yes.
6. The runner starts at boot (launchd on the Mac, systemd on Linux), as a user
   of its own. From then on it pulls jobs.
7. To take a machine off: "Remove" in the app. One `left` fact.

The runner is a tea-host host with no window, started as a plain process,
not the Electron app. [Electron first](./the-gui-is-electron-first.md) is about
the app people open, so it does not change.

### The rules it keeps

- A runner pulls jobs and opens no port.
- A machine joins only with the owner's approval, which names its key. One fact
  takes it back, and the ledger checks the list of joined keys on every write.
- Only the app files a job, and only for a commit the lane has pushed. A
  runner never files one.
- A job and its result are both signed. A runner checks the job's signature
  before it runs it; the pipeline checks the result's before it folds it.
- The recipe comes from the default branch, never from the commit under test
  ([nobody writes their own exam](./nobody-writes-their-own-exam.md)).
- Every job runs in a fresh box, thrown away after. No key goes in: no
  code-host login, no model login, no signing key.
- No network in the box, but the registry for the install step, through a
  proxy on the host.
- A result sets a check's state and nothing else.
- The runner runs as its own user on the machine, never as the owner.
- Logs leave the machine only as blobs, by hash.

## Why: what others do

| System | How a worker gets work | What we take |
|---|---|---|
| GitHub Actions, self-hosted | An HTTPS long poll of 50 s; "only an outbound connection … is required" ([GitHub](https://docs.github.com/en/enterprise-server@3.13/actions/concepts/runners/communicating-with-self-hosted-runners)) | Pull, and no port. One job per runner, then gone. |
| GitLab Runner | `POST /api/v4/jobs/request` with its runner token ([GitLab](https://docs.gitlab.com/runner/)); executors per box kind, shell and VirtualBox in maintenance mode ([executors](https://docs.gitlab.com/runner/executors/)) | One runner, several kinds of box |
| Forgejo runner | Fetches from the instance; a label picks `docker`, `lxc` or `host`, and `host` has "no isolation at all" ([Forgejo](https://forgejo.org/docs/latest/admin/actions/configuration/)) | Labels to route. Never a `host` box. |
| Buildkite agent | Polls its API; "no need to forward ports" ([Buildkite](https://buildkite.com/docs/agent/v3)); refuses a job whose signature does not match ([signed pipelines](https://buildkite.com/docs/agent/v3/signed-pipelines)) | The job is signed and checked before it runs |
| Bazel remote execution: Buildbarn, BuildGrid, NativeLink | A worker asks the scheduler for work ([Buildbarn](https://github.com/buildbarn/bb-remote-execution)); results kept by the hash of the action ([REAPI](https://github.com/bazelbuild/remote-apis)) | A job is a lease that can be cancelled; a result names what it answers by hash |
| Nix remote builders | The client pushes over SSH; each builder runs `sshd` ([Nix](https://nix.dev/manual/nix/2.28/advanced-topics/distributed-builds)); results are taken only when signed by a trusted key ([nix.conf](https://nix.dev/manual/nix/2.28/command-ref/conf-file.html)) | Signed results; system and features to route. Not the push, which needs an open port. |
| Dagger | Pipelines as functions in containers, "on your machine or on a shared remote engine", "before or after push" ([Dagger](https://docs.dagger.io/)) | A recipe format to try later. It needs a Linux container engine, so not for macOS jobs. |
| Tailscale | WireGuard through NAT, with relays as the last resort ([Tailscale](https://tailscale.com/blog/how-nat-traversal-works)); tags are "essentially service accounts" ([tags](https://tailscale.com/kb/1068/tags)) | How a machine at home reaches a ledger at home; a tag per role |

- **Every system but Nix pulls.** Pull is what lets a machine behind a home
  router work with no open port. Nix pushes, and needs `sshd` on every
  builder.
- **Why not simply GitHub's self-hosted runners on these two machines?** It is
  the least to build. But GitHub says self-hosted runners "should almost never
  be used for public repositories", since anyone who can open a pull request
  can run code on them
  ([GitHub](https://docs.github.com/en/actions/reference/security/secure-use)).
  It also ties CI to GitHub, and safety must not rest on one code host
  ([north star first](./north-star-first-harden-later.md)). It stays a fine
  backend for a private repo that lives on GitHub: it is `Ci.githubActions`
  with a different machine.
- **Why not a Bazel farm?** It runs actions of a build graph. `pnpm test` is
  one big command, not a graph. We take its shapes, not its servers.

## What it costs

- **Code:**
  - the `Ci` split: review and ship read checks from `Ci`, not `CodeHost`;
  - a runner program, its join step, and the desk's box for the approval;
  - signed writes in the ledger, and a check of the joined keys on each write.
    The sync note plans them; nothing has built them;
  - `Blobs`, for logs;
  - one write on `CodeHostWrites` to post a commit status;
  - two more `Sandbox` layers: gVisor and a Tart VM.
- **Running it:** two machines kept on, a macOS base image for Tart (tens of
  GB), and someone to update both.
- **Time per job:** a fresh box per job is slower to start than a warm
  GitHub runner. Not measured for gVisor or Tart.
- **Money saved is small for public repos.** GitHub Actions is free for public
  repositories on its standard runners
  ([GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
  The gain is elsewhere: macOS jobs, a repo with no GitHub, private repos, and
  results on the ticket's timeline.

## How sure

- **85% that a job should be a pulled lease with a signed result, run in a
  fresh box.** Every pulling system above does the first, Buildkite and Nix do
  the second, and the ledger already has leases with fences and cancel.
- **70% on taking `Ci` out of `CodeHost`.** The other way is a third wrapper
  like `local-checks.ts`, which is less code now and leaves `CodeHost` meaning
  "GitHub plus what we added". Building `Ci.ownHosts` both ways for one check
  would settle it. *Decided 2026-10-25: `Ci` comes out now (above).*
- **60% on the boxes.** gVisor's fit with this repo's own `pnpm test`, and
  Tart's time from clone to first output, are not measured.
- **50% that it is worth building before the first release.** For demlik,
  public and on GitHub, GitHub's runners are free and work. The first repo that
  needs macOS jobs, or has no GitHub, settles it.

## Where it disagrees with a decided note

- **[The ledger behind a service](./ledger-behind-a-service.md)** (decided)
  puts checks in `CodeHost`: `CodeHost.checks(pr, head)`, "only the place that
  ran them knows". This note takes checks out into `Ci`. Its own test is the
  reason: with our own runners, the place that ran them is not the code host.
  `CodeHost` keeps pull requests, can-it-merge and the queue.
- **[Programs run in a box](./programs-run-in-a-box.md)** (decided) names three
  boxes. This adds two (gVisor, a Tart VM). It adds and changes nothing there.
- **[Scheduled jobs on the host](./scheduled-jobs-on-the-host.md)** (proposed)
  says a job that reads code runs on a person's own host, only while it is up.
  With runners, a scheduled job that reads code can be filed as a CI job and
  taken by an always-on machine. Its other rules (it reads, judges and files
  a ticket; it never changes code) stay.
- **No contradiction** with [push after review](./push-after-review.md) (the
  order stays), [Electron first](./the-gui-is-electron-first.md) (the runner
  has no window) or the [sync engine](./a-local-first-sync-engine.md) (this
  uses its leases, and its "no new lease during a split").

## The first experiment

**One job, two runners, one lease.** No model call, so $0 in API spend.
About a day of work.

```ts
// A sketch of what it checks.
// 1. The app files 20 jobs for fixtures/format-bytes' tests on a local ledger.
// 2. Two runner programs claim them, each running its job in a hardened Docker box.
// 3. Kill a runner mid-job 5 times.
expect(lostJobs).toBe(0);              // every job ends with one finished fact
expect(doubledResults).toBe(0);        // never two for one job
expect(lateWriteFromDeadRunner).toBe("Fenced");
expect(cancelStopsBoxWithin).toBeLessThan(renewEvery);
expect(resultWithBadSignature).toBe("refused when folded");
// 4. Then on the real machines: time from queued to finished, Docker+gVisor and a Tart VM,
//    for a trivial check and for this repo's pnpm test. Start a third macOS VM: refused.
```

- Signatures with Ed25519 through WebCrypto, which Node has, checked when the
  results are folded.
- Part 1 runs on one machine and could run in CI. Part 2 needs the two
  machines, Docker, gVisor and Tart.

## Open questions

- **Where the ledger lives for one owner with two machines.** On Cloudflare
  (HTTPS only, no private network), or on the always-on Linux machine, which
  the sync note allows ("any always-on peer can be" the referee). A laptop's
  ledger is gone when the laptop sleeps.
- **The merge queue.** Run our checks on GitHub's queue branch, or turn the
  queue off for repos on our own CI.
- **A private repo's read key.** The runner needs one to fetch, outside the
  box. One read-only key per repo, kept on the runner, is the lean.
- **sandbox-runtime for CI.** It is a lighter box than a VM on the Mac. Lean:
  not for CI, since a VM is cheap enough at two slots. Unmeasured.
- **The recipe.** `[[checks.run]]` commands for now. Dagger, or reading GitHub
  workflow files, only if a repo needs more than commands.
- **People's and agents' keys.** This note covers machines only.

## What would change it

- A job that cannot run with only its copy, its recipe and no key in the box.
- Tart or gVisor start times that make a fresh box per job too slow for a
  lane.
- A code host that will not take an outside result for its required checks.

## What it cannot tell us

- Nothing has run. No runner, no job fact, no signed write.
- The research is of documentation, not of running these systems. The two-VM
  limit is from a 2022 reading of Apple's license; the current text was not
  read.
- It cannot say how often a real lane would wait on a busy Mac mini, or how
  much faster or slower our own CI is than GitHub's for demlik.
- It says nothing about Windows.
