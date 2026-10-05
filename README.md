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
| `src/route.ts` | Jev as the router (is an extra change, or a finding, about the ticket's goal?) and as the matcher (does a new finding repeat one a person decided?). Plug-ins behind the `Router` and `Matcher` services |
| `src/tests.ts` | Turns a ticket's examples into a test file. Code writes it, so no model decides whether a criterion is met |
| `src/factory.ts` | The parent machine that holds both and hands a sorted ticket to the lane |
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

- An answer for a triage park. Lane parks take one (`answerPark` in
  `src/lane.ts`); a triage park waits for nothing yet.
- Checks for criteria that are not a call and its result: types, fixtures,
  docs. A ticket with one parks as `unchecked`.
- A throwaway reference build that checks the examples before the builder starts.
- Changing an example from a park. A person can say it stands, or drop the lane.
