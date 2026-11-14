# Working in this repo

A map for any agent or person picking up work here. A rule lives where it is read: a check's own
message, a decision file, a folder's `AGENTS.md`, or this page
([0129](./.decisions/0129-agents-md-becomes-a-short-map.md)). Read this first, then
[`docs/plan/README.md`](./docs/plan/README.md) for where the work stands, then
[`docs/direction/README.md`](./docs/direction/README.md) for why.

## What this repo is

An experiment that rebuilds an agent pipeline ("fabrika") as plain state machines on
[`@demlik/tea`](https://github.com/kamp-us/demlik). Code holds the loop; an agent does one bounded
job inside it. The repo is as much a lab notebook as a codebase: what was tried, what happened on
real tickets, and what was decided are all kept here on purpose, so they can be analysed later.

## Two versions, side by side

```text
next/              what we are building, on the decisions; its rules are in next/AGENTS.md
everything else    what we use today (packages/, programs/, apps/), and a map of which jobs exist
```

`next/` grows beside today's version, which keeps running for daily use until the new one takes
each job over ([0217](./.decisions/0217-next-grows-beside-today.md),
[clean slate](./docs/direction/clean-slate.md)). How far it is:
[where we are](./docs/plan/README.md#where-we-are-now).

- **Know which version your work is in** before you read or change code. Your brief or ticket says
  so. If it does not, a fix to something in use is today's version, new design work is `next/`, and
  if you still cannot tell, ask.
- **A search finds both.** Check the path of every file you read before you trust it. A name that
  exists in both can mean different things: a `rev` or a `host` in today's code is not the same as
  in the decisions.
- **Say which version a claim is about,** in every write-up, note and report. "The host keeps X" is
  true of one version.
- **In `next/`:** read [`next/AGENTS.md`](./next/AGENTS.md) before you touch a file there.
- **In today's version:** fixes that daily use or CI needs, the UX work the owner picks, and ideas
  the owner wants to try out there first. What a tryout teaches goes into `next/` as a lesson,
  rethought and not copied. Nothing else is added (0217). Today's library is `@kampus/fabrika-old`
  and today's app is `@kampus/fabrika-app-old`; both are deleted when `next/` takes over.
- **A product foundation decided in a walk starts on today's app at once,** no exception: tokens,
  focus, lint rules for the design, accessibility checks. Its build plan is written the same day
  and comes to the owner as one yes, so the decision is pressed in the real app while `next/` is
  built.
- **The design package is shared by both versions,** the one exception to sharing no code
  ([0456](./.decisions/0456-one-design-package-both-versions.md)).

## Where to read, where to write

| You want to | Read | Write |
|---|---|---|
| Know what is next and who has the move | [`docs/plan/README.md`](./docs/plan/README.md), then [`tiers.md`](./docs/plan/tiers.md) and [`tier-1.md`](./docs/plan/tier-1.md) | The plan docs, in the same pull request as the work ([0013](./.decisions/0013-plan-docs-change-with-the-work.md)) |
| Know what the owner decided | [`.decisions/`](./.decisions/); see [Decision discovery](#decision-discovery) | `.decisions/NNNN-slug.md`, the turn the owner decides, in its own docs pull request, with [`/adr`](./.agents/skills/adr/SKILL.md) ([0001](./.decisions/0001-decisions-live-in-the-repo.md)) |
| Know where this is going and why | [`docs/direction/`](./docs/direction/README.md), the long design notes | A note there when a decision needs the long reasoning, plus its row in that folder's README. Mark it **proposed** until it is settled. Its decision file links it |
| Know where `next/` follows a model (OTP, Elm, Kubernetes) and where it leaves it | [`docs/direction/follows/`](./docs/direction/follows/README.md) | The row, in the pull request that changes that behavior ([0017](./.decisions/0017-each-model-we-follow-has-one-table.md)) |
| Know what a word means | [`.glossary/TERMS.md`](./.glossary/TERMS.md): `next/`'s words by bounded context; its last section translates today's code's words | A row there, in the pull request that coins or renames a word |
| Know how the code is shaped now | [`.patterns/README.md`](./.patterns/README.md), then the doc for your change. When a doc and the source disagree, the source wins | `.patterns/<name>.md` plus its index row, with the [write-pattern skill](./.agents/skills/write-pattern/SKILL.md) ([0005](./.decisions/0005-patterns-and-decisions-are-visual.md)) |
| Know a design area's guidelines | `docs/guidelines/<area>.md`, read whole | An edit to the page, in a pull request the owner says yes to ([0136](./.decisions/0136-guidelines-live-in-their-own-pages.md)) |
| Write guidelines for one design area | [the guidelines skill](./.claude/skills/guidelines/SKILL.md) | What that skill lists, in its shape |
| Know what was tried and what came back | [`experiments/README.md`](./experiments/README.md), then the write-up | `experiments/NN-short-title.md` with the next free number, plus its index row. Raw results go to the private archive, never into git; a script stays on its own branch, named in the write-up ([0027](./.decisions/0027-experiment-results-live-in-a-private-archive.md)). A write-up nothing cites leaves once its lesson is in `.decisions/`, `.patterns/` or `docs/direction/` |
| Know what happened on real tickets | [`field/README.md`](./field/README.md), then `field/notes/` and `field/runs/` | One file per agent run and one per thing that broke, cost too much, needed a person or worked well, the same day ([0090](./.decisions/0090-each-field-row-is-a-file.md)) |
| Report something wrong that your task does not cover | [`field/README.md`](./field/README.md#a-finding) | One row file in `field/findings/`, with proof, then keep going: never a fix, a ticket or only a mention, and never a security hole ([0035](./.decisions/0035-outside-work-becomes-finding-rows.md)) |
| Understand a design that is still a draft | `docs/` (for example [`docs/review-machine.md`](./docs/review-machine.md)) | A draft there. When a draft settles a direction, add the note under `docs/direction/` too |
| Build the new version | [`next/AGENTS.md`](./next/AGENTS.md), then `docs/direction/` | Code in `next/`, with its test beside it as `name.test.ts` |
| Change the machines (today's version) | `packages/fabrika`, `packages/pipeline`, `programs/*`, with the top-level [`README.md`](./README.md#what-is-in-this-repository) as the map and each part's own README | Code in the part's folder, with its test beside it as `name.test.ts`. New pipeline work goes in `packages/pipeline/src/`; a tool any factory could use goes in `packages/fabrika`. Outside a package, import it by its name, never by a path; inside one, by relative path. Toy projects used by tests live in `fixtures/` |
| Learn a package by doing it | [`docs/tutorials/`](./docs/tutorials/), one folder per tutorial | A folder there with a `package.json` whose `typecheck` covers the files. Run every step on a fresh clone before it lands |
| Run a real ticket through the pipeline | [the how-to](./docs/how-to/run-a-pipeline-ticket.md) and [its rules](./docs/how-to/run-a-pipeline-ticket.md#the-rules-for-a-live-run) | The run's rows in `field/`, the same day |
| Look at a live run's state and logs | `runs/` on your own machine | Nothing by hand. `runs/` is ignored by git and is never committed |

Tickets go in the app's own tracker (`tracker_file`). Never open a GitHub issue on this repo; GitHub
issues are for other people's repos
([the lead skill](./.agents/skills/lead/SKILL.md#tickets-and-tracker-posts)).

**Rule of thumb:** a decision goes in `.decisions/`, and its long reasoning in `docs/direction/`. A
measurement goes in `experiments/`. Something that happened on a real ticket goes in `field/`. If a
piece of knowledge about this project lives only in a chat or in an agent's private memory, it is in
the wrong place: write it here.

## Decision discovery

List `.decisions/`: filenames identify records, and each record's frontmatter gives its `id`,
`title` and `status`. Read applicable records when changing the choice they govern or resolving
conflicting guidance. Record new decisions with `/adr` ([skill](./.agents/skills/adr/SKILL.md)).

There is no committed decision index and no startup hook. Filenames plus frontmatter are the
discovery contract ([0008](./.decisions/0008-decision-discovery-is-the-agents-md-contract.md), after
[phoenix ADR 0129](https://github.com/kamp-us/phoenix/blob/main/.decisions/0129-adr-discovery-is-the-claude-md-contract.md)).
Repo tooling adds no Claude Code hooks, SessionStart or any other: a tool runs when called.

**Check what is settled first.** Before any question to the owner, design question, recommendation
or plan, search `.decisions/`, `.glossary/`, `docs/direction/`, `experiments/` and the plan for the
topic. That holds for a question an agent's plan raises and for a pull request you walk: compare its
shape with the note it says it builds, and name any place it walks a decision back. A claim about
how a piece runs comes from reading that piece's note now, never from a summary. A settled note is
evidence, not a tiebreaker: nothing from before experiment 107 (the first run on a repo other than
demlik) is trusted without a test, and in a redesign every serious branch goes on the table, with
what it would undo. **A stated principle covers every case it fits:** apply an owner ruling's
principle to each case it decides, not only the one it came with. Only a case it truly cannot decide
becomes a question.

## Finish your task

For every agent, whatever its step. A step's skill adds its own rules and its own answer format.

- **Finish the whole task.** Do not end your turn while you still owe work the task asked for. Do
  not end with a list of what is left, an offer to continue or a question about whether to go on: do
  the next part. An error, a timeout, a locked file, an empty result, a failing tool or a red check
  is an ordinary obstacle. Find its cause, then work through it with the access you have: wait and
  retry, fix the command, use another tool. An open question does not hold the parts that do not
  need its answer.
- **Stop only for a real blocker:** something a person decided on purpose (a file another step owns,
  access that was held back, a rule here that says never), a new design call, or work that cannot
  move without a person. Leave it alone, finish everything else, then say plainly what you found and
  exactly what you need. This loosens no rule here on pushes, merges, secrets or history.
- **These need no approval,** in your own worktree and on your own files: `pnpm format` and
  `pnpm lint`; a fix for a lint, format or type error your own change caused; your own narrow test,
  run again after a change; a command tried again after a timeout; an install with
  `--frozen-lockfile`; a commit of your own paths with the step-commit skill, which pushes for you
  (in a box, `drive.ts` commits and pushes instead); a finding row.
- **Report for a reader who saw none of the work.** Give the answer first, then what changed, what
  ran, and what could not run and why. Write full sentences in plain words, use no name you made up
  along the way, and give a path or a full URL for each thing you cite, so the report stands on its
  own.
- **A refusal, failure or problem seen a second time** gets its root cause found and a ticket filed,
  never another workaround or another ask.

## How a change lands

- **Every pull request, `next/` or today's, goes through the pipeline's steps:** plan, test writer,
  build, one review, each by its own agent, with laws. No builder starts before an approved plan and
  tests that exist ([the steps](./docs/direction/next-is-a-pipeline-pre-run.md)), and `next/` does
  not wait on the pipeline. Today's pipeline programs are paused, so the lead session's agents run
  the steps by hand, each logged in `field/`, and the lead reads every diff, CI and the leak grep
  before a merge. [The lead skill](./.agents/skills/lead/SKILL.md) says how, and
  [the plan](./docs/plan/README.md#how-a-change-lands) says how a change lands.
  [The tests skill](./.agents/skills/tests/SKILL.md#new-and-changed-laws) says what a new or changed
  law must be, and [the lead skill's "Land it" step](./.agents/skills/lead/SKILL.md#steps) what a
  loosening.sh hit on one means.
- **The decisions that shape the steps,** each read when you are at that point: mutation runs hourly
  on main, never as a step ([0066](./.decisions/0066-mutation-runs-on-a-schedule.md)); one fresh
  agent per step, which reads the lane's state file, does its one step and writes it back, driven by
  flows and `chain.ts`, never a lane agent ([0064](./.decisions/0064-the-lead-drives-with-flows.md),
  [the lead skill](./.agents/skills/lead/SKILL.md#run-a-whole-lane-with-chaints)); a fix round is one agent, and the same
  reviewer rechecks ([0177](./.decisions/0177-fix-round-is-one-agent.md)); a law that needs the real
  machine runs before the first review, and on the owner's Mac only after the lead's read and the
  owner's yes ([0178](./.decisions/0178-host-only-laws-run-first.md)); a lane stops at its second
  sent-back review ([0176](./.decisions/0176-second-send-back-stops-lane.md)); no number caps a pull
  request's size ([0099](./.decisions/0099-no-number-caps-a-pull-request.md)); the lead merges once
  every step passed, and only real loosening of a law or a new design call waits on the owner
  ([0014](./.decisions/0014-the-lead-merges-when-every-step-passed.md)); owed work needs no owner
  read ([0166](./.decisions/0166-owed-work-needs-no-owner-read.md)).
- **Who approves a plan, and what skips the steps:** the lead session approves a plan that only
  builds a decided note, and a new design call goes to the owner
  ([the lead skill, Steps](./.agents/skills/lead/SKILL.md#steps),
  [the open questions test](./.agents/skills/plan/SKILL.md#the-open-questions-test)). A docs-only
  pull request that writes down a decision skips the steps
  ([decisions land at once](./.agents/skills/lead/SKILL.md#decisions-land-at-once)), and so does lead
  tooling ([fast-tracked](./.agents/skills/lead/SKILL.md#lead-tooling-is-fast-tracked)), whose code
  still follows `next/`'s rules ([0033](./.decisions/0033-agents-code-follows-next-rules.md)). No
  new shell or Python script enters the repo
  ([0113](./.decisions/0113-no-shell-or-python-scripts.md)). Product code keeps its steps.
- **No agent approves a pull request, and no agent answers a question the machine put to a
  person.**
- **A step is a program,** and a prompt you would have typed is its first source. A v0 has no
  missing parts: quick means each part is small, never absent. A rule that code checks leaves the
  prose, a rule that code could check becomes a check, and only judgment stays in prose
  ([0408](./.decisions/0408-skills-keep-only-judgment.md)).

## Before you design anything

Each of these is read when a plan or a design is written. A decision file holds the rule where one
is linked; the others have no other home yet.

- **Lead with the known way.** Look up how the makers and the industry do it, and cite it, before
  you give a lean; a guess comes after, marked as a guess. If the plain way clashes with a stated
  goal, say so in one line, and let the owner pick. Never hide it behind a custom design.
- **Name the Elm answer first.** `@demlik/tea` is the Elm architecture in TypeScript. Parents are
  written by hand and step their children. Exceptions are named in
  [Elm first](./docs/direction/elm-first.md) with their reason; the first is tsh lines. The same
  goes for coordination (registry, mailbox, links, monitors, supervisors): do what Erlang/OTP does
  unless a written reason says otherwise.
- **tea stays small.** A host composes tea and Effect; tea does not grow to fit a host, and it does
  not take on our conventions. tea code uses the Effect engine (`@demlik/tea/effect`), and the
  Promise engine stays for those who want it. `./otel` is experimental only because nobody had used
  it, so use it, and do not work around it. What these experiments decide wins over an older demlik
  issue or ruling. Real tea bugs stay their own tickets.
- **Never wait on upstream.** Patch a package we do not own with `pnpm patch`, file the upstream
  issue the same day, and keep building; the bump that takes the release deletes the patch
  ([patch upstream locally](./docs/direction/patch-upstream-locally.md)). Read the package first and
  patch only a gap or bug that read proved
  ([0054](./.decisions/0054-read-upstream-before-patching-it.md)). An upstream issue reports one bug
  we proved, with its repro; a list of missing features found by reading is patched locally and not
  reported in bulk.
- **Read the installed version.** Agents know older libraries. Before you write or judge code
  against one, read the lockfile's version and that version's docs. A lint rule that fires a lot
  means ask why before you call it a false alarm. Before you write Effect code, read
  `node_modules/effect/AGENTS.md` in full: it ships inside the installed package, so it always
  matches the lockfile. Where it and a decision here differ, the decision wins
  ([0023](./.decisions/0023-next-follows-effects-code-style.md) lists the differences).
- **Judge a design by its properties, never its size.** Never pick between designs by how many lines
  or agent hours each takes. Judge by what is lost, what holds, how it reads and how it fails. Size
  a design once it is picked.
- **Judge an idea against the plan, never against today's code.** A "not yet", "later" or "too small
  today" claim is checked against what the plan says we are building. A plan file that is behind a
  decision is fixed the same turn.
- **Solve a problem we have.** A big vision gets saved as a note and tied back to a real problem. An
  experiment picks the tech. Aim at two people working together first: packages for others and
  publishing are recorded as later.
- **Moving a job from an agent to code?** Say what the agent was absorbing that code will not (the
  case nobody listed), what the "I don't know" exit is, and whether the rule makes honesty
  expensive. Check a rule against real moves you made this session: would it have blocked them if a
  machine had started you?
- **Protocols first, and a browser is always a client.** Name the protocol a boundary speaks before
  its implementation. A protocol may not need what a browser lacks: no Node, no Unix socket, no
  files, no WebSocket-level frames. Ask of every design: could a browser tab be this client?
  ([a browser is always a client](./docs/direction/a-browser-is-always-a-client.md)).
- **The data shape comes first.** Ask of every design: what fact is lost forever if we don't record
  it now? A fact that exists only when something is written (who, when on their own clock, what they
  saw, why) goes in now, even if nothing reads it yet: a field can be added later, but the entries
  written before it never get it. Derived things (durations, views, summaries) can wait, since they
  rebuild from the log. Before you say "add it later", say whether later loses data. If a fact is
  recorded but must not be trusted, keep it out of the deciding code's types.
- **Record wide, read later.** Record every measure we can, even if nothing reads it yet. The
  limits: it must not slow the work in a way we can measure, and it never holds a secret. Content a
  person may want gone stays deletable
  ([an agent run keeps its content](./docs/direction/an-agent-run-keeps-its-content.md)). The
  industry's name is wide events (Honeycomb; Stripe's canonical log lines).
- **Names.** Use the industry's word for a thing
  ([use the industry's names](./docs/direction/use-the-industrys-names.md)), checked on every pull
  request, prose included.
- **Data keys are short everyday words.** `for`, not `forWhat`. `reason`, not `reasonCode`. A key
  does not say again what its parent already says: inside an outcome, the reason is `reason`, not
  `outcomeReason`. If a short word could mean two things, pick a clearer short word before you reach
  for a long one. A short word keeps its one meaning inside its
  [bounded context](./docs/direction/we-follow-ddd.md): `at` is a time, `by` is who wrote it, `_tag`
  is the case. Today's code keeps `why` and `kind` until that code goes.

  ```ts
  // Yes: read it out loud and it is a sentence.
  { _tag: "ask", to: "owner", for: "approval" }
  { _tag: "send", to: "builder", reason: "checks_red" }
  // No: longer, and the parent already said it.
  { _tag: "ask", askWho: "owner", forWhat: "owner_approval" }
  ```
- **Decided, and read in their files:** try an existing tool before you hand-write one
  ([0040](./.decisions/0040-existing-tools-before-hand-written.md)); a choice that fits as a
  `fabrika.toml` value is one, declared once so a test sets it as a person does, and a plan asks "is
  this a setting?" of each new choice and says why not
  ([0069](./.decisions/0069-choices-are-settings.md)); no question word is a name
  ([0081](./.decisions/0081-no-question-word-names.md)); plural service names and test tooling read
  through its module ([0029](./.decisions/0029-format-and-names-follow-effect.md)); new schemas are
  Effect Schema, where a pipeline primitive takes zod or Effect and tea's `Cmd.make` takes Effect
  schemas only ([0209](./.decisions/0209-schemas-are-effect-schema.md)); every union's tag is `_tag`,
  and plain fields stay plain words, such as `platform`
  ([0214](./.decisions/0214-unions-are-tagged-with-tag.md)); a step answers in five verbs, and in
  today's code, which still says stage for a step, a new step machine writes only its own words with
  `outcomesOf` in `packages/pipeline/src/stages/outcome.ts` and prints a name with `nameOf`
  ([0396](./.decisions/0396-every-step-answers-in-five-verbs.md)); build from the six pipeline
  primitives in `packages/pipeline/src/primitives.ts` and their combos in `combos.ts`: Gather (code
  reads), Act (code writes), Listen (code waits on an outside event), Draft (an agent produces
  within limits), Check (code judges an output), Judge (a small classifier answers one narrow
  question) ([0421](./.decisions/0421-reuse-before-special-rules.md)); talk to typed services, never straight
  to a command-line tool, `gh` included ([0231](./.decisions/0231-ledger-and-codehost-are-separate.md)).

## Checks

```sh
pnpm format     # first, so a diff holds only what was meant: formats and applies safe fixes, in place
pnpm typecheck  # tsc with Effect's own checks (@effect/tsgo): an Effect made and dropped fails it
pnpm lint       # oxlint, oxfmt and stylelint, changing nothing; a warning fails it too
pnpm test
```

Typecheck, lint and test must all pass before a change is offered. None needs a key or the network. A push does
not wait on a local `pnpm typecheck`: CI runs it, and a pull request merges only when it is green
([0133](./.decisions/0133-no-push-waits-on-a-local-typecheck.md)). Run the narrowest check that
still covers the change, as
[Effect's own repo](https://github.com/Effect-TS/effect-smol/blob/main/AGENTS.md) asks of its
agents. This table adds no rule, and `pnpm format` comes first in every row.

| What changed | What to run here |
|---|---|
| Only Markdown that no program or skill reads, or field rows | `pnpm lint`. CI skips the heavy jobs, and its `field` job checks the added rows |
| Skill prose | `pnpm lint`, which runs `skillscheck.sh`, its one reader |
| A skill script, or Markdown that a program or skill reads | as code, below |
| Code, in `next/` or today's version | `pnpm lint`, a narrow vitest path while you work, `--changed origin/main` once at the end, then one `pnpm typecheck`. Never the full suite locally |
| A dependency's version | as code, but narrow paths in place of `--changed`, which a lockfile change makes the full suite |
| A script under `experiments/` | `pnpm lint`, and run the changed script once yourself: it is outside the typecheck |
| A tutorial's files | `pnpm typecheck`, and every step on a fresh clone |
| A program's window | as code, plus shots from the real built app at the five layouts ([Changing the product](#changing-the-product)) |

- **Never switch a lint rule off to pass.** A `// oxlint-disable-next-line <rule> -- <why>` is for a
  line where the code is right and the rule does not fit, and its reason says why in plain words.
  The rules are in `.oxlintrc.json` and `oxlint-plugins/`
  ([its README](./oxlint-plugins/README.md)), the format settings in `.oxfmtrc.json`.
- **An unused export fails lint** (`pnpm lint:dead` runs that part alone,
  [0006](./.decisions/0006-no-unused-exports.md)). Check each finding
  by hand. If it is right, delete the code or drop its `export`. If it is wrong, stop and tell the
  owner: that is a code-graph bug to file. `unreachable-ledger.json` only shrinks, the run prunes
  it, and CI fails until that is committed. No entry is added: its last ones are fixed, then the
  file is deleted ([0524](./.decisions/0524-no-list-lets-broken-code-pass.md)).
- **A check on the shape of code is a lint rule, never a test:** oxlint's own rule where one exists
  (`no-restricted-imports`), else ours in `oxlint-plugins/`. A plan asks "lint, type or test?" of
  every law.
- **A check that can block needs its false alarms measured first:** about 0% to block, up to 10% to
  only advise (Google, CACM 2018). Every number in a rule needs a source or our own data. A tool's
  default is not a source. [0523](./.decisions/0523-advice-rules-block-where-clean.md) sets the
  five old advice rules aside from this: they block in every folder at zero.
- **A flaky test is fixed the day it is seen**
  ([0036](./.decisions/0036-a-flaky-test-is-fixed.md)).
- **Money.** A real Jev call needs `TYPESAFE_API_KEY` in the environment. Run everything else with
  it unset, so no test can spend money by accident. Before any paid run, estimate the cost, try a
  handful of cases, look at the answers, then scale. Jev bills by the token, about $0.04 per million
  in, so send the least text that answers the question. Record what it cost in the write-up. Every
  model run gets dollars at the provider's list price, with the source and date, even when it ran
  on a subscription: a plan hides the number the comparison needs.
- `pnpm build` writes `@kampus/fabrika-old`'s `dist/`, what a pack holds. No check needs it; CI
  runs it too.

### Go easy on the machine

These run on a laptop a person is using. A prompt can't see the load, so every agent brief carries
these caps. Each one came from a laptop that became unusable.

- **Tests:** `nice -n 15 pnpm exec vitest run --maxWorkers=3`, a narrow path while you work, then
  `--changed origin/main` once at the end. Never the full suite locally: the test config refuses it
  ([0410](./.decisions/0410-the-machine-caps-live-in-code.md)). When a change makes `--changed` the
  full suite (a `package.json`, the lockfile, a tsconfig), run the narrow paths of the tests you
  touched and of the tests that read that file. CI picks its jobs from the changed paths
  (`.github/ci/changes.mjs`, [0175](./.decisions/0175-every-run-follows-its-paths.md)); a run that
  needs what CI lacks (Electron shots, a stage with workerd) still runs here.
- **With two or more code agents running:** `nice -n 19`, `--maxWorkers=1`, one `pnpm typecheck` at
  the very end. `tsgo` takes about 8 cores, so small jobs add up.
- **At most 12 code agents, one `pnpm typecheck` at a time across all of them, one Electron test app
  and one Docker box** ([0012](./.decisions/0012-twelve-agents-at-once.md)). Wait while
  `pgrep -x tsgo` finds one (`pgrep -f tsgo` also matches the waiting shell, so that loop never
  ends); in a step's box, skip the wait, since `pnpm typecheck` takes its own lock. Two type checks
  at once, not the agent count, is what froze the laptop. If it feels slow, drop back to 8 agents.
- Never run the sandbox runtime or a shimmed tool with `env -i` or `HOME` unset while a
  version-manager shim is on `PATH`: one run made about 7,000 processes. Set `ulimit -u` in a
  subshell first.
- Searches: `gh search code` first. Locally, `nice -n 19 rg` on working trees, one repo at a time.
  Never `git grep` across all branches. If a search goes heavy, stop the agent, not its child
  process.
- Mutation runs: a fixed-seed sample of about 150, never the whole set (seed 119120 is the shared
  one), under `nice -n 15`, with a fixed number of runs. Ask before you scale up.
- A test window is launched only through `apps/fabrika/test-window.ts`, which lint holds and which
  keeps it out of the person's way: its own short `FABRIKA_HOME`, never `FABRIKA_FOREGROUND=1`,
  never `focus()` or `show()`. Shots come only from `page.screenshot`.
- A wait or poll loop runs in the background.
- A step that needs ports, sockets or its own processes runs in a container, never behind a hole in
  the laptop sandbox ([0045](./.decisions/0045-test-steps-run-in-containers.md)).

### Tool facts that cost us time

- `gh pr edit` fails here with a classic Projects error. Use `gh api -X PATCH`.
- In `claude -p`, `--allowedTools` only pre-approves. `--tools` is what limits an agent; without it
  the agent keeps a shell and can read what you meant to hide, git history included.
- `rg <subfolder>` skips tracked files when a root `.gitignore` re-includes them with `!path`.
  `rg .` is fine.

## This repo is public

- No secrets, and never print or write a key.
- A list of open security holes stays out of this repo. Each fix lands as a normal pull request.
- No absolute paths from anyone's machine. Use repo-relative paths or `~`.
- No personal names or account names.
- Never quote what a person typed in a chat session. Record the decision, not the conversation.
  Text a person posted publicly on an issue or pull request may be linked and summarised.

## How to write here

Write-ups are read by busy people, some of them not native English speakers.

- Plain everyday words and short sentences. Give the answer first.
- American English everywhere: color, behavior, canceled. Saved prompts, results and stored data
  values stay as they are.
- Size work in files, lines and agent hours, never human days.
- At most one simple table per section. No box drawings.
- **Show it in code.** A design or direction document carries code blocks: the types, the state, the
  step function, one example call with its answers. A reader should be able to see the machine from
  the code blocks alone. Mark a sketch as a sketch. Open with one small block that shows the whole
  idea.
- Every recommendation says why, what it costs, and how sure you are. Under about 80% sure, name the
  doubt and what would settle it.
- A write-up ends with what it cannot tell us. A run that shows what breaks is as useful as a clean
  one; do not smooth a failure over.
- Guesses that turned out wrong stay in the record, marked as wrong.

## Changing files

- Change code with an editor-style edit, not with a find-and-replace script run over the tree.
- Move files with `git mv`, so history follows.
- Stage your own paths by name. Another session may have work in the same checkout.
- Push every commit when you make it, and give its branch a draft pull request at the first commit
  ([0134](./.decisions/0134-no-code-stays-only-on-a-local-branch.md)).

## Changing the product

For a change to what a person sees or uses, in either version. These have no folder of their own:
a window lives in `apps/`, `programs/` and `next/` alike.

- **The daily moment comes first.** Cut scope by deferring, never by making the daily flow clunky.
  An outside tool that "works fine" is no reason to skip an in-app feature, and a design that needs
  Docker, a second server or a second app to start fails.
- **The first slice works, later slices harden.** Each tier is a whole vehicle
  ([tiers](./docs/plan/tiers.md)). Each person answers for their own agents, so a first slice does
  not defend against them; strangers on a public address are a different case. Tier size never
  pushes work out: split the tier, and say what a new idea changes now. Make it work, then better,
  then secure ([0171](./.decisions/0171-make-it-work-then-better-then-secure.md)).
- **Secure and simple.** For any security step, say when a person meets it and how often. No prompt
  on opening the app, nothing hourly. The protection goes in code, not in a chore.
- **No new paid accounts** until fabrika is a product. Design for the free route and say what it
  can't do. Cloudflare is the exception: fabrika assumes its paid Workers plan, such as its Secrets
  Store.
- **All in on Manti** ([0461](./.decisions/0461-every-ui-part-is-on-manti.md)).
- **Keep the platform's defaults.** On a Mac, closing a window keeps the app running and Cmd-Q
  quits. Leaving a convention needs the owner's yes.
- **Subtle, and accessible without apology.** Color is never the only cue (WCAG 1.4.1). Give sources
  for ARIA and WCAG claims, and say what needs a real screen reader run. Read a design system's docs
  and components before you map its tokens.
- **No extra containers.** If something already draws an edge, a second line, box or background
  goes.
- **"Like Tuval" means read how Tuval solved the whole feature** before you design. Old code is
  evidence, not a target.
- **Mockups use the real thing:** real tickets, steps, programs and fact names, with a "made up"
  list for anything that isn't.
- **No rough first versions.** A change to the product (`apps`, `programs`, `packages`) lands
  finished and thought through: all it shows works, with no stub, dead button or "(not yet)". A
  piece that waits on other work stays out of the window until it is real. `experiments/` is the lab
  and may be rough.
- **Ask how Linear would do it.** Before building any screen (a program's window, the app's frame, a
  mockup), ask how Linear would build it as their new product. The PR says, per screen, what Linear
  would do, and where we differ and why. Tuval and tmux stay the defaults for tiling; where they
  clash with Linear's answer, name the clash for the owner to pick.
  - **Linear as the builder, never as the template.** The question is how Linear's team would build
    the feature as fabrika programs, with fabrika's own pieces: programs that compose in tiles, the
    desk, the top bar, pipes between programs. Their taste and quality bar, on our primitive. Never
    copy a Linear screen. Ask which program owns the job, what composes beside what, and what
    becomes a piece every program gets for free.
- **Pick the look before the PR.** A screen being built in today's app runs the look step
  ([step 5 of the guidelines skill](./.claude/skills/guidelines/SKILL.md#5-build-3-or-4-designs-and-look-at-them-next-to-linear))
  before its pull request opens: 3 or 4 real designs, shots at the five layouts beside Linear, and
  the owner picks one. That covers all work in flight: the ask desk, the inbox, the project window
  and typography. The keys editor already does it.
- **Show it running.** A PR that adds or changes a program's window carries screenshots from the
  real built app, attached and never committed
  ([0160](./.decisions/0160-pr-shots-are-never-committed.md)). The step that shoots writes them
  under `runs/`, and the lead attaches them, each with alt text. Take them the way
  `apps/fabrika/e2e.ts` drives the app: Playwright on Electron, with `FABRIKA_HOME` set to a test
  home of its own in a temp folder, never your real one. Look at each shot, and say in the PR what
  looks broken, empty or wrong.
- **Shoot more than one layout.** A window that looks right in one wide tile can break at half or a
  quarter. Mockups and PR shots show each key state in at least: one tile filling the window, two
  tiles side by side, two stacked, a 2x2 grid, and a small app window (about 1024x700). Name each
  shot by state and layout, and say what squeezes or breaks in each.
