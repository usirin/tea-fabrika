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
- **What `@kampus/fabrika` exports** (2026-10-21). fabrika is a set of tools
  for building your own software factory, so its tools come from the top
  level: `import {defineProgram, serve} from "@kampus/fabrika"`.
  - Every boundary is an Effect service (`Ledger`, `CodeHost`, the agent
    harness, storage). The top level holds the services and the code that
    runs anywhere.
  - Each platform's implementation is a `Layer` on a subpath:
    `@kampus/fabrika/local` (Miniflare), `/http`, `/agents/claude` (the Agent
    SDK), `/gui`, `/otel`. A program picks its layers where it starts; the
    rest of its code never names a platform.
  - Why subpaths: an `import` loads every file it points to, so a top level
    that pulled in Miniflare or the Agent SDK would break the gui in a
    browser and make everyone install them. Hono (`hono` and
    `hono/cloudflare-workers`) and Effect (`effect` and
    `@effect/platform-node`) split the same way.
  - Experimental parts also stay on a subpath until they are stable, so the
    top level only promises what is stable.
- **The pipeline is the product** (2026-10-21). Program, host, shell and
  agents were built so the pipeline runs smoothly; that is why they share its
  name. The experiment is done when the pipeline is, not when they are.
- **0.1.0 is program, host, shell, agents and the pipeline** (2026-10-21).
  The gui comes later. The first release can take a ticket and build it.
  Everything is proven in this repo first: the package layout, the pipeline
  on tea-host, a real run, and the pipeline building a ticket on this repo.
  Moving to `kamp-us/fabrika` is then a plain copy, with nothing new in it.
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
