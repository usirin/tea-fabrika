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
| Build the new version | [Two versions, side by side](#two-versions-side-by-side), then `docs/direction/` | Code in `next/`, with its test beside it as `name.test.ts`. |
| Change the machines (today's version) | The workspace packages (`packages/fabrika`, `packages/pipeline`, `programs/*`, `packs/*`, `wip`, `legacy`), with the list in the top-level [`README.md`](./README.md#packages) as the map and each part's own README for its files | Code in the part's folder, with its test beside it as `name.test.ts`. New pipeline work goes in `packages/pipeline/src/`; a tool any factory could use goes in `packages/fabrika`. `wip` and `legacy` only shrink. Outside a package, import it by its name (`@kampus/fabrika`, a subpath such as `@kampus/fabrika/http`, or `@kampus/pipeline/<path>`), never by a path; the pipeline uses only fabrika's public names (`pnpm lint` checks both). Inside a package, parts import each other by relative path. The top level names no platform: a Node, Miniflare, Agent SDK, ACP or OpenTelemetry import goes on a subpath (`pnpm lint` bundles the top level for a browser and fails on one). `layer-rules.json` says which way imports may point (`pnpm lint` checks it). Toy projects used by tests live in `fixtures/`. |
| Learn a package by doing it | [`docs/tutorials/`](./docs/tutorials/), one folder per tutorial: its README and its finished files | A folder there with a `package.json` whose `typecheck` covers the files, so a change to the package that breaks the tutorial fails `pnpm typecheck`. Run every step on a fresh clone before it lands. |
| Show one finding or idea to someone outside the project | [`singles/README.md`](./singles/README.md) | `singles/NN-short-title.md` with its one picture beside it, in the shape that README gives, plus its row in the table. It points back at the experiment it was cut from. |
| Look at a live run's state and logs | `runs/` on your own machine | Nothing by hand. `runs/` is ignored by git and is never committed. |

`blog/` and `video/` are finished pieces about earlier stages. Leave them unless
asked.

**Rule of thumb:** a decision goes in `docs/direction/`. A measurement goes in
`experiments/`. Something that happened on a real ticket goes in `field/`. If a
piece of knowledge about this project lives only in a chat or in an agent's
private memory, it is in the wrong place: write it here.

## Two versions, side by side

A new version of fabrika is growing in `next/`, built on
[the five layers](./docs/direction/a-local-first-sync-engine.md). Everything
else (`packages/`, `programs/`, `packs/`, `apps/`, `wip`, `legacy`) is today's
version. It keeps running for daily use until the new one takes each job over
([clean slate](./docs/direction/clean-slate.md)).

Before you read or change code, know which version your work is in. Your brief
or ticket says so. If it does not, a fix to something in use is today's version,
new design work is `next/`, and if you still cannot tell, ask.

```text
next/              what we are building, on the decisions in docs/direction
everything else    what we use today, and a map of which jobs exist
```

- **A search finds both.** Check the path of every file you read before you
  trust it. A name that exists in both can mean different things: a `rev` or a
  `host` in today's code is not the same as in the decisions.
- **Say which version a claim is about,** in every write-up, note and report.
  "The host keeps X" is true of one version.
- **In `next/`:** follow `docs/direction`, not today's code. Read today's code
  and its tests to learn what jobs exist and what was learned, then rethink. Never
  import it and never copy it across
  ([rethink, do not port](./docs/direction/rethink-do-not-port.md)).
- **In `next/`, nothing is built on Promises.** It is Effect all the way. A Promise
  appears only in a one-line edge the platform demands
  ([no Promises](./docs/direction/no-promises.md)).
- **In `next/`, an object class stays thin.** It holds what the platform gives it and
  a one-line handoff. The logic is plain code that also runs on Node in tests
  ([an object class stays thin](./docs/direction/object-classes-stay-thin.md)).
- **In `next/`, every change goes through the pipeline's steps, by hand:** plan, test
  writer, build, mutation step, one review, each by its own agent, with laws. No
  builder starts before an approved plan and tests that exist
  ([the steps](./docs/direction/next-is-a-pipeline-pre-run.md)).
- **In today's version:** only fixes that daily use or CI needs, and the UX work the
  owner picks. No new plumbing.
- **When `next/` takes a job over,** the pull request that switches to it deletes
  the old part. Its tests or laws are ported first.
- `next/` is the lab until a person opens it for real work, so it may be rough. "No
  rough first versions" (below) applies from then on.

## Before you design anything

- **Name the Elm answer first.** `@demlik/tea` is the Elm architecture in
  TypeScript. Parents are written by hand and step their children. Exceptions
  are named in [`docs/direction/elm-first.md`](./docs/direction/elm-first.md)
  with their reason; the first is tsh lines.
- **Protocols first, and a browser is always a peer.** Name the protocol a
  boundary speaks before its implementation. A protocol may not need what a
  browser lacks: no Node, no Unix socket, no files, no WebSocket-level frames.
  Ask of every design: could a browser tab be this peer? See
  [`docs/direction/a-browser-is-always-a-peer.md`](./docs/direction/a-browser-is-always-a-peer.md).
- **The data shape comes first.** Weigh it before anything else, and ask of
  every design: what fact is lost forever if we don't record it now? A fact
  that exists only when something is written (who, when on their own clock,
  what they saw, why) goes in now, even if nothing reads it yet. A field can be
  added to a schema later; the entries written before it never get it. Derived
  things (durations, views, summaries) can wait, since they rebuild from the
  log. Before you say "add it later", say whether later loses data. If a fact
  is recorded but must not be trusted, keep it out of the deciding code's
  types. Example: a ledger entry keeps the peer's own clock as `said` from day
  one, but leases and limits use only the referee's `at`.
- **Use the six moves.** Gather (code reads), Act (code writes), Listen (code
  waits on an outside event), Draft (an agent produces within limits), Check
  (code judges an output), Judge (a small classifier answers one narrow
  question). They are in `packages/pipeline/src/primitives.ts`; the combos
  built from them are in `packages/pipeline/src/combos.ts`.
- **New schemas are Effect Schema.** Define a Cmd through one of the moves, or
  through tea's own `Cmd.define` from `@demlik/tea/effect`. Both take Effect
  schemas as they are, so nobody writes `Schema.toStandardSchemaV1`. zod stays
  only in code not yet moved. A move takes either; tea's Effect `Cmd.define`
  takes Effect schemas only. See
  [`docs/direction/data-first-markdown-is-a-view.md`](./docs/direction/data-first-markdown-is-a-view.md).

  ```ts
  import { Cmd } from "@demlik/tea/effect";
  import { Schema } from "effect";
  import { gather } from "./primitives.ts";

  const Ticket = Schema.Struct({ id: Schema.String, kind: Schema.Literals(["bug", "feature"]) });
  type Ticket = typeof Ticket.Type;
  const Id = Schema.Struct({ id: Schema.String });
  const readTicket = gather("ticket_read", { input: Id, ok: Ticket, err: ["unknown"] });
  const closeTicket = Cmd.define("ticket_close", { input: Id, ok: Schema.Null, err: ["unknown"] });
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
  `packages/pipeline/src/stages/outcome.ts`, and prints an outcome's name with `nameOf`. See
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
pnpm lint       # biome: format, imports and lint rules, changing nothing
pnpm test
```

All three must pass before a change is offered. None needs a key or the
network. `pnpm typecheck` runs Effect's own checks inside `tsc` (`@effect/tsgo`,
patched in by the same command), so an Effect made and dropped fails it. `pnpm lint` passes when it reports nothing: a warning fails it too.
`experiments/` is outside the typecheck, so run a changed script once yourself.
`pnpm build` writes `@kampus/fabrika`'s `dist/`, what a pack holds. Nothing
above needs it; CI runs it too (experiment 108).

`pnpm lint` fails on an export nobody uses that `unreachable-ledger.json` does
not name yet (`pnpm lint:dead` runs that part alone). With code-graph 0.12.0,
about 0% of what it finds is wrong: 4 findings, all right
([Sweep the core](./docs/direction/sweep-the-core-rebuild-the-pipeline.md)),
and blocking needs about 0% false alarms (Google CACM 2018).
Check each finding by hand. If it is right, fix it: delete the code, or drop
its `export`. If it is wrong, stop and tell the owner; that is a code-graph
bug to file. The ledger only shrinks: the run prunes entries whose finding is
gone, the one file `pnpm lint` changes, and CI fails until that is committed. Adding an entry is the owner's call, in a change of its own
([Nobody writes their own exam](./docs/direction/nobody-writes-their-own-exam.md)).

```sh
pnpm format     # biome: format, sort imports and apply its safe fixes, in place
```

Run `pnpm format` first, so a diff holds only what was meant. The settings are
in `biome.jsonc`: tabs, 100 columns, and the lint rules of the pipeline this
repo rebuilds, with its custom rules copied into `biome-plugins/`. Never switch
a rule off to pass. A `// biome-ignore` is for a line where the code is right
and the rule does not fit, and its reason says why in plain words.

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

## Changing the product

- **No rough first versions.** A change to the product (`apps`, `programs`,
  `packages`) lands finished and thought through: all it shows works, with no
  stub, dead button or "(not yet)". A piece that waits on other work stays out
  of the window until it is real. `experiments/` is the lab and may be rough.
- **Ask how Linear would do it.** Before building any screen (a program's
  window, the app's frame, a mockup), ask how Linear would build it as their
  new product. The PR says, per screen, what Linear would do, and where we
  differ and why. Tuval and tmux stay the defaults for tiling; where they clash
  with Linear's answer, name the clash for the owner to pick.
- **Show it running.** A PR that adds or changes a program's window carries
  screenshots from the real built app, saved in that program's `docs/` folder
  and shown in the PR body. Take them the way `apps/fabrika/e2e.ts` drives the
  app: Playwright on Electron, with `FABRIKA_HOME` set to a test home of its
  own in a temp folder, never your real one. Look at each shot, and say in the
  PR what looks broken, empty or wrong.
- **Shoot more than one layout.** A window that looks right in one wide tile
  can break at half or a quarter. Mockups and PR shots show each key state in
  at least: one tile filling the window, two tiles side by side, two stacked,
  a 2x2 grid, and a small app window (about 1024x700). Name each shot by state
  and layout, and say what squeezes or breaks in each.
