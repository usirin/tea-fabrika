# 147. Alchemy from code, not the CLI

The question: experiment 146 timed Alchemy only through its CLI, at 0.3 to 0.6 s a step, and
called it too slow per run. Most of that was Node starting and Alchemy loading. Called as a
library, from an Effect program that is already running, how fast is `deploy`? Does it work with
no CLI step at all: credentials, state, profiles, telemetry, the version check? And two questions
added during the run: can a careless rename of the ledger's Worker lose its data, and can our own
code read the plan and refuse it first?

**Answer: from code, Alchemy is fast and needs no CLI. In a warm process, a deploy with the same
inputs takes 2 to 5 ms for our own resource and 18 to 56 ms for the ledger on Cloudflare. The CLI
took 300 ms and 800 ms for the same two. A real change costs what the work costs: 57 to 88 ms to
start a host, about 2 s to upload the Worker to Cloudflare. Everything the CLI did is a Layer or a
stack option: credentials come in through the stack's `secrets`, state is a Layer, and telemetry
and the version check never load on this path. The ledger server, Worker and Durable Object, ran
in workerd with no Cloudflare credentials at all, and no connection left the laptop.
`RemovalPolicy.retain()` saves the data on a rename: the old Worker kept its row and the new name
started empty. Our code can read the plan before it applies, so a guard refused the rename in
8 to 11 ms. One gap: a rename in workerd plans as an update, not a replace, so the guard has to be
tested against the cloud plan. Confidence 80%.**

```ts
// The whole idea (147-alchemy-from-code/parts.ts, cut down). One running program, no CLI.
import {deploy} from "alchemy/Deploy";
import {evalStack} from "alchemy/Stack";
import * as Plan from "alchemy/Plan";
import * as Apply from "alchemy/Apply";

// What deploy's type asks its caller for. deploy builds the rest itself.
const engine = Layer.mergeAll(
	AlchemyContextLive,                                   // where .alchemy/ is
	Layer.succeed(ArtifactStore, createArtifactStore()),
	Interaction.layerNonInteractive(),                    // a prompt fails, it never waits
	Alchemy.localState(),
).pipe(Layer.provideMerge(NodeServices.layer));

// The one switch: local runs in workerd with no account, cloud deploys to Cloudflare.
const up = (where: "local" | "cloud") =>
	deploy({stack: ledgerStack({name, keyHash, retain: true, secrets}), stage: where, dev: where === "local"});

// The guard: plan, look, then apply. The same three calls deploy is made of.
const guarded = evalStack(stack, (compiled) =>
	Effect.flatMap(Plan.make(compiled), (plan) =>
		Plan.describePlan(plan).resources.some((r) => r.resourceType === "Cloudflare.Worker" && r.action === "replace")
			? Effect.die(new LedgerAtRisk("Ledger: replace"))
			: Apply.apply(plan)),
	{stage: "cloud"});

yield* up("local").pipe(Effect.provide(engine));   // ~16 ms to return, first answer at ~75 ms
yield* up("cloud").pipe(Effect.provide(engine));   // 2 to 3 s the first time, 18 to 56 ms when nothing changed
```

## Who did what

- **This repo's code:** the driver (`run.ts` sets the working folder, then loads `parts.ts`, which
  holds the parts), the ledger stack `ledger.ts`, the host stack
  `host.ts`, a connection watcher `net-watch.ts`, and `cli.run.ts` for the CLI comparison, all in
  `experiments/147-alchemy-from-code/`. The resource `Fabrika.Host` and its stand-in host process
  are experiment 146's, imported from `experiments/146-alchemy-everywhere/` unchanged.
  `worker.ts` is experiment 144's (pull request 99), unchanged but for one new opening paragraph.
  It serves `packages/fabrika`'s real Durable Object as it is.
- **Alchemy's code:** its engine and `@alchemy.run/cloudflare`, both `2.0.0-beta.84`, pinned
  exactly in the experiment's own `package.json`, outside the workspace. The CLI ran only once,
  for the comparison.
- **Cloudflare:** two tiny Workers with one Durable Object each, live for about a minute per run,
  in two runs, then deleted. One more for the CLI comparison.
- **Today's fabrika:** nothing. No agent, no model, no Jev.

