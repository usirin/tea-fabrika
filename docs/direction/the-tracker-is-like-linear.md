# The tracker is like Linear

**Decided 2026-10-27 by the owner.** The tracker is the most important place
where people and agents work together, so it is built like Linear: a full issue
tracker, not the smallest form that runs one lane. The pipeline, milestones and
later packs are all built on it.

```ts
// A sketch. Linear's issue, as facts on the ledger. Which of these come first is the study below.
{type: "filed", title: "…", body: "…", to: "github:7"} // to: the assignee, from the start
{type: "assigned", to: "github:9"} // a person's fact
{type: "moved", state: "in_progress"} // the workflow state
{type: "labeled", add: ["bug"]} // later
{type: "planned_for", milestone: "v1"} // later: a project's milestone
```

- **What it replaces.** [Tickets start in our tracker](./tickets-start-in-our-tracker.md)
  said on 2026-10-24: "It is not a whole Linear. No boards, no cycles, no
  priorities: those wait for a run that needs them." That line goes. The
  tracker grows toward Linear's model on purpose, and a run is not needed to
  justify each part.
- **What stays.**
  - Tickets are facts on the ledger, and the tracker is a program
    ([tickets start in our tracker](./tickets-start-in-our-tracker.md)).
  - Only people on the ledger write tickets, and only a person answers an ask.
  - The pipeline reads only what it needs. A label or a priority never gates a
    build: the approved plan is the only go
    ([sort answers yes or no](./sort-answers-yes-or-no.md), "Who approves
    building").
  - "Milestones leave the loop"
    ([a project is a parent plan](./a-project-is-a-parent-plan.md)) still holds
    for the pipeline: no stage reads a milestone to decide. The tracker has
    them for people, and packs may read them.
- **First piece, decided the same day:** every ticket has an assignee, and the
  assignee's host runs its lane
  ([a ticket runs from the app](./a-ticket-runs-from-the-app.md), section 4).
- **Why:** this is where a person sees what agents did and tells them what to
  do next. A thin tracker makes every pack invent its own fields. Linear is the
  known shape for this, and it already has a model for agents working issues
  ([Linear](https://linear.app/developers/agent-interaction)).
- **Cost:** more tracker work before and around the pipeline: more fact kinds,
  more window. Not counted yet.
- **Next:** a study of Linear's model (issues, workflow states, assignee and
  delegate, priority, labels, sub-issues and relations, projects, milestones,
  cycles, agent sessions), mapped to ledger facts, with the order to build them
  in. It ends as a proposed section here.

## The study (proposed 2026-10-27)

The whole study is in [tracker views are programs](./tracker-views-are-programs.md).
In short:

```ts
// A sketch. Each view is its own small program over the one ledger.
//   tsh> ticket --ticket 62   a parent, its sub-issues nested under it
//   tsh> board --under 62     the same tickets as cards, one column per state
{type: "nested", under: 62} // new: on a sub-issue's stream
{type: "moved", state: "in_progress"} // new: a person moves it; Done is read off a merged PR
send("open", {program: "ticket", flags: {ticket: 43}, where: "beside"}); // a board asks the desk
```

- **Every view is a program:** `ticket`, `board` and `list` first, then
  `triage`, `timeline` and `cycle`. They share only the ledger and one fold,
  as CQRS read models and Elm Land's shared model do.
- **Views talk through outputs, and only to ask.** A board card asks the desk
  to open a ticket beside it. Data never goes from view to view.
- **tea and tea-program do not grow.** The desk learns to hear `open`.
- **First facts:** `nested` and `moved`. Then relations, then priority,
  labels, estimates and due dates, one at a time. A milestone is a sub-ticket
  with a due date (60% sure).
- **First use:** v1's 18 slices, #43 to #60, nested under one new parent and
  shown on a board.
- **Build order:** ten steps, small first. Step 1 waits for v1 slice 1 to
  merge, since both change the tracker's `Fact` union.
- **How sure: 75%.** The doubt is the cost of every view folding the whole
  ledger. Step 2 measures it.

## What it cannot tell us

- Which parts of Linear the two of us use first. The study proposes an order;
  daily use will change it.
