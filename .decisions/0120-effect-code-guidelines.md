---
id: 0120
title: Effect code in next/ follows eight guidelines, from using what Effect and Alchemy ship to saying why we differ, and the Alchemy port goes first
status: accepted
date: 2026-11-11
tags: [effect, guidelines, style, errors, layers, alchemy, doc-comments, imports, lint, next]
---

# 0120: Effect code in next/ follows eight guidelines, from using what Effect and Alchemy ship to saying why we differ, and the Alchemy port goes first

```ts
// A sketch: one layer file after the guidelines.
import * as Effect from "effect/Effect"; // E7: namespace imports in libraries
import * as Layer from "effect/Layer";

const make = Effect.fnUntraced(function* (initial: Descriptor, options: RunnerOptions) {
  const recovery = yield* RecoveryStore; // E5: asked for, never built inside
  const holder = yield* Holder.make(initial); // E4: control state is a saved tea machine

  // --- Turns ---                              E3: a shelf of named pieces
  const turns = Turns.make({ holder, recovery, options });

  return ProgramRunner.of({ open: turns.open, msg: turns.msg, due: turns.due, restart: turns.restart });
});

export const layer = (initial: Descriptor, options: RunnerOptions) =>
  Layer.effect(ProgramRunner, make(initial, options));
```

**What this decides:** the eight guidelines that answer
[0114](0114-effects-team-as-the-builder.md)'s question for `next/`, and the order their fixes run
in.

## Context

0114 asked for one guidelines study of Effect code. Experiment 262 read every `next/` file beside
Effect 4.1.2's source and ran Effect's own checker. The owner walked the result on 2026-11-11 and
approved it, with three changes made in the walk: the draft's ninth principle (wrap a platform
once) is part of the first, since Alchemy already ships that wrapper; doc comments carry no
`@since` yet ([0118](0118-no-since-tag-before-a-release.md)); an error's reason is a tagged error
([0119](0119-an-errors-reason-is-a-tagged-error.md)). The long reasoning, with real before and
after code for each, is in
[the Effect code guidelines note](../docs/direction/effect-code-guidelines.md).

## Decision

**`next/` code follows these eight, each held by a check where one can hold it.**

- **E1. Use what Effect and Alchemy ship before writing your own.** A helper, parser, wrapper or
  loop is written by hand only after the Effect module was looked for. A Durable Object is reached
  through Alchemy's stub, never a hand Promise wrapper.
- **E2. A failure is a typed value.** It keeps its cause, is caught by its tag and never by
  `instanceof`, and pure code returns it. A failure becomes a `Result` only where the answer is
  saved or sent.
- **E3. A long body is a `make` with a shelf of named pieces.** Sections, the hard parts in
  `internal/`, and a one-line `layer`. No line-count rule.
- **E4. Control state is a saved tea machine** (0037, 0046). A plain `let` holds only data one
  owner keeps.
- **E5. A layer asks for what it needs.** It never builds its own dependencies in its body. The
  service file holds only its contract (0095).
- **E6. A public export has a doc, and a comment says why.** No plan codes and no history in
  comments.
- **E7. Imports and service ids read like Effect's.** Namespace imports in libraries, and an id
  with its package and folder.
- **E8. Where we differ from Effect, the file says why,** at the code, with the record that decided
  it.

**The order of the work**

- New code is held first: the shipped checks with no hits, the pattern docs, and our small lint
  rules, each with its cleanup.
- The Alchemy port ([0041](0041-object-classes-are-effect-objects.md), ticket 502) is the first
  change to old code.
- Then the sweeps, smallest first, each turning its check to `error` when it lands. Then the
  move-only splits of the three long files.

**Binding constraints**

- Each "after" in the note is a sketch. A plan checks it against the installed Effect before it
  builds.
- A check blocks only after all its hits are counted, not a sample.

## Consequences

- Plans and reviews in `next/` cite these by number.
- The cost: about 170 files touched over the sweeps, most by one line, about 4,300 lines moved by
  the splits and about 2,000 lines of doc comments.
- Not decided here: the gateway's dispatch shape (experiment 174), and which reasons each service
  error has (0055, 0119).