## Setup

- One Apple laptop (arm64), macOS, Node 26.12, the same laptop as experiment 146. Every run went
  through `nice -n 15`. No window was opened.
- Each run works in a fresh temp folder. It becomes the working folder before Alchemy loads, because
  Alchemy reads the working folder once, at import (`initialCwd`,
  [Util/Node.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Util/Node.ts)). State goes to
  `<work>/.alchemy/`, and `ALCHEMY_HOME` and `FABRIKA_HOME` point inside it. The folder is deleted
  at the end; Alchemy's state holds the account id and the address in plain text (experiment 144).
- `TYPESAFE_API_KEY` is unset. `DO_NOT_TRACK=1` is set, though nothing on this path loads
  telemetry (below).
- **Cold** means the first call in a new process. It pays the module load once. In the first
  runs, importing Alchemy alone took 186 to 217 ms, plus 118 ms for experiment 146's `host.ts`,
  which brings a second copy of Effect from its own folder. The final runs, the ones the results
  file holds, load Alchemy and `@alchemy.run/cloudflare` together before anything else: 978 to
  1,050 ms, measured while other agents were busy on the same laptop. So count on 0.2 to 1 s,
  paid once per process. **Warm** means a later call in the same process.
- Every part ran twice: once before a tidy-up of the driver, once after. The table gives the range
  over both.
- Times are wall time around one `Effect.runPromise`, from the driver.
- Leftovers on Cloudflare were found by listing the account's Workers and Durable Object
  namespaces through the API and keeping only names that start with `tf-exp-147-`.

## Timings: the CLI against code

| Step | CLI (exp 146, our host) | Code, cold | Code, warm | CLI, the ledger on Cloudflare | Code, the ledger on Cloudflare |
|---|---|---|---|---|---|
| create | 568 ms | 86 to 94 ms (+ the import) | 57 to 88 ms | 3,416 to 3,626 ms | 1,998 to 2,886 ms |
| same inputs | 311 ms | | 2 to 5 ms | 797 to 855 ms | 18 to 56 ms |
| update in place | 309 ms | | 3 to 6 ms | | 1,629 to 1,845 ms (a new binding) |
| replace | 407 ms | | 87 to 115 ms | | 1,713 to 2,176 ms (a rename) |
| destroy | 323 ms | | 29 to 34 ms | 1,238 to 1,399 ms | 427 to 453 ms |
| drift repair | 373 ms | | 86 to 88 ms | | |

The ledger in workerd, from code, no account: the first deploy 117 to 156 ms cold; warm, deploy
returns in 14 to 17 ms and the first answer comes at 72 to 79 ms; same inputs 16 to 21 ms; destroy
28 to 35 ms. Experiment 146's `alchemy dev` took 2.0 s for a Worker, a box and a host together.

What this shows:

- **The CLI's cost was the CLI.** With the same inputs, the engine needs 2 to 5 ms for our host and
  16 to 56 ms for a Worker, local or live. The rest of experiment 146's 300 ms was Node and the
  module load, paid once here.
- **On Cloudflare, the upload is the cost.** About 1.6 to 2.9 s for any change to the Worker, from
  code or not. The CLI adds about 0.8 s to every run, even one with nothing to do.
- **The first create on Cloudflare reads before it writes.** With no state row, the plan asks
  Cloudflare whether the Worker exists (the CLI printed `Plan ready (2.0s)`; the read was 1.4 s of
  it). That is the adoption check of experiment 146.

## The ledger server with no Cloudflare credentials (3b)

The question was whether local dev deploys anything to Cloudflare. It does not, and it runs. The
real ledger server, Worker and Durable Object, in workerd, from code, with every `CLOUDFLARE_*`
variable removed from the process before Alchemy loaded.

