# Direction

Where this experiment is going, and why. One short note per decision.

`experiments/` records what was tried and what came back. `field/` records what
happened on real tickets. This folder records what was decided about the
direction, so a new reader (or a new agent session) starts from the same place.

Each note says what was decided, why, and what it means for the work. A note
marked **proposed** is a recommendation nobody has settled yet.

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
| [Done is per criterion; no deviations](./done-is-per-criterion.md) | A criterion is open or met; the owner changes criteria only as ticket events. One ticket, one PR, merged only when every criterion is met. A builder may not shrink a criterion; "cannot meet as written" is its honest exit. | decided |
| [The smallest ledger, and proof before it grows](./smallest-ledger-proof-to-grow.md) | Tickets, criteria, questions, review results, who is on it, lanes. Priority, types, labels and links wait for a run that needed them. | decided |
| [Helpers, and one supervisor](./helpers-and-the-supervisor.md) | A stage that lacks a fact asks a helper (a scout), never another stage. Agents ask; only the supervisor starts runs and picks harness and model. | decided, parts open |
| [Reuse before special rules](./reuse-before-special-rules.md) | Every part is built from the existing moves and combos. Each part first answers: do we need it, is it something else, does it belong elsewhere? | decided |
| [A project is a parent plan](./a-project-is-a-parent-plan.md) | Plan is its own stage for every ticket; triage only sorts. An epic is a plan with many tasks, a project is a parent plan. Milestones leave the loop; a roadmap is a view. | decided |
| [Sort answers yes or no](./sort-answers-yes-or-no.md) | No "later" and no priority. A "no" carries a one-line reason; "later" is a reopened "no", sent through sort again. | decided |
| [One parent, stages as slots](./one-parent-stages-as-slots.md) | A new parent machine holds the pipeline. Stages are swapped from agent to machine one at a time. | proposed |
| [A review list can only shrink](./a-review-list-can-only-shrink.md) | Review once, fully. Later rounds only check the list, and the loop ends when a lap leaves it no shorter. A replay found the lists do shrink, and that the rule needs more ways in and a looser stop. | proposed |
| [tea-program: programs between tea and a host](./tea-program.md) | tea holds machines; a program is what you start: a name, a description, typed flags, inputs and outputs, and `main`, an Effect that runs machines and asks for services through Effect's context. It uses machines and is not one. Flags are argv, inputs are stdin (told at any time, never waiting, closed by the starter alone), outputs are events: heard once, kept nowhere; whatever a late viewer needs is a machine's state. `start` takes the listeners and answers a run handle; `pipe` is `from | to`; no raw `dispatch`. A host lists, starts, feeds, listens and provides. The first shape, a machine with inputs and outputs, was dropped. | proposed |
| [A canvas per piece of work](./a-canvas-per-work.md) | See the whole machine for one piece of work, and choose the harness and model on each agent node. | vision |

## Adding a note

Write it when a direction is set or changed, the same day. Keep it short and in
plain words. Say what would change your mind. Do not record who said what: this
folder holds decisions, not conversations.
