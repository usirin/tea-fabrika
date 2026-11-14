---
date: "2026-11-13"
summary: "`next/`, spike S0 of ticket 502's plan, on `@alchemy.run/cloudflare` 2.0.0-beta.85 in the local runtime, no deploy, no model, $0. An Effect `fetch` and `ctx.props` run, on the build Alchemy bundles and on our built file with `bundle: false`. `Control` is a branch: 0 of 300 seeded requests from outside reached it on each build, and a Worker of its own gets a public address. Alchemy's bundler takes our two plugins when called directly, one file, the same bytes twice; but a Worker's `build` prop loses the plugins in silence on the local runtime, and two instances that bundle for themselves differ (the stage name is in the bytes, and watch mode bundles differently). One bundle made by our build and run with `bundle: false` worked. A follow-up ran the designed plug point: a Worker's `source` prop names a provider module of ours, which bundles with both plugins and one Durable Object, and gives the same bytes under two stage names. The real ledger gave the same answers and rows on `state.storage.transaction` as on today's turn over 1,200 seeded calls, with 6, 24 and 96 appends at once; a throw in `Effect.sync(step)` is a defect, so the driver needs `Effect.try`. A turn costs about 180 microseconds against 90, and a call through the bridge about 94 against 30. Three lines of the plan are wrong or need a change."
---

# 285. The Alchemy port's spike: an Effect `fetch`, `Control` as a branch, Alchemy's bundler, the Effect turn, and what a call costs

