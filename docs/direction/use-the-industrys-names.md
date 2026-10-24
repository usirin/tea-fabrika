# Use the industry's names

Decided 2026-10-18.

## What was decided

- **A thing that already has a proper name in the industry keeps that name.**
  No in-house word for it.
- **Before naming something new, look for its name elsewhere first:** queues,
  actors, durable workflows, event sourcing, Elm.
- **When the industry name is obscure, keep it and add a short plain gloss**
  in the doc comment and the package README.
- **One word per idea.** Two names for one thing, or one name for two things,
  is a bug to fix.
- **A word may lean a little differently in two domains** (decided
  2026-10-24), as long as it holds inside each one and carries over at the
  boundary without misleading. One meaning everywhere still comes first.

  ```ts
  // Fine: both mean "take it in", each in its own world.
  {answer: "accept", to: "plan"}   // triage takes a ticket in (Linear's word)
  {kind: "accept"}                 // refine: the owner takes a stuck draft as it is
  ```

- **Proposed 2026-10-24: the settled names live in a glossary,** `.glossary/`
  in the shape the fabrika glossary skill keeps: one term, one row, one
  meaning. It is the "short glossary page" below.

## Still to do

- **A naming sweep.** List every exported name. For each one, find the name
  the industry uses for it, mark where ours differs or where one word means
  two things, and propose a change. The owner picks, then one rename pass and
  a short glossary page.
- `kind` in tea-program stays for now. It is the first name the sweep checks:
  it means "how a program keeps and runs instances of one machine", which
  Cloudflare calls a Durable Object namespace and Akka an entity type.
- **Done: `kid` became `child`** (picked by the owner, 2026-10-22, renamed the
  same day). The lane said `kid` (`KIDS`, `startKid`, `kidSub`, `kid_over`,
  `hosted/kids.ts` and the `<parent>/kids` stream) for what `combos.ts` already
  calls a child. One idea, two words. `child` is the word Elm and OTP use. Now
  it is `CHILDREN`, `startChild`, `childSub`, `child_over`, `hosted/children.ts`
  and the `<parent>/children` stream. A rename only: nothing runs differently.
- **Picked: triage's answers** (owner, 2026-10-24). `YesPlan`, `YesRuling`,
  `YesResearch` and `No` become `Accept` (`to: "plan" | "research"`),
  `Escalate` and `Decline`; `Duplicate` stays. See
  [sort-answers-yes-or-no.md](./sort-answers-yes-or-no.md). Not renamed in
  code yet.
- **"Moves" or "primitives"** (found 2026-10-22). The docs call Gather, Act,
  Listen, Draft, Check and Judge the six moves; the code calls them primitives
  (`packages/pipeline/src/primitives.ts`). One idea, two words. "Move" is our
  own word. The sweep looks for the industry's word, then one is picked.

## Why

- A reader should not need to learn our words for things they already know.
- An in-house word hides the prior art. With the industry's name, a reader can
  look up how others solved the same problem.

## What would change it

An industry name that means something different enough here to mislead.
