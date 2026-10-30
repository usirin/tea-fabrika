# Tracker views are programs

**Proposed 2026-10-28.** Not settled, except one part marked decided (section
7). This note replaces two studies of 2026-10-27, both left open and not
merged: [PR 135](https://github.com/usirin/tea-fabrika/pull/135) (Linear's
model as facts) and [PR 153](https://github.com/usirin/tea-fabrika/pull/153)
(every view a program). It starts from 153's text, folds in 135's, settles
where they clash, and adds what a ticket shows at a glance. Tracker ticket 64.

```ts
// A sketch. One ledger. Each view is its own small tea program that folds it.
//
//   tsh> ticket --ticket 43   one ticket: a status line, properties, sub-issues, activity
//   tsh> ticket --ticket 70   the v1 parent: its 18 slices and a progress bar
//   tsh> board --under 70     the same 18 slices as cards, one column per state
//
// The first thing on a ticket's page is one sentence: what the person must do, if anything.
Glance.fromTicket(ticket, prs, now);
// {_tag: "review", pr: "https://github.com/usirin/tea-fabrika/pull/155", checks: {passed: 4, of: 4}}
// "Ready for your review: PR #155, 4 of 4 checks passed"

// Status is worked out from facts. Nobody writes "done".
Column.fromTimeline(timeline, now); // "in_review": a linked PR is open

// A program's inputs: one per command, each writing one fact, and one `query` that writes none.
yield* tell(run, "comment", {ticket: 43, body: "Looks good."}); // a fact
yield* tell(run, "query", {ticket: 44}); // no fact
```

The answer in eight lines:

- **Each view is a program:** `ticket`, `board`, `list` first. They share only
  the ledger and one fold (from 153).
- **Status is a fold, never a fact.** A person may move an open ticket between
  open states. Done comes only from a merged PR, or a person's close once its
  asks are answered (the decided rule).
- **A ticket's page leads with one status line** that says whose turn it is.
  Then properties, sub-issues, a live agent panel, one row per fact, and
  comments folded.
- **"next: triage" goes.** It is wrong for every ticket no lane drives, which
  today is all of them. Such a ticket says who is on it instead.
- **Hand-run agents write facts, not prose.** `fabrika post` learns
  `started`, `link` and `ended`, written through the `Tickets` service. The PR's
  state and checks are read from GitHub by code, never typed by an agent.
- **New facts, in order:** `linked` (a PR), `nested` (a parent), `moved` (an
  open state), then `assigned`, `related`, and later the fields only people
  read.
- **Writes apart from reads, the CQRS way** (decided 2026-10-27): one input
  per command (`comment`, `close`, ...), each one fact, and one `query` with
  filters that writes none (changed 2026-10-28).
- **tea and tea-program do not grow.** The desk learns to hear one `open`
  output.

## 1. What the owner saw on ticket 43

Ticket 43 is v1 slice 1. Its whole timeline today, as the ledger holds it:

```text
tracker/ticket/43/inbox
04:40  {type: "filed", title: "v1 slice 1: Tickets and the lane facts", body: "The nine lane fact ..."}   agent plan-v1
05:01  {type: "commented", body: "Slice 1 started on branch .../v1-slice-1. Built so far: ..."}         agent slice-1
05:02  {type: "commented", body: "Slice 1 PR is open: https://github.com/usirin/tea-fabrika/pull/155 ..."} agent slice-1
05:04  {type: "commented", body: "Slice 1 is green on CI: .../pull/155 check and all three test ..."}    agent slice-1

headOf(timeline, now)   // {_tag: "next", stage: "triage"}
lineOf(head)            // "next: triage"
// Today's names. The Schema.Opaque sweep renames them Head.fromTimeline and Head.toLine.
```

- **The facts it needs are in the prose.** A run started at 05:01. PR 155 was
  opened at 05:02. CI went green at 05:04. The agent stopped and is waiting
  for a person. Not one of these is a fact, so no view can draw it.
- **The top line is wrong.** `headOf` says `next: triage` whenever no run has
  ended (`programs/tracker/src/head.ts`, the last two lines). No lane drives
  ticket 43, and nobody will triage it. The line was written for lanes the
  pipeline runs, and none runs yet.
- **Tickets 44 and 50 are the same shape:** filed, started, "PR open",
  "green" or "waiting on CI". Ticket 49 has only "started". Tickets 45 to 48
  and 51 to 60 have only `filed`.
- **Prose goes stale.** Ticket 44's last comment says "Slice 2 is green on
  CI". When this note was written, PR 154's four checks were pending again,
  after a new push. A line read from GitHub by code would say "Waiting on CI";
  the comment still says green.
- **Why it happened.** [What a ticket shows](./what-a-ticket-shows.md),
  section 4, dropped the bridge for today's agents on 2026-10-25: "an agent on
  a lane posts plain comments on its ticket". That was right for the cost of
  hooks. It left every ticket run by hand with no data to draw. Section 6
  below is a smaller bridge, and it is a change to that decision.

## 2. What Linear and GitHub do

Linear and GitHub have the same shape: one set of issues, many views over it.
A view only reads. Moving a card writes one field, and every other view shows
it. Each line below links the page it was read from.

**Linear's issue page:**

- **A properties sidebar.** Relations "show up in the issue properties
  sidebar", labels are set "in an issue's right sidebar", and a blocker shows
  there "with an orange flag under _Blocked by_"
  ([issue properties](https://linear.app/docs/issue-property)). Status,
  priority, labels, relations, estimate and due date each have a section on
  that page.
- **Sub-issues** sit under the parent's description. Each person picks their
  order, and completed ones can be hidden
  ([parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)).
  That page does not describe a progress bar. Milestones show how much is done
  ([project milestones](https://linear.app/docs/project-milestones)). *That
  the parent shows a progress count in the app is a guess from use, not read.*
  GitHub has a "Sub-issue progress" field
  ([parent and progress fields](https://docs.github.com/en/enterprise-cloud@latest/issues/planning-and-tracking-with-projects/understanding-fields/about-parent-issue-and-sub-issue-progress-fields)).
- **A team can auto-close** a parent when all its sub-issues are done
  ([changelog, 2024-09-06](https://linear.app/changelog/2024-09-06-auto-close-parent-and-sub-issues)).
- **Workflow states** sit in fixed types: `triage`, `backlog`, `unstarted`,
  `started`, `completed`, `canceled`, `duplicate`
  ([API schema](https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql),
  `WorkflowState.type`; [configuring workflows](https://linear.app/docs/configuring-workflows)).
  A PR moves an issue to In Progress when opened and Done when merged, by
  default ([GitHub integration](https://linear.app/docs/github)).
- **An agent is a delegate.** The person stays the assignee, because "an
  agent cannot be held accountable"
  ([agents](https://linear.app/developers/agents),
  [guidelines](https://linear.app/developers/aig)).

**Linear's agent session** ([agent interaction](https://linear.app/developers/agent-interaction)):

- **Six states** "visible to users": `pending`, `active`, `error`,
  `awaitingInput`, `complete`, `stale`. "Linear tracks session lifecycle
  automatically based on the last emitted activity."
- **Five activity types** an agent may send: `thought`, `elicitation`,
  `action`, `response`, `error`. Only a user writes `prompt`.
- **Ephemeral activities** "are displayed temporarily, and will be replaced
  when the next activity arrives". Only `thought` and `action` may be.
- **A plan** is "a session-level checklist of tasks". The agent sends the
  whole list each time. It is marked a technology preview.
- **`externalUrls`** let "users open the current session on your web
  dashboard", shown as an "Open" button. Setting one also "prevents a new
  session from being marked unresponsive".
- **History comes from activities, not comments,** since comments can be
  edited ([agent best practices](https://linear.app/developers/agent-best-practices)).
  That is our rule already: machine state is a fact, never a comment
  ([the ticket is the lane view](./the-ticket-is-the-lane-view.md)).
- *Not read: how the session panel is laid out inside the issue. The page
  says only that "customers will begin seeing Agent Session UI in Linear".*

**GitHub's pull request:**

- **Checks** are `queued`, `in_progress` or `completed`, and a completed one
  has a conclusion such as `success`, `failure` or `timed_out`
  ([status checks](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks)).
- **The merge box** lists checks "grouped by status with failing checks
  prioritized at the top"
  ([changelog, 2025-03-04](https://github.blog/changelog/2025-03-04-improved-pull-request-merge-experience-is-now-generally-available/)).
  *Its exact summary words ("All checks have passed") were not found in
  GitHub's docs; they are from use.*
- **A review** is one of three: Comment, Approve ("ready to merge"), Request
  changes ("should address before merging")
  ([about reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)).
- **Projects** put table, board and roadmap over the same items. A board's
  columns are one field, and a drag sets it
  ([board layout](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout)).
  Up to 100 sub-issues per parent, 8 levels deep
  ([sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)).

What this says for us:

- **The top of an issue is properties, not prose.** Both products put state,
  owner and links in a fixed place, and the timeline below.
- **An agent's run is one live thing that updates in place,** not a stream of
  comments.
- **Checks read as a count and a color,** with failures first.

## 3. The Elm answer first

**One model, many views of it.** Kept from 153.

- **Elm Land gives every page a shared model:** "The `Model` type in
  `src/Shared/Model.elm` defines what data is available on every page"
  ([Elm Land, shared](https://elm.land/concepts/shared.html)). A page changes
  it only through named effects, and moves with `Effect.pushRoute`
  ([Elm Land, effects](https://elm.land/concepts/effect.html)).
- **Two Elm programs on one page share nothing** and meet only through ports
  ([Elm guide, ports](https://guide.elm-lang.org/interop/ports.html)).
- **CQRS:** "You can use a different model to update information than the
  model you use to read information"
  ([Fowler, CQRS](https://martinfowler.com/bliki/CQRS.html)). Each view is a
  read model folded from the same events.

| Elm or CQRS | Here |
|---|---|
| Elm Land's shared model | the ledger, outside every program |
| a page | a view program: `ticket`, `board`, `list` |
| `pushRoute` | an `open` output the desk hears |
| a command | its own input (`comment`, `close`, ...): one fact on the ledger |
| a query | the `query` input: the window changes, nothing is written |
| a read model | each program's fold of the ledger |

- **tea: nothing new.** Each view's machine is a parent written by hand. It
  holds a `feed` child (load, poll, fold: today's tracker machine's first half)
  and steps it, as Elm parents do ([Elm first](./elm-first.md)).
- **tea-program: nothing new.** Flags, inputs and outputs cover it.
- **The desk: one thing.** It hears `open` and places a tile.

```ts
// A sketch. Every view's machine: the shared feed, stepped by hand, plus its own part.
type Board = {feed: Feed; under: TicketNumber | null; picked: TicketNumber | null};
type BoardMsg =
	| {type: "feed"; msg: FeedMsg}
	| {type: "move"; move: Move} // from the `move` input: one fact
	| {type: "query"; query: Query}; // from the `query` input: no fact

const update = (s: Board, m: BoardMsg) => {
	switch (m.type) {
		case "feed": {
			const [next, cmds] = feed.update(s.feed, m.msg); // the parent steps its child
			return [{...s, feed: next}, cmds];
		}
		case "move":
			return [s, [save({move: m.move})]]; // one fact; shown after the next load
		case "query":
			return [{...s, picked: m.query.ticket ?? null}, []];
	}
};
```

## 4. Where 135 and 153 clashed, and how this note settles it

| Question | 135 said | 153 said | Here |
|---|---|---|---|
| Is status a fact? | no, status is a fold; a `moved` fact would let someone write done | `moved` exists, but cannot spell done; the column is a fold | both: status is a fold, and `moved` holds only open states. 135's worry cannot happen. |
| Which open states? | none written; triage and started only | backlog, todo, in progress, in review | **todo, in progress, in review.** No backlog: a "later" pile clashes with [sort answers yes or no](./sort-answers-yes-or-no.md), which has no "later". |
| Who writes a parent? | a person only (`parented`) | anyone (`nested`), so a plan stage can | **anyone on the ledger**, named `nested`. The first real use is an agent: plan-v1 filed the 18 slices. No stage reads it to decide. Question 1. |
| One word, two things | `linked` = a PR's URL | `linked` = a ticket relation | `linked` is the PR link (the plan's "link fact"). A ticket relation is `related`. |
| Priority, labels, project | a person only | anyone | a person only, refused at the door, as 135 said. No stage reads them. |
| Milestone | `placed` on a project stream | a sub-ticket with a due date | 153's: a project is a parent plan ([decided](./a-project-is-a-parent-plan.md)), so a milestone is a parent with a date. 60% sure. |
| Saved views | on each person's desk | on the ledger, shared | **on the person's desk first.** GitHub keeps a view's changes "yours alone" until saved ([managing views](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/managing-your-views)). Sharing one is a later fact. |
| Build order | assignee, PR link, edit, board, inbox, ... | nested, feed, moved and board, open, ... | **the ticket page first** (section 9): it is what the owner opened and found unreadable. |
| One program or many | one tracker | one per view | one per view (153). |

**Done stays the decided rule** ([what a ticket shows](./what-a-ticket-shows.md),
section 5): a merged PR read from GitHub, or for a ticket with no code, a
person's close once its last ask is answered. No drag, no agent and no
sub-issue count says done. A parent does not close itself in v1.

## 5. What a ticket shows at a glance

Six parts, top to bottom, in the order a person needs them. The mockups of
ticket 43, the v1 parent and its board follow this order.

```text
#43 v1 slice 1: Tickets and the lane facts
Ready for your review                                         <- 1. the status line, biggest
PR #155 · 4 of 4 checks passed · agent stopped 05:04

State     In review          PR        #155 open  ● ● ● ●  no review yet
Assignee  owner              Agent     slice-1, hand run, ended 05:04, cost not reported
Parent    #70 v1             Branch    v1-slice-1                         <- 2. properties

Sub-issues                                                       <- 3. only when it has any
Agent                                                            <- 4. only while a run is live
05:04  slice-1  ended: waits on review
05:02  slice-1  linked PR #155
05:01  slice-1  started: build                                   <- 5. one row per fact
04:40  plan-v1  filed it
▸ 3 comments                                                     <- 6. folded
```

### 5.1 The status line: whose turn it is

The line answers one question: does this need me, and if not, who has it. It
replaces `lineOf(headOf(...))` at the top of the page. The list and the board
show the same line, short. Branches, the first that fits:

| Case | Line | Whose turn |
|---|---|---|
| a merged PR | Done: PR #155 merged | nobody |
| closed, not done | Closed by owner | nobody |
| an ask is open | Needs your answer: approve plan v2 | you |
| the last run ended `stuck` | Stuck: needs your answer (read failed) | you |
| a run started and not ended | Agent working: build, 12 min | agent |
| a linked PR, checks failed | CI failed on PR #156: lint | agent if a lane drives it, else you |
| a linked PR, checks running | Waiting on CI: PR #156, 2 of 4 done | CI |
| a linked PR, checks passed, no person's review | Ready for your review: PR #155 | you |
| a person asked for changes since the last run | Changes asked: waiting on the agent | agent |
| a lane drives it, the last run sent on | Next: review | agent |
| a started run whose process is gone | Agent stopped without ending: build, 3h ago | you |
| nobody on it | No one on it yet | you |

```ts
// A sketch. Pure, like headOf, and built on it. `prs`: what code read from GitHub for the
// ticket's linked PRs (section 6), never what an agent wrote.
const Glance = Schema.Union([
	Schema.TaggedStruct("done", {pr: Schema.NullOr(Url)}),
	Schema.TaggedStruct("closed", {by: Writer}),
	Schema.TaggedStruct("asks", {asks: Schema.NonEmptyArray(OpenAsk)}),
	Schema.TaggedStruct("stuck", {stage: Stage, why: Schema.String}),
	Schema.TaggedStruct("working", {stage: Stage, since: Schema.Finite, by: Writer}),
	Schema.TaggedStruct("ci", {pr: Url, says: Schema.Literals(["failed", "running"]), checks: Counts}),
	Schema.TaggedStruct("review", {pr: Url, checks: Counts}),
	Schema.TaggedStruct("changes", {since: Schema.Finite}),
	Schema.TaggedStruct("next", {stage: Stage}), // only when a lane drives the ticket
	Schema.TaggedStruct("gone", {stage: Stage, since: Schema.Finite}),
	Schema.TaggedStruct("nobody", {}),
]);

const whose = (g: Glance, driven: boolean): "you" | "agent" | "ci" | "nobody" => {
	switch (g._tag) {
		case "asks": case "stuck": case "review": case "gone": case "nobody":
			return "you";
		case "working": case "changes": case "next":
			return "agent";
		case "ci":
			return g.says === "running" ? "ci" : driven ? "agent" : "you";
		case "done": case "closed":
			return "nobody";
	}
};
```

- **Why "next" needs a lane.** `next: triage` is right only when a lane will
  run triage. Code knows that: the ticket has a `started` or `ended` written
  by the lane writer, or `lanes` holds its claim (slice 4). Without one, the
  line is `nobody` or what its PR says. This fixes ticket 43 with no new fact:
  it has no ended run, so today it reads "next: triage".
- **Why review comes from a person.** No agent approves a PR (AGENTS.md). The
  line says "Ready for your review" until a person's review or
  `commented` with `asks: "changes"` lands. GitHub's three review words are
  the ones shown.
- **Idle goes into the row, not the line.** "Idle since 14:02" said nobody is
  driving it, which `nobody` and `gone` now say better. The time since the
  last fact shows small under the line.
- **Color only for state.** The line takes the color of whose turn it is:
  one color for you, one for working, one for failed, quiet gray for nobody.
  Nothing else on the page is colored.

### 5.2 The properties panel

One block of name and value pairs, as Linear's sidebar. Every value is a fold.

| Property | From | Shows |
|---|---|---|
| State | `Column.fromTimeline` (section 8) | Todo, In progress, In review, Done, Closed |
| Assignee | `to` on `filed`, then `assigned` (slice 4) | a person; until slice 4, the person the filer writes for |
| Agent | the last `started` and its `ended` | its name, hand run or lane, running time, cost and turns, or "cost not reported" |
| PR | `linked`, then GitHub's state through `CodeHost` | `#155 open`, one dot per check, the review result |
| Parent | `nested` | `#70 v1: the pipeline` |
| Branch | `started.log` or the PR's head | `v1-slice-1` |

- **Check dots:** one per check, in GitHub's order with failures first, as the
  merge box does. Green passed, red failed, amber running, gray skipped. The
  name shows on hover.
- **The review result:** "no review yet", "approved by owner", "changes asked
  by owner". Only a person's counts, as `changesAsked` in
  `packages/pipeline/src/tickets/yes.ts` already rules
  ([PR 155](https://github.com/usirin/tea-fabrika/pull/155)).

### 5.3 Sub-issues, with progress

Only on a ticket that has `nested` children. One row per child: its number,
title, column and short status line. Above them a bar: done, in review, in
progress, todo, each its own color, and "2 of 18 done".

```ts
// A sketch. The parent's progress is a count of its children's columns. A fold, never stored.
const progress = (children: readonly Ticket[], now: number) =>
	Object.groupBy(children, (t) => Column.fromTimeline(t.timeline, now)); // {in_review: [43, 44], ...}
```

### 5.4 The live agent panel

Only while a run is live. It is [what a ticket shows](./what-a-ticket-shows.md),
section 3, decided: one block updated in place, never a row per tool call.

- **What it shows:** the stage, how long, turns so far, the last tool's name,
  and "Open log". Linear's ephemeral `thought` and `action` are the same idea.
- **Made from beats,** on the run's side stream, which the fold never reads.
- **A hand run has no beats,** so its panel shows the stage, the time since
  `started` and "no live data for a hand run". That is honest and still says
  "it is working".

### 5.5 Activity: one line per fact

Today's `rowsOf` (`programs/tracker/src/rows.ts`), each row one line: time,
writer, what. A row's body is no longer shown under it; a comment's body is in
section 5.6. Newest first, so the latest thing is next to the panel above.
*Newest first is a lean: GitHub and Linear show oldest first. The doubt:
whether the owner reads a ticket as a story or as "what happened last". One
week of use settles it.*

### 5.6 Comments, folded

A comment is talk, not state. They sit at the bottom under "3 comments",
closed by default, each one opened by a click. A person's comment and the
composer stay open, since a person wrote it to be read.

## 6. Hand-run agents write facts, not prose

Until the pipeline runs lanes, agents run by hand post to tickets with
`fabrika post` ([PR 139](https://github.com/usirin/tea-fabrika/pull/139),
`apps/fabrika/src/host/post.ts`). Today it can only `comment`. It learns three
more, each written through `Tickets.write` from slice 1, as that agent:

```ts
// A sketch. What a hand-run agent posts, and what lands. `Tickets` takes the agent's writer.
//   fabrika post slice-1 started 43 --stage build --branch v1-slice-1
//   fabrika post slice-1 link 43 https://github.com/usirin/tea-fabrika/pull/155
//   fabrika post slice-1 ended 43 --stage build --outcome ask:owner:review
yield* tickets.write(43, {type: "started", run: "h-43-1", stage: "build", task: null, log: "v1-slice-1"});
yield* tickets.write(43, {type: "linked", url: "https://github.com/usirin/tea-fabrika/pull/155"});
yield* tickets.write(43, {type: "ended", run: "h-43-1", stage: "build",
	outcome: {kind: "ask", who: "owner", for: "review"}, usd: null, input: null, output: null, turns: null});
// tracker/ticket/43/inbox, each by agent slice-1 for its person. The page then says:
// "Ready for your review: PR #155, 4 of 4 checks passed"
```

- **`linked` names the PR, never its state.** The view reads the PR's state,
  checks and reviews through the tracker's `CodeHost` door, the way the list
  already reads open PRs (`programs/tracker/src/github.ts`). So a check's
  color is GitHub's word, never an agent's, as the decided notes require.
- **`pr` stays the watcher's** ([a ticket runs from the app](./a-ticket-runs-from-the-app.md),
  section 3). Until slice 7 runs, nothing writes `pr`, so a merged PR shows
  "merged" in the panel but the ticket is not done until the watcher writes
  it or a person closes it. That keeps "done only from a merge read by code".
- **`ended` from a hand run may not know its cost.** A lane's `ended` always
  has its numbers. A hand run often does not. The lean: `usd`, `input`,
  `output` and `turns` become `null` when not measured, and the panel says
  "cost not reported". A made-up number is worse than none:
  [`field/README.md`](../../field/README.md) already records an agent that
  wrote `minutes: 0` on every run. Question 2.
- **What this changes in a decided note.** Section 4 of
  [what a ticket shows](./what-a-ticket-shows.md) dropped the bridge: hooks,
  and the main session writing facts. This is way B of that section alone,
  through one command, with no hooks. It is still an agent's claim, shown with
  the agent's name. The door still refuses `answered` from it, and `Tickets`
  still refuses `answered` and `rated`.
- **Prose still has a place:** a comment for what a person should read. A
  brief tells hand-run agents: facts for state, a comment for words.

## 7. Inputs: one per command, and one query (decided 2026-10-27, changed 2026-10-28)

**Decided 2026-10-27 by the owner:** a program keeps the inputs that change
data apart from the inputs that only change the view, as CQRS keeps commands
apart from queries. **The names `write` and `view` were a lean, 75% sure.
Replaced 2026-10-28, below.**

Until 2026-10-30 the tracker had one input, `do`, which mixed both: `file`, `comment`,
`answer`, `close` and `reopen` became facts, while `list`, `open`, `show` and
`find` only moved the window (`programs/tracker/src/index.ts`). Input names
also become tool names, since an agent will drive programs through tsh's MCP
server. The 2026-10-27 lean gave two tools, `tracker.write` and `tracker.view`.

**Changed 2026-10-28 by the owner:** the split stays; the two inputs go.

- **One input per command.** `file`, `comment`, `close`, `reopen`, `answer`.
  Each writes one fact. The new facts follow the same rule: `link`, `nest`,
  `move`.
- **One `query` input for reads,** with filters. Every view reads through it.
  It never writes a fact. Today's `list`, `open`, `show` and `find` become
  query shapes.
- **`quit` is its own input.** It reads nothing; it stops the program, after
  the writes already asked for, as today.
- **MCP tool names follow from input names:** `tracker_file`,
  `tracker_comment`, ..., `tracker_query`. `tracker_query` carries
  `readOnlyHint: true`, MCP's standard tool annotation
  ([MCP, tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/schema#toolannotations)).
- **An agent's program list never holds `answer`.** Only a person answers, so
  an agent cannot even call it.

```ts
// A sketch. Commands: one input each, one fact each. Reads: one `query` with filters.
import {Schema} from "effect";

const TicketNumber = Schema.Number;
const File = Schema.Struct({title: Schema.String, body: Schema.String});
const Comment = Schema.Struct({ticket: TicketNumber, body: Schema.String});
const Close = Schema.Struct({ticket: TicketNumber});
const Reopen = Schema.Struct({ticket: TicketNumber});
const Answer = Schema.Struct({
	ticket: TicketNumber,
	ask: Schema.String,
	pick: Schema.String,
	note: Schema.NullOr(Schema.String),
});
const Query = Schema.Struct({
	ticket: Schema.optional(TicketNumber), // {ticket: 43} opens one
	status: Schema.optional(Schema.Literals(["open", "closed"])), // {status: "open", find: "login"} lists
	find: Schema.optional(Schema.String),
	under: Schema.optional(TicketNumber), // {under: 70, turn: "owner"} filters
	turn: Schema.optional(Schema.String),
});

// ticket --ticket 43
inputs: {
	comment: input(Comment, "Comment on a ticket."),
	answer: input(Answer, "Answer an ask. A person only."),
	close: input(Close, "Close a ticket once its asks are answered."),
	reopen: input(Reopen, "Reopen a closed ticket."),
	link: input(Link, "Link a PR."),
	nest: input(Nest, "Put a ticket under a parent."),
	move: input(Move, "Move an open ticket to another open state."),
	query: input(Query, "Read tickets. Writes nothing."),
	quit: input(Schema.Null, "Stop, after the writes already asked for."),
}
// board --under 70: move, close, query, quit
// list: file, query, quit

// An agent's program list: the same inputs minus `answer`.
```

- **Going back and folding comments** stay keys inside the window: they write
  nothing and read nothing new. *Open: whether an agent needs them as inputs.*
- **One output, `open`,** on every view, heard by the desk. It is the board's
  Enter on a card.
- **Why:** CQRS names each command by what it does, as in Greg Young's
  `DeactivateInventoryItem` ([m-r](https://github.com/gregoryyoung/m-r);
  [Fowler, CQRS](https://martinfowler.com/bliki/CQRS.html)). MCP and
  Anthropic's guidance favour one clear tool per action
  ([writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)).
  One query with filters is how read APIs usually work, as GitHub's issue
  search
  ([searching issues](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests))
  and GraphQL. It also fits the proposed notebook note
  ([PR 162](https://github.com/usirin/tea-fabrika/pull/162)), where a line
  like `board --under 70 | where turn=owner` is a filter.
- **Cost:** one change to each program's inputs, and every `tell(run, "do",
  ...)` in tests, tsh lines and `fabrika post` moves to its command's input or
  to `query`.
- **How sure: 85%.** The doubt: whether one query shape can grow to the
  notebook's `where` without becoming its own small language. A few more
  notebook lines would show it.

**A wrong guess, kept on purpose (2026-10-29, undone 2026-10-30).** The first
build of this section
([PR 164](https://github.com/usirin/tea-fabrika/pull/164)) kept one tracker
input, `do`, holding a tagged union of every command, and split it into one
MCP tool per case inside `@kampus/fabrika/mcp`.

```ts
// The detour, as first built. Wrong: do not copy.
inputs: {
	do: input(Do, "..."), // Do = {kind: "file", ...} | {kind: "close", ...} | ...
	query: input(Query, "..."),
}
// tools: tracker_file, tracker_close, ... cut out of `do` by its `kind`,
// with a person-only flag set on a case of the union.
```

- **Why it was guessed:** before, two inputs gave no order between them. A
  `file` then a `close` told back to back on two inputs could land the close
  first. One input kept them in order.
- **Why it was wrong:** that reason went away when each run got one mailbox,
  served in order across all its inputs
  ([PR 195](https://github.com/usirin/tea-fabrika/pull/195)). What was left
  was a name the owner rejects, `do`, and a second way to cut tools, by
  union case, that only one program used.
- **What replaced it:** one input per command, named by its verb, each value
  the command's own struct with no `kind`. `answer` and `rate_duplicate` are
  `input(..., {personOnly: true})`, so no tool is made for them; `query` is
  `input(..., {writes: false})`, so its tool carries `readOnlyHint`. The test
  "file #2 then close #2, told back to back on two inputs" keeps the order
  promise (`programs/tracker/src/tracker.test.ts`).

```ts
// What the tracker has now (programs/tracker/src/index.ts).
inputs: {
	file: input(File, "File a new ticket: its title and body. Writes its `filed`."),
	comment: input(Comment, "..."),
	close: input(OneTicket, "Close a ticket. Writes its `closed`."),
	reopen: input(OneTicket, "Reopen a closed ticket. Writes its `reopened`."),
	answer: input(Answer, "...", {personOnly: true}),
	rate_duplicate: input(RateDuplicate, "...", {personOnly: true}),
	query: input(Query, "...", {writes: false}),
	quit: input(Schema.Null, "Stop, once every write told before it is on the ledger."),
}
// tell(run, "file", {title: "Login fails", body: ""})
// tell(run, "close", {ticket: 1})
// tell(run, "quit", null)
// MCP: tracker_file, tracker_comment, tracker_close, tracker_reopen,
//      tracker_query (readOnlyHint), tracker_quit. No tracker_answer.
```

## 8. The views, the facts and the column

| Program | Flags | Folds | Writes |
|---|---|---|---|
| `ticket` | `--ticket 43` | that ticket, its parent's title, each child's column and line, its PRs from `CodeHost` | comment, answer, close, reopen, link, nest, move |
| `board` | `--under 70` | every child: its column and short line | move, close |
| `list` | `--under`, `--show`, `--find`, `--group` | today's list, grouped, children nested | file |
| `triage`, `cycle`, a project roadmap (Linear's Timeline view; `timeline` is the program that lays out one ticket's jobs) | later | | |

- **Today's `tracker` program becomes `list`.** Same window, same writes.
- **Inside a view, going somewhere is a `query`.** A child clicked on
  #70's page shows #43 in the same tile, with back to return.
- **Across tiles, a view asks** with `open`, and the desk places the tile, as
  Linear's peek ([peek](https://linear.app/docs/peek)).

**The new facts,** each on the ticket's own stream, each a struct under `type`
so old rows still read:

```ts
// A sketch, in Effect Schema. Beside the thirteen in packages/pipeline/src/tickets/ticket.ts.
const OpenState = Schema.Literals(["todo", "in_progress", "in_review"]); // done and closed are not here

Schema.Struct({type: Schema.Literal("linked"), url: PrUrl}), // a PR; anyone; its state comes from GitHub
Schema.Struct({type: Schema.Literal("nested"), under: Schema.NullOr(TicketNumber)}), // anyone
Schema.Struct({type: Schema.Literal("moved"), state: OpenState}), // a person
// From slice 4, as planned: `to` on `filed`, and
Schema.Struct({type: Schema.Literal("assigned"), to: Person}), // a person
// Then, one at a time, each when a view reads it:
Schema.Struct({type: Schema.Literal("related"), to: TicketNumber, as: Schema.Literals(["blocks", "related", "duplicate"])}),
Schema.Struct({type: Schema.Literal("unrelated"), to: TicketNumber, as: Schema.Literals(["blocks", "related", "duplicate"])}),
Schema.Struct({type: Schema.Literal("edited"), title: Title, body: Body}), // a person; a yes's hash goes stale
Schema.Struct({type: Schema.Literal("prioritized"), level: Schema.NullOr(Schema.Literals(["urgent", "high", "medium", "low"]))}), // a person
Schema.Struct({type: Schema.Literal("labeled"), add: Schema.Array(Label), drop: Schema.Array(Label)}), // a person
Schema.Struct({type: Schema.Literal("due"), on: Schema.NullOr(Day)}), // a person; a dated parent is a milestone
```

**What the fold refuses,** into `problems`, as it does today: a `nested` under
a ticket never filed, under itself, in a loop, or past 8 levels (GitHub's
number); a `moved` on a closed ticket; a `linked` URL twice; a `related` to
itself or the same relation twice. The door refuses a person's kinds from an
agent (`PERSON_KINDS`).

**The column is a fold.** A person's `moved` and the lane's facts both say
where an open ticket is, and the latest wins, as Linear's GitHub link moves an
issue when its PR moves:

```ts
// A sketch, column.ts, imported as `* as Column` (a union of literals, so a module, not a
// class). Pure, built on headOf.
export type Column = typeof OpenState.Type | "done" | "closed";

export const fromTimeline = (timeline: readonly Entry[], now: number): Column => {
	const head = headOf(timeline, now);
	if (head._tag === "done") return "done"; // a merged PR, or a person's close once answered
	if (head._tag === "closed") return "closed";
	const last = sinceReopen(timeline).findLast((e) => saysColumn(e.fact) !== null);
	return last === undefined ? "todo" : (saysColumn(last.fact) ?? "todo");
};

const saysColumn = (fact: Fact): typeof OpenState.Type | null => {
	if (fact.type === "moved") return fact.state;
	if (fact.type === "started") return "in_progress";
	if (fact.type === "linked") return "in_review";
	if (fact.type === "pr" && (fact.state === "open" || fact.state === "draft")) return "in_review";
	return null;
};
```

- **Done is never a drop target.** The board has a Done column nobody drops
  into, and a Closed column where a drop writes `closed`. `moved` cannot spell
  done.

### One example: the v1 parent and its 18 slices

The 18 slices are tickets 43 to 60, flat today. One new parent holds them.
*#70 is a sketch number, not filed; 62 to 64 are taken.*

```text
tracker/ticket/70/inbox  {type: "filed", title: "v1: the pipeline", body: "The plan: a ticket runs from the app."}  owner
tracker/ticket/43/inbox  {type: "nested", under: 70}    ... one for each of 43 to 60
tracker/ticket/43/inbox  {type: "linked", url: ".../pull/155"}    agent slice-1
tracker/ticket/44/inbox  {type: "linked", url: ".../pull/154"}    agent slice-2
tracker/ticket/50/inbox  {type: "linked", url: ".../pull/156"}    agent slice-6
tracker/ticket/49/inbox  {type: "started", run: "h-49-1", stage: "build", ...}   agent slice-5
```

```text
ticket --ticket 70
v1: the pipeline
Ready for your review: 1 slice                    <- the parent's line: its children that wait on you
0 of 18 done · 3 in review · 1 in progress · 14 todo
#43 slice 1   In review    Ready for your review: PR #155
#44 slice 2   In review    Waiting on CI: PR #154
#50 slice 6   In review    Waiting on CI: PR #156
#49 slice 5   In progress  Agent working: build
#45 slice 3   Todo         No one on it yet
...

board --under 70
Todo (14)         In progress (1)    In review (3)     Done (0)    Closed (0)
#45 slice 3       #49 slice 5        #43 slice 1
#46 slice 3t                         #44 slice 2
...                                  #50 slice 6
```

- **A parent's own line** counts the children by whose turn it is, with yours
  first: "Ready for your review: 1 slice" comes before "1 agent working". It
  is the same `whose`. *A lean: no product read for this does it.*

## 9. The build order

Small first. Each step is one pull request and costs $0 in agent runs.

| Step | What | Done when |
|---|---|---|
| 1 | `Glance.fromTicket`, and "next" only for a driven ticket | ticket 43 no longer says "next: triage"; laws: an open ask still always wins, done only from a merge or a person's close |
| 2 | `linked`, the PR panel from `CodeHost`, `fabrika post` learns `started`, `link`, `ended` | a hand-run agent's three posts make ticket 43 say "Ready for your review: PR #155, 4 of 4 checks passed"; an agent cannot post checks |
| 3 | the ticket page in six parts (section 5) | the page shows the line, properties, activity and folded comments, with no prose open by default |
| 4 | one input per command, one `query`, `quit` (section 7) | every `do` is gone; `query` alone cannot write a fact; an agent's list has no `answer` |
| 5 | `nested`, sub-issues and progress | 43 to 60 show under the parent with "0 of 18 done"; a loop and a missing parent are refused |
| 6 | `feed` taken out; `ticket` its own program | `ticket --ticket 70` in a tile shows the same page; three views at once measured for start time and memory |
| 7 | `moved`, `Column.fromTimeline`, `board` | `board --under 70` shows the slices by column; a drag writes `moved`; Done takes no drop |
| 8 | the `open` output, heard by the desk | Enter on a card opens #43 beside the board |
| 9 | then, as planned or asked: assignee (v1 slice 4), the live panel from beats, relations, edits, priority and labels, an inbox, saved views | each its own done-when |

- **How it runs beside v1.** Steps 1 to 3 touch `programs/tracker` and
  `apps/fabrika/src/host/post.ts`. Step 2 needs slice 1's `Tickets`
  ([PR 155](https://github.com/usirin/tea-fabrika/pull/155)) merged first.
  Step 5 and step 7 add to the same `Fact` union slice 1 moved, so they go
  one at a time. Slice 4 (assignee) also changes the tracker's form: steps 4
  and 6 should land before it starts or after it ends.

## 10. Recommendations

### The ticket page leads with whose turn it is

- **Why:** the owner's three questions (what is each agent doing, is CI green,
  am I needed) are all answered by one line and one panel. Linear's sidebar
  and GitHub's merge box are the known shapes.
- **Cost:** `Glance.fromTicket` with laws, a page rebuilt in six parts, and a `CodeHost`
  read per open ticket with a PR.
- **How sure: 80%.**

### Hand-run agents post three facts through `Tickets`

- **Why:** without it, every ticket today stays prose, and the new page has
  nothing to draw until v1 slice 13. It is one command, not hooks.
- **Cost:** three `fabrika post` verbs, one line in each hand-run brief, and
  nullable cost fields on `ended`. It is still the agent's claim of when it
  started and stopped; a forgotten `ended` leaves "Agent working" until a
  person closes it.
- **How sure: 75%.** The doubt: agents forget steps (field notes say so). One
  day of the v1 slices run this way would show how often.

### Status is a fold; `moved` holds only open states

- **Why:** it meets both studies. Nobody can write done, and a person can
  still move a card.
- **Cost:** a lane fact can undo a person's drag: a card dragged back to Todo
  jumps to In progress when an agent starts.
- **How sure: 70%.** A week of the board on v1's slices would show whether the
  jump annoys.

### One program per view, sharing only the ledger

- **Why:** CQRS and Elm Land's shared model, both known. Each view starts
  alone from tsh and is tested alone.
- **Cost:** each view folds the whole ledger and polls it. Small at hundreds
  of tickets, not at tens of thousands.
- **How sure: 75%.** Step 6 measures three views at once.

### One input per command, one `query` (decided 2026-10-28)

- **Was:** two inputs, `write` and `view`, 75% sure. Replaced 2026-10-28 by
  the owner's choice in section 7.
- **Why, cost and how sure (85%):** section 7.

## Open for the owner

1. May an agent write `nested`, as plan-v1 would for the slices? Lean: yes.
2. A hand run's `ended` with no cost: `null`, shown as "not reported"? Lean: yes.
3. Activity newest first? Lean: yes, for a week, then look again.
4. Name the parent "v1: the pipeline"? Lean: yes.

## What it cannot tell us

- **Whether the page reads better.** The mockups use ticket 43's real data,
  but nobody has used the page.
- **How often a hand-run agent forgets `ended`.** Not measured.
- **What Linear's agent panel looks like inside an issue.** Its docs describe
  the data, not the layout. The panel here is our reading.
- **Whether several folds stay cheap.** Step 6 measures it.
- **Whether a drag undone by a lane fact annoys.** Only daily use tells.
- **Some numbers are borrowed:** 8 levels of nesting is GitHub's, and the
  hour for idle is still a guess (`HOUR` in `programs/tracker/src/head.ts`).
- **What the plan stage's tasks become.** A plan's tasks are ids inside its
  `planned` fact, not tickets. Whether they become sub-tickets is the plan
  stage's call.
