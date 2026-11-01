# A fast check per pull request, a daily run for the rest

Decided 2026-11-01: a check that takes hours never gates a pull request. The check per pull
request is very fast, and a daily run covers the whole codebase. The budget and the method
below are **proposed**. Today's version: the mutation step in
`packages/pipeline/src/stages/mutation/`. The numbers are from
[experiment 181](../../experiments/181-fast-and-daily-mutation.md).

```ts
// A sketch, not built. Two runs of one tool, with different jobs.
const fast = mutation({
	mutants: "changed lines, one per line first, then the rest",
	limits: {wall: minutes(5), perTest: seconds(10), overRun: seconds(5)},
	static: "off", // Stryker's ignoreStatic
	tests: "related, the lane's end-to-end tests left out",
	answer: "advice", // a survivor never stops the pull request
});
const daily = scheduled("mutation_daily", {every: days(1)}, function* () {
	const found = yield* gather(readActionsArtifact); // GitHub Actions ran the shards
	for (const gap of yield* check(newOrChanged, found)) yield* act(fileOrUpdateTicket, gap);
	for (const gone of yield* check(noLongerLive, found)) yield* act(commentAndClose, gone);
});
```

## The rule, decided

- **A check that cannot finish inside the per-pull-request budget does not gate the pull
  request.** It runs on a schedule, and what it finds becomes a ticket in our tracker. The
  ticket goes through the lane like any other.
- **The cost, said plainly.** A gap a long check would have found reaches main, and is found
  up to a day later. A survivor is a missing test, not a bug. The damage is a real bug that
  sits in that same gap. What limits it:
  - The fast check still runs on the pull request's own changed lines first.
  - Every pull request on main can be reverted.
  - The daily ticket is picked up by the lane like any other, so how fast it is fixed is how
    fast the owner slots it.
- **This is not new here.** CI on a pull request already runs only the tests of changed files
  (`--changed`), and main runs them all, one merge late.

## Which checks fall where

Times are from 31 recent successful CI runs on this repo (p50, seconds).

| Check | Time | Side |
|---|---|---|
| typecheck, lint, build, the Promise gate | 43, 44, 9, 4 | gates |
| Tests of changed files, per shard | 50 to 56 (p90 up to 243) | gates |
| e2e on macOS | 96 (max 183) | gates |
| Fast mutation on changed lines | 5 minutes at most, proposed | advises |
| All tests on main | 171 to 241 per shard | one merge late |
| Mutation over the whole codebase | about 16 runner hours, a guess | daily |
| Mutants under the lane's end-to-end tests | about 100 s per mutant | daily, or not at all |
| TLA+ drift ([scheduled jobs](./scheduled-jobs-on-the-host.md)) | not measured | daily |

**What never moves to the daily side, whatever it costs.** A check that stops the wrong thing
from merging, or work from being lost: the merge's pin to its head, `not_yours`, the plan
approval's hash, the exam change's `ask:check_change`, no agent approving, the ship gate,
typecheck, lint, the leak checks, the dead-export ledger, and the tests of changed files. If
one of these ever outgrows the budget, the budget grows or the check gets faster. It never
moves.

## The fast check, proposed

- **How it runs.** Static mutants off, a 5 s over-run and a 10 s test limit, not 60 s. The
  lane's end-to-end tests and the nested Stryker tests left out. Mutants in a fixed seeded
  order, one per changed line first, then the rest. A reporter writes each answer as it
  comes, and at 5 minutes the step stops the Stryker process it started and keeps what it
  has (Stryker has no cap of its own; a stop from outside missed it in 181). Survivors are
  typechecked as one batch when the batch is clean, and one at a time when it is not (181:
  pinning errors to lines in a batch was wrong 15% of the time).
  - Why: on three real sets, this lost no kill except on static mutants (0% to 14% of each
    set) and cut mutant time by 17% to 95%. The test limit alone took the ship gate from
    2,870 s to 931 s. Lines first keeps the cover of one mutant per line without its blind
    spot: one per line alone missed 27% to 40% of the lines where a mutant lived.
  - Cost: static mutants are only checked daily. A pull request over the cap is partly
    checked until the next day.
  - Sure: 75%. The doubt is the rate on slow tests. A week of the real step's timings
    settles it.