| Check | What came back |
|---|---|
| `CLOUDFLARE_*` in the process | none |
| `register("triage")`, then again | `created: true`, then `created: false`: the object kept the row |
| Same after a redeploy with the same inputs | `created: false` |
| Every host this process connected to (Node's `net`, `undici` and `http` channels) | `localhost` only (`127.0.0.1`, `::1`) |
| Sockets of its child processes (workerd), by `lsof` | `127.0.0.1` only |
| Any name with `cloudflare` in it | none |

Two proofs, side by side. No credential existed anywhere in the process, so a call to
`api.cloudflare.com` could not have succeeded; and none was attempted, by Node's own record of
every connection. Local dev falls back to an all-zero account id and never resolves the
credentials it is handed (experiment 146,
[LocalAccount.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/LocalAccount.ts)).
The live run's watcher, for contrast, saw `api.cloudflare.com` and nothing else outside the
Worker's own address.

Phoenix's dev needs credentials only because it marks its D1 database `Alchemy.remote()`
(`docs/direction/local-is-the-cloud.md`). With nothing marked remote, the Durable Object needs no
account.

## The one switch, and what has no local twin

```ts
// ledger.ts and parts.ts: one stack function, two places. Only `where` differs.
const ledgerDeploy = (where: "local" | "cloud", stack) =>
	deploy({stack, stage: where, dev: where === "local"});
```

The run picks the place (`dev`), not the stage name, as experiment 146 found. Here the stage names
the place too, so the two states never mix: `.alchemy/state/tf-exp-147-ledger/local/` and
`.../cloud/`.

Where the twins differ, seen in this run:

- **A rename plans differently.** The same rename of the Worker's `name` plans as `replace` on
  Cloudflare and as `update` in workerd. A guard that refuses a replace passes locally and refuses
  on Cloudflare. The outcome matches (the new name starts empty in both), the plan does not.
- **Destroy keeps local storage.** In workerd the object's data lives under
  `.alchemy/local/<worker name>-<class>/` and survives `destroy`: three destroy and create rounds
  each found the row from before. On Cloudflare, deleting the Worker deletes its namespace and
  its data (the listing after the sweep).
- **The address moves.** Each local deploy took the next free port (1337, 1338, ...), and a
  redeploy with the same inputs started a second server on a new port while the old one kept
  answering. A client must read the address from each deploy's output.
- **No local twin at all:** the workers.dev address, Cloudflare's own API (listing, deleting by
  hand), Workers Logs, real colos and placement, the real cold start and eviction (experiment
  144), and what a request costs.

## Can a rename lose the ledger's data?

Experiment 144 found that a new Worker `name` is a replace, and a replace deletes the old Worker
and its object's storage. `RemovalPolicy.retain()` in beta.84 skips the provider's `delete` and
drops Alchemy's row ([RemovalPolicy.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/RemovalPolicy.ts)).

```ts
// ledger.ts
const worker = yield* Cloudflare.Worker("Ledger", {name: inputs.name, main, env: {LEDGER: Cloudflare.DurableObject("Ledger"), ...}})
	.pipe(RemovalPolicy.retain(inputs.retain));
```

The run, on Cloudflare, with retain on:

| Step | Workers named `tf-exp-147-` | What the objects said |
|---|---|---|
| Deploy `ledger-a`, register `triage` | a | `created: true` |
| Rename to `ledger-b`, deploy (a replace) | a and b, each with its namespace | |
| Register `triage` on a | | `created: false`: **the row is still there** |
| Register `triage` on b | | `created: true`: **the new name starts empty** |
| `destroy` with retain still on | a and b | 7 to 12 ms, nothing deleted |
| Redeploy b with retain off | a and b | silently taken over again, its row still there |
| `destroy` with retain off | a | 427 to 453 ms, b deleted |
| Delete a by hand, found by listing | none | |

What this shows:

- **Retain makes a rename safe for the data, and it does not move the data.** The rows stay with
  the old name. The new name is a new, empty object. Moving the rows is still the copy in `pos`
  order that experiment 145 measured.
- **Retain also stops `destroy`.** A retained Worker is forgotten by Alchemy and keeps running. Our
  cleanup must find it by listing. To delete it through Alchemy, deploy it again with retain off
  (the next row), then destroy. Alchemy's docs say a policy change on a live row plans as no
  change and is rewritten in place; that path was not run here.
- **A forgotten Worker can be taken back.** Deploying the same stack, stage and logical id over it
  adopted it without `--adopt`, because it carries Alchemy's ownership tags
  ([WorkerProvider.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Workers/WorkerProvider.ts),
  around line 5150). A Worker without those tags would fail with `OwnedBySomeoneElse`.

