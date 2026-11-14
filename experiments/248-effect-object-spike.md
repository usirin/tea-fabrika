---
date: "2026-11-10"
scripts: "none"
summary: "`next/`, ticket 502's spike for decision 0041, run on `@alchemy.run/cloudflare` 2.0.0-beta.84 in local workerd, no deploy, no model, $0. Yes, one object at a time: the stack stays `bundle: false`, and the built file exports Alchemy's bridge class for each Effect object while `Project`, `Process`, `Gateway`, `Control` and `fetch` stay plain. Four changes: `node:` external and Alchemy's runtime flag in our build, each chunk its own file (two files, 3.0 MB against 1.5 MB), a binding named after the class, and Alchemy's stub for callers not ported yet. 124 existing tests pass unchanged, the twin check has 0 findings, and the service and its Node laws did not change. `transactionSync` works through `state.raw`, an alarm fired once and retried after an abort, a hibernated socket kept its attachment and tags. A sibling object cannot be resolved inside a method (`Service not found`); the run first called that a bug and patched it, which was wrong. Corrected 2026-11-10: with no patch, on beta.84 and beta.85, `Sibling.from(Host)` in the Layer's init returned through both objects in 6 of 6 runs, Alchemy's documented way. `RpcCallError` is not in the stub's type. Code on `fabrikalfa/t502-spike`. Not run: a deploy, a type check of the `.from(Host)` shape, the mutation step, the real `Gateway`, `Process` and `Project`"
---

# 248. Does `RecordPart` run as an Alchemy Effect Durable Object, beside the plain classes?

Run 2026-11-09 and 2026-11-10 on origin/main at `d7484976`. **All claims are about `next/`.** This
is the spike that ticket 502's plan starts with, for decision
[0041](../.decisions/0041-object-classes-are-effect-objects.md). It ports `RecordPart` for real, adds throwaway probe objects, and runs every question
on the installed `@alchemy.run/cloudflare` 2.0.0-beta.84 with a local workerd. No deploy, no model
called by a script, $0. The code is on the branch `fabrikalfa/t502-spike` (`f1a8d0d4`), which is
never merged. Its saved outputs are under `next/apps/fabrika/spike/out/` there, and the numbers
quoted here are in [`results/248-effect-object-spike.json`](./results/248-effect-object-spike.json).

**The answer.** Yes, and one object at a time. The stack stays `bundle: false` with our own Rolldown
build. An Effect object is registered when the built file itself exports Alchemy's bridge class for
it. `Project`, `Process`, `Gateway`, `Control` and the default `fetch` stayed plain in the same
file, the real local stage started and served, and 124 existing tests passed with no test changed.
Four things had to change to get there, listed under question 1. One Alchemy bug was found by
running: an object cannot resolve a sibling object inside a method, so two objects that call each
other do not work until a 40-line local patch.

