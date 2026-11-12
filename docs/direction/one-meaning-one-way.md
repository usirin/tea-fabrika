# One meaning, one way

**Decided 2026-11-08 by the owner.** `next/` only. It applies first to the study of
[Program.make's shape](./program-make.md).

Its decided rules are in: [0212](../../.decisions/0212-one-meaning-one-way.md).

```ts
// A sketch, with rules already decided elsewhere as the examples.

// No: two ways to make one thing.
const a = Program.make({name: "counter", machine: counterMachine, view, inputs});
const b = defineProgram({name: "counter", machine: counterMachine, view, inputs});

// No: one word, two meanings. "run" for an agent run and for one start of a program.
// Yes: "run" is an agent run only; one start of a program is a process (AGENTS.md).

// Yes: one way to make a program.
const counter = Program.make({name: "counter", machine: counterMachine, view, inputs});
```

## What it decides

- **Take the time to land a clean, simple API in `next/`.** A shape that is hard to read is
  changed before more code is built on it, even after it merged.
- **One thing means one thing only.** A name, a field or a type has one meaning in its bounded
  context. This is [use the industry's names](./use-the-industrys-names.md)'s "one word per idea",
  held for an API's parts too, not only for words.
- **There is only one way to do each thing.** No second constructor, no optional shortcut beside
  the long form, no two shapes that mean the same. Python's Zen says it as "There should be one--
  and preferably only one --obvious way to do it" (PEP 20).

## Which version

- **`next/`:** this note. Every API a `next/` plan adds is checked against it, starting with the
  Program.make shape study.
- **Today's version:** not changed by it.

## What it cannot tell us

Where "one way" stops: a helper built on top of the one way may still be fine, and the first
plans that hit that line decide it, one case at a time.
