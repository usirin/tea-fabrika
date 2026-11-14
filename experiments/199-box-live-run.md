---
date: "2026-11-02"
scripts: "`199-box-live-run.ts`, `199-box-live-run/`, `results/199-box-live-run*.json`"
summary: "Two live `standard-4` boxes, for `next/`, testing today's code at main; no model. A box is ready to test in about 45 s from its start call (clone 6 s, install 28 to 30 s), not 197's guessed 5 minutes; the first mutant answer comes at about 85 s. On 181's `lane139` set, same answer on all 116 mutants, a box worker is about 2.3x slower than a laptop worker (mutant time 157 s against 70 s; median 2.7x; wall 2.0x with 4 box workers against 3). 4 workers peaked at 2.2 GiB of 12 GiB; the whole suite at 4.3 GiB. 181's `ship121` sample gave no answer: the box's user holds full ambient capabilities, so bubblewrap refuses to start, the lane's end-to-end tests fail and Stryker's first test run stops. The suite failed 111 of 5,224 tests and mostly waited (16% CPU). 197's range moves to about $11 for the first pass ($5.50 to $22) and $14 to $48 a month daily. $0.14 at list price for both runs; two platform-made registry artifacts are left (409, as in 148)."
---

# 199. One live box on Cloudflare: setup time, speed and memory for 197's daily checks

Done 2026-11-02. This measures for experiment 197, which is about `next/`. The code the box tested
is today's version at main (commit `44db4b49`). Two live `standard-4` boxes ran on Cloudflare, under
148's setup: one box per job, started by its own Durable Object, with the 5 s beat. No model was
called. Cost: **$0.14 at list price** for both runs.

**Answer: a box is ready to test in about 45 seconds, and one of its workers is about 2.3 times
slower than one laptop worker.** Memory is not a limit: 4 workers used about 2.2 GiB of 12 GiB.
But 181's ship sample cannot run in a box yet, because the OS sandbox does not start there.

- **Setup is about 1 minute, not 5.** From the call that starts the box: about 11 s until the box's
  program runs, then clone 5.7 s, install 27.7 s and 181's `sets` 1.3 s. Stryker starts about 47 s
  after the call, and its first mutant answer comes about 85 s after it, on `lane139`. 197 guessed
  5 minutes.
- **A box worker is about 2.3x slower than a laptop worker.** Same commit, same 116 mutants of
  181's `lane139` set, the same answer on every mutant: 157 s of mutant time on the box against
  70 s on the laptop (2.3x). The median mutant took 0.70 s against 0.26 s (2.7x). Wall time was
  153 s with 4 box workers against 76 s with 3 laptop workers (2.0x). The laptop is an M2 Max under
  other agents' load (mean 7.4); the box is 4 vCPU of an AMD EPYC.
- **4 workers fit 12 GiB with room.** Stryker with 4 workers peaked at 2.2 GiB used. The whole suite
  peaked at 4.3 GiB. The laptop's `ship121` run with 3 workers peaked at 2.1 GiB, summed over its
  processes.
- **The ship sample did not run.** In the box, the user holds a full set of capabilities, and
  bubblewrap (the OS sandbox) refuses to start: "Unexpected capabilities but not setuid". The
  lane's end-to-end tests need the sandbox, so Stryker's first test run fails, and `ship121` gave
  no answer. `lane139`'s tests do not need it, so the second run used `lane139`.
- **197's cost range moves up by about 2.3x.** First pass about $11 (range $5.50 to $22), daily
  about $14 to $48 a month at the last 14 days' pace. The 1 box hour daily cap stays at $12 a month,
  but now covers less work. Details below.
- **Two small things are left on Cloudflare.** One platform-made artifact per deploy, which the
  registry refuses to delete (409), the same as in 148. Everything else was destroyed and checked
  by listing.

## How it ran

| Run | Set | Suite | Box time | Active CPU | List price |
|---|---|---|---|---|---|
| 1 | `ship121` (gave no answer) | the whole suite, once | 2,158 s | 2,690 s | $0.122 |
| 2 | `lane139` (sandbox probe first) | skipped | 214 s | 485 s | $0.016 |
| Laptop, `ship121` | 3 workers | none | 529 s wall | 892 s | free |
| Laptop, `lane139` | 3 workers | none | 76 s wall | 189 s | free |

