---
date: "2026-11-02"
scripts: "none; reading only"
summary: "Reading, `next/`, not a measurement. Each batch of a daily check gets its own box object by id, Cloudflare's shape (each container \"is managed and proxied by a Durable Object\") and OTP's; the brain's alarm keeps only the queue and offers each batch to a laptop's idle hands first, for free. Both run the same batch program and schemas. On the Workers Paid plan we have, a busy `standard-4` box (4 vCPU, 12 GiB) is about $0.40 an hour past the plan; at most 375 at once. Mutation first pass about $5 to $10 once (range $2.40 to $19), daily about $6 to $42 a month at the last 14 days' pace, or at most about $12 with a 1 box hour daily cap. The PR watcher, the stale lane check and TLA+ step reading run in the brain's object; Vitest's Node side, Stryker's child processes, native tools, Java and Chromium need a box. Walks back the \"no copy of the code on Cloudflare\" cost line in scheduled jobs, pending the owner. Lean 70%; the doubt is vCPU speed and box setup time, which one live run of 181's 150-mutant sample settles for under $0.50. $0."
---

# 197. Daily checks on Cloudflare: the long jobs run as hands in a box

Everything here is about `next/`. Reading only: nothing was deployed, nothing ran on Cloudflare,
no model was called. Cost: $0.

**Answer: each batch of a daily check gets its own box object on Cloudflare, by id, and that
object runs the same batch program a laptop's hands run.** The brain's alarm keeps only the
queue. It never runs a check.

