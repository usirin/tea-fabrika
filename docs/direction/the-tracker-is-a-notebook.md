# The tracker is a notebook of live lines

**Proposed 2026-10-27.** Nothing here is built. It changes the main window of
[the tracker is like Linear](./the-tracker-is-like-linear.md): the tracker
opens on a notebook of saved tsh lines, not on a Linear-style list. Linear's
data model (assignee, workflow states, labels, milestones as facts) stays.

```sh
# A sketch. The tracker's home: each line is one question asked every day.
# Under each line, its pipe shows the type and the count at every step.
board --under 70 | where turn=owner              # board → Row[] 18 | where → Row[] 1
agents --under 70 | log --last                   # agents → Agent[] 3 | log → Step[] 3
prs --under 70 | checks                          # prs → PR[] 3 | checks → Checks[] 3
board --under 70 | where turn=owner | ticket     # ... | ticket → View[] 1, with its buttons
facts --under 70 --since yesterday | where type=ended | standup   # Fact[] 10 | Fact[] 1 | Text
facts --live                                     # the fact stream, newest last
```

The answer in five lines:

- **The tracker is a notebook.** Each line is one saved tsh pipe of small
  programs that each do one thing.
- **Every line is live.** When a fact lands on the ledger, each line re-runs
  and its answer changes in place. Nobody presses run.
- **Every pipe shows its types.** A wrong pipe shows a typed error at the step
  that broke, never a blank result.
- **A line can end in a whole ticket,** with its buttons, so the owner acts
  from the line that told them to.
- **A ticket never draws another program's view.** Trace, log, checks and cost
  are links. A link opens that program in its own tile.

## 1. What changes, and what stays

- **What changes.** [The tracker is like Linear](./the-tracker-is-like-linear.md)
  set the tracker to be built like Linear, so its window grew as a list of
  tickets with a timeline behind each one. This note proposes the home is a
  notebook instead. The list is still there: it is one line,
  `board --under 70`.
- **What stays.**
  - Tickets are facts on the ledger. Only people on the ledger write them.
  - Linear's model for those facts: assignee, workflow states, labels,
    milestones. The study that note asked for still comes next.
  - A ticket's top line and its rows
    ([what a ticket shows](./what-a-ticket-shows.md)). `ticket` at the end of
    a pipe draws exactly that view.
  - Only a person answers an ask. The buttons on a `ticket` result write
    `answered` as the person, the same as today's ask box.
- **Why this is a tsh thing, not a new language.** tsh already runs typed pipes
  of tea programs ([tsh](./tsh-a-shell-for-tea-programs.md)). A notebook line
  is a tsh line that is kept and re-run. No new syntax.

## 2. The programs, one job each

| Program | Takes | Gives |
|---|---|---|
| `board --under 70` | nothing | `Row[]`, one row per ticket under #70 |
| `where turn=owner` | `Row[]` or `Fact[]` | the same type, fewer |
| `ticket` | `Row[]` or a number | `View[]`, the full ticket with its buttons |
| `agents --under 70` | nothing | `Agent[]`, each running agent |
| `log --last` | `Agent[]` | `Step[]`, each agent's last step |
| `prs --under 70` | nothing | `PR[]` |
| `checks` | `PR[]` or a number | `Checks[]` |
| `facts --under 70` | nothing | `Fact[]`; `--since` and `--live` narrow it |
| `standup` | `Fact[]` | `Text`, the morning summary |
| `turn`, `stages` | `Fact[]` | `Turn`, `Stage[]` |
| `trace 43`, `cost 43` | a ticket number | their own view, in their own tile |

- **A ticket can be taken apart into the programs that make it.** `ticket 43`
  is `facts 43` folded by `turn` and `stages`, plus `checks 155` and
  `log slice-1`. Each part is a program you can run alone, in its own line.
  This is borrowed from the mockup's "take it apart" concept.
- **The fact stream is one more line.** `facts --live` shows each fact as it
  lands. This is borrowed from the mockup's "bus" concept. It is a line like
  any other, not a separate window.
- **`standup` is the first new program a line makes cheap.**
  `facts --since yesterday | where type=ended | standup` reads the ended runs
  and writes one bullet each. It is a few lines of code, because `facts` and
  `where` already exist.

## 3. Link, never embed (a hard rule)

A view that is another program's job is never drawn inside a ticket. The
ticket shows one line with a link. The link opens that program in its own
tile.

```text
  #43 v1 slice 1: Tickets and the lane facts        waits on you: review PR #155
  checks 4 of 4 passed ↗   log slice-1 ↗   trace 43 ↗   cost 43 ↗
  [ Yes, PR #155 is good ]  [ Request changes ]
```

- **Click `trace 43`:** a new tile opens running `trace 43`. That program reads
  the facts itself. The ticket does not pass it anything but the number.
