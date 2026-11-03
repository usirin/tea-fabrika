# 171. Can the app host run the ledger as Alchemy's local stage, instead of our own twin?

Yes. The ledger server's own Alchemy stack runs at its local stage from a
running Effect program: no command-line tool, no account, no connection off the
laptop. It answers on a fixed port on 127.0.0.1 with the same Worker, the same
two Durable Objects and the same bindings as the cloud. Its data survives a
stop and a crash. It makes one child, `workerd`, in our process group, and no
bundler process at all. The bytes it runs are the bytes a deploy would upload.

It costs start time and memory. From a built bundle it is 1.2 to 1.4 s to
first answer (one Electron round 2.0 s) and about 395 MB, where today's
Miniflare twin is 0.3 to 0.4 s and about 285 MB, under Node and Electron alike.
Most of the extra is loading Alchemy itself (about 1 s). A killed workerd comes back behind the same URL in
0.3 to 0.5 s, by Alchemy's own code.

```ts
// Sketch of the whole idea (the harness's `twinStack` and `twin.ts`, shortened):
// the cloud's Worker resource, one dev block, deployed at stage "local".
const twin = Alchemy.Stack("fabrika-tf-exp-171", {providers: Cloudflare.providers(), state: Alchemy.localState()},
	Effect.gen(function* () {
		const worker = yield* Cloudflare.Worker("Ledger", {
			main: "dist/ledger.mjs", bundle: false,               // built once, served byte for byte
			compatibility: {date: COMPATIBILITY_DATE},
			dev: {host: "127.0.0.1", port: 18787, strictPort: true},
			env: {LEDGER: Cloudflare.DurableObject("Ledger"), JOB_RECORD: Cloudflare.DurableObject("JobRecord"),
				...ledgerBindings({door: {kind: "local", person: "owner", secret}})},
		});
		return {url: worker.url};
	}));

const scope = yield* Scope.make();
const {url} = yield* deploy({stack: twin, stage: "local", dev: true, scope}).pipe(
	Effect.provide(engine), // AlchemyContext {dotAlchemy: "<app home>/.alchemy"}, ArtifactStore, non-interactive
);
// url: "http://localhost:18787" (the socket is 127.0.0.1). Closing `scope` stops workerd.
```

