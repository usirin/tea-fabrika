# Add-on packs are programs

Proposed 2026-10-18.

## The idea

- **fabrika is a small core plus add-on packs.** The core is report, sort,
  plan, build, review, ship, the parent loop and the ledger. Everything else
  (owner approvals, on-call, cost, a UI lane, other trackers) is a pack.
- **A pack is one or more [programs](./tea-program.md),** shipped as a package.
  Install it, then enable it with one line of fabrika config that wires it in.
- **The core never knows a pack exists.** It emits events and takes answers.
- **A pack plugs in one of three ways:**
  - **It listens and answers.** The core emits "ask the owner"; an owner-desk
    pack hears it, shows it, and feeds the answer back in (`core | pack`).
    On-call and cost packs work this way too.
  - **It fills a slot.** A UI pack puts its own builder and reviewer in the
    build and review slots for rendered work
    ([stages as slots](./one-parent-stages-as-slots.md)).
  - **It provides a service.** A tracker pack implements `Ledger`; a code
    hosting pack implements `CodeHost`
    ([two services](./ledger-behind-a-service.md)).

## Example: a ui-verification pack

For repos whose work changes what a user sees. Its branches:

- **Nothing a user sees changes:** the pack stays quiet; the core ships as usual.
- **Something a user sees changes:** the pack takes before and after
  screenshots and a short video, and emits one ask: "this is what changes,
  yes or no?"
- **Yes:** it ships.
- **No, with a note:** the note becomes a new criterion and the work goes back
  to build.

It brings back a person's look at a PR only where a picture beats a test, and
only where the pack is enabled; by default the owner approves plans, not PRs.
It would replace today's separate UI lane. It is also the first pack that leans
on another: it emits an ask, and an owner-desk pack shows it. Whether two packs
can work together through the core's events alone is part of the first test.

## Why

- Today's fabrika grew its side parts one fix at a time, wired into every
  stage. A pack keeps a side part in one place, behind the same seams the core
  already has.
- Elm has no plugins, but ports do this: commands go out, messages come back
  in. No new idea is needed.

## What would change it

A slot pack that needs more from the core than inputs and outputs, so the core
would have to know about it.

## First test

Sketch the owner-desk pack as a real program wired to the core: an inbox of
what waits on the owner, one view per plan, answers saved as events.
