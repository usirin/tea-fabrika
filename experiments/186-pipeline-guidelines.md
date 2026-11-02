# 186. How do factories, supervisors and build tools handle a stop, and where does the self-fix plan break it?

Read 2026-11-01. **This is reading, not a measurement.** No code ran and no model was called; the
sources are public pages, one book, one paper, today's code on main at `02a238ea`, and the files of
[PR 289](https://github.com/usirin/tea-fabrika/pull/289) on its branch. It feeds
[pipeline guidelines](../docs/direction/pipeline-guidelines.md), a note whose five core principles
the owner decided on 2026-11-01, and a private page, "Pipeline guidelines".

**The answer.** The makers agree, and the plain way is enough:

- **Stop the line on an abnormality, and say where and why.** Toyota, Shingo and the Lean
  Enterprise Institute.
- **Restart only what broke, a bounded number of times, then hand it up.** Erlang/OTP.
- **Keep finished work, and go on from the point that broke.** Temporal's reset, GitHub's "re-run
  failed jobs".
- **Never redo a step whose inputs did not change.** Bazel and Nx, and "early cutoff" in *Build
  systems à la carte*.
- **Retry at one level only, with a number.** AWS, Buildkite, Argo.
- **Ask a person only what needs a person.** Google SRE.

Today's lane (main, today's version) follows about half of this. PR 289 fixes most of the rest.
Checked against the twelve principles, **35 places in PR 289 break one, in 17 groups.** The worst
three:

1. **When the fold cannot prove a field, ticket 117 starts a fresh lane, "every step again".** It
   breaks P4 (resume, never redo) at the one moment it matters most.
2. **The resume point is optional in the note's own type** (`held?: Held`). It breaks P6, and it
   contradicts PR 5's own "not a value the type allows".
3. **A conflict in an exam file on rebase "stops the lane and names the files",** with no picks
   and no resume point. It breaks P5, P6 and P10.

```text
what each source says, one line each
Toyota       machines "detect the abnormality and stop automatically"; people respond only then
LEI          jidoka "separate[s] men and machines"; a shutdown device beats a warning device
Shingo       inspect at the source, right after the act
OTP          one_for_one restarts only the child that died; intensity 1 in 5 seconds by default
Temporal     a reset keeps history up to the reset point and goes on; activities are idempotent
GitHub       rerun --failed reruns only the failed jobs, on the same commit
Bazel, Nx    a hash of inputs; a hit restores the output and does not run
SRE          every page actionable; a robotic response should be automated, not paged
AWS          retries multiply across layers (243x); retry at one point; keys for every write
Buildkite    automatic retry: default 2, at most 10, chosen by exit status
```

Which version: the sources are outside the repo. "Today's lane" is today's version on main. "PR
289" is today's version, as planned. Nothing here is about `next/`, except that the note's
principles are meant for its lane too.

## What was read

All pages read 2026-11-01. Quotes are short and checked against the page as fetched. A claim found
only in an older note of ours is marked so.

### Factories

- **Toyota, "Toyota Production System".** Jidoka is "automation with a human touch". Machines
  "detect the abnormality and stop automatically", or an operator pulls the stop cord. "When
  equipment stops, the andon (problem display board) lights up to notify workers of the
  abnormality." "People need only respond when there is an abnormality, thus eliminating the need
  for a person to watch over the equipment." [f1]
- **Lean Enterprise Institute lexicon.** Jidoka: "the ability to detect when an abnormal condition
  has occurred and immediately stop work", which helps "separate men and machines". Andon: a tool
  that shows "the status of operations in an area at a single glance", by station and by kind of
  problem, and "summons a quick response from the team leader". Poka-yoke is "error-proofing"; a
  shutdown device, where "a machine will not start if a work piece is set incorrectly", is "the most
  powerful", above a warning device that alerts "by a buzzer or light". [f2]
- **Shigeo Shingo,** *Zero Quality Control: Source Inspection and the Poka-yoke System*
  (Productivity Press, 1986). Catch a mistake at its source, with a device, not with an inspection
  after. Not reread for this study; the summary is the one in "Jidoka and andon" on PR 289. [f3]

### Supervisors and durable workflows

- **Erlang/OTP, supervisor behaviour.** `one_for_one`: "If a child process terminates, only that
  process is restarted." `one_for_all` and `rest_for_one` restart more. Intensity and period
  "default to `1` and `5`": more than one restart in five seconds and the supervisor "terminates all
  the child processes and then itself", so its parent decides. A `transient` child "is restarted
  only if it terminates abnormally"; a `temporary` one "is never restarted". [s1]