**Lean:** move the app host's twin to Alchemy's local stage, with a Worker file
built at app build time (`bundle: false`), Alchemy and Effect shipped beside the
host bundle, and our own thin wrapper for the parts Alchemy does not do (die
with the parent, the memory cap). Keep tests on Miniflare in-process for now.
Why, cost and confidence are in [the lean](#the-lean).

Who did what: everything named Alchemy below is Alchemy 2.0.0-beta.84's code
(`alchemy`, `@alchemy.run/cloudflare`, `@alchemy.run/cloudflare-runtime`),
unchanged. Ours is only the harness in `experiments/171-alchemy-local-twin/`:
`twinStack` (the Worker resource with a local door and a dev port), the engine
Layer, a one-line parent watch, and the driver that measures. No code in
`packages/` or `apps/` changed. Nothing was deployed, no `alchemy plan` ran, and
no Cloudflare credential was in the environment (the driver refuses to start if
one is).

## How it was run

- `experiments/171-alchemy-local-twin.ts` is the driver. It uses Node built-ins
  only, works in a temp folder, starts every child with `nice -n 15` in a
  process group of its own, and at the end lists what it started and checks
  that none is left.
- `171-alchemy-local-twin/twin.ts` is one twin: it deploys a stack at stage
  `local` from code, prints a ready line, and serves until SIGTERM.
- `stack.ts` holds `twinStack` and re-exports `ledgerStack` from
  `@kampus/ledger-server/stack`, as it is.
- `bytes.ts` asks Alchemy's own bundler for the deploy build and the local
  build of the ledger, side by side.
- `inproc.ts` runs Miniflare and Alchemy inside one Node process, as a test
  would.
- `client.ts` talks to a twin through the door with `layerHttp`, as the host
  does.
- Today's twin is `packages/fabrika/src/host/daemon.ts` (Miniflare in a child),
  started the way `local.ts` starts it.
- A small workspace package (`experiments/171-alchemy-local-twin/package.json`)
  holds the harness, so it imports the ledger server by name. It pins
  `workerd` and `rolldown` to the versions Alchemy uses, so a bundle that keeps
  Alchemy outside can find them.

```sh
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u CF_API_TOKEN -u CF_ACCOUNT_ID \
	EXP_ROUNDS=3 nice -n 15 node experiments/171-alchemy-local-twin.ts   # parts: bytes tree supervise timing tests
```

Results: `experiments/results/171-alchemy-local-twin.json`.

Machine: Apple M2 Max, 96 GB, macOS 14.3. Node 26.12.0, Electron 45.0.0 (run as
Node with `ELECTRON_RUN_AS_NODE=1`). Alchemy's workerd is 1.20261012.1;
Miniflare's is 1.20260730.1.

## 1. It answers from code, with no account and no network

Both stacks came up at stage `local` from a running program:

- `ledgerStack` as the ledger server has it (the shared door) on its default
  port 1337. It answers 401 with no credential, the door working.
- `twinStack` (the local door) on our fixed port. Five facts written and read
  back through `layerHttp` with the twin's secret; 401 without it.

```ts
// twin.ts: what `deploy` asks of its caller (experiment 147), with `.alchemy/` named.
const engine = Layer.mergeAll(
	Layer.succeed(AlchemyContext, {dotAlchemy: join(home, ".alchemy"), dev: true, adopt: false}),
	Layer.succeed(ArtifactStore, createArtifactStore()),
	Interaction.layerNonInteractive(),
).pipe(Layer.provideMerge(NodeServices));
```

| Check | Source entry | Prebuilt file | `ledgerStack` as is |
|---|---|---|---|
| Ready, from process start | 1,155 ms | 1,155 ms | 1,171 ms |
| Facts written, read back | 5 of 5 | 5 of 5 | (shared door, not written) |
| No credential | 401 | 401 | 401 |
| Connections the Node process opened | 127.0.0.1 only | 127.0.0.1 only | 127.0.0.1 only |
| workerd listens on | 127.0.0.1 | 127.0.0.1 | 127.0.0.1 and ::1 |

- **Same bindings as the cloud.** workerd got `LEDGER`, `JOB_RECORD`, `DOOR`,
  `KEYS`, `FOUNDER`, `EXPIRY_GRACE_MS` (from `ledgerBindings`), plus five that
  Alchemy adds on both paths: `ALCHEMY_PHASE`, `ALCHEMY_WORKER_NAME`,
  `ALCHEMY_STACK_NAME`, `ALCHEMY_STAGE`, `ALCHEMY_CLOUDFLARE_ACCOUNT_ID`. The
  last one is empty here. The ledger reads none of the five.
- **Net:** a watch on every socket the Node process opened (experiment 147's
  `net-watch.ts`) saw only 127.0.0.1. `DO_NOT_TRACK=1` was set, as in 147, so
  this does not show what Alchemy would send without it. The host should set it
  too.
- The URL Alchemy hands back says `localhost`, not `127.0.0.1`, even with
  `host: "127.0.0.1"`. It resolves to the same socket here. The host should use
  the address it asked for, not the returned string.

## 2. The process tree: one workerd, no bundler, no zombie

```text
node twin.ts       pid A, pgid A   RSS 618 MB (source entry) / 394 MB (prebuilt)
 └ workerd serve   pid B, pgid A   RSS 49 MB
```

- workerd is a plain child of our Node (`@alchemy.run/cloudflare-runtime`'s
  `Workerd.ts`, `spawn`, not detached), so it sits in our process group.
- **No bundler process.** Alchemy bundles with rolldown, which runs inside
  Node as native code. Today's twin keeps an esbuild service process alive
  beside it in every round below: 111 to 124 MB from source, 48 to 50 MB from
  the built bundle. That is the leftover PR
  [193](https://github.com/usirin/tea-fabrika/pull/193) is about.
- **No zombie.** After a SIGTERM the group was empty within 3 s in every round.
- **The relay is in Node.** Alchemy puts a small TCP relay (its `WorkerProxy`)
  in our Node on the fixed port, and workerd on a port of its own behind it.
  That is how the URL stays put when workerd is replaced (part 3). It also
  means workerd alone is unreachable when our Node dies.
- **Node is big.** Most of the 394 MB is Alchemy and Effect loaded. With the
  source entry, rolldown's watch adds about 225 MB more.

## 3. Supervision: Alchemy restarts workerd, we do the rest

| What we did | What happened | Facts after |
|---|---|---|
| SIGTERM the group, start again | Group empty; up again in 1,438 ms, same port | 10 of 10 |
| SIGKILL our Node only | workerd left, now a child of launchd, unreachable (the relay died with Node) | |
| ... then SIGKILL the group, start again | Nothing left; up in 1,255 ms, same port | 15 of 15 |
| SIGKILL workerd only | **Alchemy started a new workerd** behind the same URL; door answers again in 292 ms (502 meanwhile) | 15 of 15 |
| SIGTERM workerd only | Same: new workerd, door again in 539 ms | 15 of 15 |
| Memory cap (set at 1 MB to force it): group restart | Up in 1,743 ms, door 350 ms later, same URL | 15 of 15 |
| SIGKILL the parent (a stand-in host), no guard | Twin keeps serving, orphaned | |
| SIGKILL the parent, with our one-line guard | Twin closes its scope; group gone in 306 ms | |

- **Read workerd's memory:** yes, from `ps` by pid, as today's daemon does. It
  is 49 to 56 MB idle. The cap should count workerd (where the Durable
  Objects grow) and the Node relay separately: Node's 340 MB is fixed cost.
- **Restart past a cap:** two ways, both keep the URL and the data. Kill
  workerd and Alchemy brings it back in about 0.3 to 0.5 s, our Node staying
  up. Or stop the whole group and start again, about 1.3 to 1.8 s. During a
  workerd restart the relay answers 502, so the host's client must retry on
  502 as it does on a refused connection.
- **Die when the parent dies:** Alchemy does not do it. Our wrapper does, the
  way `daemon.ts` does today: watch `process.ppid` every 250 ms, and on a
  change close the deploy scope. Closing the scope stops workerd.
- **Kill -9 of our Node** orphans workerd. The host must stop the twin by
  group (`kill(-pgid)`), never by pid. Today's `local.ts` already does.
- **Does it fight Alchemy state?** No. Every restart above found its own
  `state/.../Ledger.json`, saw nothing to change, and served the same SQLite.
  A start after a SIGKILL needed no cleanup.

The thinnest wrapper, all of it ours:

```ts
// In the child (twin.ts), after deploy: stop when the parent is gone.
const owner = process.ppid;
setInterval(() => { if (process.ppid !== owner) stop(); }, 250).unref();
// stop = close the deploy scope (workerd stops), then exit.

// In the host (local.ts today): start detached, so the child has its own group,
// and stop by group: process.kill(-child.pid, "SIGTERM"), SIGKILL after 3 s.
// The cap: read workerd's RSS by pid from ps; past the cap, kill workerd
// (Alchemy restarts it) or restart the group.
```

## 4. Start time and memory: about 0.9 s and 110 MB more than today

Three rounds of each, cold (a fresh home, nothing deployed) and warm (the same
home again). The OS file cache was warm in both. "Bundle" is the host's own
build, made with `apps/fabrika`'s esbuild options into `dist/twin.mjs` and
`dist/daemon.mjs`. "First answer" is from process start to the door's first
401. Memory is the whole process group's RSS after that answer.

| Twin, runtime, from | First answer | Group RSS | By process | Ping p50 |
|---|---|---|---|---|
| Alchemy, Node, bundle | 1.24 to 1.35 s | 392 to 398 MB | node 339, workerd 54 | 0.63 to 0.74 ms |
| Alchemy, Electron, bundle | 1.23 to 1.97 s | 396 to 421 MB | Electron 342 to 363, workerd 55 | 0.60 to 0.93 ms |
| Alchemy, Node, source | 1.54 to 1.59 s | 660 to 674 MB | node 608 to 622, workerd 53 | 0.53 to 0.59 ms |
| Alchemy, Electron, source | 1.47 to 1.55 s | 634 to 645 MB | Electron 580 to 592, workerd 53 | 0.54 to 0.60 ms |
| Today, Node, bundle | 0.32 to 0.35 s | 284 to 293 MB | node 177, esbuild 50, workerd 62 | 0.41 to 0.44 ms |
| Today, Electron, bundle | 0.36 to 0.40 s | 273 to 279 MB | Electron 163, esbuild 50, workerd 63 | 0.37 to 0.74 ms |
| Today, Node, source | 0.41 to 0.53 s | 403 to 412 MB | node 229, esbuild 116, workerd 62 | 0.33 to 0.37 ms |
| Today, Electron, source | 0.48 to 0.75 s | 378 to 388 MB | Electron 203, esbuild 120, workerd 60 | 0.36 to 0.99 ms |

- **Where Alchemy's time goes:** loading it. The imports alone take 1.06 to
  1.08 s in the twin (`importMs`); the deploy itself is about 0.1 s, and the
  first answer comes 0.1 s after that. Cold and warm are the same: the local
  deploy does the same work either way.
- **Where its memory goes:** the Node side, 339 MB against today's 177. workerd
  is about the same in both (54 against 62 MB). From source, rolldown and its
  watch add about 225 to 280 MB more.
- **Electron as Node** behaves like Node, within the noise. One Electron round
  was slow (1.97 s); we did not find why.
- **Ping** (`readLast` through the door, 200 calls): Alchemy's relay in Node
  adds about 0.25 ms per call over today's direct socket.
- **Bundling Alchemy into the host bundle does not work today.** esbuild could
  not resolve its platform branches (Bun, `cloudflare:*`, Vite), and once
  forced, the bundle failed at run time looking for `workerd`, then `rolldown`,
  then `vite` by package name. The working bundle keeps `alchemy`,
  `@alchemy.run/*`, `effect` and `@effect/*` outside, so the app must ship them
  in `node_modules` beside `host.mjs`, with `workerd` at Alchemy's version.
  Alchemy loads rolldown lazily (`import("rolldown")`), so with `bundle: false`
  it may not be needed at run time. We shipped it anyway and did not try
  without it.

## 5. The same bytes as the cloud

`bytes.ts` called Alchemy's own Worker bundler twice with the options the
Worker provider builds: once with `build` (what `deploy` to Cloudflare calls in
`prepareBundle`) and once with `watch` (what the local provider calls). No
deploy and no credentials: the bundler is a local function.

| Build | Entry file | Entry bytes | Entry sha256 | All files hash |
|---|---|---|---|---|
| Cloud deploy path (`build`) | `durable-object.js` | 268,897 | `4c99ce22...` | `a607dbd7...` |
| Local path (`watch`, first result) | `durable-object.js` | 268,897 | `4c99ce22...` | `a607dbd7...` |
| What workerd got, source entry | `durable-object.js` | 268,897 | `4c99ce22...` | |
| What workerd got, prebuilt file | `durable-object.js` | 268,897 | `4c99ce22...` | |
| Today's twin (our esbuild) | one module | 978,829 | `453f08d6...` | |

- The deploy build and the local build are the same bytes, to the hash. Both
  go through one `makeOptions`; in Alchemy's code they differ by one
  optimization setting, which made no difference to this entry.
- **What workerd ran** (from `WORKERD_DUMP_CONFIG`, Alchemy's own switch) is
  that same entry, in both modes.
- **A no-bundle option exists:** `bundle: false` with `main` a built file.
  Alchemy reads the file (and any `.js`/`.mjs` beside it) as it is and serves
  it byte for byte. This is what a packaged app wants: build the Worker once at
  app build time with Alchemy's bundler, ship the file, serve it.
- **Today's twin runs different bytes** from the cloud: our esbuild bundle,
  unminified, 3.6 times the size. Same source, not the same code.

What this cannot show: the bytes Cloudflare stores after upload. Alchemy
uploads `bundle.files` as they are, by its code; we did not watch an upload.

## 6. Where the data lives, and it survives

Everything sits under the one folder named in `AlchemyContext.dotAlchemy`. Here
it was the temp home's `.alchemy/`:

```text
.alchemy/
  state/fabrika-tf-exp-171/local/Ledger.json      Alchemy's record of the Worker (2,964 B)
  local/tf-exp-171-Ledger/<hash>.sqlite           the LEDGER Durable Object's SQLite
  local/tf-exp-171-JobRecord/metadata.sqlite      the JOB_RECORD namespace
  bundles/fabrika-tf-exp-171-local-Ledger/        the local build (source entry only)
```

- Facts survived a clean stop and start, a crash (SIGKILL of the group), a
  workerd kill and a cap restart: the same row count and row hash every time
  (part 3's table).
- `ALCHEMY_HOME` (Alchemy's user folder) was pointed at the temp home too. It
  stayed empty: a local deploy writes nothing there.
- The state file holds the Worker's props. For the local door that is the
  person and `LOCAL_SECRET_HASH`, a hash of the secret, never the secret: we
  counted the secret's prefix in the file (0) without printing it. Keep
  `.alchemy/` in the app home all the same, never synced.
- The SQLite file name is a hash of the object's id. Moving data in from
  today's `ledger.sqlite` stays an import through the door (the plan below);
  copying files from today's Miniflare folder was not tried.

## 7. Tests: keep Miniflare, feed it Alchemy's Worker file

`inproc.ts` loads each once in one Node process, as a test file would, and
starts the ledger again and again.

| In one process | Start to first answer | Stop | Notes |
|---|---|---|---|
| Miniflare (`new Miniflare(ledgerOptions(...))`), 5 rounds | 134 to 200 ms | | as the 6 test files that run it in-process do today |
| Alchemy local, a new port each time, 3 rounds | 87 to 94 ms | 22 to 25 ms | workerd gone after each stop |
| Alchemy local, the same port again | 159 ms the first time | 23 ms | **the second and third failed**: "Could not bind to port (already in use)" |
| Alchemy, two stacks at once, each its own `.alchemy/` | 33 ms to both deployed | | 3 rows and 7 rows, each kept apart |

- **Time is not the reason to move or stay.** Both start in well under a
  quarter of a second inside a test.
- **The same port cannot be used twice in one process.** Alchemy's relay
  belongs to the provider, not to our deploy scope, so closing our scope stops
  workerd but keeps the port taken. A test that restarts a twin "on the same
  URL" would need a new port, or a new process.
- **Two stacks in one process work**, each with its own `AlchemyContext`. The
  ledger server's README says Alchemy "reads its working folder once, at
  import, so one test process cannot run two stacks". That is true of the
  command-line path; from code, with the folder given as a Layer, it is not.
- **Miniflare's `outboundService`** lets a test answer the Worker's GitHub
  calls with a fake (`door-wire.test.ts`, `door-wire.laws.test.ts`). We found
  nothing like it in Alchemy's local provider. That alone keeps the GitHub-door
  tests on Miniflare.

**Lean:** tests stay on Miniflare, but Miniflare runs the Worker file Alchemy
built, not our esbuild bundle, so tests and the app and the cloud run one set of
bytes. Why: it keeps the fake GitHub and costs no test time, and it closes the
bytes gap, which is the real difference. Cost: `worker-options.ts` takes a
built file in place of its own `buildSync`, and the test setup builds it once
(about 0.3 s, part 5). Confidence 70%: we did not run the test suite on
Alchemy's file; a Worker built by rolldown may need a module rule Miniflare
does not set today.

## The lean

**Move the app host's twin to Alchemy's local stage**, with:

- the Worker built once at app build time by Alchemy's own bundler, shipped as a
  file, and served with `bundle: false`;
- `alchemy`, `@alchemy.run/*`, `effect` and `workerd` in the app's
  `node_modules`, not in `host.mjs`;
- `.alchemy/` in the app home, named through `AlchemyContext`;
- our thin wrapper: a child process in its own group, a ppid guard that closes
  the deploy scope, stop by group, and the memory cap on workerd's RSS.

Why:

- It is the [local is the cloud](../docs/direction/local-is-the-cloud.md)
  direction made real: one stack definition, one Worker file, one set of
  bytes, local and cloud one stage apart.
- It removes our own bundle path at run time, and with it the esbuild
  process PR [193](https://github.com/usirin/tea-fabrika/pull/193) chases.
- Alchemy already restarts a dead workerd behind the same URL, which is most
  of what the cap needs.
- It answers the ledger half of open question 1 in
  [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md)
  ("laptop host: workerd, or Node for now?"): the ledger can run as the same
  Alchemy stack on the laptop, with a cap and a restart. The host half, the
  whole `Host` Durable Object in workerd for a day, is that note's own
  experiment and is not touched here.

What it costs:

- About 0.9 s more to start (1.2 to 1.4 s against 0.3 to 0.4 s) and about
  110 MB more (395 MB against 285). The host starts its twin once, in the
  background, so a person sees it only on the first answer after launch.
- About 0.25 ms more per ledger call, through Alchemy's relay.
- Dependence on a beta: Alchemy 2.0.0-beta.84. The harness uses paths like
  `alchemy/Deploy` and `alchemy/AlchemyContext`; a later beta may move them.
- Code: `daemon.ts` (62 lines) and the bundle half of `worker-options.ts`
  (159) go; a twin child of about 90 lines (like `twin.ts`) and a stack of
  about 50 (like `stack.ts`) come in. `local.ts` (354) keeps its start, stop
  and supervision, pointed at the new child. About 4 agent hours with tests.

Confidence 70%. The doubts, and what would settle each:

- A packaged app (Electron's app folder, workerd's binary inside it) was not
  tried; only a built `host.mjs` run from the repo. A packaged build started
  on a clean account settles it.
- What Alchemy does when workerd keeps dying (a crash loop) was not tried: one
  kill, one restart. Killing it ten times in a row settles it.
- The 0.9 s and 110 MB are one laptop, idle. A day of real use with the app
  settles whether anyone notices.

## Tracker ticket 88, re-planned on this base

Ticket 88 on the project's own tracker is "The app host runs the twin, losing
nothing". Today's plan for it, and
what this experiment does to each step:

| Step | On Alchemy's local stage |
|---|---|
| The cap counts workerd (PR 193) | **Changes.** workerd is our direct child: read its RSS by pid. Past the cap, kill workerd and let Alchemy restart it (0.3 to 0.5 s, same URL); restart the group if that fails. The client retries on 502. PR 193's esbuild half **vanishes**: there is no esbuild at run time. Close 193 if this lean is taken. |
| A named runtime | **Unchanged.** Electron as Node runs Alchemy the same as Node. |
| Packaging | **Changes.** Ship the Worker file built by Alchemy's bundler, plus `alchemy`, `@alchemy.run/*`, `effect` and `workerd` in `node_modules`. Drop `miniflare` and `esbuild` from the app. |
| Local import into an empty ledger, one transaction | **Unchanged.** Same Worker, same door. |
| Per-stream count and row hash, both ways, dry run | **Unchanged.** |
| Per-agent tokens from the local door | **Unchanged.** `ledgerBindings` is the same. |
| tsh traces through `recordsHttp` | **Unchanged.** |
| A third `hostLedger` branch behind a marker | **Changes.** The branch starts Alchemy's local stage, with its data in `<app home>/.alchemy/`. The marker rule, renaming it to go back, and never moving or deleting `ledger.sqlite` all stay. |
| Real home only after a dry run, numbers and the owner's yes | **Unchanged.** |

New steps:

1. **One Worker file.** Build it with Alchemy's bundler at app build time, and a
   test that its entry hash equals the deploy build's (`bytes.ts`, made a
   test). Tests feed Miniflare the same file (part 7).
2. **The twin child.** Deploy at stage `local` from code: `AlchemyContext`
   in the app home, `DO_NOT_TRACK=1`, a fixed port with `strictPort`, the ppid
   guard. The host uses the address it asked for, not the returned
   `localhost` string.
3. **Pin versions.** One copy of `alchemy` in the tree (a peer mismatch on
   `@types/node` made a second one here), and `workerd` at Alchemy's version,
   which is not Miniflare's.
4. **A crash-loop limit.** Measure what Alchemy does on repeated workerd
   deaths; past a few, the host stops the twin and says so.
5. **Fix the ledger server's README** on "one test process cannot run two
   stacks" (part 7).

## New names

- `twinStack`: the ledger's Worker resource with the local door and a dev
  port, the twin's stack.
- The relay: Alchemy's `WorkerProxy`, the TCP forwarder in our Node that
  holds the URL. Its own word, said plainly.
- The guard: the ppid watch in the child.
- Prebuilt file: a Worker file built before and served with `bundle: false`,
  Alchemy's own "prebuilt" source kind.

## What started and what is left

The last full run started 59 processes, each in a group of its own. At the end
none was alive and no group of ours had a member (`aliveAtEnd: 0`,
`inOurGroups: []`). The temp folders were removed. Nothing was deployed.

## What this cannot tell us

- **The packaged app.** Everything ran from the repo: a built `host.mjs`
  with Alchemy in the workspace's `node_modules`. Inside Electron's app folder
  the paths, the signing of the workerd binary and the size are untested.
- **The cloud side of the bytes.** We showed Alchemy's deploy build equals its
  local build. We did not upload, so not what Cloudflare stores.
- **Repeated workerd deaths.** One SIGKILL and one SIGTERM, each restarted. A
  crash loop, or a workerd that hangs instead of dying, was not tried. A hang
  would not be restarted by Alchemy; only the cap or a health check would see
  it.
- **Load.** One writer, 200 pings, tens of rows. Neither twin was pushed to
  its memory cap by real data: the cap was forced by setting it at 1 MB.
- **Alchemy's later betas.** This is beta.84. The paths and the relay's
  ownership may change.
- **The tests on Alchemy's Worker file.** Part 7's lean, feeding Miniflare
  that file, was not run.
- **The 502 window.** During a workerd restart the relay answered 502 for
  0.3 to 0.5 s. We did not check that today's `layerHttp` client retries on a
  502; it may report the ledger as down.
