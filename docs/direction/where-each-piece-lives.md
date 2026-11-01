# Where each piece lives

Decided 2026-10-18. Parts were set 2026-10-17. Where the pieces go was replaced
2026-10-21: everything above tea is one open-source project, fabrika. The
pipeline became its own package on 2026-10-22, on top of `@kampus/fabrika`
(experiment 114).

*Names replaced 2026-10-22: the library becomes `@kampus/libfabrika`, and
`@kampus/fabrika` becomes the app people open, the way Ghostty and libghostty
split. Tuval is the internal codename of the app's gui; people see "fabrika".
Below, `@kampus/fabrika` still means today's library, as it did when this was written.*

*Changed 2026-10-31: today's library is now `@kampus/fabrika-old` and today's app
`@kampus/fabrika-app-old`, and each is deleted when `next/` takes its job over. So
`next/` uses the real names from its first line, and no rename waits at the end.*

*Changed 2026-11-01, for `next/`, from [Tier 1's plan](../plan/tier-1.md), proposed until it
is approved: Tuval is not the app's gui. It is its own package, `@kampus/tuval`, and it holds
everything a client does. fabrika is the logic, and Tuval is what is drawn from it. The app,
`next/apps/fabrika`, is only wiring and the deploy stack. Tuval may import
`@kampus/libfabrika`, never the other way. Each program is a package under `next/programs/`.*

```ts
// After the rename, a sketch.
import {defineProgram, serve} from "@kampus/libfabrika"; // the library: program, host, shell, ledger, agents
// @kampus/fabrika                                       // the app: a local web page that runs programs
```

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
    its code is evidence of what a GUI needs, not something to port.
    *Changed 2026-10-22: Tuval is the gui's codename again. The old code is
    still evidence only. How the gui works is in
    [the GUI note](./the-gui-is-a-local-web-page-first.md);*
  - `fabrika/agents`: the agent suite, running a harness as a program (ACP
    adapters, the ask-a-helper tool), today in `wip/src/agents`;
  - ~~today's fabrika, the work pipeline (sort, plan, build, review, ship, the
    desk, the queues): its name is open, `fabrika/pipeline` is the lean.~~
    **Replaced 2026-10-22: the pipeline is not a part of `@kampus/fabrika`.**
    See the next bullet. "Harness" stays the word for Claude Code, Codex and
    the like, so it does not name the pipeline;
  - tea stays as it is, in demlik.
- **The pipeline is its own package** (2026-10-22, experiment 114).
  `@kampus/fabrika` stays one package for the library parts: program, host,
  ledger, shell (plain tsh) and agents. The pipeline is an app on it:
  - it may use only fabrika's public exports, the top level and its
    subpaths (`pnpm lint:boundaries` and fabrika's `exports` map hold it);
  - its tsh wiring and its bin move with it; fabrika ships plain tsh, with
    its small programs, and an app hands tsh its own list
    (`runTsh` on `@kampus/fabrika/shell`, the `Shell.Programs` service);
  - only the pipeline installs a `tsh` command. fabrika has no `bin`, the
    way `effect` has none; its small shell is the dev script
    `packages/fabrika/bin/tsh-small`. Two packages with a `tsh` bin let the
    package manager pick one without a word;
  - its working name is `@kampus/pipeline`, in `packages/pipeline/`. The
    name is a placeholder; the pipeline's own name is still open.
  - **Open since 2026-10-22: where the pipeline lives,** now that
    `@kampus/fabrika` is the app. The app runs programs, the way tmux runs
    shells, and the pipeline would be one of them, with a view of its own.
    Lean: its own program with a view, installed with the app (80%).

  ```ts
  // An app on fabrika: its own programs in tsh, through public names only.
  import {Shell} from "@kampus/fabrika";
  import {runTsh} from "@kampus/fabrika/shell";

  const programs = Shell.programList([...Shell.SMALL, ...mine]);
  process.exitCode = await Effect.runPromise(
  	runTsh().pipe(Effect.provideService(Shell.Programs, programs)),
  );
  ```

  Why: fabrika is a set of tools for building your own factory, and the
  pipeline is one factory built with them. Kept in one package, nothing
  showed whether the tools were enough on their own. Apart, every name the
  pipeline needs has to be public, so a missing tool shows up as an import
  that does not resolve.
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
- **Old experiments move to a private place before the core moves**
  (2026-10-22). The work has moved past them. This repo stays the place for
  new experiments. Where the old ones go is open.
- **Later, not now: a general Effect platform package for Electron**
  (2026-10-25). Effect publishes `@effect/platform-node`, `-bun` and
  `-browser`, and nothing for Electron. Code with no fabrika in it, such as a
  `Socket` over Electron's MessagePort, could one day be its own package,
  `@kampus/effect-platform-electron`, in `kamp-us/fabrika`, the way Effect's
  own repo keeps `effect` and its platform packages side by side. Not now:
  first, fabrika runs well for the two people who use it. Until then such
  code stays inside the app, and fabrika's own platform code stays on
  subpaths, as above.
- **`@demlik/tea` is never edited from this repo** (2026-10-17). A change tea
  needs is written up as a finding or an ask for tea's owners. tea stays small.
- **Agents are ordinary programs, in a suite of their own.** Not a part of tea,
  and not a part of an OS. The suite gives the interface for wrapping a harness.
- ~~**The browser and desktop goal belongs to tea-program, tsh and Tuval,** not
  to this repo.~~ Replaced 2026-10-21: the gui is a part of fabrika.
- **Tuval opens windows; tsh only says which job started**, the way a display
  server and `DISPLAY` split the job. ~~Which view belongs to which program is
  kept in Tuval's own list, like `.desktop` files, not on `defineProgram`.~~
  Replaced 2026-10-22: a program declares its own `view`, and its window ships
  in the same package, on `<package>/window`
  ([the GUI note](./the-gui-is-a-local-web-page-first.md)).

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
