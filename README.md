# tea-fabrika

An experiment: can the loop that takes a ticket to working code be a plain
state machine, with agents and a small classifier as parts it calls, instead of
a prompt that drives an agent?

It is a minimal repro, not a product. It runs on toy tickets, and on one real
ticket at a time in a local checkout (see [Run a real ticket](#run-a-real-ticket)).

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
| `src/triage.ts` | Rewrites a raw ticket into one with criteria as data (a rule and calls with exact results). The rewriter also names any product call the ticket rests on that nobody has made; if there is one, triage waits for the owner's ruling and rewrites with it. Then Jev sorts it: type, priority, worth doing |
| `src/lane.ts` | Writes the tests from the examples, builds, runs the tests, hands the change to review, retries up to three times by default. The builder answers done, contradiction, blocked or dispute |
| `src/review.ts` | Review, a child machine of the lane: scope by code, a reviewer agent that only finds, quotes checked by code, the router for what is this ticket's, a person for what it is unsure about. Beside the reviewer, a missing-file check: a file the change should have touched and did not goes back to the builder as a finding, which it fixes by touching the file or disputes |
| `src/route.ts` | Jev as the router (is an extra change, or a finding, about the ticket's goal?), as the matcher (does a new finding repeat one a person decided?), as the comment reader (does the owner's comment change a rule?), as the failure reader (did the tests fail on the builder's change, the test file, or the setup?) and as the missing-file reader (does the ticket need this untouched file changed too? one call per file in the packages the change touched that is one import from a changed file, or per file in those packages under `missing_scope = "package"`). Plug-ins behind the `Router`, `Matcher`, `CommentReader`, `FailureReader` and `MissingReader` services |
| `src/imports.ts` | The free cut before the missing-file check: keep a file only if it imports a changed file or a changed file imports it, matched by name, with no Jev call. Experiment 38 measured this very code: it kept every forgotten file of 28 trials at about a twelfth of the files, about $0.065 a review instead of $0.82 |
| `src/settings.ts` | The numbers a person tunes without touching code, read from a `fabrika.toml`: the Jev readers' floors, how much of a run they read, retries and the model; which files the missing-file check asks about (`missing_scope`: the import neighbours of the change by default, or whole packages) and how many before it is skipped; triage's sort floor; a lane's try limit; and whether an unsure failure goes back to the builder or to a person. Each key defaults to today's value; a value out of range or an unknown key is refused on load. The machines never read it: a run copies what it needs into its own state when it is filed, so a restart replays by the numbers it started with. The order of the steps stays in code |
| `src/tracker.ts` | What the pipeline reads from where tickets live: the ticket and its comments. The `Tracker` service behind it is swappable; `fileTracker` in `src/local.ts` (a folder, one JSON file per ticket) is the first |
| `src/comments.ts` | The owner's comments, read before a lane calls itself done: only a sure "changes nothing" passes without a person |
| `src/tests.ts` | Turns a ticket's examples into a test file. Code writes it, so no model decides whether a criterion is met. How the file is written, run and read back is the workspace's flavour: node:test beside a toy's code, or vitest inside one package of a monorepo |
| `src/drive.ts` | What the hosts share: run the factory on one ticket, print every step, keep and resume the run |
| `src/demo.ts`, `src/real.ts` | The hosts. `demo` checks out a toy; `real` runs a GitHub ticket in a local checkout |
| `src/github.ts` | Reads a GitHub issue as the ticket triage starts from: the report as filed, under any rewrite fabrika already made |
| `src/ship.ts` | Seals the finished change as one commit, waits for a person to approve that commit, and lands it in the base; merges with a base that moved and tests the merge first. Git work goes through the swappable `Repo` service |
| `src/factory.ts` | The parent machine that holds triage, the lane and ship, and hands work from one to the next |
| `src/sort.ts` | The questions Jev is asked, to sort a ticket. Not whether an agent can pick it up: that is the rewriter's open call, above |
| `src/claude.ts` | Claude Code as the enricher and the builder, one conversation per stage |
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
  rewrite is saved as `<run>/fabrika-enriched.md` to compare.
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
- A throwaway reference build that checks the examples before the builder starts.