- **The budget: 5 minutes of wall time on 2 workers.** About 90 to 300 mutants. The median
  merged pull request has 98. Why 5: CI's own checks take about 2.5 minutes, and a wait twice
  that is still short. That is our judgment; no source gives a number. Sure: 70%.
- **Over the budget.** The check stops, says in plain words how many lines and mutants it did
  not reach, and the daily run reaches them. A pull request is not split to fit the check.
  Splitting is for the review.

```ts
// A sketch. What the fast check reports, as data. Nothing in it can stop the lane.
type FastCheck = {
	ran: number; // mutants that got an answer
	lines: {changed: number; reached: number};
	stopped: "done" | "time"; // "time": the rest goes to the daily run
	survivors: ReadonlyArray<Survivor>;
};
// PR 267's first stage, replayed with static off and the 10 s limit: 210 of its 256 mutants,
// 175 s of mutant time against 1,230 s. Live mutants still on 71 of its 87 live lines; the
// other 16 lines had only static mutants live.
```

## What a survivor does, proposed

- **Today a survivor sends the lane back:** `send:test_writer:mutant_survived` in
  `stages/mutation/machine.ts`, and its comment says every survivor blocks.
- **Proposed: a survivor advises and never blocks.** The step answers `done` with its
  survivors attached. They show in the review and on the ticket, and the owner rates each
  one, as [every finding is rated](./every-finding-is-rated.md) says. A survivor the owner
  rates `noise` is never shown again.
- **Why.** Blocking needs about 0% false alarms, and advice up to 10% (Google, CACM 2018).
  We have no measured rate for survivors on real pull requests. The lane's own mutation step
  has never run on a real ticket. The studies give: in 119, 1 of 12 checked was not a real
  uncovered change; in 126, 4 of 11 hand-checked survivors were not real gaps. Together 5 of
  23, 22%. Google reports 82% useful, so 18% not. Both are above even the advice bar, so even
  advice must be measured first: shown, rated, and counted.
