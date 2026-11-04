# tea-fabrika domain vocabulary (TERMS)

The repo-owned vocabulary spine, one section per bounded context. When the code and this file
disagree, the code is authoritative and this file is the doc to fix.

This is the project's ubiquitous language, as Domain-Driven Design defines it (Eric Evans), and we
follow it fully ([we follow DDD](../docs/direction/we-follow-ddd.md)). Inside one bounded context a
word has exactly one meaning. The same word may mean something else in another context; the
[context map](#context-map) names the boundary and how the word translates across it. A word with
two meanings inside one context is a bug, listed under [open clashes](#open-clashes) until fixed.

How to read it:

- **A section is one context.** Its first line says what it holds and which paths belong to it.
  The context's name is part of the language: say "the ledger's inbox", not just "inbox".
- **A word gets its row in the context that owns it.** Another context may use it in the same
  meaning without a row of its own. A word that means something else in a second context gets a
  row there too, and a line in the context map.
- **A word in two contexts carries its context in its key,** such as `inbox (ledger)` and
  `inbox (tracker)`. `fabrika glossary check` refuses one key in two sections, so this is how the
  file says it.
- **Two versions live here** (AGENTS.md, "Two versions, side by side"). "Today's" means the code in
  daily use (`packages/`, `programs/`, `packs/`, `apps/`). "`next/`" means the new version, which
  is not on main yet. A word that differs between them says so in its row. A version difference is
  not a clash: it goes when today's code goes.
- **A row cites the note that decides it**, by relative link. A row that rests on a note still in a
  pull request says "(proposed, PR n)", and its word may change when that pull request lands.
- **"Decided Nov 3"** marks a word the owner picked on 2026-11-03, in the walk of this file. The
  year stays out of the rows because `check` reads any four-digit number in a row as a citation of
  a decision record. "Applied in PR 353" means the code still uses the old word until
  [PR 353](https://github.com/usirin/tea-fabrika/pull/353) lands.
- **The Not column** lists old names, wrong names and nearby words a reader may mix it up with.

Add or change a row in the same pull request that coins or renames a word.

## Shared names
The shared kernel: product, package and codenames, and the code keys every context uses. Each
means one thing everywhere. Paths: every `package.json` name.

| Term | Definition | Not |
|---|---|---|
| demlik | The repo that holds tea, and the first real repo lanes ran on. [demlik is the first real repo](../docs/direction/demlik-is-the-first-real-repo.md) | |
| fabrika | The product: project management where code holds the loop and an agent does one bounded job inside it. In `next/`, `@kampus/fabrika` is the app and `@kampus/libfabrika` the library. The only name people see. [Control lives in code](../docs/direction/control-in-code.md), [where each piece lives](../docs/direction/where-each-piece-lives.md) | Not `@kampus/fabrika-old`, today's library. |
| fabrika.toml | The settings file: `.fabrika/fabrika.toml` for a repo, `~/.fabrika/fabrika.toml` for a person. Knobs only; the step order stays in code. An unknown key fails. [One fabrika.toml per repo](../docs/direction/one-fabrika-toml-per-repo.md) | Not `ledger.json` or `tsh.toml`, which it replaces. |
| fabsh | `next/`'s shell, a regular program with local echo. [The desktop layer](../docs/direction/the-desktop-layer.md) | Not `tsh`, which stays in today's version. |
| Jev | A cheap model service that answers one narrow question (the Judge move). Measured by how often it agrees with the big model, never trusted to remove a person. [Jev](../docs/direction/jev-same-answer-cheaper.md) | Not an agent: it does no open-ended work. |
| Manager (service) | An Effect service that holds many of one thing is named `<Thing>Manager`: `LeaseManager`, `ProcessManager`, `LimitManager`. A service name is never plural. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D6) | Not a plural service name such as `Leases`. |
| Manti | Manti UI (`@manti-ui/react`, `@manti-ui/styles`): the component library every part of the app's UI is built on, with our own tokens. A better way goes into Manti by pull request. [UI on Manti](../docs/direction/ui-on-manti.md) | Never "Manti or native". |
| pack | An add-on: programs in a package, turned on by one `[pack.<name>]` line in `fabrika.toml` and pinned in `.fabrika/fabrika.lock`. The core never knows it exists. Industry: a plugin. [Packs are programs](../docs/direction/packs-are-programs.md) | Not a "catalog": that word was dropped. |
| _tag | The case key of every union we define, written by Effect Schema (`TaggedUnion`, `TaggedStruct`, `TaggedError`), never by hand. [Schema classes](../docs/direction/schema-classes-not-of-helpers.md) | Not `kind`, which today's entries and outcomes keep. Not `type`, which tea's Msgs and Cmds keep. |
| tea | `@demlik/tea`: the Elm architecture in TypeScript (machines, Msgs, Cmds, Subs), run on its Effect engine. The engine under every program; it stays small and does not grow to fit a host. [tea is the engine](../docs/direction/tea-is-the-engine.md), [Elm first](../docs/direction/elm-first.md) | Not Effect `Workflow` or an actor runtime, both banned as a machine's replacement. |
| tezgah | (decided Nov 3) Codename for the desk, Tuval's window manager, as Mutter is GNOME's and KWin is KDE's. Turkish for workbench, and loom. `next/`'s program `fabrika/tezgah` (Tier 2, not built). Today's code keeps `desk` until it goes. People see "fabrika". | Not a name shown to people. Not the desktop: that is Tuval. |
| tsh | Today's shell: a Unix-style shell that runs only tea programs, joined by typed pipes. [tsh](../docs/direction/tsh-a-shell-for-tea-programs.md) | Not `fabsh`, `next/`'s shell. |
| Tuval | Codename for the desktop layer, layer 5: the desktop environment, as GNOME or KDE. In `next/`, the `@kampus/tuval` package. People see "fabrika". [The desktop layer](../docs/direction/the-desktop-layer.md) | Not a name shown to people. Not its window manager, tezgah. |

## Records
The project as a lab notebook: what was decided, measured and seen, and the words for the work
itself. Paths: `docs/`, `experiments/`, `field/`, `replay/`, `singles/`.

| Term | Definition | Not |
|---|---|---|
| agent hour | The unit of size: one agent's wall clock, summed, failed runs in, drivers out. A ticket's `estimate` uses a doubling scale from 0.25 to 8; its `spent` is folded from run facts, never typed. [Agent hours](../docs/direction/agent-hours.md) | Not human days. |
| agent run | One agent session, logged as one row in `field/runs.jsonl`. [Field](../field/README.md) | Not a program's run (Runtime). See the context map. |
| direction note | One decision in `docs/direction/`, marked decided or proposed. Industry: an architecture decision record. [Direction](../docs/direction/README.md) | Not an experiment: a note decides, an experiment measures. |
| experiment | A numbered measurement: `experiments/NN-title.md` and its script. It records what was tried and what came back. [Experiments](../experiments/README.md) | Not a decision. Not the `experiment` program, which shows one. |
| field log | `field/runs.jsonl` and `field/notes.jsonl`: one row per agent run on a real ticket, one note per thing that broke, cost too much, needed a person or worked well. [Field](../field/README.md) | |
| next/ | The new version of fabrika, built on the five layers and on the notes in `docs/direction/`, never on today's code. Not on main yet ([PR 223](https://github.com/usirin/tea-fabrika/pull/223)). [Clean slate](../docs/direction/clean-slate.md) | Not today's version. A name that exists in both may mean different things: check the path. |
| owner | The person who sets direction, approves plans and is the only one who changes the exam. [Nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md) | Not "the user" in a note about who decides. |
| tier | One whole slice of `next/` a person can use, built in order. Tier 1 is the first. [The tiers](../docs/plan/tiers.md) | Not a priority level: fabrika has no priority. |
| today's version | Everything outside `next/` (`packages/`, `programs/`, `packs/`, `apps/`, `wip`, `legacy`): the fabrika in daily use until `next/` takes each job over. Its library is `@kampus/fabrika-old`, its app `@kampus/fabrika-app-old`. [Clean slate](../docs/direction/clean-slate.md) | Not `@kampus/fabrika`, which in `next/` is the new app. |

## Tracker
Project management as a person sees it: tickets, plans, asks and the inbox. Paths:
`programs/tracker`, `programs/ticket`, `packs/owner-desk`, `packs/ask-log`, and `next/`'s
tracker.

| Term | Definition | Not |
|---|---|---|
| area | (proposed, experiment 205, [PR 361](https://github.com/usirin/tea-fabrika/pull/361)) A long-lived grouping of tickets by part of the product or the code, which never ends, as Jira's components or Kubernetes' `area/` labels. Waits for that experiment's designs. See Open clashes. | Not a project, which ends. Not a label that gates a build. |
| ask | A question the machine puts to a person, for a decision or an act, never for a fact. It is the `asked` and `answered` facts, with a hash of what the person saw; the first answer wins. Also the stage verb `ask`. [Ask for decisions, not facts](../docs/direction/ask-for-decisions-not-facts.md), [one ask and one meter](../docs/direction/one-ask-and-one-meter.md) | Not the close question (`close t2? (y/n)`). Not "popup". |
| criterion | A promise a reviewer reads, which ends with the ticket. Open or met; a builder may not shrink one, and "cannot meet as written" is its honest exit. [Done is per criterion](../docs/direction/done-is-per-criterion.md), [the plan stage](../docs/direction/the-plan-stage.md) | Not a property, which a tool checks and which lasts. |
| inbox (tracker) | A person's list of things waiting, as Linear's Inbox: the open asks first. The owner's desk is the inbox, and so is the owner-desk pack. The program that shows it is `inbox` (decided Nov 3): a tile beside the selected ask, and a glance in the top bar. Today the list is the frame's menu, not a program; in `next/` the program comes in Tier 5. [The ask desk](../docs/direction/ask-desk.md), [every wait is a queue](../docs/direction/every-wait-is-a-queue.md) | Not `asks`, the program's old name: G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) still says no lean (keep `asks` 45%, `questions` 25%, `decisions` 20%, `waiting` 10%) and ruled "inbox" out; this walk picked `inbox`. Not "the ask desk", the note's title. Not the ledger's inbox stream: see the context map. |
| judgment | A decision only a person can make. It is the only thing the pipeline asks a person for; everything else code fixes, retries or prevents. [Jidoka and andon](../docs/direction/jidoka-and-andon.md), [pipeline guidelines](../docs/direction/pipeline-guidelines.md) | |
| plan | The plan step's answer for one ticket: tasks, criteria and properties, approved by the owner by version and a hash of the ticket's text. An epic is a plan with many tasks. [The plan stage](../docs/direction/the-plan-stage.md), [a free-form plan goes to the planner](../docs/direction/free-form-plan-to-planner.md) | |
| project | A parent plan: a group of tickets, as in Linear ([a project is a parent plan](../docs/direction/a-project-is-a-parent-plan.md)). Experiment 205 ([PR 361](https://github.com/usirin/tea-fabrika/pull/361)) proposes a project as a grouping that ends, beside an area that does not. See Open clashes. | Not the ledger's project object: see the context map. Not a repo, though today one host and one Worker run per project. |
| property | A promise a tool checks, kept as a test after the ticket ends: `{when, result, why, behavior, tool, stories, code}`, id `p<n>`. [The plan stage](../docs/direction/the-plan-stage.md) | Not "promise", the older note's word. Not a criterion. |
| rec | The step's recommendation on an ask, written before the ask, with its why, cost and how sure. `y` takes it, `n` refuses it with a note. [The ask desk](../docs/direction/ask-desk.md) | |
| Status | (decided Nov 3, applied in PR 353) The one line at the top of a ticket: what a person must do, if anything, as Linear's status. [Tracker views are programs](../docs/direction/tracker-views-are-programs.md) (proposed) | Not `Glance`, the code's word until PR 353 lands. Not the frame's glance. |
| ticket | One unit of work in the tracker. Its facts live on the ledger and its state is their fold. One ticket, one pull request. Industry: issue. [The ticket is the lane view](../docs/direction/the-ticket-is-the-lane-view.md) | Not a GitHub issue: see the context map. |
| timeline | A ticket's facts in order, comments included, one row per fact. The main view for people and the main context for agents. [What a ticket shows](../docs/direction/what-a-ticket-shows.md) | |
| tracker | fabrika's own issue tracker, built like Linear. Tickets are ledger facts; GitHub stays the code host, reached through `CodeHost`. Also today's `tracker` program. [Tickets start in our tracker](../docs/direction/tickets-start-in-our-tracker.md), [the tracker is like Linear](../docs/direction/the-tracker-is-like-linear.md) | Not GitHub Issues: no ticket copy goes there. |
| tracker view | One way to see tickets (one ticket, a board, a list), each its own small tea program that folds the ledger. [Tracker views are programs](../docs/direction/tracker-views-are-programs.md) (proposed) | Not a program's view, what it draws (Runtime). See the context map. |

## Pipeline
The steps a ticket goes through from filed to merged, and the rules that hold them. Paths:
`packages/pipeline`, `programs/pipeline`.

| Term | Definition | Not |
|---|---|---|
| agent | A model doing one bounded job inside code's loop. No agent approves a pull request or answers a question put to a person. [Control lives in code](../docs/direction/control-in-code.md) | Not Jev, which answers one narrow question. In `next/` an agent is also a client: see the context map. |
| box | The sandbox a program runs in: the `Sandbox` service, with a layer per box (Docker, sandbox-runtime, none). No real key goes in. [Programs run in a box](../docs/direction/programs-run-in-a-box.md) | |
| build | The step where an agent writes code until every check is green. It ends with a local commit and pushes nothing. [Nothing is pushed before review](../docs/direction/push-after-review.md) | |
| combo | A shape built from moves that keeps coming back: refine, gate, ask, remember, spawn (`packages/pipeline/src/combos.ts`). No new move without a reason. [Reuse before special rules](../docs/direction/reuse-before-special-rules.md), [new combos](../docs/direction/new-combos.md) | |
| exam | What code is checked against: a machine's laws, the checker, a ticket's criteria, CI and lint rules. An agent that writes code never changes it; the owner does, in its own pull request (the `exam` steps). [Nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md) | |
| finding | One thing a reviewer, a mutant or a scheduled job found. A person rates it `fix` or `noise`; one never rated counts as noise once its change ships. Industry: a SARIF result. [Every finding is rated](../docs/direction/every-finding-is-rated.md) | |
| helper | A small agent a stage asks for a fact it lacks, never another stage. Also called a scout. [Helpers, and one supervisor](../docs/direction/helpers-and-the-supervisor.md) | Not a supervisor: fabrika has none, the host starts and restarts runs. |
| kept, glance, stale | How a review verdict or a person's yes carries to a new head: `kept` (same head, a clean replay or a format-only change), `glance` (only the patch-id matches), `stale` (otherwise). [A yes binds to the diff](../docs/direction/a-yes-binds-to-the-diff.md) (proposed) | This `glance` is not the frame's glance: see the context map. |
| lane | One ticket's run through the pipeline on its assignee's host, claimed on the ledger. Today's parent machine `lane` steps each step in turn. [A ticket runs from the app](../docs/direction/a-ticket-runs-from-the-app.md) | Not the ephemeral lane (Clients): see the context map. |
| laws | A machine's rules, which a checker walks through every message order of its real reducer. A machine with no laws, or a message never sent, fails the suite. [Every machine has laws](../docs/direction/every-machine-has-laws.md) | |
| move | One of the six building blocks of every step: Gather (code reads), Act (code writes), Listen (code waits), Draft (an agent produces), Check (code judges), Judge (Jev answers one narrow question). `packages/pipeline/src/primitives.ts`. | The file says primitives; the notes say moves. See Open clashes. |
| mutation | The `mutation` step: Stryker makes small breaks (mutants) the tests must catch. In the `mutants` step each survivor gets `test`, `cannot` or `noise`. [A fast check per pull request](../docs/direction/fast-and-daily-mutation.md) | Not our own search engine: Stryker is the grader. |
| outcome | How a stage ends, in five verbs: `done`, `send`, `ask`, `skip`, `stuck`. Passing it on is `verb:who:why`, ending here is `verb:why`. [Outcome names](../docs/direction/outcome-names.md) | |
| pipeline | The steps a ticket goes through from filed to merged, each run by its own agent, with laws. Every pull request goes through it. Also the package `@kampus/pipeline` and today's `pipeline` program, named for what they hold. [Every pull request goes through the steps](../docs/direction/next-is-a-pipeline-pre-run.md) | G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) flags the `pipeline` program's name: it also means the package and the whole chain. |
| resume point | Today's `Resume` (`packages/pipeline/src/stages/pipeline/machine.ts`): where a stopped lane goes on, `{_tag: "run", step}` or `{_tag: "ask", for, step}`. A restart keeps finished steps and never starts over. | Its `run` is "run this step", not an agent run. See Open clashes. |
| review | One review of the whole diff, by a different agent from the builder. The reviewer only finds; code works out pass or fail. [Nobody grades their own work](../docs/direction/nobody-grades-their-own-work.md), [one review a plan](../docs/direction/one-review-a-plan-and-the-cloud-in-v1.md) | Not an approval: no agent approves a pull request. |
| run (pipeline) | Two live meanings here: an agent run a step starts (Records), and the resume point's `_tag: "run"`, "run this step". See Open clashes. | Not a program's run (Runtime). |
| ship | The merge: today's ship code, the one merge authority. A person's comment goes to that person, a bot's back to the builder. [Ship stage rules](../docs/direction/ship-stage-rules.md) | Not a merge by hand, and never auto-merge. |
| stage | A step seen as its own machine, which answers in the five outcome verbs. Notes and code use stage and step for one thing: a fact's `stage` holds a lane step (`packages/pipeline/src/stages/pipeline/restart.ts`). [One parent, stages as slots](../docs/direction/one-parent-stages-as-slots.md) | Not a separate thing from a step. See Open clashes. |
| step | One place in a lane, in this order: `triage`, `plan`, `exam`, `exam_review`, `exam_merge`, `test_writer`, `build`, `mutation`, `mutants`, `review`, `push`, `merge` (`STEPS`, `packages/pipeline/src/stages/pipeline/routes.ts`). | Today's code uses "stage" for the same thing in places (`fact.stage`). |
| stop | Where a lane halts itself, with its reason, on what code cannot fix (Toyota's andon). Every stop saves where the lane goes on; a person's `stop` is a saved pause. [Jidoka and andon](../docs/direction/jidoka-and-andon.md) | Not the `stuck` verb alone. Not tsh's built-in `stop` (Runtime). |
| test writer | The agent that writes one test per property after the owner's approval, red first for a new one, and answers each surviving mutant. [The test writer](../docs/direction/the-test-writer.md) | Not "verify writer", its old name. Not the builder. |
| triage | The first step. It answers duplicate, decline, accept or escalate, and asks the owner when worth is unclear. No priority and no "later". [Sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md), [triage asks when worth is unclear](../docs/direction/triage-asks-when-worth-is-unclear.md) | Not "sort", its old name. |

## Runtime
Programs, the machines inside them, and what runs them: today's tea-program and tea-host, and
`next/`'s app layer (layer 4). Paths: `packages/fabrika` (host, tea-program), `programs/*`, tsh.

| Term | Definition | Not |
|---|---|---|
| Cmd | A request for an effect, with typed `input`, `ok` and `err`, defined through a move or tea's `Cmd.define`. Elm's Cmd. | |
| commands | A program's `commands` field: each a Msg with its keys, and each also a tsh word and a palette row. [Modes](../docs/direction/modes.md), [keybindings are configurable](../docs/direction/keybindings-are-configurable.md) | |
| host (runtime) | Today's: a running process that runs tea programs, OTP's node. [tea-host](../docs/direction/tea-host.md) | Not `next/`'s host, a place hands run (Clients): see the context map. Not a client. |
| input | What a program is told while it runs, like stdin. Told at any time, never waiting, served in order through the run's one mailbox. One input per command, apart from the one `query` (CQRS). [tea-program](../docs/direction/tea-program.md), [tracker views are programs](../docs/direction/tracker-views-are-programs.md) | |
| job | What one start made: a root and everything under it, like a process group (a tsh line, a lane). The host's, not the shell's. [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md), [the host keeps terminals and jobs](../docs/direction/the-host-keeps-terminals-and-jobs.md) | Not the hands' job, work taken from a queue (Clients): see the context map. |
| JobRecord | One Durable Object per job: its runs' storage, its spans from every host, and pointers to agent logs. Nothing is ever deleted except agent content a person removes. [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md) | Not Jaeger, which it replaced. |
| location | (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) Where a program is now, read from its tile's own machine and named for its program (`AsksLocation`). Opening the same location focuses its tile. | Not `at`, its old name: `at` is a time. |
| machine | A tea state machine: a model, the Msgs its `update` takes, and the Cmds it asks for. Parents are written by hand and step their children. [Elm first](../docs/direction/elm-first.md) | Not a program. Not a computer: that is a host. |
| mailbox | Today's: a run's one queue of inputs, served one handler at a time; past its capacity a `tell` fails `MailboxFull`. OTP's word. [tea-program](../docs/direction/tea-program.md) | Not the ledger's inbox stream. Not `next/`'s `Mailbox` service (Ledger): see the context map. |
| mode | A program's state that changes what keys do, per tile, always shown in words; Escape always leaves. No mode is `null`. [Modes](../docs/direction/modes.md) | The note says "per window", the old word for a tile. |
| Msg | A message a machine's `update` takes. tea's Msgs keep `type` as their tag. | Not `_tag`, which is for unions we define. |
| output | An event a program sends: heard once, kept nowhere. What a late viewer needs is a machine's state. [tea-program](../docs/direction/tea-program.md) | Not a Cmd: an output has no answer. |
| pipe | `from \| to`: one program's outputs fed to the next one's typed inputs. An `anyInput` takes the source's first output. [tea-program](../docs/direction/tea-program.md), [an input can take anything](../docs/direction/an-input-can-take-anything.md) | |
| process | `next/`: one running copy of a program, with its own pid, in its own object. [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) (A3) | Today's code calls this a run. |
| program | What you start: a name, flags, inputs, outputs, and `main`, which runs tea machines (`defineProgram`). It uses machines and is not one. [tea-program](../docs/direction/tea-program.md) | Not a machine. Not a process, which is one running copy. |
| program name | The word a person types in the shell, reads in the title bar and hears first in a tile's accessible name: `ticket #7`. G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)): a noun for what the tile shows, plural for a list; 2 to 9 small letters; one meaning; a phrase is written from the noun. [Tile guidelines](../docs/direction/tile-guidelines.md) | |
| run | Today's `tea-program`: one start of a program, with a run handle and one span. In `next/` it is a process. [tea-program](../docs/direction/tea-program.md) | Not an agent run (Records). Not the resume point's `run` (Pipeline). See the context map. |
| trace | A job's spans, in OpenTelemetry's words, and the `trace` program that draws them. An agent run keeps its content in the trace. [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md), [an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md) | |
| tsh line | What a person types in the shell: programs joined by pipes, such as `tracker \| ticket \| trace`. The top bar's "the line" shows it. A line's windows are its tiles (decided Nov 3, applied in PR 353). | Not the status bar, the prefix line or the toolbar. |
| view | What a program draws: data picked from its state by a pure `select`, drawn by its view code. Elm's word. On the window protocol a view has a revision, `rev`, and a window Msg names the one it saw as `saw` (A3). Decided Nov 3, applied in PR 353: a program's drawing is its view, never its window. [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) (A3) | Not "window". Not a tracker view (Tracker): see the context map. |

## Ledger
The record and the coordination built on it: one append-only log per project, its streams,
claims and leases. Layers 2 and 3 of `next/`, and today's `Ledger` service. Paths:
`packages/fabrika` (the `Ledger` service), `packages/ledger-server`.

| Term | Definition | Not |
|---|---|---|
| at | The referee's clock on an entry. Leases, limits and order use only this. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D3) | Not a place: that is `location`. Not the writer's clock: that is `said`. |
| by | Who wrote an entry, stamped by the door from the signed-in key, never typed by the writer. | |
| claim | "This work is mine": a compare-and-set on the ledger with a lease, so two agents never spend money twice on one ticket. The ledger records only when a claim changes hands. [The five layers](../docs/direction/a-local-first-sync-engine.md) (C3) | |
| entry | One line of the ledger. In `next/` (D3): `id`, `stream`, `pos` (place in its stream), `rev` (place in the whole log), `at`, `by`, `said`, `_tag`, `body`, EventStoreDB's fields in short words. [The five layers](../docs/direction/a-local-first-sync-engine.md) | Today's entries say `kind` for `_tag`, and swap `pos` and `rev`. |
| fact | One ledger entry about something that happened (`filed`, `asked`, `claimed`). Kept for good; state is a fold of facts. Industry: an event. [Data first; markdown is a view](../docs/direction/data-first-markdown-is-a-view.md) | Not markdown: markdown is made from facts and never read back. |
| fold (of facts) | State worked out from facts in order, as a reducer over an event log. A ticket's status is a fold; done is a merged pull request or a person's close, never a drag. | Not folding a tile (Frame): see the context map. |
| inbox (ledger) | A stream others write to, the one open door to a name: `build:7/inbox`, and a ticket's write inbox, `tracker/ticket/43/inbox`. The transactional inbox pattern. [The five layers](../docs/direction/a-local-first-sync-engine.md) (C2) | Not the tracker's inbox, a person's list: see the context map. Not a mailbox. |
| lease | A claim that lasts 30 s and is renewed every 10 s. An old holder stays valid until a newer claim exists (Kafka's epoch rule). `LeaseManager`: claim, renew, release. [The five layers](../docs/direction/a-local-first-sync-engine.md) (C3) | |
| ledger | The record: one append-only log per project, with named streams inside it, and three calls (`append`, `read`, `wait`). Today's `Ledger` service mixes all three lower layers; `next/` splits it. [The ledger behind a service](../docs/direction/ledger-behind-a-service.md), [the five layers](../docs/direction/a-local-first-sync-engine.md) | Not a table of rows that are overwritten. |
| Mailbox (service) | `next/`: the coordination service with `send` and `receive`, OTP's word, in one Layer with `Registry`, `LeaseManager` and `ProcessManager`. [The five layers](../docs/direction/a-local-first-sync-engine.md) | Not today's mailbox, a run's queue of inputs (Runtime): see the context map. |
| poke | "Come read": the brain sends `ledger.appended` with `{rev, streams}`, at most once, and the client pulls after the last rev it has. Replicache's word. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D4) | |
| project object | `next/`: the one shared Durable Object that holds a team's ledger, claims, inboxes and process tree, and is its referee. [The five layers](../docs/direction/a-local-first-sync-engine.md) | Not a tracker project, a parent plan: see the context map. |
| referee | The one object that orders writes and grants leases: the project's Durable Object, one call at a time. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D1) | |
| rev | `next/` (D3): an entry's place in the whole log, beside `pos`, its place in its stream. Today's ledger swaps the two: `rev` is the place in its stream and `pos` the place in the whole log (`packages/fabrika/src/host/memory.ts`). Check the path before you trust it. | Not a git revision. Not the same number in both versions. Not a view's revision (Runtime): see the context map. |
| said | The writer's own clock on an entry: shown, never used to decide, and kept out of the deciding code's types. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D3) | Not `at`. |
| saw | On an answer to an ask, the hash of what the person saw (`packages/pipeline/src/combos.ts`). | Not `seen`. Not a window Msg's `saw`, a view revision (Runtime): see the context map. |
| seen | The last rev an entry's writer had folded when it wrote. [Saved state](../docs/direction/saved-state.md) | Not `saw`. |
| stream | A named part of the log, such as `build:7` or `desk`. A name owns `build:7`, `build:7/inbox` and `build:7/dead`; claims and inboxes are streams too. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D2) | |

## Clients
`next/`'s wiring: where programs run, who dials in, and how. Layer 1 (transport) and the four
words of [brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md). Paths:
`next/` only, not on main.

| Term | Definition | Not |
|---|---|---|
| brain | `next/`: where programs run and keep their state, on workerd everywhere, the laptop included. [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) | Not "runner". Where an older note says host for this, read brain. |
| capabilities | What a host can do, sent in the hello as `has`; a Cmd says what it `needs`. A capability says "can", never "may": may is a grant on the ledger. MCP's word. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | |
| client | Any of hands, a window or an agent, and only when talking about the door's protocol. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not "peer" and not "node", both gone. |
| door | Where every client comes in. It stamps each entry's `by` from the signed-in key. [The ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md) | |
| ephemeral lane | `next/`: an at-most-once channel on the same transport, for pokes, presence and terminal bytes. Show it, never save it, never decide with it. [The five layers](../docs/direction/a-local-first-sync-engine.md) | Not a lane, a ticket's run (Pipeline): see the context map. |
| five layers | `next/`'s design, bottom to top: transport (one WebSocket per client to its own gateway, JSON-RPC 2.0), data (the ledger), coordination (claims, inboxes, the process tree, who is online), app (programs, Cmds, windows, limits, packs), desktop (Tuval). Each uses only the one below. [A local-first sync engine](../docs/direction/a-local-first-sync-engine.md) | Not "link layer" for transport, not "nodes" for coordination. |
| gateway | One object per client, which the client dials and which answers its text ping. Hands meet only through the brain, gateway to gateway. [The five layers](../docs/direction/a-local-first-sync-engine.md) (T2) | |
| hands | `next/`: what takes jobs from the queue, with a lease, and acts on one computer. Node runs only the hands. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not a place: hands are a job, and a host is where they run. |
| host (clients) | `next/`: a place hands can run, such as a Mac, a VM or a browser profile. The brain on Cloudflare is not called a host. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not today's host, a process that runs programs (Runtime): see the context map. Not a client: a host is where things run, a client is what dials. |
| job (clients) | `next/`: work the hands take from the queue, with a lease. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not today's job, what one start made (Runtime): see the context map. |

## Frame
The window and everything in it a person sees around a program's view: the desk and its tiles,
the bars, what opens over the desk, and the desktop layer. Paths: `apps/fabrika`,
`@kampus/fabrika-design`, and `next/`'s Tuval.

| Term | Definition | Not |
|---|---|---|
| accessible name | What a screen reader hears entering a tile: `tracker, t2, pipe A, 1 of 2, sends to ticket`. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not "the region's name" (proposed, [PR 353](https://github.com/usirin/tea-fabrika/pull/353)). Not the program name. |
| close question | `close t2? (y/n)`, asked on the status bar and in the tile's title bar. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not an ask. [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes "question marker" for the tile guidelines' "asking marker" (75%). |
| container | A row or a column of tiles; nested ones alternate, as in AeroSpace. [Fold, not tabs](../docs/direction/fold-not-tabs.md) | Not a Docker container, and never tabs. |
| desk | Every workspace, its layout and its focus, as one machine: Tuval's window manager, codename tezgah (decided Nov 3). Today's code keeps `desk` (`apps/fabrika/src/desk/desk.ts`) until it goes. In `next/` its program is `fabrika/tezgah` (Tier 2, not built), which the notes called `fabrika/desk`. [The desktop layer](../docs/direction/the-desktop-layer.md) | Not the desktop, layer 5. Not the ask desk, which is the inbox program. Not the owner's desk, which is the inbox (Tracker). |
| desktop | Only layer 5, Tuval: the desktop environment, as GNOME or KDE. Its window manager, the desk, places tiles, owns focus and routes keys, on the app layer's window protocol. [The desktop layer](../docs/direction/the-desktop-layer.md) | Not the desk. |
| fold (tile) | `C-b f` folds a tile into a thin strip that keeps its place; a click opens it. The last open tile cannot fold. [Fold, not tabs](../docs/direction/fold-not-tabs.md) | Not a fold of facts (Ledger). Not tabs. |
| frame | (decided Nov 3, applied in PR 353) Everything the app draws that is not a program's view: the bars, each tile's title bar, edge, strips and gaps, and what opens over the desk. | Not "chassis", the code's word until PR 353 lands. |
| glance | `next/`: a program's small view in the top bar's popover; the inbox list is the inbox program's glance. Glance keeps this meaning (decided Nov 3). [The ask desk](../docs/direction/ask-desk.md) | Not the tracker's `Glance`, which is `Status` (decided Nov 3, applied in PR 353). Not the pipeline's verdict `glance`: see the context map. |
| key hints | (decided Nov 3, applied in PR 353) Words that name keys but cannot be pressed. | Not the toolbar, whose buttons press. |
| menu | A popover whose rows each do something: the inbox list, the jobs list. "Menu" when each row acts (decided Nov 3, applied in PR 353). [Popovers](../docs/direction/popovers.md) | Not "popup". |
| menu bar | `next/`: the app's icon in macOS's menu bar, with its rows (approve a tab, quit). [The desktop layer](../docs/direction/the-desktop-layer.md) | [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes "menu bar extra", Apple's word (80%): on macOS the menu bar is the system's bar. |
| palette | Cmd-K: every command by name, grouped, with its tsh word and keys. VS Code's Command Palette. [Popovers](../docs/direction/popovers.md) | |
| popover | A raised box of rows in the views' font. Focus moves in; Escape closes it and puts focus back. Apple's and HTML's word. Popover for the box, menu when each row acts (decided Nov 3, applied in PR 353). [Popovers](../docs/direction/popovers.md) | Not "popup", which stays only as ARIA's `aria-haspopup`. |
| prefix | `C-b`, pressed before a desk key, as in tmux. Each window runs it itself. After it the status bar shows the prefix line. [The desktop layer](../docs/direction/the-desktop-layer.md) (W5) | |
| resize gap | The 4px between two open tiles, dragged to resize. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not `.border`, the code's name, which [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes renaming. Not the edge. |
| status bar | (decided Nov 3, applied in PR 353) The one line under the desk: where you are, and the key you just pressed. Stays monospace. [Popovers](../docs/direction/popovers.md), [tile guidelines](../docs/direction/tile-guidelines.md) | Not "bottom line", the code's word until PR 353 lands. Not "status line" (a machine's line). Not "footer", which is only a popover's last row. |
| text style | One of six: `title`, `heading`, `strong`, `body`, `quiet`, `label`. Every size comes from one. [Typography](../docs/direction/typography.md) | Not "text role", the study's first word. |
| tile | One rectangle of the desk; it shows one process. tmux says pane. A line's windows are its tiles (decided Nov 3, applied in PR 353). [Tile guidelines](../docs/direction/tile-guidelines.md), [the desktop layer](../docs/direction/the-desktop-layer.md) (W3) | Not "window". |
| title bar | A tile's own bar: slot, program name, state word, tile id. A mono `header`. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not the top bar. |
| toolbar | (decided Nov 3, applied in PR 353) A row of buttons built from a program's `commands`, each with its key printed on it, `role="toolbar"`. | Not "action bar" or "keys line", which it replaces. Not key hints. |
| top bar | The bar across the top: the workspace list, the line, the app's icon and name, then the items. Stays monospace. [Popovers](../docs/direction/popovers.md), [top bar name](../docs/direction/top-bar-name.md) | |
| window | (decided Nov 3, applied in PR 353) The app's OS window, and in `next/` the client that draws it and sends a person's keys; the two agree. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not a program's drawing, which is its view. Not a tile of a tsh line. Not "peer". |
| workspace | One numbered layout inside the desk, with one focused tile. i3's word. [The desktop layer](../docs/direction/the-desktop-layer.md) (W4) | |

## Context map

How the contexts talk, and how each word that crosses a border translates. The map is Evans's:
"Describe the points of contact between the models, outlining explicit translation for any
communication" (DDD Reference). His relationship names are used only where they fit.

How the contexts meet:

- **Shared names are a shared kernel.** Small, used by every context, changed only in a pull
  request that changes this file too.
- **Ledger supplies, the rest are its customers** (customer/supplier). Tracker, pipeline and
  runtime write facts and fold them; the ledger gives them three calls: `append`, `read`, `wait`.
- **Pipeline and tracker are partners.** A lane is one ticket's run, and the ticket is the lane's
  view. The pipeline asks; the tracker's inbox shows the ask. Neither owns the other's words.
- **GitHub sits behind an anticorruption layer,** `CodeHost`. GitHub's issue, review and check run
  are translated there; none of their words leaks in as ours.
- **Runtime and frame speak a published language,** the window protocol (`next/`, A3): a view,
  its `rev`, and Msgs that name the `rev` they saw.
- **Clients reach the brain through an open-host service,** the door: JSON-RPC 2.0 over one
  WebSocket per client. Any client that speaks it may dial.
- **Records talk about every context** and translate nothing. A record says which context and
  which version a claim is about.

Each word that crosses a border, one line each:

- **inbox:** the ledger's inbox is a stream a write comes in by (`build:7/inbox`); the tracker's
  inbox is the list a person reads. An ask crosses as `asked` and `answered` facts, never as the
  word. Decided Nov 3.
- **host:** the runtime's host is today's process that runs programs; the clients' host is
  `next/`'s place where hands run. They never meet in one version. Check the path.
- **lane:** the pipeline's lane is a ticket's run; the clients' ephemeral lane is an at-most-once
  channel. Always write "ephemeral lane" in full; a bare "lane" is the pipeline's.
- **project:** the tracker's project is a parent plan; the ledger's project object is the Durable
  Object that holds a team's ledger; a tracker project's tickets are facts on that ledger. In the
  ledger context, say "project object".
- **run:** the runtime's run is one start of a program (`next/`: a process); the records' agent
  run is one agent session. When agents become programs (proposed, [agents are
  programs](../docs/direction/agents-are-programs.md)), an agent run is one run of the `claude` or
  `codex` program.
- **job:** the runtime's job is a root and everything under it; the clients' job is work the
  hands take with a lease. The notes do not yet say whether one is a case of the other.
- **mailbox:** the runtime's mailbox is a run's queue of inputs; the ledger's `Mailbox` is
  `next/`'s service that sends and receives. Both are OTP's mailbox, at two layers.
- **glance:** the frame's glance is a program's small view in the top bar; the pipeline's
  `glance` is a verdict that carries when only the patch-id matches. The tracker's `Glance` is `Status` (decided Nov 3, applied in PR 353).
- **fold:** the ledger's fold is state worked out from facts; the frame's fold is a tile folded
  to a strip. Write "fold of facts" or "fold a tile".
- **view:** the runtime's view is what a program draws; the tracker view is one way to see
  tickets, and it is a program, so it has a view of its own.
- **rev and saw:** in the ledger, `rev` is an entry's place and `saw` the hash on an answer; on
  the window protocol, `rev` is a view's revision and `saw` the one a Msg saw.
- **window and agent:** one thing seen from two sides. The frame's window and the pipeline's
  agent are, at the door, two kinds of client.
- **desk:** the frame's desk is the window manager (tezgah); "the owner's desk" is the tracker's
  inbox, and "the ask desk" is the inbox program (decided Nov 3).
- **ticket:** our ticket is never a GitHub issue. `CodeHost` reaches pull requests, checks and
  the merge queue; no ticket copy goes to GitHub Issues.
- **stop:** the pipeline's stop is a lane halting itself; tsh's built-in `stop` (runtime) is a shell
  word, not a lane's halt.

## Open clashes

Only a word with two meanings, or one meaning with two words, inside one context. Each line says
what would settle it.

- **run, in the pipeline.** An agent run a step starts, and the resume point's `_tag: "run"`
  ("run this step"). Settles when the restart work picks a tag that is not a noun already in use.
- **project, in the tracker.** A parent plan (decided), and experiment 205's grouping that ends,
  with an area beside it that does not. Settles with that experiment's designs
  ([PR 361](https://github.com/usirin/tea-fabrika/pull/361)), which must say whether the two are
  one.
- **stage and step, in the pipeline.** Two words for one thing; today's `fact.stage` holds a
  step. Settles when one word is picked and the code renamed.
- **move and primitive, in the pipeline.** Two words for one thing: the notes say moves, the code
  says primitives. Settles with the naming sweep's pick.
