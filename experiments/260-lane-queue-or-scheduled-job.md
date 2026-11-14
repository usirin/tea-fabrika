---
date: "2026-11-11"
scripts: "none; reading and measurement of our own logs, not an experiment run"
summary: "Today's lead tooling, the night of 2026-11-10 21:00 to 11-11 10:00, plus reading (Google's presubmit and postsubmit, Chromium's commit queue, Prow, GitHub's merge queue, Zuul, Kubernetes controllers and GC, OTP timers, SQS, Sidekiq, Temporal). Two questions sort 39 pieces of work: does it judge this change or shared state, and does the next step need it? About 25 stay in the lane. The wrong home cost: a cleanup inside every step start 8.4 lane-hours (12 starts waited over 6 min on a hung `docker ps`); a merge line run by hand shells about 28 PR-hours before the CI apt outage (20 merges, 29 reds, 10 conflict aborts); a tool checkout 36 commits stale, 12 tooling fixes never run; 19 of 20 merges closed no ticket; nobody read main's red; the 20-minute lead check 6 lane-hours over 33 parks. Lean, about 75%: a thin lane, one merge queue, three scheduled jobs. Two guesses were wrong and are kept: the tool checkout on a scheduled job (it hangs on the merge) and about 12 min of PR checks being fine (0106: five). Decided as [0108](../.decisions/0108-a-job-lives-in-a-lane-a-queue-or-a-scheduled-job.md). One night of logs. No model, $0."
---

# 260. Which pieces of work in a change belong in every lane, which in a queue, and which on a timer?

Read and counted on 2026-11-11, on main. This is reading and measurement of our own logs, not an
experiment run: the night of 2026-11-10 21:00 to 2026-11-11 10:00 (Pacific) from the lead
tooling's chain records, the lander log and `gh run list`, plus reading on how others split work
before and after a merge. **Every claim about lanes is about today's lead tooling** (`chain.ts`,
`drive.ts`, `box.sh`, `catchup.sh`) running work for both versions. Claims about `next/` say so.
Nothing in the repo changed, no model was called beyond the one agent that read, and it cost $0.
It follows [0101](../.decisions/0101-box-cleanup-runs-on-a-timer.md), the first trial of moving a
piece of work out of the lane. The owner decided the rule and the picture after a walk of this
research; they are in [lane, queue or scheduled job](../docs/direction/lane-queue-or-scheduled-job.md)
and [0108](../.decisions/0108-a-job-lives-in-a-lane-a-queue-or-a-scheduled-job.md).

**The answer: ask two questions of each piece of work.** Does it judge this one change, or
something shared (main, the laptop, the tracker)? Must its answer exist before the next step
starts? Work that judges this change and is needed next stays in the lane. Work that runs once per
event and can wait its turn goes in a queue. Work about shared state that is safe to run twice goes
in a scheduled job, on a timer, which compares "should be" with "is" and fixes the gap. One
tie-breaker: a check that stops lasting harm (a leak, lost work, a builder changing its own exam)
never leaves the lane. Of the 39 pieces of work found, about 25 stay in the lane. The biggest
losses of the night came from work in the wrong home: a cleanup inside every step start (8.4
lane-hours), a merge line run by hand shells (about 28 PR-hours before the outage) and work nobody
owned (main red, ticket closes, the stale checkout).

```ts
// Sketch of the rule as the research put it. Not built.
type Work = { judges: "this change" | "shared"; neededNext: boolean; stopsLastingHarm: boolean };
const home = (work: Work): "lane" | "queue" | "scheduled job" =>
  work.stopsLastingHarm || (work.judges === "this change" && work.neededNext)
    ? "lane"
    : work.judges === "shared"
      ? "scheduled job" // the research's guess; one case of it was wrong, see "Guesses that were wrong"
      : "queue";
```

## What others do

**Before and after the merge.**

