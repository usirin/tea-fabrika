# @tea-fabrika/legacy

The first-generation factory and the old live operator. It is kept compiling and tested. Nothing new goes here, and it only shrinks.

```sh
pnpm demo                         # a toy ticket, triage through lane, scripted agents
TOY=duration AGENT=claude pnpm demo   # the harder toy with real Claude Code (pnpm demo:hard)
RUN=<folder> UNTIL=triage pnpm demo   # stop after triage; drop UNTIL to carry on
ISSUE=owner/repo#n REPO=<folder> BASE=<branch> RUN=<folder> PACKAGE=<path> TYPESAFE_API_KEY=... pnpm real
LANE=<n> REPO=<checkout> PLUGIN=<folder> TREES=<folder> RUN=<folder> node legacy/src/operate.ts
```

Each host lists every setting it reads in the comment at the top of its file.

## Where it sits

- Second from the top in `layer-rules.json`. Only `packs/` sits above it.
- It may import `@tea-fabrika/wip` (`operator-live`), `@kampus/pipeline`, `@kampus/fabrika` and anything below them.
- Nothing in the workspace imports it.

## What's in it

The `exports` map is `"./*": "./src/*.ts"`. Two parts, by file:

### The first-generation factory

Triage, then the lane, then ship.

- `factory.ts`: the parent machine that holds triage, the lane and ship, and hands work from one to the next.
- `triage.ts`: rewrites a raw ticket into one with criteria as data: a rule, and calls with exact results. In small steps:
  - Code reads what the report mentions and gathers facts about it.
  - The enricher writes from the facts.
  - Code vets each draft. Problems go back to the enricher in its own conversation, up to `vet_tries` drafts, then to a person.
  - The rewriter also names any product call the ticket rests on that nobody has made. If there is one, triage waits for the owner's ruling and rewrites with it.
  - Then Jev sorts it: type, priority, worth doing.
  - Draft and vet is `packages/pipeline/src/refine.ts`; triage's enrichment is its first use.
- `facts.ts`, `code-facts.ts`: facts, by code only, behind the `Facts` service.
  - The names, paths and `#N` refs a report mentions.
  - For each name: where HEAD declares it, its signature, its callers (code-graph's call graph), and the export subpaths that publish it (code-graph's resolver, plus a tier table if the package keeps one).
  - A name nothing declares is said so. That is often a stale report.
- `vetting.ts`: the checker for the enricher's draft.
  - Every named file is at HEAD, and ids are unique.
  - Every example, run on today's code in a throwaway copy, fails, as it should before the change. It is typechecked too when the repo is typed.
  - An example that holds already, or does not load, typecheck or run, goes back with why.
  - On a real monorepo, the throwaway copy is a worktree at HEAD, installed with `pnpm install --frozen-lockfile --prefer-offline`. The examples are typechecked alone with the package's `tsconfig.test.json`, or `tsconfig.json` when it has none. The builder's folder is never touched.
  - How long it takes per draft: [experiment 41](../experiments/41-enrichment-in-small-steps.md) and [45](../experiments/45-type-snippets-and-existing-tests.md).
- `enrichment.ts`: our enricher's rewrite as a page laid out like fabrika's, kept as `ours-enriched.md` beside `fabrika-enriched.md`.
- `sort.ts`: the questions Jev is asked to sort a ticket. Whether an agent can pick it up is not one of them: that is the rewriter's open call, above.
- `issue.ts`: the shape of a rewritten ticket, with its criteria as calls and exact results.
- `lane.ts`: writes the tests from the examples, builds, runs the tests, and hands the change to review. It retries up to three times by default.
  - The builder answers done, contradiction, blocked or dispute.
  - Contradiction also covers an example that could only pass by changing what the ticket does not ask for.
  - A ticket with a criterion that is not a call and its result parks as `unchecked`.
