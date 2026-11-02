# Jidoka and andon: the lane fixes what code can, and asks a person only to judge

**Decided 2026-11-01**, the two rules in [what was decided](#what-was-decided). The details
under them are leans, each marked with how sure. Today's version (`packages/pipeline`,
`programs/pipeline`). The plan that builds it is [pipeline-self-fix](../plan/pipeline-self-fix.md).
Revised 2026-11-01 against the twelve principles of the note "Pipeline guidelines", with
experiment 186, both on [PR 290](https://github.com/usirin/tea-fabrika/pull/290). A `P` number
below is one of those principles.

```ts
// A sketch. Where the lane goes after a build, once code has run the checks at its head.
// Today every `stuck` ends the lane (machine.ts:319), and nothing runs the checks after the builder.
type Checked =
	| {readonly _tag: "green"; readonly head: string}
	| {readonly _tag: "red"; readonly head: string; readonly failed: readonly string[]}
	| {readonly _tag: "not_run"; readonly head: string; readonly why: string};

const afterBuild = (checked: Checked, round: number): Move => {
	switch (checked._tag) {
		case "green":
			return {to: "mutation"};
		case "red": // the factory fixes it: back to the builder, with the failing tests' names
			return round < MAX_ROUNDS ? {to: "build", round: round + 1} : {ask: "rounds_spent"};
		case "not_run": // andon, after one more try: the line stops itself, says why, and saves
			// where it goes on (P6). Never `done`
			return {end: {kind: "stuck", why: "checks_not_run", resume: "checks"}};
	}
};
```

What that would have done on ticket 117's first run (a sketch; the test's name is shortened):

```text
build r1 ends           code runs the checks at 315df8e6: red, 1 failing
                        apps/fabrika/src/tsh.test.ts > ... the frame's takes
send:builder:checks_red build r2, told that name and its first error lines
build r2 ends           checks green at the new head -> mutation -> review -> push
ask:owner:merge         the first time a person is needed
```

## What was decided

Decided by the owner on 2026-11-01.

- **The pipeline asks a person only when a person is really needed:** a judgment only a
  person can make. Everything else is a factory. It fixes itself, retries within limits,
  or the mistake is made impossible.
  - This is poka-yoke, already decided in [make the mistake impossible](./make-the-mistake-impossible.md),
    plus Toyota's jidoka and andon. The line stops itself on an abnormality it cannot fix
    and calls a person, with the reason. It never calls a person otherwise.
- **Crash recovery is required.** A stuck or crashed lane restarts from the step that broke,
  and keeps the steps that finished. The earlier "comes back to the owner after ticket 117"
  deferral is over.

## The known way

