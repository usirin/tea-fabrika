# Direction

Where this experiment is going, and why. One short note per decision.

`experiments/` records what was tried and what came back. `field/` records what
happened on real tickets. This folder records what was decided about the
direction, so a new reader (or a new agent session) starts from the same place.

Each note says what was decided, why, and what it means for the work. A note
marked **proposed** is a recommendation nobody has settled yet. A note marked
**owner to check** was written later from older records; treat it as proposed
until the owner confirms it.

| Note | In one line | State |
|---|---|---|
| [Control lives in code](./control-in-code.md) | Code holds the loop. An agent does one bounded job inside it. Every agent stage becomes a machine. | decided |
| [Rethink, do not port](./rethink-do-not-port.md) | Today's fabrika shows which jobs exist. It does not decide how they are built. | decided |
| [Built for projects](./built-for-projects.md) | fabrika is project management first. Building code is one part of it. | decided |
| [The ledger sits behind a service, and code hosting behind another](./ledger-behind-a-service.md) | Two services: `Ledger` for the record, `CodeHost` for pull requests, checks and the queue. GitHub is the first implementation of each. | decided, names open |
| [The backend is a library](./backend-as-a-library.md) | Typed services that code imports, not a command-line tool that agents call. | decided |
| [Jev: the same answer, cheaper](./jev-same-answer-cheaper.md) | Jev is measured by agreement with the big model, never trusted to remove a person. | decided |
| [Elm first](./elm-first.md) | Name what Elm does before adding any new shape. Parents are written by hand. | decided |
| [Read fresh, run alone](./read-fresh-run-alone.md) | A stage reads the facts again at the moment it acts, so every stage machine can also run by itself. | decided |
| [Ask for decisions, not facts](./ask-for-decisions-not-facts.md) | A person is asked for a decision or an act. A fact is read from the ledger. | decided |
| [Data first; markdown is a view](./data-first-markdown-is-a-view.md) | Every shape is data with a schema. Markdown is made from it for people, and never read back. | decided, storage open |
| [Every stage answers in the same five verbs](./outcome-names.md) | `done`, `send`, `ask`, `skip`, `stuck`. Passing it on is `verb:who:why`, ending here is `verb:why`. The data is the truth, the name is its spelling. | decided, one stage built |
| [Done is per criterion; no deviations](./done-is-per-criterion.md) | A criterion is open or met; the owner changes criteria only as ticket events. One ticket, one PR, merged only when every criterion is met; a plan with many tasks is still one PR, tasks reviewed as they land, CI once at the end. A builder may not shrink a criterion; "cannot meet as written" is its honest exit. | decided |
| [The smallest ledger, and proof before it grows](./smallest-ledger-proof-to-grow.md) | Tickets, criteria, questions, review results, who is on it, lanes. Priority, types, labels and links wait for a run that needed them. | decided |
| [Helpers, and one supervisor](./helpers-and-the-supervisor.md) | A stage that lacks a fact asks a helper (a scout), never another stage. Agents ask. There is no fabrika supervisor any more: tea-host starts and restarts runs, `fabrika.toml` picks harness and model, a program's `limits` say no. | decided, parts open; supervisor replaced 2026-10-20 |
| [Reuse before special rules](./reuse-before-special-rules.md) | Every part is built from the existing moves and combos. Each part first answers: do we need it, is it something else, does it belong elsewhere? | decided |
| [A project is a parent plan](./a-project-is-a-parent-plan.md) | Plan is its own stage for every ticket; triage only sorts. An epic is a plan with many tasks, a project is a parent plan. Milestones leave the loop; a roadmap is a view. | decided |
| [Sort answers yes or no](./sort-answers-yes-or-no.md) | No "later" and no priority. A "no" carries a one-line reason; "later" is a reopened "no", sent through sort again. | decided |
| [Every machine has laws](./every-machine-has-laws.md) | A checker walks every message order through each real reducer and checks its laws; a machine with no laws, or a message never sent, fails the suite. | decided |
| [One fabrika.toml per repo](./one-fabrika-toml-per-repo.md) | Knobs are numbers, names or picks between tested paths, in TOML; the step order stays in code. Empty file changes nothing, unknown key fails, a run copies its settings when filed. Packs are listed here, not in `tsh.toml`. Each key left out gets a named default, printed at start. | decided; built with agents, build, review, checks, ship and ledger tables (experiment 107) |
| [Use the industry's names](./use-the-industrys-names.md) | A thing with a proper name in the industry keeps it; an obscure one gets a plain gloss; one word per idea. A naming sweep is still to do. | decided, sweep open |
| [Make the mistake impossible](./make-the-mistake-impossible.md) | A rule that matters is held by a type, a refusal or a failing test. A warning, a doc or a prompt is not protection. A skipped check never looks clean. | decided |
| [Nobody grades their own work](./nobody-grades-their-own-work.md) | Review is a different agent from build. The reviewer only finds; code checks each quote and works out pass or fail. No agent approves. | decided |
| [Ship stage rules](./ship-stage-rules.md) | A person's comment goes to that person, a bot's back to the builder. Red checks run again once per head. Behind main ships; the queue is the check. Waits have limits. No queue: merge straight in. | decided |
| [North Star first; harden later](./north-star-first-harden-later.md) | Security never limits the goal and never rests on a code host's permissions. Order: experiments, fabrika, Tuval, then hardening. A hole today's fabrika has too waits for hardening. | decided |
| [Build on Effect; let types be inferred](./build-on-effect.md) | Effect's own modules first; Node only at a thin edge, named in a comment. Check Effect before building our own. Types come from inference, not by hand. | decided |
| [tsh: a shell for tea programs](./tsh-a-shell-for-tea-programs.md) | A Unix-style shell that runs only tea programs, with typed pipes and no new concepts. fabrika's first client. Agents get tsh instead of bash; MCP is the tools protocol. | decided; MCP not built |
| [Where each piece lives](./where-each-piece-lives.md) | This repo is a workshop. Later, everything above tea is one open-source project, `kamp-us/fabrika`: the library `@kampus/fabrika` (program, host, shell, gui, agents) and the pipeline, its own package on fabrika's public names (`@kampus/pipeline`, a working name). No Tuval. Nothing moves until the experiment is done. tea is never edited from here. | decided; placement replaced 2026-10-21, pipeline its own package 2026-10-22, pipeline name open |
| [demlik is the first real repo](./demlik-is-the-first-real-repo.md) | Real lanes run on demlik, with today's fabrika as the fallback. The sandbox-only lock is gone. | decided |
| [Every wait is a queue](./every-wait-is-a-queue.md) | Each state where work waits for someone is a queue with one kind of reader: a view on the ledger, worked through the kept work queue. The owner's desk is the view of every queue a person reads. | proposed |
| [Add-on packs are programs](./packs-are-programs.md) | A small core plus packs. A pack is programs in a package, enabled by one config line; it listens and answers, fills a slot, or provides a service. The core never knows it exists. | proposed; where packs live is decided |
| [One parent, stages as slots](./one-parent-stages-as-slots.md) | A new parent machine holds the pipeline. Stages are swapped from agent to machine one at a time. | proposed |
| [A review list can only shrink](./a-review-list-can-only-shrink.md) | Review once, fully. Later rounds only check the list, and the loop ends when a lap leaves it no shorter. A replay found the lists do shrink, and that the rule needs more ways in and a looser stop. | proposed |
| [tea-program: programs between tea and a host](./tea-program.md) | tea holds machines; a program is what you start: a name, a description, typed flags, inputs and outputs, and `main`, an Effect that runs machines and asks for services through Effect's context. It uses machines and is not one. Flags are argv, inputs are stdin (told at any time, never waiting, closed by the starter alone; each holds its `capacity` unread, 1000 unless declared, and a `tell` past it fails `Full`), outputs are events: heard once, kept nowhere; whatever a late viewer needs is a machine's state. `start` takes the listeners and answers a run handle; `pipe` is `from | to`; no raw `dispatch`. A host lists, starts, feeds, listens and provides. The first shape, a machine with inputs and outputs, was dropped. | proposed; parts decided |
| [A local-first sync engine is the base](./a-local-first-sync-engine.md) | Signed append-only logs that hosts sync, with leases for one-writer work. The ledger is the first log on it; solo is a team of one. The ledger is one Durable Object everywhere: on Cloudflare for a team, in Miniflare on a laptop (experiment 93), restarted when its memory passes a cap. First step now: every fact says who wrote it. | vision; ledger runtime decided |
| [tea-host: OTP for tea programs](./tea-host.md) | We implement OTP. A host is a running process that runs tea programs, OTP's node. Every host uses one ledger picked by config; the ledger is the host's, and fabrika is programs that use it. OTP's names where it has one. | decided; package built (experiments 98 to 100); tsh and Tuval as clients open |
| [A canvas per piece of work](./a-canvas-per-work.md) | See the whole machine for one piece of work, and choose the harness and model on each agent node. | vision |

## Adding a note

Write it when a direction is set or changed, the same day. Keep it short and in
plain words. Say what would change your mind. Do not record who said what: this
folder holds decisions, not conversations.
