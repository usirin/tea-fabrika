# A project is a parent plan; milestones leave the loop

Decided 2026-10-18.

## What was decided

- **Plan is its own stage, for every ticket.** Triage only sorts (duplicate?
  worth it? who owns it?). The plan holds user stories, outcome criteria
  ("When ‹trigger›, ‹thing› ‹result›"), non-binding pointers, tasks, and open
  questions with a lean. It is data kept outside any builder, so each task gets
  a fresh builder. Its size follows the work: a small bug is a one-task plan.
- **An epic is a plan with many tasks.** No separate shape.
- **A project is a parent plan.** A success line plus child plans. It closes
  itself when its children are done and its success check passes.
- **GitHub milestones leave the loop.** Nothing in the pipeline reads or writes
  them. A roadmap, or a "what shipped toward this goal" report, is a view built
  from the plans.

## Why

- A study of demlik's board found that after triage nothing read a milestone
  except one tiebreak when a builder picks its next ticket. Nothing closed
  milestones or campaigns: all five active campaigns had met their end line and
  were still open. Experiment 85's real lane read no milestone either.
- Campaign tickets were 92% p1 against 21% elsewhere. A grouping that changes
  how work is priced, without anyone deciding that, is a rule nobody chose.
- Linear, Shape Up and Jira each keep one clock for work. Longer groupings are
  views over it.
- The original grill → PRD → tasks workflow stayed honest through its stories
  and a person's look before building. A plan stage keeps both, and checks are
  being built to replace the look once they catch what it catches.

## What it means for the work

- Triage writes no criteria and no design.
- A builder that cannot meet a criterion as written sends it back to the plan,
  with evidence. It never edits the criteria.
- Progress toward a goal is computed from plans, never kept by hand.

## What would change it

A plan stage that costs more than it saves on small tickets (experiment 86
measures this), or a real reader of milestones that a view cannot serve.
