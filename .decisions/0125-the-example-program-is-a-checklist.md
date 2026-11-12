---
id: 0125
title: The example program for next/ is a checklist that uses every part of a program, never a counter, and the cold author's small gaps are fixed in two batches
status: accepted
date: 2026-11-11
tags: [programs, examples, tutorial, authors, packs, checklist, next]
---

# 0125: The example program for next/ is a checklist that uses every part of a program, never a counter, and the cold author's small gaps are fixed in two batches

```ts
// A sketch, in today's Program.make shape. The build's plan writes it in the shape that
// program-shape decided.
export const checklist = Program.make({
  name: "checklist",
  machine: checklistMachine, // add, rename, check, uncheck, remove
  refuse, // "taken", "missing"
  inputs: {
    add: { description: "Add an item by a new name", personOnly: true },
    remove: { description: "Remove an item", personOnly: true },
    check: "Check the item called `name`", // an agent may do this one
    left: Input.cases.read.make({ schema: LeftQuery, description: "How many items are left", answer }),
  },
  outputs: { done: Done }, // sent once every item is checked, so it pipes into another program
  wake: (model) => oldestUnchecked(model), // remind when an item sits too long
});
```

**What this decides:** what a new author reads first, and what happens to the gaps experiment 253
found.

## Context

[Experiment 253](../experiments/253-an-agent-as-a-pack-author.md) had an agent build a program
with only what an outside author has. It wrote one, and could not load it, give it a window or
let an agent call it. Those three walls are on the plan already (the program list as a setting,
P14 and P25). Eight smaller gaps had no home. Its only example was the counter, which has no
refusal worth naming, no timer, no output and no input an agent may send that a person may not.
[0075](0075-cold-author-checks-outside-programs.md) already asks for a cold author check each tier. The
owner walked the result on 2026-11-11.

## Decision

**A counter is never the example. The example is a checklist, a short list of items, built to
use every part of a program without being a big one.**

- It shows, each on purpose: a refusal with a named reason, an input only a person may send beside
  one an agent may, a wake for an item left too long, an output another program can take, a read
  port, a window with a list, and one command the hands run.
- Docs, tutorials and a starter for authors use it. No new doc or tutorial teaches with a counter.
- The eight gaps with no home are fixed in two batches. Docs: a page for authors (state is saved
  for you, what `wake` and `refuse` mean), a line on each tutorial that teaches today's version
  saying so, and no plan codes in what an author reads. Code: a refusal reason of its own for an
  input only a person may send, and a lint message that names the real path and the right fix.
- A test kit for authors gets a plan, with the pack work (P40): one call that runs a program over
  Node SQLite with restarts.
- The cold author runs again once a window and loading have landed (0075).

## Consequences

- One new program in `next/programs`, about 250 lines against the counter's 80, with its laws.
- The cost: the docs batch is about one agent hour; the code batch and the checklist are lanes of
  their own, each with its plan.
- `next/programs/counter` is removed, and the tests that run it move to the checklist. The counter
  has no command, never refuses, has no output and never wakes, so a test that runs it checks
  only the easy path. Each checklist slice moves the tests that need its part, and the last slice
  deletes the counter. Until then the counter stays only where a test still runs it.
- The cost of that: about 16 test files change, and a richer test program makes a red test a
  little harder to read.
