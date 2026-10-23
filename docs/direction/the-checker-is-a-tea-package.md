# The checker is a tea package

**Dropped 2026-10-23, for now.** No package. With no every-order search, we
have no engine to share. The rest is property testing, and that has a home
already: tea ships `@demlik/tea/pbt`, with a law checked on every step, a fold
over `update`, and one generator per Msg type. It lacks one piece: answers
only for a Cmd that was sent. Its stub for that, `arbGuidedSequence`, is not
built yet. Experiment 120 tests whether Effect's own `Arbitrary`, drawing
messages and answers from the schemas we already have, can do that job with no
hand-written world. `walk.ts` and `sample.ts` stay in the pipeline until then,
and the "never sent" check below goes wherever the walks end up.
[kamp-us/demlik#734](https://github.com/kamp-us/demlik/issues/734) is closed.
What follows is the record of what was decided before.

Decided 2026-10-22: the checker becomes its own package in demlik, next to tea.
It walks a tea machine through many orders of messages. It is not part of tea
and not part of fabrika. The work is
[kamp-us/demlik#734](https://github.com/kamp-us/demlik/issues/734).

*Decided 2026-10-23, after experiment 119: the package holds laws, worlds and
random walks, which are property tests. The search that tries every order of
messages does not go in.*

```ts
// A sketch. The package name is a working name; the other names are today's.
import {law, sample, stepOf, walk} from "@demlik/tea-check";

const ended = law("an ended run sends nothing", (step) =>
	step.prev.phase === "over" && step.cmds.length > 0 ? "sent after the end" : null,
);

const machine = {
	init: {phase: "idle"},
	update: stepOf(ship), // the real reducer, from the pipeline
	world: shipWorld(), // the pipeline's: what may come in, and how each Cmd may be answered
	laws: () => [ended],
	show: (msg) => msg.type,
};

const found = yield* sample((choices) => walk(machine, choices), {ms: 10_000, seed: 1, length: 200});
// found.path: the shrunk message order that breaks a law, or null when none broke.
```

## What moves, and what stays

- **Moves to the package.** These files are in `packages/pipeline/src/laws/` today:
  - from `explore.ts`, only the shapes: `Law`, `law`, `World`, `Step`,
    `Update` and `stepOf`, which `walk.ts` imports. Its `explore`, the
    search over every order, stays behind.
  - from `world/search.ts`, only the shapes `System` and `Safety`. Its
    `search` stays behind.
  - `walk.ts` and `sample.ts`, whole: random walks over the laws and worlds,
    drawn and shrunk by Effect's `Arbitrary`. They came from experiment 118.
  - **One check the walks lack, added in the move:** a suite fails when a
    message type is never sent. `explore` has it and the walks do not, so
    without it a law could pass only because its breaking message never came
    ([Make the mistake impossible](./make-the-mistake-impossible.md)).
- **Stays behind and gets nothing new:** `explore` and `search`. Today's tests
  keep running on them until the pipeline is rebuilt small
  ([Sweep the core; rebuild the pipeline small](./sweep-the-core-rebuild-the-pipeline.md)).
  The rebuilt one uses the walks.
- **Stays in the pipeline:** each stage's own laws and world, for example
  `laws/ship.ts` and `laws/world/lanes.ts`. They sit next to the machines they
  check.
- **Stays with the host in fabrika's core:** tests of a running host, its Subs
  and its timers, such as `hosted/lane-ends.ts` from experiment 116. Those
  test programs, not machines.

## Why

- What moves imports only tea and Effect. Nothing in it knows fabrika.
- **Why no every-order search.** Experiment 119 had StrykerJS, the industry's
  mutation tool, make 569 small breaks in the ship stage. Nobody wrote them
  for either tool. The search caught none that the walks missed. Where both
  caught one, the walks found it faster, and on 69 the search crashed where
  the walks said "update throws". How sure: 80%. The doubt is the loop
  machine, where the search last won (experiment 118) and 119 did not look.
- **The laws are thin, not the search.** 72% of 119's breaks survived both
  tools. A hand check of 12 found 11 real changes that no law covers: the
  outcome a run gives is never checked, no law says a ready pull request
  lands, and saved state and Listens are outside every world. More laws, not
  a stronger search, is what catches more.
- Elm keeps its test tool, elm-test, apart from its core. tea stays small the
  same way.
- Anyone who writes tea machines can use it, not only fabrika.

## What is open

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
