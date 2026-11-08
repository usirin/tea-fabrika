# A program's shape: one thing means one thing, and one way to do each job

**Proposed 2026-11-08.** `next/` only. From [experiment 235](../../experiments/235-program-shape.md).

**The rule (owner, 2026-11-08).** In a program's API, one word means one thing only, and there is
only one way to do each job. A shape that offers two ways (a string or an object for an input,
`make` or `makeEffect`, a read input made differently from a write input, init's Cmds or a setup
hook) or a word with two meanings ("input" for reads and writes, a Cmd that is also an output) is
wrong until it says why it cannot be otherwise. Every part a program links to another is linked by
reference or checked by tsc, never by two strings that happen to match. A part a program does not
use is left out, and a part that is written holds something.

```ts
// Shape 2, values: an input is one value, made once, used by reference. A sketch from the experiment.
const answered = Fact.make(Answered, {who: "person"});
const answer = Input.make("answer", {
	fields: Answer.fields,
	description: "Answer an open ask on the ticket shown. A person only.",
	who: "person",
	causes: [answered],              // a plain input naming `answered` does not compile
});
const inputs = Input.group([show, comment, answer, close, reopen]);   // the Msg IS the inputs
export const ticketMachine = Machine.make({model: Model, msg: inputs, cmds: [readTicket, Fact.write], init, update});
export const ticket = Program.make({name: "ticket", machine: ticketMachine, inputs, view, refuse, outputs: [shown]});
```

**Which shape: no lean, the owner picks.** The experiment's lean is shape 2 at about 65%, under this
repo's 80% bar, so the pick is the owner's, on the three files.

## Why

Today's `Program.make` (PR 522) spreads a program over about ten places and links them by names that
must match: a Msg's `type` and an input's key, a fact's `_tag` and a `writes` key, a Cmd named exactly
`write` that each program declares again, and two `personOnly` flags kept in step by hand. Five parts
must be written even when empty (`state`, `refuse`, `outputs`, `writes`, `wake`), and the declared
output has no way to be sent. Experiment 235 wrote the real ticket program three ways and made each
named mistake on purpose: in today's shape, a plain input writing a person-only fact compiles and is
refused only when the write runs, after the step was saved.

## The two shapes on the table

Both keep everything settled: the door's checks, `refuse` before update on fresh inputs only, writes
caused by an input's `parent`, saved state with a version and named upgrades, a JSON view, `wake`,
init's Cmds once per process start, and the Cmd list the runner reads at runtime. Neither needs tea to
change. Both compile down to the declaration the merged `stepper` loads, and the experiment's script
shows all three shapes step the same.

```ts
// Shape 3, records: each input holds its whole story; Program.make builds the tea machine.
const {input, make} = Program.over({model: Model, facts: [Fact.make(Answered, {who: "person"}), ...], cmds: [readTicket]});
export const ticket = make({
	name: "ticket",
	init: (saved) => ({model: saved ?? start, cmds: []}),
	inputs: {
		answer: input({
			fields: Answer.fields,
			description: "Answer an open ask on the ticket shown. A person only.",
			who: "person",
			refuse: notShown,
			update: (m, msg, write) => ({model: {...m, saving: m.saving + 1}, cmds: [write(stream(msg.ticket), Answered.make({...}))]}),
		}),
	},
	answers: {ticket_read: {ok, err}, write: {ok, err}},   // every Cmd's two answers, by its name
	view: (m) => ({now: m.now, page: m.page, saving: m.saving, failed: m.failed}),
	outputs: {ticket: {schema: TicketNumber, description: "...", select: (m) => m.now}},
});
export const ticketMachine = ticket.machine;   // still a tea machine a parent can step
```

| | Shape 2: values | Shape 3: records |
|---|---|---|
| Known way | Elm ports, Effect `Rpc.make` | Redux Toolkit `createSlice`, XState `setup` |
| Meets the rule | Yes; one value is handed to the machine and the program, checked to be the same | Inside a program; a step has two forms across the codebase, `{model, cmds}` here and tea's tuple elsewhere |
| A typo in an input's name | Cannot happen; tea checks the update keys | Compiles, and renames the input |
| A plain input writes a person-only fact | Does not compile | Does not compile |
| Walks back | Required `outputs` and `writes`; outputs as events; read ports in `inputs`; `makeEffect` | All of shape 2's, and the machine as its own `Machine.make` value |

## What it decides, once picked

- **Inputs are values or records, never keys matched to Msg types.** The Msg is built from the
  inputs, so a Msg no client can send cannot be written.
- **`who: "person"` is the one way to say person-only,** on the input and on the fact, and tsc stops
  a plain input from causing a person-only fact.
- **The runner's `write` Cmd is declared once, in libfabrika.** No program names it again.
- **An output is a value picked from the model and sent when it changes** (C8, "a source sends after
  each change"). It is never a Cmd, so "output" and "Cmd" keep one meaning each.
- **"Input" means a write.** A read port gets its own word, picked with the first program that needs
  one.
- **Every empty part is left out.** An optional list holds at least one item. The saved version is
  one more than the number of upgrades, never written by hand.
- **`Program.make` only.** `makeEffect` goes; the loader's check is the Effect.

## Which version

- **`next/`:** this note, once picked. `next/programs/counter` moves to the picked shape in the same
  pull request, with its laws. The runner learns to send outputs.
- **Today's version:** not changed.

## What it walks back, by name

- [Tier 1's P11](../plan/tier-1-detail.md#programs-as-p11-built-it) and its plan's item 9: `inputs`,
  `outputs` and `writes` required, `{}` for none. Now left out when empty.
- [tea-program](./tea-program.md) (today's version, proposed): "outputs are events". Now an output
  is a selector of the model, sent on change.
- P11's `Input` union of `read` and `write` ports: reads leave `inputs`.
- Shape 3 only: [Program.make](./program-make.md)'s "the machine is its own `Machine.make` value,
  exported beside the program". The machine is still exported, but `Program.make` builds it.

## What it costs

One pull request: the new `Program.make` in libfabrika with its type tests, the counter moved, the
runner sending outputs. Sure about the rule: the owner set it. Sure about the pick: about 65% for
shape 2. The doubt: shape 3 reads better at a glance, which is the owner's own complaint.

## What it cannot tell us

How each shape feels to write over many programs; how a program with Subs, read ports or `wake`
reads; whether every output can be a model selector. The experiment lists the rest.
