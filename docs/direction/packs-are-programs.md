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

## Where packs live

Decided 2026-10-18.

- **Packs are fabrika's, a product idea.** Like a text editor's plugins: the
  editor has them, the language it is written in does not.
- **tea-program has no plugin system.** It is the library programs are written
  with. A pack is made of programs; tea-program never knows packs exist.
- **tsh loads them** because it hosts fabrika, the same way it starts any
  program.
- **The name "add-on pack" stays**, as in a game's add-on packs. It is not on
  the naming sweep's list ([use the industry's names](./use-the-industrys-names.md)).

## Example: a ui-verification pack

For repos whose work changes what a user sees. Its branches:

- **Nothing a user sees changes:** the pack stays quiet; the core ships as usual.
- **Something a user sees changes:** the pack takes before and after
  screenshots and a short video, and emits one ask: "this is what changes,
  yes or no?" It shoots each changed screen in more than one layout, since a
  screen that fits one wide window can break at half or a quarter (added
  2026-10-30). The layouts are a setting, with this repo's as the default:

  ```toml
  [pack."@tea-fabrika/ui-verification"]
  layouts = ["one", "side-by-side", "stacked", "grid-2x2", "small-window"]
  ```
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

## First test: experiment 89

The boundary partly holds. The core names no pack (a lint rule refuses a core
import of a pack), three packs turn on from one config line, and the
ui-verification pack asks through the owner-desk pack with neither knowing the
other. With the desk off, the core still runs; asks wait in the ledger.

The core needed three generic additions, none naming a pack:

- **A full "waiting" list,** sent at start and on every change. A pack built on
  single ask events went stale.
- **A generic "check" ask:** a question plus attachments, answered yes or no
  with a note. The core carries attachments and never reads them.
- **A "holds" count:** a pack that only listens cannot stop a ship. A pack that
  must be able to (ui-verification) says so, and the core waits for that many
  packs per build. It knows a number, never a name.

So packs come in two kinds: those that only add, and those that can hold the
core's next step (which are slots in practice). Open from the same run: order
across outputs is lost, `pipe` cannot make the core-to-pack loop, and
criterion keys are positions that shift when a line is inserted. *The last one
is fixed since 2026-10-18: an id is a counter or a name, never a place in a
list (`wip/src/ids.ts`, [the smallest ledger](./smallest-ledger-proof-to-grow.md)).*