- **The box program** (`199-box-live-run/box/run-all.mjs`) runs each phase under GNU `time` and
  reads `/proc/stat` and `/proc/meminfo` each second. It writes everything to one JSON file, which
  the box's object reads with `exec`. The object then destroys the box.
- **The driver** (`199-box-live-run.ts`, with `199-box-live-run/live.ts`) ran Alchemy's plan first
  and printed it, then deployed, started the box, polled every 15 s, stopped, destroyed and swept.
  It ran from a fresh temp folder that is deleted afterwards, since Alchemy's state holds the
  account id.
- **The sample** is 181's own script, `sets` then `run <set> fast`, with `concurrency` set to 4
  on the box and 3 on the laptop. Run 2 added Stryker's own log at level `info`, to see why a run
  ends early.
- **The laptop twin** ran in a throwaway worktree at the same commit, under `nice -n 15`.
- **Before each paid run,** the same image ran in local Docker on the laptop as a rehearsal
  (`results/199-box-live-run-rehearsal.json`). Run 2's new path was rehearsed the same way first.

```sh
# run 2, as run (the first run was the same with SET=ship121 and SUITE=all)
SET=auto SUITE=skip RUN=2 COMMIT=44db4b49150d07c898a647831975b143adac4781 \
  node experiments/199-box-live-run.ts live
SET=lane139 COMMIT=44db4b49150d07c898a647831975b143adac4781 \
  nice -n 15 node experiments/199-box-live-run.ts laptop
```

## Setup time

| Step | Run 1 | Run 2 |
|---|---|---|
| Deploy (only when the image changes) | 178 s | 60 s |
| Start call until the box's program runs | 10.7 s | 11.6 s |
| Sandbox probe | not run | 0.1 s |
| Clone (`--filter=blob:none`, no token) | 6.6 s | 5.7 s |
| `pnpm install --frozen-lockfile` | 30.1 s | 27.7 s |
| 181's `sets` | 1.2 s | 1.3 s |
| Stryker starts, after the box's program starts | 39.6 s | 35.7 s |
| First mutant answer, after Stryker starts | none | 37.3 s |

- **Install is most of it.** It downloads every package into an empty store. The checkout and
  the store take 1.7 GiB; the disk had 1.3 GB used of 20 GB.
- **The first deploy is slow because the laptop builds the image.** Alchemy builds it for amd64 and
  pushes it. A second deploy with Docker's cache took 60 s. A daily box reuses the deployed image,
  so it pays only the 11 s start.
- **CPU steal was high during install:** 38 s to 40 s of steal against about 65 s to 71 s of busy
  time. The host was busy with other tenants. One more reason a box worker is slower.

So a batch pays about 1 to 1.5 minutes before its first answer. A 10 minute batch loses about 10%
to 15% of its time to setup. 197's "30 to 60 minutes per batch, because of setup" can drop.

## Speed: box worker against laptop worker

`lane139`, fast arm, at commit `44db4b49`. On both machines: 116 mutants, 29 ignored, 87 run. Killed
48, survived 19, no coverage 19, timeout 1. Every mutant had the same answer on both machines.

| Measure | Box, 4 workers | Laptop, 3 workers | Box / laptop |
|---|---|---|---|
| Mutant time, 68 mutants with a time | 157.4 s | 69.6 s | 2.26 |
| Median mutant | 696 ms | 258 ms | 2.7 |
| 90th percentile mutant | 4,981 ms | 2,515 ms | 2.0 |
| First answer, after Stryker starts | 37.3 s | 17.4 s | 2.1 |
| Wall time | 153.1 s | 76.2 s | 2.0 |

- **Read it as about 2.3x, between 2.0x and 2.7x.** Mutant time is time per worker, so it compares
  one vCPU worker with one laptop worker. The box ran 4 workers on 4 vCPU; the laptop ran 3 on 12
  cores.