- **How it earns more.** With no `noise` in 30 rated survivors in a row, the false alarm rate
  is under 10% with 95% confidence (the rule of three, 3 / 30:
  [Hanley and Lippman-Hand, 1983](https://doi.org/10.1001/jama.1983.03340130102038)), and the survivors may then be
  sent to the test writer once, inside the budget. Blocking needs about 300 in a row with no
  `noise` for 1%. Sure this is the right order: 85%.
- **What a fast-check survivor is not.** A static mutant, or one no fast test covers, is "not
  covered by the fast tests", not a gap. In 181, 39% of those were caught by the lane's
  end-to-end tests.

## The daily run, proposed

- **Where: GitHub Actions on this public repo.** Standard runners are free in public repos.
  A job may run 6 hours, and the free plan runs 20 jobs at a time. 20 shards over the whole
  codebase, legacy left out: about 87,000 mutants. After the first pass, incremental reuse
  runs only what changed; a weekly `force` catches what it cannot see. No new account.
  Sure: 70%. The doubt is the rate on GitHub's runners.
- **Actions cannot reach the tracker.** Today's tracker is `ledger.sqlite` in the app's home
  on the laptop, with a socket for local agents only. `fabrika post` needs a connected home
  and a grant signed with the person's key (`apps/fabrika/src/host/post.ts`).

| Option | What it costs | What it cannot do |
|---|---|---|
| **The laptop fetches.** Actions uploads an artifact; a job on the host's clock fetches it through `CodeHost` and files as `agent:mutation` | One small program; no secret in Actions | Files only while the app runs |
| The laptop runs it all, when idle | Nothing new | 87,000 mutants keeps the laptop busy for days |
| The tracker answers from outside | The cloud ledger and a key for CI, stored in Actions | A key on GitHub that can write tickets; the real tickets moved; a security review first |

**Lean: the laptop fetches.** Why: no key leaves the laptop, and it fits
[scheduled jobs on the host](./scheduled-jobs-on-the-host.md): a program that listens to the
clock and files a ticket. Cost: tickets wait for the app to be open. Sure: 80%. GitHub Issues
as the inbox is out: [tickets start in our tracker](./tickets-start-in-our-tracker.md).

## Tickets from the daily run, proposed

```ts
// A sketch. A survivor's name must not change when lines move. The example values are a real
// mutant of the ship gate, shown as if it lived; today's tests kill it.
type Gap = {
	id: string; // hash of the fields below, never of a line number
	file: string; // "packages/pipeline/src/stages/ship/gate.ts"
	symbol: string; // the named function or const it sits in: "BY_APPROVAL"
	mutator: string; // "StringLiteral"
	from: string; // the original text: "\"approval\""
	to: string; // "\"\""
	nth: number; // the same text twice in one symbol: 0, 1, ...
};
// A ticket is one symbol's gaps, never one mutant's.
type Daily = {filed: Gap["id"][]; updated: Gap["id"][]; closed: Gap["id"][]; held: number};
```

- **One ticket per real problem.** Survivors group by file and symbol. One function with six
  live mutants is one ticket with six lines in it.
- **No repeats across days.** The job keeps the ids it has filed, in the ledger, as facts. A
  known id is never filed again. A new survivor in a symbol with an open ticket is a comment
  on that ticket.
- **A survivor that goes away.** When every gap of a ticket is killed, or its code is gone,
  the job comments and closes the ticket.
- **No flood.** At most 3 new tickets a day, ranked by how many gaps they hold. The rest are
  held, and `held` says how many. A gap the owner rated `noise` is never filed again. 3 is our
  guess at what the lane takes in a day. Sure: 60%; a week of real tickets settles it.
- **The id is like Stryker's own.** Incremental reuse matches mutants by their text, not their
  line (181: every line moved, and every mutant was reused).
- **Before any ticket, its false alarms are counted,** as scheduled jobs say. The first weeks
  report, and the owner rates.

## The lane takes a weak-test ticket, proposed

A weak-test ticket asks for a test and no product change. Today's lane cannot finish one:

- Triage's `plan` route fits, and the plan's Property `behavior: "existing"` must pass on the
  base, which a test for a live mutant does.
- **The builder has nothing to change,** so build ends `stuck:no_change`, and the lane ends
  stuck.
- **The mutation step skips a test-only diff** (`skip:no_lines`), so nothing proves the new
  test kills the mutant.

The test writer's `mutants` job already does the work: a test that is red on the mutant and
green on the original, or `cannot`, or `noise`. So a weak-test ticket takes a short path:
triage, the `mutants` job on the ticket's gaps, one review, ship. No builder. Sure: 75%. The
doubt is whether the plan step is still needed when the ticket already names the gaps.

## Size of the build

Today's version, through the pipeline, one pull request each.

| Part | Files | Lines | Tests | Agent hours |
|---|---|---|---|---|
| The fast check: settings, lines first, time cap, batch typecheck, `done` with advice | 3 to 4 | 200 to 300 | 15 to 20 | 3 to 5 |
| The daily workflow: shards, incremental file, artifact | 3 | 300 to 400 | about 20 | 4 to 6 |
| The fetch and file job on the host, with the gap ids | 3 to 4 | 300 to 450 | about 25 | 5 to 8 |
| The weak-test path in the lane | 3 to 4 | 150 to 250 | about 15 | 3 to 5 |
| **Total** | **12 to 15** | **950 to 1,400** | **75 to 80** | **15 to 24** |

## What would change this

- A week of the fast check on real pull requests with more than 10% `noise`: survivors stay
  report-only, and the daily tickets wait.
- GitHub's runners much slower than our guess: fewer mutants a day, or a rolling pass over
  several days.
- A real bug that reached main and sat a day in a gap the fast check skipped: shorten the
  test limit less, or run static mutants on changed lines too.
