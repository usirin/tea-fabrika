# Working in this repo

For any agent (or person) picking up work here. Read this first, then
[`docs/plan/README.md`](./docs/plan/README.md) for where the work stands, then
[`docs/direction/README.md`](./docs/direction/README.md) for why.

## What this repo is

An experiment that rebuilds an agent pipeline ("fabrika") as plain state
machines on [`@demlik/tea`](https://github.com/kamp-us/demlik). Code holds the
loop; an agent does one bounded job inside it. The repo is as much a lab
notebook as a codebase: what was tried, what happened on real tickets, and what
was decided are all kept here on purpose, so they can be analysed later.

## Where to read, where to write

| You want to | Read | Write |
|---|---|---|
| Know what is next and who has the move | [`docs/plan/README.md`](./docs/plan/README.md), then [`tiers.md`](./docs/plan/tiers.md) and [`tier-1.md`](./docs/plan/tier-1.md) there | That README, in the same pull request or the same day, when the plan or its state changes. |
| Know where this is going and why | [`docs/direction/`](./docs/direction/README.md), one note per decision | A note there, the same day a direction is set or changed, plus its row in that folder's README. Mark it **proposed** until it is settled. |
| Write guidelines for one design area | [`.claude/skills/guidelines/SKILL.md`](./.claude/skills/guidelines/SKILL.md), the steps in order, and its page checklist | One experiment, one proposed note, their two index rows and one private page, in the shape that skill gives. |
| Know what was tried and what came back | [`experiments/README.md`](./experiments/README.md), the index, then the write-up | `experiments/NN-short-title.md` for the write-up and `experiments/NN-name.ts` for its script, with the next free number, plus one row in the index. Shared helpers go in `experiments/lib/`, saved answers in `experiments/results/`. |
| Know what happened on real tickets | [`field/README.md`](./field/README.md), then `field/notes.jsonl` and `field/runs.jsonl` | One row per agent run in `runs.jsonl` and one note per thing that broke, cost too much, needed a person or worked well in `notes.jsonl`, the same day, in the schema the README gives. |
| Check a change against old tickets | [`replay/README.md`](./replay/README.md) | New replay cases under `replay/`, as that README describes. |
| Understand a design that is still a draft | `docs/` (for example [`docs/fabrika-sdk.md`](./docs/fabrika-sdk.md)) | A draft there. When a draft settles a direction, add the note under `docs/direction/` too. |
| Build the new version | [Two versions, side by side](#two-versions-side-by-side), then `docs/direction/` | Code in `next/`, with its test beside it as `name.test.ts`. |
| Change the machines (today's version) | The workspace packages (`packages/fabrika`, `packages/pipeline`, `programs/*`, `packs/*`, `wip`, `legacy`), with the list in the top-level [`README.md`](./README.md#what-is-in-this-repository) as the map and each part's own README for its files | Code in the part's folder, with its test beside it as `name.test.ts`. New pipeline work goes in `packages/pipeline/src/`; a tool any factory could use goes in `packages/fabrika`. `wip` and `legacy` only shrink. Outside a package, import it by its name (`@kampus/fabrika-old`, a subpath such as `@kampus/fabrika-old/http`, or `@kampus/pipeline/<path>`), never by a path; the pipeline uses only fabrika's public names (`pnpm lint` checks both). Inside a package, parts import each other by relative path. The top level names no platform: a Node, Miniflare, Agent SDK, ACP or OpenTelemetry import goes on a subpath (`pnpm lint` bundles the top level for a browser and fails on one). `layer-rules.json` says which way imports may point (`pnpm lint` checks it). Toy projects used by tests live in `fixtures/`. |
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
[the five layers](./docs/direction/a-local-first-sync-engine.md). So far `next/` is on
[PR 223](https://github.com/usirin/tea-fabrika/pull/223), and nothing is on main yet. Everything
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

Today's library is `@kampus/fabrika-old` and today's app is `@kampus/fabrika-app-old`. They are
deleted when `next/` takes over. In `next/`, `@kampus/fabrika` is the app and
`@kampus/libfabrika` is the library.

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
- **Every pull request, `next/` or today's, goes through today's pipeline programs:**
  plan, test writer, build, mutation step, one review, each by its own agent, with
  laws. A step that cannot run yet goes by hand for that pull request and is logged in
  `field/`. No builder starts before an approved plan and tests that exist
  ([the steps](./docs/direction/next-is-a-pipeline-pre-run.md)). No merged pull request
  has been built this way yet ([where we are](./docs/plan/README.md#where-we-are-now)).
  A step is a program, and a prompt you would have typed is its first source: a rule in
  a prompt that could be code becomes code. A v0 has no missing parts: quick means each
  part is small, never absent.
- **In `next/`, the shell is `fabsh`.** `tsh` stays in today's version.
- **In `next/`, a window reads state through one `useSyncExternalStore` hook.** State
  lives in a tea machine, never `useState`, and tea's `useMachine` is not used: it dies
  under Strict Mode ([Elm first](./docs/direction/elm-first.md)).
- **In `next/`, no bare `of` and no `xOf` names.** Today's `nameOf` and `outcomesOf`
  stay until that code goes.
- **In today's version:** fixes that daily use or CI needs, the UX work the owner
  picks, and ideas the owner wants to try out there first. What a tryout teaches
  goes into `next/` as a lesson, rethought and not copied. Nothing else is added.
- **When `next/` takes a job over,** the pull request that switches to it deletes
  the old part. Its tests or laws are ported first.
- `next/` is the lab until a person opens it for real work, so it may be rough. "No
  rough first versions" (below) applies from then on.

## Before you design anything

- **Check what is settled first.** Before any design question or recommendation,
  search `docs/direction/`, `experiments/` and the plan for the topic. That holds for
  a question an agent's plan raises and for a pull request you walk: compare its shape
  with the note it says it builds, and name any place it walks a decision back. A
  claim about how a piece runs comes from reading that piece's note now, never from a
  summary. A settled note is evidence, not a tiebreaker: nothing from before experiment
  107 (the first run on a repo other than demlik) is trusted without a test, and in a
  redesign every serious branch goes on the table, with what it would undo.
- **Lead with the known way.** Look up how the makers and the industry do it, and cite
  it, before you give a lean; a guess comes after, marked as a guess. If the plain way
  clashes with a stated goal, say so in one line, and let the owner pick. Never hide it
  behind a custom design.
- **Name the Elm answer first.** `@demlik/tea` is the Elm architecture in
  TypeScript. Parents are written by hand and step their children. Exceptions
  are named in [`docs/direction/elm-first.md`](./docs/direction/elm-first.md)
  with their reason; the first is tsh lines. The same goes for coordination (registry,
  mailbox, links, monitors, supervisors): do what Erlang/OTP does unless a written
  reason says otherwise.
- **tea stays small.** A host composes tea and Effect; tea does not grow to fit a host,
  and it does not take on our conventions. tea code uses the Effect engine
  (`@demlik/tea/effect`), and the Promise engine stays for those who want it. `./otel`
  is experimental only because nobody had used it, so use it, and do not work around it.
  What these experiments decide wins over an older demlik issue or ruling. Real tea bugs
  stay their own tickets.
- **Read the installed version.** Agents know older libraries. Before you write or judge
  code against one, read the lockfile's version and that version's docs. A lint rule that
  fires a lot means ask why before you call it a false alarm.
- **Solve a problem we have.** A big vision gets saved as a note and tied back to a real
  problem. An experiment picks the tech. Aim at two people working together first:
  packages for others and publishing are recorded as later.
- **Moving a job from an agent to code?** Say what the agent was absorbing that code will
  not (the case nobody listed), what the "I don't know" exit is, and whether the rule
  makes honesty expensive. Check a rule against real moves you made this session: would
  it have blocked them if a machine had started you?
- **Protocols first, and a browser is always a client.** Name the protocol a
  boundary speaks before its implementation. A protocol may not need what a
  browser lacks: no Node, no Unix socket, no files, no WebSocket-level frames.
  Ask of every design: could a browser tab be this client? See
  [`docs/direction/a-browser-is-always-a-client.md`](./docs/direction/a-browser-is-always-a-client.md).
  In the new version, hands, a window and an agent dial the brain, and `client`
  means any of them at the door. See
  [`docs/direction/brain-hands-window-agent.md`](./docs/direction/brain-hands-window-agent.md).
- **The data shape comes first.** Weigh it before anything else, and ask of
  every design: what fact is lost forever if we don't record it now? A fact
  that exists only when something is written (who, when on their own clock,
  what they saw, why) goes in now, even if nothing reads it yet. A field can be
  added to a schema later; the entries written before it never get it. Derived
  things (durations, views, summaries) can wait, since they rebuild from the
  log. Before you say "add it later", say whether later loses data. If a fact
  is recorded but must not be trusted, keep it out of the deciding code's
  types. Example: a ledger entry keeps the writer's own clock as `said` from day
  one, but leases and limits use only the referee's `at`.
- **Record wide, read later.** Decided by the owner on 2026-11-01: record every measure we
  can, even if nothing reads it yet, because we cannot know which question we will ask later.
  A measure nobody reads costs little; one we wish we had is gone. The limits: it must not slow
  the work in a way we can measure, and it never holds a secret. Content a person may want gone
  stays deletable ([an agent run keeps its content](./docs/direction/an-agent-run-keeps-its-content.md)).
  The industry's name is wide events (Honeycomb; Stripe's canonical log lines).
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

  const Ticket = Schema.Struct({ id: Schema.String, state: Schema.Literals(["open", "closed"]) });
  type Ticket = typeof Ticket.Type;
  const Id = Schema.Struct({ id: Schema.String });
  const readTicket = gather("ticket_read", { input: Id, ok: Ticket, err: ["unknown"] });
  const closeTicket = Cmd.define("ticket_close", { input: Id, ok: Schema.Null, err: ["unknown"] });
  ```
- **Names.** Use the industry's word for a thing
  ([use the industry's names](./docs/direction/use-the-industrys-names.md)), checked on
  every pull request, prose included. An Effect service name is never plural: one that holds many is
  `<Thing>Manager`, such as `LeaseManager`.
- **Data keys are short everyday words.** `for`, not `forWhat`. `why`, not
  `reasonCode`. A key does not say again what its parent already says: inside
  an outcome, the reason is `why`, not `outcomeReason`. If a short word could
  mean two things, pick a clearer short word before you reach for a long one.

  ```ts
  // Values as they read. In `next/`, Effect Schema writes the `_tag`; nobody types it.
  // Today's code says `kind` here.
  // Yes: read it out loud and it is a sentence.
  { _tag: "ask", who: "owner", for: "approval" }
  { _tag: "send", to: "builder", why: "checks_red" }

  // No: longer, and the parent already said it.
  { _tag: "ask", askWho: "owner", forWhat: "owner_approval" }
  { _tag: "send", sendTo: "builder", reasonCode: "checks_red" }
  ```
- **The tag key is `_tag`, for every union we define.** Effect Schema writes it, with
  `Schema.TaggedUnion`, `TaggedStruct` and `TaggedError`, never by hand. tea's Msgs and
  Cmds keep `type`, and third-party shapes keep theirs. Plain fields stay plain words,
  such as `platform`. This is decided. In `next/`, `kind` on ledger entries becomes `_tag`
  too, settled when the owner approved [Tier 1](./docs/plan/tier-1-detail.md#tags) on 2026-11-01,
  and ticket 32 tracks it. Today's code is not changed by this, so its `kind` on an entry or an outcome stays until that code goes
  ([schema classes](./docs/direction/schema-classes-not-of-helpers.md)).
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
pnpm lint       # oxlint and oxfmt: lint rules, format and imports, changing nothing
pnpm test
```

All three must pass before a change is offered. None needs a key or the
network. `pnpm typecheck` runs Effect's own checks inside `tsc` (`@effect/tsgo`,
patched in by the same command), so an Effect made and dropped fails it. `pnpm lint` passes when nothing blocks: a warning fails it too. The two advice rules print and do not fail it (`oxlint-plugins/README.md`).
`experiments/` is outside the typecheck, so run a changed script once yourself.
`pnpm build` writes `@kampus/fabrika-old`'s `dist/`, what a pack holds. Nothing
above needs it; CI runs it too (experiment 108).
Exact npm versions only, never a range: `pnpm lint` fails on one ([exact versions](./docs/direction/pin-exact-versions.md)).

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
pnpm format     # oxfmt and oxlint: format, sort imports and apply safe fixes, in place
```

Run `pnpm format` first, so a diff holds only what was meant. The format settings
are in `.oxfmtrc.json`: tabs, 100 columns. The lint rules are in `.oxlintrc.json`:
the rules of the pipeline this repo rebuilds, with its custom rules in
`oxlint-plugins/`. Why these two tools:
[oxlint and oxfmt](./docs/direction/oxlint-and-oxfmt.md). Never switch a rule off
to pass. A `// oxlint-disable-next-line <rule> -- <why>` is for a line where the
code is right and the rule does not fit, and its reason says why in plain words.

A real Jev call needs `TYPESAFE_API_KEY` in the environment. Run everything
else with it unset, so no test can spend money by accident. Before any paid
run, estimate the cost, try a handful of cases, look at the answers, then
scale. Jev bills by the token, about $0.04 per million in, so send the least text that
answers the question. Record what it cost in the write-up. Every model run gets dollars
at the provider's list price, with the source and date, even when it ran on a subscription: a plan hides the
number the comparison needs.

A check that can block a pull request needs its false alarms measured first: about 0% to
block, up to 10% to only advise (Google, CACM 2018). Every number in a rule needs a
source or our own data. A tool's default is not a source.

### Go easy on the machine

These run on a laptop a person is using. A prompt can't see the load, so every agent
brief carries these caps. Each one came from a laptop that became unusable.

- Tests: `nice -n 15 pnpm exec vitest run --maxWorkers=3`, a narrow path while you
  work, the full suite once at the end. With two or more code agents running:
  `nice -n 19`, `--maxWorkers=1`, one `pnpm typecheck` at the very end. `tsgo` takes
  about 8 cores, so small jobs add up.
- "Under load" means at most 2 CPU burners, one test loop, and one Docker box.
- Never run the sandbox runtime or a shimmed tool with `env -i` or `HOME` unset while a
  version-manager shim is on `PATH`: one run made about 7,000 processes. Set `ulimit -u`
  in a subshell first.
- Searches: `gh search code` first. Locally, `nice -n 19 rg` on working trees, one repo
  at a time. Never `git grep` across all branches. If a search goes heavy, stop the
  agent, not its child process.
- Mutation runs: a fixed-seed sample of about 150, never the whole set (seed 119120 is
  the shared one), under `nice -n 15`, with a fixed number of runs. Ask before you
  scale up.
- A test window always sets its own `FABRIKA_HOME`, with a short path, since a socket
  path has a 103-byte limit. It never sets `FABRIKA_FOREGROUND=1`.
- A wait or poll loop runs in the background.

### Tool facts that cost us time

- `gh pr edit` fails here with a classic Projects error. Use `gh api -X PATCH`.
- In `claude -p`, `--allowedTools` only pre-approves. `--tools` is what limits an agent;
  without it the agent keeps a shell and can read what you meant to hide, git history
  included.
- `rg <subfolder>` skips tracked files when a root `.gitignore` re-includes them with
  `!path`. `rg .` is fine.

## This repo is public

- No secrets, and never print or write a key.
- A list of open security holes stays out of this repo. Each fix lands as a normal pull
  request.
- No absolute paths from anyone's machine. Use repo-relative paths or `~`.
- No personal names or account names.
- Never quote what a person typed in a chat session. Record the decision, not
  the conversation. Text a person posted publicly on an issue or pull request
  may be linked and summarised.

## Running the machine on a real ticket

A live run changes a real repository. How to run one:
[Run a ticket through the pipeline](./docs/how-to/run-a-pipeline-ticket.md). How a pull request
that went by hand lands is in [the plan](./docs/plan/README.md#how-a-change-lands). The rules for a
live run, each learned from a run:

- The target repository's own merge rules apply. Never merge by hand, never arm
  auto-merge, never push to its main branch. A change lands only through the
  ship stage.
- A pull request that went by hand is not a live run, and neither is what is left
  once a lane is finished and stuck. Each lands by
  [the plan's rule](./docs/plan/README.md#how-a-change-lands).
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
- American English everywhere: color, behavior, canceled. Saved prompts, results and
  stored data values stay as they are.
- Size work in files, lines and agent hours, never human days.
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

- **The daily moment comes first.** Cut scope by deferring, never by making the daily
  flow clunky. An outside tool that "works fine" is no reason to skip an in-app feature,
  and a design that needs Docker, a second server or a second app to start fails.
- **The first slice works, later slices harden.** Each tier is a whole vehicle
  ([tiers](./docs/plan/tiers.md)). Each person answers for their own agents, so a first slice
  does not defend against them; strangers on a public address are a different case.
  Tier size never pushes work out: split the tier, and say what a new idea changes now.
- **Secure and simple.** For any security step, say when a person meets it and how
  often. No prompt on opening the app, nothing hourly. The protection goes in code, not in a
  chore.
- **No new paid accounts** until fabrika is a product. Design for the free route and say
  what it can't do.
- **All in on Manti.** Never "Manti or native": a better way goes into Manti by pull
  request, tried first with a `pnpm patch` ([UI on Manti](./docs/direction/ui-on-manti.md)).
- **Keep the platform's defaults.** On a Mac, closing a window keeps the app running and
  Cmd-Q quits. Leaving a convention needs the owner's yes.
- **Subtle, and accessible without apology.** Color is never the only cue (WCAG 1.4.1).
  Give sources for ARIA and WCAG claims, and say what needs a real screen reader run.
  Read a design system's docs and components before you map its tokens.
- **No extra containers.** If something already draws an edge, a second line, box or
  background goes.
- **"Like Tuval" means read how Tuval solved the whole feature** before you design. Old
  code is evidence, not a target.
- **Mockups use the real thing:** real tickets, steps, programs and fact names, with a
  "made up" list for anything that isn't.
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
