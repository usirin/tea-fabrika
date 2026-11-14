---
state: "decided in pieces, see the note"
summary: "A scheduled job is a program that listens to the clock, on a Durable Object alarm (Cron Triggers do not fire in local dev). It reads and judges, and files a ticket as an agent; it never changes code. Its false alarms are counted before it files anything. Candidates: PR watcher, TLA+ drift, docs drift, mutation sweep, stale lanes."
---

# Scheduled jobs run on the host's alarms

**Decided, in pieces:**

- The shape: decided by the owner 2026-11-01, below.
- A kept TLA+ spec is checked in the drift job, advise only: decided 2026-10-25 ([experiment 139](../../experiments/139-tla-trace-validation.md)).
- Where a job that reads code runs for a team: answered 2026-11-02, in [Still open](#still-open).
- What is left (which job first, how often) is tuning, not a call.

Proposed 2026-10-24. Decided by the owner 2026-11-01.

Its decided rules are in: [0385](../../.decisions/0385-tla-only-for-a-design-with-no-code.md),
[0422](../../.decisions/0422-a-scheduled-job-listens-to-the-clock.md),
[0423](../../.decisions/0423-one-alarm-set-in-one-function.md),
[0424](../../.decisions/0424-a-job-runs-where-its-config-says.md).

```ts
// A sketch, not built. A scheduled job is a program that listens to the clock.
// It reads and judges, and it files a ticket. It never changes code itself.
const tlaDrift = scheduled("tla_drift", {every: days(1)}, function* () {
	const specs = yield* gather(readSpecs); // each TLA+ spec and the code it describes
	const drifted = yield* check(fitsRealRuns, specs); // do recorded runs still fit the spec? (experiment 139)
	for (const spec of drifted) {
		yield* act(fileTicket, {title: `The TLA+ spec ${spec.name} no longer fits its code`});
	}
});
// Each ticket then runs like any other: triage, plan, the owner's approval, build.
```

## What is proposed

- **A scheduled job is a program on the host that listens to the clock.**
  Elm does this with `Time.every`, a subscription. Our Listen move already
  names the clock as one thing it waits on
  (`packages/pipeline/src/primitives.ts`).
- **It runs on Durable Object alarms, not on Cron Triggers.**
  - The ledger's host is a Durable Object in Miniflare on a laptop and on
    Cloudflare for a team ([sync engine](./a-local-first-sync-engine.md)).
    An alarm fires the same way in both.
  - Cron Triggers do not: "Local development does not run Cron Triggers
    automatically"
    ([Cloudflare](https://developers.cloudflare.com/workers/configuration/cron-triggers/)).
  - Each job is its own program with its own alarm, since a Durable Object
    has one alarm and the ledger's is for leases.
  - **Decided 2026-11-07 (owner): one alarm per object, set in one function,
    at the earliest timer.** A job's object has one alarm, as this note says,
    and every timer in one object (the ledger's leases among them) goes
    through that one function, so no timer overwrites another. It is tested by
    killing the object mid-step (workerd's `state.abort()`, then
    `runDurableObjectAlarm`). This settles the disagreement in
    [the cloud is one more host](./the-cloud-is-one-more-host.md#notes-this-draft-disagrees-with),
    whose draft said one alarm per host.
- **A job never changes code. It files a ticket,** written by an agent
  writer, so the timeline shows who filed it
  ([the ticket is the lane's one view](./the-ticket-is-the-lane-view.md)).
  Everything after that goes through the lane, the owner's approval of the plan
  included. Dependabot works on a schedule too, but it opens pull requests
  ([GitHub](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)).
  A ticket is one step more careful.
- **Before a job files tickets, its false alarms are counted.** A job that
  files noise fills the tracker. A ticket does not block anything, so it is
  held to the bar for advice: at Google, checks shown in code review may be
  wrong up to 10% of the time, and an analyzer whose results are marked "not
  useful" more often than that is turned off
  ([Sadowski et al., CACM 2018](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/);
  [experiment 125](../../experiments/125-check-audit.md)). Until a job is
  under that, it only reports.

Jobs this could run, each a guess until it is tried:

| job | reads | files a ticket when |
|---|---|---|
| PR watcher | GitHub, each open pull request | never: it writes `pr` facts ([tracker](./tickets-start-in-our-tracker.md)) |
| TLA+ drift | each spec and recorded runs of its code | real runs no longer fit the spec. Decided 2026-10-25: a kept spec is checked here, advise only (experiment 139: 0 false alarms in 600 right runs) |
| docs drift | doc lines tickets added | a line no longer holds on main (experiment 134) |
| mutation sweep | a sample of code no ticket touched lately | a mutant survives every test |
| stale lane | the ledger | a lane has waited on an ask too long |

## Why

- **It uses what the host already has.** Alarms, storage and a clock come
  with the Durable Object, in Miniflare as on Cloudflare. A job needs no
  second scheduler.
- **Drift is found when it happens, not when it hurts.** A spec, a doc or a
  test that no longer fits its code is cheap to fix the week it drifts.

**Cost:**

- Each job is a program to write and keep.
- A job that reads code must run where the code is. On a laptop that is
  fine. ~~On Cloudflare there is no copy of the code, so those jobs run on a
  person's own host, and only while it is up.~~ *Changed 2026-11-02 by the
  owner ([experiment 197](../../experiments/197-daily-checks-on-cloudflare.md)):
  on Cloudflare a job's hands can be a box that clones the public repo, one box
  object per batch. Where each job runs is set in its config (`laptop`, `box`
  or `laptop first`), `laptop` by default, and a box job runs under a daily box
  cap, 1 box hour to start. Nothing balances jobs across machines on its own.*
- Each job needs its false alarms measured before it files anything.

**How sure: 70%.** The doubts: whether a laptop's host is up often enough for
a daily job, and how noisy each job is. The PR watcher running for a week
would settle the first. For TLA+ drift, experiment 139 raised no false alarm
on 600 runs, but of stand-in children; a week on real lanes would settle it.

## Still open

- Which job comes first. The PR watcher is already the lean for the first
  version.
- ~~Where a job that reads code runs for a team.~~ Answered 2026-11-02: on a
  person's laptop, or in a box on Cloudflare, as its config says.
- How often each one runs.

## What it cannot tell us

2026-11-11: stage 1 is built in `next/` as `schedules/ScheduledJob.make`, a machine factory over the existing program wake and Process alarm path; real Cloudflare hibernation remains unverified.
