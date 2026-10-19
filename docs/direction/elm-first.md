# Elm first

Decided before this repo started; it comes with `@demlik/tea`, which is the Elm
architecture in TypeScript.

## What was decided

Before adding any new shape (a plugin, a pipeline builder, a composition
helper, an interface), say what Elm does for the same need. If Elm solves it
with plain functions, do that. Anything bigger needs a reason written down.

## What it means for the work

- **Parents are written by hand.** A parent machine holds its children's state
  and steps each one with the child's own `update`. There is no pipeline
  language that wires stages together.
- **The machine sees only typed answers.** An agent's free text never drives a
  step; it is turned into a typed value first, by code or by a narrow question.
- **Limit outputs, not process.** An agent is free in how it works and tightly
  limited in what it may hand back.
- A one-shot action is a Cmd. Something that stays open (a wait for checks, a
  wait for a reply) is a Sub. Two clocks at once is two entries in the list of
  Subs, not a new abstraction.
- **tea stays as close to Elm as it can** (2026-10-14). A new idea gets a new
  name, so it never clashes with what an Elm word means. tea is Elm;
  tea-program is ours, and its words come from programs and Unix, not from Elm.
- **No late-bound dispatch** (2026-10-17). No slot that holds the runtime so a
  callback can send to it later. An agent run inside a machine is a Sub, since
  it keeps talking, and each tool call that changes something arrives as a Msg
  when it happens.

## Why

Earlier work spent many rounds designing composition layers that plain
functions already covered. Naming the Elm answer first stops that early.