- **Google.** [Software Engineering at Google, ch. 23](https://abseil.io/resources/swe-book/html/ch23.html):
  before submit, "only fast, reliable ones"; after submit "you can accept longer times and some
  instability, as long as you have proper mechanisms to deal with it". A change that passes
  presubmit passes the rest "95%+" of the time. A "Build Cop" keeps a project green "regardless of
  who breaks them", and "rolling a change back is often the fastest and safest route". Average
  submit wait: about 11 minutes.
- **Chromium.** The [commit queue](https://chromium.googlesource.com/chromium/src/+/main/docs/infra/cq.md)
  runs "a curated set" of tests before landing; some builders run "only after submission". The
  [sheriff docs](https://chromium.googlesource.com/chromium/src/+/refs/tags/112.0.5598.1/docs/sheriff.md)
  put "the tree is open" first; sheriffs revert culprits.
- **Prow (Kubernetes CI).** [Job types](https://docs.prow.k8s.io/docs/jobs/): presubmit on pull
  requests, postsubmit on push, and periodics on an `interval` or a `cron`, "not tied to a push or
  PR".

**Merge queues.** The "not rocket science rule" tests the merge result before main moves (wording
from [Jane Street's write-up](https://blog.janestreet.com/making-never-break-the-build-scale/), a
secondary source; the original post timed out). [GitHub's merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
builds temporary branches of the base plus the pull requests ahead and drops a failing one.
[Zuul](https://zuul-ci.org/docs/zuul/latest/gating.html) tests queued changes in parallel, each
assuming the ones ahead pass, and retests the ones behind a failure.

**Scheduled jobs and events.**

- **Kubernetes.** A [controller](https://kubernetes.io/docs/concepts/architecture/controller/) is
  "a non-terminating loop that regulates the state of a system", like a thermostat. The
  [design principles](https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/principles.md)
  say "functionality must be level-based" and "edge-triggered behavior must be just an
  optimization". Level-based means acting on what is, not on the message that said it changed, so
  a missed message costs one tick, not forever. The kubelet's
  [garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/)
  runs on its own clock ("every five minutes" for images), apart from any pod start.
- **git.** [`git gc --auto`](https://git-scm.com/docs/git-gc) runs inline, but `gc.autoDetach`
  (default true) makes it "return immediately and run in the background". Our `box.sh gc` at step
  start was the inline form without the detach.
- **OTP.** A periodic job is its own `gen_server` that sets a timer for itself
  ([gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)). The
  [timer docs](https://www.erlang.org/doc/apps/stdlib/timer.html) prefer `erlang:send_after` and
  warn that `apply_interval` starts a new run "irrespective of whether a previously spawned process
  has finished". A janitor is a supervised process of its own, and a step start never calls it.
- **GitHub's `schedule`** ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)):
  at most every 5 minutes, "can be delayed during periods of high loads", and switched off in a
  public repo after 60 days with no activity.

**A worker that dies.** [SQS](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)
hides a taken message for a visibility timeout and shows it again if it is not deleted in time.
[Sidekiq](https://github.com/sidekiq/sidekiq/wiki/Reliability)'s basic fetch loses a job on a crash;
`super_fetch` finds orphans by an expired heartbeat. [Temporal](https://docs.temporal.io/encyclopedia/detecting-activity-failures)
notes "a Worker that crashes ... is not reported", so a timeout forces the retry.

**Flaky tests.** [Fowler](https://martinfowler.com/articles/nonDeterminism.html) quarantines with a
cap and a time limit. This repo turned that down ([0036](../.decisions/0036-a-flaky-test-is-fixed.md)).

## The work, sorted

39 pieces of work run from "ticket picked" to "merged and cleaned up". The table groups them by family. "Needed
next" means the next step cannot start without the answer.

| Work | Today | Judges | Needed next | Home the research gave |
|---|---|---|---|---|
| Plan writer | lead starts it, one at a time | this change | yes | queue with more than one worker |
| Plan check and approval; "already merged?" check | lead and `plancheck.sh`; nobody | this change | yes | lane |
| Free-disk check, box setup, agent steps, host step, judgment, budget | step start, chain | this change | yes | lane |
| Typecheck of the head merged with main | chain, after review | this change | yes, saves a CI round | lane, and CI keeps its own |
| Field run row per step | `drive.ts` | records | no, but lost if skipped | lane: a scheduled job cannot rebuild a lost fact |
| Leak grep, `loosening.sh`, push, PR CI, `commits` | chain, GitHub | this change | yes | lane |
| Lead's hand check of loosening hits, lead signs, lane restarts | lead, by hand | this change | yes | a queue the lane waits on |
| Lint on the true merge, the squash, requeue after red | `catchup.sh`, three lander shells, lead | this change and main | yes for this PR | the merge queue |
| Conflict fix after main moved | an agent, by hand | this change and main | yes for this PR | lane (sent back to build) |
| Close the tickets a merge finished | `catchup.sh`, often missed | tracker | no | on the merge, a scheduled job as backstop |
| Box cleanup, stale processes, Docker health | step start, lead by hand, nobody | laptop | no | scheduled job (0101) |
| Full suite on main; who reads main's red | GitHub on push; nobody | main | no | stays on push; a main watcher, a scheduled job |
| Hourly mutation | a scheduler session | main | no | stays as 0066 and 0067 have it |
| Bring the tool checkout up to date | lead, "after every merge", often missed | laptop tooling | no | scheduled job (**wrong**, see below) |
| Pickup of an ask, a stuck, a budget stop | the lead's 20-minute check | one lane | yes for that lane | wake the lead on the event |
| Status page, field notes, weekly tooling share | lead by hand | everything | no | view rebuilt by a scheduled job; on demand; weekly |

## What the wrong home cost

From the night of 2026-11-10 to 11-11. A lane-hour is one lane not moving for one hour; a PR-hour is
one open pull request not merged for one hour.

- **Cleanup inside every step start.** `box.sh gc` hung on `docker ps` from 21:13 to about 02:00.
  12 step starts waited more than 6 minutes: 504 min, 8.4 lane-hours. The worst waited 116 min.
  `docker ps -aq passed its 30 s limit` shows 58 times in chain logs (about 29 min). No step needs
  the cleanup's answer.
- **A merge line run by hand.** One lander, then three. About 8.4 min a merge before the CI apt
  outage and about 13 after. 32 PRs merged before the outage spent 27.9 PR-hours beyond a 0.4 h
  ideal. `land.log` holds 20 merges, 29 reds and 10 conflict aborts; 20 of the reds were the outage,
  each a wasted catch-up and CI run. Before 04:39 the line jammed about 60 min and about 20 min more.
  39 requeue attempts were made by hand.
- **The tool checkout nobody brought up to date.** Last pulled at 01:44; 36 commits behind by
  10:00, 12 of them lead tooling fixes that never ran (host step, faster start, heartbeat, host
  typecheck among them). A floor of 3 lane-hours, and it multiplies other losses: three PRs opened
  with type errors after the host typecheck had merged, and box setup stayed at 0.8 + 2.1 min median
  a step (10.9 lane-hours over 216 steps) after the faster start had merged.
- **Ticket closes nobody owned.** 19 of 20 merges closed no ticket; 15 were closed by hand in one
  batch.
- **Main red that nobody reads.** Every push to main runs the full suite (13.9 min median, p90
  18.1; 24 green and 2 red of 30). Nobody reads the result, and
  [0097](../.decisions/0097-a-green-pull-request-lands-without-catching-up.md) leans on someone
  fixing a red main the same turn.
- **The lead's 20-minute check.** 33 parks after an ask or a stuck, 359 min in all, median about
  10 min, longest 34 min: 6 lane-hours, an upper bound since it includes the fix itself.
- **Plan writers one at a time.** A lock in `redact.sh` serialized every plan writer: 433 min of
  queue wait over 24 plans, and 2 duplicate starts because a queued writer looked dead.
- **PR checks.** A `check` run took 12.5 min median and 15.4 min p90 on code PRs. A whole-suite run
  takes about 1,000 s from push to last job; the lane-test step runs before the rest on the same
  machine, six `.agents/` test files take 150 to 490 s each, and the runner queue adds 70 s at the
  median and up to 470 s at p90.

## Where the rule was unclear

- **PR tests.** They judge this change, and the harm they stop (main red) can be undone by a revert.
  By the two questions alone they could move after the merge. The never-moves list in
  [the fast check note](../docs/direction/fast-and-daily-mutation.md) keeps them, as Google keeps
  its fast, reliable set before submit. The owner kept them on the pull request.
- **Typecheck twice.** Both the lane's and CI's judge the change. Keeping both is cheap insurance,
  not a rule question.
- **Ticket closing.** An event (a merge) and a level fact (a closed ticket) at once. The Kubernetes
  answer is both: the event is the fast path, the scheduled job the truth.
- **The lead's hand work.** Needed before the lane goes on, so lane work by the rule, but the lead is
  one shared worker, so they behave as a queue with one human worker. The research put them in a
  queue the lane waits on.
- **Bringing the tool checkout up to date.** Shared state, so the research said a scheduled job,
  guarded so it runs only when no step is starting. This was wrong; see below.

## Whole-system options

- **A. Everything inline, as today.** Nothing new to keep alive. Every step pays for the laptop's
  chores, a hung chore stalls lanes, and work nobody triggers stays undone.
- **B. A thin lane, one merge queue, three scheduled jobs** (laptop cleaner, tool checkout, main
  watcher).
  Moves no check on the never-moves list. Costs one more process to keep alive, and a chore can lag
  one tick. The research's lean, about 75% sure.
- **C. Everything after the merge.** The lane only builds and reviews; tests run on main. Fastest to
  land, but it undoes the never-moves list and needs culprit finding and a revert habit we do not
  have.
- **D. B plus a speculative queue** that tests the merge result before main moves (Zuul or GitHub
  shape). Worth it only if B's count of red mains says so.

The owner took B with two scheduled jobs, not three, and with the checkout update hung on the merge
event ([the note](../docs/direction/lane-queue-or-scheduled-job.md#the-picture)).

## Guesses that were wrong

- **Wrong: "a scheduled job in the tooling fast-forwards the main checkout when no step is
  starting."** Main moves only when something merges, so "main changed" is an event, not a level to
  poll. A scheduled job asking "did it change" is the wrong home. Decided instead: the merge queue brings the checkout up
  to date after it merges, once for a burst of merges, at a moment when no step is starting.
- **Wrong: a check run of about 12 minutes is a fair price for keeping tests on the pull request.**
  The research took the 12.5 min median as acceptable. Decided instead: tests stay on the pull
  request and its checks finish in five minutes at most
  ([0106](../.decisions/0106-a-pull-requests-checks-finish-in-five-minutes.md)).

## What it cannot tell us

- How often main goes red after a merge landed by 0097's lint-only rule. 0097 was one day old.
- Whether a scheduled job's process on the laptop stays alive through sleep and restarts. The "last ran" fact
  will show it within two periods; a week of those facts will say how often it died.
- How much of a lander's 8.4 to 13 min a merge is lint, CI wait or line wait. The lander logged
  only the end of each attempt.
- How long `freshmain.ts`'s lint takes on the true merge. Guessed at minutes; not measured.
- Whether GitHub's merge queue is offered to this repo. The docs page read does not say;
  [0049](../.decisions/0049-merge-behind-main-once-lint-passes-on-the-true-merge.md) says not.
- The rate of flaky reds on main: 2 red of 30 recent push runs, causes not read.
- Whether more than one plan writer at a time is safe. That needs the `redact.sh` lock fix and its
  test first.
- A merge done outside the merge queue (by hand on GitHub) raises no merge event, so nothing brings
  the checkout up to date after it. How often that happens was not counted.
- Buildkite's schedules and Google's flaky-test loop were not read. One night of logs; the numbers
  move with the load and with every tooling fix.
