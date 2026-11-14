---
date: "2026-11-10"
scripts: "none; reading plus a count of our own timestamps, nothing ran"
summary: "Today's lead tooling. Stripe's 10 s is a pool of devboxes made ahead (Minions parts 1 and 2, quoted); Ramp, Cursor, Devin, Firecracker, Cloudflare Containers compared. Our step took 1.5 to 3 min from start to first tool call (Claude median 103 s on clean drive logs, 178 s from lane state files; Codex 152 s). Clone, checkout and install were 6 to 9 s, the model's start 3 to 7 s; the other 90 to 150 s went to `box.sh gc` and the start checks before the clone. Three cuts: gc on a timer (taken as 0101), a warm shared-ticket index, a small pool with early reads. Snapshot restore not worth it at a 6 s build. Per-phase split not timed. No model, $0."
---

# 267. How does a devbox start in seconds, and where do our step's first minutes go?

Read and counted on 2026-11-10, landed 2026-11-11. **This is reading plus a count of our own
timestamps, not an experiment run:** no box or container was started for it, and nothing in the
repo changed. **Every claim about our boxes is about today's lead tooling** (`drive.ts`, `chain.ts`,
`box.sh`) running steps for both versions. It is the evidence behind
[0101](../.decisions/0101-box-cleanup-runs-on-a-timer.md), which moved the box cleanup off the
step's start path. One agent read; no model was called beyond it, $0.

**The answer: Stripe's 10 seconds is "take a box from a pool that is already made", not "build a
box".** Ours takes about 1.5 to 3 minutes from a step's start to the agent's first action, and
almost none of that is building the box. Clone, checkout and install take about 6 to 9 s. The
model's own start takes 3 to 7 s. The other 90 to 150 s went to checks that ran before the clone:
the box cleanup (`box.sh gc`) and the start checks in `box.sh new`. So the first cut was not a
faster box. It was moving the checks off the start path, which 0101 did.

```text
step start ──90 to 150 s: gc, disk check, plan check, fetch, shared-ticket scan──> clone
clone ──6 to 9 s: clone, checkout, pnpm install──> agent start ──3 to 7 s──> first tool call
```

## How Stripe does it

Sources: Stripe's "Minions" part 1 (stripe.dev, 2026-02-09) and part 2 (stripe.dev, 2026-02-19).
Each claim we had about Stripe, checked against their words:

| Claim | Verdict | Stripe's words |
|---|---|---|
| About 10 seconds | Confirmed | Part 1: "Devboxes are pre-warmed so one can be spun up in 10 seconds". Part 2: "we aim for it to be ready within 10 seconds" |
| A pool warmed ahead of time | Confirmed | Part 2: "we proactively provision and warm up a pool of devboxes" |
| Repo already checked out | Confirmed | Part 2: "cloning gigantic git repositories"; after 10 s the box is "checked out to a recent copy of master across all of Stripe's main repos" |
| Build and type-check caches warm | Confirmed | Part 2: "warming Bazel and type checking caches" |
| Code generation services warm | Confirmed | Part 2: "starting code generation services that continually run on devboxes" |
| Start is "hand out a ready one" | Confirmed in effect | The pool is warmed ahead, so a request takes a ready box. Stripe does not use the words "hand out" |
| Isolated from production and the internet | Confirmed | Part 1: "isolated from production resources and the internet". Part 2: no "real user data, Stripe's production services, or arbitrary network egress" |
| So agents run without prompts | Confirmed | Part 1: "without human permission checks". Part 2: "run the agent with full permissions and skip confirmation prompts" |

More from Stripe:

- A devbox is "an AWS EC2 instance that contains our source code and runs services under
  development" (part 2).
- It was built for people first, "long before LLM coding agents existed" (part 2).
- Part 1 turns down worktrees for their size: "without the overhead of something like git
  worktrees, which wouldn't scale at Stripe."
- Devboxes run in Stripe's QA setup (part 2).
- Older background, secondary: an ex-Stripe engineer's blog (2024-05-21) says "a number of warm
  spares were kept". A Stripe talk, "Building and Scaling Developer Environments at Stripe" (InfoQ,
  QCon London), covers devboxes too. Not watched.
