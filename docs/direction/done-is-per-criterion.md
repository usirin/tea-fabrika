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
  ticket it judged.
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
  through an agent, so the view runs one way; a cheap check still compares
  them, because GitHub writes by itself too (merges, bots).

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

## Still open

- How "one ticket, one PR" meets a plan with several tasks. Reading, not yet
  settled: each task that ends in a PR is that unit, with its own criteria.
- When a criterion is met by a different route with nothing left over, is
  that met without asking? With outcome criteria the lean is yes.
- What happens to a criterion's "met" when only its wording's typo changes
  (today: it reopens, one small re-check).

## What would change it

Owners drowning in "cannot meet as written" questions that a better plan check
would not have prevented.
