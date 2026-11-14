---
state: "decided in pieces, see the note"
summary: "A thing with a proper name in the industry keeps it; an obscure one gets a plain gloss; one word per idea. The naming sweep covers every new package."
---

# Use the industry's names

**Decided, in pieces:**

- The rule: decided 2026-10-18, below.
- The glossary: it exists, [`.glossary/TERMS.md`](../../.glossary/TERMS.md).
- The sweep's picks: made 2026-10-24 and 2026-10-28 (the naming sweep).
- The two-domains rule: replaced 2026-11-03 by [we follow DDD](./we-follow-ddd.md).

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
- **A word may mean different things in two bounded contexts** (decided
  2026-10-24, changed 2026-11-03: [we follow DDD](./we-follow-ddd.md)). The
  bullet above holds inside one context. Across two, the glossary's context
  map names the boundary and how the word translates at it.

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
  Drafted for the pipeline stages on 2026-10-24 and widened to every new
  package on 2026-10-28 (proposed): the naming sweep.
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
- **Picked: the process list is `ps`** (owner, 2026-11-07). In `next/`, the agent
  tool and list that shows the processes running now is `ps`, Unix's word and
  today's tsh's. It said `runs`. One ticket's jobs stay `timeline`'s.

## Why

- A reader should not need to learn our words for things they already know.
- An in-house word hides the prior art. With the industry's name, a reader can
  look up how others solved the same problem.

## What would change it

An industry name that means something different enough here to mislead.
