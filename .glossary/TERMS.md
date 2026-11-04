# tea-fabrika domain vocabulary (TERMS)

The repo-owned vocabulary spine. One row per term: the canonical definition, and where a name has
drifted, what the term is **not**. When the code and this file disagree, the code is authoritative
and this file is the doc to fix.

This is the project's ubiquitous language, the idea from Domain-Driven Design (Eric Evans): one word
for one thing, used the same way in notes, code, tickets and talk. A word that means two things here
is a bug to fix ([use the industry's names](../docs/direction/use-the-industrys-names.md)).

How to read a row:

- **Two versions live here** (AGENTS.md, "Two versions, side by side"). "Today's" means the code in
  daily use (`packages/`, `programs/`, `packs/`, `apps/`). "`next/`" means the new version, which is
  not on main yet. A word that differs between them says so in its row.
- **A row cites the note that decides it**, by relative link. A row that rests on a note still in a
  pull request says "(proposed, PR n)", and its word may change when that pull request lands.
- **The Not column** lists old names, wrong names and nearby words a reader may mix it up with.
- **A word with two live meanings** says both, and is listed under [Open clashes](#open-clashes) at
  the end. This file names a clash; it does not settle it.

Add or change a row in the same pull request that coins or renames a word.

## The project and its records
| Term | Definition | Not |
|---|---|---|
| agent hour | The unit of size: one agent's wall clock, summed, failed runs in, drivers out. A ticket's `estimate` uses a doubling scale from 0.25 to 8; its `spent` is folded from run facts, never typed. [Agent hours](../docs/direction/agent-hours.md) | Not human days. |
| direction note | One decision in `docs/direction/`, marked decided or proposed. Industry: an architecture decision record. [Direction](../docs/direction/README.md) | Not an experiment: a note decides, an experiment measures. |
| experiment | A numbered measurement: `experiments/NN-title.md` and its script. It records what was tried and what came back. [Experiments](../experiments/README.md) | Not a decision. Not the `experiment` program, which shows one. |
| field log | `field/runs.jsonl` and `field/notes.jsonl`: one row per agent run on a real ticket, one note per thing that broke, cost too much, needed a person or worked well. [Field](../field/README.md) | |
| next/ | The new version of fabrika, built on the five layers and on the notes in `docs/direction/`, never on today's code. Not on main yet ([PR 223](https://github.com/usirin/tea-fabrika/pull/223)). [Clean slate](../docs/direction/clean-slate.md) | Not today's version. A name that exists in both may mean different things: check the path. |
| owner | The person who sets direction, approves plans and is the only one who changes the exam. [Nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md) | Not "the user" in a note about who decides. |
| tier | One whole slice of `next/` a person can use, built in order. Tier 1 is the first. [The tiers](../docs/plan/tiers.md) | Not a priority level: fabrika has no priority. |
| today's version | Everything outside `next/` (`packages/`, `programs/`, `packs/`, `apps/`, `wip`, `legacy`): the fabrika in daily use until `next/` takes each job over. Its library is `@kampus/fabrika-old`, its app `@kampus/fabrika-app-old`. [Clean slate](../docs/direction/clean-slate.md) | Not `@kampus/fabrika`, which in `next/` is the new app. |

## Products and packages
| Term | Definition | Not |
|---|---|---|
| demlik | The repo that holds tea, and the first real repo lanes ran on. [demlik is the first real repo](../docs/direction/demlik-is-the-first-real-repo.md) | |
| fabrika | The product: project management where code holds the loop and an agent does one bounded job inside it. In `next/`, `@kampus/fabrika` is the app and `@kampus/libfabrika` the library. [Control lives in code](../docs/direction/control-in-code.md), [where each piece lives](../docs/direction/where-each-piece-lives.md) | Not `@kampus/fabrika-old`, today's library. |
| fabrika.toml | The settings file: `.fabrika/fabrika.toml` for a repo, `~/.fabrika/fabrika.toml` for a person. Knobs only; the step order stays in code. An unknown key fails. [One fabrika.toml per repo](../docs/direction/one-fabrika-toml-per-repo.md) | Not `ledger.json` or `tsh.toml`, which it replaces. |
| fabsh | `next/`'s shell, a regular program with local echo. [The desktop layer](../docs/direction/the-desktop-layer.md) | Not `tsh`, which stays in today's version. |
| Jev | A cheap model service that answers one narrow question (the Judge move). Measured by how often it agrees with the big model, never trusted to remove a person. [Jev](../docs/direction/jev-same-answer-cheaper.md) | Not an agent: it does no open-ended work. |
| Manti | Manti UI (`@manti-ui/react`, `@manti-ui/styles`): the component library every part of the app's UI is built on, with our own tokens. A better way goes into Manti by pull request. [UI on Manti](../docs/direction/ui-on-manti.md) | Never "Manti or native". |
| pack | An add-on: programs in a package, turned on by one `[pack.<name>]` line in `fabrika.toml` and pinned in `.fabrika/fabrika.lock`. The core never knows it exists. Industry: a plugin. [Packs are programs](../docs/direction/packs-are-programs.md) | Not a "catalog": that word was dropped. |
| tea | `@demlik/tea`: the Elm architecture in TypeScript (machines, Msgs, Cmds, Subs), run on its Effect engine. The engine under every program; it stays small and does not grow to fit a host. [tea is the engine](../docs/direction/tea-is-the-engine.md), [Elm first](../docs/direction/elm-first.md) | Not Effect `Workflow` or an actor runtime, both banned as a machine's replacement. |
| tsh | Today's shell: a Unix-style shell that runs only tea programs, joined by typed pipes. [tsh](../docs/direction/tsh-a-shell-for-tea-programs.md) | Not `fabsh`, `next/`'s shell. |
| Tuval | Codename for the desktop layer, layer 5, and in `next/` the `@kampus/tuval` package. People see "fabrika". [The desktop layer](../docs/direction/the-desktop-layer.md) | Not a name shown to people. |

## Tickets and the tracker
| Term | Definition | Not |
|---|---|---|
| area | (proposed, experiment 205, [PR 361](https://github.com/usirin/tea-fabrika/pull/361)) A long-lived grouping of tickets by part of the product or the code, which never ends, as Jira's components or Kubernetes' `area/` labels. Waits for that experiment's designs. See Open clashes. | Not a project, which ends. Not a label that gates a build. |
| ask | A question the machine puts to a person, for a decision or an act, never for a fact. It is the `asked` and `answered` facts, with a hash of what the person saw; the first answer wins. Also the stage verb `ask`. [Ask for decisions, not facts](../docs/direction/ask-for-decisions-not-facts.md), [one ask and one meter](../docs/direction/one-ask-and-one-meter.md) | Not the close question (`close t2? (y/n)`). Not "popup". |
| asks (program) | The program that lists every open ask: a tile beside the selected ask, and a glance in the top bar. Today it is the frame's menu, not a program; in `next/` it comes in Tier 5. Its name is open: G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) weighs keep `asks` 45%, `questions` 25%, `decisions` 20%, `waiting` 10%. [The ask desk](../docs/direction/ask-desk.md) | Not "ask desk", the note's title, which [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes renaming to "asks program" (70%). Not "inbox", ruled out. |
| criterion | A promise a reviewer reads, which ends with the ticket. Open or met; a builder may not shrink one, and "cannot meet as written" is its honest exit. [Done is per criterion](../docs/direction/done-is-per-criterion.md), [the plan stage](../docs/direction/the-plan-stage.md) | Not a property, which a tool checks and which lasts. |
| judgment | A decision only a person can make. It is the only thing the pipeline asks a person for; everything else code fixes, retries or prevents. [Jidoka and andon](../docs/direction/jidoka-and-andon.md), [pipeline guidelines](../docs/direction/pipeline-guidelines.md) | |
| plan | The plan step's answer for one ticket: tasks, criteria and properties, approved by the owner by version and a hash of the ticket's text. An epic is a plan with many tasks. [The plan stage](../docs/direction/the-plan-stage.md), [a free-form plan goes to the planner](../docs/direction/free-form-plan-to-planner.md) | |
| project | Two live meanings. (1) A parent plan: a group of tickets, as in Linear ([a project is a parent plan](../docs/direction/a-project-is-a-parent-plan.md)). (2) `next/`: the project object, one shared Durable Object that holds a team's ledger, claims, inboxes and process tree ([the five layers](../docs/direction/a-local-first-sync-engine.md)). Experiment 205 ([PR 361](https://github.com/usirin/tea-fabrika/pull/361)) proposes a project as a grouping that ends, beside an area that does not. See Open clashes. | Not a repo, though today one host and one Worker run per project. |
| property | A promise a tool checks, kept as a test after the ticket ends: `{when, result, why, behavior, tool, stories, code}`, id `p<n>`. [The plan stage](../docs/direction/the-plan-stage.md) | Not "promise", the older note's word. Not a criterion. |
| rec | The step's recommendation on an ask, written before the ask, with its why, cost and how sure. `y` takes it, `n` refuses it with a note. [The ask desk](../docs/direction/ask-desk.md) | |
| ticket | One unit of work in the tracker. Its facts live on the ledger and its state is their fold. One ticket, one pull request. Industry: issue. [The ticket is the lane view](../docs/direction/the-ticket-is-the-lane-view.md) | Not a GitHub issue. |
| timeline | A ticket's facts in order, comments included, one row per fact. The main window for people and the main context for agents. [What a ticket shows](../docs/direction/what-a-ticket-shows.md) | |
| tracker | fabrika's own issue tracker, built like Linear. Tickets are ledger facts; GitHub stays the code host, reached through `CodeHost`. Also today's `tracker` program. [Tickets start in our tracker](../docs/direction/tickets-start-in-our-tracker.md), [the tracker is like Linear](../docs/direction/the-tracker-is-like-linear.md) | Not GitHub Issues: no ticket copy goes there. |

## The pipeline
| Term | Definition | Not |
|---|---|---|
| box | The sandbox a program runs in: the `Sandbox` service, with a layer per box (Docker, sandbox-runtime, none). No real key goes in. [Programs run in a box](../docs/direction/programs-run-in-a-box.md) | |
| build | The step where an agent writes code until every check is green. It ends with a local commit and pushes nothing. [Nothing is pushed before review](../docs/direction/push-after-review.md) | |
| combo | A shape built from moves that keeps coming back: refine, gate, ask, remember, spawn (`packages/pipeline/src/combos.ts`). No new move without a reason. [Reuse before special rules](../docs/direction/reuse-before-special-rules.md), [new combos](../docs/direction/new-combos.md) | |
| exam | What code is checked against: a machine's laws, the checker, a ticket's criteria, CI and lint rules. An agent that writes code never changes it; the owner does, in its own pull request (the `exam` steps). [Nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md) | |
| finding | One thing a reviewer, a mutant or a scheduled job found. A person rates it `fix` or `noise`; one never rated counts as noise once its change ships. Industry: a SARIF result. [Every finding is rated](../docs/direction/every-finding-is-rated.md) | |
| helper | A small agent a stage asks for a fact it lacks, never another stage. Also called a scout. [Helpers, and one supervisor](../docs/direction/helpers-and-the-supervisor.md) | Not a supervisor: fabrika has none, the host starts and restarts runs. |
| kept, glance, stale | How a review verdict or a person's yes carries to a new head: `kept` (same head, a clean replay or a format-only change), `glance` (only the patch-id matches), `stale` (otherwise). [A yes binds to the diff](../docs/direction/a-yes-binds-to-the-diff.md) (proposed) | This `glance` is not the asks glance. See Open clashes. |
| lane | One ticket's run through the pipeline on its assignee's host, claimed on the ledger. Today's parent machine `lane` steps each step in turn. [A ticket runs from the app](../docs/direction/a-ticket-runs-from-the-app.md) | Not the ephemeral lane, `next/`'s at-most-once channel. See Open clashes. |
| laws | A machine's rules, which a checker walks through every message order of its real reducer. A machine with no laws, or a message never sent, fails the suite. [Every machine has laws](../docs/direction/every-machine-has-laws.md) | |
| move | One of the six building blocks of every step: Gather (code reads), Act (code writes), Listen (code waits), Draft (an agent produces), Check (code judges), Judge (Jev answers one narrow question). `packages/pipeline/src/primitives.ts`. | The file says primitives; the notes say moves. |
| mutation | The `mutation` step: Stryker makes small breaks (mutants) the tests must catch. In the `mutants` step each survivor gets `test`, `cannot` or `noise`. [A fast check per pull request](../docs/direction/fast-and-daily-mutation.md) | Not our own search engine: Stryker is the grader. |
| outcome | How a stage ends, in five verbs: `done`, `send`, `ask`, `skip`, `stuck`. Passing it on is `verb:who:why`, ending here is `verb:why`. [Outcome names](../docs/direction/outcome-names.md) | |
| pipeline | The steps a ticket goes through from filed to merged, each run by its own agent, with laws. Every pull request goes through it. Also the package `@kampus/pipeline` and today's `pipeline` program. [Every pull request goes through the steps](../docs/direction/next-is-a-pipeline-pre-run.md) | G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) flags the `pipeline` program's name: it also means the package and the whole chain. |
| resume point | Today's `Resume` (`packages/pipeline/src/stages/pipeline/machine.ts`): where a stopped lane goes on, `{_tag: "run", step}` or `{_tag: "ask", for, step}`. A restart keeps finished steps and never starts over. | Its `run` is "run this step", not an agent run. See Open clashes. |
| review | One review of the whole diff, by a different agent from the builder. The reviewer only finds; code works out pass or fail. [Nobody grades their own work](../docs/direction/nobody-grades-their-own-work.md), [one review a plan](../docs/direction/one-review-a-plan-and-the-cloud-in-v1.md) | Not an approval: no agent approves a pull request. |
| run | Three live meanings. (1) Today's `tea-program`: one start of a program, with a run handle and one span ([tea-program](../docs/direction/tea-program.md)). (2) An agent run: one agent session, a row in `field/runs.jsonl`. (3) A resume point's `_tag: "run"`. See Open clashes. | In `next/` one running copy of a program is a process. |
| ship | The merge: today's ship code, the one merge authority. A person's comment goes to that person, a bot's back to the builder. [Ship stage rules](../docs/direction/ship-stage-rules.md) | Not a merge by hand, and never auto-merge. |
| stage | A step seen as its own machine, which answers in the five outcome verbs. Notes and code use stage and step for one thing: a fact's `stage` holds a lane step (`packages/pipeline/src/stages/pipeline/restart.ts`). [One parent, stages as slots](../docs/direction/one-parent-stages-as-slots.md) | Not a separate thing from a step. |
| step | One place in a lane, in this order: `triage`, `plan`, `exam`, `exam_review`, `exam_merge`, `test_writer`, `build`, `mutation`, `mutants`, `review`, `push`, `merge` (`STEPS`, `packages/pipeline/src/stages/pipeline/routes.ts`). | Today's code uses "stage" for the same thing in places (`fact.stage`). |
| stop | Where a lane halts itself, with its reason, on what code cannot fix (Toyota's andon). Every stop saves where the lane goes on; a person's `stop` is a saved pause. [Jidoka and andon](../docs/direction/jidoka-and-andon.md) | Not the `stuck` verb alone. Not the tsh built-in `stop`. |
| test writer | The agent that writes one test per property after the owner's approval, red first for a new one, and answers each surviving mutant. [The test writer](../docs/direction/the-test-writer.md) | Not "verify writer", its old name. Not the builder. |
| triage | The first step. It answers duplicate, decline, accept or escalate, and asks the owner when worth is unclear. No priority and no "later". [Sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md), [triage asks when worth is unclear](../docs/direction/triage-asks-when-worth-is-unclear.md) | Not "sort", its old name. |

## Programs, processes and jobs
| Term | Definition | Not |
|---|---|---|
| Cmd | A request for an effect, with typed `input`, `ok` and `err`, defined through a move or tea's `Cmd.define`. Elm's Cmd. | |
| commands | A program's `commands` field: each a Msg with its keys, and each also a tsh word and a palette row. [Modes](../docs/direction/modes.md), [keybindings are configurable](../docs/direction/keybindings-are-configurable.md) | |
| input | What a program is told while it runs, like stdin. Told at any time, never waiting, served in order through the run's one mailbox. One input per command, apart from the one `query` (CQRS). [tea-program](../docs/direction/tea-program.md), [tracker views are programs](../docs/direction/tracker-views-are-programs.md) | |
| job | What one start made: a root and everything under it, like a process group (a tsh line, a lane). The host's, not the shell's. [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md), [the host keeps terminals and jobs](../docs/direction/the-host-keeps-terminals-and-jobs.md) | In `next/`'s hands words, a job is also work taken from the queue with a lease ([brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)). |
| JobRecord | One Durable Object per job: its runs' storage, its spans from every host, and pointers to agent logs. Nothing is ever deleted except agent content a person removes. [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md) | Not Jaeger, which it replaced. |
| location | (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)) Where a program is now, read from its tile's own machine and named for its program (`AsksLocation`). Opening the same location focuses its tile. | Not `at`, its old name: `at` is a time. |
| machine | A tea state machine: a model, the Msgs its `update` takes, and the Cmds it asks for. Parents are written by hand and step their children. [Elm first](../docs/direction/elm-first.md) | Not a program. Not a computer: that is a host. |
| mailbox | A run's one queue of inputs, served one handler at a time; past its capacity a `tell` fails `MailboxFull`. In `next/`, the coordination service `Mailbox` (send, receive), OTP's word. [tea-program](../docs/direction/tea-program.md) | Not an inbox, which is a ledger stream. |
| mode | A program's state that changes what keys do, per window, always shown in words; Escape always leaves. No mode is `null`. [Modes](../docs/direction/modes.md) | |
| Msg | A message a machine's `update` takes. tea's Msgs keep `type` as their tag. | Not `_tag`, which is for unions we define. |
| output | An event a program sends: heard once, kept nowhere. What a late viewer needs is a machine's state. [tea-program](../docs/direction/tea-program.md) | Not a Cmd: an output has no answer. |
| pipe | `from \| to`: one program's outputs fed to the next one's typed inputs. An `anyInput` takes the source's first output. [tea-program](../docs/direction/tea-program.md), [an input can take anything](../docs/direction/an-input-can-take-anything.md) | |
| process | `next/`: one running copy of a program, with its own pid, in its own object. [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) (A3) | Today's code calls this a run. |
| program | What you start: a name, flags, inputs, outputs, and `main`, which runs tea machines (`defineProgram`). It uses machines and is not one. [tea-program](../docs/direction/tea-program.md) | Not a machine. Not a process, which is one running copy. |
| program name | The word a person types in the shell, reads in the title bar and hears first in a tile's accessible name: `ticket #7`. G8 (proposed, [PR 332](https://github.com/usirin/tea-fabrika/pull/332)): a noun for what the tile shows, plural for a list; 2 to 9 small letters; one meaning; a phrase is written from the noun. [Tile guidelines](../docs/direction/tile-guidelines.md) | |
| trace | A job's spans, in OpenTelemetry's words, and the `trace` program that draws them. An agent run keeps its content in the trace. [A JobRecord holds its trace](../docs/direction/a-job-record-holds-its-trace.md), [an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md) | |
| tsh line | What a person types in the shell: programs joined by pipes, such as `tracker \| ticket \| trace`. The top bar's "the line" shows it. | Not the bottom line, the prefix line or the keys line. |
| view | What a program draws: data picked from its state by a pure `select`, drawn by its window code. Elm's word. [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) (A3) | Not "window" for a program's drawing (proposed, [PR 353](https://github.com/usirin/tea-fabrika/pull/353)). Each tracker view is its own program ([tracker views are programs](../docs/direction/tracker-views-are-programs.md), proposed). |

## The ledger
| Term | Definition | Not |
|---|---|---|
| at | The referee's clock on an entry. Leases, limits and order use only this. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D3) | Not a place: that is `location`. Not the writer's clock: that is `said`. |
| by | Who wrote an entry, stamped by the door from the signed-in key, never typed by the writer. | |
| claim | "This work is mine": a compare-and-set on the ledger with a lease, so two agents never spend money twice on one ticket. The ledger records only when a claim changes hands. [The five layers](../docs/direction/a-local-first-sync-engine.md) (C3) | |
| entry | One line of the ledger. In `next/` (D3): `id`, `stream`, `pos` (place in its stream), `rev` (place in the whole log), `at`, `by`, `said`, `_tag`, `body`, EventStoreDB's fields in short words. [The five layers](../docs/direction/a-local-first-sync-engine.md) | Today's entries say `kind` for `_tag`, and swap `pos` and `rev`. |
| fact | One ledger entry about something that happened (`filed`, `asked`, `claimed`). Kept for good; state is a fold of facts. Industry: an event. [Data first; markdown is a view](../docs/direction/data-first-markdown-is-a-view.md) | Not markdown: markdown is made from facts and never read back. |
| fold (of facts) | State worked out from facts in order, as a reducer over an event log. A ticket's status is a fold; done is a merged pull request or a person's close, never a drag. | Not folding a tile (`C-b f`). |
| inbox | Two live meanings. (1) A ledger stream others write to, the one open door to a name: `build:7/inbox`, and a ticket's write inbox, `tracker/ticket/43/inbox` ([the five layers](../docs/direction/a-local-first-sync-engine.md), C2). (2) A person's list of things waiting, Linear's Inbox; [PR 353](https://github.com/usirin/tea-fabrika/pull/353) leans to calling the owner-desk pack an inbox. See Open clashes. | Not a mailbox, a run's queue of inputs. |
| lease | A claim that lasts 30 s and is renewed every 10 s. An old holder stays valid until a newer claim exists (Kafka's epoch rule). `LeaseManager`: claim, renew, release. [The five layers](../docs/direction/a-local-first-sync-engine.md) (C3) | |
| ledger | The record: one append-only log per project, with named streams inside it, and three calls (`append`, `read`, `wait`). Today's `Ledger` service mixes all three lower layers; `next/` splits it. [The ledger behind a service](../docs/direction/ledger-behind-a-service.md), [the five layers](../docs/direction/a-local-first-sync-engine.md) | Not a table of rows that are overwritten. |
| Manager (service) | An Effect service that holds many of one thing is named `<Thing>Manager`: `LeaseManager`, `ProcessManager`, `LimitManager`. A service name is never plural. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D6) | Not a plural service name such as `Leases`. |
| referee | The one object that orders writes and grants leases: the project's Durable Object, one call at a time. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D1) | |
| rev | `next/` (D3): an entry's place in the whole log, beside `pos`, its place in its stream. Also a view's revision on the window protocol, which a window Msg names as `saw` ([the cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md), A3). Today's ledger swaps the two: `rev` is the place in its stream and `pos` the place in the whole log (`packages/fabrika/src/host/memory.ts`). Check the path before you trust it. | Not a git revision. Not the same number in both versions. |
| said | The writer's own clock on an entry: shown, never used to decide, and kept out of the deciding code's types. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D3) | Not `at`. |
| saw | Two uses. On a window Msg, the view revision it saw (A3). On an answer to an ask, the hash of what the person saw (`packages/pipeline/src/combos.ts`). | Not `seen`, a writer's last folded rev. |
| seen | The last rev an entry's writer had folded when it wrote. [Saved state](../docs/direction/saved-state.md) | Not `saw`. |
| stream | A named part of the log, such as `build:7` or `desk`. A name owns `build:7`, `build:7/inbox` and `build:7/dead`; claims and inboxes are streams too. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D2) | |
| _tag | The case key of every union we define, written by Effect Schema (`TaggedUnion`, `TaggedStruct`, `TaggedError`), never by hand. [Schema classes](../docs/direction/schema-classes-not-of-helpers.md) | Not `kind`, which today's entries and outcomes keep. Not `type`, which tea's Msgs and Cmds keep. |

## The five layers (next/)
| Term | Definition | Not |
|---|---|---|
| agent | A model doing one bounded job inside code's loop. In `next/`, the third kind of client, through the bridge. No agent approves a pull request or answers a question put to a person. [Control lives in code](../docs/direction/control-in-code.md) | Not Jev, which answers one narrow question. |
| brain | `next/`: where programs run and keep their state, on workerd everywhere, the laptop included. [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md) | Not "runner". Where an older note says host for this, read brain. |
| capabilities | What a host can do, sent in the hello as `has`; a Cmd says what it `needs`. A capability says "can", never "may": may is a grant on the ledger. MCP's word. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | |
| client | Any of hands, a window or an agent, and only when talking about the door's protocol. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not "peer" and not "node", both gone. |
| door | Where every client comes in. It stamps each entry's `by` from the signed-in key. [The ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md) | |
| ephemeral lane | `next/`: an at-most-once channel on the same transport, for pokes, presence and terminal bytes. Show it, never save it, never decide with it. [The five layers](../docs/direction/a-local-first-sync-engine.md) | Not a lane, which is a ticket's run. See Open clashes. |
| five layers | `next/`'s design, bottom to top: transport (one WebSocket per client to its own gateway, JSON-RPC 2.0), data (the ledger), coordination (claims, inboxes, the process tree, who is online), app (programs, Cmds, windows, limits, packs), desktop (Tuval). Each uses only the one below. [A local-first sync engine](../docs/direction/a-local-first-sync-engine.md) | Not "link layer" for transport, not "nodes" for coordination. |
| gateway | One object per client, which the client dials and which answers its text ping. Hands meet only through the brain, gateway to gateway. [The five layers](../docs/direction/a-local-first-sync-engine.md) (T2) | |
| hands | `next/`: what takes jobs from the queue, with a lease, and acts on one computer. Node runs only the hands. [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not a place: hands are a job, and a host is where they run. |
| host | Two meanings, by version. Today's: a running process that runs tea programs, OTP's node ([tea-host](../docs/direction/tea-host.md)). `next/`: a place hands can run, such as a Mac, a VM or a browser profile ([brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)). The brain on Cloudflare is not called a host. | Not a client: a host is where things run, a client is what dials. |
| poke | "Come read": the brain sends `ledger.appended` with `{rev, streams}`, at most once, and the client pulls after the last rev it has. Replicache's word. [The five layers](../docs/direction/a-local-first-sync-engine.md) (D4) | |
| window | Today's: the app's one OS window. `next/`: also the client that draws and sends a person's keys, and the two agree. [PR 353](https://github.com/usirin/tea-fabrika/pull/353) leans to calling a program's drawing a view and a line's windows tiles (80%). [Brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md) | Not "peer". |

## The window and the frame
| Term | Definition | Not |
|---|---|---|
| accessible name | What a screen reader hears entering a tile: `tracker, t2, pipe A, 1 of 2, sends to ticket`. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not "the region's name" (proposed, [PR 353](https://github.com/usirin/tea-fabrika/pull/353)). Not the program name. |
| bottom line | The one line under the desk: where you are, and the key you just pressed. Stays monospace. [Popovers](../docs/direction/popovers.md), [tile guidelines](../docs/direction/tile-guidelines.md) | [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes "status bar" (65%). Not "status line" (one line about one thing) and not "footer" (a popover's last row). |
| close question | `close t2? (y/n)`, asked on the bottom line and in the tile's title bar. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not an ask. [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes "question marker" for the tile guidelines' "asking marker" (75%). |
| container | A row or a column of tiles; nested ones alternate, as in AeroSpace. [Fold, not tabs](../docs/direction/fold-not-tabs.md) | Not a Docker container, and never tabs. |
| desk | Every workspace, its layout and its focus, as one machine; in `next/`, the program `fabrika/desk` (Tier 2). [The desktop layer](../docs/direction/the-desktop-layer.md) | Not the desktop, layer 5. Not the owner's desk ([every wait is a queue](../docs/direction/every-wait-is-a-queue.md)). [PR 353](https://github.com/usirin/tea-fabrika/pull/353) lists five meanings. |
| desktop | `next/`: layer 5, Tuval. It places tiles, owns focus and routes keys, on the app layer's window protocol. [The desktop layer](../docs/direction/the-desktop-layer.md) | Not the desk. |
| fold (tile) | `C-b f` folds a tile into a thin strip that keeps its place; a click opens it. The last open tile cannot fold. [Fold, not tabs](../docs/direction/fold-not-tabs.md) | Not a fold of facts. Not tabs. |
| frame | (proposed, [PR 353](https://github.com/usirin/tea-fabrika/pull/353)) Everything the app draws that is not a program's view: the bars, each tile's title bar, edge, strips and gaps, and what opens over the desk (75%). | Not "chassis". |
| glance | `next/`: a program's small view in the top bar's popover; the asks list becomes the asks program's glance. [The ask desk](../docs/direction/ask-desk.md) | Not today's tracker `Glance`, which [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes renaming `Status` (60%). Not the verdict `glance`. See Open clashes. |
| menu | A popover whose rows each do something: the asks list, the jobs list. [Popovers](../docs/direction/popovers.md) | |
| menu bar | `next/`: the app's icon in macOS's menu bar, with its rows (approve a tab, quit). [The desktop layer](../docs/direction/the-desktop-layer.md) | [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes "menu bar extra", Apple's word (80%): on macOS the menu bar is the system's bar. |
| palette | Cmd-K: every command by name, grouped, with its tsh word and keys. VS Code's Command Palette. [Popovers](../docs/direction/popovers.md) | |
| popover | A raised box of rows in the windows' font. Focus moves in; Escape closes it and puts focus back. Apple's and HTML's word. [Popovers](../docs/direction/popovers.md) | Not "popup", which [PR 353](https://github.com/usirin/tea-fabrika/pull/353) keeps only for ARIA's `aria-haspopup` (85%). |
| prefix | `C-b`, pressed before a desk key, as in tmux. Each window runs it itself. After it the bottom line shows the prefix line. [The desktop layer](../docs/direction/the-desktop-layer.md) (W5) | |
| resize gap | The 4px between two open tiles, dragged to resize. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not `.border`, the code's name, which [PR 353](https://github.com/usirin/tea-fabrika/pull/353) proposes renaming. Not the edge. |
| text style | One of six: `title`, `heading`, `strong`, `body`, `quiet`, `label`. Every size comes from one. [Typography](../docs/direction/typography.md) | Not "text role", the study's first word. |
| tile | One rectangle of the desk; it shows one process. tmux says pane. [Tile guidelines](../docs/direction/tile-guidelines.md), [the desktop layer](../docs/direction/the-desktop-layer.md) (W3) | Not "window" for a tile in a tsh line. |
| title bar | A tile's own bar: slot, program name, state word, tile id. A mono `header`. [Tile guidelines](../docs/direction/tile-guidelines.md) | Not the top bar. |
| toolbar | (proposed, [PR 353](https://github.com/usirin/tea-fabrika/pull/353)) A row of buttons built from a program's `commands`, each with its key printed on it, `role="toolbar"`. Words with keys that nothing presses are key hints (70%). | Not "action bar" or "keys line", which it replaces. |
| top bar | The bar across the top: the workspace list, the line, the app's icon and name, then the items. Stays monospace. [Popovers](../docs/direction/popovers.md), [top bar name](../docs/direction/top-bar-name.md) | |
| workspace | One numbered layout inside the desk, with one focused tile. i3's word. [The desktop layer](../docs/direction/the-desktop-layer.md) (W4) | |

## Open clashes

Each is one word with two live meanings. This file names them and decides none. Each line says
what would settle it.

- **inbox.** A ledger stream others write to (`build:7/inbox`, a ticket's write inbox) and a
  person's list of things waiting (Linear's Inbox; PR 353 leans to it for the owner-desk pack).
  Settles when the owner picks the word for the person's list, or a new word for the stream.
- **project.** A parent plan, a group of tickets (decided), and `next/`'s project object, the one
  Durable Object that holds a team's ledger. Experiment 205 adds a third reading: a grouping that
  ends. Settles with experiment 205's designs (PR 361), which must say which one keeps the word.
- **run.** One start of a program (today's `tea-program`), one agent session (`field/runs.jsonl`),
  and the resume point's `_tag: "run"` ("run this step"). `next/` says process for the first.
  Settles when the restart work picks a tag that is not a noun already in use, or the notes pick
  one meaning.
- **asks.** As a program name: G8 on PR 332 has no lean over 60% (keep `asks` 45%, `questions`
  25%, `decisions` 20%, `waiting` 10%), and `questions` would clash with PR 353's close question.
  Settles when the owner walks G8.
- **area.** Proposed by experiment 205 as a long-lived grouping of tickets by part of the code. No
  note names it yet, and it sits beside project. Settles with that experiment's walk.
- **lane.** A ticket's run through the pipeline, and `next/`'s ephemeral lane, the at-most-once
  channel. Found while writing this file. Settles if the owner renames one; "channel" is the
  plain word for the second.
- **glance.** The asks program's small view (decided), today's tracker `Glance` (PR 353 proposes
  `Status`), and a verdict that carries with a look (`kept`, `glance`, `stale`, proposed). The
  third was found while writing this file. Settles with PR 353 and a word for the verdict.
- **host.** Today's running process that hosts programs, and `next/`'s place hands can run.
  Decided per version, so it is not open, only a trap: check the path. It goes when today's host
  goes.
