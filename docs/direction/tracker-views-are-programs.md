# Tracker views are programs

**Proposed 2026-10-27.** Not settled. This is the study that
[the tracker is like Linear](./the-tracker-is-like-linear.md) names as next.

```ts
// A sketch. One ledger. Each view is its own small tea program that folds it.
// Data goes through the ledger. A request ("open #43 beside me") goes through an output.
//
//   tsh> ticket --ticket 62   the parent, with its 18 sub-issues nested under it
//   tsh> board --under 62     the same 18 tickets as cards, one column per state
//   tsh> list --group state   every ticket, grouped and filtered
//
// Enter on a board card: the board sends one output, and the desk opens a tile beside it.
send("open", {program: "ticket", flags: {ticket: 43}, where: "beside"});
// Dragging a card writes one fact, and every view sees it at its next poll:
{type: "moved", state: "in_progress"} // on tracker/ticket/43/inbox, by user:owner
```

The answer in six lines:

- **Each view is a program:** `ticket`, `board`, `list` first. `triage`,
  `timeline` and `cycle` come later.
- **They share nothing but the ledger and one fold.** Each one reads the
  ledger and folds it the same way, with code from one package.
- **They talk through outputs, and only to ask.** A board asks for a ticket to
  be opened, and the desk opens it. No view sends another its data.
- **Two new facts come first:** `nested` (a sub-issue's parent) and `moved`
  (its workflow state). The rest follow one at a time.
- **A project is a parent ticket,** as already decided. A milestone is a
  sub-ticket with a due date. Neither needs its own kind.
- **tea does not grow, and tea-program does not grow.** The desk learns one
  thing: to hear an `open` output.

## 1. What Linear and GitHub do

Linear and GitHub have the same shape: one set of issues, and many views over
it. A view only reads. Moving a card writes one field, and every other view
shows it.

**Linear's issue** (each line from Linear's docs):

