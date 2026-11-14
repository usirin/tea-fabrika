---
date: "2026-11-11"
summary: "`next/`; $0. Yes, in the local runtime. Alchemy's engine (`Stack.make`, `Plan.make`, `Apply.apply`) ran inside a Durable Object under workerd, with a state store written over the ledger stand-in. Apply, a second apply with no change, a changed prop, a dropped resource and a removed program all did what they should. It does not go through `deploy()`, which loads the Node platform and reads `.env` from disk. About 90% for what ran; Cloudflare itself and a program loaded through Worker Loader were not tried. Numbered 276 on its branch."
---

# 281. Can a program declare what should exist as resources, and can Alchemy's own engine apply them inside the brain when the program is loaded?

Numbered 276 on its branch. It landed as 281, because main's 276 is
[the P34c walls write-up](./276-p34c-walls.md). Its script folder and its `runs/276/` folder keep
the old number.

Run on 2026-11-11 against `alchemy` 2.0.0-beta.85, `@alchemy.run/cloudflare` 2.0.0-beta.85 and
`effect` 4.1.2, the installed versions. No account, no network deploy, no key, no model: **$0**. It
is about `next/`. Nothing here touched a real ledger. This page was written on its branch from its
first line ([0128](../.decisions/0128-a-write-up-is-born-in-the-repo.md)). It follows
[experiment 264](264-hands-as-an-alchemy-resource.md), which wrote two custom Alchemy resources in
Effect.

**The answer: yes, in the local runtime.** Alchemy's own engine ran inside a Durable Object under
workerd, bundled into the Worker, with a state store of our own written over the ledger stand-in.
Apply, a second apply with no change, a changed prop, a dropped resource and a removed program all
did what they should. Two catches:

- It runs through the engine's three parts (`Stack.make`, `Plan.make`, `Apply.apply`), the way
  Alchemy's own test harness runs them, not through `deploy()`. `deploy()` loads the Node platform
  and reads `.env` from disk.
- At run time the engine needs only three things: the state store, the stage name, and the
  providers' own services. Its types ask for eleven more. None of them was touched, in 50+ applies
  on each host.

```ts
// The whole idea, as run (worker.ts and resources.ts in this experiment's folder).
export class Brain extends DurableObject<Env> {
  readonly ledger = sqlLedger(this.ctx.storage.sql); // the ledger stand-in: one SQLite table

  apply(version: Version) {
    // program -> Stack.make -> Plan.make -> Apply.apply, with LedgerState as Alchemy's state store
    return Effect.runPromise(applyStack(version).pipe(Effect.provideService(Ledger, this.ledger)));
  }
}
// GET /apply?v=v1  -> { actions: { sweep: "create", watcher: "create" } }   9 ledger entries
// GET /apply?v=v1  -> { actions: { sweep: "noop",   watcher: "noop"   } }   1 ledger entry
```

