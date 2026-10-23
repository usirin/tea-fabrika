# The checker is a tea package

Decided 2026-10-22: the checker becomes its own package in demlik, next to tea.
It walks a tea machine through many orders of messages. It is not part of tea
and not part of fabrika. What goes into it waits on experiment 119. The work is
[kamp-us/demlik#734](https://github.com/kamp-us/demlik/issues/734).

```ts
// A sketch. The package name is a working name; the other names are today's.
import {explore, law, stepOf} from "@demlik/tea-check";

const ended = law("an ended run sends nothing", (step) =>
	step.prev.phase === "over" && step.cmds.length > 0 ? "sent after the end" : null,
);

const report = explore({
	init: {phase: "idle"},
	update: stepOf(ship), // the real reducer, from the pipeline
	world: shipWorld(), // the pipeline's: what may come in, and how each Cmd may be answered
	laws: [ended],
	depth: 8,
});
// report.broken: for each broken law, the shortest message order that breaks it.
```

## What moves, and what stays

- **Moves to the package.** These files are in `packages/pipeline/src/laws/` today:
  - `explore.ts`: laws, worlds, and every order of messages for one machine.
    It imports only `@demlik/tea`.
  - `world/search.ts`: every order for a world of machines. It imports nothing.
  - `walk.ts` and `sample.ts`: random walks over the same laws and worlds,
    drawn and shrunk by Effect's `Arbitrary`. They came from experiment 118.
- **Stays in the pipeline:** each stage's own laws and world, for example
  `laws/ship.ts` and `laws/world/lanes.ts`. They sit next to the machines they
  check.
- **Stays with the host in fabrika's core:** tests of a running host, its Subs
  and its timers, such as `hosted/lane-ends.ts` from experiment 116. Those
  test programs, not machines.

## Why

- The four files are about 1,300 lines and import only tea and Effect. Nothing
  in them knows fabrika.
- Elm keeps its test tool, elm-test, apart from its core. tea stays small the
  same way.
- Anyone who writes tea machines can use it, not only fabrika.

## What is open

- **Does the try-every-order search go in, or only laws, worlds and random
  walks?**
  - Experiment 118's planted bugs favored our checker, because each plant was
    kept only after our checker caught it.
  - Experiment 119 runs a fair test with mutation testing.
  - Random walks need the laws and worlds either way, so the package is needed
    whatever 119 finds.
- **What an agent writes for each machine.** Random walks still need a
  world, which is our list of every message and every answer, about 1,500
  lines for the lanes. A test on the running host with generated inputs,
  like experiment 116's, needs no world but needs stand-ins. Nobody has
  measured which one is cheaper to write and trust.
- **The name.**
- **When it moves.** demlik's own pipeline builds it. Until then the files stay
  where they are.

## What would change it

- demlik's maintainers might want it as a subpath of tea, such as
  `@demlik/tea/check`. That is their call. It changes the import, not the
  split.
- If tea's types for a machine change shape, the engine's one tie to tea,
  `applyCell`, moves with them. Nothing else here would change.
