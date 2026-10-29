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
  language that wires stages together inside tea; tsh lines are the one named
  exception (changed 2026-10-28, below).
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

## Changed 2026-10-28: exceptions are named, with their reason

Elm's guidelines are the default, everywhere. A place that does not follow
them is allowed only when it is named here with its reason, the way a
`// biome-ignore` carries its reason on the line.

```ts
// The shape of an exception: what, and why Elm's answer does not fit there.
type Exception = {what: string; why: string; status: "decided" | "proposed"};
```

- **tsh lines are a small language** (decided). "There is no pipeline
  language" stays true inside tea and its programs: parents are written by
  hand. A person at a shell still needs to type one line that wires programs
  together, and tsh's lines are that language. Following Elm strictly is what
  made tsh possible: each program has typed inputs and outputs, so a pipe is
  just wiring, checked before anything runs.
- **The factory as one line** (proposed). Whether
  `tracker | triage | plan | build | review | ship` can be the factory, with a
  stage's `send` going back through the tracker and the ledger, is being
  tested in [experiment 168](../../experiments/168-the-factory-is-one-line.md).
  Until it is decided, the hand-written parent is the answer.