How sure: about 90% for what ran (the local runtime, one object, two resources). Cloudflare itself,
and a program loaded through Worker Loader, were not tried. See
[what it cannot tell us](#what-it-cannot-tell-us).

## The idea

A program declares the standing things it needs. Loading the program creates them, a changed
declaration updates them, and removing the program deletes them.

```ts
// A sketch. `resources` and `ScheduledJob` are made-up names; nothing here is built.
export default Program.make({
  name: "nightly-sweep",
  machine,
  resources: {
    // This should exist. Loading the program creates it; removing the program deletes it.
    sweep: ScheduledJob({ every: "1 hour", input: "sweep" }),
  },
});
```

One line sorts what may be a resource:

```text
should exist    a scheduled job, a process that should be running    a resource, declared
should happen   a Job, one run of a command                          a command the program returns
```

## What experiment 264 already showed

- A custom resource of our own is four small functions in Effect: read, diff, reconcile, delete.
- A deploy does not notice a dead process, and Alchemy keeps nothing alive.

So the resource is the wish, and fabrika's supervisor keeps it true. Kubernetes splits it the same
way: a spec, and a controller that makes it so.

## The question

Can Alchemy's own engine (its plan, its apply, its state store) run inside the brain, in the local
runtime and on Cloudflare, when a program is loaded at run time, with the ledger as its state
store?

- If yes, a program's resources are Alchemy resources for real, and an instance and its programs
  are provisioned one way ([0126](../.decisions/0126-the-library-makes-an-instance-from-an-apps-choices.md)).
- If no, this page says exactly what stops it, and sketches the same four functions applied by
  fabrika itself.

## How it ran

Three files, all this repo's lab code. Today's fabrika played no part.

- `resources.ts` names no platform. It holds the ledger stand-in (`Ledger`: `append` and
  `entries`), `LedgerState` (an Alchemy state store over that ledger, modeled on Alchemy's
  `State/InMemoryState.ts`), two made-up resources, `ScheduledJob` and `ProcessSpec`, and
  `applyStack`, which runs the engine.
- `node.ts` runs the steps on Node with an in-memory ledger, then 50 no-change applies and 50 fresh
  applies.
- `workerd.ts` bundles `worker.ts` the way the brain is bundled (Rolldown, platform `browser`,
  `cloudflare:workers` and `node:*` left to the runtime, as `next/packages/libfabrika/src/node/build/bundle.ts`
  does), starts it in the local runtime through Alchemy's dev deploy (as
  `next/apps/fabrika/src/instance.ts` does), drives eight steps over HTTP, then closes the scope,
  which stops workerd. `worker.ts` is one Durable Object whose ledger is a table in its own SQLite.

The steps, on both hosts: `v1` declares both resources; `v1` again; `v2` changes the job's `every`;
`v3` drops the process; `v3` again; `gone` declares nothing (the program is removed). Under
workerd, one more step before `gone` ran the engine with no engine service at all (`bare`), and
`v1` was declared again after it. Node ran its `bare` apply on a fresh ledger.

Each resource writes its own entry to the ledger (`job_scheduled`, `process_wanted`, and the two
`_un…` entries on delete), and Alchemy's state goes into the same ledger as `state_set`,
`state_removed` and `output_set` entries. Every service the engine's types ask for but should not
use was given as a tripwire: a stand-in that records any property read and dies on any call.

## What the engine needs, and who gives it

How Alchemy's own tests give it: `alchemy-test/src/Core.ts` at tag `v2.0.0-beta.85` builds a
scratch stack with `makeStack(...)`, then `Plan.make(compiled)` and `applyAndRender`, under
`compiled.services`, a `Stage`, a fresh artifact store and `State.InMemoryService({})` as its state
(`Core.ts:788-833`). Its fuller harness adds `PlatformServices`, `FetchHttpClient`, the profile and
credential stores, `LoggingCli`, `Interaction.layerNonInteractive()` and `AlchemyContextLive`
(`Core.ts:418-430`). This run went the scratch-stack way. Paths below are under
`node_modules/alchemy/src/` unless named.

