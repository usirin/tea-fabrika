# 173. Can the brain load a program's code at run time with Worker Loader?

[Part 2](#part-2-one-effect-instead-of-one-per-program) asks whether the
brain can hold one Effect instead of one per loaded program. Short answer:
not by sharing modules, but yes by keeping Effect out of the isolate. A pure
step runs in 3 to 67 KB and about 1 to 2 MB per isolate, against part 1's
423 KB and 7 MB.

Part 1: yes, locally. The hands (Node) bundle a tea program with esbuild in about 50
to 60 ms and key it by the sha256 of the bundle. A core Durable Object,
`Process`, keeps that code in its own storage, asks Worker Loader for an
isolate under the hash, and steps the program through it. `@demlik/tea` and
`effect` run there unchanged, the Effect engine's `run` included. So does the
repo's own `programs/counter`, bundled whole with `@kampus/fabrika`.

It is fast enough. A cold load is 29 to 38 ms at the median. A warm `get` is
about 1 microsecond, and a warm get plus one call is 28 microseconds. One step
across the isolate line costs about 30 microseconds with a small state and
about 60 with a 100 KB state, against well under 1 microsecond straight in the
object. Seen from outside, one request per step, that is about 0.07 ms more at
the median (0.61 against 0.54 ms) and 0.05 to 0.1 ms more at p95.

It is isolated in the ways that matter for a pack, with two holes to know.
The loaded code sees only the bindings we pass. With `globalOutbound: null`,
`fetch`, `connect` and `WebSocket` all throw. But one isolate serves every
process on the same version (their module state is shared), and on a laptop a
program that spins holds up every other process in the same workerd.

```ts
// The whole idea, shortened from 173-worker-loader/core.ts.
// Hands: code = esbuild(program.ts); hash = sha256(code); POST install {program, hash, code}.
export class Process extends DurableObject {
	model: Tally = {n: 0, pad: ""};

	async install({hash, code}) {
		if ((await sha256(code)) !== hash) return {kept: false, why: "hash_mismatch"};
		this.ctx.storage.kv.put(`code:${hash}`, code); // the core keeps the code by its hash
		return {kept: true};
	}

	worker(hash) {
		const pid = this.ctx.id.name; // "process:<pid>"
		return this.env.LOADER.get(`${hash}:none:0`, async () => ({ // the id says code and config
			compatibilityDate: "2026-07-01",
			mainModule: "program.js",
			modules: {"program.js": this.ctx.storage.kv.get(`code:${hash}`)},
			env: {LEDGER: this.ctx.exports.Ledger({props: {pid}})}, // the one way out
			globalOutbound: null, // no network
		}));
	}

	async one({msg}) {
		// Elm's update across the line: the core keeps the state, the program only folds.
		const out = await this.worker(this.running.hash).getEntrypoint("Program").step(this.model, msg);
		this.model = out.model; // {n: 1, pad: ""}, cmds: []
		return {n: this.model.n};
	}
}
```

**Lean:** load packs and repo programs into the brain with Worker Loader, one
isolate per program version keyed by content hash, with the state kept by the
core and the program's update called as a pure step. Confidence 75%. The why,
the cost and the doubts are in [the lean](#the-lean).

Who did what: everything here is this repo's code in
`experiments/173-worker-loader/` running on Miniflare 4.20260730.0 and the
workerd it ships with (1.20260730.1, not the 1.20261012.1 that experiment 171
installed). Today's fabrika played no part. No code in `packages/`, `programs/`
or `apps/` changed. Nothing was deployed, no request left the machine, and no
model or paid API was called. $0.

## How it was run

```sh
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/173-worker-loader.ts
```

- `173-worker-loader.ts` is the driver's entry; the parts live in the
  workspace package `173-worker-loader/`, so `esbuild` resolves there.
- `tally.ts` is the program: a copy of `programs/counter`'s machine with one
  more Msg (`add`), a `pad` field so the state can be made big, and a step that
  checks the Msg with an Effect schema before `applyCell` folds it.
- `program.ts` is what gets loaded: a stateless `Program` entrypoint (`step`,
  `runAll`, `probe`, `spin`) and `Kept`, a Durable Object class for facets.
- `counter-entry.ts` loads the real `@tea-fabrika/counter` and steps its
  `count` machine.
- `core.ts` is the core Worker: the `Process` Durable Object (SQLite backed),
  plus two entrypoints it hands to programs, `Ledger` and `Gate`.
- `main.ts` bundles, starts Miniflare with a temp folder for its data, runs
  every part, and writes `results/173-worker-loader.json`. About 40 seconds.
- Timers inside workerd tick in whole milliseconds. So in-object numbers are
  totals over many steps, and single steps are timed from Node, one request
  each, with the four modes taking turns.

The full script ran four times while it grew; the numbers below are from the
last run (the one saved in the results), and the earlier ones agreed within a
few ms for loads and a few microseconds for steps.

## 1. The hands bundle the program

| Bundle | Bytes | gzip | Build | Of which Effect |
|---|---|---|---|---|
| tally, plain | 966,361 | about 201 KB | 60 to 86 ms first, 50 to 59 ms again | about 905 KB |
| tally, minified | 423,339 | about 135 KB | 53 to 57 ms | about 400 KB |
| `programs/counter` whole, minified | 579,204 | 186,212 | 70 to 79 ms | 442,218 (plus 111,900 of `@kampus/fabrika`) |

- One ES module, `cloudflare:*` left to the runtime, `platform: "neutral"`.
- The same source builds the same bytes twice, so the sha256 is a stable key.
  The core checks it: code whose hash is not its sha256 is refused
  (`hash_mismatch`).
- The program's own code is 2 to 3 KB. `@demlik/tea` is 21 to 47 KB. Effect is
  94% of every bundle. Every program version carries its own copy.

## 2. Load and step

Loading:

- Cold, a hash this workerd never saw: p50 38 ms, p95 46 ms plain; p50 29 ms,
  p95 31 ms minified (20 versions each).
- Warm: `LOADER.get` alone is 0.0011 ms. Get plus one call is 0.028 ms. All
  1001 calls met the same isolate.
- After a whole restart of Miniflare (new workerd, cold object, cold isolate,
  code read back from the object's storage), the first answer took 117 ms.
- Memory: 40 cold versions took workerd from 137 MB to 395 MB, about 6.5 MB
  for each loaded isolate.

One step (Msg in, new state out), in a loop inside the object, mean of 1,000
steps (100,000 for direct), three runs:

| State size | Straight in the object | Through the isolate | As a facet (a SQLite write each step) |
|---|---|---|---|
| about 20 B | 0.03 to 0.08 us | 28 to 34 us | 65 to 111 us |
| 10 KB | 0.03 to 0.07 us | 35 to 37 us | |
| 100 KB | 0.04 to 0.05 us | 60 to 66 us | |

Straight in the object the state is never copied; through the isolate it is
copied there and back each step, so the 100 KB row is mostly copying. The
first of the three facet runs is always the slow one (its SQLite warming up).

One step at a time from Node, 1,000 each, the request itself included:

| Mode | p50 | p95 | mean |
|---|---|---|---|
| noop (the request alone) | 0.534 ms | 0.874 ms | 0.604 ms |
| direct | 0.537 ms | 0.826 ms | 0.628 ms |
| through the isolate | 0.606 ms | 0.922 ms | 0.690 ms |
| facet | 0.727 ms | 1.237 ms | 0.822 ms |

So the isolate line adds about 0.07 ms at the median and 0.05 to 0.1 ms at
p95; the request itself is most of every number. A program step that waits on
an agent or a person for seconds will not feel it.

## 3. What the loaded code can reach

With `globalOutbound: null`:

- `env` holds only `LEDGER`, the one binding we passed.
- `fetch("https://example.com/")`, `fetch("http://127.0.0.1:1/")`,
  `connect()` from `cloudflare:sockets` and `new WebSocket(...)` all throw
  "This worker is not permitted to access the internet".
- `caches.default` throws ("No Cache was configured"), which is Miniflare's
  answer; on Cloudflare it is unverified.
- No `process`, no `require`. `crypto.randomUUID()` works.
- `LEDGER.append("hi", "process:other")` comes back signed `process:a`: the pid
  is the core's `props`, so a program cannot speak for another process.

With `globalOutbound` set to our own `Gate` entrypoint, every `fetch` lands in
the gate (we answered 403), and `connect()` is refused. That is the hook for a
pack that needs the network through an allow list.

What it could still reach, or do:

- **The other processes on its version.** Two processes asking for the same
  hash met one isolate: module state is shared (a counter in `program.ts` kept
  counting across processes `a`, `x` and `y`). A program that keeps anything at
  module level leaks it between processes, for example two people's processes
  in a team brain. The docs also say two calls are never promised the same
  isolate, so module state is neither safe nor reliable. Keep the program a pure
  step, or add the pid to the loader id (one isolate per process, about 6.5 MB
  each).
- **Time on the shared thread.** A program that spins for 300 ms held up a
  no-op of its own process, a step of another process and a direct step of a
  third: each waited about 270 ms. On a laptop all processes share one workerd. The
  `limits: {cpuMs: 10}` option did not stop a 500 ms spin in Miniflare, so the
  CPU cap is unverified locally. On Cloudflare the docs say it throws.
- Its own CPU and memory, the clock, `crypto`, `console` (to the core's logs),
  and whatever the bindings we pass can do.

## 4. Storage: the program's own SQLite, or the core's

Both work in Miniflare. Durable Object facets
(`this.ctx.facets.get(name, () => ({class: worker.getDurableObjectClass("Kept")}))`)
ran as the docs describe:

- The facet kept `n = 5` in its own SQLite. It saw only its own key, `model`.
  The core's keys (`code:…`, `core-only`) were not in it, and the core's list
  did not show the facet's.
- An upgrade: `facets.abort("program", …)`, then `get` with the new version's
  class. The new code read `n = 5`: storage stays across versions. The old stub
  then threw the abort reason.
- After a full restart of Miniflare on the same data folder, the facet still
  read `n = 5`.
- Cost: 68 to 125 us a step with one write, about twice the stateless step.

So a loaded program can keep its own storage. The lean still sends every
write through the core: the core keeps the job record (experiment 166), so a
program cannot rewrite its own history, the record stays in one place to read
and replay, and the step stays Elm's pure update. Facets are the answer for a
program that one day needs a big store of its own.

## 5. tea and Effect inside the isolate

Unchanged, with no compatibility flag (no `nodejs_compat`):

- `applyCell` from `@demlik/tea` and `Schema.decodeUnknownSync` from `effect`
  step the program.
- The Effect engine's `run` from `@demlik/tea/effect` booted, took
  `plus` and `add 41`, and ended at `n = 42`, the same as in the core.
- A Msg the schema does not know (`minus`) came back across the line as
  `Error: SchemaError`: the error crosses, its detail is only in the message.
- `programs/counter`, whole, answered its name, description and inputs, and
  stepped three `plus` to `{n: 3}` with its status line `3 so far`.

No errors. The only friction was ours: timers tick in whole milliseconds, so
measuring a fast step needs a loop.

## The lean

Load packs and repo programs into the brain with Worker Loader, one isolate per
program version keyed by content hash; the core keeps the state and the
record, and calls the program's update as a pure step.

- **Why:** it is the only way found to run code that is not in the brain's
  own bundle inside workerd, and today's `import()` cannot work there. It
  loaded in about 30 ms, stepped in about 30 us, ran our libraries unchanged,
  and kept the network shut with one option. The hash key gives caching and
  versioning together: a new version is a new id.
- **What it costs:** about 6.5 MB of workerd memory per loaded version, mostly
  Effect parsed again in each isolate. 40 versions on a laptop is about 260 MB.
  Each bundle is 0.4 to 1 MB. On Cloudflare, every call into a dynamic worker
  is a billed request, and each unique id and code a day is a billed dynamic
  worker past the 1,000 a month included (docs, pricing page). At most 10
  dynamic workers can be in flight from one Durable Object, which one program
  per process fits.
- **How sure:** 75%. The doubts: (1) a spinning program stalls every process
  in a local workerd, and Miniflare does not enforce `cpuMs`; a laptop brain
  needs a watchdog or one workerd per trust level. (2) Shared module state
  across processes of one version; the pure-step contract must be the rule,
  not a habit. (3) Everything here is Miniflare; Cloudflare's cold load, code
  cache and eviction are untested. One deploy of this harness to a test account
  would settle (3), and a cpuMs probe there would settle half of (1).

## What this cannot tell us

- Cloudflare itself: cold load on their machines, whether they reuse a parsed
  bundle across isolates, how soon an idle isolate is evicted, and whether
  `cpuMs` and `subRequests` throw as documented. None of it was deployed.
- Pricing in practice: how many billed requests a real program makes per Msg,
  and whether a returned RPC stub (which the docs say shares one session) can
  fold many steps into one billed request.
- Real network latency: every number here is one machine, no wire between the
  hands and the brain.
- Size limits: the core kept a 1 MB bundle as one value in its SQLite here.
  Cloudflare caps a stored value (about 2 MB, by its Durable Object limits
  page, not checked here), so a bigger pack would need chunks or another store.
  Not tried.
- A program with Cmds and Listens. The tally has none; how a Cmd the program
  returns gets run by the core (and its hands) is the next question.
- Many processes at once under load. The spin test shows the shape of the
  problem, not how often it bites.

## Part 2: one Effect instead of one per program

Run 2026-10-31. The question: can we give a loaded program one shared Effect
instead of a copy in each bundle? One live copy across isolates cannot exist:
each isolate has its own V8 heap, and that is the isolation. So part 2
measured the two things that can exist.

- **A. Split modules.** Effect, tea and fabrika go to Worker Loader as modules
  of their own, named by their content (`effect@4.0.6-1a12e33e16e3.js`). The
  program is a small module that imports them. It saves bytes on the wire and
  nothing else. A new version sends 2.4 KB instead of 423 KB, but each isolate
  gets heavier and slower: 11 to 13 MB and 49 to 62 ms, against 7 MB and 25
  to 28 ms for part 1's single bundle. The shared Effect has to be all of Effect (896 KB),
  not the 400 KB one program uses. workerd showed no sign of reusing compiled
  code between isolates that load the same bytes.
- **B. Pure-step sandbox.** The isolate runs only the program's update,
  `(state, msg) -> {state, cmds, subs}`, all plain data. The core keeps
  Effect, rebuilds the program's schemas from data, and decodes what comes in.
  The update needs no Effect at run time, in both programs tried. The
  counter's machine alone is 3 KB, loads cold in 1 ms and takes about 1.2 MB
  (an empty isolate takes 1.1 to 1.3 MB). The tracker's machine is 67 KB, 3
  to 4 ms and 2.0 to 2.2 MB. A step costs the same as in part 1, since the line crossing is most
  of it.

B has a price for program authors. Programs as written today do not load
without Effect, because their modules build schemas and call `defineProgram`
when they load. The machine has to live in a module of its own that imports
schemas as types only.

```ts
// The whole idea of B, shortened from 173-worker-loader/ (core-2.ts, sandbox.ts).
// The sandbox, 3 KB for the counter: Elm's update and nothing else, no Effect.
import {applyCell} from "@demlik/tea";
import {count} from "./counter-machine.ts"; // imports `type Shown` only: erased
export class Program extends WorkerEntrypoint {
	step(state, msg) {
		const [next, cmds] = applyCell(count, state, msg);
		return {state: next, cmds, subs: subsOf(count, next)}; // all plain data
	}
}

// The core: Effect lives here, once. The hands send the schemas as data.
const Press = SchemaRepresentation.fromRepresentation(
	SchemaRepresentation.fromJson(doc), // 221 bytes of JSON, from Schema.toRepresentation(Press)
	{revivers}, // every *Reviver Effect ships: isPattern, isMaxLength, isInt, ...
);
const msg = {type: Schema.decodeUnknownSync(Press)("plus")}; // the core decodes, 0.05 us
const out = await env.LOADER.get(`${hash}:${pid}`, load).getEntrypoint("Program").step(state, msg);
// out: {state: {n: 1}, cmds: [], subs: []}; the core keeps the state and runs the cmds
```

**Lean:** the sandbox runs a pure step with no Effect engine; Effect lives
once in the core. Confidence 70%. The why, the cost and the doubts are in
[the lean](#the-lean-after-part-2).

Who did what: all of it is this repo's code in `experiments/173-worker-loader/`
on Miniflare 4.20260730.0 and its workerd 1.20260730.1, as in part 1. Today's
fabrika played no part. No code in `packages/`, `programs/` or `apps/`
changed. Nothing was deployed, no request left the machine, no model or paid
API was called. $0.

### How it was run

```sh
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/173-worker-loader/part-2.ts
```

- `build.ts` builds a program three ways: `single` (part 1, one module),
  `split` (design A) and `pure` (design B). For A it also builds the shared
  modules, each named `<lib>@<version>-<first 12 hex of its sha256>.js`.
- `effect-stub.ts` is the measuring tool for B. The build swaps `effect` for
  it: every name Effect exports becomes an inert value. While the modules load,
  a touch is noted and passes. After the entry calls `seal()`, any touch throws
  `EffectAtRunTime`. So a step that needs Effect cannot pass by accident.
- `sandbox.ts` is the pure step. `pure-counter.ts` and `pure-tracker.ts` import
  the programs as their packages export them. `counter-machine.ts` is the
  counter's machine copied into a module of its own, the change an author
  would make, and `pure-counter-machine.ts` loads it.
- `core-2.ts` is the core: a `Process` Durable Object that keeps each module
  once under its name, says which names it lacks (`have`), rebuilds schemas
  from data, and steps the sandbox.
- `part-2.ts` is the driver. Each variant gets a fresh Miniflare and 20 new
  versions, loaded cold, with workerd's memory read before and after. Then one
  Miniflare runs the rest. It writes
  `results/173-worker-loader-part-2.json` and takes about 12 seconds.
- It ran four times, the last two after a lint fix that changed no behavior,
  on a busier machine (load average 6 to 7). The loading tables give the range
  over all four runs. Byte counts, parity and the shared-state answers were the
  same every time. Other numbers are from the fourth run, the saved one.

The second program is `programs/tracker`. It uses Effect Schema the most of
the repo's programs: five Cmds made with tea's Effect `Cmd.define`, a state
schema of 15 fields, checks on titles and numbers, and a fold over ticket facts
from `@kampus/pipeline`. It also has Subs, so it tests more than a counter.

### A. Split modules: what the hands send

With the core already holding Effect:

| Install | Modules sent | Bytes sent |
|---|---|---|
| the tally's first version | 4 (Effect, two of its part re-exports, the program) | 929,904 |
| the tally's next version | 1 (the program) | 2,390 |
| the counter, a new program on the same Effect and tea | 4 (fabrika, two re-exports, the program) | 651,998 |
| part 1, any new version | 1 | 423,348 |

- The shared Effect module is `export * from "effect"` plus the parts that
  tea, fabrika and the programs import (`effect/process`, `effect/persistence`,
  ...). A part imported on its own would carry a second copy of Effect's core,
  so each part is a small module that re-exports it from the one Effect
  module, as `@demlik/tea/effect` re-exports from tea's.
- It is 895,663 bytes minified, against 399,522 of Effect inside part 1's
  bundle. It must serve every program, including ones not written yet, so
  esbuild cannot drop what one program does not use.
- fabrika as a shared module is 649,902 bytes, 453,331 of it zod. Today's
  `@kampus/fabrika` top level pulls zod in.
- In this harness each `Process` keeps its own modules, so a second process on
  the same version got all of them again (929,904 bytes). A brain-wide module
  store would fix that. Not built.

### A. Split modules: loading

Twenty new versions per variant, each variant in a fresh workerd:

| Variant | Loaded per version | Cold p50 | workerd memory per version |
|---|---|---|---|
| an empty program (the floor) | 282 B | 1 ms | 1.1 to 1.3 MB |
| tally, single bundle (part 1) | 423 KB | 25 to 28 ms | 6.8 to 7.0 MB |
| tally, split, shared modules the same bytes | 930 KB | 49 to 62 ms | 11.0 to 12.8 MB |
| tally, split, shared modules new bytes each version (control) | 930 KB | 53 to 61 ms | 10.4 to 12.1 MB |
| counter, single bundle (part 1) | 579 KB | 37 to 48 ms | 8.6 to 9.7 MB |
| counter, split | 1,580 KB | 68 to 78 ms | 15.6 to 16.9 MB |

- Split is worse per isolate: about twice the memory and twice the cold load.
  Each isolate parses and runs all of Effect (and for the counter all of
  fabrika and zod), where part 1's bundle carried only what it used.
- **Does workerd reuse compiled code across isolates with identical module
  bytes?** No sign of it. The control loads the same code with new bytes in
  each version (a comment at the end, so a new name and hash). Memory: the
  same-bytes runs took 0.7 to 1.6 MB *more* per version than the control, in
  all four runs. Cold p50: the same bytes were 4, 3 and 2 ms faster in the
  first three runs and 1 ms slower in the fourth. A shared code cache would
  show as less memory and a steady edge; neither showed. A cache too small to
  see, or one that only helps on Cloudflare, I cannot rule out from here.
- One step costs the same as part 1 once loaded: 28 to 31 us split, 27 to 31
  us single.

### B. Pure step: does the update need Effect?

**At run time:** no. With Effect swapped for the
stub, both machines stepped and touched no Effect name after `seal()`:

- The counter: 5 `plus`, the same 6 answers (init and 5 steps) as the real
  Effect in Node, status `5 so far`.
- The tracker: 12 Msgs from a full read of 20 tickets through a filing, its
  duplicate question, the saved hints, and `quit`. The same 13 answers as in
  Node, Cmds and Subs included (`load`, `save`, `duplicates` and `save_hints`
  came out as plain data). Status `20 open, 0 closed`.

**To load:** yes, as programs are written today. What happened to each build:

| Build | Bytes | Loads? |
|---|---|---|
| counter package, real Effect | 579,655 | yes |
| counter package, Effect stubbed | 140,963 | no: fabrika's `input()` reads the schema when the module loads and throws "a shape only checks" |
| counter package, Effect and fabrika stubbed | 17,405 | loads, then the step throws: the machine is reachable only through `defineProgram`'s result |
| counter machine in its own module (`counter-machine.ts`) | 3,154 | yes; the same 3,154 bytes with the real Effect, since nothing imports it |
| tracker package, real Effect | 610,367 | yes |
| tracker package, Effect stubbed | 171,304 | no: the same fabrika `input()` error |
| tracker package, Effect and fabrika stubbed | 67,226 | yes, and steps right |

- While the tracker's modules load, they make 257 Effect calls (and 11 to
  fabrika) that the stub had to absorb: `Schema.Struct` 73 times, `Schema.Literal` 31,
  `Schema.toStandardSchemaV1` 12 (inside tea's `Cmd.define`), `Context.Service`
  10, `Data.TaggedError` 2, `Duration.minutes` 2, and more. None of that is
  the update. It is the program package building its schemas, Cmds, services
  and `defineProgram` at load.
- The 67 KB tracker build still holds 12 KB of stubbed names and 27 KB of tea
  (its Effect engine comes in because the package's top module imports `run`).
  Its own code is about 18 KB, plus 9 KB of `@kampus/pipeline`.
- A Cmd works in the sandbox: tea's `Cmd.define` makes a constructor that is
  plain data at run time (`{...input, type: "load"}`). Only defining it
  touches Effect, to wrap the schemas.

### B. Pure step: loading

Twenty new versions per variant, each variant in a fresh workerd:

| Variant | Loaded per version | Cold p50 | Memory per version |
|---|---|---|---|
| an empty program (the floor) | 282 B | 1 ms | 1.1 to 1.3 MB |
| counter, part 1 single bundle | 579 KB | 37 to 48 ms | 8.6 to 9.7 MB |
| counter, pure step, real Effect | 580 KB | 37 to 42 ms | 9.2 to 9.4 MB |
| counter, pure step, machine module alone | 3 KB | 1 ms | 1.2 MB |
| tracker, pure step, real Effect | 610 KB | 38 to 43 ms | 9.7 to 10.4 MB |
| tracker, pure step, Effect and fabrika stubbed | 67 KB | 3 to 4 ms | 2.0 to 2.2 MB |

So almost all of part 1's 7 to 10 MB and 25 to 48 ms is Effect (and fabrika)
loading. Without them a program isolate is close to an empty one.

### B. Pure step: schemas as data, and the step's cost

**The core decodes with the program's schemas, rebuilt from data.** The hands
turn each schema into JSON with Effect 4's `Schema.toRepresentation` and
`SchemaRepresentation.toJson`. The core rebuilds it with `fromJson` and
`fromRepresentation`, passing every reviver Effect ships. Seven schemas went
across: the counter's `Press` and `Shown`; the tracker's `Tracker` (the state),
`Write`, `File`, `Comment` and `OneTicket`. On 27 samples, good and bad (a
title with a leading space, a two-line title, ticket 0, a 70,000-character
body, a find of 300 characters, a `seen` of -0.5), the rebuilt schemas agreed
with the originals every time. Sizes: `Press` 221 bytes of JSON, `Shown` 399,
`Write` 10,442, `Tracker` 63,517. The tracker's state schema is bigger as data
than its machine is as code.

Steps, in a loop inside the core, 1,000 a run after one warm-up run, three
runs (the fourth script run; the others were within about 10 us):

| Step | us per step |
|---|---|
| tally, single bundle (part 1) | 27, 28, 31 |
| tally, split modules | 30, 31, 28 |
| counter, single bundle (part 1) | 29, 28, 33 |
| counter, pure step, the core decodes the press | 28, 28, 28 |
| counter, pure step, no decode | 33, 28, 27 |
| tracker, pure step, 4.8 KB state of 20 tickets | 114, 113, 114 |
| the core decodes one press, no step | 0.05, 0.06, 0.05 |
| the core decodes one `Write`, no step | 0.31, 0.31, 0.31 |
| counter, the update alone in Node | 0.07, 0.06, 0.05 |
| tracker, the update alone in Node | 0.22, 0.21, 0.21 |

- B steps as fast as part 1. Decoding in the core adds well under 1 us.
- The tracker's step is 0.2 us of work and about 110 us of crossing. Its
  state is 4.8 KB of nested objects, copied there and back each step. Part 1's
  100 KB state was one long string and cost 60 us. So the shape of the state
  matters more than its size. B does not change this cost; part 1's lean has it
  too.

### Shared module state, checked again

- **A:** two program versions loaded the same bytes of a tiny shared module
  with a counter in it. Version 1 counted 1, 2, 3; version 2 started at 1. Each
  isolate has its own copy, as expected. Inside one version, module state is
  still shared by every process on it, as in part 1. A adds no new leak and
  closes none.
- **B, keyed by version:** two processes on one version met one isolate (its
  call count went from 8,014 to 8,015 across them). The hole is the same as in
  part 1. A pure update keeps no state of its own, but nothing stops a program
  from keeping a `let` at module level.
- **B, keyed by version and process** (`LOADER.get(`${hash}:${pid}`, ...)`):
  each process got its own isolate (both counts started at 1, and process x
  came back to its own). In part 1 that cost 6.5 MB a process. In B it costs
  about 1.2 MB (the counter) to 2.1 MB (the tracker), near the 1.2 MB floor.
  So B makes closing the hole cheap. Fifty processes would be about 60 to
  110 MB.

### What B costs a program author

Today's programs would have to change shape. In the order they bite:

- **The machine in a module of its own.** It may import tea and the
  program's plain helpers, and schemas only with `import type`. The counter's
  machine sits inside `index.ts` next to `defineProgram`, so it moves to a file
  like `counter-machine.ts`. The tracker's `machine.ts` builds schema values
  and Cmds at its top, so those move out too.
- **Cmds declared without Effect in the machine module.** tea's Effect
  `Cmd.define` wraps the schemas when the module loads. The machine needs only
  the constructor (`load({after})` is `{type: "load", after}`), so B wants a
  name-only constructor in the machine module and the Cmd's schemas in the
  module the core reads. tea has no such split today.
- **Schemas that travel as data.** Built-in checks came back fine
  (`isPattern`, `isMaxLength`, `isTrimmed`, `isNonEmpty`,
  `isGreaterThanOrEqualTo`, `Int`, `Finite`). A check written as a function, a
  transformation, or a schema that needs a service has no reviver. By Effect's
  docs it would not rebuild in the core. Not tried here.
- **`main` cannot run in the sandbox.** A fabrika program's `main` is Effect
  code: it serves inputs, starts machines and sends outputs. In B it runs in
  the core, or becomes data the core reads (input `press` "plus" becomes Msg
  `{type: "plus"}`). That is a real change to `defineProgram`, not designed
  here.
- **Purity is still a promise, not a wall.** The sandbox still has a clock,
  `crypto` and module-level `let`. Keying the isolate by process makes a leak
  stay inside one process. It does not make the update pure.

What the author gets back: a program version is 3 to 67 KB instead of 0.4 to
0.6 MB, and loads in 1 to 4 ms instead of 25 to 48.

### The lean, after part 2

The sandbox runs a pure step with no Effect engine; Effect lives once in the
core.

- **Why:** it is the only one of the two designs that makes Effect cost less.
  Per isolate it saves about 5 to 8.5 MB and 22 to 45 ms of cold load. Bytes per
  version drop 6 to 180 times. The step does not get slower. The update
  needed no Effect at run time in both programs tried, Cmds and Subs included.
  The core already has Effect and rebuilt the schemas from data with the same
  answers. And cheap isolates make one isolate per process affordable, which
  closes part 1's shared-state hole. A fails the goal: it trades wire bytes for
  heavier isolates, and workerd showed no reuse to win back.
- **What it costs:** a program shape change, sized by what moved here. Two
  programs' machines (the counter's 10 lines, the tracker's 484-line
  `machine.ts`) would split into a machine module and a schema module. tea
  would need a Cmd constructor that names a Cmd without its schemas. fabrika's
  `defineProgram` would need to say its inputs and `main` in a form the core
  runs. A guess, not measured: 1 to 2 agent hours to split the counter and
  the tracker by hand. The tea and fabrika changes are design work first, not
  sized here.
- **How sure:** 70%. The doubts: (1) the tracker sandbox here loaded only
  because the stub absorbed 257 Effect calls at load; a real split of
  `machine.ts` was not built, and it may pull in more than the 67 KB measured.
  (2) Where `main` goes is open: if it must stay free Effect code, it needs an
  Effect isolate of its own, and part of the saving comes back. (3) Custom
  checks were not tried as data. (4) Still all Miniflare: Cloudflare's own
  isolate memory and cold load are untested. What would settle (1) and (2):
  split the tracker for real and write its inputs and `main` as data the core
  runs, then run this script on it.

### What part 2 cannot tell us

- Whether Cloudflare's runtime shares compiled code across isolates. It is a
  different build of the same engine, with its own caches. Part 2's control
  says nothing about it.
- Whether a code cache too small to see is there. The same-bytes split loads
  were 2 to 4 ms faster than the control in three runs and 1 ms slower in the
  fourth, on a busy machine. That is within noise. Many more runs on a quiet
  machine, reading modules from memory rather than SQLite, would tell.
- The core running the Cmds. Here the sandbox's Cmds came out as data and were
  compared, not run. Validating a Cmd's result with its rebuilt `ok` schema is
  the core's job in B. tea's Effect `Cmd.define` keeps each schema as a
  Standard Schema wrapper; whether the Effect schema can be read back from it
  was not checked, so the hands may need the Effect schemas exported on their
  own. Not tried.
- A real program split for B. `counter-machine.ts` is a copy; the tracker
  stepped behind a stub. The parity checks say the update itself is fine, not
  that a split package is easy to keep.
- Memory under many live processes at once, and how soon idle isolates go.
  Each variant here held 20 isolates.
- gzip on the wire for schema documents. Their JSON sizes are raw.