| Who | How | What we take |
|---|---|---|
| [Toyota, the Toyota Production System](https://global.toyota/en/company/vision-and-philosophy/production-system/) | Jidoka is "automation with a human touch". When a problem shows, the line stops, by the machine or by the operator's stop cord, and "the andon (problem display board) lights up to notify workers of the abnormality." | A lane stops itself on what it cannot fix, and the ticket says why. A stop is the call for a person; nothing else is. |
| Shigeo Shingo, *Zero Quality Control: Source Inspection and the Poka-yoke System* (Productivity Press, 1986) | Catch a mistake at its source, with a device that makes the wrong act impossible or shows it at once, not with an inspection after. | A check runs in code right after the step that could get it wrong. A rule a person must remember is not a guard. |
| [Erlang/OTP supervisors](https://www.erlang.org/doc/system/sup_princ.html) | In `one_for_one`, "only that process is restarted." Restarts are bounded by an intensity, by default 1 in 5 seconds. Past it the supervisor gives up and its parent decides. | A step that broke is run again, alone, a bounded number of times. Past the bound, the parent decides: here the parent is a person. |
| [Temporal reset](https://docs.temporal.io/workflow-execution/event#reset) | "The Event History is copied from the original execution up to and including the reset point", and the new run goes on from there. | A restart keeps the finished steps' facts and runs from the step that broke. |
| [GitHub Actions, re-run failed jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs) | `gh run rerun --failed` runs only the failed jobs again, up to 30 days after the run, at most 50 times. | A person restarts a stuck lane with one line, and only the broken part runs again. |
| [The DeepSeek study](../../experiments/185-dsh-superagent-study.md) (experiment 185), of [dsh-superagent at 6337fc8](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/000-philosophy.md) | "Every part of the project is judged by the attention it costs." One question at a time. It stops by impact, not by effort. | Count a person's attention the way we count money (lean below). We do not take its "ignore quietly when unsure": a ticket someone filed gets a reason, never silence. |

## The Elm answer first

- A parent steps its children by hand and reads their outcomes. The lane already does
  ([outcome names](./outcome-names.md)). What changes is only the parent's table: `after()`
  routes more outcomes to a step instead of to the end.
- OTP's answer to a child that broke is a supervisor with an intensity. The lane is that
  supervisor for its steps. A person is the supervisor above it, the way OTP hands a
  failure up the tree.
- No new verb and no new move. A check after a step is a Check. A restart is a Msg.

## What it means for the work

### Three kinds of stop, and the andon stop

```ts
// A sketch. Every place the lane asks or stops is one of these, and the type says which.
type Stop =
	| {readonly _tag: "judgment"; readonly ask: Judgment}     // keep the ask: only a person can
	| {readonly _tag: "fixable"; readonly route: Move}       // the factory: retry, send back, fix
	| {readonly _tag: "preventable"; readonly guard: string} // poka-yoke: the state cannot happen
	| {readonly _tag: "andon"; readonly why: string; readonly resume: Resume}; // what is left (P6)

/** Where the lane goes on, and what it carries there. Saved before the stop is written. */
type Resume = {readonly step: LaneStep; readonly held: Held};

/** A closed list. A new ask is a new literal: a reviewed change with its row in this note. */
type Judgment =
	| "approve" | "exam_merge" | "merge" | "ruling" | "questions" | "check_change"
	| "cannot_test" | "disable" | "unseen" | "decision" | "rounds_spent" | "spend"
	| "approval" | "comment" | "exam_touched" | "exam_conflict";

/** Each kind is defined with its picks, and each pick says where the lane goes on (P5, P10). */
type Picks = readonly [Pick, ...Pick[]];
type Pick = {readonly pick: string; readonly does: string; readonly resume: LaneStep | "here"};
const PICKS = {
	rounds_spent: [
		{pick: "again", does: "one more round, with what is still red", resume: "build"},
		{pick: "stop", does: "saved; the same line goes on at build", resume: "build"},
	],
	spend: [ // "here": the step that ran out
		{pick: "more", does: "the cut-off session goes on with the new limit", resume: "here"},
		{pick: "stop", does: "saved; the same line goes on at that step", resume: "here"},
	],
	// ...one entry per kind. A kind with no picks, or a pick with no resume, does not compile.
} satisfies Record<Judgment, Picks>;
```

- **Judgment** keeps its ask, with the reason and its picks. `exam_touched` and
  `exam_conflict` are new kinds, so the list grows from 14 to 16. Each pick says what it does and
  where the lane goes on. A `stop` pick saves its resume point too.
- **Machine-fixable** gets a route: run again, send back with what failed, or fix in code.
  Each route has a number on it ([bounds](#bounds)). Past the bound it becomes an ask
  (`rounds_spent`) or an andon stop.
- **Preventable** gets a guard in code, so the state is never reached.
- **An andon stop** (`stuck`) is what is left: the line could not fix it, and it could not ask
  a narrower question. It always says why, and it always carries its `resume`, so it is not a
  value without one. In the tables below, "then stop" means this stop, saved at that step.

### Bounds

Every retry in this note has a name, a number and a place, at one level only (P8). The tables
below use the names.

| Name | What failed | Bound | Where | Source |
|---|---|---|---|---|
| `wait` | a read, or a keyed write, to the ledger or the code host | until it answers, backing off from 1 second, doubling, up to 100 seconds apart; the tile says what it waits on | the service that owns it, never the lane or a step | Temporal's default retry policy; AWS: "retry at a single point in the stack"; `idempotency.ts` already waits out the ledger |
| `once` | a step, or a check command, that could not run: a crash, a box that would not start | one more try on the same intent, then stop | the lane | **a guess** (P8). Stricter than OTP's default of 1 restart in 5 seconds, which is a rate, and Buildkite's default of 2 |
| `drafts` | a draft that fails its Check | 3 drafts in one session, then `unchecked` | the step's own Check loop | **a guess** (P8): today's `tries: 3` in the lane (`program.ts`) |
| `rounds` | a send-back: red checks or review findings | `MAX_ROUNDS = 3`, shared, then the ask `rounds_spent` | the lane | **a guess** (P8): today's constant |

- **Lean: one shared count of rounds,** for review's send-backs and red checks together. A red
  check costs a build, as a failed review does. No source names a number for an agent's repair
  loop. Our only data: a demlik lane needed 3 builds and 3 reviews (field note 2026-10-31-02).
  The `step` rows in `field/runs.jsonl` will show the real spread. 70% sure.
- **A write is safe to retry only with its key.** Every write the lane makes already has its
  intent. A write with no key is not retried; it stops.
- **Past the bound** the lane asks `rounds_spent`. It shows what is still red and the dollars
  the rounds spent (P11). Its two picks: one more round, which runs build again, or stop, which
  saves the lane at build so the same line goes on there (P6, P10). A person picks between
  spending and giving up, which is a judgment.

### A skipped check never looks clean

Ticket 117 broke this rule from [make the mistake impossible](./make-the-mistake-impossible.md).
The builder's checks died in its box (`spawnSync git EPERM`), it wrote that down, and it
still said `done`. Nothing in code ran the checks after it. From now on:

- Code runs the repository's checks at the head after every build. The builder's own report
  decides nothing ([nobody grades their own work](./nobody-grades-their-own-work.md)).
- A build is `done` only on green checks that code ran. Red goes back. Not run is a stop.
- The failing tests' names are kept on the ticket: in the `ended` fact and in a comment.
- A check skipped on purpose writes that it skipped, and what it relied on. The mutation
  step that skips its own suite run writes the `checked` fact it trusted (P9).

### Restart from the step that broke

```ts
// A sketch. `over` keeps what a restart needs. Today it keeps only the outcome and the trail.
// A stuck `over` without `held` and `at` is not a value the type allows (P6).
| {phase: "over"; number; trail; said; outcome: Stuck; held: Held; at: LaneStep}
| {phase: "over"; number; trail; said; outcome: Done | Skip}

/** A closed list of what may not restart. A new stuck reason restarts by default (P4). */
const FINAL = new Set(["not_yours", "merged_elsewhere"]);

restart: (s, m) =>
	s.phase === "over" && s.outcome.kind === "stuck" && !FINAL.has(s.outcome.why)
		? claiming({...s.held, restarted: {from: s.at, by: m.by}})   // then main is read fresh
		: [s, []],
```

- **What a person types:** the same line again, `pipeline --ticket 117`. Today that only
  says how the lane ended (`program.ts:1038-1045`, `use_existing`). **Decided 2026-11-01:**
  the same line restarts a stuck lane, the way "Re-run failed jobs" is one button. A line
  typed by habit runs only the step that stuck, so it spends one step's money, not a lane's.
- **What is kept:** triage, the plan and its yes, the tests, and every step that ended
  `done`. Only the step that stuck runs again, with one rule on top: no step after build
  runs on a head that has no green `checked` fact.
- **A lane saved before this change** has no `held`. It is read through the fold of its
  facts. A field no fact proves sends the lane back to the step that writes that field, and
  no further. Every step before it keeps its `done`, and a step after it keeps its `done` when
  the fields it reads come out the same. Nothing is guessed, and nothing starts from scratch.
- **When main moved:** read main fresh ([read fresh, run alone](./read-fresh-run-alone.md)).
  A lane branch that was never pushed is rebased onto main first (tracker ticket 130). A
  branch already on the code host takes main in by a merge, as that note says, so this
  walks nothing back. After a rebase, code runs the test writer's check on the new base
  again: new tests red, old tests green.
- **A rebase that conflicts.** In the builder's files: build, next round, as `conflicts`. In
  an exam file: the ask `exam_conflict`, with the files and both sides. "Test writer again":
  the test writer redoes only those files on the new base, its check runs, then build goes on
  from the builder's rebased head, next round. "Stop": saved at the rebase, so the same line
  goes on there (P5, P6, P10).
- **Not restartable:** `not_yours` and `merged_elsewhere`, the closed `FINAL` list. Each is a
  person's call, and the ticket says what to do instead.
- **`exam_touched` stops the line and asks, then goes on from the step before.** The
  person picks one of two. "The builder was wrong": code puts the touched exam files back as
  the test writer's commit left them, on top of the builder's head, and build runs there as
  the next round. "The test is wrong": the test writer redoes only the touched files, with the
  person's note, its check runs, then build goes on from the builder's head as the next
  round. Either pick adds one round to the bound, the way `again` does. Triage, the plan's approval and
  every other finished step stay. Nothing starts from scratch (P5).
- **A step that could not run** is run once more on its own, on the same intent, before
  the lane stops (`once`). OTP's default is a rate, 1 restart in 5 seconds; one try per
  intent is ours, and stricter.
- **What the ticket shows:** a `restarted` row with who, when, from which step, the old and
  new base, and which steps it kept and which it ran again. Data first: these facts exist only
  at the moment of the restart.

### Count a person's attention

- **Lean: count it now, cap it later.** Every ask is already an `asked` fact with the
  ledger's time, and every answer an `answered` fact. That gives asks per lane and minutes
  from ask to answer, as a view, with nothing new to record. 80% sure.
- **No cap yet.** A number with no data is a guess, and a cap that blocks needs its false
  alarms measured first (Google, CACM 2018). After a few real lanes, the count says
  whether a cap is worth it. 70% sure.
- **A design that adds an ask says why only a person can answer it.** The `Judgment` list
  above is closed, so a new ask is a new literal, a change someone reviews.

## Every place today's lane stops or asks

Read from `stages/pipeline/machine.ts`, `stages/pipeline/program.ts` and each step's
`outcome.ts` (exam and push keep theirs in `machine.ts`), on 2026-11-01. `skip` ends that
mean "nothing to do" are left out, except where the lane turns one into `stuck`. **Count:
69 places. 21 judgment, 38 machine-fixable, 10 preventable.** A row with several words
counts once.

### The lane itself

| # | Today | Class | Change |
|---|---|---|---|
| 1 | `stuck:not_yours` | judgment | Keep. Whose ticket runs on your login is your call. |
| 2 | `stuck:no_ticket`: the ticket could not be read | machine-fixable | `wait`, in the service; the lane does not retry it. A ticket that is not there is an answer: stop, with the number. |
| 3 | `stuck:claim_held` | machine-fixable | This lane's own saved id takes its claim back. Another lane's: `skip:claimed`, naming it, as operate does. |
| 4 | `stuck:step_failed`: the claim could not be made | machine-fixable | The claim is a keyed write: `wait`, in the service. |
| 5 | `stuck:step_failed`: a step could not run (`run_failed`, a missing input) | machine-fixable | `once`, on the same intent, then stop. |
| 6 | `stuck:step_failed`: a question could not be written | machine-fixable | Write it again. Its id makes that safe. |
| 7 | `stuck:step_failed`: no `origin`, or it names no repo | preventable | Already refused before any agent starts. Keep. |
| 8 | `stuck:rounds_spent`: review sent it back past round 3 | judgment | Becomes an ask, with what is open and what the rounds cost: one more round (build), or stop (saved at build). |
| 9 | `stuck:sent_back`: a `send` with no route | preventable | A route table typed over every step's sends, so a send with no route does not compile. |
| 10 | `ask approve`: the plan | judgment | Keep. |
| 11 | `ask exam_merge`: the rule changes' own pull request | judgment | Keep. |
| 12 | `ask merge`: the merge yes | judgment | Keep. |
| 13 | A step's `skip` the lane cannot pass: build `closed`, `merged`; review `merged`, `closed`, `draft`; ship `closed`, `draft`, `not_ours`. Today `stuck:step_stuck` | machine-fixable | Route by meaning: a close or a draft ends `skip`, a merge reads the host fresh and ends `done` or `merged_elsewhere`. |
| 14 | build `skip:not_ready`. Today `stuck:step_stuck` | preventable | The lane's yes writes the approval before build starts. A law shows build after `approve` never reads `not_ready`. |

### Triage, plan and exam

| # | Today | Class | Change |
|---|---|---|---|
| 15 | triage `ask:owner:ruling` | judgment | Keep. |
| 16 | triage `stuck:read_failed`, `write_failed` | machine-fixable | `wait`, in the service. |
| 17 | triage `stuck:draft_failed`, `unchecked` | machine-fixable | `draft_failed`: `once`, in its own session. `unchecked`: `drafts` are already spent. Then stop. |
| 18 | triage `stuck:over_budget` | judgment | A spend ask with the cost so far ([one meter](./one-ask-and-one-meter.md)). Its picks: more, and the cut-off session goes on; or stop, saved at triage. |
| 19 | triage `stuck:changed`: the words changed while it sorted | machine-fixable | Sort again on the new words, once. |
| 20 | plan `ask:owner:questions` | judgment | Keep. It goes to the plan's yes. |
| 21 | plan `stuck:read_failed` | machine-fixable | `wait`, in the service. |
| 22 | plan `stuck:draft_failed`, `unchecked`, `cut_off` | machine-fixable | `draft_failed`, `cut_off`: `once`, in its own session. `unchecked`: `drafts` are already spent. Then stop. |
| 23 | plan `stuck:over_budget` | judgment | A spend ask, as row 18: the session goes on, or stop, saved at plan. |
| 24 | the lane's plan `stuck:unchecked`: passed its Check, could not be kept | preventable | The Check runs `revisionOfDraft` itself, so the two cannot disagree. |
| 25 | exam `ask:owner:check_change` | judgment | Keep. |
| 26 | exam `stuck:draft_failed`, `unchecked` | machine-fixable | `draft_failed`: `once`, in its own session. `unchecked`: `drafts` are already spent. Then stop. |
| 27 | exam `stuck:land_failed` | machine-fixable | A keyed write: `wait`, in the service. |

### The test writer

| # | Today | Class | Change |
|---|---|---|---|
| 28 | `ask:owner:fails_on_base` | machine-fixable | Back to the writer once, with the failure. Then ask: a bug on main is a person's call. |
| 29 | `ask:owner:already_passes` | machine-fixable | Back to the writer once. Then ask. |
| 30 | `ask:owner:cannot_test` | judgment | Keep. |
| 31 | mutants job `ask:owner:disable` | judgment | Keep. |
| 32 | `stuck:read_failed`, `commit_failed`, `record_failed` | machine-fixable | The read and the record: `wait`, in the service. The commit is local: `once`, then stop. |
| 33 | `stuck:draft_failed`, `unchecked`, `cut_off` | machine-fixable | `draft_failed`, `cut_off`: `once`, in its own session. `unchecked`: `drafts` are already spent. Then stop. |
| 34 | `stuck:run_failed` | machine-fixable | Run once more, output kept, then stop. |
| 35 | `stuck:no_result`: the run said nothing for a test | machine-fixable | Back to the writer with the name the run did not report. |
| 36 | No stop: its files fail the format check (ticket 117) | preventable | Code formats them before it commits. |

### Build

| # | Today | Class | Change |
|---|---|---|---|
| 37 | `stuck:read_failed`, `copy_failed`, `push_failed`, `open_failed` | machine-fixable | The read, the push and the open are keyed: `wait`, in the service. The copy is local: `once`, then stop. |
| 38 | `stuck:no_criteria`, `criteria_unknown` | preventable | In the lane the plan's Properties are the criteria, and the plan's Check needs one. A law shows the lane never reaches these. |
| 39 | `stuck:draft_failed` | machine-fixable | `once`: the builder's session goes on where the harness keeps one, as the Check loop's `continues` does today; else the round starts from the working copy as it stands. Nothing the builder changed is thrown away. Then stop, saved at build. |
| 40 | `stuck:over_budget` | judgment | A spend ask, as row 18: the session goes on, or stop, saved at build. |
| 41 | `stuck:no_change`, first round | machine-fixable | Once more, told it changed nothing. Then ask. |
| 42 | `stuck:exam_touched` | judgment | Decided: a builder never changes its exam, so the line stops. Then the ask `exam_touched` with two picks, each the next round on the builder's head: the builder was wrong (the touched files put back as the test writer's commit left them), or the test is wrong (the test writer redoes only those files, with the note). See [restart](#restart-from-the-step-that-broke). |
| 43 | the lane's `stuck:checks_not_run` | machine-fixable | Code's checks run outside the box. `once`, then stop, saved at the checks. Never `done`. |
| 44 | the lane's `stuck:rounds_spent`: changed nothing, still red | judgment | The same ask as row 8, with the same two picks and what the rounds cost. |
| 45 | the lane's `ask:owner:no_change`: checks green, nothing changed | machine-fixable | A fresh review reads the builder's `disputed`. Ask only if the finding still holds. |
| 46 | the lane's `ask:owner:still_red` | machine-fixable | Another round with the failing names, until the rounds are spent. |
| 47 | No stop: `done` though its checks never ran (ticket 117) | preventable | Code runs the checks after the builder. Red or not run is never `done`. |

### Mutation and review

| # | Today | Class | Change |
|---|---|---|---|
| 48 | mutation `ask:owner:check_change`: the diff adds a disable comment | preventable | Build's guard refuses a diff that adds one, and sends it back with the line. |
| 49 | mutation `stuck:read_failed` | machine-fixable | `wait`, in the service. |
| 50 | mutation `stuck:tests_red` (ticket 117) | machine-fixable | `send:builder:tests_red`, with the failing names. After the checks step it is a backstop. |
| 51 | mutation `stuck:run_failed` | machine-fixable | Run once more, output kept. |
| 52 | review, the lane's `ask:owner:unseen` | judgment | Keep. |
| 53 | review, the lane's `ask:owner:decision` | judgment | Keep. |
| 54 | review `stuck:read_failed`, `ticket_unknown`, `diff_unknown`, `kinds_unknown`, `checks_unknown` | machine-fixable | `wait`, in the service. |
| 55 | review `stuck:no_criteria`, `rubric_unknown` | preventable | Checked when the lane starts, before any agent: the criteria from the plan, the rubrics folder from `fabrika.toml`. |
| 56 | review `stuck:draft_failed` | machine-fixable | `once`, in its own session, then stop. |
| 57 | review `stuck:over_budget` | judgment | A spend ask, as row 18: the session goes on, or stop, saved at review. |
| 58 | review `stuck:checks_stuck` | machine-fixable | Wait once more, then stop. |

### Push and ship

| # | Today | Class | Change |
|---|---|---|---|
| 59 | push `stuck:push_failed`, `open_failed`, `post_failed` | machine-fixable | `wait`, in the service. Each write has its intent, so a retry is safe. |
| 60 | ship `ask:owner:approval` | judgment | Keep. |
| 61 | ship `ask:commenter:comment` | judgment | Keep. |
| 62 | ship `send:builder:*`. Today `stuck:sent_back` | machine-fixable | To build, next round. For `behind` and `conflicts`, code takes main in first and runs the checks. A clean catch-up with green checks goes back to ship, with no agent turn and no round. Only red, or a conflict in the builder's files, goes to build. |
| 63 | ship `send:reviewer:no_review`. Today `stuck:sent_back` | machine-fixable | To review again. |
| 64 | ship `stuck:read_failed`, `reviews_unknown`, `approval_unknown` | machine-fixable | `wait`, in the service. |
| 65 | ship `stuck:criteria_unknown` | preventable | The lane's own pull request always names its ticket, and the ledger holds its criteria. |
| 66 | ship `stuck:proof_refused`, `head_moving` | machine-fixable | Read fresh and go again: `once` per head, then stop. |
| 67 | ship `stuck:checks_stuck`, `queue_silent` | machine-fixable | Wait once more, then stop. |
| 68 | ship `stuck:enqueue_failed`, `merge_failed`, `merge_unknown` | machine-fixable | Read the pull request fresh: merged is a fact on the host. A rule that wants a review becomes `ask:owner:approval`. |
| 69 | the lane's `stuck:merged_elsewhere` | judgment | Keep. |

- Four judgment rows are `over_budget` spend asks. A standing project limit, as the
  [one meter](./one-ask-and-one-meter.md) note proposes, would make most of them rare.
- The plan builds rows 5, 8, 36, 42, 43, 44, 46, 47 and 50, plus the restart and its ask
  `exam_conflict`. The other rows go in later pull requests, one tracker ticket each.

## Why

- Ticket 117's first run ended `stuck:step_stuck` on one stale test outside the exam. A
  builder told the test's name would most likely have fixed it in one round. Instead the
  lane ended, nothing could restart it, and no test output was kept anywhere.
- A person's attention is the scarcest thing the pipeline spends, and nothing counts it
  yet. Each needless stop costs that, and teaches a person to stop watching.
- A rule in prose does not hold ([make the mistake impossible](./make-the-mistake-impossible.md)).
  "Never say done on red" has to be code, or the next builder says it again.

## How sure

- **90% on the two rules.** They are the owner's decision, and the industry's way.
- **85% that code's checks after the builder would have saved ticket 117.** The doubt:
  round 2's builder may not see why `takes("map")` changed. Its brief will name the plan's
  change and the test, so the fix is a line.
- **70% on the shared round count of 3.** See [bounds](#bounds).
- **65% on the other numbers in [bounds](#bounds).** `once` and `drafts` are guesses, as P8
  says. The `step` rows in `field/runs.jsonl` settle them.
- **The same line restarting a stuck lane is decided,** 2026-11-01.

## What would change it

- A class of stop that is none of the three and not an andon stop. Write it down before adding
  a fifth.
- Lanes that loop to the round limit often. Then the limit or the brief is wrong, and the
  `step` rows will show which.

## What it cannot tell us

- How often a send-back fixes the problem. No lane has had one with real agents.
- Whether a person feels the asks that stay as too many. Only the attention count over real
  lanes will say.
- Whether every row above sits in the right class. Each was read from code, not run.
- Whether a resume keyed by place, as today, is enough once main moves. A key by the step's
  inputs (P7, a lean) could tell; this note does not build it.
