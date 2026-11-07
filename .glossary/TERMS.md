# tea-fabrika domain vocabulary (TERMS)

The words of `next/`, the new version, one section per bounded context. They come from the decided
notes in `docs/direction/`, which is what `next/` follows. `next/` itself is not on main yet: it is
on [PR 223](https://github.com/usirin/tea-fabrika/pull/223). When a decided note and this file
disagree, the note wins and this file is the doc to fix.

This is the project's ubiquitous language, as Domain-Driven Design defines it (Eric Evans), and we
follow it fully ([we follow DDD](../docs/direction/we-follow-ddd.md)). Inside one bounded context a
word has exactly one meaning. The same word may mean something else in another context; the
[context map](#context-map) names the boundary and how the word translates across it. A word with
two meanings inside one context is a bug, listed under [open clashes](#open-clashes) until fixed.
The rule, the eight contexts below and the context map are decided (decided Nov 3,
[PR 362](https://github.com/usirin/tea-fabrika/pull/362)).

Today's version (the code in daily use) gets one short list at the end,
[today's version says](#todays-version-says): only the places where today's code says another
word or means another thing. A word that means the same in both versions lives only in its
context's section.

How to read it:

- **A section is one context.** Its first line says what it holds, which of `next/`'s
  [five layers](../docs/direction/a-local-first-sync-engine.md) it covers, and its paths. The
  context's name is part of the language: say "the ledger's inbox", not just "inbox".
- **A word gets its row in the context that owns it.** Another context may use it in the same
  meaning without a row of its own. A word that means something else in a second context gets a
  row there too, and a line in the context map.
- **A word in two contexts carries its context in its key,** such as `inbox (ledger)` and
  `inbox (tracker)`. `fabrika glossary check` refuses one key in two sections, so this is how the
  file says it.
- **A row cites the note that decides it**, by relative link. A row that rests on a note still in a
  pull request says "(proposed, PR n)", and its word may change when that pull request lands.
- **"Decided Nov 3"** marks a word the owner picked on 2026-11-03, in the walk of this file. The
  year stays out of the rows because `check` reads any four-digit number in a row as a citation of
  a decision record. A note that still says the old word is changed in that note's own pull
  request; until then the row's Not column names the old word.
- **The Not column** lists old names, wrong names and nearby words a reader may mix it up with.

Add or change a row in the same pull request that coins or renames a word.

## Shared names
The shared kernel: product, package and codenames, and the code keys every context uses. Each
means one thing everywhere. Paths: every `package.json` name.

| Term | Definition | Not |
|---|---|---|
| demlik | The repo that holds tea, and the first real repo lanes ran on. [demlik is the first real repo](../docs/direction/demlik-is-the-first-real-repo.md) | |
| edge | (decided Nov 5, changed Nov 5) A line marked with an edge comment, where `next/`'s Effect code meets a platform that wants a Promise, such as a Durable Object method or a browser key call: `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, or the same for `fabrika/no-effect-run-outside-edge`. Effect's own word: its docs say to run an Effect at the edge of a program. The only place a Promise or an Effect run may appear, as one line that holds no logic. A build that adds one asks the owner, one line each with its reason. It was a written list of whole files in `oxlint-plugins/no-effect-run-outside-edge.ts` until Tier 1's P35. [No Promises](../docs/direction/no-promises.md), [Tier 1](../docs/plan/tier-1.md#rules-that-bind) | Not any line that wraps a Promise in Effect: without the comment, `Effect.tryPromise` and `Effect.promise` still fail. Not a file. Not Cloudflare's network edge. Not `no-hand-tag`'s one exception, `data/log.ts`, which its rule also calls an edge. |
| fabrika | The product: project management where code holds the loop and an agent does one bounded job inside it. `@kampus/fabrika` is the app and `@kampus/libfabrika` the library. The only name people see. [Control lives in code](../docs/direction/control-in-code.md), [where each piece lives](../docs/direction/where-each-piece-lives.md) | Not today's `@kampus/fabrika-old` (last section). |
| fabrika.toml | The settings file: `.fabrika/fabrika.toml` for a repo, `~/.fabrika/fabrika.toml` for a person. Knobs only; the step order stays in code. An unknown key fails. [One fabrika.toml per repo](../docs/direction/one-fabrika-toml-per-repo.md) | Not `ledger.json` or `tsh.toml`, which it replaces. |
| fabsh | The shell, a regular program with local echo. [The desktop layer](../docs/direction/the-desktop-layer.md) | Not `tsh`, today's shell (last section). |
| Jev | A cheap model service that answers one narrow question (the Judge pipeline primitive). Measured by how often it agrees with the big model, never trusted to remove a person. [Jev](../docs/direction/jev-same-answer-cheaper.md) | Not an agent: it does no open-ended work. |
| Manager (service) | An Effect service that holds many of one thing is named `<Thing>Manager`: `LeaseManager`, `ProcessManager`, `LimitManager`. A service name is never plural. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D6) | Not a plural service name such as `Leases`. |
| Manti | Manti UI (`@manti-ui/react`, `@manti-ui/styles`): the component library every part of the app's UI is built on, with our own tokens. A better way goes into Manti by pull request. Inside Manti, Manti's own words hold. [UI on Manti](../docs/direction/ui-on-manti.md) | Never "Manti or native". |
| pack | An add-on: programs in a package, turned on by one `[pack.<name>]` line in `fabrika.toml` and pinned in `.fabrika/fabrika.lock`. The core never knows it exists. Industry: a plugin. [Packs are programs](../docs/direction/packs-are-programs.md) | Not a "catalog": that word was dropped. |
| _tag | The case key of every union we define, written by Effect Schema (`TaggedUnion`, `TaggedStruct`, `TaggedError`), never by hand. [Schema classes](../docs/direction/schema-classes-not-of-helpers.md) | Not `kind`, today's word (last section). Not `type`, which tea's Msgs and Cmds keep. |
| tea | `@demlik/tea`: the Elm architecture in TypeScript (machines, Msgs, Cmds, Subs), run on its Effect engine. The engine under every program; it stays small and does not grow to fit a host. [tea is the engine](../docs/direction/tea-is-the-engine.md), [Elm first](../docs/direction/elm-first.md) | Not Effect `Workflow` or an actor runtime, both banned as a machine's replacement. |
| tezgah | (decided Nov 3) Tuval's window manager, as Mutter is GNOME's and KWin is KDE's: every workspace, its layout and its focus, as one machine. Turkish for workbench, and loom. Its program is `fabrika/tezgah` (Tier 2, not built), which the notes called `fabrika/desk`. People see "fabrika". [The desktop layer](../docs/direction/the-desktop-layer.md) | Not `desk`, the notes' older word and today's code (last section). Not the desktop: that is Tuval. |
| Tuval | Codename for the desktop layer, layer 5: the desktop environment, as GNOME or KDE. The `@kampus/tuval` package. People see "fabrika". [The desktop layer](../docs/direction/the-desktop-layer.md) | Not a name shown to people. Not its window manager, tezgah. |

## Records
The project as a lab notebook: what was decided, measured and seen, and the words for the work
itself. Both versions. Paths: `docs/`, `experiments/`, `field/`, `replay/`, `singles/`.

| Term | Definition | Not |
|---|---|---|
| agent hour | The unit of size: one agent's wall clock, summed, failed runs in, drivers out. A ticket's `estimate` uses a doubling scale from 0.25 to 8; its `spent` is folded from run facts, never typed. [Agent hours](../docs/direction/agent-hours.md) | Not human days. |
| agent run | One agent session, logged as one row in `field/runs.jsonl`. [Field](../field/README.md) | Not a process, a running program (Runtime). See the context map. |
| billing | (decided Nov 7) How an agent run was paid: `subscription`, with the provider's `product` (`max`, `pro`), or `key`, billed per token. Read from the CLI and recorded on the run with `env`, whether each key variable was set (never its value); a set key never blocks a run. Optional, never guessed. [The meter on subscriptions](../docs/direction/one-ask-and-one-meter.md#the-meter-on-subscriptions) | Not `plan`, the providers' word for Max or Pro: a plan is the plan step's answer (Tracker). Not the meter's dollars, which are list price on a subscription. |
| direction note | One decision in `docs/direction/`, marked decided or proposed. Industry: an architecture decision record. [Direction](../docs/direction/README.md) | Not an experiment: a note decides, an experiment measures. |
| experiment | A numbered measurement: `experiments/NN-title.md` and its script. It records what was tried and what came back. [Experiments](../experiments/README.md) | Not a decision. Not the `experiment` program, which shows one. |
| field log | `field/runs.jsonl` and `field/notes.jsonl`: one row per agent run on a real ticket, one note per thing that broke, cost too much, needed a person or worked well. [Field](../field/README.md) | |
| next/ | The new version of fabrika, built on the five layers and on the notes in `docs/direction/`, never on today's code. Not on main yet ([PR 223](https://github.com/usirin/tea-fabrika/pull/223)). The words in this file are its words. [Clean slate](../docs/direction/clean-slate.md) | Not today's version. A name that exists in both may mean different things: check the path. |
| owner | The person who sets direction, approves plans and is the only one who changes the exam. [Nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md) | Not "the user" in a note about who decides. |
| quota | (decided Nov 7) A provider's usage limit on a subscription, such as Claude's five-hour and seven-day windows, as the run last read it: `id`, `used` (0 to 100), `minutes`, `until`. Google Cloud's word. [The meter on subscriptions](../docs/direction/one-ask-and-one-meter.md#the-meter-on-subscriptions) | Not the meter's own `Limits` (Ledger), which fabrika sets. Not a window (Frame). |
| tier | One whole slice of `next/` a person can use, built in order. Tier 1 is the first. [The tiers](../docs/plan/tiers.md) | Not a priority level: fabrika has no priority. |
| today's version | Everything outside `next/` (`packages/`, `programs/`, `packs/`, `apps/`, `wip`, `legacy`): the fabrika in daily use until `next/` takes each job over. Where its words differ, the last section says so. [Clean slate](../docs/direction/clean-slate.md) | Not `@kampus/fabrika`, which is the new app. |

## Tracker
Project management as a person sees it: tickets, plans, asks and the inbox. Programs on layer 4.
Paths: `next/`'s tracker programs; today's are `programs/tracker`, `programs/ticket`,
`packs/owner-desk` and `packs/ask-log`.

| Term | Definition | Not |
|---|---|---|
| area | (the word decided Nov 3; what it is decided Nov 4; its shape proposed) A long-lived grouping of tickets by part of the product, as Jira's components or Linear's labels. It never ends. An area is a person's data on the project's ledger, made, renamed and merged by a person; the app only suggests. A ticket holds at most one, by number: a guess (the filer's, or its source's) until a person picks. [Areas](../docs/direction/areas.md) (proposed, PR 375) | Not a project, which ends. Not a label that gates a build. Not a folder: an area is never read from the code's folders. Not the tracker's view tab or filter, which show one. |
| ask | What an agent or a step asks a person, for a decision or an act, never for a fact. It is the `asked` and `answered` facts, with a hash of what the person saw; the first answer wins. Also a step's outcome verb `ask`. "Ask" means only this (decided Nov 3). [Ask for decisions, not facts](../docs/direction/ask-for-decisions-not-facts.md), [one ask and one meter](../docs/direction/one-ask-and-one-meter.md) | Not the close question (Frame). Not "popup". |
| criterion | A promise a reviewer reads, which ends with the ticket. Open or met; a builder may not shrink one, and "cannot meet as written" is its honest exit. [Done is per criterion](../docs/direction/done-is-per-criterion.md), [the plan stage](../docs/direction/the-plan-stage.md) | Not a property, which a tool checks and which lasts. |
| inbox (tracker) | A person's list of things waiting, as Linear's Inbox: the open asks first. The owner's desk is the inbox. The program that shows it is `inbox` (decided Nov 3, Tier 5): a tile beside the selected ask, and a glance in the top bar. [The ask desk](../docs/direction/ask-desk.md), [every wait is a queue](../docs/direction/every-wait-is-a-queue.md) | Not `asks`, the program's old name, nor "the ask desk", the note's title: G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) ruled "inbox" out over the stream clash, and the context map now settles that. Not the ledger's inbox stream: see the context map. |
| judgment | A decision only a person can make. It is the only thing the pipeline asks a person for; everything else code fixes, retries or prevents. [Jidoka and andon](../docs/direction/jidoka-and-andon.md), [pipeline guidelines](../docs/direction/pipeline-guidelines.md) | |
| label | (decided Nov 6) A person's word on a ticket for finding work, held by number, made, renamed, merged and applied by a person; an agent only guesses at filing. It may sit in a group made pick-one or many. Area is the first group. [Label guidelines](../docs/direction/label-guidelines.md) | Not a status, a turn or any state that moves, which are folds. Not a typed value (a person, ticket, date, number or priority), which is a field. Not read by any step: a label never gates or routes. |
| needed | (decided Nov 7) An optional mark a person puts on an answer: `true`, the ask really needed a person; `false`, the agent could have worked it out. No mark means the person did not say. Asks get counted by it, per step and per agent. [The ask desk](../docs/direction/ask-desk.md#did-this-ask-need-you), [autonomy is measured trust](../docs/direction/autonomy-is-measured-trust.md#m5-asks-that-did-not-need-a-person) | Not A5's agreement, which says whether the person took the rec. Not a Cmd's `needs`, a capability (Clients). |
| plan | The plan step's answer for one ticket: tasks, criteria and properties, approved by the owner by version and a hash of the ticket's text. An epic is a plan with many tasks. [The plan stage](../docs/direction/the-plan-stage.md), [a free-form plan goes to the planner](../docs/direction/free-form-plan-to-planner.md) | |
| project | A parent plan: a group of tickets, as in Linear ([a project is a parent plan](../docs/direction/a-project-is-a-parent-plan.md)). It ends: it closes when its children are done and its check passes. One meaning in the tracker (decided Nov 3). | Not an area, the long-lived grouping with an owner. Not the ledger's project object: see the context map. Not a repo. |
| property | A promise a tool checks, kept as a test after the ticket ends: `{when, result, why, behavior, tool, stories, code}`, id `p<n>`. [The plan stage](../docs/direction/the-plan-stage.md) | Not "promise", the older note's word. Not a criterion. |
| rec | The step's recommendation on an ask, written before the ask, with its why, cost and how sure. `y` takes it, `n` refuses it with a note. [The ask desk](../docs/direction/ask-desk.md) | |
| Status | (decided Nov 3) The one line at the top of a ticket: what a person must do, if anything, as Linear's status. [Tracker views are programs](../docs/direction/tracker-views-are-programs.md) (proposed) | Not `Glance`, the word in that note's sketch. Not today's `Head` (last section). Not the frame's glance. |
| ticket | One unit of work in the tracker. Its facts live on the ledger and its state is their fold. One ticket, one pull request. Industry: issue. [The ticket is the lane view](../docs/direction/the-ticket-is-the-lane-view.md) | Not a GitHub issue: see the context map. |
| timeline | A ticket's facts in order, comments included, one row per fact. The main view for people and the main context for agents. [What a ticket shows](../docs/direction/what-a-ticket-shows.md) | |
| tracker | fabrika's own issue tracker, built like Linear. Tickets are ledger facts; GitHub stays the code host, reached through `CodeHost`. [Tickets start in our tracker](../docs/direction/tickets-start-in-our-tracker.md), [the tracker is like Linear](../docs/direction/the-tracker-is-like-linear.md) | Not GitHub Issues: no ticket copy goes there. |
| tracker view | One way to see tickets (one ticket, a board, a list), each its own small tea program that folds the ledger. [Tracker views are programs](../docs/direction/tracker-views-are-programs.md) (proposed) | Not a program's view, what it draws (Runtime). See the context map. |
| waited | (decided Nov 7) On an ask's `answered` or `withdrawn`, how long the ask waited on a person, in ms, from the two entries' `arrivedAt`; the referee fills it. [The meter on subscriptions](../docs/direction/one-ask-and-one-meter.md#the-meter-on-subscriptions) | Not the ask desk's `took.ms`, the time the ask was on screen with focus. |

## Pipeline
The steps a ticket goes through from filed to merged, and the rules that hold them. Every pull
request goes through them, `next/` or today's, so the words are the same in both. The code is
today's for now: `packages/pipeline`, `programs/pipeline`.

| Term | Definition | Not |
|---|---|---|
| agent | A model doing one bounded job inside code's loop. No agent approves a pull request or answers a question put to a person. [Control lives in code](../docs/direction/control-in-code.md) | Not Jev, which answers one narrow question. An agent is also a client: see the context map. |
| box | The sandbox a program runs in: the `Sandbox` service, with a layer per box (Docker, sandbox-runtime, none). No real key goes in. [Programs run in a box](../docs/direction/programs-run-in-a-box.md) | |
| build | The step where an agent writes code until every check is green. It ends with a local commit and pushes nothing. [Nothing is pushed before review](../docs/direction/push-after-review.md) | |
| combo | A shape built from primitives that keeps coming back: refine, gate, ask, remember, spawn (`packages/pipeline/src/combos.ts`). No new primitive without a reason. [Reuse before special rules](../docs/direction/reuse-before-special-rules.md), [new combos](../docs/direction/new-combos.md) | |
| exam | What code is checked against: a machine's laws, the checker, a ticket's criteria, CI and lint rules. An agent that writes code never changes it; the owner does, in its own pull request (the `exam` steps). [Nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md) | |
| finding | One thing a reviewer, a mutant or a scheduled job found. A person rates it `fix` or `noise`; one never rated counts as noise once its change ships. Industry: a SARIF result. [Every finding is rated](../docs/direction/every-finding-is-rated.md) | |
| fix forward | (proposed) A pipeline strategy: ship good enough, with each gap filed as a ticket, and fix a break with a new change, not a revert. It never skips a gate, never merges red and never changes a test to pass. Only for harm a later change can undo. Industry: roll forward. [Pipeline strategies](../docs/direction/pipeline-strategies.md) | Not "ship it anyway": a red gate still stops it. Not for lost data or a leaked secret, which stop the line or roll back. |
| helper | A small agent a step asks for a fact it lacks, never another step. Also called a scout. [Helpers, and one supervisor](../docs/direction/helpers-and-the-supervisor.md) | Not a supervisor: fabrika has none for steps. |
| kept, glance, stale | How a review verdict or a person's yes carries to a new head: `kept` (same head, a clean replay or a format-only change), `glance` (only the patch-id matches), `stale` (otherwise). [A yes binds to the diff](../docs/direction/a-yes-binds-to-the-diff.md) (proposed) | This `glance` is not the frame's glance: see the context map. |
| lane | One ticket's run through the pipeline on its assignee's host, claimed on the ledger. The parent machine `lane` steps each step in turn. [A ticket runs from the app](../docs/direction/a-ticket-runs-from-the-app.md) | Not the ephemeral lane (Clients): see the context map. |
| laws | A machine's rules, which a checker walks through every message order of its real reducer. A machine with no laws, or a message never sent, fails the suite. [Every machine has laws](../docs/direction/every-machine-has-laws.md) | |
| mutation | The `mutation` step: Stryker makes small breaks (mutants) the tests must catch. In the `mutants` step each survivor gets `test`, `cannot` or `noise`. [A fast check per pull request](../docs/direction/fast-and-daily-mutation.md) | Not our own search engine: Stryker is the grader. |
| outcome | How a step ends, in five verbs: `done`, `send`, `ask`, `skip`, `stuck`. Passing it on is `verb:who:why`, ending here is `verb:why`. [Outcome names](../docs/direction/outcome-names.md) | The note and today's code say "a stage answers" (last section). |
| pipeline | The steps a ticket goes through from filed to merged, each run by its own agent, with laws. Every pull request goes through it. Also the package `@kampus/pipeline` and the `pipeline` program, named for what they hold. [Every pull request goes through the steps](../docs/direction/next-is-a-pipeline-pre-run.md) | G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) flags the `pipeline` program's name: it also means the package and the whole chain. |
| pipeline strategy | (proposed) A lane's answer to "this gate isn't perfect, now what?": `fix_forward`, `stop_the_line`, `ship_dark` or `roll_back`. The line between them: can a later change undo the harm? [Pipeline strategies](../docs/direction/pipeline-strategies.md) | Not an OTP supervisor's restart strategy. Not an outcome: a strategy picks the outcome. |
| primitive | (decided Nov 3) One of the six building blocks of every step: Gather (code reads), Act (code writes), Listen (code waits), Draft (an agent produces), Check (code judges), Judge (Jev answers one narrow question). `packages/pipeline/src/primitives.ts`. From outside the pipeline context, say pipeline primitive. | Not "move", the notes' older word, which is vague. Not "Cmd kind". |
| resume point | `Resume` (`packages/pipeline/src/stages/pipeline/machine.ts`): where a stopped lane goes on, `{_tag: "start", step}` or `{_tag: "ask", for, step}`. `start` reads with the `started` fact: `{_tag: "start", step: "mutation"}` (decided Nov 3). A restart keeps finished steps and never starts over. | Not `_tag: "run"`, which today's code still says until the rename lands (last section). |
| review | One review of the whole diff, by a different agent from the builder. The reviewer only finds; code works out pass or fail. [Nobody grades their own work](../docs/direction/nobody-grades-their-own-work.md), [one review a plan](../docs/direction/one-review-a-plan-and-the-cloud-in-v1.md) | Not an approval: no agent approves a pull request. |
| run (pipeline) | An agent run a step starts, as in Records. Only a noun here: the resume point says `start` (decided Nov 3). | Not a process, a running program (Runtime). Not today's resume tag `run` (last section). |
| ship | The merge: the ship code, the one merge authority. A person's comment goes to that person, a bot's back to the builder. [Ship stage rules](../docs/direction/ship-stage-rules.md) | Not a merge by hand, and never auto-merge. |
| step | (decided Nov 3) One place in a lane, in this order: `triage`, `plan`, `exam`, `exam_review`, `exam_merge`, `test_writer`, `build`, `mutation`, `mutants`, `review`, `push`, `merge` (`STEPS`, `packages/pipeline/src/stages/pipeline/routes.ts`). Each step is its own machine, which answers in the five outcome verbs. [One parent, stages as slots](../docs/direction/one-parent-stages-as-slots.md) | Not "stage", the older word for the same thing. Today's code and notes keep it until renamed: `fact.stage`, the `stages/` folder, "a stage answers in five verbs" (last section). |
| stop | Where a lane halts itself, with its reason, on what code cannot fix (Toyota's andon). Every stop saves where the lane goes on; a person's `stop` is a saved pause. [Jidoka and andon](../docs/direction/jidoka-and-andon.md) | Not the `stuck` verb alone. Not the shell's built-in `stop` (Runtime). |
| test writer | The agent that writes one test per property after the owner's approval, red first for a new one, and answers each surviving mutant. [The test writer](../docs/direction/the-test-writer.md) | Not "verify writer", its old name. Not the builder. |
| triage | The first step. It answers duplicate, decline, accept or escalate, and asks the owner when worth is unclear. No priority and no "later". [Sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md), [triage asks when worth is unclear](../docs/direction/triage-asks-when-worth-is-unclear.md) | Not "sort", its old name. |

## Runtime
Programs, the machines inside them, and the processes that run them: layer 4, the app layer
([the cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md), A1 to A5), and the
shell. Paths: `next/`'s app layer and `fabsh`.

| Term | Definition | Not |
|---|---|---|
| Cmd | A request for an effect, with typed `input`, `ok` and `err`, defined through a pipeline primitive or tea's Effect `Cmd.make`. Elm's Cmd. | |
| commands | A program's `commands` field: each a Msg with its keys, and each also a shell word and a palette row. [Modes](../docs/direction/modes.md), [keybindings are configurable](../docs/direction/keybindings-are-configurable.md) | |
| envelope (runtime) | `Envelope<A> = {id, by, arrivedAt, input}` in `next/` (today's version says `at`): an input as the host's door stamped it. `id` is an `InputId` only the door makes, `in-<host run>-<n>`; `by` comes from the connection; `arrivedAt` is the referee's clock as it came. A client that sends its own id or sender is refused. Decided Nov 4, details proposed. [Inputs carry their sender](../docs/direction/inputs-carry-their-sender.md) | Not saved state's envelope, the fields around a ledger entry (Ledger): see the context map. Not a Msg: the program's handler gets the input, and only the id rides on as a cause. |
| input | What a program is told while it runs, like stdin. Told at any time, never waiting, served in order. One input per command, apart from the one `query` (CQRS). [tea-program](../docs/direction/tea-program.md), [tracker views are programs](../docs/direction/tracker-views-are-programs.md) | |
| job | What one start made: a root and everything under it, like a process group (a shell line, a lane). [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md) | Not the hands' job, work taken from a queue (Clients): see the context map. |
| JobRecord | One Durable Object per job: its processes' storage, its spans from every host, and pointers to agent logs. Nothing is ever deleted except agent content a person removes. [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md) | Not Jaeger, which it replaced. |
| line (runtime) | What a person types in the shell: programs joined by pipes, such as `tracker \| ticket \| trace`. The top bar's "the line" shows it. Each program in a line shows in a tile (decided Nov 3). | Not a line's windows: they are tiles. Not the status bar, the prefix line or the toolbar. Not `tsh line` (last section). Not the ledger's line, what a writer hands to `append` (Ledger): see the context map. |
| location | (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) Where a program is now, read from its tile's own machine and named for its program (`AsksLocation`). Opening the same location focuses its tile. | Not `at`, its old name: `at` is a time. |
| machine | A tea state machine: a model, the Msgs its `update` takes, and the Cmds it asks for. Parents are written by hand and step their children. [Elm first](../docs/direction/elm-first.md) | Not a program. Not a computer: that is a host (Clients). |
| mode | A program's state that changes what keys do, per tile, always shown in words; Escape always leaves. No mode is `null`. [Modes](../docs/direction/modes.md) | The note says "per window", the old word for a tile. |
| Msg | A message a machine's `update` takes. tea's Msgs keep `type` as their tag. | Not `_tag`, which is for unions we define. |
| output | An event a program sends: heard once, kept nowhere. What a late viewer needs is a machine's state. [tea-program](../docs/direction/tea-program.md) | Not a Cmd: an output has no answer. |
| pipe | `from \| to`: one program's outputs fed to the next one's typed inputs. An `anyInput` takes the source's first output. [tea-program](../docs/direction/tea-program.md), [an input can take anything](../docs/direction/an-input-can-take-anything.md) | |
| process | One running copy of a program, with its own pid, in its own object. Its inputs come through its inbox (Ledger). A restart is a new process, as in OTP. [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) (A3) | Not a run, today's word (last section). Not an agent run (Records). |
| program | What you start: a name, flags, inputs, outputs, and `main`, which runs tea machines (`defineProgram`). It uses machines and is not one. [tea-program](../docs/direction/tea-program.md) | Not a machine. Not a process, which is one running copy. |
| program name | The word a person types in the shell and reads in the title bar: `ticket #7`. It is the title bar's word (decided Nov 3), and comes first in a tile's accessible name. G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)): a noun for what the tile shows, plural for a list; 2 to 9 small letters; one meaning; a phrase is written from the noun. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not the accessible name, which says more. |
| ps | (decided Nov 7) The list of processes running now, read from `ProcessManager`'s `info`; also the agent's tool that shows it, first in the MCP tool list. It lists and drives none. Unix's and today's tsh's word. [Tier 1, agents through MCP](../docs/plan/tier-1-detail.md#agents-through-mcp) | Not one ticket's jobs: that is `timeline` (Tracker). Not today's `runs` program, removed in tracker ticket 141. Not `field/runs.jsonl`, the agent-run log (Records). |
| trace | A job's spans, in OpenTelemetry's words, and the `trace` program that draws them. An agent run keeps its content in the trace. [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md), [an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md) | |
| view | What a program draws: data picked from its state by a pure `select`, drawn by its view code. Elm's word. On the window protocol a view has a revision, `rev`, and a window Msg names the one it saw as `saw` (A3). A program's drawing is its view, never its window (decided Nov 3). [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) (A3) | Not "window". Not a tracker view (Tracker): see the context map. |

## Ledger
The record and the coordination built on it: layer 2, data (one append-only log per project and
its streams), and layer 3, coordination (claims, leases, inboxes, the process tree). Both live in
the one project object. Paths: `next/`'s data and coordination layers. Today's single `Ledger`
service mixes these with layer 4 (last section).

| Term | Definition | Not |
|---|---|---|
| arrivedAt | (renamed Nov 5 from `at`) The referee's clock on an entry: when it reached the ledger, set by the referee, never by the writer. Leases, limits and order use only this. Industry: Kafka's `LogAppendTime`; processing time, against event time. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D3) | Not the writer's clock: that is `sentAt`. Not a deadline, a lease's end or a timer's `at`, which are times something should happen. Not a place: that is `location`. Today's entries say `at` (last section). |
| attested | (decided Nov 5) The fact a pipeline step signs for what it changed, in in-toto's link shape: `{_tag: "attested", step, ticket, version, from, to, by, key, sig, arrivedAt, cause}`, where `from` and `to` are the git trees before and after, `ticket` the tracker ticket it served and `version` its number among that step's links for the ticket, of which only the newest counts (Nov 7). CI checks the chain from `main`'s tree to the squash commit's tree. In Tier 1 it sits in the step's `field/` row. [A unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md) | Not `committed`, which names a commit that a squash drops. Not a GitHub "Verified" badge. |
| by | Who wrote an entry, stamped by the door from the signed-in key, never typed by the writer. | |
| cause | The id of the input that made a write, `cause: "in-3f9a0c21-41"`. The host signs the write as that input's sender, so an agent signs its own writes and never the person's. A write with no cause is the job owner's. Traces mirror it with a span link and never decide with it. On a `next/` entry it is a `CauseText`, null for an `own` write, and the runner signs by it (owner, Nov 5, Tier 1's P6 and P11). Decided Nov 4, details proposed. [Inputs carry their sender](../docs/direction/inputs-carry-their-sender.md) | Not Effect's `Cause`, a failure's reason ([errors are diagnostics](../docs/direction/errors-are-diagnostics.md)); never name a type `Cause` for this. Not `from`, where a ticket came from. Not `by`, who signed. |
| committed | (decided Nov 5) The fact a pipeline step writes for each commit it made: `{_tag: "committed", step, sha, by, arrivedAt, cause}`. Recorded wide; CI decides from the signature in the commit's git note, by the step's own key, not from this. In Tier 1 the step's `field/` row stands in. [A unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md) | Not a commit's author or a `Step:` trailer, which anyone can type. Not `MergeRow`, one row per merge. |
| claim | "This work is mine": a compare-and-set on the ledger with a lease, so two agents never spend money twice on one ticket. The ledger records only when a claim changes hands. [The five layers](../docs/direction/a-local-first-sync-engine.md) (C3) | |
| Doorbell | The service that rings a waiter, at most once: `ring(to, stream, rev)`. The referee calls it for each ring an append takes out; a failed ring is gone all the same, kept only in its span. In the project object it is a call to the gateway (Tier 1's P12). [Tier 1's P6](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time) | Not `wait`, which the five layers once called "the doorbell". Not a poke, which goes to every client. |
| entry | One line of the ledger (D3): `id`, `stream`, `pos`, `rev`, `arrivedAt`, `by`, `for`, `sentAt`, `seen`, `cause`, `build`, `_tag`, `body`, EventStoreDB's fields in short words, with the two clocks named in full (Nov 5). The referee sets `id`, `stream`, `pos`, `rev` and `arrivedAt`; the writer's line gives the rest. `for` is the person the writer works for, and `build` the build of the code that wrote it (Tier 1's P6). [The five layers](../docs/direction/a-local-first-sync-engine.md) | Today's entries say `kind` for `_tag` and swap `pos` and `rev` (last section). Its `build` is not the pipeline's build step (Pipeline). |
| fact | One ledger entry about something that happened (`filed`, `asked`, `claimed`). Kept for good; state is a fold of facts. Industry: an event. [Data first; markdown is a view](../docs/direction/data-first-markdown-is-a-view.md) | Not markdown: markdown is made from facts and never read back. |
| fold (of facts) | State worked out from facts in order, as a reducer over an event log. A ticket's status is a fold; done is a merged pull request or a person's close, never a drag. | Not folding a tile (Frame): see the context map. |
| inbox (ledger) | A stream others write to, the one open door to a name: `build:7/inbox`, and a ticket's write inbox, `tracker/ticket/43/inbox`. The transactional inbox pattern. After 3 crashes on one message it moves to `<name>/dead` (C2). [The five layers](../docs/direction/a-local-first-sync-engine.md) (C2) | Not the tracker's inbox, a person's list: see the context map. Not the `Mailbox` service, which sends to it. |
| lag | (decided Nov 7) How far a reader is behind the newest entry, in revs: consumer lag, Kafka's word. Every piece that delivers events records it, and its hourly health summary keeps the worst. On the ledger's spans it counts the stream's entries past the reader's `after`, as Kafka counts per partition (Tier 1's P6). [The five layers](../docs/direction/a-local-first-sync-engine.md) | Not a time. The time from a write to a reader seeing it is its own measure, `visible_ms` on a read's span. Not the gap between two rev numbers, which counts other streams' entries too. |
| lease | A claim that lasts 30 s and is renewed every 10 s. An old holder stays valid until a newer claim exists (Kafka's epoch rule). `LeaseManager`: claim, renew, release. [The five layers](../docs/direction/a-local-first-sync-engine.md) (C3) | |
| ledger | The record: one append-only log per project, with named streams inside it. The `Ledger` service has three calls (`append`, `read`, `wait`); coordination has services of its own (D6). [The ledger behind a service](../docs/direction/ledger-behind-a-service.md), [the five layers](../docs/direction/a-local-first-sync-engine.md) | Not a table of rows that are overwritten. Not today's `Ledger` service (last section). |
| line (ledger) | What a writer hands to `append`: `by`, `for`, `sentAt`, `seen`, `cause`, `build`, `_tag` and `body`, every key required. The referee adds the rest to make an entry. A line that leaves a key out, or names one the referee sets, such as `arrivedAt`, is refused `bad_line`. `Line` in `data/log.ts`, [Tier 1's P6](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time) | Not an entry, which the referee placed. Not the shell's line (Runtime): see the context map. EventStoreDB says event data. |
| Mailbox (service) | The coordination service with `send` and `receive`, OTP's word, in one Layer with `Registry`, `LeaseManager` and `ProcessManager`. It delivers at least once into a name's inbox. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D6, C2) | Not the inbox itself, the stream it writes. Not today's mailbox (last section). |
| parked | What `wait` answers when nothing past `after` is there yet: the referee keeps a ring, and the caller keeps its wait as data (the gateway, in its socket's attachment). The other answer is `ready`, with the stream's newest rev. A wait never blocks, so an object can sleep under it (owner, Nov 2). Tier 1's P6, [Tier 1's detail, Cloudflare](../docs/plan/tier-1-detail.md#cloudflare) | Not a call left waiting: no fiber, timer or Deferred is kept. Not an ask's `waited` (Tracker), a time. |
| placed | What `append` answers when the line is in the log: `{_tag: "placed", rev, pos}`. A resend with the same content gets its first placing again, and nothing is written. The other answer is `refused`, with `why`: `bad_line`, `bad_cause`, `seen_ahead`, `id_reused` or `too_big`. [Tier 1's P6](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time) | Not a resend with another body: that is refused `id_reused` (owner, Nov 7). |
| poke | "Come read": the brain sends `ledger.appended` with `{rev, streams}`, at most once, and the client pulls after the last rev it has. Replicache's word. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D4) | |
| pos | An entry's place in its stream, beside `rev`, its place in the whole log. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D3) | Today's code swaps the two (last section). |
| ProcessManager | The coordination service for the process tree: `start`, `exit`, `link`, `monitor`, `trapExit`, `info`, as OTP's. Each restart is an entry. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D6, C4, C5) | Not the brain, where processes run (Clients). |
| project object | The one shared Durable Object that holds a team's ledger, claims, inboxes and process tree, and is its referee. [The five layers](../docs/direction/a-local-first-sync-engine.md) | Not a tracker project, a parent plan: see the context map. |
| reader | The name of the object that reads or waits, such as `gateway:t1`, given once when its `Ledger` is built. A ring's `to`, and the key of each reader's lag. [Tier 1's P6](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time) | Not `by`, who wrote an entry. Not `as`, window or agent on a grant (Clients). |
| referee | The one object that orders writes and grants leases: the project object, one call at a time. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D1) | |
| Referee (service) | The referee's logic as a service, plain code on one synchronous `Sql`, the same on workerd and on Node: `append` decided and written in one atomic step, `read` one page, `wait` answered at once. `Ledger.sql` puts it behind `Ledger`. `data/referee.ts`, [Tier 1's P6](../docs/plan/tier-1.md#the-pull-requests-one-at-a-time) | Not the `Ledger` service, which every caller uses. Not the project object, which runs it. |
| Registry | The coordination service that names a process: `register`, `whereis`, as OTP's. A name is never freed, since a name is a stream and the log keeps every stream. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D6) | |
| rev | An entry's place in the whole log, beside `pos`, its place in its stream (D3). [The five layers](../docs/direction/a-local-first-sync-engine.md) | Not a git revision. Not a view's revision (Runtime): see the context map. Today's code swaps `rev` and `pos` (last section). |
| ring | A row `{to, stream, after}` in the project object's own SQLite, written by a parked wait: one per reader and stream, keeping the lower `after`. The first append to that stream past `after` takes it out in the same step and rings `to` once, through `Doorbell`. Never a fact, never folded. Kafka keeps a waiting fetch the same way, as a delayed request; we keep it as a row so the object can sleep. Tier 1's P6, [Tier 1's detail, Cloudflare](../docs/plan/tier-1-detail.md#cloudflare) | Not a poke, which goes to every client. Not a fact on the ledger. Not delivered twice: a lost ring is gone (at most once). |
| saw | On an answer to an ask, the hash of what the person saw (`packages/pipeline/src/combos.ts`). | Not `seen`. Not a window Msg's `saw`, a view revision (Runtime): see the context map. |
| seen | The last rev an entry's writer had folded when it wrote. [Saved state](../docs/direction/saved-state.md) | Not `saw`. |
| sentAt | (renamed Nov 5 from `said`) The writer's own clock on an entry: when it wrote it. Offline, that is when it was written, not when it synced. Shown, never used to decide, and kept out of the deciding code's types. Industry: Kafka's `CreateTime`; event time, against processing time. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D3) | Not `arrivedAt`, the referee's. Not a trusted time: the writer may be wrong or lying. Today's entries say `said` (last section). |
| stream | A named part of the log, such as `build:7`. A name owns `build:7`, `build:7/inbox` and `build:7/dead`, and only its lease writes them; claims and inboxes are streams too. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D2) | |

## Clients
The wiring: where programs run, who dials in, and how. Layer 1, transport, and the four words of
[brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md). Paths: `next/`'s
transport and hands.

| Term | Definition | Not |
|---|---|---|
| brain | Where programs run and keep their state, on workerd everywhere, the laptop included. [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) | Not "runner". Where an older note says host for this, read brain. |
| capabilities | What a host can do, sent in the hello as `has`; a Cmd says what it `needs`. A capability says "can", never "may": may is a grant on the ledger. MCP's word. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | |
| client | Any of hands, a window or an agent, and only when talking about the door's protocol. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not "peer" and not "node", both gone. |
| door | Where every client comes in. It stamps each entry's `by` from the signed-in key. [The ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md) | |
| ephemeral lane | An at-most-once channel on the same transport, for pokes, presence and terminal bytes. Show it, never save it, never decide with it. [The five layers](../docs/direction/a-local-first-sync-engine.md) | Not a lane, a ticket's run (Pipeline): see the context map. |
| five layers | The design, bottom to top: transport (one WebSocket per client to its own gateway, JSON-RPC 2.0), data (the ledger), coordination (claims, inboxes, the process tree, who is online), app (programs, Cmds, windows, limits, packs), desktop (Tuval). Each uses only the one below. [A local-first sync engine](../docs/direction/a-local-first-sync-engine.md) | Not "link layer" for transport, not "nodes" for coordination. |
| gateway | One object per client, which the client dials and which answers its text ping. Hands meet only through the brain, gateway to gateway. [The five layers](../docs/direction/a-local-first-sync-engine.md) (T2) | |
| hands | What takes jobs from the queue, with a lease, and acts on one computer. Node runs only the hands. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not a place: hands are a job, and a host is where they run. |
| host | A place hands can run, such as a Mac, a VM or a browser profile. The brain on Cloudflare is not called a host. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not today's host, a process that runs programs (last section). Not a client: a host is where things run, a client is what dials. |
| job (clients) | Work the hands take from the queue, with a lease. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not a job, what one start made (Runtime): see the context map. |
| key line | One public key as OpenSSH writes it in a `.pub` file or an allowed-signers file: `<type> <base64 of the key blob> [comment]`. In `next/`, `KeyLine` is one that decoded as an Ed25519 key, `ssh-ed25519` and 32 bytes, and only a decoded one can sign through `writeSshsig` (Tier 1, P7). [A key per client](../docs/direction/a-key-per-client-and-no-github-trust.md) | Not a fingerprint, `SHA256:...`, which is a hash of the key. |
| recovery key | A person's second Ed25519 key, kept only as 12 words on a printed sheet. Its public half joins `founded.keys` through an `added` fact. It can let in one new Mac and drop the person's other keys, once, and is then spent. Making a new sheet kills the old one. Apple's and Matrix's word. (decided 2026-11-06) [Account recovery](../docs/direction/recovery-key.md) | Not the person key, which signs grants. Not a window key. Not a password: the words are the key. The plan's "backup sheet" is the paper, not the key. |

## Frame
The window and everything in it a person sees around a program's view: the tiles, the bars, what
opens over the tiles, and the desktop layer. Layer 5, Tuval
([the desktop layer](../docs/direction/the-desktop-layer.md), W1 to W5). Paths: `next/`'s Tuval and
`@kampus/fabrika-design`, which both versions share.

| Term | Definition | Not |
|---|---|---|
| accessible name | What a screen reader hears entering a tile: `tracker, t2, pipe A, 1 of 2, sends to ticket` (decided Nov 3). [Tile guidelines](../docs/direction/tile-guidelines.md) | Not "the region's name", the tile guidelines' older words. Not the program name, which comes first in it. |
| bars hidden | (decided Nov 3) `C-b B` hides both bars; the status bar comes back while you are mid-key or in a mode. In code, `barsHidden`. [Modes](../docs/direction/modes.md) (M3) | Not `bare`, today's code (last section), and not the layout's proposed `BARE`, which gets another word. |
| close question | (decided Nov 3) The tile's y/n, `close t2? (y/n)`, asked on the status bar and in the tile's title bar. In code, `question`. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not an ask (Tracker). Not `Open.ask`, today's code (last section). |
| container | A row or a column of tiles; nested ones alternate, as in AeroSpace. [Fold, not tabs](../docs/direction/fold-not-tabs.md) | Not a Docker container, and never tabs. |
| desktop | Only layer 5, Tuval: the desktop environment, as GNOME or KDE. Its window manager, tezgah, places tiles, owns focus and routes keys, on the app layer's window protocol. [The desktop layer](../docs/direction/the-desktop-layer.md) | Not tezgah. |
| divider | (decided Nov 3) The 4px between two open tiles, dragged to resize. Apple's word (`NSSplitView`). Built on Manti's `Splitter`, whose handle Zag calls its resize trigger: Manti's word, inside Manti. Not a Tab stop at rest; a focused `role="separator"` only in resize mode. In code, `divider`. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not "gap": it has two tile edges, not empty space. Not "border": tmux's pane border is a drawn line. Not "resize gap", the tile guidelines' older word, nor `.border`, today's code (last section). |
| DM | (decided Nov 6; note in PR 425) A room with two members, a person and one agent: the default talk with an agent. `@scout <text>` typed outside any room talks in your DM with scout. Readable by everyone on the project, like any room. Slack's, Discord's and Matrix's word. [Summon guidelines](../docs/direction/summon-guidelines.md#rooms-mentions-and-turns-in-order) | Not a private chat: no room is private. Not a separate kind of thing: a DM is a room, marked `direct`. Not `scout#<person>`, the walked-back default thread. |
| fold (tile) | `C-b f` folds a tile into a thin strip that keeps its place; a click opens it. The last open tile cannot fold. [Fold, not tabs](../docs/direction/fold-not-tabs.md) | Not a fold of facts (Ledger). Not tabs. |
| frame | (decided Nov 3) Everything the app draws that is not a program's view: the bars, each tile's title bar, edge, strips and dividers, and what opens over the tiles. | Not "chassis", the older word. |
| glance | A program's small view in the top bar's popover; the inbox list is the inbox program's glance. Glance keeps this meaning (decided Nov 3). [The ask desk](../docs/direction/ask-desk.md) | Not the tracker's `Status`. Not the pipeline's verdict `glance`: see the context map. |
| key hints | (decided Nov 3) Words that name keys but cannot be pressed. | Not the toolbar, whose buttons press. |
| layer | (decided Nov 3) One of six named levels the frame draws, low to high: desk, sheet, float, popover, palette, tooltip. Each has an owner and goes when it goes. NSWindow's level, by name. [Layers](../docs/direction/layers.md) | Not a z-index: no program picks a number. Not the five layers of the stack ([a local-first sync engine](../docs/direction/a-local-first-sync-engine.md)): write "a frame layer" where both could be meant. |
| menu | A popover whose rows each do something: the inbox list, the jobs list. "Menu" when each row acts (decided Nov 3). [Popovers](../docs/direction/popovers.md) | Not "popup". |
| menu bar extra | (decided Nov 3) The app's icon in macOS's menu bar, and its popover of rows (approve a tab, quit). Apple's word. [The desktop layer](../docs/direction/the-desktop-layer.md) | Not "menu bar": on macOS that is the system's bar. Not a panel. |
| palette | Cmd-K: every command by name, grouped, with its shell word and keys. VS Code's Command Palette. [Popovers](../docs/direction/popovers.md). Since Nov 7 it is `pick` over the desk's one index in the palette layer: commands first, then things. [Pickers](../docs/direction/picker-guidelines.md) | Not the shortcuts list, which uses the same box. |
| panel | (decided Nov 3) No part of the frame is a panel. Whether a side panel inside a view is a program waits on open call 8, "Is a side panel a program?", moved from [PR 332](https://github.com/usirin/tea-fabrika/pull/332) to [layers](../docs/direction/layers.md#8-is-a-side-panel-a-program). | Not the lines under a top bar item: a popover. Not `C-b ?`: the shortcuts list. Not the menu bar extra's rows: its popover. Not today's `Panel` (last section). |
| peek | (decided Nov 3) Space on a row opens the tile beside, folded or not, on that row's thing, and leaves focus on the list; the peek follows the selection; Enter moves focus in. Linear's word. [Layers](../docs/direction/layers.md) (L6) | Not a float: it unfolds in place and covers nothing. Not a glance, which is a program's view in the top bar. |
| pick | (decided Nov 7) The picker program: rows in, one row out, the type passed through. Cmd-K runs it over the desk's index in the palette layer; `/` on the tracker, or typing `pick`, runs it in a tile as `tracker \| pick \| ticket`. fzf's job. [Pickers](../docs/direction/picker-guidelines.md) (Q9) | Not a search box: search is one source of many. Not the palette, which is the layer it draws in from Cmd-K. |
| popover | A raised box of rows in the views' font. Focus moves in; Escape closes it and puts focus back. Apple's and HTML's word. Popover for the box, menu when each row acts (decided Nov 3). The lines under a top bar item are a popover too. [Popovers](../docs/direction/popovers.md) | Not "popup", which stays only as ARIA's `aria-haspopup`. Not a panel. |
| prefix | `C-b`, pressed before a tezgah key, as in tmux. Each window runs it itself. After it the status bar shows the prefix line. [The desktop layer](../docs/direction/the-desktop-layer.md) (W5) | |
| prefix (picker) | (decided Nov 7) A program's short word, `t` for the tracker; typed with a space in `pick`, it narrows the box to that program's rows, shown as a chip with the program's name. `?` lists them; `@`, `>`, `?` and `#` need no space. Linear's and VS Code's word. [Pickers](../docs/direction/picker-guidelines.md) (Q4) | Not the tmux prefix `C-b` (the row above): an open clash, below. Not `find.word`, the proposed note's older word. |
| presence label | (the word decided Nov 4, the design proposed) A small "✦ claude" name tag on the exact thing an agent's job is writing now, which fades after. Shown, never saved, never decided with: today it is desk state, and in `next/` it rides the ephemeral lane. [Shared tiles](../docs/direction/shared-tiles.md) | Not a flag, which is a command option such as `--all`. Not a cursor or an arrow pointer, dropped everywhere (decided Nov 5): agents send whole writes, so nothing moves. Not the avatar in the title bar, which says who is in the tile. |
| question marker | (decided Nov 3) The mark on a tile that asks the close question. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not "asking marker", the tile guidelines' older word. Not an ask. |
| resize mode | (decided Nov 3, not built) i3's resize mode. A prefix key enters it; the status bar shows RESIZE and a screen reader hears "Resize mode on". `h j k l` move the focused tile's divider, which is a focused `role="separator"` while you move it. Esc or Enter leaves. | Not a drag, which needs no mode. The tile guidelines' "no focusable separators" becomes "focusable only in resize mode" in that note's own pull request. |
| room | (decided Nov 6; note in PR 425) A named place to talk, such as `#bug-17`, whose members are people and agents. `@scout` inside it is a mention. Every room is readable by everyone on the project; you type only in rooms you belong to. Joining one only makes you a member: the prompt stays `fabsh$`, and a line to it starts with `#bug-17` (decided Nov 7, for now; before, a room stuck to the tile like a working directory). `fork #bug-17 at 12 as bar` makes a new room with its parent recorded as a fact. Matrix's word. [Summon guidelines](../docs/direction/summon-guidelines.md#rooms-mentions-and-turns-in-order) | Not a thread: no agent owns a room, and Slack's thread is a chain of replies under one message. Not a channel (Slack, Discord) or a transport channel. Not a tile: a fabsh tile is never in a room. |
| sheet | (decided Nov 3) A program's own modal layer, over its own tile only: that tile's view is inert under it, the rest of the desk is not. At most one per tile. Apple's word, scoped to a tile. [Layers](../docs/direction/layers.md) (L2, L4) | Not the palette, the one desk-wide modal. Not a second program: a view of the same program's model. |
| shortcuts list | (decided Nov 3) `C-b ?`: every key, in the palette's box, titled "Keyboard shortcuts". Its program is `keys`. [Keybindings are configurable](../docs/direction/keybindings-are-configurable.md) (K3) | Not "keys panel", the notes' older words. Not the palette. |
| spot | (decided Nov 5) A thing a person talks to an agent about: a program's `location` (program guidelines, G2) plus the version it came from (the lane, or the plan version), or a list of several rows. Select it and press a key, or click a presence label, and the frame opens a box anchored there; the spot rides with the message, frozen at send. When it goes, as on a rerun, its thread says "old lane". [Talk where you work](../docs/direction/talk-where-you-work.md) | Not a selection, which changes; a spot is what was selected when you sent. Not a location alone, which has no version. Not a tile's "last inner spot" in tile guidelines, a plain word there. Not a comment that edits the thing. |
| status bar | (decided Nov 3) The one line under the tiles: where you are, and the key you just pressed. Stays monospace. [Popovers](../docs/direction/popovers.md), [tile guidelines](../docs/direction/tile-guidelines.md) | Not "bottom line", today's code (last section). Not "status line" (a machine's line). Not "footer", which is only a popover's last row. |
| summon | (decided Nov 4: an agent is summoned into the person's tile; the words proposed) Bring an agent into a tile: `@claude <words>` in tsh starts claude if it is not on the desk (decided Nov 5; there is no `summon` word in tsh), the palette's "Summon claude here", or (proposed Nov 5) the "summon <name> here" row in any text box's `@` menu. Any agent that speaks the agent link may be summoned. Focus does not move. [Shared tiles](../docs/direction/shared-tiles.md) | Not opening an agent's own tile: that kind is gone. Not delegating a ticket. Not starting a program. |
| text style | One of six: `title`, `heading`, `strong`, `body`, `quiet`, `label`. Every size comes from one. [Typography](../docs/direction/typography.md) | Not "text role", the study's first word. |
| thread | (decided Nov 5) The talk with an agent about one spot. Its first 1 or 2 turns stay in the box at the spot; then it moves to the one thread tile, reused for every spot, which always names its spot, so there is no blank one. While the tile shows it, the spot shows only a chip, "N replies · in t3". [Talk where you work](../docs/direction/talk-where-you-work.md) | Not a room (decided Nov 6): a named talk typed in the shell, such as `#bug-17`, is a room, and the walked-back `@scout#bug-17` named threads of an agent are gone. Whether this spot talk becomes a room with its spot recorded is open, lean yes. Not Slack's thread, a chain of replies under one message. Not a chat program: it cannot open without a spot. Not tsh, the place for open-ended talk. Not an OS thread. Not an ask: a reply becomes an ask only when it ends in a real question (a lean). |
| tile | One rectangle of a workspace; it shows one process. tmux says pane. Each program in a line shows in a tile (decided Nov 3). [Tile guidelines](../docs/direction/tile-guidelines.md), [the desktop layer](../docs/direction/the-desktop-layer.md) (W3) | Not "window". |
| title bar | A tile's own bar: slot, program name, state word, tile id. A mono `header`. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not the top bar. |
| toolbar | (decided Nov 3) A row of buttons built from a program's `commands`, each with its key printed on it, `role="toolbar"`. | Not "action bar" or "keys line", which it replaces. Not key hints. |
| top bar | The bar across the top: the workspace list, the line, the app's icon and name, then the items. Stays monospace. [Popovers](../docs/direction/popovers.md), [top bar name](../docs/direction/top-bar-name.md) | |
| window | (decided Nov 3) The app's OS window, and the client that draws it and sends a person's keys; the two agree. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not a program's drawing, which is its view. Not a tile of a line. Not "peer". |
| workspace | One numbered layout inside tezgah, with one focused tile. i3's word. [The desktop layer](../docs/direction/the-desktop-layer.md) (W4) | |
| zoom | (decided Nov 3) Alone, always tile zoom: `C-b z` draws one tile alone, and again undoes it. tmux's word. The other two are always written in full: page zoom (the page's scale, WCAG 1.4.10) and window zoom (macOS's zoom of the whole window). [Tile guidelines](../docs/direction/tile-guidelines.md) | Not a bare "zoom" for page zoom or window zoom. |

## Context map

How the contexts talk, and how each word that crosses a border translates. The map is Evans's:
"Describe the points of contact between the models, outlining explicit translation for any
communication" (DDD Reference). His relationship names are used only where they fit.

How the contexts meet:

- **Shared names are a shared kernel.** Small, used by every context, changed only in a pull
  request that changes this file too.
- **Ledger supplies, the rest are its customers** (customer/supplier). Tracker, pipeline and
  runtime write facts and fold them; the data layer gives them three calls, `append`, `read` and
  `wait`, and coordination gives them `Registry`, `Mailbox`, `LeaseManager` and `ProcessManager`.
- **Pipeline and tracker are partners.** A lane is one ticket's run, and the ticket is the lane's
  view. The pipeline asks; the tracker's inbox shows the ask. Neither owns the other's words.
- **GitHub sits behind an anticorruption layer,** `CodeHost`. GitHub's issue, review and check run
  are translated there; none of their words leaks in as ours.
- **Runtime and frame speak a published language,** the window protocol (A3): a view, its `rev`,
  and Msgs that name the `rev` they saw.
- **Clients reach the brain through an open-host service,** the door: JSON-RPC 2.0 over one
  WebSocket per client. Any client that speaks it may dial.
- **Records talk about every context** and translate nothing. A record says which context and
  which version a claim is about.
- **Today's version sits behind an anticorruption layer too:** the last section translates its
  words into these, so none leaks in.

Each word that crosses a border, one line each:

- **inbox:** the ledger's inbox is a stream a write comes in by (`build:7/inbox`); the tracker's
  inbox is the list a person reads. An ask crosses as `asked` and `answered` facts, never as the
  word. Decided Nov 3.
- **envelope:** in runtime, an input as the host's door stamped it, `Envelope<A>`; in saved
  state, the fields around a ledger entry (`by`, `sentAt`, `arrivedAt`, `seen`). An input's envelope causes a
  write, and the write's entry names it as its `cause`. Always write "an input's envelope" in a
  ledger note.
- **line:** the runtime's line is what a person types in the shell; the ledger's line is what a
  writer hands to `append`, `Line` in code. A program's write becomes a ledger line, never a
  shell line. In a ledger note, say "a ledger line" when the shell is near.
- **lane:** the pipeline's lane is a ticket's run; the clients' ephemeral lane is an at-most-once
  channel. Always write "ephemeral lane" in full; a bare "lane" is the pipeline's.
- **project:** the tracker's project is a parent plan; the ledger's project object is the Durable
  Object that holds a team's ledger; a tracker project's tickets are facts on that ledger. In the
  ledger context, say "project object".
- **run:** a running program is a process (runtime); an agent run is one agent session (records).
  When agents become programs (proposed, [agents are
  programs](../docs/direction/agents-are-programs.md)), an agent run is one process of the
  `claude` or `codex` program.
- **job:** the runtime's job is a root and everything under it; the clients' job is work the
  hands take with a lease. The notes do not yet say whether one is a case of the other.
- **glance:** the frame's glance is a program's small view in the top bar; the pipeline's
  `glance` is a verdict that carries when only the patch-id matches.
- **fold:** the ledger's fold is state worked out from facts; the frame's fold is a tile folded
  to a strip. Write "fold of facts" or "fold a tile".
- **view:** the runtime's view is what a program draws; the tracker view is one way to see
  tickets, and it is a program, so it has a view of its own.
- **rev and saw:** in the ledger, `rev` is an entry's place and `saw` the hash on an answer; on
  the window protocol, `rev` is a view's revision and `saw` the one a Msg saw.
- **window and agent:** one thing seen from two sides. The frame's window and the pipeline's
  agent are, at the door, two kinds of client.
- **ask and close question:** the tracker's ask is what an agent or a step asks a person; the
  frame's close question is a tile's y/n. The close question is never called an ask.
- **ticket:** our ticket is never a GitHub issue. `CodeHost` reaches pull requests, checks and
  the merge queue; no ticket copy goes to GitHub Issues.
- **stop:** the pipeline's stop is a lane halting itself; the shell's built-in `stop` (runtime) is
  a shell word, not a lane's halt.
- **primitive:** the pipeline's word. From any other context, write "pipeline primitive".

## Open clashes

Only a word with two meanings, or one meaning with two words, inside one context, with what would
settle it.

- **prefix, in the frame.** `C-b` is the prefix (the desktop layer, W5), and `pick`'s `t` is a
  prefix too ([pickers](../docs/direction/picker-guidelines.md), Q4, decided Nov 7). Both are frame
  words. tmux owns the first; Linear and VS Code use the second. Settled when the owner renames one
  of them.

The four this file's walk found were settled on Nov 3, and each answer is in its row: the resume tag
is `start`, a project ends and an area does not, the word is step and not stage, and primitive and
not move.

## Today's version says
The translation list for today's version (`packages/`, `programs/`, `packs/`, `apps/`), and only
where its code says another word or means another thing. In DDD terms it is an anticorruption
layer (Evans): today's words are translated here and never leak into the sections above. It is
deleted with today's code ([clean slate](../docs/direction/clean-slate.md)). It sits in this file,
not its own, because `fabrika glossary check` reads only `TERMS.md` and `LANGUAGE.md`.

| Today's word | Where in today's code | Say instead |
|---|---|---|
| `.border` | The class on the 4px you drag between tiles, `apps/fabrika/src/window/window.css`, and "border" in `apps/fabrika/src/desk/layout/` | divider (Frame) |
| `@kampus/fabrika-app-old` | Today's app, `apps/fabrika` | `@kampus/fabrika`, the app (Shared names) |
| `@kampus/fabrika-old` | Today's library, `packages/fabrika` | `@kampus/libfabrika` (Shared names) |
| asks list | The top bar's menu of open asks, `apps/fabrika/src/window/frame.tsx` and `apps/fabrika/src/asks.ts`; the frame's own, not a program | the inbox program's glance (Tracker, Frame) |
| `at` (on an entry) | The referee's time on an entry, such as `at: now` in `packages/fabrika/src/host/memory.ts`; also the envelope's `at` in [inputs carry their sender](../docs/direction/inputs-carry-their-sender.md) | `arrivedAt` (Ledger). Today's code and notes about today's version keep `at` until that code goes (renamed for `next/` Nov 5). |
| `bare` | `Frame.bare`, `apps/fabrika/src/window/frame.ts`; its key and shell word already say `bars` | bars hidden, `barsHidden` in code (Frame) |
| bottom line | The line under the tiles, `apps/fabrika/src/window/frame.ts` and `frame.tsx` | status bar (Frame) |
| `desk` | The window manager's machine, `apps/fabrika/src/desk/desk.ts`; also "the owner's desk" for the asks and "the ask desk" | tezgah (Shared names); the inbox and the inbox program (Tracker) |
| `Head` | A ticket's top line, `programs/tracker/src/head.ts` | Status (Tracker) |
| host (today) | A running process that runs tea programs, OTP's node, `packages/fabrika/src/host/` | the brain, where programs run (Clients). A host is a place hands run. |
| `kind` | The case key of entries and outcomes, such as `packages/pipeline/src/stages/outcome.ts` | `_tag` (Shared names) |
| Ledger (today) | The one `Ledger` service, about 25 methods, with layers 2 to 4 mixed, `packages/fabrika` | `Ledger` (`append`, `read`, `wait`), plus `Registry`, `Mailbox`, `LeaseManager`, `ProcessManager` and `LimitManager` (Ledger, D6) |
| mailbox (today) | A run's one queue of inputs; past its capacity a `tell` fails `MailboxFull` ([tea-program](../docs/direction/tea-program.md)) | a process's inbox, which the `Mailbox` service writes (Ledger) |
| `Open.ask` | The tile asking y or n, `apps/fabrika/src/desk/desk.ts` | `question`, the close question (Frame) |
| `Panel` (today) | The lines under a top bar item, `apps/fabrika/src/window/pop.tsx` | a popover; no frame part is a panel (Frame) |
| pos (today) | An entry's place in the whole log, `packages/fabrika/src/host/memory.ts` | `rev` (Ledger) |
| rev (today) | An entry's place in its stream, `packages/fabrika/src/host/memory.ts` | `pos` (Ledger) |
| run | One start of a program, with a run handle and one span ([tea-program](../docs/direction/tea-program.md)) | process (Runtime) |
| `run` (resume tag) | The resume point's tag, `Resume` in `packages/pipeline/src/stages/pipeline/machine.ts` and `restart.ts` | `start`, `{_tag: "start", step}` (Pipeline) |
| `said` (on an entry) | The writer's own clock on an entry, in notes about today's version and the older notes' sketches; today's entries have none | `sentAt` (Ledger). Notes about today's version keep `said` (renamed for `next/` Nov 5). |
| stage | A step and its machine: `fact.stage` (`packages/pipeline/src/tickets/ticket.ts`), `Stage` (`packages/pipeline/src/sandboxes.ts`), the `packages/pipeline/src/stages/` folder and the docs in `stages/outcome.ts` | step (Pipeline) |
| tsh | Today's shell, `packages/fabrika/src/shell/` ([tsh](../docs/direction/tsh-a-shell-for-tea-programs.md)) | fabsh (Shared names) |
| tsh line | What a person types in tsh | line (Runtime) |
| windows (of a line) | "A line's windows", `apps/fabrika/src/desk/desk.ts` and `apps/fabrika/src/desk/layout/` | tiles (Frame) |
