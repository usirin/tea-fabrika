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
| Know what is next and who has the move | [`docs/plan/README.md`](./docs/plan/README.md), then [`tiers.md`](./docs/plan/tiers.md) and [`tier-1.md`](./docs/plan/tier-1.md) there | That README, in the same pull request or the same day, when the plan or its state changes. A pull request that builds or finishes a Tier 1 row or a tracked plan item updates that row in `tier-1.md` and "Where we are now" in the README in the same pull request; if the step's owner list does not allow it, the lead updates them the same day ([0013](./.decisions/0013-plan-docs-change-with-the-work.md)). |
| Know what the owner decided | [`.decisions/`](./.decisions/), one short file per decision; see [Decision discovery](#decision-discovery) | `.decisions/NNNN-slug.md`, the turn the owner decides, in its own docs pull request, with [`/adr`](./.agents/skills/adr/SKILL.md). |
| Know where this is going and why | [`docs/direction/`](./docs/direction/README.md), the long design notes | A note there when a decision needs the long reasoning, plus its row in that folder's README. Mark it **proposed** until it is settled. Its decision file links it. |
| Know where `next/` follows a model (OTP, Elm, Kubernetes) and where it leaves it | [`docs/direction/follows/`](./docs/direction/follows/README.md), one table per model, one row per behavior | The row, in the same pull request that changes that behavior ([0017](./.decisions/0017-each-model-we-follow-has-one-table.md)). |
| Know what a word means | [`.glossary/TERMS.md`](./.glossary/TERMS.md): `next/`'s words, one section per bounded context, one row per word in it, with what it is not; its last section translates today's code's words | A row there, in the same pull request that coins or renames a word. |
| Know how the code is shaped now | [`.patterns/README.md`](./.patterns/README.md), the index, then the doc for your change. When a doc and the source disagree, the source wins | `.patterns/<name>.md` plus its index row, with the [write-pattern skill](./.agents/skills/write-pattern/SKILL.md): a Mermaid diagram first, then one real code block, then words, citing `path:line` ([0005](./.decisions/0005-patterns-and-decisions-are-visual.md)). |
| Write guidelines for one design area | [`.claude/skills/guidelines/SKILL.md`](./.claude/skills/guidelines/SKILL.md), the steps in order, and its page checklist | One experiment, one proposed note, their two index rows and one Design canvas ([drawn on Claude Design](./docs/direction/design-on-claude-design.md)), in the shape that skill gives. |
| Know what was tried and what came back | [`experiments/README.md`](./experiments/README.md), the index, then the write-up | `experiments/NN-short-title.md` for the write-up, with the next free number, plus one row in the index. A write-up quotes the numbers it uses inline. Raw results and assets (saved answers, shots, inputs, every timing of a run) go to the owner's private archive, not into git: a script writes them under `runs/` or to a path a flag names. A script is not kept on main: keep it on its own branch and name that branch in the write-up ([0027](./.decisions/0027-experiment-results-live-in-a-private-archive.md)). A write-up nothing cites leaves once its lesson is in `.decisions/`, `.patterns/` or `docs/direction/`. |
| Know what happened on real tickets | [`field/README.md`](./field/README.md), then `field/notes.jsonl` and `field/runs.jsonl` | One row per agent run in `runs.jsonl` and one note per thing that broke, cost too much, needed a person or worked well in `notes.jsonl`, the same day, in the schema the README gives. |
| Report something wrong that your task does not cover | [`field/README.md`](./field/README.md#a-finding), the fields and the closed `rule` list | One row in `field/findings.jsonl`, with proof, then keep going. Never fix it, file a ticket for it, or only mention it in your report; a person rates it, and a `fix` becomes a ticket ([0035](./.decisions/0035-outside-work-becomes-finding-rows.md)). Never a security hole. |
| Understand a design that is still a draft | `docs/` (for example [`docs/review-machine.md`](./docs/review-machine.md)) | A draft there. When a draft settles a direction, add the note under `docs/direction/` too. |
| Build the new version | [Two versions, side by side](#two-versions-side-by-side), then `docs/direction/` | Code in `next/`, with its test beside it as `name.test.ts`. |
| Change the machines (today's version) | The workspace packages (`packages/fabrika`, `packages/pipeline`, `programs/*`), with the list in the top-level [`README.md`](./README.md#what-is-in-this-repository) as the map and each part's own README for its files | Code in the part's folder, with its test beside it as `name.test.ts`. New pipeline work goes in `packages/pipeline/src/`; a tool any factory could use goes in `packages/fabrika`. Outside a package, import it by its name (`@kampus/fabrika-old`, a subpath such as `@kampus/fabrika-old/http`, or `@kampus/pipeline/<path>`), never by a path; the pipeline uses only fabrika's public names (`pnpm lint` checks both). Inside a package, parts import each other by relative path. The top level names no platform: a Node, Miniflare, Agent SDK, ACP or OpenTelemetry import goes on a subpath (`pnpm lint` bundles the top level for a browser and fails on one). `layer-rules.json` says which way imports may point (`pnpm lint` checks it). Toy projects used by tests live in `fixtures/`. |
| Learn a package by doing it | [`docs/tutorials/`](./docs/tutorials/), one folder per tutorial: its README and its finished files | A folder there with a `package.json` whose `typecheck` covers the files, so a change to the package that breaks the tutorial fails `pnpm typecheck`. Run every step on a fresh clone before it lands. |
| Look at a live run's state and logs | `runs/` on your own machine | Nothing by hand. `runs/` is ignored by git and is never committed. |

Tickets go in the app's own tracker (`tracker_file`). Never open a GitHub issue on this repo;
GitHub issues are for other people's repos
([the lead skill](./.agents/skills/lead/SKILL.md#tickets-and-tracker-posts)).

## Decision discovery

List `.decisions/`: filenames identify records, and each record's frontmatter gives
its `id`, `title` and `status`. Read applicable records when changing the choice they
govern or resolving conflicting guidance. Record new decisions with `/adr`
([the adr skill](./.agents/skills/adr/SKILL.md)).

There is no committed decision index and no startup hook. Filenames plus frontmatter are the
discovery contract
([0008](./.decisions/0008-decision-discovery-is-the-agents-md-contract.md), after
[phoenix ADR 0129](https://github.com/kamp-us/phoenix/blob/main/.decisions/0129-adr-discovery-is-the-claude-md-contract.md)).

**Rule of thumb:** a decision goes in `.decisions/`, and its long reasoning in
`docs/direction/`. A measurement goes in `experiments/`. Something that happened on a real ticket goes in `field/`. If a
piece of knowledge about this project lives only in a chat or in an agent's
private memory, it is in the wrong place: write it here. A decision lands as soon
as it is made: the lead writes `.decisions/NNNN-slug.md` and starts its docs pull request in the
same turn, and never waits for a code pull request or the end of the day (owner, 2026-11-09,
[0001](./.decisions/0001-decisions-live-in-the-repo.md)).

## Two versions, side by side

A new version of fabrika is growing in `next/`, built on
[the five layers](./docs/direction/a-local-first-sync-engine.md). As of 2026-11-09,
`next/` is on main, and 18 of Tier 1's 37 rows have merged
([where we are](./docs/plan/README.md#where-we-are-now)). Everything
else (`packages/`, `programs/`, `apps/`) is today's
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
`@kampus/libfabrika` is the library. Anyone can take `@kampus/libfabrika` alone and build a
client that works exactly like fabrika; fabrika is one libfabrika client. So for any file in
`next/apps/fabrika`, ask: would a from-scratch client have to write it again? If yes, it belongs
in libfabrika ([why libfabrika exists](./docs/direction/where-each-piece-lives.md#why-libfabrika-exists-decided-2026-11-08)).

- **A search finds both.** Check the path of every file you read before you
  trust it. A name that exists in both can mean different things: a `rev` or a
  `host` in today's code is not the same as in the decisions.
- **Say which version a claim is about,** in every write-up, note and report.
  "The host keeps X" is true of one version.
- **In `next/`:** follow `docs/direction`, not today's code. Read today's code
  and its tests to learn what jobs exist and what was learned, then rethink. Never
  import it and never copy it across
  ([rethink, do not port](./docs/direction/rethink-do-not-port.md)).
- **One exception: the design package is shared by both versions.** `@kampus/fabrika-design`
  holds the colors, the Manti mapping and the text roles, and today's app and `next/` both
  import it. Its contents come from settled notes, not today's shapes, and moving a file into it
  means rethinking it against them ([one design package](./docs/direction/fabrika-design-package.md)).
- **In `next/`, use Effect's platform modules, not `node:` imports,** where they cover the job:
  `effect/process`'s `ChildProcess` to spawn, `effect/cli` for flags, `FileSystem` and `Path` for
  files. A `node:` import stays only where Effect has nothing, marked as an edge with its reason
  (owner, 2026-11-09). The lint rule `fabrika/no-node-imports` comes with
  [PR 530](https://github.com/usirin/tea-fabrika/pull/530).
- **In `next/`, use the platform through Alchemy, never directly,** in the cloud and on the laptop
  alike: no `cloudflare:*`, `miniflare`, `workerd`, `wrangler` or `@cloudflare/*` import, no raw
  platform type, and nothing that starts or talks to the local runtime except through Alchemy. A
  gap is patched locally with its upstream issue filed the same day; a direct use stays only as a
  marked edge with the issue link. The six gaps 0042 lists are patched without an issue (its
  amendment, 2026-11-09). Today's direct uses move with their ports, and the lint rule is
  ticket 506 ([0042](./.decisions/0042-platform-pieces-go-through-alchemy.md)).
- **In `next/`, nothing is built on Promises.** It is Effect all the way. A Promise
  appears only in a one-line edge the platform demands, marked where it stands with
  `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, which the lead reads at merge
  ([no Promises](./docs/direction/no-promises.md)).
- **In `next/`, a resource is acquired in a scope.** A child process, a test window, a database,
  a file handle, a socket, a temp folder, a timer or a subscription is opened with
  `Effect.acquireRelease` and offered as a `Layer` or a scoped Effect, so the scope gives it back.
  No `try/finally` and no `afterEach` that releases it, and no "remember to close" in prose. A
  raw handle from the platform is wrapped once, at the edge. A process killed with SIGKILL runs no
  finalizer, so a resource that must not outlive it needs a guard outside the process too
  ([0061](./.decisions/0061-resources-are-acquired-in-a-scope.md)).
- **In `next/`, an object class stays thin.** It holds what the platform gives it and
  a one-line handoff. The logic is plain code that also runs on Node in tests
  ([an object class stays thin](./docs/direction/object-classes-stay-thin.md)).
- **Every pull request, `next/` or today's, goes through the pipeline's steps:**
  plan, test writer, build, one review, each by its own agent, with
  laws. Mutation runs hourly against main and files tickets, never as a step
  ([0066](./.decisions/0066-mutation-runs-on-a-schedule.md)). Since 2026-11-05 today's pipeline programs are paused, so the lead session's agents
  run the steps by hand, each logged in `field/`, and the lead agent reads every diff, CI
  and the leak grep before a merge. `next/` does not wait on the pipeline. No builder starts
  before an approved plan and tests that exist
  ([the steps](./docs/direction/next-is-a-pipeline-pre-run.md)). A plan that only builds a decided
  note is approved by the lead session after its own read and draft check. It writes
  `Approved by the lead agent, builds <note>; body <sha256-12>` on line 1 and replaces that line
  after any body edit, including an appended amendment. A plan that raises a new design call
  goes to the owner. A scheduled walk or approval that a decided note already answers is decided in
  the plan, and the lead approves it in one line; a question to the owner must be one they could
  answer no to without contradicting a decision (owner, 2026-11-08). In `next/`'s planner step
  this becomes code: a check on the plan's open questions. No merged pull request
  has been built this way yet ([where we are](./docs/plan/README.md#where-we-are-now)).
  A docs-only pull request that writes down a decision is opened the turn it is decided and
  merged when CI is green and the leak grep is clean, with no plan, tests, review or field rows.
  Code pull requests keep their steps (owner, 2026-11-09). Lead tooling is fast-tracked too
  (owner, 2026-11-09): skills, the lead scripts and the drive script run on our own laptop, so
  they are not product work. They skip the plan, tests and review steps. The lead or one
  agent changes them directly, keeps each change small, and merges on green CI with a clean leak
  grep. Fast-tracked is not loose: agents read `.agents/` and copy its habits, so its code follows
  `next/`'s conventions and lint rules, edge comments included. What it broke on the day it joined
  is in `agents-ledger.json`, which only shrinks; a shell or Python script moves to TypeScript and
  Effect when it is next touched ([0033](./.decisions/0033-agents-code-follows-next-rules.md)).
  Product code (`next/` and today's app) keeps its steps.
  A step is a program, and a prompt you would have typed is its first source: a rule in
  a prompt that could be code becomes code. A v0 has no missing parts: quick means each
  part is small, never absent. A rule that code already checks leaves a skill's prose; a rule
  that code could check becomes a check, then leaves the prose; only judgment stays in prose
  (owner, 2026-11-08).
  Every new or changed law is a property, or an example labeled vector, format, pinned or scenario
  with its reason. Zero hits from loosening.sh mean no owner read is needed. The lead records its
  output in the PR. A hit goes to the lead's hand check,
  with the hit list in the PR. Only real loosening waits on the owner.
  From 0066 the mutation comparison comes from the hourly run on main, after the merge, so at
  merge the lead reads loosening.sh alone.
  The lead merges any pull request, product code and exam changes included, with `catchup.sh`
  once every step passed, CI is green, the leak grep is clean and `loosening.sh` shows no real
  loosening after the hand check. Only real loosening of a law, or a new design call, waits on the
  owner ([0014](./.decisions/0014-the-lead-merges-when-every-step-passed.md)).
- **One fresh agent per step** (owner, 2026-11-09), and the lead drives with flows, never a lane agent ([0064](./.decisions/0064-the-lead-drives-with-flows.md)). Each step's agent reads the lane's state
  file, does its one step and writes the state file back for the next; no long driver carries a
  ticket. A drive script will chain the mechanical steps and start an agent only for judgment
  (tracker ticket 341). The lead skill says how.
- **An exam change that is all proper property tests merges without the owner's read** (owner,
  2026-11-08). Proper means every new or changed law is a property, or an example labeled
  `vector:`, `format:`, `pinned:` or `scenario:` with its reason, and `loosening.sh` shows no law got
  narrower. A change that loosens or removes a law still waits on the owner
  ([how a change lands](./docs/plan/README.md#how-a-change-lands)).
- **In `next/`, the shell is `fabsh`.** `tsh` stays in today's version.
- **In `next/`, a folder of libfabrika is a room, and a layer is a floor.** A room holds one
  subject, with front files and an `internal/` no other room imports, and it re-exports no other
  room's names. Its floor is one line in `layer-rules.json`: a room imports only from lower floors,
  never from its own. A room offers Effect services in its own types and errors, plus the shared
  names beside `Id.ts`: a lower room's error is translated at the service, with its cause kept, and
  `runtime/` never imports `ledger/`. A new file goes in its room now, before the move lands
  ([0043](./.decisions/0043-rooms-on-floors.md)). Test files keep the floors too, with no
  exemption: a room whose laws need a real database writes them as a suite, read through its
  module as `SinkTest.suite(nodeSql)`, and the room that owns the driver runs it; a helper two
  rooms share sits on a floor both may import
  ([0062](./.decisions/0062-test-files-keep-the-floors.md)).
- **In `next/`, a window reads state through tea's own React hook.** State lives in a tea
  machine, never `useState` ([Elm first](./docs/direction/elm-first.md)). From tea 0.23.0
  that hook is `useRuntime`: it takes an Effect-engine run, hands back a `send` that
  returns nothing, and reads one part through a selector, as in
  `useRuntime(run, (m) => m.views[id])`. No stand-in hook.
- **In `next/`, every state machine is explicit.** A stored value that changes and decides what is
  legal next is control state. It gets one named type with its transitions in one place, never
  flags, a position in code or an order two parties assume. A plan asks of new code: what are its
  states? ([0037](./.decisions/0037-implicit-state-machines-made-explicit.md)).
- **In `next/`, every state machine is a tea machine, and a file exports at most one.** No plain
  union with a transition function. The machine's Model, Msg and update live in that file, with no
  input or output code, and nothing outside it edits the Model by hand: it sends a Msg. A small
  private helper machine may share its parent's file. An `update` handler picks the next state with
  a plain conditional on `_tag`, not `Match` or `.match`. A file may export one machine factory, a
  function that takes a config and returns one machine, in place of the machine, never both
  ([0046](./.decisions/0046-one-tea-machine-per-file.md)).
- **In `next/`, no bare `of` and no `xOf` names.** `of` read through its module is fine, as
  Effect does it: `Lease.of(...)` under `import * as Lease`
  ([0029](./.decisions/0029-format-and-names-follow-effect.md)). Today's `nameOf` and `outcomesOf`
  stay until that code goes.
- **In today's version:** fixes that daily use or CI needs, the UX work the owner
  picks, and ideas the owner wants to try out there first. What a tryout teaches
  goes into `next/` as a lesson, rethought and not copied. Nothing else is added.
- **A product foundation decided in a walk starts on today's app at once,** no exception (owner,
  2026-11-07): tokens, focus, lint rules for the design, accessibility checks. Its build plan is
  written the same day and comes to the owner as one yes, so the decision is pressed in the real
  app while `next/` is built.
- **When `next/` takes a job over,** the pull request that switches to it deletes
  the old part. Its tests or laws are ported first.
- `next/` is the lab until a person opens it for real work, so it may be rough. "No
  rough first versions" (below) applies from then on.

## Decision discovery

List `.decisions/`: filenames identify records, and each record's frontmatter gives its `id`,
`title` and `status`. Read applicable records when changing the choice they govern or resolving
conflicting guidance. Record new decisions with `/adr`
([skill](./.agents/skills/adr/SKILL.md)). Before you ask the owner or write a plan, also search
`.glossary/` and `docs/direction/`.

There is no committed decision index and no startup hook. Filenames plus frontmatter are the
discovery contract
([0008](./.decisions/0008-decision-discovery-is-the-agents-md-contract.md)).

Repo tooling adds no Claude Code hooks, SessionStart or any other (owner, 2026-11-09). A tool runs
when called: `drive.ts` runs `box.sh gc` itself on start.

Tickets go in the app's own tracker (`tracker_file`). Never open a GitHub issue on this repo;
GitHub issues are for other people's repos ([lead skill](./.agents/skills/lead/SKILL.md)).

## Before you design anything

- **Check what is settled first.** Before any question to the owner, design question,
  recommendation or plan, search `.decisions/`, `.glossary/`, `docs/direction/`, `experiments/`
  and the plan for the topic. That holds for
  a question an agent's plan raises and for a pull request you walk: compare its shape
  with the note it says it builds, and name any place it walks a decision back. A
  claim about how a piece runs comes from reading that piece's note now, never from a
  summary. A settled note is evidence, not a tiebreaker: nothing from before experiment
  107 (the first run on a repo other than demlik) is trusted without a test, and in a
  redesign every serious branch goes on the table, with what it would undo.
- **A stated principle covers every case it fits.** When an owner ruling gives a principle, such as
  [0043](./.decisions/0043-rooms-on-floors.md)'s "the floor above never sees what is two floors
  down", apply it to each case it decides, not only the one it came with. Only a case it truly
  cannot decide becomes a question.
- **Lead with the known way.** Look up how the makers and the industry do it, and cite
  it, before you give a lean; a guess comes after, marked as a guess. If the plain way
  clashes with a stated goal, say so in one line, and let the owner pick. Never hide it
  behind a custom design.
- **Try an existing tool before you hand-write one.** A plan or pull request that adds a check, a
  script or a tool names the widely used tools it looked at, with a link each, and uses one or
  says what it cannot do, with proof. "We could write it quickly" is not a reason. A hand-written
  check lists its edge cases before the code, each with a test
  ([0040](./.decisions/0040-existing-tools-before-hand-written.md)).
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
- **Never wait on upstream.** When our work needs a change in a package we do not own (tea,
  Manti, Effect, any other), patch it locally with `pnpm patch`, file the upstream issue the same
  day, and keep building. The bump that takes the release deletes the patch
  ([patch upstream locally](./docs/direction/patch-upstream-locally.md)). First read the
  package's decisions, patterns and source and build on its answer; patch only a gap or bug that
  read proved ([0054](./.decisions/0054-read-upstream-before-patching-it.md)).
- **Read the installed version.** Agents know older libraries. Before you write or judge
  code against one, read the lockfile's version and that version's docs. A lint rule that
  fires a lot means ask why before you call it a false alarm.
  Before you write Effect code, read `node_modules/effect/AGENTS.md` in full. It ships inside the
  installed package (`effect` 4.1.2 today, 433 lines), so it always matches the lockfile. Where
  it and a decision here differ, the decision wins
  ([0023](./.decisions/0023-next-follows-effects-code-style.md) lists the differences). Effect's
  maintainer briefs agents the same way
  ([tim-smart/clanka's AGENTS.md](https://github.com/tim-smart/clanka/blob/master/AGENTS.md)).
- **Judge a design by its properties, never its size.** Never pick between designs by how many
  lines or agent hours each takes. Judge by what is lost, what holds, how it reads and how it fails
  (owner, 2026-11-07, field note 2026-11-07-13). Size a design once it is picked.
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
  types. Example: in `next/`, a ledger entry keeps the writer's own clock as `sentAt`
  from day one, but leases and limits use only the referee's `arrivedAt` (today's code
  says `said` and `at`).
- **Record wide, read later.** Decided by the owner on 2026-11-01: record every measure we
  can, even if nothing reads it yet, because we cannot know which question we will ask later.
  A measure nobody reads costs little; one we wish we had is gone. The limits: it must not slow
  the work in a way we can measure, and it never holds a secret. Content a person may want gone
  stays deletable ([an agent run keeps its content](./docs/direction/an-agent-run-keeps-its-content.md)).
  The industry's name is wide events (Honeycomb; Stripe's canonical log lines).
- **Use the six pipeline primitives.** Gather (code reads), Act (code writes), Listen (code
  waits on an outside event), Draft (an agent produces within limits), Check
  (code judges an output), Judge (a small classifier answers one narrow
  question). They are in `packages/pipeline/src/primitives.ts`; the combos
  built from them are in `packages/pipeline/src/combos.ts`.
- **New schemas are Effect Schema.** Define a Cmd through one of the primitives, or
  through tea's own `Cmd.make` from `@demlik/tea/effect`. Both take Effect
  schemas as they are, so nobody writes `Schema.toStandardSchemaV1`. zod stays
  only in code not yet moved. A primitive takes either; tea's Effect `Cmd.make`
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
  const closeTicket = Cmd.make("ticket_close", { input: Id, ok: Schema.Null, err: ["unknown"] });
  ```
- **Names.** Use the industry's word for a thing
  ([use the industry's names](./docs/direction/use-the-industrys-names.md)), checked on
  every pull request, prose included. An Effect service that holds many is named in the plural, as
  Effect has `Runners` and `Servers`: `Leases`, not `LeaseManager`. Test tooling follows the same
  names: a test helper or shared suite is read through its module, as Effect writes
  `SqlEventLogServerUnencryptedStorageTest.suite(...)`, so `SinkTest.suite(nodeSql)`, never a bare
  `sinkSuite(...)` ([0029](./.decisions/0029-format-and-names-follow-effect.md)).
- **Data keys are short everyday words.** `for`, not `forWhat`. `reason`, not
  `reasonCode`: `reason` is the industry's word (OTP's exit reason, Kubernetes' condition
  `reason`), so it wins over `why` (owner, 2026-11-09). Today's code keeps `why` until that code
  goes, as with `kind`, and main's `next/` code is renamed by a sweep after PR 530 merges (ticket
  337). A key does not say again what its parent already says: inside
  an outcome, the reason is `reason`, not `outcomeReason`. If a short word could
  mean two things, pick a clearer short word before you reach for a long one.
  A short word that already means something here keeps that one meaning inside its
  [bounded context](./docs/direction/we-follow-ddd.md): `at` is a
  time, `by` is who wrote it, `_tag` is the case. An entry's two clocks have their own
  names in `next/` (owner, 2026-11-05): `arrivedAt` is the referee's, when the entry reached
  the ledger, and `sentAt` is the writer's own, when it wrote it (Kafka's LogAppendTime and
  CreateTime). Today's code says `at` and `said`. In `next/`, a word means one thing. "Run"
  means an agent run only; one start of a program is a process (a restart is a new process, as
  in OTP). A place, a path, a ref, a state, a reason or a total gets its own word
  (`location`, `path`, `ref`, `state`, `reason`, `total`). `rg` the word under
  `docs/direction/` and `next/` before you use it.

  ```ts
  // Values as they read. In `next/`, Effect Schema writes the `_tag`; nobody types it.
  // Today's code says `kind` and `why` here.
  // Yes: read it out loud and it is a sentence.
  { _tag: "ask", who: "owner", for: "approval" }
  { _tag: "send", to: "builder", reason: "checks_red" }

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
- **A step answers in five verbs.** `done`, `send`, `ask`, `skip`, `stuck`.
  Today's code still says stage for a step. A new step machine writes only its own words, with `outcomesOf` in
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
pnpm lint       # oxlint, oxfmt and stylelint: lint rules, format, imports and CSS, changing nothing
pnpm test
```

All three must pass before a change is offered. None needs a key or the
network. `pnpm typecheck` runs Effect's own checks inside `tsc` (`@effect/tsgo`,
patched in by the same command), so an Effect made and dropped fails it. `pnpm lint` passes when nothing blocks: a warning fails it too. The two advice rules print and do not fail it (`oxlint-plugins/README.md`).
`experiments/` is outside the typecheck, so run a changed script once yourself.
`pnpm build` writes `@kampus/fabrika-old`'s `dist/`, what a pack holds. Nothing
above needs it; CI runs it too (experiment 108).
Exact npm versions only, never a range: `pnpm lint` fails on one ([exact versions](./docs/direction/pin-exact-versions.md)).

Run the narrowest check that still covers the change, as Effect's own repo asks of its agents
([Effect-TS/effect-smol's AGENTS.md](https://github.com/Effect-TS/effect-smol/blob/main/AGENTS.md), "Validation").
This table adds no rule: each row is a rule stated on this page, and `pnpm format` comes first in
every row.

| What changed | What to run here |
|---|---|
| Only Markdown that no program or skill reads, or `field/*.jsonl` rows | `pnpm lint`. CI skips `check`, `test`, `next` and `e2e` for them, and its `field` job checks the added rows |
| Skill prose | `pnpm lint`, which runs `skillscheck.sh`, its one reader |
| A skill script, or Markdown that a program or skill reads | as code, below |
| Code, in `next/` or today's version | `pnpm lint`, a narrow vitest path while you work, `--changed origin/main` once at the end, then one `pnpm typecheck`. Never the full suite locally |
| A dependency's version | as code; `pnpm lint` fails on a range |
| A script under `experiments/` | `pnpm lint`, and run the changed script once yourself: it is outside the typecheck |
| A tutorial's files | `pnpm typecheck`, and every step on a fresh clone |
| A program's window | as code, plus shots from the real built app at the five layouts ([Changing the product](#changing-the-product)) |

A report says which of these ran, and which could not run and why.

A flaky test is fixed the day it is seen, by removing its cause; nobody reruns it until green and moves on
([0036](./.decisions/0036-a-flaky-test-is-fixed.md)).

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
are in `.oxfmtrc.json`: 2 spaces, 120 columns and spaces inside braces, as Effect has them
([0029](./.decisions/0029-format-and-names-follow-effect.md)), with semicolons and trailing
commas, function parameters and call arguments included
([0039](./.decisions/0039-keep-semicolons-and-es5-commas.md)). The lint rules are in `.oxlintrc.json`:
the rules of the pipeline this repo rebuilds, with its custom rules in
`oxlint-plugins/`. Why these two tools:
[oxlint and oxfmt](./docs/direction/oxlint-and-oxfmt.md). Never switch a rule off
to pass. A `// oxlint-disable-next-line <rule> -- <why>` is for a line where the
code is right and the rule does not fit, and its reason says why in plain words.

A check on the shape of code, such as an import ban or "no program reaches a step", is a lint
rule, never a test: oxlint's own rule where one exists (`no-restricted-imports`), else ours in
`oxlint-plugins/` (owner, 2026-11-07). A plan asks "lint, type or test?" of every law. One sweep
found 7 of 27 shape tests could move (field note 2026-11-07-16).

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
  work, then `--changed origin/main` once at the end: only the tests that reach a changed file.
  Never the full suite locally (owner, 2026-11-08). On a pull request, CI decides what to run from
  the changed paths (`.github/ci/changes.mjs`). Only Markdown or `field/*.jsonl` rows: it skips
  `check`, `test`, `next` and `e2e`. Only `next/` files (but not the exam helper): it runs `check` and `next`,
  and skips `test` and `e2e`; a change to next's exam `commits.ts` runs `test` too. Only today's files: it skips `next`.
  Skill prose (skill Markdown outside `scripts/` and brief or prompt folders) skips `check`, `test`, `next` and
  `e2e`: its one reader, `skillscheck.sh`, runs in `changes`. Skill scripts run `check` and `test`, and vitest
  picks only the tests that `?raw`-import them (`script-reads` in `pnpm lint` keeps those imports whole).
  Other Markdown that a program or skill reads counts as code.
  Anything else, and every push to main, runs all jobs, so the full suite runs after the merge. A run that
  needs what CI lacks (Electron shots, a stage with workerd) still runs here. With two or more code agents running:
  `nice -n 19`, `--maxWorkers=1`, one `pnpm typecheck` at the very end. `tsgo` takes
  about 8 cores, so small jobs add up.
- "Under load" means at most 12 code agents, one `pnpm typecheck` at a time across all of
  them (wait while `pgrep -x tsgo` finds one; `pgrep -f tsgo` also matches the shell running
  the wait, so that loop never ends), one Electron test app at a time, and one Docker
  box. Raised from 2 to 4 on 2026-11-03, the owner asking for more speed: on a 12-core laptop
  with 3 code agents running, the load average sat near 5.5 with 45 GB free. Raised to 5 the
  same day, the owner asking again, with 4 running and the load near 9. Two type checks at
  once, not the agent count, is what froze it before. Raised to 8 on 2026-11-08 (owner): Codex
  step runs are light on the laptop. Still one type check at a time. If it feels slow, drop back
  to 5. Raised to 12 on 2026-11-09 (owner,
  [0012](./.decisions/0012-twelve-agents-at-once.md)): most lane agents wait on Codex steps, and
  two type checks at once, not the agent count, is what froze it. If it feels slow, drop back to 8.
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
- A test window stays out of the way of the person at the laptop. Right after launch, each
  `BrowserWindow` gets `setOpacity(0)`, `setIgnoreMouseEvents(true)` and a position in the work
  area's corner. Never `focus()` or `show()`. Shots come only from `page.screenshot`.
- A wait or poll loop runs in the background.
- A step that needs ports, sockets or its own processes runs in a container with its own network
  (`--network none` while test code runs), never behind a hole in the laptop sandbox: no
  `allowLocalBinding`, no unix-socket allowance, no patch of the tool. No key, login or home folder
  goes in. Docker not running ends the step `stuck`
  ([0045](./.decisions/0045-test-steps-run-in-containers.md)).

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
  what it can't do. Cloudflare is the exception: fabrika assumes its paid Workers plan, such as
  its Secrets Store (owner, 2026-11-06).
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
  - **Linear as the builder, never as the template.** The question is how Linear's team
    would build the feature if they were building it as fabrika programs, with
    fabrika's own pieces: programs that compose in tiles, the desk, the top bar,
    pipes between programs. Their taste and quality bar, on our primitive. Never
    copy a Linear screen. Ask which program owns the job, what composes beside
    what, and what becomes a piece every program gets for free.
- **Pick the look before the PR.** A screen being built in today's app runs the look step
  ([step 5 of the guidelines skill](./.claude/skills/guidelines/SKILL.md#5-build-3-or-4-designs-and-look-at-them-next-to-linear))
  before its pull request opens: 3 or 4 real designs, shots at the five layouts beside Linear,
  and the owner picks one (owner, 2026-11-08). That covers all work in flight: the ask desk,
  the inbox, the project window and typography. The keys editor already does it.
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