**Wrong, corrected 2026-11-10:** the last sentence. It is not a bug we can show, and no patch is
needed. Alchemy's documented way, `Sibling.from(Host)` in the Layer's init, ran unpatched. The
wrong finding is kept below, marked where it stands; see [Correction](#correction-2026-11-10).

```ts
// next/apps/fabrika/src/objects.ts on the spike branch. Real code, it ran.
// 1. The class is only a name and a contract.
export class RecordPart extends Cloudflare.DurableObject<RecordPart, RecordShape>()("RecordPart") {}

// 2. The Layer is the whole shell: pick up the platform's handles, hand them to the plain service.
export const RecordPartLive = RecordPart.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState; // outer: the reference only
		const env = (yield* Cloudflare.WorkerEnvironment) as unknown as Env;
		const ctx = state.raw as unknown as DurableObjectState; // the service takes the platform's state, as on main
		const bytes = settings(env).pipe(Effect.map((s) => s.limits?.recordBytes));
		return Effect.succeed({
			write: (chain, at, rows) => Effect.flatMap(bytes, (cap) => recordWrite(ctx, cap, chain, at, rows)),
			read: (chain, at, after) => Effect.flatMap(bytes, (cap) => recordRead(ctx, cap, chain, at, after)),
			content: (chain, at, id) => Effect.flatMap(bytes, (cap) => recordContent(ctx, cap, chain, at, id)),
			deleteContent: (chain, at, id, by) =>
				Effect.flatMap(bytes, (cap) => recordDelete(ctx, cap, chain, at, id, by)),
		} satisfies RecordShape);
	}),
);

// 3. The host: an Effect Worker that only carries the object Layers.
export class Brain extends Cloudflare.Worker<Brain, {}>()("Brain") {}
export default Brain.make({main: import.meta.url}, Effect.void.pipe(Effect.provide(RecordPartLive)));

// next/apps/fabrika/src/brain.ts. The built file exports the class, since the stack is `bundle: false`.
const Bridge = makeDurableObjectBridge(DurableObject, {entrypoint: objects, stack: {name: "fabrika", stage: "local"}});
export class RecordPart extends Bridge("RecordPart") {}
```

`workers/record.ts`, the service, is unchanged. The plain `RecordPart` class with its four edge
comments is gone.

## The eight questions

"Ran" means a run on beta.84 in local workerd. Each probe ran twice: once in a Worker that Alchemy
bundles, once in a `bundle: false` Worker built by our own Rolldown call. The answers were the same
in both unless a row says otherwise.

| # | Question | Ran, saw |
|---|---|---|
| 1 | What registers the object when the stack is `bundle: false`? One at a time? | Ran. The built file exports `class X extends makeDurableObjectBridge(DurableObject, meta)("X")`, and `meta.entrypoint` is an Effect Worker Layer that provides `XLive`. A plain `DurableObject` class, a plain `WorkerEntrypoint` and a plain default `fetch` sat beside it and answered. Four changes were needed, below. One object at a time works |
| 2 | Storage: `sql.exec`, and what is lost without `transactionSync` | Ran. `state.storage.sql.exec` and `databaseSize` work. `state.raw.storage.transactionSync` works under the bridge: two inserts and a throw left the count at 3, before and after. The wrapper's Effect `transaction` also rolled back on a typed failure. The ledger keeps its one synchronous transaction through `state.raw`; nothing is lost |
| 3 | Alarms beside the bridge's own alarm pass | Ran. Set for +600 ms, read back, fired once 4 ms after its time. `deleteAlarm` stopped it. An abort inside the alarm gave one retry on a new instance with `retryCount` 1. The bridge's pass made no table: only ours and workerd's `_cf_METADATA` were there. The Process wire laws were not run on a ported `Process` |
| 4 | Hibernation through `Cloudflare.upgrade()` | Ran. After 12.5 s idle the object was a new instance. The attachment survived the wake (`n` went 1 to 2 across it), the tags were read back, `getWebSockets(tag)` found the socket and a ring reached it, and the auto-response answered `pong`. A new wrapper per event loses nothing, since the state is on the raw socket |
| 5 | A typed call between two objects, sibling resolved per call | Ran, failed, patched, passed. Unpatched: `Service not found: Pong`. With the patch, `Ping.hit -> Pong.back -> Ping.leaf` returned through both. Both objects resolving each other in the outer Effect failed at plan in 2.3 s with 368 MB peak: no out-of-memory on beta.84, it just does not compose. **Wrong that a patch is needed:** `Pong.from(Host)` in the outer Effect composes and ran unpatched ([Correction](#correction-2026-11-10)) |
| 6 | `RpcCallError` in the stub's type; binding `props` | Ran for the type: no. `tsc` gives the stub's error as `Boom` only, yet a missing method, a defect in the callee and a value that cannot be cloned all arrived as a failed `RpcCallError`. Props: the local stage's plain `Control` still read its token from `ctx.props` beside the bridge (the stage laws pass). Binding props on a deployed Worker could not run: no deploy |
| 7 | The local stage and `exam/twin.ts` | Ran. The stage started on its fixed port and served; the brain's own spans went through the Effect `RecordPart` and were read back. `local-stage.test.ts` and `stage-records.test.ts`: 12 of 12. `brain-life`, `stage-wire` and `exam/twin.test.ts` among 112 more: all pass. `pnpm lint:twin`: 0 findings. A stack that yields a class-form Worker: 2 findings, it fails closed |
| 8 | The logic stays in a plain service a Node law reaches | Ran. `data/record-part.test.ts`, `data/p12-readers.laws.test.ts` and `node/stage-secrets.laws.test.ts` pass unchanged, and `git diff` on `workers/record.ts` and `data/` is empty |

### Question 1: the four changes

```ts
// 1. build: Alchemy's bridge imports node: modules, and the same flag Alchemy's bundler sets
//    drops its plan-only code (libfabrika/src/node/build.ts).
external: ["cloudflare:workers", /^node:/],
transform: {define: {"globalThis.__ALCHEMY_RUNTIME__": "true"}},

// 2. build: the bridge brings a second chunk. Joined into one string, as build.ts does on main,
//    workerd refuses the file: "Identifier 'Buffer$1' has already been declared".
for (const chunk of chunks) yield* fs.writeFileString(path.join(pending, chunk.fileName), chunk.code);

// 3. stack: Alchemy's runtime finds a hosted class at env[<class name>]. With only RECORD it said
//    "DurableObject 'RecordPart' not found".
RecordPart: Cloudflare.DurableObject("RecordPart"),

// 4. a caller not ported yet: a failure comes back as a value, {_tag: "~alchemy/rpc/error", error},
//    not a rejected Promise. Alchemy's own stub decodes it.
const stub = makeRpcStub(env.RECORD.getByName(name)); // from @alchemy.run/cloudflare/Bridge
```

The other way, letting Alchemy bundle the brain, registers objects too (the probes ran that way).
A plain class beside them could not be run there, for two reasons read in the source and one
checked: Node imports the Worker's main file for the plan, and `import("cloudflare:workers")` on
Node answers `ERR_UNSUPPORTED_ESM_URL_SCHEME`; and the generated entry exports only the default
handler and the bridge classes. So that way moves all four objects, `Control` and `fetch` at once.

What our own build costs, three runs each on one laptop:

| | main | spike |
|---|---|---|
| Built files | `brain.mjs`, 1.50 MB | `brain.mjs` 1.76 MB and one chunk 1.28 MB |
| Build time | 169 to 278 ms | 336 to 421 ms |
| Stage start, after the build | 1242, 1242, 1839 ms | 1303, 1395, 1416 ms |

### Question 5: the bug, and what types

**Wrong, kept for the record.** The first two paragraphs call the failed per-call lookup a bug and
patch it, and the second offers a type choice that the documented way does not need. The
[Correction](#correction-2026-11-10) has what ran instead. The last paragraph, what crosses a
typed stub, stands: the rerun saw the same.

`.make()` saves the services an object's methods run with at the moment its Layer is built.
`Layer.mergeAll(PingLive, PongLive)` builds each without the other, so `yield* Pong` inside a `Ping`
method has no `Pong`. The patch (`patches/@alchemy.run__cloudflare@2.0.0-beta.84.patch` on the
branch, 40 changed lines in `DurableObject.ts` and its built file) keeps the classes a Worker hosts
in one map and adds them when a method runs. No open or closed issue on alchemy-run/alchemy matched
in about 20 searches.

The types need a choice too. A method that does `yield* Pong` has `Pong | Worker` in its
requirements, and a contract whose methods need nothing does not accept it (`spike/out/tsc.txt`).
Either the contract names the sibling, which every caller's stub then shows, or one helper holds
one cast. The spike did not pick.

What crosses a typed stub: `null` and bytes as they are; a typed failure listed in the class's
`errors` arrives as an instance of its class; a Schema class instance does not cross (workerd's
`DataCloneError`), so an answer is sent encoded and decoded by the caller, which `RecordManager`
already does.

## What it means for the port

- **The plan's doubt is gone.** It gave 60% because a plain class might not sit beside an Effect
  object. It does. The six pull requests stand, in the plan's order.
- **PR 2 is larger than "the host Worker and `RecordPart`".** It also carries the build change, a
  binding named after each class, and the patch. About 180 lines changed in 7 product files on the
  branch, plus the 80-line patch file. *Wrong on the patch: PR 2 carries none.*
- **P16 meets this.** [PR 687](https://github.com/usirin/tea-fabrika/pull/687) makes one built file.
  The bridge makes two. One of them lands first and the other is planned against it.
- **Typed failures now cross.** A wrong part name came back as `SinkError` `bad_row`. On main every
  failure of that call is `unreachable`. No law failed on it, so no law pins it; the tests step
  decides which is wanted before `Project` and `Process` move.
- **`Project` and `Gateway`, and `Project` and `Process`, call each other.** They need the patch
  from the first of them that moves. *Wrong: they need no patch. Each takes the other in its
  Layer's init with `.from(Host)`.*
- **[0042](../.decisions/0042-platform-pieces-go-through-alchemy.md) and this spike differ on one
  line.** The spike hands the service `state.raw`, the platform's own state, which is why the
  service and its Node laws did not change. 0042 wants the service on Alchemy's `state.storage`.
  That route was not run: the wrapper has no `transactionSync` (a gap 0042 lists), and its methods
  need Alchemy's `RuntimeContext`, which a Node law would have to supply.
- **Two type gaps, seen in `tsc`, not at run time.** The `webSocketMessage` and `webSocketClose`
  slots take no requirements, but `state.getTags` and its neighbors need `RuntimeContext`; the
  probe used them anyway and ran. And the stub hides `RpcCallError`, as phoenix found on beta.59.

## Recommendation

Keep `bundle: false` and our own build, export the bridge classes from `brain.ts`, and port one
object per pull request in the plan's order, with the sibling patch from PR 2. *Wrong on the
last clause, corrected 2026-11-10: no sibling patch. A sibling is taken in the Layer's init with
`Sibling.from(Host)`.*

- **Why:** it is the only way that ran with plain classes beside, so each pull request stays small
  and each object's laws move alone. The twin check needs no change.
- **Cost:** the built brain doubles to 3.0 MB in two files, the stage starts about 150 ms later
  (median of three), one more local patch on Alchemy (*wrong: no patch*), and `brain.ts` writes
  three lines of wiring that Alchemy's bundler would have written.
- **How sure:** 75%. The doubt is `Gateway` and `Process`: their features ran on probes, not on the
  real objects, and `stage-records.test.ts` subclasses those classes to look inside them. PR 3 is
  where that is settled.

## Correction (2026-11-10)

The sibling finding was wrong. The probe pair was rerun the same day, unpatched, in local workerd,
on `@alchemy.run/cloudflare` 2.0.0-beta.84 and 2.0.0-beta.85, each under both builds: Alchemy's own
bundling, and our `bundle: false` build. No deploy, no model, $0.

```ts
// The change to the spike's probes. The host Worker class names the objects it hosts.
export class Spike extends Cloudflare.Worker<Spike, {}, Ping | Pong>()("Spike") {}

export const PingLive = Ping.make(
	Effect.gen(function* () {
		const pongs = yield* Pong.from(Spike); // init: once, by the host. Was `yield* Pong` per call.
		return Effect.gen(function* () {
			return {hit: (n: number) => pongs.getByName("one").back(n + 1) /* ... */};
		});
	}),
);
```

| Sibling lookup | Runs | Saw |
|---|---|---|
| Bare `yield* Pong` inside the method, as the spike had it | 4: beta.84 and beta.85, both builds | 4 of 4 failed: `RpcCallError`, `Service not found: Pong` |
| `Pong.from(Spike)` in the Layer's init | 6: two placements of the host class on beta.84 and one on beta.85, both builds | 6 of 6 returned `{"path":["ping.hit","pong.back","ping.leaf"],"n":3}` |

- **It is Alchemy's documented way.** The installed `DurableObject.ts` has a doc comment, "Using
  `.from(Self)` Inside the Host", that prefers this form. The spike did not read that far.
- **Why it composes.** `Sibling.from(Host)` needs only `Worker`, not the sibling's Layer, so two
  Layers that take each other make no cycle. The eager pair that failed at plan in question 5
  yielded the bare classes.
- **The type question likely goes too.** A method uses a value its Layer already holds, so it
  needs nothing, and the contract has nothing to name. That is read from the signature, not from
  `tsc`.
- **What crosses a stub did not change.** In the six passing runs `null`, bytes and a typed failure
  crossed, and a Schema class instance did not, as in question 5.
- **Where the per-call rule came from.** phoenix's decision 0033 said the bare per-call lookup
  worked on beta.45. Read only: its commit checked health and registration, not a call between two
  objects. Decision [0041](../.decisions/0041-object-classes-are-effect-objects.md) took the rule
  from there and is amended.
- **beta.85 was run for this one question only.** The bare lookup fails and `.from` works there
  too. The other seven questions were not rerun on it.

Not run: a real deploy, where the host Worker binds its own objects by its own name, and a type
check of the new shape. The ten saved outputs and the diff are raw results, so they are not in git
([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)).

## What it cannot tell us

- Whether any of it works on Cloudflare. Nothing was deployed. `meta.stack` in `brain.ts` says
  `"local"` by hand; what a cloud stage needs there is not known.
- What a call through the bridge costs. Only start time was measured, three runs, one laptop.
- Whether the real `Gateway`, `Process` and `Project` port cleanly. Only `RecordPart` was ported.
- Whether the mutation step still kills what it kills on main (the plan's S8). It was not run.
  `workers/record.ts` did not change, so its mutants are the same lines; that is an argument, not a run.
- Whether the bridge's alarm pass stays out of the way once an object also uses Alchemy's alarm
  callbacks. Ours used none.
- Whether beta.85, out since the run, changes any answer. The correction ran the sibling question
  on it; the rest is still open.
- Whether `Sibling.from(Host)` deploys: the host Worker then binds its own objects by its own
  script name. And whether it passes `tsc`.
- The spike's type errors are real and left in: the probe objects do not pass `tsc`, and the saved
  output says where. The ported `RecordPart` was not type checked alone.
- A guess that turned out wrong, kept: the sibling "bug" and its patch. A failed lookup was read
  as a library bug before the library's own doc comment was read to the end.
- A guess that turned out wrong, kept: the first run of the wire laws failed 10 of 10 and looked
  like a broken port. The cause was the binding name. The control path turns every cause into
  `unreachable`, so finding it took four runs.
