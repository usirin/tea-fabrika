# tea-fabrika

An experiment: can the loop that takes a ticket to working code be a plain
state machine, with agents and a small classifier as parts it calls, instead of
a prompt that drives an agent?

It is a minimal repro, not a product. It runs on toy tickets, and on one real
ticket at a time in a local checkout (see [Run a real ticket](#run-a-real-ticket)).

Where it is going and why is in [`docs/direction/`](./docs/direction/README.md),
one short note per decision.

## The idea

- **The machine owns the loop and the facts.** What step are we on, did the
  tests pass, how many tries are left. Built with
  [`@demlik/tea`](https://github.com/kamp-us/demlik) on its Effect engine.
- **Agents own the writing.** Rewriting a rough ticket, writing code. Each sits
  behind a small service, so Claude Code can be swapped for something else or
  for a script in tests.
- **Jev owns narrow yes/no calls.** A small classifier that answers one
  multiple-choice question with a confidence. The machine acts only above a
  floor.

## What is here

| File | What it does |
|---|---|
| `src/triage.ts` | Rewrites a raw ticket into one with criteria as data (a rule and calls with exact results), in small steps: code reads what the report mentions and gathers facts about it; the enricher writes from the facts; code vets each draft, and problems go back to the enricher in its own conversation, up to `vet_tries` drafts, then a person. The rewriter also names any product call the ticket rests on that nobody has made; if there is one, triage waits for the owner's ruling and rewrites with it. Then Jev sorts it: type, priority, worth doing |
| `src/facts.ts`, `src/code-facts.ts` | Facts, by code only: the names, paths and `#N` refs a report mentions, and for each name where HEAD declares it, its signature, its callers (code-graph's call graph) and the export subpaths that publish it (code-graph's resolver, plus a tier table if the package keeps one). A name nothing declares is said so: often a stale report. Behind the `Facts` service |
| `src/refine.ts` | Draft and vet, a small child machine made per use (`createRefine({ name })`, so its Cmds are `<name>_write` and `<name>_check`): a writer agent turn, a checker in code, the checker's problems back to the writer in the same conversation, up to a limit, then it stops for its parent. Triage's enrichment is its first use |
| `src/vetting.ts` | The checker for the enricher's draft: every named file is at HEAD, ids are unique, and every example, run on today's code in a throwaway copy (typechecked too when the repo is typed), fails, as it should before the change. One that holds already, or does not load, typecheck or run, goes back with why |
| `src/lane.ts` | Writes the tests from the examples, builds, runs the tests, hands the change to review, retries up to three times by default. The builder answers done, contradiction, blocked or dispute; contradiction also covers an example that could only pass by changing what the ticket does not ask for |
| `src/review.ts` | Review, a child machine of the lane: scope by code (a file is in scope when a criterion names it: the file an example imports from, or a file an unchecked rule is about), a reviewer agent that only finds, quotes checked by code, the router for what is this ticket's, a person for what it is unsure about. Beside the reviewer, a missing-file check: a file the change should have touched and did not goes back to the builder as a finding, which it fixes by touching the file or disputes |
| `src/route.ts` | Jev as the router (is an extra change, or a finding, about the ticket's goal?), as the matcher (does a new finding repeat one a person decided?), as the comment reader (does the owner's comment change a rule?), as the failure reader (did the tests fail on the builder's change, the test file, or the setup?) and as the missing-file reader (does the ticket need this untouched file changed too? one call per file in the packages the change touched that is one import from a changed file, or per file in those packages under `missing_scope = "package"`). Plug-ins behind the `Router`, `Matcher`, `CommentReader`, `FailureReader` and `MissingReader` services |
| `src/imports.ts` | The free cut before the missing-file check: keep a file only if it imports a changed file or a changed file imports it, matched by name, with no Jev call. Experiment 38 measured this very code: it kept every forgotten file of 28 trials at about a twelfth of the files, about $0.065 a review instead of $0.82 |
| `src/settings.ts` | The numbers a person tunes without touching code, read from a `fabrika.toml`: the Jev readers' floors, how much of a run they read, retries and the model; which files the missing-file check asks about (`missing_scope`: the import neighbours of the change by default, or whole packages) and how many before it is skipped; triage's sort floor and how many drafts the enricher gets to pass vetting (`vet_tries`); a lane's try limit; and whether an unsure failure goes back to the builder or to a person. Each key defaults to today's value; a value out of range or an unknown key is refused on load. The machines never read it: a run copies what it needs into its own state when it is filed, so a restart replays by the numbers it started with. The order of the steps stays in code |
| `src/tracker.ts` | What the pipeline reads from where tickets live: the ticket and its comments. The `Tracker` service behind it is swappable; `fileTracker` in `src/local.ts` (a folder, one JSON file per ticket) is the first |
| `src/comments.ts` | The owner's comments, read before a lane calls itself done: only a sure "changes nothing" passes without a person |
| `src/tests.ts` | Turns a ticket's examples into a test file. Code writes it, so no model decides whether a criterion is met. Each example imports its criterion's function and any other name its call `uses`, such as the library's own constructor, so a call can build a real value instead of a stand-in. How the file is written, run and read back (each test's outcome, and whether a failure was its assertion), and how it is typechecked alone, is the workspace's flavour: node:test beside a toy's code, or vitest inside one package of a monorepo |
| `src/drive.ts` | What the hosts share: run the factory on one ticket, print every step, keep and resume the run, and stop at triage (`UNTIL=triage`) with the lane's work held |
| `src/enrichment.ts` | Our enricher's rewrite as a page laid out like fabrika's, kept as `ours-enriched.md` beside `fabrika-enriched.md` |
| `src/demo.ts`, `src/real.ts` | The hosts. `demo` checks out a toy; `real` runs a GitHub ticket in a local checkout |
| `src/github.ts` | Reads a GitHub issue as the ticket triage starts from: the report as filed, under any rewrite fabrika already made |
| `src/ship.ts` | Seals the finished change as one commit, waits for a person to approve that commit, and lands it in the base; merges with a base that moved and tests the merge first. Git work goes through the swappable `Repo` service |
| `src/stages/outcome.ts` | The one shape every stage machine answers in: five verbs (`done`, `send`, `ask`, `skip`, `stuck`), and the one way an answer is spelled (`send:builder:checks_red`, `ask:owner:approval`, `done:part`). A stage writes only its own words (`outcomesOf`); `nameOf` makes the name from the data, and the name's pattern is a type, so a misspelled name does not compile. See [`docs/direction/outcome-names.md`](./docs/direction/outcome-names.md) |
| `src/stages/ship/` | The new ship machine ([`docs/ship-machine.md`](./docs/ship-machine.md)): one pull request in, one typed outcome out, no agent. Its own words for the five verbs, 21 names in all (`outcome.ts`), the facts it reads (`facts.ts`), the gate that says go, wait, or the one reason not to (`gate.ts`), and the machine itself (`machine.ts`): read the facts, pass the gate, put the head in the merge queue, listen to the queue, tidy up. It waits for checks that are still running, runs red checks again once before the builder is called, and both waits have a limit. A machine is made with its own limits (`createShip({ waits })`). `recorded.ts` maps how today's shipper runs ended in their lane logs onto those outcomes (experiment 55). Its handlers and the runners of its two Listens are in `handlers.ts`, the reads kept apart from the writes. `run.ts` runs it alone on one pull request: `node src/stages/ship/run.ts <pull request url> --own <account>` only reads, and prints the facts, the machine's answer and the write it would send (the enqueue, or a re-run of red checks). With `--write` the machine runs to its end on a real pull request. That mode of `run.ts` is tested against a scripted `gh` only and has never been run on a real repository. The machine itself has shipped for real twice, as the operator's child, on one docs-only pull request and one code pull request (experiment 56). `src/ship.ts` above is the older ship and is not used by it |
| `src/code-host-github-writes.ts` | `CodeHostWrites` on GitHub: the two things the ship machine changes on a pull request. Put a head in the merge queue (GitHub itself refuses when the head is no longer that commit), and start the failed jobs of red runs again. Never "merge when ready", a direct merge, a deleted branch or an owner's bypass. Tested against a scripted `gh`, every argument list checked whole. **Run against a real repository twice: one enqueue each on two pull requests in one repo, one docs-only and one code** (experiment 56). The re-run of red checks has never run for real |
| `src/code-host-github.ts`, `src/codeowners.ts` | `CodeHost` on GitHub, the read side only: the service (declared in `src/services.ts`) answers a pull request's facts for the ship gate, read through `gh` GraphQL calls at one head commit. The owner's approval comes from the base branch's CODEOWNERS (which files are protected, who owns them) and the approving reviews at the head. The kinds of review a change needs come from the files it touches and the repo's `.fabrika.jsonc`. Where either cannot be read the fact is `unknown`, never a guess. `NOT_READ` lists what a fact still cannot be taken for. It also holds the two waits, the checks and the merge queue, each a read asked again every `pollMs`. The queue's wait says a pull request was thrown out only on GitHub's own record of it, never on one "not in the queue" answer. Tested on recorded answers under `fixtures/code-host/` |
| `src/factory.ts` | The parent machine that holds triage, the lane and ship, and hands work from one to the next |
| `src/sort.ts` | The questions Jev is asked, to sort a ticket. Not whether an agent can pick it up: that is the rewriter's open call, above |
| `src/claude.ts` | Claude Code as the enricher and the builder, one conversation per stage |
| `src/primitives.ts`, `src/draft.ts` | The six moves every step is made of, each an Elm thing with one rule: Gather (a Cmd that only reads), Act (a Cmd that carries a name for its one write, kept in the state first, so a restart never writes twice), Listen (a Sub), Draft (an agent's run as a Sub over the Agent SDK's stream, its conversation named up front and its answer typed by a schema), Check (a pure function, or a Cmd when it runs code) and Judge (one Jev question with fixed choices; the floor is applied in update) |
| `src/schema.ts` | Cmds from Effect schemas: `defineCmd` is tea's `Cmd.define` with the Standard Schema wrapping done inside, and the moves go through it. Also what a Draft needs from its output schema: the JSON Schema the Agent SDK takes, and a reader for the agent's answer. Takes a zod schema too, until the repo is off zod |
| `src/combos.ts` | The moves joined, as data and pure functions a parent calls: `refine` (Draft and Check in a loop), `gate` (pass, or park with why), `ask` (post a question, listen for replies, read each by code or a Judge into one of a fixed set of answers), `remember` (write, then read back) and `spawn` (a child per item) |
| `src/fabrika.ts` | Fabrika as the operator meets it: an Effect service with typed methods and typed answers, not a CLI. Also the routing table (state name to action), who owns each park cause, and which parks a recipe clears. `Worktrees`, beside it, makes and removes a lane's working copy |
| `src/operator.ts`, `src/turn.ts` | Today's operator agent as a machine made only of the moves and combos: claim the lane, make its working copy, then read the lane, start one turn per active task, and read again. A turn routes by the state's name: run a shell, wait on CI or the merge queue, or gate a park to its recipe or to a person. However the run ends, it removes the working copy and lets go of the lane. Built against a fake (experiment 48), then run on three real lanes: one straight through (experiment 49), one through a failed review and its repair (experiment 50), one through a park that waited on a person's approval (experiment 52). Behind a switch that is off by default (`createOperator(slots, { ship: "machine" })`, `SHIP=machine` in `src/operate.ts`) its ship stage is the ship machine, run as a child in place of the shipper shell: the first stage swapped from an agent to code. That mode has been run twice, on one docs-only pull request and one code pull request, and merged both with no shipper agent (experiment 56). Every other ending is tested against scripted services only |
| `src/operator-host.ts` | What the operator runs on: the handlers for its Cmds, the runners for its Subs (a shell is one Agent SDK run, with its tools pre-approved and a dollar cap), and the rows a run adds to `field/runs.jsonl` |
| `src/shell-skill.ts`, `src/shell-guard.ts` | What a shell is sent, and what it may not do. The first puts the shell's skill in front of its brief, in code, because a fabrika shell run as the SDK's main agent gets none. The second is the Check before each tool call: no merge by hand, no `--auto`, no `--delete-branch`, no push to main, no second working copy, no write outside its own, and no command left in the background (a shell's session ends with its turn, so nothing would ever read it) |
| `src/fabrika-cli.ts`, `src/operator-live.ts` | The live Layers. `Fabrika` over fabrika-cli 0.9.0 (temporary: each method is one or two verbs, and exit codes become typed answers), working copies as git worktrees, and the thread as an issue's comments through `gh` |
| `src/operate.ts` | The host that drives one real lane with the operator machine: `LANE=<n> REPO=<checkout> ... node src/operate.ts` |
| `src/fabrika-scripted.ts` | Fabrika in memory for the operator's tests: one lane, scripted shells, a thread a person answers on, working copies kept in a set |
| `src/scripted.ts` | Scripted stand-ins for every service, used by the tests |
| `experiments/` | What we measured. Start with [the log](./experiments/README.md) |
| `docs/skill-map.md` | [Every fabrika skill, read for machines](./docs/skill-map.md): who should own each decision |

## Run it

```
pnpm install
pnpm test          # no network, everything scripted
pnpm demo          # scripted agents, prints each step
pnpm demo:claude   # real Claude Code and real Jev
```

The real runs need the `claude` CLI and `TYPESAFE_API_KEY` for Jev.

## Run a real ticket

`src/real.ts` runs one GitHub issue on a pnpm monorepo checked out on this
machine. It reads the issue once with `gh` and never writes to GitHub or
pushes anything: the change lands in a local branch.

```
git -C <repo> worktree add -b work-branch <folder> origin/main   # where the builder works
git -C <repo> branch landing-branch origin/main                  # where the change lands
pnpm -C <folder> install

ISSUE=owner/repo#n REPO=<folder> BASE=landing-branch RUN=<run folder> \
  PACKAGE=packages/tea TYPESAFE_API_KEY=... pnpm real
```

- **The ticket.** If fabrika's triage already rewrote the issue, only the
  original report is filed, so our enricher does that work again. Fabrika's
  rewrite is saved as `<run>/fabrika-enriched.md`, and ours as
  `<run>/ours-enriched.md` in the same layout, to compare by eye.
- **Triage only.** `UNTIL=triage` stops once triage is done, before the lane
  touches the repo, and prints our whole rewrite with both files' paths. The
  lane's first step is kept asked, so the same command without `UNTIL` builds.
  On the way it prints the facts code found, each draft, and each vetting's
  verdict per example.
- **Vetting.** Each draft's examples are written as that vitest file in a
  throwaway worktree at HEAD, installed with `pnpm install --frozen-lockfile
  --prefer-offline`, typechecked alone with the package's `tsconfig.test.json`
  (or `tsconfig.json`), and run. The builder's folder is never touched. About
  7 seconds a draft on kamp-us/demlik.
- **The tests.** The examples become `<PACKAGE>/src/fabrika-<n>.test.ts`, a
  vitest file, committed and locked before the builder starts. A check runs
  the package's `typecheck`, `typecheck:test` and whole vitest suite; the
  report keeps the failures and the issue's own tests and drops the rest.
- **Stopping.** Ctrl-C at any point, then run it again to carry on. The run
  keeps its issue, repo, base and package, so `RUN` and the key are enough. Answer a park with `ANSWER='<json>'`, as in the demo.
- **Base.** `BASE` must exist, and nobody may have it checked out.

## Not built yet

- More behind the `Tracker`: labels, pull requests, CI results. Only the
  ticket and its comments go through it, and only a folder of files serves it.
- More `Repo` plug-ins than local git (GitHub), the builder repairing a
  conflict with a moved base (ship parks instead), and cleaning up after landing.
- Checks for criteria that are not a call and its result: types, docs, a
  command run on a fixture. A ticket with one parks as `unchecked`; most real
  tickets have one.
- A throwaway reference build that checks the examples before the builder
  starts. Vetting checks them against today's code only: that they run and
  fail, not that the finished code can pass them.
- A pitch for the rewrite (the problem, no-gos, rabbit-holes), as its own
  small step after enrichment.
