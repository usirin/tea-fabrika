# 173. Can the brain load a program's code at run time with Worker Loader?

Yes, locally. The hands (Node) bundle a tea program with esbuild in about 50
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
