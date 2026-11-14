---
date: "2026-11-11"
scripts: "none; reading only"
summary: "Reading, not a measurement; `next/`'s `Ci` service and today's `check.yaml` jobs. Yes for 14 of 16 jobs with an image change; no for `e2e` (macOS). A job is a `standard-4` box (4 vCPU, 12 GiB) a Durable Object starts through Alchemy's Effect `exec`. At Cloudflare's list price (2026-10-05) a full run of about 4,900 job-seconds is about $0.39 to $0.55, so about $580 to $1,750 a month for one run per merge and about $3,400 if every pull request run moved; GitHub Actions is $0 for a public repo. GitHub Free runs 20 jobs at once; jobs waited up to 256 s to start in 8 runs. Lean, 70%: stay on GitHub, one $1 trial run. The owner chose the free route without the trial (0112). No box ran: speeds and dollars are list price times GitHub's seconds at a guessed 60% CPU share. Agent time only, $0."
---

# 261. Can our CI checks run on Cloudflare Containers instead of GitHub Actions?

Read on 2026-11-11. **This is reading, not a measurement.** Nothing was deployed, no account was
touched and no money was spent. It is about `next/`'s `Ci` service, plus today's GitHub Actions
jobs in `.github/workflows/check.yaml`. The owner decided the same day not to pay for CI
([0112](../.decisions/0112-checks-run-on-free-ci.md)); this write-up is the reading that decision
rests on.

**The answer: yes for 14 of the 16 jobs, with an image change; no for `e2e`.** Each job would be a
container that a Durable Object starts, runs one command in, and destroys. Alchemy already wraps
this in Effect. But at our pace it costs real money where GitHub is free: about **$0.39 to $0.55
per full run** at list price, and **roughly $580 to $3,400 a month** at the last three days'
volume. What it buys is no 20-job cap. That cap is what makes a run queue now: jobs waited up to
256 s to start in 8 recent pull request runs, which works against the five-minute budget of
[0106](../.decisions/0106-a-pull-requests-checks-finish-in-five-minutes.md).

The lean was one small paid run of about $1 to learn the speed, then decide, at 70%. The owner
chose the free route instead: keep the checks on GitHub Actions and meet 0106 with free fixes.

```ts
// A sketch, not built. Names from @alchemy.run/cloudflare 2.0.0-beta.84 (installed; the lockfile says beta.85).
export class CiBox extends Cloudflare.Container<CiBox>()("CiBox", { main: "./ci-box", instanceType: "standard-4" }) {}

// Inside the job's own Durable Object, one per job, named by job id:
const box = yield* CiBox;
yield* box.start({ enableInternet: false, env: { SHA: job.sha, SHARD: "3/6" } });
const proc = yield* box.exec(["timeout", "--kill-after=5", "600", "pnpm", "exec", "vitest", "run", "next/", "--shard", "3/6"]);
const code = yield* proc.exitCode; // a nonzero code comes back as a value, not an error
// stdout and stderr are Streams: they go to Blobs by hash, and the result goes to the ledger.
```

## What Cloudflare offers today

All pages read on 2026-11-11.

