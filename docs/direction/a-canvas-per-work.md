# A canvas per piece of work

**A vision**, written down 2026-10-11. Not planned, not sized. It is here so
that what gets built now does not close the door on it.

## The picture

You open a canvas for one piece of work. You see the whole machine that will
carry it: every stage, where the ticket is now, what each stage answered. On
each node where an agent works, you choose what does the work: which harness,
which model.

```ts
// One piece of work, and who does each agent job in it. Data, not code.
const work = {
  ticket: "acme/app#42",
  agents: {
    builder:  { harness: "codex",  model: "gpt-6.1-sol" },
    reviewer: { harness: "claude", model: "opus-5.5" },
    fixer:    { harness: "codex",  model: "gpt-6.1-sol" },   // repairs after a failed review
  },
};
```

The canvas is a view over that data and over the running machine's state.

## Why the design already allows it

- **An agent is one move behind one contract.** A Draft has a name, a typed
  output and a runner. The harness is the runner, so swapping Claude Code for
  another harness is swapping one Layer, and choosing it per node is one
  field of data.
- **The machine can be drawn.** Its states and its typed answers are plain
  data, and `@demlik/tea` already ships a machine view. The edges between
  nodes are the typed outcomes each stage hands back.
- **Everything that happens is a message.** A live view is a subscriber to the
  same messages the machine steps on. Nothing has to be scraped from logs.
- **It follows from [Data first](./data-first-markdown-is-a-view.md).** The
  canvas is one more view of the data, beside the markdown one.

## What it asks of the work being done now

- A stage's choice of harness and model is **configuration**, per stage, never
  written into the stage machine.
- **Repair is its own job.** The picture has a fixer beside the builder. Today
  a repair is the builder started again. A fixer has a different input (the
  findings) and may want a different, cheaper model, so the stage machines
  should not assume builder and fixer are the same agent.
- Stage outcomes stay typed and small, because they become what the canvas
  draws.
- Per-run numbers (time, money, tokens per node) are recorded as data, as
  `field/` does today, so a node can show what it cost.

## What the canvas is: a place to build tea machines, and no more

Settled the same day. The canvas is not a separate pipeline language sitting
on top of the machines. It builds and shows **tea machines themselves**.

That is possible because a tea machine already has a shape that is data: its
states, the messages it takes, and one small pure step per message. The shape
can be drawn and edited. The body of each step is code and stays code.

```ts
const ship = defineMachine({
  types: { model: {} as Ship, msg: {} as ShipMsg },
  init: ...,
  update: {
    // The canvas can draw and arrange this much: which messages exist,
    // which state each one leads to, which agent or service sits behind a step.
    ship_facts_ok: (s, m) => ...,   // the body is code
    ship_enqueue_ok: (s, m) => ..., // the body is code
    ship_queue: (s, m) => ...,      // the body is code
  },
});
```

`@demlik/tea/machine-viz` already draws a machine's real edges this way: the
steps are pure, so it can run each one on a sample and see where it leads,
without reading the source.

This does not undo [Elm first](./elm-first.md). The rule there is against a
second language that wires stages together and fights the typed messages. A
canvas over the machine's own shape adds no second language: what it edits is
the same machine the code defines.

## Open

- **How far editing goes.** Drawing a machine and choosing each node's agent
  is clear. Adding a state or a message from the canvas means writing code for
  its step: does the canvas hand that to an agent, open an editor, or only
  scaffold the empty step?
- Which harnesses, and what each must support to be a runner here (a typed
  final answer, a check before each command, a time and money limit).
- Whether one piece of work is one ticket, or an epic with its children.
