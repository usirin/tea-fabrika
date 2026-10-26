# 146. Can Alchemy be the one way fabrika spins up infrastructure?

The question: Alchemy v2 (`alchemy@2.0.0-beta.84`) is infrastructure as code written in
Effect. Could it be the one way fabrika starts anything at all? That means Cloudflare Workers and
Durable Objects, processes on the laptop, Docker containers, and kinds of thing that are our own.
Four small spikes answer it. Each one runs for real and is then destroyed.

**Answer: partly. One Alchemy program can declare all four kinds, and every spike ran: our own
resource, a Docker box, and a Worker in workerd on the laptop, side by side with our resource and
the box. The repo's own typed services and Layers work inside a provider, across two copies of
Effect. But it should not be the one way. Alchemy changes the world when someone runs it, and it
does not watch what it made. A deploy after the host was killed changed nothing. Each step costs
0.3 to 1.7 s of CLI around 3 to 580 ms of real work, and it writes a state row. So: use it for
long-lived things a person deploys (the Cloudflare ledger and its local twin, perhaps a standing
host). Keep per-run things in the host's own code: an agent's box per run, a tsh job, a working
copy. Confidence 75%. The doubt: the cloud side was not run here (experiment 144 does that), and
the beta moves fast. It has had 84 betas in 6.5 months, and the providers moved to new packages
between beta.77 and beta.84.**

```ts
// The whole idea, as spike 3 runs it (146-alchemy-everywhere/local.run.ts): three kinds, one program.
export default Alchemy.Stack(
	"exp146-local",
	{
		providers: Layer.mergeAll(
			Cloudflare.providers(),                              // Workers, DOs, D1 ...
			Docker.providers(),                                  // images, containers, contexts
			HostProvider().pipe(Layer.provide(Processes.node)),  // ours: Fabrika.Host
		),
		state: Alchemy.localState(),                           // .alchemy/state/<stack>/<stage>/
	},
	Effect.gen(function* () {
		const worker = yield* Cloudflare.Worker("hello", {script: "export default {fetch: ...}"});
		const box = yield* Docker.Container("box", {image: "alpine:latest", labels: {exp146: run}});
		const host = yield* Host("laptop", {home, programs: ["counter"], ledger: "memory"});
		return {url: worker.url, box: box.id, pid: host.pid};
	}),
);
// `alchemy dev`:     the Worker runs in workerd here; the box and the host run as they are.
// `alchemy deploy`:  the Worker goes to Cloudflare (not run here); the box and host still run here.
// `alchemy destroy`: all three go, each through its own provider.
```

## Who did what

- **This repo's code:** all of it. The resource `Fabrika.Host`, the stand-in host process, four
  stack files and a tsconfig in `experiments/146-alchemy-everywhere/`, and the driver
  `experiments/146-alchemy-everywhere.ts`. Spike 4 also uses `@kampus/fabrika`'s `Ledger` and
  `layerSqliteSync`, unchanged.
- **Alchemy's code:** its CLI and engine, `@alchemy.run/docker` and `@alchemy.run/cloudflare`,
  all at `2.0.0-beta.84`, pinned exactly in the experiment's own `package.json`. They are kept out
  of every workspace package on purpose.
- **Today's fabrika:** nothing. No agent, no model, no Jev, no key. Nothing was deployed to
  Cloudflare or any cloud. **$0.**

## Setup

- One Apple laptop (arm64), macOS, Node 26.12, Docker Desktop 28. `alpine:latest` was already on
  it, so no build pulled anything.
- The experiment installs on its own: `pnpm install --ignore-workspace` in
  `experiments/146-alchemy-everywhere/`. effect is pinned at 4.0.6, the repo's catalog version.
- Every CLI run goes through `nice -n 15`, because experiment 143 measured typing latency on the
  same laptop at the same time. Containers were small and were stopped as soon as each spike was
  measured.
- Every run gets a fresh temp folder as its working folder. Alchemy keeps its state there
  (`<cwd>/.alchemy/`), and `ALCHEMY_HOME` points its user folder there too. The folder is removed
  at the end, after the state files are copied, paths scrubbed, into
  `results/146-alchemy-everywhere.json`.