- **Temporal, reset.** "A Reset terminates a Workflow Execution and creates a new Workflow
  Execution with the same Workflow Type and Workflow ID." "The Event History is copied from the
  original execution up to and including the reset point." "The new execution continues from the
  reset point." [s2]
- **Temporal, activities.** "Temporal recommends that Activities be idempotent", because "Activities
  may be retried". Use "idempotency keys", "enforced by the service you are calling", such as "a
  combination of the Workflow Run ID and the Activity ID". [s3]
- **Temporal, retry policies.** An Activity retries from "a 1-second initial interval", "a 2.0
  backoff coefficient", "capping at a maximum interval of 100 seconds", with no limit on attempts by
  default. "Unlike Activities, Workflow Executions do not retry by default." [s4]
- **LangGraph `interrupt`.** Saves state, and `Command(resume=...)` goes on; the node runs again
  from the top, so work before the interrupt must be safe to repeat. From
  [one ask](../docs/direction/one-ask-and-one-meter.md), read there 2026-10-30, not reread. [s5]

### CI and build caches

- **GitHub Actions.** "Re-run failed jobs", or `gh run rerun RUN_ID --failed`, "up to 30 days
  after its initial run", at most 50 times. A rerun uses "the same `GITHUB_SHA`" and "`GITHUB_REF`".
  [c1]
- **Buildkite.** Automatic retry by `exit_status`; "When a limit is not specified, the default limit
  is two", and "The maximum value this can be set to is 10." A manual retry can be turned off with a
  `reason` shown on the Retry button. [c2]
- **Argo Workflows.** A `retryStrategy` with a `limit` and a `retryPolicy`: `Always`, `OnFailure`,
  `OnError`, `OnTransientError`. "The default `retryPolicy` is `OnFailure`." [c3]
- **Bazel remote caching.** An action has "inputs, output names, a command line, and environment
  variables". The action cache maps action hashes to results; a hit fetches the output. A warning:
  tools outside the workspace are not tracked, so builds with different compilers can "wrongly
  share cache hits". [c4]
- **Nx.** A task's hash covers its source files, its dependencies, global config and command-line
  arguments. A hit restores the files and the terminal output instead of running. [c5]
- **Andrey Mokhov, Neil Mitchell and Simon Peyton Jones,** "Build systems à la carte", ICFP 2018.
  "Early cutoff": when a rebuilt input comes out the same, the things after it are not rebuilt. From
  memory of the paper, not reread. [c6]

### Paging a person, and retries

- **Google SRE, monitoring.** "Every page should be actionable." "Every page response should require
  intelligence. If a page merely merits a robotic response, it shouldn't be a page." "Pages with
  rote, algorithmic responses should be a red flag." "I can only react with a sense of urgency a few
  times a day before I become fatigued." [p1]
- **Google SRE, toil.** Toil is "manual, repetitive, automatable, tactical, devoid of enduring
  value", and "scales linearly as a service grows". The goal: under half of each person's time. [p2]
- **AWS Builders' Library, retries.** Retries are selfish: a client "spends more of the server's
  time to get a higher chance of success". Three retries at each of five layers makes "the load on
  the database ... 243x". Practice: "retry at a single point in the stack", with a token bucket, and
  backoff with jitter. "APIs with side effects aren't safe to retry unless they provide
  idempotency." [p3]
- **AWS Builders' Library, idempotent APIs.** A caller-given request id, "a semantically equivalent
  response in every case for the same unique request identifier", and "a validation error" when the
  same id comes with other parameters. [p4]

## Today's lane, against the principles

Read on main at `02a238ea`, today's version.

| Principle | Today's lane | Where |
|---|---|---|
| P1 a person only to judge | breaks: every step's `stuck` ends the lane, and the person finds out why | `machine.ts:317-320` |
| P2 red goes back | breaks: red after build has no route; review's send-back does | `machine.ts:339-341` |
| P3 prevent first | partly: a lane with no `origin` is refused before any agent | the lane's start |
| P4 resume, never redo | half: a kill mid-step goes on under the same intent (experiment 175); a stuck lane is final, and the same line only says how it ended | `machine.ts:20-22`, `program.ts:1038-1045` |
| P5 go on after a judgment | half: `again` on a step's ask runs that step and keeps the rest; `exam_touched` ends the lane | `machine.ts:350-362` |
| P6 a stop saves a resume | breaks: `over` keeps the outcome and the trail only | `machine.ts:266-271` |
| P7 keyed by inputs | half: a step is keyed by its place, `lane/<n>/<count>/<step>`, not by what it read | `machine.ts:513` |
| P8 bounded retries | half: `MAX_ROUNDS = 3` for review; no source | `machine.ts:57` |
| P9 a skip never looks clean | breaks on 117: the builder said `done` with its checks dead | PR 289's plan |
| P10 picks and where they resume | half: picks exist; the reason and the resume are not in words (experiment 178) | `machine.ts:350-362` |
| P11 cost and attention counted | half: dollars on `ended`; asks are facts, but no view counts them | `tickets/ticket.ts` |
| P12 nobody writes their own exam | holds: the guard ends `stuck:exam_touched` | build's guard |