### Reading the plan before it applies

`deploy` is three calls: `evalStack`, `Plan.make`, `Apply.apply`
([Deploy.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Deploy.ts)). All three are public, so our
code can put a look between the plan and the apply. `Plan.describePlan` gives one row per resource
with its action (`create`, `update`, `replace`, `delete`, `orphaned`, `noop`), from
[Plan.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Plan.ts).

- On Cloudflare, the rename planned as `Ledger: replace`. The guard refused it in 8 to 11 ms, and
  the listing after showed the Worker unchanged.
- Alchemy has no protection of its own beyond the CLI's approval prompt (`approvePlan` in
  `Cli/commands/deploy.ts`). From code there is no prompt: `layerNonInteractive` fails any prompt.
- In workerd the same rename planned as `update`, so this guard would pass it locally. A guard
  that also compares the Worker's `name` prop with the row's would catch both.

## Does a host stay up after `deploy` returns? (part 4)

- **Our host, yes, and after the deploying process exits too.** `host-up` deployed and exited;
  `host-down`, a new process, found the same pid alive, planned no change in 25 to 30 ms, and
  destroyed it in 34 to 42 ms. The host is a detached process (experiment 146), so no scope holds it.
- **workerd, only inside a scope of ours.** Without `scope`, `deploy` closes its own scope when it
  returns and workerd stops with it: the first call after return failed to connect. With our
  `Scope` passed in, the Worker answered until we closed the scope, then stopped
  ([Stack.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Stack.ts), `evalStack`: "when set,
  scoped resources outlive deploy"). For a local ledger the host would hold that scope.
- **A dead process is still drift.** After SIGKILL, a plain deploy said no change in 4 to 5 ms and
  the host stayed dead, as in experiment 146. `Drift.repair`, called from code through `evalStack`,
  found it missing and started a new one in 86 to 88 ms. Called from code it is cheap enough to run on a
  timer, but that is polling. Alchemy still does not watch.

## What needed the CLI, and what replaces it

| CLI part | From code | Shown |
|---|---|---|
| Credentials, profile login | The stack's `secrets` option: a Layer giving a ConfigProvider. The live runs removed every `CLOUDFLARE_*` variable and gave the token and account this way. No profile, no login. | live run |
| A ConfigProvider of the caller's | Ignored: `evalStack` puts back the process environment plus a `.env` in the working folder (`loadConfigProvider`, [Util/ConfigProvider.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Util/ConfigProvider.ts)). `secrets` is the way in. | source |
| State store | A Layer: `Alchemy.localState()`, `inMemoryState()`, or any `State` service of our own. | every run |
| Telemetry | Never loaded. Only the CLI, the test harness and the Cloudflare state store provide `TelemetryLive`. No connection to `otel.alchemy.run` was seen. | source, watcher |
| Version check | CLI only (`Cli/main.ts`). No connection to the npm registry was seen. | source, watcher |
| Approval prompt | `Interaction.layerNonInteractive()`; a guard of our own instead (above). | live run |
| The user folder | `ALCHEMY_HOME` still gets a `profiles/default` folder and a lock file, empty of credentials. | dev run |
| Logs | Alchemy's logger writes `.alchemy/log/out`, and its info lines go to the program's console. | every run |

## What it costs

- **Money:** under $0.01. Each live run made, by estimate (not counted), about 40 Cloudflare API
  calls, which are free, and about 15 Worker and 10 Durable Object requests, inside the free
  allowance. The CLI comparison added 4 CLI
  runs on a third Worker.
- **Code:** about 25 lines to build the engine Layer and call `deploy`, against a stack file the
  CLI would need anyway. The guard is 15 lines.
- **Dependencies:** the same as experiment 146 without Docker.

## Recommendation

Use Alchemy from code, inside fabrika's own program, for the ledger server and its local twin, and
for a standing host. Drop the CLI from that path.

- **Why:** a deploy with nothing to do is 2 to 56 ms, so a host can run it at every start, and
  local and cloud are one argument apart. Credentials, state and the plan are all in our hands, so
  the guard and our own secrets fit without patching Alchemy.
- **For the ledger, always:** `RemovalPolicy.retain()` on the Worker, and a guard that refuses a
  plan where the ledger's Worker is replaced, deleted or renamed. Cleanup by listing.
- **Still not for per-run things.** Experiment 146's reasons stand apart from speed: a state row
  per box, and nothing watches.
- **Cost:** our own small glue over Alchemy's internals (`evalStack`, `Plan`, `Apply`), which a beta
  can change. Pin it exactly.
- **How sure:** 80%. The doubt is churn: these are internal-looking modules of a beta with about
  three releases a week. One run on the next beta would settle it.

## Surprises

- A rename plans as `replace` on Cloudflare and as `update` in workerd.
- Retain also stops `destroy`, and a retained Worker is forgotten until we list.
- Local object storage survives `destroy`; cloud storage does not.
- A local redeploy with the same inputs started a second server on a new port.
- A busy default port costs about 3 s. In one dev run another program on the laptop held port
  1337, and every local deploy took 3.0 to 3.2 s instead of 14 to 20 ms before it moved to the
  next port. The rerun a minute later, with the port free, was back to normal. That run is not in
  the table or the results file. Picking a free port ourselves would avoid it; `strictPort: true` would fail at once instead.
- `evalStack` ignores the caller's ConfigProvider, and reads a `.env` from the working folder.
- The working folder is read once, at import, so the program must be in place before it loads
  Alchemy.
- Experiment 146's socket path did not fit in a long temp folder: macOS caps a Unix socket path
  near 104 bytes. The first try failed on that, not on Alchemy.

## Sources

Alchemy `2.0.0-beta.84`, as published to npm:

- [Deploy.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Deploy.ts),
  [Destroy.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Destroy.ts),
  [Stack.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Stack.ts) (`evalStack`, the scope),
  [Plan.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Plan.ts) (`describePlan`),
  [Drift.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Drift.ts),
  [RemovalPolicy.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/RemovalPolicy.ts)
- [AlchemyContext.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/AlchemyContext.ts),
  [Interaction.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Interaction.ts),
  [State/LocalState.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/State/LocalState.ts),
  [Util/ConfigProvider.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Util/ConfigProvider.ts),
  [Util/Node.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Util/Node.ts),
  [Auth/Resolve.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Auth/Resolve.ts)
- [Test/Core.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Test/Core.ts), Alchemy's own
  from-code harness, which this driver follows
- [Cli/exec.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Cli/exec.ts),
  [Cli/main.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Cli/main.ts),
  [Telemetry/Layer.ts](https://unpkg.com/alchemy@2.0.0-beta.84/src/Telemetry/Layer.ts)
- `@alchemy.run/cloudflare`:
  [Credentials.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Credentials.ts),
  [CloudflareEnvironment.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/CloudflareEnvironment.ts),
  [Auth/AuthProvider.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Auth/AuthProvider.ts),
  [Providers.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Providers.ts),
  [Workers/WorkerProvider.ts](https://unpkg.com/@alchemy.run/cloudflare@2.0.0-beta.84/src/Workers/WorkerProvider.ts)
- Cloudflare API: `GET /accounts/:id/workers/scripts`,
  `GET /accounts/:id/workers/durable_objects/namespaces`,
  `DELETE /accounts/:id/workers/scripts/:name?force=true`.
- Experiments 144 (pull request 99), 145 and 146 in this folder;
  `docs/direction/local-is-the-cloud.md`.

## What it cannot tell us

- **The next beta.** `evalStack`, `Plan` and `Apply` are public paths but not a promised API.
- **Few samples.** One host run with five warm rounds, one dev run with three, two live runs. The
  live numbers move with the network; the 2 s uploads are one laptop on one connection.
- **Many resources.** One or two resources per stack. A stack with many Workers was not tried.
- **Two programs on one stack.** Nothing here locks the state between two processes.
- **The watcher's blind spots.** Node's channels see this process; `lsof` sampled workerd once,
  mid-run. A connection opened and closed between samples in a child would be missed. The
  missing credentials are the stronger proof.
- **A real host.** `Fabrika.Host` drives experiment 146's 53-line stand-in.
- **Moving the data.** Retain keeps the old rows where they were. Copying them to a new name was
  not tried here.