- The environment has no `TYPESAFE_API_KEY`, no `CLOUDFLARE_*`, and no `ALCHEMY_*` variable but
  that `ALCHEMY_HOME`. It sets `DO_NOT_TRACK=1`, because Alchemy's telemetry is on by default
  (below), and `CI=1`.
- Times are wall time for the whole CLI run (Node start, module load, plan, apply). In brackets
  is what Alchemy itself reports for the plan and the apply.
- Leftovers were checked by label and pid, never by name alone: `docker ps -a` and
  `docker images` filtered on `label=exp146=<run>`, the pid in the state row, and every process
  below the `alchemy dev` pid. At the end there were 0 containers, 0 images, 0 processes and
  0 temp folders.

## The answer per kind

| Kind | Can Alchemy do it? | Shown by |
|---|---|---|
| Our own resources | Yes. About 107 lines for `Fabrika.Host`, 40 for the ledger name. | Spikes 1 and 4 |
| Docker containers | Yes. Create, replace on a changed input, destroy. All gone by label after. | Spike 2 |
| Cloudflare Workers and DOs | Yes on the laptop, through workerd under `alchemy dev`. The cloud side is experiment 144's. | Spike 3 |
| Processes on the laptop | Partly. Nothing built in keeps a process up after a deploy. Our own resource does, but no one restarts it when it dies. | Spikes 1 and 3 |

## Spike 1: a resource of our own, `Fabrika.Host`

A resource is two parts. Its type gives the props and the attributes. Its provider is a Layer
that says how to reconcile and delete it. Since the beta's single lifecycle, create and update are
one call, `reconcile`; `read` and `diff` are optional
([Resource.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Resource.ts),
[Provider.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Provider.ts)).

The host stands in for fabrika's host in its own process, which does not exist yet: today the host
lives in the app's main process (`apps/fabrika/README.md`). The stand-in
(`host-process.ts`, 53 lines, Node built-ins only) reads its config, writes a pid file, and answers
on a socket. SIGHUP reloads the config and SIGTERM stops it.

```ts
// 146-alchemy-everywhere/host.ts, the part Alchemy sees (comments cut).
export type Host = Resource<"Fabrika.Host", HostProps, HostAttributes>;
export const Host = Resource<Host>("Fabrika.Host");

export const HostProvider = () =>
	Provider.effect(Host, Effect.gen(function* () {
		const processes = yield* Processes;           // our own service; the Layer's type says so
		const fs = yield* FileSystem.FileSystem;
		return Host.Provider.of({
			list: () => Effect.succeed([]),
			read: ({olds, output}) => /* ask the socket: attributes, or undefined when gone */,
			diff: ({news, olds}) =>
				Effect.sync(() =>
					!isResolved(news) ? undefined
					: news.home !== olds.home || news.ledger !== olds.ledger
						? {action: "replace", deleteFirst: true}     // a host opens one ledger for life
					: news.programs.join(",") !== olds.programs.join(",")
						? {action: "update"}                         // SIGHUP, same pid
					: undefined),
			reconcile: ({news, output}) => /* write config; alive ? SIGHUP and wait : start and wait */,
			delete: ({olds, output}) => /* SIGTERM, wait until gone; no output: the pid file says who */,
		});
	}));
```

`Processes` is a `Context.Service` with `start`, `signal`, `alive` and `ask`. `Processes.node` is
the real one. It uses `spawn` with `detached`, because Effect's `ChildProcess` ties the child to a
Scope, and a host must outlive the deploy that started it. The provider's Layer type is
`Layer<Provider<Host>, never, FileSystem | Processes>`. A stack gives `FileSystem` itself, and the
compiler asks the stack for `Processes`. A test can hand it a fake there.

| Step | Plan | Wall [plan, apply] | What happened |
|---|---|---|---|
| create | 1 to create | 568 ms [39, 67] | pid 44424 started, answers on its socket |
| same inputs | no changes | 311 ms [36, 3] | nothing |
| programs changed | 1 to update | 309 ms [38, 8] | same pid, `reloads` 1, new programs |
| ledger changed | 1 to replace | 407 ms [36, 121] | old pid stopped first, new pid 44535 |
| SIGKILL the host, then deploy | no changes | 299 ms [37, 3] | **nothing: the dead host stays dead** |
| `alchemy drift --repair` | 1 to create | 373 ms [33, 85] | `read` found no host, a new pid 44582 |
| destroy | 1 to delete | 323 ms [32, 34] | process gone, socket and pid file gone, state empty |