- **Two products, one engine.** Containers are Linux images that a Durable Object starts. "Each
  container instance runs in a Firecracker microVM with its own kernel and network"
  ([architecture](https://developers.cloudflare.com/containers/concepts/architecture/)). The
  Sandbox SDK sits on top. Its 1.0 is now thin: 0.x's `exec()` maps to the native
  `container.exec(argv)`, which "returns bytes and exitCode"
  ([API map](https://developers.cloudflare.com/sandbox/sdk/migrate/api-map/), updated 2026-10-23).
- **Sizes.** Six fixed sizes, up to `standard-4`: 4 vCPU, 12 GiB, 20 GB disk. Custom sizes are
  open to everyone since 2026-01-05, but "individual limits ... are based on the `standard-4`"
  ([changelog](https://developers.cloudflare.com/changelog/post/2026-01-05-custom-instance-types/)).
  These "can be increased" on request
  ([limits](https://developers.cloudflare.com/containers/platform/limits/), updated 2026-11-10).
  Disk is no longer tied to memory since 2026-09-29
  ([changelog](https://developers.cloudflare.com/changelog/post/2026-09-29-remove-disk-to-memory-ratio/)).
- **Run time.** No fixed limit: "Cloudflare does not stop a container instance after a fixed
  maximum runtime." A host restart can stop one, with SIGTERM, up to 15 minutes, then SIGKILL
  ([FAQ](https://developers.cloudflare.com/containers/faq/)).
- **Cold start.** Cloudflare says "often ... in the 1-3 second range" (architecture page).
  [Experiment 148](./148-remote-programs.md) measured 8 to 10 s for the first box after a deploy
  (once 30 s), then 0.5 to 2.2 s. That was a small image. A CI image with `node_modules` is much
  bigger, and nobody has timed one.
- **How many at once.** Per account: 1,500 vCPU, 6 TiB memory, 30 TB disk, and 50 GB of image
  storage (limits page). Wrangler's `max_instances` defaults to 20 per app and can be raised. That
  is 375 `standard-4` boxes at once.
- **Network.** `enableInternet: false` closes the box. Outbound HTTP can be caught by a Worker.
  Egress costs $0.025 per GB in North America and Europe, with 1 TB included
  ([pricing](https://developers.cloudflare.com/containers/platform/pricing/)). Docker-in-Docker
  works once deployed (`docker:dind`, iptables off) (FAQ), but not under local dev
  ([DinD guide](https://developers.cloudflare.com/sandbox/sdk/guides/docker-in-docker/)).
- **How the code gets in.** Three ways: `git clone` inside the box, an upload from the Worker, or
  an R2 bucket mounted with FUSE. Cloudflare's own guide clones inside, then `npm ci`, then
  `npm test`, each under `timeout ... 600`, with `enableInternet: true`
  ([guide](https://developers.cloudflare.com/sandbox/commands/run-tests-from-a-git-repository/),
  updated 2026-10-22). Disk snapshots can keep `node_modules` between runs
  ([snapshots](https://developers.cloudflare.com/containers/guides/snapshots/)).
- **Logs and exit codes.** `exec` gives stdout and stderr as streams and an exit code. A timeout
  shows as 124 or 137. `output()` holds all of it in the object's memory, so a noisy test run
  should stream instead (same guide).
- **Price on Workers Paid** (pricing page, updated 2026-10-05). CPU: $0.000020 per vCPU-second,
  billed on "*active usage* only". Memory: $0.0000025 per GiB-second. Disk: $0.00000007 per
  GB-second. Memory and disk are billed for what is provisioned. Included each month: 375
  vCPU-minutes, 25 GiB-hours and 200 GB-hours, which covers about two of our full runs.

## Can our jobs fit?

Our numbers, from GitHub's own run data. A full main run on 2026-11-11 spent **4,337 Linux
job-seconds**: `check` 178 s, six `test` shards 438 to 694 s, six `next` shards 117 to 211 s,
`changes` 20 s, `field` 35 s. Four full pull request runs spent 4,779 to 4,959 s and took 15 to 18
minutes from first job to last. A GitHub runner for a public repo has 4 CPUs and 16 GB
([GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)): the same
core count as `standard-4`, with 4 GB more memory.

| Job kind | Fits? | Why |
|---|---|---|
| `changes`, `field` | fits | Small Node scripts. A `basic` box is enough. |
| `check` (typecheck, lint, build) | fits, maybe slower | `tsgo` gets 4 cores, as on GitHub today, which ran it in 178 s. Memory drops from 16 GB to 12 GiB, and nobody has measured `tsgo`'s peak. |
| `test` shards | fits with a change | The apt step (expect, zsh, bubblewrap, socat, ripgrep) moves into the image. Unknown: whether bubblewrap gets user namespaces inside Firecracker, and whether [0045](../.decisions/0045-test-steps-run-in-containers.md)'s Docker tests run under DinD with host networking only. |
| `next` shards | fits with a change | workerd through Alchemy is a plain linux/amd64 binary. Chromium goes into the image. |
| `e2e` | cannot | It runs on `macos-latest` (Electron, keychain, launchd). Cloudflare runs "Linux only" ([Diffinery's notes](https://diffinery.com/docs/actions/compatibility)). |

## What it would cost

Dollars at Cloudflare's list price (pricing page, updated 2026-10-05, read 2026-11-11). Take 4,900
job-seconds on `standard-4`, and leave out the included amounts, since they cover about two runs a
month.

- Memory: 12 GiB × 4,900 s × $0.0000025 = **$0.147**.
- Disk: 20 GB × 4,900 s × $0.00000007 = **$0.007**.
- CPU at 60% busy (a guess): 2.4 vCPU × 4,900 s × $0.00002 = **$0.235**. At 100% busy it is
  $0.392.
- **Total: about $0.39 to $0.55 a run**, roughly $0.29 per box hour. Part of GitHub's 4,900 s is
  setup (Node, pnpm install, apt), which a baked image would cut, so this is an upper estimate for
  the same work, at an unknown Cloudflare vCPU speed.

Per month. On 2026-11-10 there were 544 check runs and 151 merged pull requests. The 8 sampled pull
request runs averaged about 2,600 Linux seconds, since many skip jobs.

- Every pull request run: 544 × 2,600 s × about $0.000079 a second ≈ $112 a day, **about $3,400 a
  month**.
- One full run per merged pull request, which a merge queue needs: 151 × 4,900 s × $0.000079 ≈ $58
  a day, **about $1,750 a month**. At 2026-11-08's pace of 50 merges a day, it is about **$580**.
- Right-sizing cuts it. Most `next` shards would fit `standard-3` (2 vCPU, 8 GiB). A merge queue
  that groups changes runs fewer times.

Against GitHub Actions: **$0** on standard runners for a public repo
([billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), read
2026-11-11). The Free plan allows "20 total concurrent jobs, with a maximum of 5 concurrent macOS
jobs", and a job can run 6 hours ([limits](https://docs.github.com/en/actions/reference/limits)).
One full run is 16 jobs, so two pull requests at once already go over 20. In our 8 sampled runs,
the longest wait for a runner was 3 to 256 s (median about 190 s). That wait alone is most of
0106's five minutes.

## Who already does this

- **Cloudflare's own CI SDK** (`@cloudflare/ci`, about 2026-08-04). It runs pipelines as Workflows
  over Artifacts repos, one sandbox per step, with dependencies cached as a snapshot in R2. No
  GitHub trigger, no merge queue, no price given, and Artifacts is in private beta
  ([blog](https://blog.cloudflare.com/ci-workflows/)). Its engine is Workflows, which
  [experiment 174](./174-effect-on-cloudflare.md)'s ruling set aside: tea is the engine.
- **A Cloudflare staff proof of concept: one sandbox per GitHub Actions job**
  ([gist](https://gist.github.com/elithrar/082344e39d8a10c5d48b93075554ce89), active 2026-08-20).
  It registers a one-job runner on `standard-1` with rootless Docker inside. What broke:
  "Cloudflare Containers cannot manipulate iptables, so runner-managed containers use host
  networking"; service `ports:` do not work; a lost callback can leave a box running.
- **Diffinery** ([repo](https://github.com/codician-team/diffinery), Apache-2.0, created
  2026-10-25). A GitHub-like forge on Cloudflare, with "a merge queue with `merge_group` runs" and
  Actions YAML run "unchanged", each job "a fresh Ubuntu 24.04 container on Cloudflare
  Containers". A repo that stays on GitHub can use `runs-on: diffinery`
  ([GitHub runners](https://diffinery.com/docs/actions/github-runners)). Limits: Linux x64 only, no
  browsers preinstalled, jobs run as root, and for public repos "Anyone who opens a pull request
  can change a workflow", which spends the owner's minutes. It is two weeks old.
- **Crabbox** ([Cloudflare provider](https://crabbox.sh/providers/cloudflare.html)). A remote-run
  tool: a gzipped tar of the repo goes up, one Durable Object per lease, stdout, stderr and the
  exit status come back. It reports cached-image cold starts of "about 1–2 seconds". Its cleanup
  cannot find boxes without a local claim.
- **Runner vendors on their own machines:** Blacksmith, Depot, Namespace. They sell faster, cheaper
  GitHub runners for private repos, around $0.004 a minute for 2 vCPU
  ([Better Stack comparison](https://betterstack.com/community/comparisons/namespace-alternatives/)),
  about the same as our $0.29 per 4-vCPU hour. No help to a public repo, which GitHub runs free.
- **Sandboxes used as CI:** e2b documents a pull request flow
  ([e2b CI/CD](https://e2b.dev/docs/use-cases/ci-cd)). Dagger runs pipelines in containers on any
  engine ([docs](https://docs.dagger.io/)). Earthly closed its hosted Satellites in 2025 (a guess,
  from memory, not checked).

What they share: one fresh box per job, the repo cloned or uploaded in, and the exit code plus a
log stream back. What breaks is the same set each time: no macOS, no iptables, cleanup when a
callback is lost, and public pull requests spending someone's money.

## How Alchemy exposes it, and how it fits our shapes

Read from `@alchemy.run/cloudflare` 2.0.0-beta.84's `src/Containers/`, the installed tree. The
lockfile pins beta.85, so the install was stale.

- `Cloudflare.Container<Self>()("Name", props)` declares a container from a Dockerfile, an Effect
  `main` or a remote image, with `instanceType`, `vcpu`, `memory`, `disk` and `maxInstances`.
- Inside a Durable Object, `yield* MyBox` gives a client with `start`, `destroy`, `monitor`,
  `snapshotContainer`, `setInactivityTimeout` and `exec(argv)`. `exec` returns a scoped process
  with `stdout` and `stderr` as `Stream<Uint8Array>` and `exitCode` as an Effect, where "Nonzero
  exit codes are returned normally". Closing the scope sends SIGKILL. All of it is Effect, so
  [0042](../.decisions/0042-platform-pieces-go-through-alchemy.md) and "no Promises" hold with no
  edge comments.
- Errors are typed (`NoContainerInstanceError`, `ContainerRateLimitedError`,
  `ContainerCrashedError`, `ContainerNotRunningError`), so a CI Layer could map them to `stuck`
  rather than red.
- On a laptop with no cloud account it runs on local Docker, as experiment 148 did in 0.4 to 0.7 s.
  DinD does not run locally, and `max_instances` is not enforced there.

It would fit as both shapes at once. `Ci.cloudflare` is one more Layer of the `Ci` service in
[services and our own CI](../docs/direction/services-and-our-own-ci.md), so a stage never knows
where a check ran. Each box is a `hands` client started on demand, which takes one job with
`jobs.take` ([0102](../.decisions/0102-hands-is-a-grant-rank-and-work-is-taken.md)), the shape
[experiment 197](./197-daily-checks-on-cloudflare.md) drew for the daily checks. A box that reports
by calling out keeps [0105](../.decisions/0105-a-durable-object-never-stays-awake-on-its-own.md):
the job's object need not stay awake polling.

What building it now would undo: the services note defers our own CI hosts, and says "Money saved
is small for public repos". Here money goes up, by hundreds to a few thousand dollars a month. A
CI pool also needs a lost box's job retried by code, which pulls part of 0102's Tier 4 forward.

## The lean, and what was decided

**The lean: keep GitHub Actions for the merge queue's checks, and spend about $1 on one run to
learn the speed and cold start. 70% sure.** GitHub is free and already runs all 16 jobs, `e2e`
included. The real pain is the 20-job cap, and two cheaper fixes come first: fewer, fatter jobs,
and a baked or cached setup. The run would have been 10 box runs × 300 s × $0.000079 ≈ $0.25 plus
image storage: `pnpm typecheck` once and `vitest run next/ --shard 1/6` five times on
`standard-4`. A first stage would be built only if a shard's median wall time came in at most 1.2×
GitHub's (211 s for `next (1)`, 178 s for `check`) and the first output came within 15 s.

**Decided:** the owner took the free route without the paid run
([0112](../.decisions/0112-checks-run-on-free-ci.md)). The checks stay on the code host's free CI,
0106 is met with free fixes, and where checks run stays one `Ci` Layer. The doubts below were not
settled, because nothing ran:

1. How fast a Cloudflare vCPU runs our tests and `tsgo` against a GitHub 4-CPU runner.
2. The cold start of a multi-GB image holding `node_modules` and Chromium.
3. Whether bubblewrap's user namespaces and DinD work inside Firecracker for the `test` shards.
4. Whether a 10-minute job runs with the object asleep (0105).

This study cost only agent time: one agent reading, no model call of its own and no paid run.

## What it cannot tell us

- No box ran. Every Cloudflare speed and cost here is list price times GitHub's job seconds, at a
  CPU-busy share that is a guess (60%). The real bill could be half or double.
- The monthly figures come from three days that grew fast (167, 378 and 544 runs). They are not a
  steady pace.
- The beta.85 Alchemy source was not read; the installed tree was beta.84.
- Whether GitHub's merge queue accepts a required status posted by our own app on the
  `merge_group` commit is from memory (a guess). Diffinery's runner mode suggests it works, but
  GitHub's page was not checked.
- Diffinery and Cloudflare's CI SDK are weeks old. Their claims are not field reports.
- The runner wait of up to 256 s is from 8 runs only. How much of it the free fixes can cut is not
  measured here.
