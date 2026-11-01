# A fast check per pull request, a mutation queue for the rest

Decided 2026-11-01:

- A check that takes hours never gates a pull request. The check on each pull request is
  very fast.
- The rest goes to a mutation queue, a program in `next/` shaped like a merge queue (Tier 6).
- Today's version keeps only the speedups on each pull request. Its daily run is not built.

The budget and the method below are **proposed**. The numbers are from
[experiment 181](../../experiments/181-fast-and-daily-mutation.md).

```ts
// A sketch, not built. Two jobs for one tool.
// Today's version, and `next/` after it: the check on each pull request.
const fast = mutation({
	mutants: "changed lines, one per line first, then the rest",
	limits: {wall: minutes(5), perTest: seconds(10), overRun: seconds(5)},
	static: "off", // Stryker's ignoreStatic
	tests: "related, the lane's end-to-end tests left out",
	answer: "advice", // a survivor never stops the pull request
});
// `next/` only: the mutation queue, on a Durable Object alarm.
const queue = scheduled("mutation_queue", {every: days(1)}, function* () {
	yield* act(enqueue, yield* gather(wholeCodebaseSweep)); // joins what pull requests left over
	const batch = yield* gather(nextBatch); // in order, repeats dropped by Gap id
	const found = yield* listen(handsRan(batch)); // hands run Stryker, never the brain
	for (const ticket of yield* check(newGaps, found)) yield* act(fileOrComment, ticket); // 3 a day
	for (const gone of yield* check(goneGaps, found)) yield* act(commentAndClose, gone);
});
```

## The rule, decided

- **A check that cannot finish inside the per-pull-request budget does not gate the pull
  request.** It runs on a schedule, and what it finds becomes a ticket in our tracker. The
  ticket goes through the lane like any other.
- **The cost, said plainly.** A gap a long check would have found reaches main, and is found
  a day or more later. A survivor is a missing test, not a bug. The damage is a real bug that
  sits in that same gap. What limits it:
  - The fast check still runs on the pull request's own changed lines first.
  - Every pull request on main can be reverted.
  - The queue's ticket is picked up by the lane like any other, so how fast it is fixed is how
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
| Mutation over the whole codebase | about 48 worker hours for a first pass, a guess | the queue, `next/` |
| Mutants under the lane's end-to-end tests | about 100 s per mutant | not at all, for now |
| TLA+ drift ([scheduled jobs](./scheduled-jobs-on-the-host.md)) | not measured | daily |

**What never moves to the daily side, whatever it costs.** A check that stops the wrong thing
from merging, or work from being lost: the merge's pin to its head, `not_yours`, the plan
approval's hash, the exam change's `ask:check_change`, no agent approving, the ship gate,
typecheck, lint, the leak checks, the dead-export ledger, and the tests of changed files. If
one of these ever outgrows the budget, the budget grows or the check gets faster. It never
moves.

## The fast check, proposed

Today's version gets this now, through the pipeline. `next/` keeps the same settings.

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
  - Cost: static mutants are not checked on a pull request. A pull request over the cap is
    only partly checked.
  - Sure: 75%. The doubt is the rate on slow tests. A week of the real step's timings
    settles it.
- **The budget: 5 minutes of wall time on 2 workers.** About 90 to 300 mutants. The median
  merged pull request has 98. Why 5: CI's own checks take about 2.5 minutes, and a wait twice
  that is still short. That is our judgment; no source gives a number. Sure: 70%.
- **Over the budget.** The check stops and says in plain words how many lines and mutants it
  did not reach. In `next/`, those enter the mutation queue. In today's version they are only
  reported, since nothing picks them up. A pull request is not split to fit the check.
  Splitting is for the review.

