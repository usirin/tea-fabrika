---
id: 0112
title: A pull request's checks and the merge queue's checks run on the code host's free CI, never on a paid runner
status: accepted
date: 2026-11-11
tags: [ci, merge-queue, cost, github-actions, cloudflare]
---

# 0112: A pull request's checks and the merge queue's checks run on the code host's free CI, never on a paid runner

**What this decides:** where this repo's pull request and merge queue checks run, and that we pay
nothing for them.

## Context

[0106](./0106-a-pull-requests-checks-finish-in-five-minutes.md) set a five-minute budget for a pull
request's checks, against about 12.5 minutes measured. One way to get there is to run the checks on
Cloudflare Containers, with no cap on how many jobs run at once.
[Experiment 261](../experiments/261-checks-on-cloudflare-containers.md) read what that would take.
It fits 14 of our 16 jobs, but at list price a full run costs about $0.39 to $0.55. At the last
three days' pace that is roughly $580 to $1,750 a month for the merge queue's runs alone, and about
$3,400 if every pull request run moved. GitHub Actions is $0 for a public repo. The owner decided
on 2026-11-11, after hearing that research, not to pay for CI.

[Services and our own CI](../docs/direction/services-and-our-own-ci.md) already makes `Ci` its own
service, with GitHub Actions as its first Layer, and defers CI on our own machines.

## Decision

**A pull request's checks and the merge queue's checks run on the code host's free CI: GitHub
Actions, for this public repo. We do not pay for CI.**

- No Cloudflare Containers for these checks, and no other paid runner.
- 0106's five minutes are met with free fixes: fewer and fatter jobs, slow test files split, and
  setup cached.
- Where checks run stays one Layer of the `Ci` service, so it can change later without touching
  the merge queue or any step.
- CI on our own machines stays deferred, as the services note already says.
- The research is kept as experiment 261. Its paid trial run was not made.

## Consequences

- GitHub Free runs 20 jobs at once, and one full run is 16 jobs, so two pull requests at once
  already queue. In 8 recent runs, jobs waited up to 256 s to start, median about 190 s. That wait
  is what the free fixes must cut first, since it is most of the five minutes on its own.
- The arm64 mutation runner of [0067](./0067-hourly-mutation-runs-in-ci.md) is a free GitHub runner
  for a public repo, so it agrees with this decision.
- It agrees with the services note's "money saved is small for public repos" and with AGENTS.md's
  "no new paid accounts". Cloudflare stays the paid exception for what fabrika itself runs, not for
  this repo's CI.
- Not decided here: the daily checks and the `next/` mutation queue that
  [experiment 197](../experiments/197-daily-checks-on-cloudflare.md) and the mutation note place on
  the host's own alarms and boxes. They are scheduled work, not a pull request's checks.
- Not decided here: what a private repo or a repo with no free CI uses. That is the case another
  `Ci` Layer is for.