- Not found: any Stripe number for how big the pool is or how often it refills.

## What others do

| Who | How | Number the maker gives |
|---|---|---|
| Ramp (background agent on Modal) | A scheduled job clones each repo, installs and builds, then saves a file-system snapshot. A session starts from the snapshot and syncs only the newest commits | Ramp: "We build these images every 30 minutes", so the code is at most 30 min old. Modal (2026-02-19): sessions "start working on a prompt in a few seconds" |
| Ramp, two more habits | Warm a sandbox while the person is still typing. Let the agent read files before the sync ends, and block edits until it ends | Ramp: "keep a pool of warm sandboxes for any high-volume repositories" |
| Cursor cloud agents | Snapshot, Dockerfile or agent-led setup in `.cursor/environment.json`. Builds "prepare each environment in the background" | No number on the docs page |
| Devin | One snapshot per org, "a frozen, bootable image that every session starts from", with repos cloned and deps installed. A fresh copy boots for each session | No number on the docs page |
| Firecracker snapshot restore | Memory is mapped and loaded page by page as it is touched (copy-on-write) | Firecracker docs give no number. A Firecracker-team blog (Brooker, about 2022-11-29): restore "in as little as 4ms", about 10 ms for a full Linux. The docs warn that restoring one snapshot many times repeats random seeds and tokens |
| Copy-on-write files | macOS `cp -c` uses `clonefile(2)`. pnpm hard-links or clones packages from one store | No time number from the makers |
| git worktrees on a warm host | A new checkout shares one object store | No number. Stripe says it would not scale for them; it does fit one laptop |
| Cloudflare Containers | A container starts on a pre-made host | Cloudflare FAQ: cold starts "often in the 1-3 second range", depending on image size. Secondary (2026-07 benchmark): median about 2 s, tail out to about 50 s |
| Cloudflare Sandbox SDK | Built on Containers | The product page says "milliseconds". A secondary review says that figure is for V8 isolates, not full Linux sandboxes. Not checked further |

## What our step's box cost on 2026-11-10

Read: the box script, the drive and chain scripts, the mutation box script and
[0045](../.decisions/0045-test-steps-run-in-containers.md). Then four clocks were joined:

- step start: when the drive log was created, or else the previous step's end in the lane's state
  file
- clone start: when the box's git data folder was created
- agent start: the first timestamp in the agent's own transcript
- first action: the first tool call in that transcript

Results, in seconds (p10 / median / p90):

| Span | Codex steps | Claude steps |
|---|---|---|
| Step start to first action, clean drive logs | none with a drive log | 24 steps: 91 / 103 / 181 |
| Step start to first action, from lane state files, under 30 min | 116 steps: 106 / 152 / 559 | 271 steps: 120 / 178 / 901 |
| Step start to clone start | 2 steps: 86 / 91 / 97 | 12 steps: 93 / 155 / 1479 |
| Clone start to agent start | 4 steps: 6 / 7 / 18 | 16 steps: 6 / 9 / 16 |
| Agent start to first tool call | 287 runs: 5.0 / 7.1 / 8.7 | 337 runs: 1.2 / 3.3 / 7.0 |

Inside the box itself, from 33 boxes still on disk:

- clone and checkout: about 2.3 to 3 s (the clone uses the main checkout as a reference)
- `pnpm install`: about 2 to 4 s, since the store is warm and files are linked, not copied

What filled the 90 to 150 s before the clone, read from the code as of 2026-11-10 (each part was
not timed on its own):

1. `box.sh gc` ran first on every start. It looked at every box, about 140 kept on each run, and
   printed one line each. It also cleared Docker leftovers.
2. A free-disk check.
3. `box.sh new` ran the plan check, then `git fetch origin`.
4. Then the shared-ticket scan. It walked every branch (1,608 refs that day) and read the commit
   notes on each, and asked GitHub for the open PRs. The code's own comment said this scan "takes a
   minute or more on the main checkout".