- **Why:** each view has one owner. A trace drawn inside the ticket is a second
  trace that drifts from the first. This is the Unix rule of one program, one
  job, and it matches the tile layout the app already has
  ([the GUI is Electron first](./the-gui-is-electron-first.md)).
- **The one line is allowed** ("4 of 4 passed"): it is a fold over `pr` facts
  the ticket already has. The checks view, with each check and its log, is
  `checks 155`'s.

## 4. The machine

In Elm terms the notebook is a parent with a list of child models, one per
line. The ledger's tail is a Sub. A landed fact is a Msg, and `update`
re-runs every line. This is the Elm answer; no new tea concept is needed
([elm first](./elm-first.md)).

```ts
// A sketch, in Effect Schema. The notebook's state: a list of lines.
import {Schema} from "effect";
import {Fact} from "@kampus/pipeline/tickets/ticket";

/** One program call in a pipe: `where turn=owner` is {name: "where", args: ["turn=owner"]}. */
const Step = Schema.Struct({name: Schema.String, args: Schema.Array(Schema.String)});

/** What came out of one step: its type's name and how many. `board → Row[] 18`. */
const Shape = Schema.Struct({type: Schema.String, count: Schema.Int});

/** A line's last answer. */
const Result = Schema.Union([
	Schema.TaggedStruct("ok", {shapes: Schema.Array(Shape), value: Schema.Unknown}),
	Schema.TaggedStruct("failed", {at: Schema.Int, why: Schema.String}), // the step that broke
	Schema.TaggedStruct("running", {since: Schema.Finite}), // a slow program has not answered
]);

const Line = Schema.Struct({
	id: Schema.String, // "l-1"
	text: Schema.String, // "board --under 70 | where turn=owner", as typed
	pipe: Schema.Array(Step), // parsed once, when the line is saved
	result: Result,
	seen: Schema.Int, // the last ledger row this result read
});

const Notebook = Schema.Struct({lines: Schema.Array(Line), seen: Schema.Int});
type Notebook = typeof Notebook.Type;
```

```ts
// A sketch. The Msgs, and how a line's result is recomputed.
const Msg = Schema.Union([
	Schema.TaggedStruct("landed", {row: Schema.Int, fact: Fact}), // from the ledger's tail Sub
	Schema.TaggedStruct("answered", {line: Schema.String, row: Schema.Int, result: Result}),
	Schema.TaggedStruct("added", {text: Schema.String}), // a person saved a new line
	Schema.TaggedStruct("removed", {line: Schema.String}),
]);

// update: a fact landed. Every line re-runs on the ledger as of that row.
// The run is a Cmd (tsh runs the pipe), so update stays pure.
const onLanded = (model: Notebook, row: number): [Notebook, Cmd[]] => [
	{...model, seen: row},
	model.lines.map((line) => runLine({line: line.id, pipe: line.pipe, upTo: row})),
];

// update: a line answered. Keep it only if it is newer than what the line shows,
// so a slow run that finishes late never paints over a newer answer.
const onAnswered = (model: Notebook, msg: {line: string; row: number; result: Result}): Notebook => ({
	...model,
	lines: model.lines.map((line) =>
		line.id === msg.line && msg.row > line.seen ? {...line, result: msg.result, seen: msg.row} : line,
	),
});
```

- **The whole line re-runs, from the facts.** Each program is a fold over the
  ledger up to a row, so a result is a pure function of `(pipe, row)`. A guess,
  not measured: a few hundred facts per project fold fast enough. Running only the
  programs that read the new fact's kind is an optimisation for later, once a
  slow line is measured.
- **`upTo` makes a result repeatable.** The same pipe at the same row gives the
  same answer. A line whose answer looks wrong can be re-run at that row.
