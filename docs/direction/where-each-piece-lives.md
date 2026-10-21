# Where each piece lives

Decided 2026-10-18. Parts were set 2026-10-17. Where the pieces go was replaced
2026-10-21: everything above tea is one open-source project, fabrika.

## What was decided

- **This repo is a workshop.** Build fast here; move a piece out once it is
  proven.
- ~~**Where each piece goes, later:** tea-program and tsh go to demlik, beside
  tea; fabrika gets a repo of its own; Tuval gets a repo of its own, and waits
  until fabrika is finished.~~ **Replaced 2026-10-21: fabrika is the whole
  thing,** one open-source project in `kamp-us/fabrika`, published as
  `@kampus/fabrika`. Its parts:
  - `fabrika/program`: today's tea-program;
  - `fabrika/host`: today's tea-host;
  - `fabrika/shell`: today's tsh (what its command is called is open);
  - `fabrika/gui`: windows and views onto hosts. There is no Tuval any more;
    its code is evidence of what a GUI needs, not something to port;
  - `fabrika/agents`: the agent suite, running a harness as a program (ACP
    adapters, the ask-a-helper tool), today in `wip/src/agents`;
  - today's fabrika, the work pipeline (sort, plan, build, review, ship, the
    desk, the queues): its name is open, `fabrika/pipeline` is the lean.
    "Harness" stays the word for Claude Code, Codex and the like, so it does
    not name this part;
  - tea stays as it is, in demlik.
- **fabrika needs tea-program, not Tuval.** tsh is its first client.
- **Nothing moves until the experiment is done.** fabrika, the stages and the
  agents stay here. The move is first tried as an experiment (81), with no cuts.
- **`@demlik/tea` is never edited from this repo** (2026-10-17). A change tea
  needs is written up as a finding or an ask for tea's owners. tea stays small.
- **Agents are ordinary programs, in a suite of their own.** Not a part of tea,
  and not a part of an OS. The suite gives the interface for wrapping a harness.
- **The browser and desktop goal belongs to tea-program, tsh and Tuval,** not
  to this repo.
- **Tuval opens windows; tsh only says which job started**, the way a display
  server and `DISPLAY` split the job. Which view belongs to which program is
  kept in Tuval's own list, like `.desktop` files, not on `defineProgram`.

## Changed the same day

- A first answer moved everything, fabrika included, into demlik. It was
  replaced by fabrika and Tuval each getting a repo.
- A first answer also moved the agents now. That was narrowed: they stay until
  the experiment is done.

## Why

- The experiment is not finished. Moving now would freeze shapes that are
  still changing.
- An agent has its own loop, and so does each harness it wraps. That makes an
  agent a program, not a basic part of the system.

## What would change it

A piece that a second project needs before the experiment is done.