## Where the self-fix plan breaks a principle

Every row of the ask table in "Jidoka and andon" (69 rows) and every pull request in the plan
"pipeline-self-fix" (PRs 1 to 6, the restart of ticket 117 and the unresolved questions), on PR
289's branch, read against the twelve principles. A row with a fine route is left out. **35 places
in 17 groups.** Groups 1 to 5 are serious: each redoes finished work or loses a resume point.
Groups 6 to 10 are medium, 11 to 17 small. None of PR 289's files were changed.

| # | Where | What it says | Breaks | Lean fix |
|---|---|---|---|---|
| 1 | Plan, "Ticket 117 restarts", and unresolved question 7 | If the fold cannot prove a field: "a fresh lane on ticket 117, every step again" | P4, P7 | Name the field, and go back only to the earliest step that writes it. A missing `decided` asks the plan's yes again, one click; a missing `exam` is the test writer's commit, still in git |
| 2 | Note, "Restart from the step that broke" | `over` has `held?: Held; at?: LaneStep`, both optional | P6 | Required on a stuck `over`, as PR 5's text already says |
| 3 | Plan, PR 5 | A conflict in an exam file on rebase "stops the lane and names the files" | P5, P6, P10 | An ask with picks: the test writer again for those files on the new base, or stop, saved at the rebase |
| 4 | Note, "Three kinds of stop" | `Stop` has `judgment`, `fixable`, `preventable`; the andon stop is prose only | P6 | A fourth variant, `andon`, with a required `resume` |
| 5 | Plan README, "Who decides what" (PR 289 edits this file and keeps the line) | "a builder's diff to the exam files ends the lane stuck: nothing the build did is kept" | P5 | Replace with the ask and its two picks; every agent reads this file first |
| 6 | Note, the restart sketch | `RESTARTABLE.has(s.outcome.why)`: an allowlist | P4 | A closed list of what may not restart (`not_yours`, `merged_elsewhere`); PR 5's law already wants this |
| 7 | Note row 42, the restart section, PR 5 | `exam_touched`: "build runs again"; "the test writer runs again with the person's note" | P5, P7 | Say the head (the builder's, with the exam files put back), the round, and that the test writer redoes only the touched files |
| 8 | Note row 39 | build `draft_failed`: "The builder starts again, as today" | P4, P7 | Resume the agent's session where the harness can, or start the round from the working copy as it stands |
| 9 | Note rows 18, 23, 40, 57 (4 places) | `over_budget` becomes a spend ask | P5, P10 | Each pick names where it goes on: the cut-off session resumed, not a fresh draft |
| 10 | Note row 62 | ship `send:builder:behind`, `conflicts`: "To build, next round", taking main in first | P1, P7 | Code takes main in and runs the checks; build only on red or a conflict, so a clean catch-up spends no agent turn and no round |
| 11 | Note rows 4, 16, 21, 22, 26, 27, 32, 33, 37, 49, 54, 56, 59, 64, 66 (15 places) | "Try again", "Tries", "bounded", with no number | P8 | A number in each, or "the service waits it out" for reads, at one level only |
| 12 | Note rows 2, 17 (2 places) | "3 tries" | P8 | A source, or mark it a guess |
| 13 | Note, "Bounded rounds"; PR 3 | `MAX_ROUNDS = 3` shared, "a guess" | P8 | Kept as a guess, as written; the `step` rows settle it |
| 14 | Note rows 8, 44; PR 3 | `rounds_spent`: "one more round, or stop" | P6, P10 | The `stop` pick saves its resume point, and says so |
| 15 | Note rows 8, 44 | `rounds_spent` shows what is still red | P11 | Also show the dollars the rounds spent |
| 16 | Plan, PR 4 | mutation "skips its own suite run when the head matches" | P9 | The skip is written, with the `checked` it relied on |
| 17 | Note, the `Judgment` list | a closed list of kinds | P10 | Each kind's picks, with their resume, in its definition |

Not counted, one note on a source. "Jidoka and andon" says a step that could not run is run once
more because "OTP's default intensity is 1". OTP's default is a rate, 1 restart in 5 seconds; over
a lane's hours it would allow many. A count of one per key is a fine choice, and stricter, but it
is ours, not OTP's.

### What holds up

Most of PR 289 is the known way, and these parts are the principles at work:

- **PR 3** keeps the failing names on the ticket, and red goes to the builder (P2, P6).
- **PR 4** runs the checks in code after the builder, and not run is never `done` (P9). Its
  mutation skip on a matching head is P7 keyed by inputs, before the word.
- **PR 5** keeps every `done` step, and its laws are P4's holder: every step and every stuck
  reason, stopped and restarted.
- **PR 1** formats in code, a guard and not a send-back (P3).
- **The two decided rules** in "Jidoka and andon" are P1 and P4.

## What this tells us for fabrika

- **The factory words are the plain ones, and they fit.** Jidoka is the lane stopping itself; andon
  is the ticket saying where and why; poka-yoke is a guard in code. Nothing custom is needed.
- **"Restart" and "resume" are one idea with two halves.** OTP and GitHub restart only what broke;
  Temporal and Bazel keep what finished. A lane needs both, and PR 289's plan has both, except in
  its fallback.
- **The redo that hides is the one after a judgment or a gap.** Each worst place above is a case
  nobody had listed: a field the fold cannot prove, an exam file in a conflict, a builder's draft
  that died. Each defaults to "start again". A default of "go on from the step before" fixes all of
  them at once.
- **Keys by place are enough for a kill, not for a moved main.** Today's intent keys survive a host
  dying. Only keys by inputs can tell that a finished step still holds after main moved, and only
  a cheap check can tell that it still holds after its key changed.

## What it cannot tell us

- No lane has resumed from a saved stop with real agents. Every claim about resume rests on the
  sources and on experiment 175's kill and retype, on fake agents.
- Whether keying by inputs saves real money. That needs restarts with `restarted` facts to count.
- Whether 3 rounds is right. No source names a number for an agent's repair loop.
- Whether every row of the check sits in the right group. Each was read, not run.
- Shingo's book and the *à la carte* paper were not reread for this study, as marked.
- What this study cost. It made no paid call of its own; the agent session that wrote it was not
  measured here.

## Links

- [f1] [Toyota, Toyota Production System](https://global.toyota/en/company/vision-and-philosophy/production-system/), read 2026-11-01
- [f2] Lean Enterprise Institute lexicon: [jidoka](https://www.lean.org/lexicon-terms/jidoka/), [andon](https://www.lean.org/lexicon-terms/andon/), [poka-yoke](https://www.lean.org/lexicon-terms/poka-yoke/), read 2026-11-01
- [f3] Shigeo Shingo, *Zero Quality Control: Source Inspection and the Poka-yoke System*, Productivity Press, 1986
- [s1] [Erlang/OTP, Supervisor Behaviour](https://www.erlang.org/doc/system/sup_princ.html), read 2026-11-01
- [s2] [Temporal, Events and Event History: Reset](https://docs.temporal.io/workflow-execution/event), read 2026-11-01
- [s3] [Temporal, Activity Definition](https://docs.temporal.io/activity-definition), read 2026-11-01
- [s4] [Temporal, Retry Policies](https://docs.temporal.io/encyclopedia/retry-policies), read 2026-11-01
- [s5] [LangGraph, interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), as read for [one ask](../docs/direction/one-ask-and-one-meter.md) on 2026-10-30
- [c1] [GitHub Docs, Re-running workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs), read 2026-11-01
- [c2] [Buildkite, Retry](https://buildkite.com/docs/pipelines/configure/retry), read 2026-11-01
- [c3] [Argo Workflows, Retries](https://argo-workflows.readthedocs.io/en/latest/retries/), read 2026-11-01
- [c4] [Bazel, Remote Caching](https://bazel.build/remote/caching), read 2026-11-01
- [c5] [Nx, How Caching Works](https://nx.dev/docs/concepts/how-caching-works), from its search summary 2026-11-01; the page itself did not load
- [c6] Andrey Mokhov, Neil Mitchell and Simon Peyton Jones, "Build systems à la carte", Proc. ACM Program. Lang. 2 (ICFP), 2018, [doi:10.1145/3236774](https://doi.org/10.1145/3236774)
- [p1] [Google SRE book, Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/), read 2026-11-01
- [p2] [Google SRE book, Eliminating Toil](https://sre.google/sre-book/eliminating-toil/), read 2026-11-01
- [p3] [AWS Builders' Library, Timeouts, retries, and backoff with jitter](https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter), read 2026-11-01
- [p4] [AWS Builders' Library, Making retries safe with idempotent APIs](https://builder.aws.com/content/3Ev0BENTyBr0XxzRk5FDZzgNYos/making-retries-safe-with-idempotent-apis), read 2026-11-01
