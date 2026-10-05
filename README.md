# tea-fabrika

An experiment: can the loop that takes a ticket to working code be a plain
state machine, with agents and a small classifier as parts it calls, instead of
a prompt that drives an agent?

It is a minimal repro, not a product. It runs on two toy tickets.

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
| `src/triage.ts` | Rewrites a raw ticket into one with criteria as data (a rule and calls with exact results), then sorts it: type, priority, agent or human |
| `src/lane.ts` | Writes the tests from the examples, builds, runs the tests, hands the change to review, retries up to three times. The builder answers done, contradiction, blocked or dispute |
| `src/review.ts` | Review, a child machine of the lane: scope by code, a reviewer agent that only finds, quotes checked by code, the router for what is this ticket's, a person for what it is unsure about |
| `src/route.ts` | Jev as the router (is an extra change, or a finding, about the ticket's goal?), as the matcher (does a new finding repeat one a person decided?), as the comment reader (does the owner's comment change a rule?) and as the failure reader (did the tests fail on the builder's change, the test file, or the setup?). Plug-ins behind the `Router`, `Matcher`, `CommentReader` and `FailureReader` services |
| `src/settings.ts` | The numbers a person tunes without touching code, read from a `fabrika.toml`: the Jev readers' floors, how much of a run they read, retries and the model. Each key defaults to today's value; a value out of range or an unknown key is refused on load. The order of the steps stays in code |
| `src/tracker.ts` | What the pipeline reads from where tickets live: the ticket and its comments. The `Tracker` service behind it is swappable; `fileTracker` in `src/local.ts` (a folder, one JSON file per ticket) is the first |
| `src/comments.ts` | The owner's comments, read before a lane calls itself done: only a sure "changes nothing" passes without a person |
| `src/tests.ts` | Turns a ticket's examples into a test file. Code writes it, so no model decides whether a criterion is met |
| `src/ship.ts` | Seals the finished change as one commit, waits for a person to approve that commit, and lands it in the base; merges with a base that moved and tests the merge first. Git work goes through the swappable `Repo` service |
| `src/factory.ts` | The parent machine that holds triage, the lane and ship, and hands work from one to the next |
| `src/sort.ts` | The questions Jev is asked, to sort a ticket |
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

## Not built yet

- More behind the `Tracker`: labels, pull requests, CI results. Only the
  ticket and its comments go through it, and only a folder of files serves it.
- More `Repo` plug-ins than local git (GitHub), the builder repairing a
  conflict with a moved base (ship parks instead), and cleaning up after landing.
- Checks for criteria that are not a call and its result: types, docs, a
  command run on a fixture. A ticket with one parks as `unchecked`; most real
  tickets have one.
- The knobs the machines read themselves in `fabrika.toml`: the attempt limit
  and the sort floor. They live in the pure machines, so they have to travel in
  the start message and the saved state to stay replayable.
- A throwaway reference build that checks the examples before the builder starts.
