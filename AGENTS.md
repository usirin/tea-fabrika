# Working in this repo

For any agent (or person) picking up work here. Read this first, then
[`docs/direction/README.md`](./docs/direction/README.md).

## What this repo is

An experiment that rebuilds an agent pipeline ("fabrika") as plain state
machines on [`@demlik/tea`](https://github.com/kamp-us/demlik). Code holds the
loop; an agent does one bounded job inside it. The repo is as much a lab
notebook as a codebase: what was tried, what happened on real tickets, and what
was decided are all kept here on purpose, so they can be analysed later.

## Where to read, where to write

| You want to | Read | Write |
|---|---|---|
| Know where this is going and why | [`docs/direction/`](./docs/direction/README.md), one note per decision | A note there, the same day a direction is set or changed, plus its row in that folder's README. Mark it **proposed** until it is settled. |
| Know what was tried and what came back | [`experiments/README.md`](./experiments/README.md), the index, then the write-up | `experiments/NN-short-title.md` for the write-up and `experiments/NN-name.ts` for its script, with the next free number, plus one row in the index. Shared helpers go in `experiments/lib/`, saved answers in `experiments/results/`. |
| Know what happened on real tickets | [`field/README.md`](./field/README.md), then `field/notes.jsonl` and `field/runs.jsonl` | One row per agent run in `runs.jsonl` and one note per thing that broke, cost too much, needed a person or worked well in `notes.jsonl`, the same day, in the schema the README gives. |
| Check a change against old tickets | [`replay/README.md`](./replay/README.md) | New replay cases under `replay/`, as that README describes. |
| Understand a design that is still a draft | `docs/` (for example [`docs/fabrika-sdk.md`](./docs/fabrika-sdk.md)) | A draft there. When a draft settles a direction, add the note under `docs/direction/` too. |
| Change the machines | `src/`, with the table in the top-level [`README.md`](./README.md) as the map | Code in `src/`, with its test beside it as `name.test.ts`. Toy projects used by tests live in `fixtures/`. |
| Look at a live run's state and logs | `runs/` on your own machine | Nothing by hand. `runs/` is ignored by git and is never committed. |

`blog/` and `video/` are finished pieces about earlier stages. Leave them unless
asked.

**Rule of thumb:** a decision goes in `docs/direction/`. A measurement goes in
`experiments/`. Something that happened on a real ticket goes in `field/`. If a
piece of knowledge about this project lives only in a chat or in an agent's
private memory, it is in the wrong place: write it here.

## Before you design anything

- **Name the Elm answer first.** `@demlik/tea` is the Elm architecture in
  TypeScript. Parents are written by hand and step their children; there is no
  pipeline language. See [`docs/direction/elm-first.md`](./docs/direction/elm-first.md).
- **Use the six moves.** Gather (code reads), Act (code writes), Listen (code
  waits on an outside event), Draft (an agent produces within limits), Check
  (code judges an output), Judge (a small classifier answers one narrow
  question). They are in `src/primitives.ts`; the combos built from them are in
  `src/combos.ts`.
- **New schemas are Effect Schema.** Define a Cmd through one of the moves, or
  through `defineCmd` in `src/schema.ts`. They wrap the schema for tea
  themselves, so nobody writes `Schema.toStandardSchemaV1`. zod stays only in
  code not yet moved, and a move takes either. See
  [`docs/direction/data-first-markdown-is-a-view.md`](./docs/direction/data-first-markdown-is-a-view.md).

  ```ts
  import { Schema } from "effect";
  import { gather } from "./primitives.ts";

  const Ticket = Schema.Struct({ id: Schema.String, kind: Schema.Literals(["bug", "feature"]) });
  type Ticket = typeof Ticket.Type;
  const readTicket = gather("ticket_read", { input: Schema.Struct({ id: Schema.String }), ok: Ticket, err: ["unknown"] });
  ```
- **Data keys are short everyday words.** `for`, not `forWhat`. `why`, not
  `reasonCode`. A key does not say again what its parent already says: inside
  an outcome, the reason is `why`, not `outcomeReason`. If a short word could
  mean two things, pick a clearer short word before you reach for a long one.

  ```ts
  // Yes: read it out loud and it is a sentence.
  { kind: "ask", who: "owner", for: "approval" }
  { kind: "send", to: "builder", why: "checks_red" }

  // No: longer, and the parent already said it.
  { kind: "ask", askWho: "owner", forWhat: "owner_approval" }
  { kind: "send", sendTo: "builder", reasonCode: "checks_red" }
  ```
- **A stage answers in five verbs.** `done`, `send`, `ask`, `skip`, `stuck`.
  A new stage machine writes only its own words, with `outcomesOf` in
  `src/stages/outcome.ts`, and prints an outcome's name with `nameOf`. See
  [`docs/direction/outcome-names.md`](./docs/direction/outcome-names.md).
- **Rethink, do not port.** Today's fabrika and the older machines here show
  which jobs exist and what was learned. They do not set the shape. See
  [`docs/direction/rethink-do-not-port.md`](./docs/direction/rethink-do-not-port.md).
- **Talk to typed services, never straight to a command-line tool.** That
  includes `gh`. See [`docs/direction/backend-as-a-library.md`](./docs/direction/backend-as-a-library.md)
  and [`ledger-behind-a-service.md`](./docs/direction/ledger-behind-a-service.md).

## Checks

```sh
pnpm typecheck
pnpm test
```

Both must pass before a change is offered. Neither needs a key or the network.
`experiments/` is outside the typecheck, so run a changed script once yourself.

A real Jev call needs `TYPESAFE_API_KEY` in the environment. Run everything
else with it unset, so no test can spend money by accident. Before any paid
run, estimate the cost, try a handful of cases, look at the answers, then
scale. Record what it cost in the write-up.

## This repo is public

- No secrets, and never print or write a key.
- No absolute paths from anyone's machine. Use repo-relative paths or `~`.
- No personal names or account names.
- Never quote what a person typed in a chat session. Record the decision, not
  the conversation. Text a person posted publicly on an issue or pull request
  may be linked and summarised.

## Running the machine on a real ticket

A live run changes a real repository. The rules, each learned from a run:

- The target repository's own merge rules apply. Never merge by hand, never arm
  auto-merge, never push to its main branch. A change lands only through the
  ship stage.
- No agent approves a pull request, and no agent answers a question the machine
  put to a person.
- A dry run is read-only. It starts no agent that could claim or change a real
  ticket.
- Leave nothing behind: no claim, no working copy, no half-open pull request.
  If something is left, say exactly what.
- In every report and write-up, say which parts were this repo's machine and
  which were today's fabrika (its agents and its ledger behind the wrapper).
- Log the run in `field/` the same day, with dollars and both token measures.

## How to write here

Write-ups are read by busy people, some of them not native English speakers.

- Plain everyday words and short sentences. Give the answer first.
- At most one simple table per section. No box drawings.
- **Show it in code.** A design or direction document carries code blocks: the
  types, the state, the step function, one example call with its answers. A
  reader should be able to see the machine from the code blocks alone. Mark a
  sketch as a sketch. Open with one small block that shows the whole idea.
- Every recommendation says why, what it costs, and how sure you are. Under
  about 80% sure, name the doubt and what would settle it.
- A write-up ends with what it cannot tell us. A run that shows what breaks is
  as useful as a clean one; do not smooth a failure over.
- Guesses that turned out wrong stay in the record, marked as wrong.

## Changing files

- Change code with an editor-style edit, not with a find-and-replace script
  run over the tree.
- Move files with `git mv`, so history follows.
- Stage your own paths by name. Another session may have work in the same
  checkout.
