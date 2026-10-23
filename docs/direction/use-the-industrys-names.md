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

## Still to do

- **A naming sweep.** List every exported name. For each one, find the name
  the industry uses for it, mark where ours differs or where one word means
  two things, and propose a change. The owner picks, then one rename pass and
  a short glossary page.
- `kind` in tea-program stays for now. It is the first name the sweep checks:
  it means "how a program keeps and runs instances of one machine", which
  Cloudflare calls a Durable Object namespace and Akka an entity type.
- **`kid` becomes `child`** (picked by the owner, 2026-10-22). The lane says
  `kid` (`KIDS`, `startKid`, `kidSub`, `kid_over`, `hosted/kids.ts` and the
  `<parent>/kids` stream) for what `combos.ts` already calls a child. One idea,
  two words. `child` is the word Elm and OTP use. A rename only: nothing runs
  differently.

## Why

- A reader should not need to learn our words for things they already know.
- An in-house word hides the prior art. With the industry's name, a reader can
  look up how others solved the same problem.

## What would change it

An industry name that means something different enough here to mislead.
