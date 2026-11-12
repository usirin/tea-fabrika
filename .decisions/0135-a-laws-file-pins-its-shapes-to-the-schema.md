---
id: 0135
title: A laws file may restate a program's shapes by hand, and pins each one to the schema's type so drift fails the typecheck
status: accepted
date: 2026-11-11
tags: [tests, laws, schema, types, exam, programs]
---

# 0135: A laws file may restate a program's shapes by hand, and pins each one to the schema's type so drift fails the typecheck

```ts
// program.ts: the one definition, in Effect Schema
const Model = Schema.Struct({ items: Schema.Array(Item) });

// program.laws.test.ts: the exam's own copy, written before the build
type Model = { readonly items: ReadonlyArray<Item> };

// the pin: the copy and the schema must be the same type
expectTypeOf<Model>().toEqualTypeOf<typeof checklist.state.schema.Type>();
```

**What this decides:** whether a test may write a program's Model, Msg and state types by hand, and
what keeps the hand-written copy true.

## Context

The checklist's laws file (pull request 987) restates the program's `State`, `Item`, `Model` and
`Msg` as plain types, while `program.ts` defines them once in Effect Schema. The test writer works
before the build, so the copy is the exam's own statement of the shape: if the exam imported the
build's types, a change to the shape would change the exam with it. Nothing checked that the two
stay the same. The owner decided this on 2026-11-11.

## Decision

**A laws file may restate the shapes it tests, and each restated shape carries one type pin against
the program's schema.**

- Product code never writes these shapes by hand: there they come from the schema, as
  `typeof X.Type`.
- In a laws file, each restated type has one `expectTypeOf<Copy>().toEqualTypeOf<...>()` line
  against the type the program exposes (its state schema, its machine's Msg). A drift then fails
  the typecheck in CI.
- A shape the program does not expose in any type is not restated as a guess: the laws use it
  through the program's own values.
- We count how often a pin goes red or a copy differs at merge, and report it in a field note. If
  drift is common, deriving from the schema comes back to the owner as a choice.

## Consequences

- About 20 repeated lines in a program's laws file, and one pin per shape.
- The checklist's and the counter's laws get their pins in a follow-up, by the tests step.
- Not decided: a lint rule that requires the pin.
