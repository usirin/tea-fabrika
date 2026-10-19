# tea-fabrika

An experiment that rebuilds fabrika, an agent pipeline that takes a ticket to
merged code, as plain state machines on
[`@demlik/tea`](https://github.com/kamp-us/demlik), with agents and a small
classifier as parts the machines call.

Why it is built this way: [Control lives in code](./docs/direction/control-in-code.md).

```text
$ pnpm install
$ bin/tsh -c 'programs'
say  Says a text once, and ends. tsh's echo.
...
ship  Puts pull requests in the merge queue, or merges them when the repository has no queue, one after another, as it is told them, and says how each one ended. In read mode it changes nothing, and says what it would do.
review-scripted  The review program with a scripted reviewer: it reads each pull request from GitHub and runs the gate for real, then passes every criterion without reading the code. It costs nothing. It proves the wiring, not a review.
build  Builds tickets, one after another, as it is told them: one agent changes a working copy, and code commits, pushes and opens the pull request, in the ticket's own repository. A ticket told is kept until its build ends: started again after a crash, it carries every one on.
operate  Builds, reviews and ships tickets, one after another: build, review, build, review, until nothing is left open or a round makes no progress, then ship. It writes to each ticket's own repository. A ticket told is kept until its loop ends: started again after a crash, it carries every one on.
```

## Packages

A pnpm workspace. Each package has its own README. The first one listed is the
bottom layer. A package may import the ones listed before it, never the ones
after. `layer-rules.json` holds the order, and `pnpm lint` checks it.

- [`packages/tea-program`](./packages/tea-program/README.md): a program is a
  thing you start, with typed flags, inputs and outputs. It runs tea machines.
- [`packages/tsh`](./packages/tsh/README.md): a shell that runs only tea
  programs.
- [`programs/`](./programs/README.md): one package per tea program that runs on
  its own. Empty for now.
- [`wip`](./wip/README.md): everything still being shaped. The stage machines
  and their programs, the six moves, the services, and fabrika's wiring for tsh.
- [`legacy`](./legacy/README.md): the first-generation factory and the old
  operator. Nothing new goes here.
- `packs/`: add-on packs, each wired to the core by one config line. The core
  names none of them.
  - [`packs/ask-log`](./packs/ask-log/README.md): appends one line per ask and
    answer to a file.
  - [`packs/owner-desk`](./packs/owner-desk/README.md): the owner's inbox, and
    their answers back to the core.
  - [`packs/ui-verification`](./packs/ui-verification/README.md): holds a build
    that changes what a user sees, and asks the owner yes or no.

## Docs

- [`AGENTS.md`](./AGENTS.md): how to work here. Read it before changing
  anything.
- [`docs/direction/`](./docs/direction/README.md): why. One short note per
  decision.
- [`experiments/`](./experiments/README.md): what was tried, and what came back.
- [`field/`](./field/README.md): what happened on real runs.
- [`docs/how-to/run-a-real-ticket.md`](./docs/how-to/run-a-real-ticket.md): run
  the first-generation factory on one GitHub issue.
- [`replay/`](./replay/README.md): closed issues to check a change against.
- [`singles/`](./singles/README.md): one finding at a time, for readers new to
  the project.
- Drafts under `docs/`:
  - [`skill-map.md`](./docs/skill-map.md): every fabrika skill, read for
    machines, and who should own each decision.
  - [`review-machine.md`](./docs/review-machine.md): today's review stage as a
    step list, and what is built of the new one.
  - [`ship-machine.md`](./docs/ship-machine.md): the ship machine's design.
  - [`fabrika-sdk.md`](./docs/fabrika-sdk.md): fabrika's backend as a library.

## Commands

| What | Command |
|---|---|
| Install | `pnpm install` |
| A toy ticket with scripted agents, every step printed | `pnpm demo` |
| The same with real Claude Code and real Jev | `pnpm demo:claude` (needs the `claude` CLI and `TYPESAFE_API_KEY`) |
| tsh with fabrika's programs | `bin/tsh` or `pnpm tsh` |

## Checks

Run all three before you push. None needs a key or the network.

```sh
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm lint` fails on a warning too. [`AGENTS.md`](./AGENTS.md) says more.
