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

## Proposed 2026-10-27: Linear's model as ledger facts, and the order to build it

**Proposed. Nothing here is built or ruled.** The answer first: most of
Linear's issue becomes one small fact each on the ticket's stream, written by a
person. The parts an agent writes already exist (runs, asks, answers). The
status is never written: it is a fold, because nobody writes "done". Build the
parts two people need every day first: assignee, a pull request link, edits,
the status board, an inbox. Then the parts only people read: relations,
priority, labels, sub-tickets, projects and milestones.

```ts
// A sketch. Linear's issue, as facts on one ticket's stream. Status is not among them.
{type: "filed", title: "Login fails", body: "On main.", to: "github:7"} // to: the assignee, a person
{type: "assigned", to: "github:9"} // a person's fact
{type: "linked", url: "https://github.com/o/r/pull/12"} // the watcher then writes `pr` for it
{type: "duplicated", of: 4} // closes the ticket as a duplicate of #4
{type: "related", kind: "blocks", other: 12} // shown on both tickets; no lane waits on it
{type: "prioritized", level: "high"} // a person's fact; no stage reads it
{type: "labeled", add: ["bug"], drop: []} // a person's fact; no stage reads it
{type: "placed", in: {project: 1, milestone: "beta"}} // a person's fact; no stage reads it

statusOf(timeline, now) // "triage" | "started" | "completed" | "canceled" | "duplicate"
```

### 1. Linear's model, in short

Read from Linear's docs and its API schema
([schema](https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql)).