Run 2026-11-13 on origin/main at `c0aaf4a24`. **All claims are about `next/`.** This is spike S0 of
[the Alchemy port's plan](../docs/plan/ticket-502-alchemy-port.md), for decisions
[0041](../.decisions/0041-object-classes-are-effect-objects.md) and
[0042](../.decisions/0042-platform-pieces-go-through-alchemy.md). It answers the questions the plan
leaves to S0, so that slices S5, S7 and S8 can be planned.

- **Versions, read from the lockfile:** `alchemy` 2.0.0-beta.85, `@alchemy.run/cloudflare`
  2.0.0-beta.85 and `@alchemy.run/cloudflare-runtime` 2.0.0-beta.85, both with this repo's patches,
  `effect` 4.1.2 with this repo's patch, `rolldown` 1.2.13, Node 26.13.0. The bump to beta.86 is not
  on main, so the plan's rule applies: the bump's own pull request runs these scripts again.
- **Where it ran:** one laptop, the local runtime started only through Alchemy's `deploy` with
  `dev: true`. Nothing was deployed, no Cloudflare account, no key, no model. $0 at any list price.
- **The code** is on the branch `fabrikalfa/t502-alchemy-spike`, in
  `experiments/285-alchemy-port-spike/`. It changes no product file. Raw output went to `runs/285/`,
  which git ignores ([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)).
  Every number here is from one last run of each script, from an empty `runs/285/`.

## The answer first

| # | The plan's question | Answer |
|---|---|---|
| 1 | Do an Effect `fetch` and `ctx.props` run on an Effect Worker? | Yes, on both builds: the one Alchemy bundles, and our built file run with `bundle: false` |
| 2 | Can `Control` be a branch of the one Effect `fetch`? | Yes, by the plan's own rule: 0 of 300 requests from outside reached the branch, on each build |
| 3 | Can Alchemy's bundler carry our two plugins, and do two bundles give one build? | The bundler can. A Worker's `build` prop cannot on the local runtime: the plugins are dropped in silence. And two instances that each bundle for themselves get different bytes |
| 4 | Do the ledger's laws hold on the Effect `transaction`? | Yes: 1,200 seeded ledger calls gave the same answers and the same rows as today's turn. One change is needed: a throw in a step is a defect unless the driver uses `Effect.try` |
| 5 | What does a call through the bridge cost? | About 94 microseconds against 30 for a plain class: about 64 more a call |

Two lines of the plan are wrong, and one more needs a change. They are under
[Where the plan is wrong](#where-the-plan-is-wrong).

The whole idea in one block. Real code from `probe.ts`, cut down; it ran on both builds.

```ts
export default Probe.make(
  { main: import.meta.url, dev: { host: "127.0.0.1" }, compatibility: { date: "2026-10-12" } },
  Effect.gen(function* () {
    const ctx = yield* Cloudflare.WorkerExecutionContext; // init: a reference only
    const echoes = yield* Echo.from(Probe); // a sibling, taken once
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const props = yield* ctx.props; // an empty object for a request from outside

        // The control branch: taken only when the caller's binding carried a token.
        if (typeof props.token === "string") {
          return yield* control(url.pathname, request.headers.authorization, props.token);
        }

        // ... the door. A socket upgrade goes on to the object's own request slot:
        return yield* echoes.getByName("one").fetch(request);
      }),
    };
  }).pipe(Effect.provide(Layer.mergeAll(EchoLive, TurnLive))),
);
```

## What ran

Two builds of one probe Worker, so each answer holds for the slice that needs it.

- **bundled:** Alchemy bundles `probe.ts` itself. This is where the port ends (S8).
- **prebuilt:** libfabrika's own `bundle()`, with the options of main's brain phase, builds an entry
  shaped like `brain.ts`, and the stack runs it with `bundle: false`. This is main today, and S7.

| Script | What it asks | Runs on |
|---|---|---|
| `fetch.ts` | questions 1 and 2, and the object's request slot | both builds |
| `control.ts` | `Control` as a Worker of its own | bundled |
| `bundle.ts` | question 3 | Alchemy's bundler called directly, then the local runtime |
| `storage.ts` | question 4 | both builds |
| `timing.ts` | question 5 | both builds |
| `provider.ts` | the follow-up: a Worker's `source` prop | the local runtime, under two stage names |

`launch.mjs` starts a script in a temp home, `harness.ts` starts and stops the runtime, `stacks.ts`
holds the two builds, and `turn.ts`, `brainlike.ts`, `own.ts`, `plugins.ts`, `build-input.ts`,
`view.tsx` and `entry.template.txt` are the probes.

## 1. An Effect `fetch` and `ctx.props`

Ran, on both builds. The same answers on each.

| Request | Saw |
|---|---|
| The public port, `GET /props` | 200, the door, `props` is `{}` |
| A private socket whose binding carries `props: { token }`, with the bearer | 200, the control branch |
| The same socket with no bearer, and with a wrong bearer | 401 and 401 |
| The public port with the right bearer | 200, the door: the bearer alone opens nothing |
| A stub the Worker makes of itself, `ctx.exports.default({ props })` | the control branch |

- **On the prebuilt file the default export is one line,** as the plan has it for S7:
  `export default makeWorkerBridge(WorkerEntrypoint, meta)`, beside a plain object class and a plain
  `Control` class. Today's named `Control` class still answered beside it (200).
- **The private socket names no entrypoint.** It is the socket `dev.ts` adds today, without the
  `entrypoint: "Control"` line. Its props arrive in `ctx.props` as the object the JSON holds.
- **Code inside the Worker can make props.** That is workerd's own `ctx.exports`. A loaded program
  cannot reach it: it runs in its own isolate with an empty `env`. So the rule is about requests
  from outside, and it holds.

**The object's request slot, the plan's `handed` line.** Ran, on both builds. A raw `Request` went
in and a raw `Response` came out: status 207, a header and the posted body all arrived. A WebSocket
upgrade went from the Worker's `fetch` to the object, the object accepted it on its raw state, and
its `webSocketMessage` slot answered `echo ping-1`.

```ts
// The plain service an object hands to, as ConnectionService is on main.
const service = (state) => ({ fetch: (request: Request) => Effect.promise(async () => new Response(/* ... */)) });

/** A raw platform Response as the answer of Alchemy's request slot. */
const raw = (response: Response) =>
  HttpServerResponse.setBody(HttpServerResponse.empty({ status: response.status }), HttpBody.raw(response));

/** The plan's `handed`: the slot gives the raw Request to the service and returns its raw Response. */
const handed = (fetch: (request: Request) => Effect.Effect<Response>) =>
  Cloudflare.Request.pipe(Effect.flatMap(fetch), Effect.map(raw));

// In the Layer:
fetch: handed(plain.fetch),
webSocketMessage: (socket, message) => Effect.sync(() => socket.ws.send(`echo ${message}`)),
```

## 2. `Control` as a branch, and as its own Worker

**The branch wins, by the rule the plan wrote before the run:** it is taken only when no request
from outside can carry `props`.

- 300 seeded requests (fast-check, seed 119120) went to the public port on each build: six methods,
  query strings that name a token, bodies, and up to five headers out of 13 names such as `props`,
  `cf-props`, `cf-worker`, `cf-ew-via`, `authorization` and `cf-access-jwt-assertion`, with the real
  token as their value. 300 of 300 were answered, and 0 reached the control branch, on both builds.
- The branch keeps both gates it has today: the token in `ctx.props`, and the same token as bearer.

**`Control` as a small Effect Worker of its own was run too** (`control.ts`, `own.ts`).

| What the local runtime gave the second Worker | Saw |
|---|---|
| A workerd process | its own: 2 starts for 2 Workers |
| A public address | yes: `localhost:1338`, beside the brain's `localhost:1337` |
| A request to that address, no props, no bearer | 200: its `fetch` ran, with empty props |
| The private socket with props | on both processes: the plugin adds it to every workerd |

So a Worker of its own is not hidden from the public side. It is the weaker form here: one more
process, one more open port, and it would need its own bindings to reach the brain's objects.

## 3. Alchemy's bundler, our two plugins, and one build

`bundle.ts` first runs the app's real build, to get the real table (1 program, 1 asset, 1.39 MB of
bodies) and today's numbers. Then it bundles `brainlike.ts`, a Worker that imports the table and a
`.tsx` file and serves the table with libfabrika's own `serveAsset`.

**The bundler takes both plugins.** Called the way Alchemy's Worker resource calls it
(`WorkerBundle.build`), with `extraOptions: { input: { plugins: [compiler, embed(tables)] } }`:

- The compiler plugin ran once on the one `.tsx` file, was given TypeScript (so it ran before
  Alchemy's own plugins, as `Worker.ts:972` says), and its output imports the Compiler's runtime.
- The table arrived whole. Every program's body hashed to the hash the table names.

| Output | Files | Bytes of code |
|---|---|---|
| Alchemy's defaults | 6 code files and 4 source maps | 2,091,434 |
| `output: { codeSplitting: false, sourcemap: false }` | 1 file | 2,070,680 |
| The same, and `minify: false` | 1 file | 2,884,042 |

Time for one bundle: 1,490, 1,551 and 1,644 ms, median 1,551. Today's whole app build (programs,
window and brain, 3,170,431 bytes of brain) took 202, 207 and 300 ms. The two bundle different
entries, so only the order means anything: Alchemy minifies and writes source maps.

**The same bytes twice, in one mode.** Three bundles in a row gave the same bytes. So did two
launches from two different temp folders, so no path of the checkout is in the bytes.

**But not one build for two instances.** Two things differ:

- **The instance's name is in the bytes.** Alchemy's generated entry holds the stack and its stage
  as text (`Workers/Sources/Rolldown.ts`, `makeEffectVirtualEntry`). The same source bundled for
  `local` and for `cloud` differed at one place: `` stage:`local` `` against `` stage:`cloud` ``.
- **The local instance bundles in watch mode, and watch mode bundles differently.** With the same
  name and the same input, the entry file's bytes differed. The first difference is `bytes(e)<=cC`
  in watch mode against `bytes(e)<=2e6` in build mode: `alchemy/src/Bundle/Bundle.ts` sets
  `optimization.inlineConst` in `build` and not in `watch`. A deploy uses `build`.

**And the plugins do not reach the bundler on the local runtime.** With the plugins in the Worker's
`build` prop and the Worker started through `deploy`:

- No hook of either plugin was called: 0 builds, 0 files.
- The bundle was made without them, nothing failed at build time, and the Worker answered 500 with
  `Module not found: virtual:fabrika-built`.
- The cause, read in the source and fitting the run: Alchemy's local providers sit behind its RPC
  boundary, and `alchemy/src/Local/RpcSerialization.ts:340` turns every function in a resource's
  props into `null`. A plugin is an object of functions.
- Plain data does cross. With `build.input.resolve.alias` pointing the table's module name at
  files, the same Worker served the whole table on the local runtime, and the asset's hash held.
  That way gives 3 files at least, since each body becomes a text module of its own, and it has no
  place for the compiler plugin.

**What Node needs of a Worker file Alchemy bundles.** Node imports the file to plan the stack.

- A top-level `import ... from "virtual:fabrika-built"` fails on Node:
  `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
- A top-level import of a `.tsx` file fails on Node: `ERR_UNKNOWN_FILE_EXTENSION`.
- Both work as `import()` inside the `fetch` handler, which only workerd runs. By default that
  makes more chunks; `codeSplitting: false` folds them back into one file.
- Today's real brain entry reaches 662 modules and 0 `.tsx` files, so the compiler plugin has
  nothing to compile in the brain's own bundle.

**What did give one build.** Our build calls Alchemy's bundler once, with both plugins and a fixed
name in place of the instance's, and the stack runs that one file with `bundle: false`:

```ts
// bundle.ts, step 5. It ran: bundled as "shared", started as "local", the table was served.
const bundler = yield* WorkerBundle; // @alchemy.run/cloudflare/Workers/Sources/Rolldown
const one = yield* bundler.build({
  id: "BrainLike285",
  main: entry,
  compatibility,
  entry: { kind: "effect", exports: {} }, // Alchemy writes the bridge lines
  stack: { name: "spike285", stage: "shared" },
  extraOptions: {
    input: { plugins: [compiler(seen), embed(tables)] },
    output: { codeSplitting: false, sourcemap: false },
  },
});
// The stack: Cloudflare.Workers.Worker("BrainLike285", { main: file, bundle: false, ... })
```

One file, 2,070,681 bytes, the same bytes twice. Started under another name it answered 200 and
served the table. The hand-written bridge lines of `brain.ts` are not needed on this route: the
generated entry has them.

How the Worker reads its build input when Alchemy does bundle it. It ran: the props Effect was
given the provided value.

```ts
// build-input.ts: empty inside workerd, where nothing provides it.
export const BuildInput = Context.Reference<{ plugins?: ReadonlyArray<Plugin>; alias?: Record<string, string> }>(
  "experiments/285/BuildInput", { defaultValue: () => ({}) });

// brainlike.ts: the props are an Effect.
export default BrainLike.make(
  BuildInput.pipe(Effect.map((input) => ({ main: import.meta.url, build: { input: { /* from input */ } } }))),
  Effect.succeed({ fetch: /* ... */ }),
);

// the stack, on Node:
BrainLike.pipe(Effect.provide(brainlike.default), Effect.provideService(BuildInput, { alias }));
```

## 4. The ledger's laws on the Effect `transaction`

Three turns ran side by side in one real object (`turn.ts`).

```ts
// S: today's turn, the line of CloudflareSql.ts on main.
native.transactionSync(step);
// Sb: the plan's sketch. No raw handle.
state.storage.transaction(Effect.sync(step));
// St: the same, with the throw typed.
state.storage.transaction(Effect.try({ try: step, catch: (error) => error }));
```

**The ledger is the real one,** `LedgerSql.layer` from libfabrika, unchanged. On S it gets today's
driver. On Sb and St its own `sql.transaction` only runs the step, and the whole ledger call runs
as one plain synchronous step inside Alchemy's transaction. That is the turn S5 builds, with the
Effect boundary one call further out, so no product file changed.

| Law | Ran, saw |
|---|---|
| The same seeded calls give the same answers and the same rows on S, Sb and St | 3 seeds (119120, 7, 285) of 400 calls, on each build: the same on all three turns, every time |
| What the calls were, seed 119120 | 196 placed, 45 resent, 43 `id_reused`, 29 `seen_ahead`, 10 `bad_trace`, 16 planted storage failures, 34 reads, 27 waits |
| A storage failure late in a turn is a typed `storage`, writes nothing, and the next call works | 33 planted failures over the three seeds (a real trigger that aborts): the same on all three turns |
| Many requests append to one object at once, a third after a key read, a third after a timer | 6, 24 and 96 at once: all answered, all placed, revs and positions 1 to n with no gap, on all three turns |
| A step that commits, reads its own writes, writes 260 rows, returns `null` | the same on all three turns |
| A step that throws, and one that breaks a `UNIQUE` | all three roll back. S and St end in a typed failure. **Sb ends in a defect** |
| Keys and alarms through Alchemy's `state.storage`, no raw handle | put, get, delete, a put rolled back by a failed transaction, set, read and delete an alarm: all as expected |

**Time for one turn.** One append is one turn. Five runs of 1,000 after 200 to warm up, the median
run, in microseconds, with the lowest and the highest run.

| Turn | prebuilt | bundled |
|---|---|---|
| S | 91.3 (82.0 to 104.9) | 87.0 (81.1 to 88.7) |
| Sb | 184.7 (169.7 to 210.8) | 177.4 (174.1 to 218.6) |
| St | 174.4 (167.2 to 190.0) | 173.6 (167.3 to 194.5) |

About 90 microseconds more a turn, twice today's. Experiment 249 saw 76 against 171. `Effect.try`
costs nothing that shows.

## 5. What a call through the bridge costs

1,000 calls to one object, one after another inside one request, five times, after 200 to warm up.
An empty request (1.5 to 2.1 ms) is taken off. Microseconds a call: the median run, with the lowest
and the highest.

| Way | prebuilt | bundled |
|---|---|---|
| plain: a Promise stub to a plain class that runs its service through a runtime (today) | 29.9 (29.8 to 33.0) | cannot run there |
| stub: the same binding through `makeRpcStub`, to the bridge class (after S1) | 99.7 (93.9 to 121.7) | 93.9 (91.6 to 109.9) |
| sibling: taken in init with `.from(Host)`, to the bridge class (after S4) | 94.2 (87.6 to 130.0) | 92.7 (87.8 to 117.9) |

A call through the bridge costs about 64 microseconds more than a plain call, a little over three
times as much. The two callers of the bridge cost the same, and so do the two builds. The laptop was
busy (load average 15), so read the order and the size, not the digits.

## The source provider route

Added the same day, as a follow-up. The question: can our build plug into Alchemy the designed
way, in place of `bundle: false` beside it?

**The answer.** Yes, on the local runtime. A Worker's `source` prop names a module of ours.
Alchemy imports it, and the module builds the Worker with Alchemy's own bundler and our two
plugins. The plugins are made inside the module, so no function crosses Alchemy's local provider.
The Worker answered with the table and with one Durable Object. With a fixed name inside the
module, the bundle's bytes were the same under two stage names, in watch and in build, and across
two launches. About 85% sure it carries the real brain on the local instance. A real deploy was
not run.

The contract is in `@alchemy.run/cloudflare/src/Workers/Source.ts`: `SourceProvider`,
`WorkerSourceModule`, `loadSource` and `resolveSource`. The prop's type is `WorkerSourceDescriptor`
in `Workers/Worker.ts`. The script is `provider.ts`, the provider `table-source.ts`, and the Worker
it builds `sourced.ts`.

```ts
// provider.ts: the prop that worked. Every field is plain data.
Cloudflare.Workers.Worker("Sourced285", {
  source: {
    provider: pathToFileURL(/* table-source.ts */).href, // required: a module specifier
    devMode: "bundle", // required
    options: { main, tables, objects: ["Tally"], fixed: { name: "fabrika", stage: "one-build" } },
  },
  compatibility: { date: "2026-10-12" },
  dev: { host: "127.0.0.1" },
  env: { Tally: Cloudflare.DurableObject("Tally") }, // Alchemy finds a hosted class at env[<class name>]
});

// table-source.ts: the module. Its default export has `make`.
const make = (raw: unknown) =>
  Effect.gen(function* () {
    const options = yield* Schema.decodeUnknownEffect(Options)(raw).pipe(Effect.orDie);
    const bundler = yield* WorkerBundle;
    const bundled = (ctx) =>
      bundler.build({
        id: ctx.id,
        main: options.main,
        compatibility: ctx.compatibility,
        entry: { kind: "effect", exports: /* one { kind: "durableObject" } a class in options.objects */ },
        stack: options.fixed, // not ctx.stack: the instance's own name stays out of the bytes
        extraOptions: {
          input: { plugins: [compiler(seen), embed(tables)] },
          output: { codeSplitting: false, sourcemap: false },
        },
      });
    return {
      ownsAssets: false,
      build: (ctx) => bundled(ctx).pipe(Effect.map((bundle) => ({ bundle, assets: undefined, hash: { bundle: bundle.hash } }))),
      hash: (ctx) => bundled(ctx).pipe(Effect.map((bundle) => ({ bundle: bundle.hash }))),
      dev: (ctx) => Effect.sync(() => ({ mode: "bundle", bundles: /* one bundle now, one more a change */ })),
    } satisfies SourceProvider;
  });

export default { make };
```

| # | Question | Ran, saw |
|---|---|---|
| 1 | Is a module of ours loaded from the `source` prop? | Yes. `make` was called once a start. `provider` and `devMode` are the two required fields; `options` is ours. `source` cannot sit beside `main`, `script` or `vite` (`resolveSource` refuses that), so the entry file goes in `options` |
| 2 | Does the Worker answer, with the table module resolved? | Yes: 200, the real table's one program and one asset. The bundle is one file, 1,877,185 bytes |
| 2 | Is `hash` called, and what must it return? | Not on the local runtime: Alchemy called only `make` and `dev` there. `hash` and `build` are what a deploy calls. Called directly, `hash` returned `{ bundle: <the bundle's hash> }`, the same hash `build` puts in its own `hash.bundle` |
| 3 | One build for two instances? | Yes. Started as `local` and as `other`, `dev` made the same bundle. `build` called for `local` and for `cloud` gave the same bundle. The watch bundle and the build bundle were the same, since the provider calls `build` in both. Two launches from two temp folders gave the same bundle |
| 4 | Which `devMode`, and does a rebuild reach the Worker? | `bundle`: the host runs workerd and takes each bundle the provider's stream gives. The table file was changed while the Worker ran: the Worker served the new program 1,778 ms later, with no restart by hand. `server` is for a source that runs its own dev server, which we do not |
| 5 | One Durable Object class | Ran. `Tally` keeps a sum in its own SQLite. Two calls answered 2 and 4, under each stage name |

**What a provider must do, read from the contract and held by the run:**

- `make(options)` gets the prop's `options` as plain data and may use files, paths, child
  processes and a scope. Anything else it builds itself.
- `build` returns `{ bundle, assets, hash }`, where `bundle` is `{ files, hash }` as Alchemy's
  bundler gives it.
- `hash` returns the slots it uses, here `bundle` alone. It must be the same for the same bytes on
  any machine. If it has to build, it shares that build with `build` through `Artifacts.cached`.
  This provider builds twice; the real one should not.
- `dev` in bundle mode returns a stream of `Start`, `Success` and `Error` events.

**What it means for S8.** The stack would keep one Worker resource with `source` in place of
`main` and `bundle: false`. Our build becomes the provider: it makes the table and bundles the
brain in one place, Alchemy calls it, and `brain.ts` with its hand-written bridge lines can go.
The build's hash is the bundle's hash, the same on both instances. This is a new design call for
S8's plan, and it is not decided here.

**What this cannot tell us:**

- **A real deploy.** `build` and `hash` ran only when this script called them, with a context
  written by hand. Whether Alchemy's deploy calls them as read, and whether the state store keeps
  the prop as it is, was not run: it needs an account.
- **The real brain.** One object class ran, not four, and not `Control` or the tail listener.
- **An absolute path in the prop.** `provider`, `main` and `tables` were absolute paths of a temp
  folder here. The prop is kept in state, so the real one should name a package and relative
  paths. Not tried.
- **The fixed name at run time.** Alchemy's bridge reads the stack's name and stage from the
  bundle. Nothing in these probes used them. A piece of the brain that does would see the fixed
  name, not the instance's.
- **A rebuild when a source file changes.** The provider here watches only the table file.
- **The types.** As above, no type check ran.

## Where the plan is wrong

1. **"`Control` is its own Worker, which workerd never routes a public request to"** (Decided here).
   On the local runtime through Alchemy, a Worker of its own gets a public address and answers on
   it. It does not change the pick: the branch passed its rule.
2. **"Alchemy bundles `objects.ts` with our plugins handed in as build input"** (The shape, S8).
   On the local runtime the plugins are dropped in silence before they reach the bundler. And a
   Worker file Alchemy bundles cannot import the table module or a `.tsx` file at its top.
3. **`transaction: (step) => storage.transaction(Effect.sync(step))`** (The shape, S5). It runs,
   but a step that throws ends in a defect. Today's call sites catch a throw with `Effect.try`
   around the turn and make a typed `storage` of it. With the sketch as written they would not.

## What it means for the slices

- **S5.** Build the driver's turn with `Effect.try`, not `Effect.sync`, and give the `Sql`
  contract's turn a typed error. Then the 19 call sites keep their typed `storage`. The cost to
  expect is about 90 microseconds a turn. Law 9 as the plan words it, the suites' own drivers in
  the real instance, is still S5's to run: this spike compared turns, it did not run the suites.
  About 85% sure the route holds.
- **S7.** No change. The branch is the pick, in the shape above, and the default export of the
  built file is the one bridge line. The control socket drops its `entrypoint` line. Law 11's
  property is the 300-request run here, moved to a test. About 90% sure.
- **S8.** It cannot land as 0041 wrote it on beta.85. By the owner's answer in the plan,
  `bundle: false` stays as one marked edge. What the plan's S8 should now ask, as a new design call
  and not decided here: does our build call Alchemy's bundler once, as in step 5? That keeps one
  build for both instances, keeps both plugins, and lets `brain.ts` go. It ran for a Worker with no
  objects. A follow-up then ran the designed plug point, a Worker's `source` prop, with one object
  class: see [The source provider route](#the-source-provider-route), which is the better form of
  the same idea. The plugin drop is one bug we can show, with this run as its repro, so
  it is worth one upstream issue. None was filed here.
- **Every object slice, S1 to S4.** Expect about 64 microseconds more a call. Nothing here says it
  matters: a turn costs more than that.

## What this cannot tell us

- **Whether any of it works on Cloudflare.** Nothing was deployed. Alchemy's source says `props` on
  a binding are dropped on a real deploy for now. Whether a real deploy also drops plugin functions
  was not run: it needs an account.
- **Whether the types pass.** Experiment scripts are outside the type check, and none was run. The
  shapes ran; `tsc` has not seen them.
- **Whether the ledger's own test suites pass on the new turn.** They are vitest files on Node. The
  spike ran the real ledger store on a seeded workload and compared turns. The other stores
  (sessions, the gateway store, recovery, the process store, the sinks) were not run.
- **Whether the one-bundle route carries objects.** Step 5 ran with `exports: {}`.
- **Whether a table import in the Worker's init, not its handler, breaks the plan on Node.** Only
  the handler was tried.
- **An Effect `fetch` beside the tail listener** that `objects.ts` registers today. Not run: a
  probe cannot make a tail event.
- **Whether beta.86 changes an answer.** It was not installed.
- **The timings on a quiet machine.** The load average was 5 to 15 during the runs.
- **Why the plugins are dropped,** past a read. The run shows no hook was called and that plain
  data crossed. The line in `RpcSerialization.ts` fits, and was not proven by a patch.

## Wrong first tries, kept

- **A parameter property in a probe class.** Node 26 runs TypeScript by stripping types only, so
  the file did not load. The flag that would transform it is gone in this Node.
- **Reading the plugin drop as a mistake in how the props were handed over.** Two more ways were
  tried, a plain holder filled before the deploy and plugins made as class instances. Neither was
  called. The props Effect had the plugins all along; they are lost later.
- **A random `upgrade` header in the 300 requests.** Node refused to send 54 of them. The header
  was taken out, and all 300 are sent now.

## Running it

```sh
# One script a run; each starts and stops its own runtime. About 15 s each, `bundle` about 30 s.
( ulimit -u 2000; nice -n 19 volta run --node 26.13.0 \
    node experiments/285-alchemy-port-spike/launch.mjs fetch )   # or control, bundle, storage, timing, provider
```

Run `bundle` or `provider` twice to compare bytes across two launches: the second reads the first's
saved hashes.