What Alchemy keeps for it, one file per resource in `.alchemy/state/exp146-host/s146/laptop.json`:

```json
{
	"status": "created", "fqn": "laptop", "logicalId": "laptop",
	"instanceId": "1bb468cf71ba7fc60a76793e29082481", "resourceType": "Fabrika.Host",
	"props": {"home": "<tmp>/host", "programs": ["counter"], "ledger": "memory"},
	"attr": {"pid": 44424, "socket": "<tmp>/host/host.sock", "home": "<tmp>/host",
		"startedAt": 1792959970038, "programs": ["counter"], "reloads": 0},
	"bindings": [], "providerVersion": 0, "downstream": [], "removalPolicy": "destroy"
}
```

Beside it, `__stack_output__.json` holds what the stack returned. `ALCHEMY_HOME` got one log file
per CLI run (7 for 7 steps), and `.alchemy/` got `log/out` and `version-check.json`.

What this shows:

- **The engine is fast and the CLI is not.** The work took 3 to 121 ms. Each run took 300 to
  570 ms, mostly Node start and loading Alchemy.
- **A plain deploy does not look.** The plan calls `read` only when there is no state, or for a
  create that never finished ([Plan.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Plan.ts),
  around line 1391). With a row in state, a dead host is "no changes". Only `alchemy drift`
  calls `read` on every row
  ([drift.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Cli/commands/drift.ts)).
- **Drift left the stack output stale.** After `drift --repair`, the row said pid 44582 and
  `__stack_output__.json` still said 44535. The driver reads the pid from the row.
- **A failed create leaves a row.** In an early run the first create failed halfway, and a later
  replace called `delete` with no output. `delete` now falls back to the pid file. No process was
  left behind.
- **`list` is optional in one place and required in another.** `Provider.effect` fills it in, but
  `Host.Provider.of` types it as required. Alchemy's own `Random` passes it by hand.

## Spike 2: a Docker box through `@alchemy.run/docker`

The smallest stand-in for an agent's box: alpine, a user `agent`, a task in its environment, every
image and container labelled `exp146=<run>`.

```ts
// 146-alchemy-everywhere/box.run.ts
const image = yield* Docker.Image("box-image", {
	name: `exp146-box-${run}`, tag: "v1",
	build: {context: new URL("./box", import.meta.url).pathname, args: {RUN: run}},
});
const key = yield* Config.Redacted("BOX_FAKE_KEY");   // a fake key, made fresh for each run
const box = yield* Docker.Container("box", {
	image, labels: {exp146: run}, environment: {TASK: task, FAKE_KEY: key}, start: true,
});
```

| Step | Plan | Wall [plan, apply] | What happened |
|---|---|---|---|
| create | 2 to create | 1718 ms [87, 580] | image built 377 ms, container 199 ms; `docker exec` saw `triage-1` as user `agent` |
| same inputs | no changes | 539 ms [275, 5] | the plan built the image again to compare |
| new task | 1 to replace | 869 ms [268, 330] | old container removed first, new one has `build-2` |
| destroy | 2 to delete | 452 ms [48, 154] | container 126 ms, image 25 ms; 0 left by label |

An earlier run made the same steps in 1.1 s, 0.5 s, 0.9 s and 0.5 s.

What this shows:

- **A changed input replaces the box.** Any change to the container's create arguments is
  `replace` with `deleteFirst`
  ([Container.ts](https://unpkg.com/@alchemy.run/docker@2.0.0-beta.84/src/Container.ts), around
  line 482). For a box that is right.
- **The plan rebuilds the image every time.** The Image's `diff` builds and inspects it to compare
  ids, so a plan with no change took 275 ms
  ([Image.ts](https://unpkg.com/@alchemy.run/docker@2.0.0-beta.84/src/Image.ts), around line 253).
- **It drives the `docker` CLI.** Every call is a child process of `docker`
  ([Docker.ts](https://unpkg.com/@alchemy.run/docker@2.0.0-beta.84/src/Docker.ts), around line
  528), not the Engine API.
- **A Redacted value is kept in clear.** The fake key was in `box.json` as
  `{"__redacted__": "fake-key-..."}`. Redaction marks the value, and the state file still holds it
  ([StateEncoding.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/State/StateEncoding.ts)). With
  a remote state store, the key goes there too.
- **The first run was wrong about time, and it was our box.** With a bare `sleep 3600` as PID 1,
  SIGTERM did nothing. `docker stop` waited its full 10 s grace: replace took 10.9 s and destroy
  10.5 s. A PID 1 that answers SIGTERM (`trap 'exit 0' TERM`) fixed it. That run is kept under
  `dockerSleepPid1`.

## Spike 3: laptop and cloud from one program

The stack in the opening block, run only under `alchemy dev`, with no Cloudflare account set up.
Local dev then falls back to the account id `00000000000000000000000000000000`
([LocalAccount.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/LocalAccount.ts)),
and it builds the credentials Layer without ever resolving it
([Credentials.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Credentials.ts)).
`alchemy deploy` was never run on this stack.

```text
Plan: 3 to create
[box] create
[hello] create (local)
[laptop] create
[hello] Started in 67ms → http://localhost:1337/
[laptop] created (86ms)
[box] created (195ms)
Done: 3 succeeded (202ms)
```

- **Up in 2.0 s** (2.5 s in the first run): the plan took 1.1 s, most of it importing the stack
  and building its providers, and the apply 202 ms.
- **The Worker answered** `hello from workerd Cloudflare-Workers`, 7 ms for the first GET and 1 ms
  for the second. Its row says `"providerMode": "local"`, the all-zero account, and a `dev:` id.
- **Below the `alchemy dev` pid:** two more Node processes of Alchemy's, one `workerd`, and our
  host.
- **Ctrl-C** (SIGINT to the group) stopped dev in 0.6 s. workerd and the sidecar went with it.
  **The box and the host kept running**, and all three rows stayed in state. A plain
  `alchemy destroy` then took all three down in 1.0 s: `[hello] deleted (local)`, the box, the
  host.

What picks laptop or cloud:

- **The run, not the stage.** A provider with two variants is registered with
  `ProviderLayer.dual`. The run's default mode is `AlchemyContext.dev ? "local" : "live"`
  ([ProviderLayer.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Local/ProviderLayer.ts)). The
  stage name plays no part.
- **One resource can opt out.** `.pipe(Alchemy.remote())` keeps it live even in dev. A mode switch
  is planned as a replacement, deleted by the provider of the mode that made it
  ([ProviderMode.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/ProviderMode.ts)).
  kamp-us/phoenix, the repo today's fabrika runs on, does this for its D1 database (its
  `.decisions/0032-alchemy-beta45-and-dev-model.md`, amendment of 2026-09-10).
- **Only Cloudflare has a local variant here.** Workers, D1, Queues, KV, R2 and a few more do
  ([Local.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Local.ts)). Docker has
  one variant: it is already local. To put a box on another machine, a `Docker.Context` points it
  at another engine, for example over SSH
  ([Context.ts](https://unpkg.com/@alchemy.run/docker@2.0.0-beta.84/src/Context.ts)). Our host has
  one variant, and it runs wherever the CLI runs.
- **For processes, Alchemy has `Build` and `Exec`, which run and end, and `Command.Dev`, which
  runs only under `alchemy dev`, inside its sidecar.** During a deploy `Dev` does nothing
  ([Dev.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Command/Dev.ts)). Nothing built in keeps
  a process up after a deploy. That is the gap `Fabrika.Host` fills.

So a "stage that picks laptop or cloud" is code that reads the stage and branches. A sketch, not
run:

```ts
// Sketch: one program, the stage picks where the box's engine is. The Worker's place is picked by
// the command (dev or deploy), not by this code.
const stage = yield* Alchemy.Stage;
const engine = stage === "laptop" ? undefined : yield* Docker.Context("vps", {docker: "host=ssh://..."});
const box = yield* Docker.Container("box", {image, context: engine});
```

## Spike 4: Effect fit

| | Version | Where `effect` resolves from |
|---|---|---|
| Alchemy beta.84 wants | `effect ^4.0.5` (peer) | |
| The experiment's stack | effect 4.0.6 | `experiments/146-alchemy-everywhere/node_modules/.pnpm/effect@4.0.6` |
| `@kampus/fabrika` | effect 4.0.6 (the catalog) | `node_modules/.pnpm/effect@4.0.6` at the root |

The same version, two copies on disk. The test: a resource whose provider asks for the repo's own
`Ledger` service and gets it from the repo's own `layerSqliteSync`, over a file in the temp folder.

```ts
// 146-alchemy-everywhere/ledger.run.ts (comments cut)
import {Ledger} from "@kampus/fabrika";
import {layerSqliteSync} from "@kampus/fabrika/sqlite";

export const NameProvider = () =>
	Provider.effect(Name, Effect.gen(function* () {
		const ledger = yield* Ledger;                     // the repo's Context.Service
		return Name.Provider.of({
			list: () => Effect.succeed([]),
			read: ({olds}) => /* events in the stream: none means gone */,
			reconcile: ({news}) =>
				Effect.gen(function* () {
					const r = yield* ledger.register(news.stream, news.writer);
					return {stream: news.stream, created: r.created, rev: r.rev, events: /* ... */};
				}).pipe(Effect.catchTag("Denied", (e) => Effect.die(`denied on ${e.stream}`)), Effect.orDie),
			delete: () => Effect.void,                      // a ledger forgets nothing
		});
	}));

// providers: NameProvider().pipe(Layer.provide(layerSqliteSync({path})))  inside Layer.unwrap, then Layer.orDie
```

| Step | Plan | Wall [plan, apply] | What came back |
|---|---|---|---|
| create | 1 to create | 545 ms [122, 7] | `created: true` |
| same inputs | no changes | 368 ms [111, 3] | |
| new writer | 1 to update | 379 ms [113, 6] | `created: false`: registered already |
| destroy | 1 to delete | 363 ms [109, 6] | row gone, ledger file kept |
| create again, same ledger file | **1 to adopted** | 387 ms [116, 5] | `created: false` |
| stream `inbox`, which the ledger refuses | 1 to update | 374 ms [112, 6] | failed: `denied on inbox` |
| destroy again | 1 to delete | 363 ms [114, 5] | |

What this shows:

- **Two copies of Effect 4.0.6 work together.** A service from one copy was found in a context
  built by the other. A Layer with `acquireRelease` (the sqlite connection) from the workspace's
  copy was built and closed by Alchemy's copy. `catchTag("Denied")` on Alchemy's copy caught the
  ledger's error from the workspace's copy. Effect 4 names its type ids with strings
  (`"~effect/Effect"`), so nothing in this run depended on `instanceof` across copies.
- **The types agree too.** `tsc -p experiments/146-alchemy-everywhere` (the repo's tsgo with
  Effect's checks) passes on all six files, this one included.
- **What clashed:** two small things, both in the types. A stack's `providers` may not fail, so a
  Layer that reads `Config` needs `Layer.orDie`. And `.of` wants `list` (spike 1). The versions
  did not clash today. They will the day Alchemy's floor moves past the repo's pin.
- **`read` on no state is adoption.** With no row but a stream already in the file, the plan said
  `adopted` and took it over. That is Alchemy's rule for any provider with `read`. Our resources
  must be honest about what "it exists" means.
- **A failed update leaves the row at `updating`.** The next destroy cleared it.

## What it costs

- **Dependencies.** 68 packages and 353 MB in `node_modules` for `alchemy`, the Docker and the
  Cloudflare providers. The biggest parts: the workerd binary 125 MB, the Cloudflare SDK
  (`@distilled.cloud/cloudflare`) 57 MB, `@alchemy.run/cloudflare` 24 MB, `alchemy` 8.8 MB.
  `alchemy`'s own direct dependencies are 9, rolldown among them. All three name
  `@effect/platform-bun` as an optional peer, and they ran under Node without it.
- **State.** One JSON file per resource plus the stack's output, under
  `<cwd>/.alchemy/state/<stack>/<stage>/`
  ([LocalState.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/State/LocalState.ts)), or a remote
  store (`Cloudflare.state()` keeps it on Cloudflare). Plus a user folder, `~/.alchemy` or
  `ALCHEMY_HOME`, with profiles, credentials and one log file per CLI run
  ([Paths.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Auth/Paths.ts)). Redacted values are in
  the state in clear.
- **Code for a resource of our own.** `Fabrika.Host` is 231 lines in all. About 107 are what
  Alchemy needs: props, attributes, the type, and the provider. The rest is the `Processes` edge,
  which we would write anyway. The ledger name is about 40 lines.
- **Lock-in: medium.** A provider's body is plain Effect over our own services, so it would move.
  The stack files, the state format, the CLI and the state rows are Alchemy's.
- **Churn.** beta.1 came out on 2026-04-13 and beta.84 on 2026-10-24: about three betas a week.
  Between beta.77 and beta.84 the Cloudflare, Docker and AWS providers moved out of `alchemy` into
  `@alchemy.run/*` packages, so imports change. kamp-us/phoenix pins beta.77 and carries a
  305-line local patch for four behaviors (its `pnpm-workspace.yaml` and
  `patches/alchemy@2.0.0-beta.77.patch`).
- **Telemetry and network.** Telemetry is on by default and goes to `otel.alchemy.run`
  ([Telemetry/Layer.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Telemetry/Layer.ts)). Its
  attributes include the git root commit as it is, and hashes of the origin URL and branch
  ([Telemetry/Attributes.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Telemetry/Attributes.ts)).
  `DO_NOT_TRACK`, `NO_TRACK`, `ALCHEMY_TELEMETRY_DISABLED` or the file `~/.alchemy/telemetry-disabled`
  turn it off. The CLI also asks the npm registry for its latest version once a day and caches
  the answer in `.alchemy/version-check.json`
  ([checkVersion.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Cli/checkVersion.ts)).

## Where Alchemy should not be used

The things fabrika starts per run. Each would pay the CLI for every start and stop, write a state
row, and need `drift` to notice a death.

| Spike | Create | Change | Destroy | The real work inside |
|---|---|---|---|---|
| Our host process | 568 ms | 309 ms in place, 407 ms replace | 323 ms | 3 to 121 ms |
| A Docker box | 1.1 to 1.7 s | 0.9 s replace | 0.45 to 0.5 s | box 199 ms create, 126 ms delete |
| Worker + box + host under `alchemy dev` | 2.0 to 2.5 s | (not measured) | 1.0 s | 202 ms |
| A ledger name | 545 ms | 379 ms | 363 ms | 3 to 7 ms |

- **An agent's box per run.** A run's box lives minutes, and there may be many at once. Alchemy
  adds 0.3 to 1 s around a 0.2 s container start, and a state row per box. When the box dies,
  nothing is told. The host's own code, through a typed Docker service, does the same with
  no state of its own, and the ledger already says which run owns which box.
- **A tsh job.** Seconds long, started and watched by the shell. There is nothing to converge.
- **A lane's working copy, a claim, a pull request.** These are the lane's facts in the ledger.
  An Alchemy row for each would be a second copy of the truth that can drift from the first.
- **The host's children.** They need a supervisor that restarts them (experiments 99 and 100).
  Alchemy converges when it is run and then stops looking.

Where it fits: the Cloudflare ledger Worker and its Durable Objects, with `alchemy dev` as their
local twin; a standing host on a machine, if one exists; the box image, built once, not the box.

## Recommendation

Use Alchemy for long-lived infrastructure that a person deploys, and not for anything fabrika
starts per run.

- **Why:** the spikes show it can declare every kind, and its local mode is real (workerd, with
  the same program). They also show its model: converge when run, keep a row, do not watch. That
  fits a ledger in the cloud and fits badly with boxes and jobs that live minutes and must be
  restarted.
- **Cost:** about 350 MB of tooling where Cloudflare is used. State and a user folder to keep out
  of the repo. Telemetry to turn off in every environment. A beta that changes its imports within
  weeks, so pin it exactly and expect to carry patches.
- **How sure:** 75%. The doubt: the deploy side (Cloudflare live, a remote state store) was not
  run here, and a later beta might add watching or a cheaper in-process API. Experiment 144's
  numbers, and one run of `Fabrika.Host` from a programmatic deploy with no CLI, would settle
  most of it.

## Surprises

- A deploy after the host was killed was "no changes". Only `drift` noticed.
- After `drift --repair`, the stack output still named the dead pid.
- A Redacted value sits in the state file in clear.
- Telemetry is on by default and sends the repo's raw root commit.
- `read` on a resource with no row adopts what it finds.
- Ctrl-C on `alchemy dev` stops workerd but leaves the Docker box and our host running.
- The 10 s stops in the first Docker run were our PID 1, not Alchemy.

## Sources

Alchemy at `2.0.0-beta.84`, as published to npm (unpkg serves the package's `src/`):

- [Resource.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Resource.ts),
  [Provider.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Provider.ts),
  [Diff.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Diff.ts),
  [Plan.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Plan.ts),
  [Stack.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Stack.ts),
  [Random.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Random.ts)
- [State/LocalState.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/State/LocalState.ts),
  [State/StateEncoding.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/State/StateEncoding.ts),
  [Auth/Paths.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Auth/Paths.ts)
- [ProviderMode.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/ProviderMode.ts),
  [Local/ProviderLayer.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Local/ProviderLayer.ts),
  [Local/LocalProvider.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Local/LocalProvider.ts),
  [Command/Dev.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Command/Dev.ts),
  [Command/Exec.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Command/Exec.ts)
- [Cli/exec.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Cli/exec.ts) (`ALCHEMY_DEV_ONCE`),
  [Cli/commands/drift.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Cli/commands/drift.ts),
  [Cli/checkVersion.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Cli/checkVersion.ts)
- [Telemetry/Layer.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Telemetry/Layer.ts),
  [Telemetry/Attributes.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Telemetry/Attributes.ts)
- `@alchemy.run/docker`:
  [Container.ts](https://unpkg.com/@alchemy.run/docker@2.0.0-beta.84/src/Container.ts),
  [Image.ts](https://unpkg.com/@alchemy.run/docker@2.0.0-beta.84/src/Image.ts),
  [Docker.ts](https://unpkg.com/@alchemy.run/docker@2.0.0-beta.84/src/Docker.ts),
  [Context.ts](https://unpkg.com/@alchemy.run/docker@2.0.0-beta.84/src/Context.ts)
- `@alchemy.run/cloudflare`:
  [Local.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Local.ts),
  [LocalAccount.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/LocalAccount.ts),
  [Credentials.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Credentials.ts),
  [Providers.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Providers.ts),
  [Workers/Worker.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Workers/Worker.ts)
  (the `script` prop),
  [Workers/WorkerProvider.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Workers/WorkerProvider.ts)
  (`ProviderLayer.dual`)
- Release dates: `npm view alchemy time`.
- kamp-us/phoenix, read only: `.decisions/0026-adopt-alchemy-effect-infra.md`,
  `.decisions/0032-alchemy-beta45-and-dev-model.md`, `pnpm-workspace.yaml`,
  `patches/alchemy@2.0.0-beta.77.patch`.

## What it cannot tell us

- **The cloud side.** Nothing was deployed. How `alchemy deploy` behaves against Cloudflare, with
  a remote state store, and how long it takes, is experiment 144's.
- **Many at once.** Every spike made one to three resources. A stack with fifty boxes, or two CLI
  runs on one stack at once, was not tried.
- **Without the CLI.** Alchemy can be called from code (`deploy` in
  [Deploy.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Deploy.ts)), which would skip
  Node start and the module load. That might turn 300 to 570 ms into tens of ms. Not measured, so
  the "too slow per run" part of the answer leans on the CLI.
- **A real host.** `Fabrika.Host` drives a 53-line stand-in, not fabrika's host, which does not
  yet run in its own process.
- **Effect versions that differ.** Both copies were 4.0.6. Two different versions, the case that
  comes the day Alchemy's floor moves, were not tried.
- **Other platforms.** One Mac, one Docker Desktop. Linux, and Docker without Desktop, were not
  tried.
- **The telemetry payload.** Telemetry was off in every run, so what it sends was read in the
  source, not seen on the wire.