- **Issue and team.** An issue is the unit of work; it belongs to exactly one
  team, which owns its workflow, labels and cycles. Its id is the team key and
  a number, such as `ENG-123`
  ([concepts](https://linear.app/docs/conceptual-model), schema `Issue.team`,
  `Issue.identifier`).
- **Workflow states.** Each team has its own statuses, each of a fixed type:
  `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`,
  `duplicate` (schema `WorkflowState.type`). The types keep a fixed order; a
  duplicate goes into a reserved Duplicate status by itself
  ([issue properties](https://linear.app/docs/issue-property)).
- **Assignee.** One person at a time, and "No assignee" is allowed
  ([assigning](https://linear.app/docs/assigning-issues); schema: `assignee`
  is null when unassigned).
- **Delegate.** An issue can be delegated to an agent "while keeping a human
  teammate as the assignee"
  ([assigning](https://linear.app/docs/assigning-issues)). Assigning an issue
  to an app "sets it as the `delegate`, not the `assignee`"
  ([agents](https://linear.app/developers/agents)). The reason: "An agent
  cannot be held accountable"
  ([guidelines](https://linear.app/developers/aig)).
- **Agent sessions and activities.** A session is made when an agent is
  mentioned or delegated. The docs name six states (`pending`, `active`,
  `error`, `awaitingInput`, `complete`, `stale`), set by Linear from the last
  activity; the schema adds `stopping`. Activities are `thought`,
  `elicitation`, `action`, `response`, `error`, and `prompt`, which only a
  user writes; only `thought` and `action` may be ephemeral
  ([agent interaction](https://linear.app/developers/agent-interaction)).
- **Priority.** No priority, Low, Medium, High, Urgent, with no custom levels
  ([issue properties](https://linear.app/docs/issue-property)); in the API,
  `0` none, `1` urgent to `4` low (schema `Issue.priority`).
- **Estimate.** Off until a team turns it on; scales exponential, Fibonacci,
  linear or T-shirt
  ([issue properties](https://linear.app/docs/issue-property)).
- **Labels.** Workspace or team labels; a group nests one level and is single
  or multi select
  ([issue properties](https://linear.app/docs/issue-property)).
- **Sub-issues.** A parent and its sub-issues; optional auto-close both ways
  ([sub-issues](https://linear.app/docs/parent-and-sub-issues)).
- **Relations.** Blocked, blocking, related, duplicate. A resolved blocker
  moves under related. A mention in a description or comment makes a related
  issue ([issue properties](https://linear.app/docs/issue-property)). The
  schema also has `similar` (`IssueRelationType`).
- **Projects, milestones, initiatives.** A project groups issues around one
  outcome, and an issue is in one project at most
  ([projects](https://linear.app/docs/projects)). A milestone lives inside one
  project, and its progress counts started and completed issues
  ([milestones](https://linear.app/docs/project-milestones)). An initiative
  groups projects, with its own status, owner and target date
  ([initiatives](https://linear.app/docs/initiatives)).
- **Cycles.** Time boxes of 1 to 8 weeks, made by Linear on a schedule, with
  unfinished issues rolled into the next
  ([cycles](https://linear.app/docs/use-cycles)).
- **Triage inbox.** A team's inbox for issues from outside the team. Its
  actions: accept, decline, mark as duplicate, snooze. Rules can set team,
  status, assignee, label, project and priority, and a team can require a
  priority before an issue leaves
  ([triage](https://linear.app/docs/triage)).
- **Comments.** Threads, edits, reactions, resolved threads
  ([comments](https://linear.app/docs/comment-on-issues)).
- **Attachments and pull requests.** An attachment's URL is unique on its
  issue, so creating it twice is one
  ([attachments](https://linear.app/developers/attachments)). A pull request
  links by the issue id in its branch, title or a magic word, and by default
  moves the issue to In Progress when open and Done when merged
  ([GitHub](https://linear.app/docs/github)).
- **Notifications and inbox.** You are subscribed when you create, are
  assigned or are mentioned
  ([notifications](https://linear.app/docs/notifications)); the inbox lists
  what needs you, with snooze and reminders
  ([inbox](https://linear.app/docs/inbox)).
- **Views.** Saved filters of issues, projects or initiatives
  ([views](https://linear.app/docs/custom-views)).

### 2. Each part as facts here

Every row is a fact on the ticket's stream, `tracker/ticket/<n>/inbox`, beside
the thirteen kinds there today, unless it says another stream. "Person" means
the kind joins `PERSON_KINDS` in `packages/fabrika/src/host/door.ts`, so the
door refuses it from an agent, as it does `answered` today.

| Linear | Here | Who writes | Touches |
|---|---|---|---|
| Issue, team | the ticket; the team is the project's ledger | anyone files | [tickets start in our tracker](./tickets-start-in-our-tracker.md) |
| Workflow state | `statusOf`, a fold; no fact | nobody | [what a ticket shows](./what-a-ticket-shows.md) section 5 |
| Assignee | `to` on `filed`, then `assigned` | person | [a ticket runs from the app](./a-ticket-runs-from-the-app.md) section 4 |
| Delegate | none: the assignee's host runs the lane | nobody | same, "no `delegated` fact" |
| Agent session, activities | `started`, `ended`, `asked`, `answered`, the live row | code; `answered` a person | [what a ticket shows](./what-a-ticket-shows.md) sections 2, 3 |
| Comment | `commented`; an edit is `edited` | anyone; `edited` a person | [tickets start in our tracker](./tickets-start-in-our-tracker.md) |
| Pull request link | `linked`, then the watcher's `pr` | anyone | same, the watcher |
| Duplicate | `duplicated` | anyone (triage answers it) | [sort answers yes or no](./sort-answers-yes-or-no.md) |
| Blocks, related | `related`, `unrelated` | anyone | [the smallest ledger](./smallest-ledger-proof-to-grow.md) |
| Priority | `prioritized` | person | [sort answers yes or no](./sort-answers-yes-or-no.md) |
| Labels | `labeled`; names on `tracker/labels` | person | same, "no ticket-kind label" |
| Sub-issue | `parented` | person | [a project is a parent plan](./a-project-is-a-parent-plan.md) |
| Project, milestone | `placed`; `tracker/project/<n>` | person | same, "milestones leave the loop" |
| Estimate, cycle, initiative | later | person | none yet |
| Inbox, notifications | a view; seen marks on the person's own desk | that person | [every wait is a queue](./every-wait-is-a-queue.md) |
| Views | saved filters on the person's own desk | that person | [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md), "each person's desk" |

```ts
// A sketch, in Effect Schema. Title, Body, Id and TicketNumber are today's, from programs/tracker/src/ticket.ts.
import {Schema} from "effect";

/** A person's id, as the door's PERSON_ID. The fold also checks it names a member, so never an agent. */
const Person = Schema.String.check(Schema.isPattern(/^[^\s@]{1,200}$/));
/** Linear's four levels. "No priority" is `null`, so there is no fifth word and no number. */
const Level = Schema.Literals(["urgent", "high", "medium", "low"]);
const Label = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9 _-]{0,47}$/));
const ProjectNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const PrUrl = Schema.String.check(Schema.isPattern(/^https:\/\/\S+\/pull\/\d+$/));

// New and changed kinds on a ticket's stream:
const Filed = Schema.Struct({type: Schema.Literal("filed"), title: Title, body: Body, to: Person}); // grows `to`
const Assigned = Schema.Struct({type: Schema.Literal("assigned"), to: Person});
const Edited = Schema.Struct({type: Schema.Literal("edited"), title: Title, body: Body}); // the whole text
const Linked = Schema.Struct({type: Schema.Literal("linked"), url: PrUrl});
const Duplicated = Schema.Struct({type: Schema.Literal("duplicated"), of: TicketNumber}); // also closes
const Related = Schema.Struct({type: Schema.Literal("related"), kind: Schema.Literals(["blocks", "related"]), other: TicketNumber});
const Unrelated = Schema.Struct({type: Schema.Literal("unrelated"), kind: Schema.Literals(["blocks", "related"]), other: TicketNumber});
const Prioritized = Schema.Struct({type: Schema.Literal("prioritized"), level: Schema.NullOr(Level)});
const Labeled = Schema.Struct({type: Schema.Literal("labeled"), add: Schema.Array(Label), drop: Schema.Array(Label)});
const Parented = Schema.Struct({type: Schema.Literal("parented"), parent: Schema.NullOr(TicketNumber)});
/** One fact sets project and milestone together, so a milestone with no project cannot be written. */
const Placed = Schema.Struct({
	type: Schema.Literal("placed"),
	in: Schema.NullOr(Schema.Struct({project: ProjectNumber, milestone: Schema.NullOr(Id)})),
});

// On tracker/project/<n>/inbox, and tracker/labels/inbox:
const Created = Schema.Struct({type: Schema.Literal("created"), name: Title, lead: Person, goal: Body});
const Milestone = Schema.Struct({type: Schema.Literal("milestone"), id: Id, name: Title, due: Schema.NullOr(Schema.String)});
const Defined = Schema.Struct({type: Schema.Literal("defined"), name: Label, group: Schema.NullOr(Label), one: Schema.Boolean}); // one: one label of this group per ticket

/** Linear's status types, minus backlog and unstarted, which nothing here leads to. A fold, never a fact. */
type Status = "triage" | "started" | "completed" | "canceled" | "duplicate";
const statusOf = (timeline: readonly Entry[], now: number): Status => {
	const fresh = sinceReopen(timeline);
	if (fresh.some((e) => e.fact.type === "duplicated")) return "duplicate";
	const head = headOf(timeline, now); // today's top line, src/head.ts
	if (head._tag === "done") return "completed";
	if (head._tag === "closed") return "canceled";
	return endedStage(fresh, "triage") ? "started" : "triage"; // the board's columns; the top line says the rest
};
```

What the fold refuses, as `misfit` already does for runs and asks:

- an `assigned` or `filed` whose `to` is not a member of this ledger;
- a `duplicated` of itself, or of a ticket never filed;
- a `related` to itself, or the same relation twice;
- a `parented` that makes a loop;
- a `placed` milestone that its project never made;
- a `labeled` with a name `tracker/labels` never defined, or a second label
  from a group that allows one.

**Why:** each part is a fact a person already makes in Linear, so the window
stays a pure view of the ledger, as it is today. A status that is a fold
cannot say "done" while the pull request is open, which is the rule of
[what a ticket shows](./what-a-ticket-shows.md) section 5.
**Cost:** ten new kinds on a ticket and three on two new stream names, nine
door lines (every person kind above; the door reads a kind by its name on
every stream, so the names must not clash), one window part each.
**How sure: 75%.** The doubt: whether people want to move a card by hand on a
board (Linear's drag to a column) more than they want the fold to be the
truth. A week of daily use settles it.

### 3. One ticket, before and after

```ts
// Before: ticket 3 today.
// tracker/ticket/3/inbox
{type: "filed", title: "Login fails", body: "On main."}            user:github:7
{type: "commented", body: "Seen it too."}                            user:github:9
// fold: {number: 3, title: "Login fails", state: "open", timeline: [2 entries]}

// After: the same ticket, with the parts above.
{type: "filed", title: "Login fails", body: "On main.", to: "github:7"}           user:github:7
{type: "commented", body: "Seen it too."}                                         user:github:9
{type: "assigned", to: "github:9"}                                                user:github:7
{type: "prioritized", level: "high"}                                              user:github:9
{type: "labeled", add: ["auth"], drop: []}                                        user:github:9
{type: "placed", in: {project: 1, milestone: "beta"}}                             user:github:9
{type: "started", run: "r-1", stage: "triage", task: null, log: null}             agent:lane for:github:9
{type: "ended", run: "r-1", stage: "triage", outcome: {kind: "send", to: "plan", why: "accepted"}, ...}   agent:lane for:github:9
{type: "linked", url: "https://github.com/o/r/pull/12"}                           agent:lane for:github:9
{type: "pr", url: "https://github.com/o/r/pull/12", state: "merged", ...}         agent:watcher for:github:9
// fold: {number: 3, title: "Login fails", state: "open", status: "completed", to: "github:9",
//        level: "high", labels: ["auth"], parent: null, in: {project: 1, milestone: "beta"},
//        links: ["https://github.com/o/r/pull/12"], related: [], timeline: [10 entries]}
// top line: "done: PR #12 merged"
```

- An agent writing `{type: "prioritized"}` or `{type: "assigned"}` on this
  stream is refused at the door. An old `filed` with no `to` reads as assigned
  to the person its row names; one that names no person is shown as broken,
  as any row that does not read is today.

### 4. Where Linear's model clashes with what is decided

One line each. The owner rules; nothing here decides.

- **Assignee:** Linear allows "No assignee"; here every ticket has one, a
  person (decided).
- **Delegate:** in Linear an agent works only when delegated; here every
  filed ticket starts a lane on its assignee's host, with no `delegated`
  fact ([PR 131](https://github.com/usirin/tea-fabrika/pull/131)).
- **Status:** Linear lets a person drag an issue to Done; here nobody writes
  done, and the note's earlier `{type: "moved"}` sketch would let them.
- **Backlog:** Linear's backlog type is a "later" pile; triage here has no
  "later" ([sort answers yes or no](./sort-answers-yes-or-no.md)).
- **Snooze:** Linear's triage snoozes; here a "later" is a reopened "no".
- **Triage sets properties:** Linear's triage sets priority, labels and
  assignee and can require a priority; triage answers here carry none, and
  the assignee is set at filing.
- **Labels:** [sort answers yes or no](./sort-answers-yes-or-no.md) says no
  ticket-kind label enters the ledger (experiment 88); a person's `bug` label
  would.
- **Queue order:** Linear orders work by priority; every queue here is first
  in, first out ([every wait is a queue](./every-wait-is-a-queue.md)).
- **Duplicate:** Linear's duplicate is a person's act (its triage AI only
  suggests one) and moves attachments to the original; here triage, an
  agent, answers duplicate and closes, and no fact moves.
- **Sub-issues:** Linear's sub-issues each have a state and an assignee; a
  plan's tasks here live inside one plan and one pull request, though
  [a project is a parent plan](./a-project-is-a-parent-plan.md) calls them
  sub-tickets.
- **Parent auto-close:** Linear can close a parent when its children are
  done; here done is a merge or a person's close, though a project "closes
  itself when its children are done and its success check passes".
- **Projects:** Linear's project is a group with a lead and a status; here a
  project is a parent plan.
- **Cycles:** Linear rolls unfinished issues into the next cycle on a
  schedule, a "later" with a clock.
- **Edits:** Linear edits a comment in place; here a fact never changes, and
  an edit is a new fact.
- **Proof before a field:** [the smallest ledger](./smallest-ledger-proof-to-grow.md)
  waits for a run before priority, labels and links; this note says the
  tracker needs no run for each part. Its row should say which one holds for
  the tracker.

### 5. The order to build it in

Each line is one pull request, and each costs $0 in agent runs: they are
tracker facts and window, tested on the laptop twin of the shared ledger
(`apps/fabrika/src/host/shared.test.ts` has two homes already).

1. **Assignee, and "mine".** PR 131's slice 4 on the tracker side: `to` on
   `filed`, `assigned`, its door line, the picker, and a list that opens on
   your own tickets. Proves: a ticket with no assignee cannot be written, an
   agent's `assigned` is refused at the door, and each person's list starts
   with their own. PR 131's `lanes` needs it.
2. **Link a pull request.** `linked`, from a pasted URL or from the Act that
   opens one, and the watcher's `pr` for each link (PR 131 slice 7 needs the
   fact). Proves: a pull request made by hand today reaches its ticket, and
   its merge makes the ticket "done" with no lane. The tracker's README names
   it next.
3. **Edit a title or body.** `edited`, a person's fact, and the yes's text
   hash going stale on it (PR 131 slice 1 carries the hash). Proves: an edit
   after a yes shows "needs a new yes" and build does not start.
4. **Status and the board.** `statusOf`, `duplicated`, and the list grouped
   by status, with the top line in each row. Proves: no fact can make a
   ticket completed, and triage's duplicate answer lands in the Duplicate
   column.
5. **An inbox per person.** What waits on you first, then your tickets that
   moved, then mentions; seen marks on your own desk; a desktop notice for a
   new ask on your ticket. Proves: the other person sees what needs them
   without opening every ticket.
6. **The live row.** A running agent's one row, Linear's thoughts and
   actions, from [what a ticket shows](./what-a-ticket-shows.md) section 3.
   It lands once PR 131 has runs to show.
7. **Relations.** `related` and `unrelated`, shown on both tickets. Proves:
   a blocker shows on the blocked ticket, and no lane reads it.
8. **Priority and labels.** `prioritized`, `labeled`, `tracker/labels`, the
   list sorted by priority. A `layer-rules.json` line keeps both out of
   `packages/pipeline`. Proves: a build starts the same with or without them.
9. **Sub-tickets.** `parented`, with no loops, and the parent showing each
   child's top line.
10. **Projects and milestones.** `tracker/project/<n>`, `placed`, a project
    page whose progress is a fold. The same lint line keeps stages from
    reading them.
11. **Saved views.** Filters saved on your own desk.
12. **When one of you asks:** estimates, cycles, initiatives, templates,
    comment threads and reactions.

- **Why this order:** slices 1 to 5 answer what two people ask every day on
  a shared ledger: whose is it, where is its pull request, did its text
  change, where is it, what waits on me. Slices 1 to 3 are also what PR 131's
  pipeline needs before its lanes run. Slices 7 to 11 are read only by
  people, so a late one costs no run.
- **Cost:** eleven tracker pull requests; no agent spend.
- **How sure: 70%.** The doubts: the inbox may matter less than labels to two
  people who talk anyway, and slice 5 needs the person's own desk, which
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md) only
  proposes. A week of daily use on the shared ledger would settle both.

### Open questions for the owner

Each is yes or no. Nothing decided so far answers them.

1. **Should a lane wait for an open blocker before build?** Lean: no, for
   now. A blocker is shown only. Why: no run has been hurt by a missing
   blocker yet, and a stage that reads a relation is a new reader.
2. **Keep priority, labels and milestones out of every stage's brief?**
   Lean: yes. Triage reads the timeline whole, but these rows are for people,
   and kind labels were as often wrong as right in experiment 88.
3. **May an agent write labels, for a pack?** Lean: no, a person only for
   now; a pack that needs one asks for it first.
4. **Does a parent ticket close itself when every child is done?** Lean: no,
   not in v1. Done stays a merge or a person's close.
5. **Show tickets as `KEY-3`, the key from `fabrika.toml`?** Lean: yes, as
   Linear's `ENG-123`. The ledger keeps only the number.

## What it cannot tell us

- Which parts of Linear the two of us use first. The study proposes an order;
  daily use will change it.
- The study read Linear's docs and its API schema, not the app. Linear's own
  per-topic pages for status, priority, labels, relations and estimates did
  not load; one page, issue properties, holds them all and was read instead.
  The docs and the schema differ in two places: the schema has a `similar`
  relation and a `stopping` session state that the docs do not name.
- Linear's automations (triage rules, auto-close, SLAs, due dates), Asks,
  customer requests and documents were not mapped.
- Whether priority and labels, once people use them, pull a stage toward
  reading them. Slice 8's lint line guards the code, not a prompt.
- Nothing above is built. Every count is a sketch's, not a measurement.
