# Done is per criterion; no deviations

Decided 2026-10-12, written down 2026-10-18.

## What was decided

- **A criterion has three states.**
  - **open**: nobody has shown it is met.
  - **met**: a review saw it at a commit that landed.
  - **dropped**: the owner said it no longer counts.
  - An owner's edit is not a state: the new text starts open.
  - A builder's "it is met", a review that could not see a line, and a pass on
    work that has not landed are notes on an open criterion, not states.
- **A ticket is done when every criterion is met or dropped.** Nothing else
  closes it: not a merge, not "Closes #N", not a person closing it by hand.
- **A lane is one trip** (build, review, ship for one change). A ticket can need
  more than one trip, so a lane can finish while its ticket stays open.
- **No deviations.** A builder may not shrink a criterion by declaring it.
  A declared deviation does not turn an unmet criterion into a pass.
- **A limit about what the code does is never a pass.** "Every window opens,
  except the painted-shut one" leaves the criterion open.
- **Ways out of open:** fix it (met), the owner drops it (dropped), or the owner
  rewrites it (new text, open). Fixing is the default and needs no person.
- **The builder has two honest flags**, and only these bring a person in:
  - "I cannot meet this as written", with the evidence and a proposed rewrite.
    Since plan became its own stage (see
    [a project is a parent plan](./a-project-is-a-parent-plan.md)), the flag
    goes back to the plan; a product call there becomes an ask to the owner.
  - "The reviewer read this line wrong", so pleasing the reviewer is never the
    cheap move.
- **The ticket and its criteria are our own data.** GitHub's open/closed,
  checkboxes and "Closes #N" are a view of it
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

## Still open

- May the finished part of a ticket land while one criterion stays open?
- When outcome criteria are met by a different route with nothing left over,
  is that met without asking? With outcome criteria the lean is yes; not yet
  settled.
- How many times a line may bounce between builder and review.

## What would change it

Owners drowning in "cannot meet as written" questions that a better plan check
would not have prevented.
