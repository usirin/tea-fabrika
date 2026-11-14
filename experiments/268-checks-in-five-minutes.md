---
date: "2026-11-11"
scripts: "none; a count of GitHub run data, nothing ran"
summary: "Today's CI, the last 40 merged PRs (885 to 944). Median 390 s, p90 1,012 s; whole-suite runs 964 s median. Eight fixes, none running fewer tests: lane matrix about 300 s, split six slow `.agents/` files about 220 s, cancel superseded main runs about 70 s (300 s p90, owner's call), apt cache about 175 s at p90, rebalance shards 60 to 100 s, blobless checkout about 20 s, trim e2e 40 to 60 s; parallel typecheck and lint not needed. Floor about 260 to 300 s with no queue; about 65% sure the median goes under 300 s. Narrowing `--changed` or the rerun triggers rejected as loosening. Paid runners answered no by 0112. No model, $0."
---

# 268. What gets a pull request's checks under five minutes, and how low can they go?

Measured on 2026-11-11 from GitHub's own run data, landed the same day. **This is a count of
recorded CI runs, not an experiment run:** no test ran locally and no workflow changed. It is about
**today's CI** (`.github/workflows/check.yaml` and `commits.yaml`), which checks both versions.
Sample: the last 40 merged pull requests (885 to 944, all merged 2026-11-11), the green `check` run
and the `commits` run at each one's final head. The raw pulls are not kept in git
([0027](../.decisions/0027-experiment-results-live-in-a-private-archive.md)). One agent read; no
model call of its own, $0. It serves
[0106](../.decisions/0106-a-pull-requests-checks-finish-in-five-minutes.md)'s budget: a pull
request's checks finish in five minutes at most.

