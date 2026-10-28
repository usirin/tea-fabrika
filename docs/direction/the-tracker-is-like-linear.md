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

## The study (proposed 2026-10-28)

The study is [tracker views are programs](./tracker-views-are-programs.md). It
replaces two drafts, [PR 135](https://github.com/usirin/tea-fabrika/pull/135)
and [PR 153](https://github.com/usirin/tea-fabrika/pull/153). In short:

```ts
// A sketch. Each view is its own program; a ticket's page leads with whose turn it is.
//   tsh> ticket --ticket 43   "Ready for your review: PR #155, 4 of 4 checks passed"
//   tsh> board --under 70     the v1 slices as cards, one column per state
{type: "linked", url: "https://github.com/usirin/tea-fabrika/pull/155"} // new: a PR; its state comes from GitHub
{type: "nested", under: 70} // new: a sub-issue's parent
{type: "moved", state: "in_progress"} // new: open states only; done is never written
```

- **Status is a fold.** `moved` holds only open states, so the sketch's
  `moved` above can no longer say done.
- **Hand-run agents post facts** (`started`, `link`, `ended`) instead of
  prose, so the page has data before the pipeline runs lanes.
- **Inputs split into `write` and `view`** (the split decided 2026-10-27, the
  names a lean).

## What it cannot tell us

- Which parts of Linear the two of us use first. The study proposes an order;
  daily use will change it.