- `tests.ts`: turns a ticket's examples into a test file. Code writes it, so no model decides whether a criterion is met.
  - Each example imports its criterion's function and any other name its call `uses`, such as the library's own constructor, so a call can build a real value instead of a stand-in.
  - How the file is written, run, read back (each test's outcome, and whether a failure was its assertion) and typechecked alone is the workspace's flavour: node:test beside a toy's code, or vitest inside one package of a monorepo.
  - On a real monorepo the file is `<PACKAGE>/src/fabrika-<n>.test.ts`, committed and locked before the builder starts. The check runs the package's `typecheck`, `typecheck:test` and whole vitest suite (`host.ts`). The report keeps the failures and the issue's own tests and drops the rest.
- `review.ts`: review, a child machine of the lane.
  - Scope by code: a file is in scope when a criterion names it, as the file an example imports from, or a file an unchecked rule is about.
  - A reviewer agent that only finds. Code checks its quotes.
  - The router decides what is this ticket's. A person gets what it is unsure about.
  - Beside the reviewer, a missing-file check: a file the change should have touched and did not goes back to the builder as a finding. The builder fixes it by touching the file, or disputes it.
- `route.ts`: Jev's readers, each a plug-in behind its own service.
  - The router (`Router`): is an extra change, or a finding, about the ticket's goal?
  - The matcher (`Matcher`): does a new finding repeat one a person decided?
  - The comment reader (`CommentReader`): does the owner's comment change a rule?
  - The failure reader (`FailureReader`): did the tests fail on the builder's change, the test file, or the setup?
  - The missing-file reader (`MissingReader`): does the ticket need this untouched file changed too? One call per file in the packages the change touched that is one import from a changed file, or per file in those packages under `missing_scope = "package"`.
- `imports.ts`: the free cut before the missing-file check. It keeps a file only if it imports a changed file or a changed file imports it, matched by name, with no Jev call. What it keeps and saves: [experiment 38](../experiments/38-name-filter.md).
- `comments.ts`: the owner's comments, read before a lane calls itself done. Only a sure "changes nothing" passes without a person.
- `ship.ts`: the older ship, through the swappable `Repo` service. The ship machine in `packages/pipeline/src/stages/ship/` does not use it.
  - Seals the finished change as one commit, waits for a person to approve that commit, and lands it in the base.
  - Merges with a base that moved, and tests the merge first.
- `settings.ts`: the numbers a person tunes without touching code, read from a `fabrika.toml`.
  - The Jev readers' floors, how much of a run they read, retries and the model.
  - Which files the missing-file check asks about (`missing_scope`: the import neighbours of the change by default, or whole packages), and how many before it is skipped.
  - Triage's sort floor, and how many drafts the enricher gets to pass vetting (`vet_tries`).
  - A lane's try limit, and whether an unsure failure goes back to the builder or to a person.
  - Each key defaults to today's value. A value out of range, or an unknown key, is refused on load.
  - The machines never read it. A run copies what it needs into its own state when it is filed, so a restart replays by the numbers it started with. The order of the steps stays in code.
- `tracker.ts`: what the pipeline reads from where tickets live: the ticket and its comments. The `Tracker` service is swappable.
- `local.ts`: local git and the workspace: `fileTracker` (a folder, one JSON file per ticket), `localRepo`, `localWorkspace`, and the toys under `fixtures/`.
- `github.ts`: reads a GitHub issue as the ticket triage starts from: the report as filed, under any rewrite fabrika already made.
- `factory-services.ts`, `handlers.ts`: the factory's services, and the handlers that forward each Cmd to one.
- `claude.ts`: Claude Code as the enricher, builder and reviewer, one conversation per stage.
- `scripted.ts`: scripted stand-ins for every service, used by the tests.
- `surface.ts`, `declarations.ts`: what a package publishes.
- `drive.ts`: what the hosts share. Run the factory on one ticket, print every step, keep and resume the run, and stop at triage (`UNTIL=triage`) with the lane's work held.
- `host.ts`: the services and the test setup a real run needs.
- `demo.ts`, `real.ts`: the hosts. `demo` checks out a toy. `real` runs a GitHub ticket in a local checkout: see [Run a real ticket](../docs/how-to/run-a-real-ticket.md).
- `replay.ts`, `replay-run.ts`, `score.ts`: triage replayed on closed issues under `replay/`.

### The old operator

It drives one lane of today's fabrika.

- `operator.ts`, `turn.ts`: today's operator agent as a machine made only of the moves and combos in `wip`.
  - Claim the lane, make its working copy, then read the lane, start one turn per active task, and read again.
  - A turn routes by the state's name: run a shell, wait on CI or the merge queue, or gate a park to its recipe or to a person.
  - However the run ends, it removes the working copy and lets go of the lane.
  - Behind a switch that is off by default, its ship stage is the ship machine in `wip`, run as a child in place of the shipper shell: `createOperator(slots, { ship: "machine" })`, or `SHIP=machine` for `operate.ts`. `SHIP=program` runs the ship program there instead. `operate.ts` lists what each does.
  - Its runs: [experiment 48](../experiments/48-operator-from-six-moves.md) against a fake; [49](../experiments/49-operator-first-live-run.md), [50](../experiments/50-operator-second-live-run.md) and [52](../experiments/52-park-on-purpose.md) on real lanes; [56](../experiments/56-first-live-run-of-the-ship-machine.md) with the ship machine as its child.
- `operator-host.ts`: what the operator runs on. The handlers for its Cmds, the runners for its Subs (a shell is one Agent SDK run, with its tools pre-approved and a dollar cap), and the rows a run adds to `field/runs.jsonl`.
- `operate.ts`: the host that drives one real lane with the operator machine.
- `fabrika.ts`: fabrika as the operator meets it. An Effect service with typed methods and typed answers, not a CLI. Also the routing table (state name to action), who owns each park cause, and which parks a recipe clears. A lane's working copy is made and removed through `Worktrees` (`packages/pipeline/src/worktrees.ts`).
- `fabrika-cli.ts`: the live `Fabrika` over fabrika-cli 0.9.0. Temporary: each method is one or two verbs, and exit codes become typed answers. The other live Layers, working copies and the issue-comment thread, are `wip/src/operator-live.ts`.
- `fabrika-scripted.ts`: fabrika in memory for the operator's tests. One lane, scripted shells, a thread a person answers on, working copies kept in a set.
- `shell-skill.ts`: what a shell is sent. It puts the shell's skill in front of its brief, in code, because a fabrika shell run as the SDK's main agent gets none. What a shell may not do is `packages/fabrika/src/agents/claude/shell-guard.ts`.
- `lane-log.ts`, `lane-replay.ts`, `lane-scripted.ts`: a lane read back from disk, replayed, or written by hand.
- `stages/ship/recorded.ts`: how today's shipper runs ended in their lane logs, mapped onto the ship machine's outcomes ([experiment 55](../experiments/55-ship-outcomes-on-recorded-runs.md)).
- `watch.ts`: a spike that watches an Agent SDK stream.

## What it does not do

- Only the ticket and its comments go through the `Tracker`, and only a folder of files serves it. No labels, pull requests or CI results.
- `Repo` has one plug-in, local git. The builder does not repair a conflict with a moved base (ship parks instead), and nothing cleans up after landing.
- No check for a criterion that is not a call and its result: types, docs, a command run on a fixture. Most real tickets have one.
- Vetting checks the examples against today's code only: that they run and fail, not that the finished code can pass them. No throwaway reference build checks them first.
- No pitch for the rewrite (the problem, no-gos, rabbit-holes) as its own step after enrichment.

## Commands

| What | Command |
|---|---|
| Toy run, scripted | `pnpm demo` |
| Toy run, real Claude Code and Jev | `pnpm demo:claude` (needs `claude` and `TYPESAFE_API_KEY`) |
| One real GitHub ticket in a local checkout | `pnpm real` (see [Run a real ticket](../docs/how-to/run-a-real-ticket.md)) |
| Typecheck this package | `pnpm --filter @tea-fabrika/legacy typecheck` |
| Test this package | `pnpm vitest run legacy` |
| Lint (whole repo, with the layer check) | `pnpm lint` |

## See also

- [Experiment 82](../experiments/82-monorepo.md): what was moved here and why.
- [Experiments 48 to 52](../experiments/48-operator-from-six-moves.md) and [56](../experiments/56-first-live-run-of-the-ship-machine.md): the operator machine and its live runs.
- [`docs/direction/rethink-do-not-port.md`](../docs/direction/rethink-do-not-port.md): why new stages are not ported from here.
- [`replay/README.md`](../replay/README.md): the replay set.