- **The box was not fully busy:** 414 s of CPU over 153 s is 2.7 of 4 vCPU on average.
- **Earlier numbers agree on the direction.** In local Docker on the laptop (3 CPUs, 2 workers) the
  same set took 54 s of mutant time. In 181 on the laptop under heavier load it took 100 s.
- **The `ship121` laptop baseline stands for a later box run:** 529 s wall with 3 workers, first
  answer at 113 s, 203 mutants run (198 killed, 2 survived, 3 no coverage), 1,099 s of mutant time.
  181's own number for the same arm is 610 s with 2 workers under load 11 to 16, so not the same
  measure.

## Memory

| Phase | Peak used in the box |
|---|---|
| Clone | 0.45 GiB |
| Install | 1.26 GiB |
| Stryker, `lane139`, 4 workers | 2.23 GiB |
| Stryker, `ship121`, first test run only, 4 workers | 1.67 GiB |
| The whole suite, vitest's default workers | 4.26 GiB |

- **The box reports 12.0 GiB in run 1 and 11.0 GiB in run 2.** It shows 8 CPUs, and Node's
  `availableParallelism` says 4. No cgroup memory limit was visible inside.
- **4 workers fit, with room for 8 or more.** The laptop's `ship121` run with 3 workers peaked at
  2.1 GiB summed. The largest single process was 0.8 GiB to 1.0 GiB. A guess: `ship121` with 4
  workers stays under 3 GiB.

## Why the ship sample did not run

The probe at the start of run 2, as the box printed it:

```text
uid=1000(node) gid=1000(node) groups=1000(node)
CapInh:	00000000abac35fb
CapPrm:	00000000abac35fb
CapEff:	00000000abac35fb
CapBnd:	00000000abac35fb
CapAmb:	00000000abac35fb
bwrap: Unexpected capabilities but not setuid, old file caps config?
BWRAP_FAIL
UNSHARE_OK
```

- **The box gives its plain user a full set of capabilities,** `CAP_SYS_ADMIN` among them, as
  ambient capabilities. Bubblewrap refuses to run with capabilities it was not given by setuid. A
  plain `unshare -U` works. In local Docker the user has none, and bubblewrap fails for another
  reason (no user namespaces). With `--privileged` locally, the failing test passes.
- **What breaks because of it.** The pipeline's end-to-end tests run the test writer's check in
  the OS sandbox. In the box, that check ends `run_failed`, so `program.test.ts` fails 96 tests.
  Stryker's first test run includes them for `ship121`, and Stryker stops: "There were failed tests
  in the initial test run" (reproduced in local Docker, at Stryker's `info` log level).
- **The next step: in a box, the tests run with no extra wall.** Decided by the owner on
  2026-11-02. [Programs run in a box](../docs/direction/programs-run-in-a-box.md) names three layers
  of the `Sandbox` service: `docker`, `os` and `none`. On a laptop the wall is bubblewrap, the `os`
  layer. A Cloudflare box is already a container, so the box is the wall, and the code inside it
  runs with `none`. We do not make bubblewrap work inside the box.
- **Dropped: removing the ambient capabilities so bubblewrap starts.** This run first named it as
  the fix to try (for example `setpriv --ambient-caps -all --inh-caps -all`). It is dropped because
  it would put a second wall inside the first one, which buys nothing, and it could also take away
  what lets `unshare -U` work. A setuid bubblewrap is no way either: Debian's build refuses it
  ("setuid use of bubblewrap is not supported", seen locally).

## The whole suite in the box (run 1)

- **It ran 1,972 s and failed:** 349 files, 5,224 tests, 5,062 passed, 111 failed in 9 files,
  6 skipped. CI runs the same suite in about 10 machine minutes over three shards.
- **The time was waiting, not work.** The box was 16% busy: 2,472 s of CPU, against 13,097 s idle.
  Failing tests ran to their timeouts.
- **The 9 files, with a cause where one is clear:**
  - Sandbox: `sandboxes.test.ts`, `sandbox/sandbox.test.ts` (5), `program.test.ts` (96),
    `program.format.test.ts` (2).
  - Timing on a slower machine, a guess: `checks.test.ts` (7,012 ms against a 2,900 ms limit),
    `host/laws.test.ts` (a 60 s timeout), `build/guard.test.ts` (4, process kills within 8 s;
    they pass in local Docker).
  - Not looked into: `builder-acp.test.ts` (1), `settings-source.test.ts` (1).
