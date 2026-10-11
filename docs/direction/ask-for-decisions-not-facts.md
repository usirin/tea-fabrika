# Ask a person for a decision, never for a fact

Decided 2026-10-11, while sketching what follows a part landing.

## What was decided

The machine asks a person only for a **decision** or an **act** that is theirs
to make: approve this change, rule on this open call, resolve your own comment.

It never asks a person for a **fact**. What is left on a ticket, what state a
pull request is in, what was decided last week: those are in the ledger, and
the machine reads them.

```ts
// Wrong: a person is used as memory.
ask(owner, "A part of this ticket landed. What is left?");

// Right: the ledger is the memory. A person is asked only when it names one.
const left = yield* ledger.ticket(id);             // criteria, state, named stops
if (left.owed === "a_ruling") return waitFor(owner, "rule on the open call in this ticket");
return startBuild(id, { only: left.criteria.filter((c) => !c.done) });
```

## Why

- A real backlog is hundreds of open tickets. Nobody holds what is left on
  each one in their head, and nobody should have to.
- fabrika is project machinery (see
  [Built for projects](./built-for-projects.md)). Knowing the state of the work
  is its job, not the owner's.
- A question that asks for a fact trains people to answer from memory, and the
  answers go wrong quietly.

## What it means for the work

- Before adding any question to a person, check: is the answer already written
  somewhere the machine can read? If yes, read it. If it should be written
  somewhere and is not, that is a gap in the ledger to fix, not a question to
  ask.
- A question names exactly who must act and exactly what the act is.
- If the machine cannot tell what is left from the ledger, the fix is to make
  tickets record it (which criteria a pull request delivers, or child tickets
  for the rest), not to ask.