- **Sub-issues.** Adding an issue as a sub-issue makes the other one its
  parent ([parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)).
  - The parent lists its sub-issues under its description, with "+ Add
    sub-issues". Completed ones can be hidden, and each person picks the order
    (same page).
  - A team can turn on auto-close: all sub-issues done closes the parent, and
    a done parent closes what is left
    ([changelog, 2024-09-06](https://linear.app/changelog/2024-09-06-auto-close-parent-and-sub-issues)).
  - A new sub-issue takes its parent's team, priority and project. It does not
    take its labels ([same page](https://linear.app/docs/parent-and-sub-issues)).
  - How deep sub-issues may nest: the docs do not say.
- **Relations.** Blocked by, blocking, related, and duplicate
  ([issue relations](https://linear.app/docs/issue-relations)).
  - A blocked issue shows a red flag. When the blocker is done it turns green
    (same page).
  - Duplicate goes one way. A duplicate is closed as canceled
    ([triage](https://linear.app/docs/triage)); a newer page says it gets a
    reserved "Duplicate" status
    ([configuring workflows](https://linear.app/docs/configuring-workflows)).
    The docs disagree.
- **Workflow states.** Each team has its own. The default order is Backlog,
  Todo, In Progress, Done, Canceled. Triage is turned on apart
  ([configuring workflows](https://linear.app/docs/configuring-workflows)).
  - Every state sits in a fixed category, and states move only inside it.
    Linear's own team has In Progress, In Review and Ready to Merge, all in
    "started" (same page).
  - A new issue with no state goes to the first backlog state, or to Triage
    if it is on ([GraphQL API](https://linear.app/developers/graphql)).
- **Projects and milestones.** A project needs only a name and a status, and
  has one lead ([projects](https://linear.app/docs/projects)). Its statuses
  sit in five categories: backlog, planned, started, completed, canceled
  ([changelog, 2024-03-19](https://linear.app/changelog/2024-03-19-custom-statuses-for-projects)).
  - A milestone belongs to one project. An issue is in one milestone at a
    time, and each milestone shows how much is done
    ([project milestones](https://linear.app/docs/project-milestones)).
  - Initiatives group projects, with a health of on track, at risk or off
    track ([initiatives](https://linear.app/docs/initiatives)).
- **Cycles.** 1 to 8 weeks, with an optional cooldown. Unfinished issues roll
  over to the next cycle on their own
  ([use cycles](https://linear.app/docs/use-cycles)).
- **Triage** is an inbox: accept (to the default state), decline (canceled),
  duplicate, or snooze ([triage](https://linear.app/docs/triage)).
- **Labels, priority, estimate, due date**
  ([issue properties](https://linear.app/docs/issue-property)).
  - Labels can sit in groups, one level deep.
  - Priority is No priority, Low, Medium, High, Urgent.
  - Estimates use a scale the team picks: exponential, Fibonacci, linear or
    T-shirt.
  - An issue has a due date or an SLA, not both.
- **Agents.** An issue given to an agent sets its `delegate`, and the person
  stays the assignee ([agents](https://linear.app/developers/agents)).
  - An agent session is pending, active, awaitingInput, error, complete or
    stale. Linear sets it from the agent's last activity. Activities are
    thought, action, elicitation, response and error
    ([agent interaction](https://linear.app/developers/agent-interaction)).
  - Linear tells agents to rebuild history from activities, not comments,
    since comments can be edited
    ([agent best practices](https://linear.app/developers/agent-best-practices)).
    That is our own rule already: machine state is a fact, never a comment
    ([the ticket is the lane view](./the-ticket-is-the-lane-view.md)). Our
    `started`, `ended`, `asked` and `answered` are Linear's session and
    activities, kept as facts.

**Linear's views:**

- **List or board** for issues, and **timeline** for projects
  ([display options](https://linear.app/docs/display-options),
  [timeline](https://linear.app/docs/timeline)). The timeline shows projects,
  not issues.
- **Grouping** by status, assignee, project, priority, cycle, label, parent
  and more. Sub-grouping makes swimlanes on a board. "Group by parent" works
  only on boards; a list nests sub-issues instead
  ([display options](https://linear.app/docs/display-options)).
- **Dragging a card into a group gives it that group's value.** Into a status
  column, that changes its status (same page).
- **Filters** nest AND and OR groups over any property
  ([filters](https://linear.app/docs/filters)).
- **Saved views** are kept per workspace or per team, each with an owner, and
  can be starred ([custom views](https://linear.app/docs/custom-views)).
- **Peek** opens an issue beside the list with the space bar
  ([peek](https://linear.app/docs/peek)).

**GitHub Projects** puts three layouts over the same items:

- **Table, board and roadmap.** Each view is one of them, with its own filter,
  sort, group and slice
  ([about projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)).
- **A board's columns are one field,** single select or iteration. Dragging a
  card sets that field
  ([board layout](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout)).
- **Sub-issues:** up to 100 under one parent, nested up to 8 levels
  ([adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)).
  A project can group by "Parent issue" and show "Sub-issue progress"
  ([parent and progress fields](https://docs.github.com/en/enterprise-cloud@latest/issues/planning-and-tracking-with-projects/understanding-fields/about-parent-issue-and-sub-issue-progress-fields)).
- **Blocked by and blocking**, with a "Blocked" mark on boards
  ([issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies)).
- **A view's unsaved changes are yours alone** until you save them
  ([managing views](https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/managing-your-views)).

**Linear's sync engine** keeps one in-memory pool of every object, and each
view draws again when an object in it changes. This comes from an outside
study of its client, not from Linear
([reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine)).
Our ledger plays that pool's part.

What this says for us:

- **A view is a read, plus a way to write one field.** Neither product has a
  view that holds data of its own, beyond its saved display options.
- **Sub-issues and a status are the two fields every view needs.** Labels,
  cycles and milestones only add more ways to group.

## 2. The Elm answer first

**Elm's answer: one model, many views of it.**

- **One Elm program has one model.** Many views over it are many `view`
  functions over that model. Elm Land, a framework for Elm apps, gives every
  page a shared model: "The `Model` type in `src/Shared/Model.elm` defines
  what data is available on every page"
  ([Elm Land, shared](https://elm.land/concepts/shared.html)).
- **A page asks; it does not reach in.** A page changes shared data only
  through named effects, such as `Effect.signOut`, and goes to another page
  with `Effect.pushRoute`
  ([Elm Land, effects](https://elm.land/concepts/effect.html)).
- **Two Elm programs on one page share nothing.** Each starts with its own
  `Elm.X.init({node})` ([Elm guide, interop](https://guide.elm-lang.org/interop/)),
  and they meet only through ports, which are "about creating strong
  boundaries" ([Elm guide, ports](https://guide.elm-lang.org/interop/ports.html)).
- **The database answer is CQRS.** "You can use a different model to update
  information than the model you use to read information", because people
  "use various presentations of this information"
  ([Fowler, CQRS](https://martinfowler.com/bliki/CQRS.html)). Each view is a
  read model folded from the same events.

**How that maps here:**

| Elm or CQRS | Here |
|---|---|
| Elm Land's shared model | the ledger, outside every program |
| a page | a view program: `ticket`, `board`, `list` |
| `pushRoute` | an `open` output the desk hears |
| a named effect that changes shared data | a write: one fact on the ledger |
| a read model | each program's fold of the ledger |
| two programs on one page, ports between | two tiles, outputs between |

**What tea-program already gives** (`packages/fabrika/src/program`):

- **Flags** say what a view is about: `ticket --ticket 62`,
  `board --under 62`. They are checked before `main` runs.
- **Inputs** carry what its window sends: open, move, comment. Today's
  tracker has one input, `do`.
- **Outputs** are events, heard by whoever listens and kept nowhere. That is
  the right shape for "open this", which nobody needs later.
- **`view`** picks one machine's state for the window.
- **`start`, `tell`, `pipe`, `call`** let tsh and the desk start and feed a
  view like any program.
- The tracker's machine already reads and writes the ledger: `load`, `save`
  and the `poll` Sub (`programs/tracker/src/machine.ts`).

**What does not grow:**

- **tea: nothing.** Each view's machine is a parent written by hand. It holds
  a `feed` child, the ledger read that today's tracker machine already does,
  and steps it, as Elm parents do ([Elm first](./elm-first.md)).
- **tea-program: nothing.** Flags, inputs and outputs cover it.
- **The host: one thing.** The desk hears an `open` output from a run in a
  tile and opens what it names. That is Elm Land's `pushRoute`, handled by its
  shell.
- **No pub-sub between views, no shared memory, no pipe from view to view.**
  A view that wants fresh data reads the ledger. A second person's machine
  does the same, so one path serves both.

```ts
// A sketch. Every view's machine: the shared feed, stepped by hand, plus its own part.
import {feed, type Feed, type FeedMsg} from "@tea-fabrika/tracker/feed"; // load, poll, fold

type Board = {
	feed: Feed; // tickets folded so far, `seen`, the load in flight: today's machine's first half
	under: TicketNumber | null; // from the flag
	picked: TicketNumber | null; // the card with the focus
};
type BoardMsg =
	| {type: "feed"; msg: FeedMsg}
	| {type: "move"; ticket: TicketNumber; to: OpenState}
	| {type: "pick"; ticket: TicketNumber};

const update = (s: Board, m: BoardMsg) => {
	switch (m.type) {
		case "feed": {
			const [next, cmds] = feed.update(s.feed, m.msg); // the parent steps its child
			return [{...s, feed: next}, cmds];
		}
		case "move": // one fact; the board shows it after its next load, as every view does
			return [s, [save({write: {kind: "move", ticket: m.ticket, to: m.to}})]];
		case "pick":
			return [{...s, picked: m.ticket}, []];
	}
};
```

## 3. The views, and what each folds

Each view is one program in `programs/tracker`, beside today's. They share one
library in the same package: the facts, the fold, `headOf`, the new
`columnOf` and `childrenOf`, and the `feed` machine.

| Program | Flags | Folds | Writes |
|---|---|---|---|
| `ticket` | `--ticket 62` | that ticket's timeline, its parent's title, each sub-issue's title, column and top line, its relations | comment, answer, close, reopen, nest, move |
| `board` | `--under 62`, `--group state` | every ticket under the parent: its column and top line | move (a drag), close (a drop on Closed) |
| `list` | `--under`, `--show`, `--find`, `--group` | today's list, with groups and sub-issues nested | file |
| `triage` (later) | none | tickets not sorted yet | accept, decline, duplicate |
| `timeline` (later) | `--under` | parents with due dates, and their progress | due |
| `cycle` (later) | `--cycle` | the tickets in one cycle | cycled |

- **Today's `tracker` program becomes `list`.** Same window, same writes.
- **Inside a view, going somewhere is its own business.** A sub-issue clicked
  in `ticket 62` shows #43 in the same tile, with back to return, as a link on
  a page does. That is an input, `{kind: "open", ticket: 43}`, as today.
- **Across tiles, a view asks.** Enter on a board card sends `open`. The desk
  shows the ticket in the tile beside, and a second card changes that same
  tile, as Linear's peek does.

```ts
// A sketch. The one output every view has, and the one thing the desk learns.
const Open = Schema.Struct({
	program: Schema.Literals(["ticket", "board", "list"]), // only programs the desk knows to open
	flags: Schema.Record(Schema.String, Schema.Unknown), // checked by that program's own flags
	where: Schema.Literals(["beside", "here"]),
});
outputs: {open: output(Open, "Show a ticket, or another view, in a tile.")}

// The desk, on a run's `open`: the tile it last opened for this run, else a split beside it.
// `ticket` runs there with those flags. A second `open` from the same board tells that run
// {kind: "open", ticket: 44} on its input, so the tile changes in place.
```

- **Saved views are tsh lines.** `board --under 62` is the view. A saved one
  is a name for that line, kept on the ledger at `tracker/view/v1-board` so
  both people see it. tsh already has the idea, an alias, so no program needs
  anything new. *A guess at the shape: nobody has used a saved view here yet.*

## 4. The new facts

Every new fact goes on the ticket's own stream, like the ones there now. Each
is a tagged struct under `type`, so old rows still read. The fold checks each
one against what came before, and puts a misfit in `problems`, as it does
today.

```ts
// A sketch, in Effect Schema. Beside today's `Fact` union in programs/tracker/src/ticket.ts.

/** The states a person moves a ticket between. Done and Closed are not here: see `columnOf`. */
const OpenState = Schema.Literals(["backlog", "todo", "in_progress", "in_review"]);

/** This ticket is a sub-issue of `under`. `null`: it is nobody's sub-issue any more. */
Schema.Struct({type: Schema.Literal("nested"), under: Schema.NullOr(TicketNumber)}),

/** A person moved it to a workflow state. */
Schema.Struct({type: Schema.Literal("moved"), state: OpenState}),

/** A relation to another ticket, and taking it away. Written on the ticket it starts from. */
const As = Schema.Literals(["blocks", "related", "duplicate"]);
Schema.Struct({type: Schema.Literal("linked"), to: TicketNumber, as: As}),
Schema.Struct({type: Schema.Literal("unlinked"), to: TicketNumber, as: As}),

// Later, one at a time, each when a view reads it:
Schema.Struct({type: Schema.Literal("labeled"), add: Schema.Array(Label), drop: Schema.Array(Label)}),
Schema.Struct({
	type: Schema.Literal("prioritized"),
	priority: Schema.Literals(["none", "urgent", "high", "medium", "low"]),
}),
Schema.Struct({type: Schema.Literal("estimated"), points: Schema.NullOr(Count)}),
Schema.Struct({type: Schema.Literal("due"), on: Schema.NullOr(Day)}), // "2026-11-30"
Schema.Struct({type: Schema.Literal("cycled"), cycle: Schema.NullOr(Id)}),
```

**What the fold refuses:**

- **`nested`:** a parent that was never filed, the ticket itself, or a loop
  (43 under 62 while 62 is under 43). GitHub stops at 8 levels, and we take
  the same number. The last `nested` wins.
- **`moved`:** a ticket that is closed. Reopen it first.
- **`linked`:** a ticket that was never filed, or itself. A second `linked`
  with the same `to` and `as` is a misfit.

**Who writes them:** anyone, as with `filed` and `closed`. A plan stage that
files its tasks as sub-tickets would write `nested`
([a project is a parent plan](./a-project-is-a-parent-plan.md)). Nothing in
the pipeline reads any of them to decide
([the tracker is like Linear](./the-tracker-is-like-linear.md), "What stays").

**The column is a fold, not a field.** A person's `moved` and the lane's own
facts both say where a ticket is. The latest one wins, as Linear's GitHub
link moves an issue when its pull request moves:

```ts
// A sketch. Pure, like headOf, and built on it.
type Column = typeof OpenState.Type | "done" | "closed";

const columnOf = (timeline: readonly Entry[], now: number): Column => {
	const head = headOf(timeline, now);
	if (head._tag === "done") return "done"; // code says done: a merged PR, never a drag
	if (head._tag === "closed") return "closed"; // closed, and not done
	const last = sinceReopen(timeline).findLast((e) => saysColumn(e.fact) !== null);
	return last === undefined ? "backlog" : (saysColumn(last.fact) ?? "backlog"); // Linear's default
};

const saysColumn = (fact: Fact): typeof OpenState.Type | null => {
	if (fact.type === "moved") return fact.state;
	if (fact.type === "started") return "in_progress"; // a lane started an agent on it
	if (fact.type === "pr" && (fact.state === "open" || fact.state === "draft")) return "in_review";
	return null;
};
```

- **Why Done is never a drop target.** It is decided that code says done,
  from a merged pull request, and that a person can close a ticket without it
  being done ([what a ticket shows](./what-a-ticket-shows.md), section 5). So
  the board has a Done column nobody drops into, and a Closed column where a
  drop writes `closed`. `moved` cannot say done: the mistake has no spelling.

## 5. One example: v1's 18 slices under one parent

The v1 plan's 18 slices are tickets #43 to #60, flat today. A new parent, here
called **#62 "v1: the pipeline"**, holds them. *#62 is a sketch number. It is
not filed.*

**The facts** (one new ticket, 18 `nested`, 4 `moved`; every other row is
there already):

```text
tracker/ticket/62/inbox  {type: "filed", title: "v1: the pipeline", body: "The plan: a ticket runs from the app."}  user:owner
tracker/ticket/43/inbox  {type: "nested", under: 62}                user:owner
tracker/ticket/44/inbox  {type: "nested", under: 62}                user:owner
  ... one each for #45 to #60
tracker/ticket/43/inbox  {type: "moved", state: "in_progress"}      user:owner   round 1
tracker/ticket/44/inbox  {type: "moved", state: "in_progress"}      user:owner   round 1
tracker/ticket/49/inbox  {type: "moved", state: "in_progress"}      user:owner   round 1
tracker/ticket/50/inbox  {type: "moved", state: "in_progress"}      user:owner   round 1
tracker/ticket/43/inbox  {type: "pr", url: "…/pull/150", state: "open", …}   watcher   later: slice 1's PR
```

**What `ticket --ticket 62` shows:**

```text
#62 v1: the pipeline                               next: triage
0 of 18 done, 1 in review, 3 in progress

Sub-issues
  #43 v1 slice 1: Tickets and the lane facts        in review     PR #150, checks running
  #44 v1 slice 2: A system prompt on every agent    in progress
  #45 v1 slice 3: The walking skeleton              backlog
  #46 v1 slice 3t: The trace tile                   backlog
  ...
  #49 v1 slice 5: The mutation step                 in progress
  #50 v1 slice 6: The box                           in progress
  ...
  #60 v1 slice 14: Two people                       backlog
+ Add sub-issue

- filed                                user:owner  The plan: a ticket runs from the app.
```

**What `board --under 62` shows:**

```text
Backlog (14)     Todo (0)   In progress (3)   In review (1)   Done (0)   Closed (0)
#45 slice 3                 #44 slice 2       #43 slice 1
#46 slice 3t                #49 slice 5
#47 slice 4                 #50 slice 6
...
```

**One drag, traced.** The owner drags #45 to Todo:

```text
board's window   {kind: "move", ticket: 45, to: "todo"}                on its `do` input
board's machine  save {write: {kind: "move", ticket: 45, to: "todo"}}
ledger           tracker/ticket/45/inbox  {type: "moved", state: "todo"}  user:owner
board            its next load: #45 in Todo
ticket 62        its poll sees the row: "#45 ... todo"
list             its poll sees it too. No view told another anything.
```

Then Enter on #43's card: the board sends
`open {program: "ticket", flags: {ticket: 43}, where: "beside"}`, and the desk
shows #43 in a new tile beside the board.

## 6. The build order

Small first. Each step is one pull request, and every view works at the end
of each.

| Step | What | Done when | Size |
|---|---|---|---|
| 1 | `nested`, and sub-issues in today's ticket page | #43 to #60 show under #62 with "0 of 18 done"; a loop and a missing parent are refused by the fold; a sub-issue's page shows its parent | S: about 300 lines with tests |
| 2 | `feed` taken out of the machine; `ticket` its own program | `ticket --ticket 62` in a tile shows the same page; a fact written from another tile shows within one poll; the list runs on `feed` unchanged; start time and memory of three views at once measured | M |
| 3 | `moved`, `columnOf`, and `board` | `board --under 62` shows the slices by column; a drag writes `moved`; a merged PR puts a card in Done with no drag; Done takes no drop | M |
| 4 | the `open` output, heard by the desk | Enter on a card opens #43 beside the board; a second card changes that tile in place; a program not in `Open`'s list cannot be named | S to M, mostly in `apps/fabrika` |
| 5 | `list` with groups, filters and nested sub-issues; saved views as named lines | `list --group state` groups; a saved view made in one app opens in the other person's | M |
| 6 | `linked` and `unlinked` | "blocked by #47" shows on #49's page and as a mark on its card, and goes once #47 is done | S |
| 7 | priority, labels, estimate, due date | each shows on the card and the page, and `list` groups by it | S each |
| 8 | `triage`, an inbox program | a ticket filed by an agent waits there; accept, decline and duplicate each write the facts above | M |
| 9 | progress and `timeline` | a parent shows how much of each nested parent is done; a milestone (a sub-ticket with a due date) shows on the timeline | L |
| 10 | cycles | a cycle is its own stream; unfinished tickets roll over, as Linear does | M |

**How this lane runs beside the v1 slices:**

- **It touches slice 1.** Slice 1 moves the nine lane fact schemas into the
  pipeline, and the tracker imports them back. Steps 1 and 3 add facts to the
  tracker's `Fact` union in `programs/tracker/src/ticket.ts`, the same file.
  The new facts are the tracker's own, so they stay in the tracker after
  slice 1. Only the file clashes.
- **So step 1 starts once slice 1 merges.** Slice 1 is in round 1 and costs
  $0, so the wait is short. Until then this lane is this note and nothing
  else.
- **Steps 1 to 3 run beside round 2** (slices 3, 7 and 6c). Those live in the
  pipeline and the host, not in the tracker.
- **Slice 4 is the next clash.** It adds `to` on `filed`, the `assigned` fact
  and a picker in the form, all in the tracker. Step 2 should land before
  slice 4 starts, or wait until after it, not run at the same time.
- **Step 4 touches the desk** (`apps/fabrika/src/desk`), which no v1 slice
  names.
- **Nothing here spends model money.** Every step is $0, tested with laws on
  the folds, as the tracker is today.

## 7. Recommendations

### One program per view, sharing only the ledger

- **Why:** it is CQRS and Elm Land's shared model, both known answers. Each
  view stays small, starts alone from tsh, and is tested alone. It is also the
  biggest real use of our own program model, which is the point.
- **Cost:** each view folds the whole ledger when it starts, and polls it.
  With a few hundred tickets that is small; with tens of thousands it is not.
  Linear keeps one pool in memory for every view. To match it we would need a
  shared cache in the host.
- **How sure: 75%.** The doubt is the cost of several folds and polls at once.
  Step 2 settles it: it measures the start time and memory of three views open
  at once on the shared ledger.

### Views ask through an `open` output; data never goes from view to view

- **Why:** outputs are events and keep nothing, and "open this" is an event.
  It is Elm Land's `pushRoute`. The desk stays the only one that places
  tiles.
- **Cost:** the desk learns one output shape. A view cannot know whether its
  ask was done.
- **How sure: 80%.**

### `nested` and `moved` first

- **Why:** they are the two fields every view in both products needs, and the
  first use (v1's slices) needs exactly those two.
- **Cost:** two fact kinds, their misfit checks, and a row for each.
- **How sure: 90%.**

### The column is a fold of `moved` and the lane's facts, and the latest wins

- **Why:** code already says done from a merged PR, and a lane already says
  when it starts. Writing `moved` from code too would say the same thing
  twice.
- **Cost:** a lane fact can undo a person's drag. A card dragged back to Todo
  jumps to In progress when an agent starts on it.
- **How sure: 70%.** The doubt is whether that jump feels right in daily use.
  A week of the board on v1's slices would show it.

### A milestone is a sub-ticket with a due date

- **Why:** the plan is the one shape, and a project is a parent plan. A
  milestone is then just a parent with a date. Linear keeps it as its own
  object, one project each.
- **Cost:** a ticket's milestone and its project become one chain of parents,
  not two fields. A ticket cannot sit in a project and in a milestone of
  another branch.
- **How sure: 60%.** The doubt: Linear lets an issue's project and milestone
  be set apart. If we need that, a milestone becomes a field. The first real
  roadmap would settle it.

### No custom workflow states yet

- **Why:** four open states plus Done and Closed fit what we do now. Linear's
  own extra states (In Review, Ready to Merge) sit inside fixed categories.
- **Cost:** a new state later is a change to `OpenState`. Old rows still read,
  since the list only grows.
- **How sure: 80%.**

## Open for the owner

- Name the parent #62 "v1: the pipeline"?
- Saved views kept on the ledger, shared by both people, or kept per person?
- A milestone as a dated sub-ticket, or a field of its own?

## What it cannot tell us

- **Whether several folds stay cheap.** Not measured. Step 2 measures it.
- **Whether a drag undone by a lane fact annoys.** Only daily use tells.
- **How deep our nesting goes in practice.** A project of plans of tasks is
  three levels. The 8-level cap is GitHub's number, not ours.
- **Which Linear parts we use first after the board.** The order in section 6
  is a guess, and use will change it.
- **What the plan stage's tasks become.** Today a plan's tasks are ids inside
  its `planned` fact, not tickets. Whether they become sub-tickets is the plan
  stage's call, not this note's.
- **Some of Linear's own rules.** Its docs do not say how deep sub-issues
  nest, and they disagree on what a duplicate's state becomes.