- **A program that reads outside the ledger** (`log` reads an agent's log) has
  its own Sub. Its line re-runs when that Sub fires, the same way.

## 5. One worked example: "whose turn"

The line is `board --under 70 | where turn=owner`. Four facts are on ticket
#43, under #70.

```ts
// The facts, oldest first (real rows from ticket #43 up to 05:04).
{row: 101, ticket: 43, type: "filed", title: "v1 slice 1: Tickets and the lane facts", body: "…"}
{row: 102, ticket: 43, type: "started", run: "r-1", stage: "build", task: null, log: "slice-1"}
{row: 103, ticket: 43, type: "pr", url: "https://github.com/…/pull/155", state: "open", head: "a1b2c3d", checks: [/* 4 passed */]}
{row: 104, ticket: 43, type: "ended", run: "r-1", stage: "build", outcome: {kind: "ask", who: "owner", for: "review"}, usd: 0, input: 0, output: 0, turns: 0}
{row: 105, ticket: 43, type: "asked", ask: "a-1", what: "review PR #155", picks: ["Yes, PR #155 is good", "Request changes"]}
```

- **Before row 105 lands.** `board` folds each of the 18 tickets under #70 to
  a `Row`. #43 has no open ask yet, so its top line is not "waits on you"
  and its `turn` is not `owner`. `where turn=owner` keeps none.

  ```text
  board --under 70 → Row[] 18 | where turn=owner → Row[] 0
  ```

- **Row 105 lands.** The ledger's tail Sub sends `{_tag: "landed", row: 105}`.
  `update` sets `seen` and asks tsh to run the line at row 105.
- **The run.** `board` folds #43 again. An `asked` with no `answered` makes the
  top line "waits on you: review PR #155"
  ([what a ticket shows](./what-a-ticket-shows.md), section 1), so its turn is
  `owner`. `where` keeps one row.

  ```ts
  {_tag: "answered", line: "l-1", row: 105, result: {
    _tag: "ok",
    shapes: [{type: "Row[]", count: 18}, {type: "Row[]", count: 1}],
    value: [{number: 43, title: "v1 slice 1: Tickets and the lane facts", turn: "owner",
             line: "waits on you: review PR #155", since: "05:04"}],
  }}
  ```

- **What the person sees.** The line's answer changes from empty to one row,
  in place:

  ```text
  $ board --under 70 | where turn=owner
  board --under 70 → Row[] 18 | where turn=owner → Row[] 1
  #43  v1 slice 1: Tickets and the lane facts      waits on you: review PR #155 · since 05:04
  ```

- **Add `| ticket` and the row becomes the whole ticket,** with its two
  buttons. A click writes `answered` on row 106. That lands, the line re-runs,
  and `where turn=owner` gives `Row[] 0` again.

## 6. How others do it, and which model we take

| Tool | A cell or step re-runs when its input changes? | What we take |
|---|---|---|
| [Observable](https://observablehq.com/documentation/cells/observable-javascript) | Yes. A cell that names another re-runs when that one changes, in dependency order. | Live re-run, with no run button. |
| [Jupyter](https://docs.jupyter.org/en/latest/) | No. A person runs each cell by hand, in any order, and hidden state can build up. | Nothing for re-runs. Only the shape: a page of cells, each with its answer below it. |
| [Unix pipes](https://en.wikipedia.org/wiki/Pipeline_(Unix)) | No. A pipe runs once. | Small programs, one job each, joined with `\|`. |
| [PowerShell](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipelines) | No. Runs once. | Objects, not text, go down the pipe; a step that cannot take the input fails. |
| [Nushell](https://www.nushell.sh/book/pipelines.html) | No. Runs once. | Typed, structured values (lists, records, tables) between steps. |

- **We take Observable's model, made simpler.** In Observable a cell's input is
  other cells, so it keeps a graph and re-runs in topological order. In the
  tracker every line's input is the ledger, and lines never name each other.
  So there is no graph: a new fact re-runs every line, in any order, and the
  `upTo` row keeps their answers in step.
- **Why not Jupyter's.** Hand-run cells are the reason Jupyter notebooks drift:
  marimo, a vendor of a reactive notebook, cites a study of GitHub notebooks
  where 36% had been run out of order
  ([marimo](https://marimo.io/blog/lessons-learned)). A tracker that shows a
  stale "whose turn" is worse than none.
- **Why not one line naming another** (Observable's `viewof`, a named cell).
  Not needed yet: each question here starts from the ledger. If a line wants
  another line's answer, that is the moment to add names, and Observable's
  graph is the known way.

## 7. Recommendation

**Make the notebook the tracker's home, with a few starter lines, and keep
the list as one of them.**

- **Why.** The owner asks the same four or five questions every day. A saved
  line answers each in one place, live, with no clicks. Every new question is
  a new small program (`standup`, later `notify`), not a new screen. And it is
  the same tsh an agent already uses, so a person and an agent ask the same
  lines.
- **What it costs.** A notebook program (the machine above), saving lines
  somewhere, and about ten small programs. `board`, `facts` and `ticket` are
  mostly folds the tracker already has (`headOf`, `rowsOf`); the rest are
  small. A line that runs often costs a fold per fact per line; not measured.
- **How sure: 70%.** The doubts:
  - A person has to know the program names. Starter lines may cover the first
    week, or may not.
  - Whether a second person, newer to tsh, finds a notebook home as clear as a
    list.
  - What would settle it: a week of daily use with the starter lines. Count
    how often a saved line is read versus a new line typed, and whether either
    of us goes back to a plain list.

## What it cannot tell us

- The mockup's data is real only up to 05:06 on ticket #43 and PR #155. After
  that it was made up to show movement.
- Whether re-running every line on every fact stays fast with many lines and a
  long ledger. Nothing is measured.
- The cost line has no facts yet: the ledger has no cost facts, so `cost 43`
  shows "not reported".
- Whether lines that read outside the ledger (`log`) feel as live as the rest.

## Open questions

- Where a notebook is saved: on the ledger, or as a file in the repo?
- Are lines shared between two people, or each person's own?
- What a newcomer sees first: which starter lines?
- How a slow program shows it is working: a `running` mark on the step, or a
  spinner on the line?