```ts
// A sketch. What the fast check reports, as data. Nothing in it can stop the lane.
type FastCheck = {
	ran: number; // mutants that got an answer
	lines: {changed: number; reached: number};
	stopped: "done" | "time"; // "time": in `next/`, the rest enters the queue
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
  [Hanley and Lippman-Hand, 1983](https://doi.org/10.1001/jama.1983.03340130102038)), and the
  survivors may then be sent to the test writer once, inside the budget. Blocking needs about
  300 in a row with no `noise` for 1%. Sure this is the right order: 85%.
- **What a fast-check survivor is not.** A static mutant, or one no fast test covers, is "not
  covered by the fast tests", not a gap. In 181, 39% of those were caught by the lane's
  end-to-end tests.

## The mutation queue, `next/` only, proposed

A program in Tier 6, under "Pipeline stages, schedules" in [the tiers](../plan/tiers.md).

```ts
// A sketch. The queue's state, as data in the ledger.
type Entry = {
	gap: Gap["id"]; // the stable id below: a repeat is dropped, never queued twice
	from: {_tag: "pr"; pr: number} | {_tag: "sweep"; day: string};
	at: number; // the referee's clock: the queue's order
};
type Queue = {waiting: Entry[]; running: {batch: Entry[]; hands: string} | null};
// One day, made-up numbers: a pull request left 40 lines; the sweep adds 3,000 mutants, 2,960 of them already known
// and unchanged, so dropped. 80 entries wait; hands take a batch of 80; 6 live; 2 tickets.
```

- **Two ways in.** The lines a pull request's 5-minute cap did not reach, and a daily sweep of
  the whole codebase.
- **In order, no repeats.** The queue keeps entries in order. An entry whose id is already
  waiting, or was run on the same code, is dropped. Leftovers from a pull request go before
  the sweep.
- **Hands run Stryker, never the brain.** Running mutants is machine work. The queue hands a
  batch to hands, as any job ([brain, hands, window, agent](./brain-hands-window-agent.md)),
  and waits for the answers. A batch that crashes is split and its entries run again alone.
- **It files tickets from survivors,** at most 3 a day, as below.
- **It runs on a Durable Object alarm,** as
  [scheduled jobs run on the host's alarms](./scheduled-jobs-on-the-host.md) says, and it reads
  and writes the tracker on the ledger. So no GitHub Actions shards and no laptop job fetching
  through `CodeHost`: experiment 181's first lean for today's version, now replaced.

**How merge queues work, and what carries over.** GitHub's merge queue puts each pull request
on top of the base and the ones ahead of it, runs the checks, and "automatically removes" an
entry whose check fails, then goes on with the rest. It caps how many builds run at once
("build concurrency") and how many pull requests go in one group ("merge limits")
([GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
bors checks "the combination, before it goes to master", batches pull requests up to
`max_batch_size`, and never batches two priorities together
([pitch](https://bors.tech/essay/2017/02/02/pitch/), [docs](https://bors.tech/documentation/)).

| Merge queue | Mutation queue |
|---|---|
| Entries in order | Carries over |
| Build concurrency | Carries over: how many batches the hands take at once |
| Merge limits, `max_batch_size` | Carries over: mutants per batch |
| Priorities never batched together | Carries over: a pull request's leftovers before the sweep |
| A failing entry is removed, the rest go on | Changed: a crashed batch is split, and a live mutant is a finding, not a failure |
| Each entry tested on top of the ones ahead | Does not carry over: mutants are tested alone, on main |
| It merges | Does not carry over: it files tickets |
| Drops repeats | New here: neither page says a merge queue does; ours drops by `Gap` id |

- **Sure: 70%.** The doubt is the hands. A first pass over about 87,000 mutants is about 48
  worker hours (a guess), so a laptop's hands take days of rolling batches. After the first
  pass, only changed code and tests enter. If that is too slow, a VM host is the answer the
  hands design already has, at no new account if it is free. That is not proposed here.

## Tickets from the queue, proposed

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
- **No repeats across days.** The queue keeps the ids it has filed, in the ledger, as facts. A
  known id is never filed again. A new survivor in a symbol with an open ticket is a comment
  on that ticket.
- **A survivor that goes away.** When every gap of a ticket is killed, or its code is gone,
  the queue comments and closes the ticket.
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
triage, the `mutants` job on the ticket's gaps, one review, ship. No builder.

**Where it gets fixed: in `next/`'s pipeline stages, in Tier 6, before the queue files its
first ticket.** Today's version files no queue tickets, so its lane keeps the gap. Sure: 75%.
The doubt is whether the plan step is still needed when the ticket already names the gaps.

## Size of the build

**Today's version: the fast check only.** Through the pipeline, one pull request. Its daily run
is not built: the fetch job, the Actions shards and the weak-test path were 15 to 24 agent
hours in code that `next/` deletes.

| Part | Files | Lines | Tests | Agent hours |
|---|---|---|---|---|
| Settings: 10 s test limit, static off, slow test files out | 1 to 2 | 30 to 60 | 4 to 6 | about 1 |
| The 5-minute cap in the step, with the reporter that keeps each answer | 1 to 2 | 80 to 120 | 5 to 8 | 1 to 2 |
| Lines first, then the rest, and the "not reached" count | 1 | 50 to 80 | 4 to 6 | about 1 |
| A survivor answers `done` with advice, not `send` | 1 | 20 to 40 | 3 to 4 | under 1 |
| **Total** | **3 to 5** | **180 to 300** | **16 to 24** | **3 to 5** |

The batch typecheck is left out: as built in 181 it gave wrong answers, and its safe form was
never run. Survivors keep today's one typecheck each.

**`next/`, Tier 6: the mutation queue, the gap ids and tickets, and the weak-test path.** Not
sized here. It is planned with that tier.

## What would change this

- A week of the fast check on real pull requests with more than 10% `noise`: survivors stay
  report-only, and the queue's tickets wait.
- Hands much slower than our guess: smaller daily batches, or a VM host for the queue.
- A real bug that reached main and sat in a gap the fast check skipped: shorten the test
  limit less, or run static mutants on changed lines too.