| Service | On Node (264, the app's instance) | In the brain (this run) |
|---|---|---|
| `State` | `localState()`, one JSON file per resource | `LedgerState`, entries in the ledger |
| `Stage` | `deploy({ stage })` | `Effect.provideService(Stage, "brain")` |
| `Stack`, `AuthProviders` | `Stack.make` builds both (`Stack.ts:296-335`) | the same |
| the providers' own services | per provider | `Ledger` |
| `AlchemyContext` | `Layer.succeed(...)` | not needed: read with `serviceOption` (`Apply.ts:286`) |
| `ArtifactStore` | `createArtifactStore()` | not needed in the bare run |
| `Interaction` | `layerNonInteractive()` | not needed, and importing it pulls in the terminal UI |
| `FileSystem`, `ChildProcessSpawner` | `NodeServices.layer` | a tripwire, never touched |
| `Path` | `NodeServices.layer` | `Path.layer`, plain JS; not needed in the bare run |
| `HttpClient` | `FetchHttpClient.layer` | a tripwire, never touched |
| `SecureRandom`, `Digest` | WebCrypto layers | the same layers; not needed in the bare run: the engine calls `crypto` itself (`InstanceId.ts`, `Util/sha256.ts`) |
| `CredentialsStore`, `ProfileStore` | `EvalStack.ts:34-35` | a tripwire, never touched |

No service the engine needs is one a Worker cannot give. The tripwire list came back empty on both
hosts, and the bare run (no engine service at all) did two creates on Node and a create and an
update under workerd. The
cost is in the types: `Stack.make`'s providers are typed against all of `StackServices`
(`Stack.ts:35-50`), so the bare run needed `Layer.empty as never`.

## What it imports that a Worker lacks

- **`deploy()` and `destroy()`.** They go through `evalStack`, whose platform layer is
  `PlatformServices` (`EvalStack.ts:31-36`). That layer imports `@effect/platform-node` at run time
  (`Util/PlatformServices.ts:77-90`) and calls `process.exit(1)` if it cannot (`:31`). `evalStack`
  also reads `.env` through `FileSystem` (`Util/ConfigProvider.ts:125-135`, called at
  `EvalStack.ts:72`). Neither is right inside an object, so this run did not use them.
- **`Interaction`.** It loads the terminal UI (`Interaction.ts:32`, `:373-375`), which pulls in
  `@alchemy.run/sigil` with `node:fs`, `node:tty`, `node:stream` and nine more `node:` modules. A
  first bundle that imported `Interaction` and the `alchemy` index was 1,782,538 bytes, 862,720 of
  them sigil. Importing by subpath and leaving `Interaction` out dropped all of it.
- **What is left:** `node:os`, from `picomatch`, which `ResourceSelection.ts:3` imports for
  `--include` and `--exclude` patterns. Alchemy turns on `nodejs_compat` for every Worker, so it
  loads. `pathe` (`AlchemyContext.ts:6`) is plain JS.
- **The coming public way in.** Alchemy's own TODO says the stack builds will move onto
  `Alchemist.plan` and `Alchemist.apply` (`EvalStack.ts:17-25`, `Alchemist/Operations.ts:267`,
  `:291`). `Alchemist.plan` also reads `.env` (`Operations.ts:51`). In a Worker that needs a
  `FileSystem` whose `exists` says no. That was not tried.

No upstream patch is needed for what ran ([0054](../.decisions/0054-read-upstream-before-patching-it.md)).
Two small upstream changes would help, both in Alchemy's code: let `loadConfigProvider` take a
`ConfigProvider` instead of reading `.env` (`Util/ConfigProvider.ts:125`), and type the providers
layer against what a provider really asks for, not all of `StackServices` (`Stack.ts:125`). Neither
is filed; the lead decides.

## Results

Every step did what it should on both hosts. Times are from the last run. On Node, an apply is timed
around `applyStack`. Under workerd, timers tick in whole milliseconds, so the in-object time is
rough, and the round trip from Node includes one local HTTP request.

| Step | Plan | New ledger entries | Node | workerd, in the object / round trip |
|---|---|---|---|---|
| 1. apply `v1` | create, create | 9: 6 state, 2 own, 1 output | 1.97 ms | 17 ms / 24.0 ms (cold isolate) |
| 2. `v1` again | noop, noop | 1: output only | 1.56 ms | 2 ms / 4.1 ms |
| 3. `v2`, one prop changed | update, noop | 4: 2 state, `job_scheduled`, output | 1.74 ms | 2 ms / 2.9 ms |
| 4. `v3`, the process dropped | noop, delete | 4: `deleting`, `process_unwanted`, `state_removed`, output | 1.73 ms | 2 ms / 3.6 ms |
| 5. `v3` again | noop | 1: output only | 0.76 ms | 1 ms / 3.4 ms |
| remove the program (`gone`) | delete (each left) | per resource: `deleting`, its `_un…` entry, `state_removed` | 0.76 ms | 2 ms / 3.1 ms |

- **Two resources, fresh**, 50 times on Node: p50 0.64 ms, p95 0.89 ms.
- **No change, two resources**, 50 times: Node p50 0.61 ms, p95 0.96 ms. Under workerd, round trip
  p50 2.51 ms, p95 2.94 ms. A no-change apply wrote no state, but read state 7 times (4 `get`,
  2 `list`, 1 `getReplacedResources`) and wrote one `output_set` entry each time
  (`Apply.ts:428` sets the stack output on every apply).
- **The runtime** answered 155 ms after the dev deploy started.
- **Bundle.** The Worker with the engine: 905,378 bytes plain (219,280 gzip), 286,361 minified
  (93,073 gzip). A Worker with the same object, Effect and one Schema but no engine: 75,839
  minified (24,200 gzip). So the engine adds about 210 KB minified, 69 KB gzip, over that floor.
  Before minifying: Alchemy's own code is 238,547 bytes, `picomatch` 56,527, `pathe` 14,311, our
  code 10,450, and Effect 584,903. The brain already carries much of that Effect, so 210 KB is an
  upper bound on what it would add there.
- **Delete is real.** Dropping a resource ran its provider's `delete`, which wrote
  `process_unwanted`, and then removed its state. Removing the program deleted every resource
  left.

## What the state store holds

One resource's state, as the ledger got it (the deleting entry for the process, step 4):

```json
{
  "_tag": "state_set", "stack": "nightly-sweep", "stage": "brain", "fqn": "watcher",
  "value": {
    "status": "deleting", "fqn": "watcher", "logicalId": "watcher",
    "instanceId": "17aa7cfcc45a49539711260b7897270d", "resourceType": "Fabrika.ProcessSpec",
    "props": { "program": "nightly-sweep", "restart": "always" },
    "attr": { "process": "watcher", "seq": 7 },
    "downstream": [], "providerVersion": 0, "bindings": [], "removalPolicy": "destroy"
  }
}
```

- Each `state_set` entry was 343 to 675 bytes of JSON. The big one is `updating`, which carries the
  whole old state as `old`.
- A create writes three state entries per resource (`creating` twice, then `created`), an update
  two, a delete one plus a `state_removed`.
- What a ledger entry would carry, then: the status, the props as declared, the attributes the
  provider returned, the instance id (it changes only on a replace), the type, and the links
  (`downstream`, `bindings`). The props and attributes are ours; the rest is Alchemy's.

## The resource as run

```ts
// From resources.ts. ScheduledJob is made up; it only writes ledger entries.
type JobProps = { readonly every: string; readonly input: string };
type JobAttrs = { readonly job: string; readonly seq: number };
type ScheduledJob = ResourceType<"Fabrika.ScheduledJob", JobProps, JobAttrs>;
const ScheduledJob = Resource<ScheduledJob>("Fabrika.ScheduledJob");

const ScheduledJobProvider = Provider.effect(
  ScheduledJob,
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    return {
      read: Effect.fn(function* ({ fqn }) {
        const last = latest(yield* ledger.entries, ["job_scheduled", "job_unscheduled"], (e) => "job" in e && e.job === fqn);
        return last?._tag === "job_scheduled" ? { job: fqn, seq: 0 } : undefined;
      }),
      diff: ({ olds, news }) =>
        Effect.succeed(
          isResolved(news) && (olds.every !== news.every || olds.input !== news.input)
            ? { action: "update" as const }
            : { action: "noop" as const },
        ),
      reconcile: Effect.fn(function* ({ fqn, news }) {
        const seq = yield* ledger.append({ _tag: "job_scheduled", job: fqn, every: news.every, input: news.input });
        return { job: fqn, seq };
      }),
      delete: Effect.fn(function* ({ fqn }) {
        yield* ledger.append({ _tag: "job_unscheduled", job: fqn });
      }),
    };
  }),
);
```

`LedgerState` is the other half: `get` folds the `state_set` and `state_removed` entries for one
fqn, and `set` appends a `state_set`. It is 80 lines, most of them the eleven calls of
`StateService` (`State/State.ts:44-142`).

## If fabrika builds it itself: `Resource.make`

The owner asked for this to be concrete enough to judge either way. **A sketch, not built.** Names
follow [0029](../.decisions/0029-format-and-names-follow-effect.md): a module read through its name,
a plural service.

```ts
// next/packages/libfabrika/src/resources/Resource.ts (sketch)
import { Context, Effect, Schema } from "effect";

/** What diff answers. Alchemy's own three, with its deleteFirst (alchemy Diff.ts:11-35). */
export const Change = Schema.TaggedUnion({ noop: {}, update: {}, replace: { deleteFirst: Schema.Boolean } });

/** One resource type: the four functions, in the same shape as an Alchemy provider. */
export const make = <P extends Schema.Top, A extends Schema.Top, R>(
  type: string,
  spec: {
    readonly props: P;
    readonly attrs: A;
    readonly read: (name: string, attrs: A["Type"] | undefined) => Effect.Effect<A["Type"] | undefined, never, R>;
    readonly diff: (olds: P["Type"], news: P["Type"]) => Effect.Effect<typeof Change.Type>;
    readonly reconcile: (name: string, news: P["Type"], attrs: A["Type"] | undefined) => Effect.Effect<A["Type"], ResourceError, R>;
    readonly delete: (name: string, attrs: A["Type"]) => Effect.Effect<void, ResourceError, R>;
  },
) => ({ type, ...spec, declare: (props: P["Type"]) => ({ type, props }) });

/** Applies one program's declaration. The ledger is the state: one stream per program. */
export class Resources extends Context.Service<
  Resources,
  {
    readonly apply: (program: string, declared: Readonly<Record<string, Declared>>) => Effect.Effect<Applied, ResourceError>;
  }
>()("libfabrika/resources/Resources") {}
```

One resource written against it. "Should be running" is kept true by the process supervisor that
already exists in `next/` (`processes/ProcessManager.ts`: `start`, `down`, restarts by policy), not
by the resource:

```ts
// sketch
export const ProcessSpec = Resource.make("ProcessSpec", {
  props: Schema.Struct({ program: Schema.String, restart: Schema.Literals(["always", "on-failure"]) }),
  attrs: Schema.Struct({ process: Schema.String }),
  read: (name) => ProcessManager.use((pm) => pm.status(name)).pipe(Effect.map((s) => ({ process: s.name })), Effect.orElseSucceed(() => undefined)),
  diff: (olds, news) =>
    Effect.succeed(olds.program !== news.program ? Change.cases.replace.make({ deleteFirst: true })
      : olds.restart !== news.restart ? Change.cases.update.make({}) : Change.cases.noop.make({})),
  // The wish goes to the supervisor; from here on the supervisor restarts it on every DOWN.
  reconcile: (name, news) => ProcessManager.use((pm) => pm.start({ name, program: news.program, restart: news.restart }, self)),
  delete: (name) => ProcessManager.use((pm) => pm.exit(name, ExitReason.cases.shutdown.make({}), self)),
});
```

The entries it would write, one per change, to the program's stream through `Ledger.append(stream,
id, line)` (`ledger/Ledger.ts:38`). Each holds only what is ours; the rest of Alchemy's row (links,
removal policy, provider version) has no job here yet:

```ts
// sketch: stream "resources:nightly-sweep"
{ _tag: "resource_applying", name: "watcher", type: "ProcessSpec", change: "create", props: { program: "nightly-sweep", restart: "always" } }
{ _tag: "resource_applied",  name: "watcher", attrs: { process: "watcher" } }
{ _tag: "resource_deleting", name: "watcher" }
{ _tag: "resource_deleted",  name: "watcher" }
```

The resource's life is an explicit tea machine ([0037](../.decisions/0037-implicit-state-machines-made-explicit.md),
[0046](../.decisions/0046-one-tea-machine-per-file.md)): `absent`, `applying`, `present`,
`deleting`, folded from those entries. A `ScheduledJob`'s reconcile sets an alarm in the project's
object and its handler sets the next one ([0105](../.decisions/0105-a-durable-object-never-stays-awake-on-its-own.md));
the job itself is a command that runs, not a resource.

What our own module adds, against Alchemy's engine:

- Entries in the ledger's own words and shape: two small entries per change, against three
  343-to-675-byte rows per create and an `output_set` on every apply.
- No beta API to follow. The parts this run used are not Alchemy's stated way in, and its TODO says
  they move.
- Types that ask only for what a provider uses, so no `as never`.
- About 210 KB less in the brain's bundle.

What it loses:

- The dependency graph: one resource's props naming another's attributes, created in order and
  deleted in reverse (`Plan.ts` `bindSameStackRefs`, cycles in `Util/scc.ts`).
- Recovery that is already built and tested: a create cut off halfway is found again with `read`
  (`Plan.ts:1555-1580`), a replace keeps the old one until the new one stands, and the `replaced` backlog
  is cleaned on the next apply.
- Drift checks (`Drift.detect`, `Drift.repair`), adopting what already exists, and local or live
  provider modes.
- One engine for the instance and its programs alike, which is what 0126's one `make` points at.
- Alchemy's tests: 171 files under `packages/alchemy/test` at beta.85, 11,345 lines in
  `apply.test.ts` alone.

## The lean

**Use Alchemy's engine in the brain, behind a libfabrika `Resources` service, with
`LedgerState` as its state store.** Run it the scratch-stack way (`Stack.make`, `Plan.make`,
`Apply.apply`), and give the type-only services as tripwires that die. A program's declaration
crosses into the brain as data, and the providers live in the brain, never in the program.

- **Why:** it ran, in the runtime we use, with nothing patched. It brings recovery, ordering and
  replace for free, and it is the same engine the instance is deployed with.
- **What it costs:** a beta, non-public entry, which we must follow on each bump. About 210 KB in the
  bundle at most. Bigger state entries than our own would be. The no-change `output_set` entry
  would need a store that skips an output equal to the last one.
- **How sure: about 70%.** The doubt is the entry point: if `Alchemist.plan` replaces these three
  parts and needs `FileSystem` for `.env`, we must give it a stand-in or ask upstream for a
  `ConfigProvider` option. One more run would settle it: the same steps through `Alchemist.plan`
  and `Alchemist.apply`, with a `FileSystem` whose `exists` says no.

## What it cannot tell us

- **Cloudflare itself was not tried.** Only the local runtime, through Alchemy's dev deploy. The
  bundle size against the 10 MB Worker limit is fine, but a cold start there was not measured.
- **No program was loaded through Worker Loader.** The engine ran in the object, with the
  declaration written into the Worker. How a program loaded at run time
  ([173](173-worker-loader.md)) hands its declaration across is reasoned, not run.
- **No supervisor ran.** `ProcessSpec` and `ScheduledJob` only wrote entries. No process started,
  no alarm was set, and no restart was seen. `Resource.make` is a sketch.
- **One object, one apply at a time.** Two applies of the same program at once, or two objects
  sharing one ledger, were not tried. `LedgerState` has no lease.
- **No replace and no failure were tried.** `ProcessSpec`'s diff answers `replace` when the program
  changes, but no step changed it, and no provider failed halfway.
- **Two trivial resources.** The 0.6 ms and 2.5 ms say nothing about a program with many resources
  or with links between them.
- **The bare run is two applies, not proof.** An engine path we did not reach (adopt, drift, a
  provider that reads artifacts) may use a service the tripwires did not catch.

The scripts are in `experiments/276-program-resources/` on the branch
`fabrikalfa/exp-program-resources-script` only, not on main
([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)). To run them, link that
folder's `node_modules` to `next/apps/fabrika/node_modules`, then run `node.ts`, and `workerd.ts`
with `EXP276_HOME` set to a temp folder. The raw output of the last run is under `runs/276/` on the
owner's machine, not in git.