- **The shape is Cloudflare's own and OTP's.** Each container "is managed and proxied by a
  Durable Object", and "a Container can only be accessed through its Durable Object"
  ([Durable Object Container API](https://developers.cloudflare.com/containers/api/durable-object-container/),
  updated 2026-09-30; [architecture](https://developers.cloudflare.com/containers/concepts/architecture/)).
  So one object per box, addressed by name. An OTP supervisor never does the work either: one
  process per worker. Experiment 148's `JobBox` (one object per job) is already this shape.
- **It runs on the plan we already pay for.** Workers Paid holds the box
  ([experiment 144](./144-durable-objects-live.md), 148, 157). Past what the plan includes, a
  busy `standard-4` box (4 vCPU, 12 GiB, 20 GB) costs about **$0.40 an hour** at list price.
- **The cost, as sized today:** about **$5 to $10 once** for the mutation first pass (range $2.40
  to $19, since 181's 48 worker hours could be half or double), then about **$6 to $42 a month**
  for the daily run at the last 14 days' pace. A daily box cap bounds it: 1 box hour a day is at
  most about $12 a month, and the queue rolls the rest to the next day.
- **The laptop stays first.** When a person's hands are up and idle, the brain offers them the
  batch, for free. A box starts only when no hands take it, under the cap.
- **Some checks need no box at all.** The PR watcher, the stale lane check and reading recorded
  runs as TLA+ steps are plain code over the ledger and `CodeHost`, so they run in the brain's
  object. Anything that needs Vitest's Node side, a child process, a native binary (tsgo, oxc,
  esbuild), Java or Chromium needs a box.
- **This walks back one line.** [Scheduled jobs run on the host's alarms](../docs/direction/scheduled-jobs-on-the-host.md)
  says, under Cost: "On Cloudflare there is no copy of the code, so those jobs run on a person's
  own host, and only while it is up." With this, the box makes its own copy: it clones the
  public repo at the commit the brain names. That note is not edited here; it waits for the
  owner's yes.

```ts
// A sketch, not built. The whole idea in one picture.
//   brain (one object):  the queue program on its own alarm. Keeps entries, leases, Gap ids.
//     tick -> next batch -> offer it to idle hands (a laptop) -> none took it -> start a box
//   box object "batch:b-812" (one per batch): starts its one container, clones at the commit,
//     installs, runs `run-batch`, beats while it runs, reports `ran` to the brain, destroys the box
//   laptop hands: the same `run-batch` program, as a child in Sandbox.os, the answer through the door
const box = env.HANDS_BOX.getByName(`batch:${batch.id}`); // Cloudflare: one object, one container
```

**Lean: build it in Tier 6 with the mutation queue, 70% sure.** The shape I am about 85% sure
of. The cost is the doubt: it rests on two numbers nobody has measured (how fast a Cloudflare
vCPU runs our tests against a laptop core, and how long a fresh box takes to clone and install).
One live box run of 181's fixed-seed sample settles both, for under $0.50
([what would settle it](#the-lean)).

## What is settled, and what this changes

Read before writing this, and not decided again here:

- Jobs run on Durable Object alarms, not Cron Triggers, and each job is its own program with
  its own alarm ([scheduled jobs](../docs/direction/scheduled-jobs-on-the-host.md), decided
  2026-11-01).
- The mutation queue is a program on an alarm. Hands run Stryker, never the brain. A crashed
  batch is split and run again. No GitHub Actions shards
  ([fast and daily mutation](../docs/direction/fast-and-daily-mutation.md), decided 2026-11-01).
  This study keeps that: no Actions route is needed, since no hard limit forces one.
- Hands take jobs from the queue with a lease, and say what they can do with `has`
  ([brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)).
- The box is the `Sandbox` service; a program crosses its wall as JSON lines, checked by its own
  schemas ([programs run in a box](../docs/direction/programs-run-in-a-box.md)).
- The account pays for Workers Paid, $5 a month (144, lines 82 and 472). Real boxes ran on
  Cloudflare in 148 and real Claude Code and Codex in Sandbox SDK 1.0.3 boxes in 157.
- A job's object must stay awake while its box runs. With no beat, Cloudflare cut a box at
  about 26 s, twice (148, Q4).
- tea is the engine, so Cloudflare's Workflows do not come in
  ([tea is the engine](../docs/direction/tea-is-the-engine.md); 174's ruling, 2026-11-02).
- A run's big files go to `Blobs` on R2 by hash, since a Durable Object row stops at 2 MB
  ([the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md)).

What changes:

- **The cost line in scheduled jobs** (above): a job that reads code no longer needs a person's
  host. Its "still open: where a job that reads code runs for a team" gets an answer.
- **The doubt in fast and daily mutation** ("a VM host is the answer the hands design already
  has"): the box object is that host, priced below.

Where Cloudflare's own docs point, and why we do not follow them there:

- Cloudflare's scheduled container example starts the box from a **Cron Trigger**
  ([Cron container](https://developers.cloudflare.com/containers/examples/cron/), updated
  2026-10-12). We use the brain's alarm instead, as decided, so the schedule also runs on a
  laptop.
- Cloudflare's examples list Workflow integrations. Banned for our logic by tea is the engine.
- Cloudflare's own "Run tests from a Git repository" guide is our shape in small: a Durable
  Object starts a box, runs `git clone --depth=1`, `npm ci` and `npm test`, each under a 600 s
  `timeout`, then destroys the box
  ([guide](https://developers.cloudflare.com/sandbox/commands/run-tests-from-a-git-repository/),
  updated 2026-10-22). In Sandbox SDK 1.0, `gitCheckout()` is gone; a clone is an `exec` of
  `git clone` ([migrate](https://developers.cloudflare.com/sandbox/sdk/migrate/outbound-traffic/)).

## The box: limits and price, from Cloudflare's pages

All from Cloudflare's docs, read 2026-11-02, with each page's own "last updated" date.

| What | Value | Source |
|---|---|---|
| Plan | Workers Paid ($5 a month), which the account has | [pricing](https://developers.cloudflare.com/containers/pricing/), 2026-10-05 |
| Included a month | 375 vCPU-minutes, 25 GiB-hours of memory, 200 GB-hours of disk | same |
| Past that | $0.000020 a vCPU-second, $0.0000025 a GiB-second, $0.00000007 a GB-second, "billed for every 10ms that they are actively running"; CPU on "active usage only", memory and disk on what is provisioned | same |
| Biggest box | `standard-4`: 4 vCPU, 12 GiB, 20 GB disk; custom up to the same, at least 3 GiB per vCPU | [limits](https://developers.cloudflare.com/containers/platform-details/limits/), 2026-11-02 |
| At once, per account | 1,500 vCPU, 6 TiB memory, 30 TB disk: 375 `standard-4` boxes | same |
| Instances per app | no `max_instances` under the `durable_object` policy (in public beta); "running instances count toward your account limits" | [scheduling policy](https://developers.cloudflare.com/containers/configuration/scheduling-policy/), 2026-10-12 |
| Image | `linux/amd64` only; up to the box's disk; 50 GB of images per account | [get started](https://developers.cloudflare.com/containers/get-started/), limits |
| Cold start | "often be in the 1-3 second range"; 148 measured 8 to 10 s for the first box after a deploy, 0.5 to 2.2 s after | [lifecycle](https://developers.cloudflare.com/containers/platform-details/), 2026-09-30; 148 |
| Run time | no fixed maximum, but "Cloudflare does not guarantee that an instance runs for a set time"; a stop sends SIGTERM and waits up to 15 minutes | [lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/), 2026-10-22; lifecycle |
| What keeps it alive | only the object's activity: "Code that runs inside the instance does not count as activity"; `setInactivityTimeout()` up to 6 hours | lifetime; DO Container API |
| Disk after a stop | gone; snapshots exist, in public beta, and expire after 30 days | lifetime |
| `exec` | "has no built-in timeout" | DO Container API |
| Local dev | needs "a Docker compatible CLI tool and Engine" | [local dev](https://developers.cloudflare.com/containers/guides/local-dev/), 2026-09-30 |

What this means for us:

- **Price per hour, worked out.** A busy `standard-4`: CPU 4 x 3,600 x $0.000020 = $0.288,
  memory 12 x 3,600 x $0.0000025 = $0.108, disk 20 x 3,600 x $0.00000007 = $0.005. About
  **$0.40 a box hour**, or $0.10 per vCPU hour. The plan's included use is worth about $0.73 a
  month (6.25 vCPU hours, 25 GiB hours, 200 GB hours), shared with agent boxes (ticket 51).
- **It can do the job.** Git, Node 26.13.0, pnpm 12.16.1 and Chromium go in the image. tsgo,
  oxlint and esbuild ship `linux-x64` builds on npm, so they run in the box. Java for TLC goes in
  the image too (139 used `tla2tools.jar` on Java 8).
- **A box can die mid-batch, and that is already handled.** No set run time means a batch must be
  short and safe to run twice. The queue's lease runs out, the batch is split, and its entries
  run again (fast and daily mutation). A batch of about 30 to 60 minutes of work keeps the cost of
  a lost batch small.
- **The beat stays.** 148's 5 s beat keeps the box's object awake. `setInactivityTimeout()`
  (newer docs, not tried here) may let the object sleep between beats; that is a small saving,
  not a change of shape. Object time stays inside the plan: a box object awake 2 hours a day at
  128 MB is about 27,000 GB-s a month, against 400,000 included and 144's projected 286,000.
- **No key goes in the box.** The repo is public, so the clone needs no token. A daily check calls
  no model and writes nothing to GitHub. Its only way out is its answer to its own object, which
  passes it to the brain. It keeps open internet for npm and GitHub, as 157 ruled.
- **Local dev of the cloud path needs Docker; the daily flow on a laptop does not.** On a laptop,
  hands run the batch as a child in `Sandbox.os`, with no container. Docker is only for testing
  the box path, as 148 and 157 did.

## The shape, in code

Three parts. The brain's queue program, one box object per batch, and one batch program that
both kinds of hands run.

```ts
// A sketch, not built. The data. Effect Schema in `next/`, shown as types.
type Job = "mutants" | "suite" | "tla"; // what one batch asks for
type Batch = {
	id: string; // "b-812"
	job: Job;
	commit: string; // main at the time the batch was cut: what the box clones
	entries: ReadonlyArray<Entry>; // fast and daily mutation's Entry: a Gap id and where it came from
	needs: ReadonlyArray<string>; // ["git", "node", "chromium"]: matched against a host's `has`
};
type Ran = {
	batch: Batch["id"];
	by: string; // "hands:mac-1" or "box:batch:b-812"
	results: ReadonlyArray<{gap: Gap["id"]; status: "killed" | "survived" | "no_cover" | "timeout"}>;
	spent: {wallMs: number; cpuMs: number}; // record wide: what a batch cost, every time
	said: number; // the hands' own clock; leases and the cap read only the brain's `at`
};
```

```ts
// A sketch. The brain's queue, a tea machine on its own alarm. It never runs a mutant.
type Model = {
	waiting: ReadonlyArray<Entry>;
	leases: ReadonlyArray<{batch: Batch; to: string; until: number}>;
	idle: ReadonlyArray<string>; // hands that said hello with the right `has` and hold no lease
	today: {day: string; boxMs: number}; // box time spent today, from `ran.spent` and lease ends
	cap: {boxMs: number}; // the owner's daily box cap: 1 hour = 3,600,000
};

const update = (model: Model, msg: Msg): readonly [Model, ReadonlyArray<Cmd>] => {
	switch (msg.type) {
		case "tick": {
			const batch = cut(model); // in order, leftovers before the sweep, repeats dropped by Gap id
			if (batch === null) return [model, [alarmAt(tomorrow(model))]];
			const hands = model.idle.find((h) => fits(h, batch.needs));
			if (hands) return [lease(model, batch, hands), [offer(hands, batch)]]; // free: the laptop
			if (model.today.boxMs + guess(batch) > model.cap.boxMs) return [model, [alarmAt(tomorrow(model))]];
			return [lease(model, batch, `box:batch:${batch.id}`), [startBox(batch)]]; // a new object, by name
		}
		case "ran": // from any hands, laptop or box: the same Msg
			return [settle(model, msg.ran), [...fileOrComment(newGaps(msg.ran)), alarmAt(soon)]];
		case "lease_ended": // a box died or a laptop slept
			return [requeue(model, split(msg.batch)), [alarmAt(soon)]];
	}
};
```

```ts
// A sketch. The box object: thin, as `next/` asks. One container, one batch, then gone.
export class HandsBox extends DurableObject {
	run(batch: Batch) {
		return Effect.runPromise(runBatch(batch).pipe(Effect.provide(cloudflareBox(this.ctx)))); // the one-line edge
	}
	alarm() {
		return Effect.runPromise(beat.pipe(Effect.provide(cloudflareBox(this.ctx))));
	}
}

// The logic is plain Effect. On Node, tests give it a fake `Box`; on Cloudflare, `ctx.container`.
const runBatch = (batch: Batch) =>
	Effect.gen(function* () {
		const box = yield* Box; // start, exec, destroy: the `Sandbox` service's shape
		yield* box.start({image: "daily", instance: "standard-4", enableInternet: true});
		yield* box.exec(["git", "clone", "--filter=blob:none", REPO, "/w"]);
		yield* box.exec(["git", "-C", "/w", "checkout", batch.commit]);
		yield* box.exec(["pnpm", "install", "--frozen-lockfile"], {cwd: "/w"});
		const ran = yield* box.exec(["node", "next/hands/run-batch.ts"], {cwd: "/w", stdin: batch}); // JSON lines, checked as Ran
		yield* Brain.ran(ran); // RPC to the brain's object, the same Msg the door carries
		yield* box.destroy();
	});
```

One example, made-up numbers:

```ts
// 03:00 the brain's alarm: 1,900 entries waiting. No hands connected.
// tick  -> cut b-812 (1,900 mutants, about 40 min on 4 vCPU) -> no idle hands -> today 0 of 3,600,000 ms
//       -> lease to "box:batch:b-812" -> startBox
// box object "batch:b-812": start 2 s, clone and install (not measured), run-batch 40 min, beat every 5 s
// ran   -> {batch: "b-812", by: "box:batch:b-812", results: [...1,900], spent: {wallMs: 2_640_000, cpuMs: 9_100_000}}
// brain -> 4 survivors in 2 symbols -> 1 new ticket, 1 comment; today 2,640,000 of 3,600,000 ms
// tick  -> cut b-813 -> its guess passes the cap -> alarm tomorrow. The rest waits in order.
// 08:30 a laptop says hello with has: ["git", "files", "agents", "node"] -> next tick offers it b-813, free.
```

What the laptop path and the Cloudflare path share:

| Part | Laptop hands | Box object |
|---|---|---|
| The queue, leases, Gap ids, tickets | the same brain program | the same |
| `Batch` and `Ran` | the same schemas | the same |
| `run-batch` | the same program | the same |
| Stryker's incremental file | from `Blobs`, back to `Blobs` | the same |
| Who starts it | the laptop's hands, after an `offer` | the brain, by naming a new object |
| The box | `Sandbox.os` | `ctx.container`, `standard-4` |
| The way back | the door | an RPC binding inside the account |
| Who it is on the ledger | the hands' own key | the box object's id, stamped by the brain, as 148's props were |
| Cost | free, while the laptop is up | about $0.40 a box hour past the plan |

So the new code for Cloudflare is the box object, its image, and the cap. Everything else the
queue needs anyway.

## What could run in the brain's object, with no box

Cloudflare's limits for the object itself, from the docs:

- 128 MB of memory per isolate. CPU per request: 30 s by default, up to 5 minutes on Workers
  Paid. An alarm handler: 15 minutes of wall time
  ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), updated
  2026-10-29).
- `node:child_process` and `node:worker_threads` are "non-functional stub" modules: they import,
  but do nothing ([Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/),
  updated 2026-08-12). So no git, no native binary, no Java, no Chromium in the isolate.
- The Vitest plugin (renamed from `@cloudflare/vitest-pool-workers`) runs test files inside
  `workerd`, but Vitest reads its config and runs global setup "using Node.js", then starts
  `workerd` processes ([isolation and concurrency](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/),
  updated 2026-10-12). It is a test tool for Worker code on a machine. A deployed object cannot
  drive it.
- Stryker cannot run there: "Test runners are run as child processes of the Stryker Node process"
  ([Stryker config](https://stryker-mutator.io/docs/stryker-js/configuration/)).

| Daily check | In the brain's object? | Why |
|---|---|---|
| PR watcher | yes | GitHub through `CodeHost`, facts to the ledger; already the plan |
| Stale lane | yes | the ledger only |
| TLA+ drift, reading runs as steps | yes | `stepsOf` is plain TypeScript over the ledger's log (139) |
| TLA+ drift, the TLC check | no, a box | TLC is Java; 6 to 9 s a lane (139), so it rides in the daily box |
| Docs drift | reading, yes | files through `CodeHost`, no clone; how it judges is 134's question |
| Laws of pure tea machines | maybe, untried | 173 ran `@demlik/tea` and Effect unchanged in a loaded isolate; but not Vitest: it would need a bundle of the laws and a small runner of our own |
| The whole test suite | no, a box | Vitest's Node side, files, child processes |
| Mutation sweep | no, a box | Stryker forks test runners |
| A window's end to end test | no, a box | needs Chromium; see below |

**A guess worth one spike later: mutation of pure code in an isolate.** Stryker puts every mutant
into one build and turns one on at a time, through a value like `global.activeMutant`
([Stryker 4, 2020-10-07](https://stryker-mutator.io/blog/announcing-stryker-4-mutation-switching/)).
Hands could build that once, and a Dynamic Worker (173's Worker Loader) could run the laws for
each active mutant. At list price that is cheap: 48 worker hours is about 173 million CPU ms, and
past the 30 million included, $0.02 a million is about $2.90
([Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/), updated
2026-06-11). Against it: only code with no Node, files or processes; our own test runner to write
and keep; 128 MB an isolate; isolate CPU may not match a laptop core either. Not for Tier 6's
first slice. Sure it works: 40%.

**End to end tests.** Today's app e2e runs Electron on macOS in CI (`check.yaml`, `runs-on:
macos-latest`) and gates each pull request, so it stays there. Containers are `linux/amd64`
only, so a macOS run cannot move to Cloudflare. In `next/` the window is a browser tab, so a daily
end to end run can drive headless Chromium inside the same box. Browser Rendering is the other
way: Workers Paid includes 10 browser hours a month, then $0.09 an hour
([pricing](https://developers.cloudflare.com/browser-rendering/pricing/), updated 2026-04-21).
It drives a remote browser at a URL, so the window must be served where Cloudflare's browser
can reach it. Not needed for a first slice.

## Cost of the daily run, as sized today

The inputs, each with its source:

- **First pass:** about 87,000 mutants, about 80% not static, about 2.5 s of worker time each:
  about 48 worker hours; "could be half or double" (181).
- **Daily, after the first pass:** only changed code and tests go in. Measured now: 70,091
  product TypeScript lines (tests left out) were added to main in the last 14 days, about 5,000 a
  day. At 181's 0.8 mutants a line and 80% not static, that is about 3,200 mutants, about 2.2
  worker hours a day. Mutants whose covering tests changed rerun too, which nobody has counted,
  so the daily range below is 2 to 7 worker hours. The last 14 days were busy; a quieter month is
  cheaper.
- **The rest of the daily box:** the whole suite once (CI's three shards on main: 171 + 187 + 241
  s, about 10 machine minutes, from fast and daily mutation) and TLC (seconds). About $2 a month.
- **Speed:** how fast a Cloudflare vCPU runs our tests against one laptop worker is not known.
  Below, "1x" means the same and "2x" means half as fast.
- **Setup per box:** clone, install and the first test run, not measured. About 5 minutes is a
  guess; it is why a batch should be 30 to 60 minutes long.

| Run | Laptop hands | Box objects, 1x | Box objects, 2x |
|---|---|---|---|
| First pass, once | free; about 16 hours of a laptop at full load (3 workers), or days of rolling batches beside a person's work | 12 box hours, about $4.80, plus setup; 12 boxes at once finish in about 1 to 2 hours | 24 box hours, about $9.60 |
| First pass, 181's range | free | $2.40 to $9.60 | $4.80 to $19.20 |
| Daily, 2 to 7 worker hours | free while the laptop is up | about $0.20 to $0.70 a day, $6 to $21 a month | $0.40 to $1.40 a day, $12 to $42 a month |
| Daily with a 1 box hour cap | free | at most $0.40 a day, about $12 a month; the rest waits | the same cap; more waits |

Measured later in [experiment 199](./199-box-live-run.md): a box worker is about 2.3x slower than a laptop worker, and setup is about 1 minute. At 2.3x: first pass about $11 ($5.50 to $22), daily about $14 to $48 a month.

- **The plan covers little of it.** What the plan includes is worth about $0.73 a month, and agent
  boxes share it.
- **The laptop takes cost off.** Each batch a person's hands take is free, and the queue offers
  them first. A day when the laptop is up most of the time costs close to nothing.
- **This pushes the bill past $5.** [We use the tools we build](../.decisions/0349-we-build-and-use-our-tools.md)
  says such a piece says so, with the number. The number is above: about $6 to $42 a month with no
  cap, or a cap the owner sets.

## The lean

- **What:** build the box object, its image and the daily cap in Tier 6, with the mutation queue.
  The PR watcher, the stale lane check and TLA+ step reading stay in the brain's object.
  Everything that needs a machine goes to one box object per batch. Laptop hands are offered each
  batch first.
- **Why:** it is Cloudflare's documented shape (one object per container) and OTP's (one process
  per worker, the supervisor only supervises). It reuses what 148 and 157 already ran: a box per
  job, started by its own object, with the beat. Nothing new is needed on the laptop side: the
  queue, the batch program and the schemas are the same. It needs no new account.
- **Cost to build:** the box object, its plain logic and its test fake, the image, the cap and
  "laptop first" in the queue. About 300 to 500 product lines and 200 to 350 test lines: 500 to
  850 written lines, 0.8 to 1.4 agent hours at 600 an hour
  ([agent hours](../docs/direction/agent-hours.md)), a `2` on the doubling scale. A guess: the
  queue itself is Tier 6's and not counted here.
- **Cost to run:** above. The owner picks the cap.
- **How sure: 70%.** The shape, about 85%. The doubt is the money: the speed of a Cloudflare
  vCPU against a laptop core, and the time to clone and install in a fresh box, set the price
  within about 2x, and neither is measured. Also, the `durable_object` scheduling policy is in
  public beta.
- **What would settle it:** one live run. One `standard-4` box clones main, installs, runs 181's
  fixed-seed sample of 150 mutants (seed 119120) and the whole suite once, under the beat, then is
  destroyed. Record wall time, CPU, memory peak and setup time against the same sample on the
  laptop. About 30 minutes of box time, under $0.50, about 1 agent hour.

**For the owner:**

1. Walk back the cost line in [scheduled jobs](../docs/direction/scheduled-jobs-on-the-host.md):
   a job that reads code runs on hands, and on Cloudflare its hands are a box that clones the
   public repo. Yes or no?
2. The daily box cap. 1 box hour a day is at most about $12 a month past the $5 plan; no cap is
   about $6 to $42 a month at the last 14 days' pace, plus $2.40 to $19 once for the first pass.
3. The one live run above, under $0.50, before Tier 6 plans the queue.

**The owner's answers, 2026-11-02:**

1. Yes. [Scheduled jobs](../docs/direction/scheduled-jobs-on-the-host.md) now says a job's hands
   can be a box on Cloudflare.
2. A daily box cap of 1 box hour, at most about $12 a month.
3. Yes to the live run, under $0.50. Its numbers go in a follow-up experiment.

**And one change to the lean: where a job runs is chosen, never balanced on its own.** "Laptop
first, a box only when no laptop takes it" was automatic load balancing, and that brings its own
problems. T3 Code does the same: auto balance is off by default, a person picks the machine when
starting a thread, and if they turn balancing on, each machine is set to Prefer, Normal, Less
often or Manual only, and "existing threads stay where they started"
([remote access](https://raw.githubusercontent.com/pingdotgg/t3code/main/docs/user/remote-access.md),
read 2026-11-02). So:

- An agent started from a window: the person picks its machine when they start it.
- A daily job has no start screen, so its config names where it runs: `laptop`, `box` or
  `laptop first`. `laptop` is the default, since it is free. A box is opt-in, under the cap.
- Every run records where it ran and who chose: `owner`, `config` or `auto`, so a later look at
  automatic placement has data.

The sketch's `tick` above offers idle hands first; with this change it reads the job's `runs`
setting first, and only `laptop first` does what the sketch shows.

## Who did what

Reading only. Cloudflare's docs were read on 2026-11-02, through its docs search and the pages
themselves; each claim carries its page's "last updated" date. Stryker's docs and blog for how it
runs. This repo's notes and experiments 139, 144, 148, 157, 171, 173, 174 and 181, and the
tracker's tickets 51 and 138. One measure was taken from git: product lines added to main in the
last 14 days. No part of today's fabrika ran, no box started, nothing was deployed, no model was
called. $0.

## What it cannot tell us

- **No box ran for this study.** Every price above is list price times a guess at use. The two
  guesses that matter most (vCPU speed, setup time) could each move the cost about 2x.
- **48 worker hours is itself a guess** from three files on a busy laptop (181), and the daily
  range adds an uncounted part: mutants rerun because their tests changed.
- **The last 14 days may not be a normal pace.** About 5,000 product lines a day is high.
- **Memory is not measured.** Four Stryker workers, each running Vitest, may not fit in 12 GiB.
  If not, a box runs three, and the cost per mutant goes up by about a third.
- **Install time and a cache are open.** A fresh `pnpm install` per box may be slow. A snapshot
  (public beta, 30 days) or a store baked into the image would cut it; neither is tried, and the
  installed size was not measured.
- **The `durable_object` scheduling policy is in public beta,** and Cloudflare does not promise how
  long a box runs. How often a box dies mid-batch in practice is not known; the lease handles it,
  at the price of running the batch again.
- **Laws in an isolate and mutation in an isolate are untried.** 173 ran tea and Effect in one,
  not fast-check or our laws.
- **This does not say how the ticket text is written.** Scheduled jobs say an agent writer files
  it; where that agent runs is outside this study.
