# Done is per criterion; no deviations

Decided 2026-10-12, written down 2026-10-18.

## What was decided

- **A criterion is open or met.**
  - **open**: nobody has shown it is met.
  - **met**: a review saw it at the commit that merges.
  - A builder's "it is met", or a review that could not see it, are notes on
    an open criterion, not states.
- **The owner changes criteria as ticket events**, never by hand: they say it,
  an agent records it. Three events: a criterion is added, reworded or
  removed. A reworded criterion goes back to open; untouched ones keep their
  mark. A removed one needs nothing. A review records which version of the
  ticket it judged (confirmed by the owner 2026-10-19).
- **One ticket, one PR.** A PR merges only when every criterion of its ticket
  is met at its head. Nothing lands early, and a ticket never stays open after
  its PR merges. The work may grow to meet a criterion. A PR that stays open is
  the signal that something is unfinished.
- **No deviations.** A builder may not shrink a criterion by declaring it.
  A declared deviation does not turn an unmet criterion into a pass.
- **A limit about what the code does is never a pass.** "Every window opens,
  except the painted-shut one" leaves the criterion open.
- **A real problem no criterion covers becomes a new criterion.** The reviewer
  adds it to the ticket's data, so it blocks the merge like any other.
- **An open criterion goes back to the builder by default,** with no person.
  No cap on rounds: what is watched is whether the list of open criteria got
  shorter ([a review list can only shrink](./a-review-list-can-only-shrink.md)).
- **When a round leaves the list no shorter,** the builder says why:
  - "met it a different way", saying what differs: one more round;
  - "cannot meet this as written", with evidence and a proposed rewrite: it
    goes up (since plan became its own stage, back to the plan; a product call
    there becomes an ask to the owner);
  - a second stall in a row goes to the owner.
- **The builder's other honest flag** is "the reviewer read this line wrong",
  so pleasing the reviewer is never the cheap move.
- **The ticket and its criteria are our own data,** in the `Ledger` service.
  GitHub's open/closed, checkboxes and "Closes #N" are a view of it
  ([data first](./data-first-markdown-is-a-view.md)). People change GitHub only
  through an agent, so the view runs one way. *Proposed, not decided
  (2026-10-19):* a cheap check that compares them, because GitHub writes by
  itself too (merges, bots). Not built.
- **A merge takes only a proof** (chosen 2026-10-18, built in
  `wip/src/stages/ship/ready.ts`). Ship's merge call takes a `ReadyToMerge`
  value, which can only be made from a passing review row for every criterion,
  at its current wording, at the head, with green checks at that head. A new
  head voids every row; a reworded criterion voids its own. Experiment 90 found
  the gate trusting a summary word "passed".
- **The fixed cap is removed from the code** (2026-10-19). `operate` has no
  `--rounds` flag, the outcome has no `ask:owner:rounds`, and a `tsh.toml`
  with a `rounds` line is refused. Only the stall rule stops a loop. A ship
  that sends the pull request back to the builder counts as one open item, so
  two such sends in a row ask the owner. Left open: a list that goes up and
  down (1, 2, 1, 2) never stalls twice in a row, so it never stops.

## Why

- A real case: a builder declared a known gap, a reviewer passed the row with
  "a named limit", and the ticket closed on merge with the gap filed as a new
  issue that then waited untriaged. Each step followed today's rules.
- A study of closing PRs found one in four says it met a criterion "another
  way". In a sample of 20 of those, 7 criteria could not be met as written.
  The fix is to catch wrong criteria early (the plan's check at HEAD) and give
  the builder an honest exit, not to let it decide quietly.
- An explicit "flag this" exit cut test cheating from 54% to 9% in
  ImpossibleBench.
- A replay of 525 recorded review loops: in 576 of 682 steps the open list
  shrank or passed, and two of three loops stopped for a person passed on the
  very next round. A round cap stops good loops; a shrinking list does not.

## One PR per plan

Decided 2026-10-18.

- **A plan with several tasks still ends in one PR.** Each task gets a fresh
  builder. The builder only edits files; code checks the edits and commits
  them onto the plan's one branch (wording fixed 2026-10-19: the agent drafts,
  code writes).
- **Each task is reviewed as it lands,** against its own criteria, with local
  tests and no CI run.
- **The PR is opened, CI runs, and the final review checks the plan's own
  criteria** once every task is in. It merges only when all of them are met.
- **Why:** CI runs once, not once per task, and a feature lands whole or not
  at all. The plan's own criteria have one clear owner: that final review.
- **Costs to watch:** one stuck task holds the whole feature, and a long branch
  drifts from main (the builder rebases after each task).
- "Build a task" and "open and ship the PR" stay separate steps, so a
  one-PR-per-task switch can be added later if a run proves it is needed.
- **The branch catches up with main before each task,** and the PR opens only
  when every task is in, so CI does not re-run on every task.

## A stuck task

Decided 2026-10-18.

- **Stuck means the stall rule ran out:** rounds in a row left the task's open
  list no shorter, past the one extra round "met it a different way" earns. It
  goes to the owner. A crash or a flaky run is retried by code first and only
  counts if it keeps happening.
- **A stuck task leaves the plan only when the owner removes it.** That is a
  plan change (criteria removed as events), approved like any other; then the
  rest of the plan ships. There is no separate "drop and ship" rule.
- **The owner may answer "keep going", always with a limit.** The limit is a
  number of rounds, kept on the answer event. Code counts review results since
  that answer; when they run out and the list is no shorter, it asks again. A
  list that keeps shrinking needs no answer at all.
- **The loop and the desk use one stall rule** (built 2026-10-18).
  - It lives once, in `wip/src/asks/rules.ts` (`stallStep`, `asksOnStall`).
  - The operate loop reads it to stop; the asks core reads it to raise the
    stuck ask. The loop's own copy is gone.
  - One stall earns one more round. The second stall in a row ends the loop
    as `ask:owner:no_progress`, at the same round the desk raises its ask.
  - Experiment 91 had caught the old copy asking at the first stall, with
    nothing on the desk.
- **Rounds, not money, for now.** The core does not track spend. A money
  limit can come with a cost pack once a run proves it is needed.
- **Why:** a replayed epic had one task fail 25 times over 11 days and never
  ship 14 finished tasks. Under this rule it reaches the owner within a few
  rounds, and a "keep going" cannot run on quietly.

## Still open

- When a criterion is met by a different route with nothing left over, is
  that met without asking? With outcome criteria the lean is yes.
- What happens to a criterion's "met" when only its wording's typo changes
  (today: it reopens, one small re-check).

## What would change it

Owners drowning in "cannot meet as written" questions that a better plan check
would not have prevented.