*Rechecked on main, 2026-11-11:* item 1 is gone. `drive.ts` no longer runs `box.sh gc`; a timer and
each merge do, through `gcloop.ts` (`drive.ts:29`, [0101](../.decisions/0101-box-cleanup-runs-on-a-timer.md)).
The "minute or more" comment is no longer in `box.sh`, and the shared-ticket check has changed
since; its time today was not measured again.

Containers: on 2026-11-10 only the mutation step used Docker. Its image is tagged by a hash of the
lockfile, so it builds once per lockfile, and since
[0066](../.decisions/0066-mutation-runs-on-a-schedule.md) mutation is no step of the chain. Test
and build steps ran in the agent's own sandbox, not a container. Several drive logs ended stuck on
`listen EPERM` or `spawnSync ps EPERM` for that reason. So 0045's container was not yet on most
steps' start path. When it is, Cloudflare's 1 to 3 s and Docker's start add to the start time.

## Three ways to cut the start time

### 1. Run gc on a timer, not on every start (Ramp's scheduled rebuild)

- Change: drive stops calling `box.sh gc` before each step. A scheduled job runs it every 15 to
  30 min, like Ramp's 30-min rebuild. Drive keeps only the free-disk check.
- What is lost: a box that finished since the last sweep stays on disk a little longer.
- The repo bans hooks, not schedules, but "drive runs gc on start" was written in AGENTS.md, so
  this needed the owner's yes.
- How to measure: timestamps around gc in the drive log; compare step start to clone start across
  20 steps before and after.
- **Taken:** the owner decided it as [0101](../.decisions/0101-box-cleanup-runs-on-a-timer.md), and
  `gcloop.ts` runs it every `GC_MINUTES` (default 30) and after each merge. The study's lean said
  drive would run gc itself when disk is low; 0101 decided the opposite, a step that finds no room
  fails with that reason and starts no cleanup of its own.

### 2. Keep the shared-ticket answer warm (Stripe's warm caches)

- Change: keep a small index from each branch tip to the tickets its notes name. Fill it once. On
  each start, read only the refs whose tip moved since the last read, and cache GitHub's open-PR
  list for a minute. The refusal rule stays the same; only its input is cached.
- What is lost: a cache can be wrong. Key it by tip commit, so a moved branch is always read fresh.
  Fall back to the full scan when the index is missing or unreadable.
- Measure: time the scan alone in `box.sh new`, logging refs read and seconds per start. Expect the
  60-plus seconds to drop to a few.

### 3. A small pool of ready boxes, and let the agent read early (Stripe's pool, Ramp's read-before-sync)

- Change: keep 2 or 3 boxes already cloned at `origin/main` and installed. `box.sh new` takes one,
  renames it, fetches the lane's head and checks it out, then runs an offline install. In parallel,
  start the agent on the plan and the files as soon as the box exists. Hold its first commit until
  every start check has passed, as Ramp blocks edits until sync ends.
- What is lost: each spare box costs about 2 GB on disk (gc removed one of 1,951 MB). A start check
  that refuses after the agent has begun wastes those tokens. Starting early also reverses today's
  order, where nothing runs before the checks pass, so it needs the owner's yes. The pool alone
  saves only about 6 s; the early start is the larger part.
- Measure: log step start, box ready and first tool call in one row per step. Compare medians over
  at least 20 steps per agent kind.

### Not worth it yet

Snapshot restore (Firecracker, Devin) and copy-on-write clones solve a box that takes minutes to
build. Ours takes about 6 s to build. Revisit when 0045's container is on every step's start path.

## What it cannot tell us

- How the 90 to 150 s split between gc, the fetch and the scan. That needs timestamps per phase.
- Only 2 Codex steps had both a step-start clock and a clone clock. The Codex medians lean on the
  lane state files, which measure from the previous step's end and so include any wait between
  steps. That is why their tail is long.
- Box timings come from file creation times on one laptop. Boxes that gc removed left no folder, so
  the inside-the-box numbers come only from the 33 still on disk.
- The secondary numbers (Cloudflare's tail, the Sandbox SDK, the Firecracker blog) were not checked
  against a run of our own.
- How much 0101 saved per start. The step-start numbers after it were not counted here.