Where a whole-suite run's time goes in short (about 1,000 s, the lane step before the rest step,
six slow `.agents/` files, the runner queue) is already in
[experiment 260](./260-lane-queue-or-scheduled-job.md#what-the-wrong-home-cost). This write-up holds the
tables under that paragraph and the fixes.

**The answer: eight changes, none of which runs fewer tests, bring a whole-suite run to a floor of
about 260 to 300 s with no queue.** The two big ones are a lane matrix (about 300 s saved) and
splitting six slow `.agents/` test files (about 220 s). That just meets five minutes at the median.
The p90 meets it only if the runner queue goes too, and the biggest lever on the queue, canceling a
superseded run on main, is the owner's call. Narrowing `--changed` or the rerun triggers would cut
more, but it runs fewer tests on the pull request, so it is loosening and is not recommended.
About 65% sure the whole-suite median goes under 300 s.

```text
whole suite, no queue, after fixes 1 to 6:
changes ~15 s + runner pickup ~5 s + setup ~40 s + max(lane job 160–240 s, rest job 200–245 s)
= about 260 to 300 s
```

## Wall time, push to last job, by kind of pull request

Kind comes from changed paths (Markdown and `field/` count as docs). "Mixed" pull requests touched
a vitest `forceRerunTriggers` path (`.github/**`, any `package.json`, `tsconfig*`,
`oxlint-plugins/**`, `pnpm-*`, `.oxlintrc.json`, `layer-rules.json`), so 11 of those 12 ran the
whole suite.

| Kind | PRs | Median s | p90 s | Last job to finish |
|---|---|---|---|---|
| docs | 12 | 54 | 95 | commits |
| `next/` only | 9 | 316 | 680 | next shard (one ran test) |
| `.agents/` tooling | 6 | 455 | 567 | test (1), from box.test.ts |
| today's only | 1 | 327 | 327 | e2e |
| mixed (whole suite) | 12 | 964 | 1,065 | test (4) or (5) |
| all code PRs | 28 | 626 | 1,019 | |

Across all 40: median 390 s, p90 1,012 s. Experiment 260's 12.5 min (750 s) sits between the
code-PR median and a whole-suite run. The ruleset requires only `commits` (median 50 s); "the
checks" here means the whole `check` workflow the lead waits for.

## Inside a whole-suite run

Medians over the 11 whole-suite runs, along the slowest machine:

- `changes` finishes at 27 s (p90 115 s, which is queue). Its checkout alone is 16 s, because it
  fetches all history.
- Wait for runners: the last test shard starts at 94 s, so about 67 s of queue (p90 360 s; PR 930
  waited 735 s).
- Test job setup, about 50 s: checkout 16, pnpm 4, setup-node 13, `pnpm install` 4 (the cache
  works), apt 14 (median over all shards; p90 191 s, on mirror trouble days).
- Lane step: 304 s on the slowest shard (p90 327). It runs at `--maxWorkers=1` on purpose (T554;
  `check.yaml:204`).
- Rest step: 465 s on the slowest shard (p90 496).
- The test job takes 777 s at the median, 970 s at p90.

The two steps are sharded by two separate vitest calls, so they do not balance against each other.
Shard 1 gets the shortest lane share (127 to 160 s) plus the longest rest share (378 to 502 s,
because `box.test.ts` lands there). Per-machine totals in one run range from about 420 s to 740 s.

## Per job, all 40 pull requests

| Job | Runs | Median s | p90 s | Queue median / p90 s |
|---|---|---|---|---|
| changes | 40 | 20 | 26 | 4 / 95 |
| field | 40 | 20 | 35 | 4 / 76 |
| commits | 40 | 50 | 63 | 4 / 118 |
| check | 28 | 164 | 171 | 4 / 256 |
| next (each of 6) | 126 | 163 | 220 | 12 / 268 |
| test (each of 6) | 120 | 522 | 771 | 12 / 260 |
| e2e (macOS) | 13 | 253 | 304 | 5 / 41 |

Steps inside each job, median / p90 in seconds:

- **check:** typecheck 50/53, lint 66/70, build 11/12, promises 4/5, setup-node 13, checkout 4
  (shallow), install 4. It runs well under five minutes and never set the wall.
- **next:** vitest 107/155, checkout 16/22, setup-node 12/15, install 5. On shard 1, chromium is
  23/200 (`--with-deps` runs apt) and e2e.ts 11/13.
- **e2e:** e2e 139/158, setup-node 39/54 (it downloads Node on macOS), ruler 17/21, aria 19/23
  (advice only), install 11/18, cache 5.
- **commits:** checkout 16/21, setup-node 13, check 8/11.
- **test:** listed above. No Playwright install happens in `test`.

Runner load: these 40 pull requests alone peaked at 27 Linux jobs at once. On top of that, main had
49 push runs of `check` in the same window (median 834 s, about 17 jobs each, every run finishes).
So the queue is real, and it grows with every shard we add.

## Slowest test files

Whole-suite runs 899, 914 and 919, plus 937. Seconds per file as the default reporter prints them,
median of up to 4 runs:

1. `.agents/skills/lead/scripts/box.test.ts`: 395 (max 488). 38 cases, run serially; slowest case
   65 s.
2. `.agents/skills/lead/scripts/boxrm.test.ts`: 354. 197 cases of about 0.3 to 7 s; each makes its
   own git repo plus bare clone plus clone.
3. `.agents/skills/plan/scripts/plancheck.test.ts`: 226. 21 cases, up to 35 s each.
4. `catchup.nested-storage-driver.test.ts`: 222. 48 cases, every one at least 4.3 s.
5. `catchup.nested-storage-checkout.test.ts`: 204.
6. `catchup.cleanup.test.ts`: 155.
7. `next/.../runtime/RunnerSupervision.test.ts`: 130 (max 191).
8. `next/apps/fabrika/src/door.test.ts`: 128 (max 199).
9. `packages/fabrika/src/host/door.laws.test.ts`: 127.
10. `lead/scripts/loosening.test.ts`: 123 (max 178).
11. `lead/scripts/catchup.test.ts`: 122 (max 140).
12. `packages/fabrika/src/host/fence.laws.test.ts`: 119.
13. `pipeline/lane.asked.test.ts`: 117 (a lane file).
14. `oxlint-plugins/program-package-layout.test.ts`: 103.
15. `pipeline/lane.exam-pull.redo-on-main.test.ts`: 102 (a lane file).

Ticket 559 (`catchup.test.ts`, 689 s median) is mostly done: PR 770 split it into four files, now
items 4, 5, 6 and 11. The table in `vitest.shards.ts` is stale: it has `box.test.ts` at 348.7 s
(`vitest.shards.ts:24`, still so on main 2026-11-11) against a measured 395 to 488 s.

The `.agents/` files (items 1 to 6, plus 10 and 11) add up to about 1,800 file-seconds, about a
third of a whole run's test time. Their cases call `spawnSync` on git, so `test.concurrent` would
not run them side by side: a sync call blocks the worker. Only splitting the files helps.

## The eight fixes, ranked

Seconds saved are on a whole-suite run's slowest machine, at the median, unless marked p90. None
drops, narrows or loosens a law; every test still runs on the pull request.

1. **Run the lane step in its own matrix jobs**, not before the rest step on the same machine. Keep
   `--maxWorkers=1`, so T554's law stays. 9 lane shards of 2 files each put each job at about 160
   to 240 s (lane files total about 1,440 s). Saves about **300 s**. A GitHub matrix plus vitest
   `--shard` ([matrix docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)),
   so nothing new. Cost: about 9 more Linux jobs per run, which adds queue (see 3). Risk: low.
2. **Split the six slow `.agents/` files** into files of 100 s or less, the way PR 770 split
   `catchup.test.ts`; vitest balances only by file. The rest step drops to about the per-shard sum
   over 3 workers, about 245 s. Saves about **220 s** on whole-suite runs and about 200 s on
   `.agents/` pull requests (455 s to about 250 s). Cost: about 8 files moved, same cases, low risk.
   A shared git fixture built once per file and copied per case may save more; not measured, as it
   needs a local run.
3. **Clear the runner queue.** Queue is about 70 s at the median and 270 to 470 s at p90. The
   biggest lever is main's push runs: 49 whole-suite runs in 8 hours, all finishing, by design
   (`check.yaml:12-16`: main's runs all finish, one per commit). Canceling a superseded main run
   (`concurrency.cancel-in-progress` on main,
   [docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency))
   frees slots. Saves about **70 s** at the median and about **300 s** at p90. **Owner's call:** it
   changes "main's runs all finish". A bad merge is still caught, one batch later. The other way,
   larger runners, is paid and needs a Team or Enterprise plan
   ([docs](https://docs.github.com/en/actions/concepts/runners/larger-runners)), also the owner's
   call. The concurrency limit itself (20 on Free, 40 on Pro,
   [limits](https://docs.github.com/en/actions/reference/limits)) could not be read: the API
   returned no plan. 27 jobs ran at once, so the limit is at least 27.
4. **Cache the apt packages.** Put the `.deb` files for expect, zsh, bubblewrap, socat, ripgrep and
   their dependencies in `actions/cache`, keyed by `ImageOS` and `ImageVersion`, install with
   `dpkg -i`, and fall back to `apt.sh` on a miss. Same for next shard 1's chromium (cache
   `~/.cache/ms-playwright`). Saves about 10 s at the median and about **175 s at p90**: 4 of 20
   whole runs paid 188 to 200 s. Uses [actions/cache](https://github.com/actions/cache), already
   used here. A third-party apt-cache action would need the owner's yes, and none is needed. The
   sandbox tests still never skip. Risk: a new image may need new dependencies, which the fallback
   covers.
5. **Rebalance the shard table after 1 and 2.** Refresh the stale rows (`box.test.ts` and others the
   `shard-times` step already warns about), so one table covers lane jobs and rest jobs alike.
   Per-machine totals spread about 250 s today. Saves about **60 to 100 s**. The repo's own
   `vitest.shards.ts` sequencer. Risk: none.
6. **A blobless full-history checkout** (`filter: blob:none`,
   [actions/checkout inputs](https://github.com/actions/checkout#usage)) in changes, test, next,
   field and commits. History stays whole for `--changed` and the edges step. Full history costs
   16 s against 4 s shallow. Saves about **20 s** on the critical path. Estimate only, not measured.
7. **Trim e2e on macOS** (median 253 s, p90 304 s, so p90 is just over five minutes). Move the
   advice-only `aria` step to its own job: it is already `continue-on-error`, so its strength stays.
   Cache the Playwright chromium for `ruler` and the Node toolcache (setup-node takes 39 s on
   macOS). Saves about **40 to 60 s** on today's-only pull requests.
8. **Not needed: splitting typecheck and lint into parallel jobs.** `check` is 164 s and never set
   the wall. It would save about 55 s, but not on the critical path.

**Rejected, because it loosens: narrowing `forceRerunTriggers` or `--changed` further.** 11 of the
20 pull requests that ran tests ran the whole suite only because they touched a trigger path.
Narrowing would cut most whole runs, but it runs fewer tests on the pull request. That is
loosening, it waits on the owner, and it is not recommended.

## Is five minutes reachable?

- **Docs:** yes, already (54 s).
- **`next/` only:** yes, if the queue is fixed. Jobs take 220 s at p90; the 680 s p90 is queue.
- **`.agents/` tooling:** yes, with fix 2 (about 250 s).
- **Today's only:** yes, with fixes 4 and 7 (about 250 to 280 s).
- **Whole suite:** only just at the median, and only with fixes 1 to 6 together. The p90 meets it
  only if fix 3 goes in, because fixes 1 and 2 add jobs that make the queue worse. About 65% sure
  the median goes under 300 s. A trial of fixes 1, 2 and 5 on one pull request would settle it.
  The `next` shards stay at about 220 s or less, and e2e at about 200 to 250 s.

## Open calls for the owner

- Canceling superseded main runs (fix 3).
- Any paid or larger runner, or a plan change. *Later the same day the owner chose free CI
  ([0112](../.decisions/0112-checks-run-on-free-ci.md), from [experiment 261](./261-checks-on-cloudflare-containers.md)),
  which answers this one: no paid runner.*
- Any new third-party action (none is proposed).
- Any narrowing of `--changed` or the rerun triggers (rejected above).

## What it cannot tell us

- The real runner concurrency limit (the plan is not visible), and the job-level timings of main's
  runs: only run-level times were pulled, to go easy on the API.
- How much a shared git fixture per file would save per case. That needs a run.
- Whether lane files stay stable at `--maxWorkers=2`. T554 measured only 1 and 3.
- Ticket 559 was not read in the tracker; its state comes from the `vitest.shards.ts` comment and
  field note 2026-11-10-25.
- File times come from 4 runs (3 whole-suite runs plus 1 `.agents/` run), so a file's median can
  move by ±20%.
- The checkout and e2e savings are estimates, not measurements.