- So this run does not give a suite time for a box. It shows the suite is not ready for a box.

## What it cost

List price from Cloudflare's containers pricing page, read 2026-11-02: $0.000020 per vCPU-second
(active CPU), $0.0000025 per GiB-second and $0.00000007 per GB-second of disk, for the box's whole
life.

| Run | CPU | Memory | Disk | Total | If all 4 vCPU were busy the whole time |
|---|---|---|---|---|---|
| 1 | $0.054 | $0.065 | $0.003 | $0.122 | $0.240 |
| 2 | $0.010 | $0.006 | $0.000 | $0.016 | $0.024 |
| Both | | | | **$0.138** | $0.264 |

- **The plan likely covers all of it.** Both runs used 53 vCPU-minutes, 7.9 GiB-hours and 13 GB-hours.
  The plan includes 375, 25 and 200 a month. Whether other boxes used them this month is not known.
- **A busy box hour cost less than 197's $0.40:** run 2 comes to about $0.28 an hour, since its CPU
  was not fully busy. The range below keeps $0.40, as an upper bound.

## What 197's cost range becomes

197's table, at 2.3x and $0.40 a box hour (4 workers a box):

| Run | 197 at 1x | Now, at 2.3x |
|---|---|---|
| First pass, 48 laptop worker hours | 12 box hours, about $4.80 | 28 box hours, about $11 |
| First pass, 181's range (half or double) | $2.40 to $9.60 | $5.50 to $22 |
| Daily, 2 to 7 laptop worker hours | $0.20 to $0.70 a day, $6 to $21 a month | $0.46 to $1.61 a day, about $14 to $48 a month |
| Daily with a 1 box hour cap | at most $12 a month | at most $12 a month; it now covers about 1.7 laptop worker hours, below the daily low end, so more waits |

- **Setup adds little:** about 1 to 1.5 minutes a batch.
- **The laptop being first matters more now:** each laptop worker hour saves about $0.23.

## What is left behind

- **On Cloudflare, two platform-made registry artifacts,** one per deploy, of type
  `application/vnd.cloudchamber.btrfs-chain.v1`. Each sits in a repository named
  `tf-exp-199-run-cloud-<suffix>`. The registry API answers 409 `SINGLETON_ARTIFACT_EXISTS` to a
  delete, the same as in 148, which left seven. Wrangler 4.156.2 does not list them
  (`containers images list`), and its `containers images delete` takes only `IMAGE:TAG`.
- **How a person removes them:** no way was found. The Cloudflare dashboard's image list was not
  tried. If it cannot, Cloudflare support is the way. Their size and whether they are billed are
  not known.
- **Destroyed and checked by listing:** both Workers, both Durable Object namespaces, both container
  applications and every image tag. 148's Worker was not touched. Before and after, the account
  held 13 other Workers and 13 other namespaces.
- **On the laptop:** the local images, the diagnosis containers, both worktrees and Alchemy's temp
  folders are gone. Docker's build cache for the image is still there.

## Who did what

A Claude Code subagent ran this by hand, started from a person's own session. No machine of this
repo ran it, and none of today's fabrika. 148's Cloudflare helper (`148-remote-programs/cloud.ts`)
gained a prefix argument, so its listing and sweep could find this run's resources. Its default is
148's, so 148 runs as before.

## What it cannot tell us

- **Speed on the sample 197 sized.** The ratio comes from `lane139`'s 87 mutants, in one run on
  one box, on a laptop under other agents' load. A quiet laptop would make the ratio higher. A box
  on a less busy host would make it lower. `ship121`'s slow mutants (up to 38 s) may scale
  differently.
- **Whether the tests pass in a box with `none`.** That is the next run's question.
- **A real suite time in a box.** Run 1's suite mostly waited on tests that fail there.
- **What a box hour costs at full load.** Neither run kept 4 vCPU busy.
- **Run to run spread.** One run per set. Steal time shows the host was shared, and that will
  vary.
- **Whether the leftover artifacts cost anything.**
