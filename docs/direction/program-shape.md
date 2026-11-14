---
state: "decided 2026-11-08"
summary: "`next/`. The rule: in a program's API one word means one thing and there is one way to do each job; parts link by reference or a tsc check, never by two matching strings; an unused part is left out. Picks shape 2: inputs, events and outputs as values, the Msg built from the inputs (Elm ports). `Fact` becomes `Event`; `personOnly: true` is the one way to say person-only; an input is plain data; each event brings its own write Cmd, listed in `cmds`, and tsc lets only a person-only input's Msg into a person-only event's write (a `Schema.brand`); the copied `_ok`/`_err` answers are a tea problem for now; the event knows its stream, so a write stays `answered.write(msg, event)`. Probed in experiment 235."
---

# A program's shape: one thing means one thing, and one way to do each job

**Decided 2026-11-08** (owner, after a walk of each part). `next/` only. From
[experiment 235](../../experiments/235-program-shape.md). Every call, each probed in the
experiment's code: shape 2, values; `Fact` becomes `Event`; `who: "person"` becomes
`personOnly: true`; an input is plain data; each event brings its own write Cmd, listed in `cmds`;
tsc lets only a `personOnly` input's Msg into a `personOnly` event's write (the `Schema.brand`
probe); the two copied answers per write (`_ok`, `_err`) are accepted as a tea problem for now;
and the event knows its stream.

Its decided rules are in: [0257](../../.decisions/0257-a-programs-api-has-one-way.md), [0258](../../.decisions/0258-inputs-are-plain-data.md), [0259](../../.decisions/0259-each-event-brings-its-write.md), [0260](../../.decisions/0260-an-output-is-a-model-value.md).

**The rule (owner, 2026-11-08).** In a program's API, one word means one thing only, and there is
only one way to do each job. A shape that offers two ways (a string or an object for an input,
`make` or `makeEffect`, a read input made differently from a write input, init's Cmds or a setup
hook) or a word with two meanings ("input" for reads and writes, a Cmd that is also an output) is
wrong until it says why it cannot be otherwise. Every part a program links to another is linked by
reference or checked by tsc, never by two strings that happen to match. A part a program does not
use is left out, and a part that is written holds something.

```ts
// A sketch of the ticket's person-only path; experiment 235 has it whole.
const answered = Event.make(Answered, {
	personOnly: true, // only `true`; left out, anyone
	stream: (e) => ticketStream(e.ticket), // one place picks it
});
const answer = Input.make("answer", {
	fields: Answer.fields, // plain data: no events on an input
	description: "Answer an open ask on the ticket shown.",
	personOnly: true,
});
const inputs = Input.group([show, comment, answer, close, reopen]);

export const ticketMachine = Machine.make({
	model: Model,
	msg: inputs, // the Msg IS the inputs
	cmds: [readTicket, commented.write, answered.write],
	init: (loaded) => [loaded ?? start, []],
	update: {
		// tsc lets only a person-only input's Msg in here
		answer: (m, msg) => [m, [answered.write(msg, Answered.make(msg))]],
		answered_ok: saved, // two answers per event write, from tea
		answered_err: failed,
		// ...
	},
});

export const ticket = Program.make({
	name: "ticket",
	machine: ticketMachine,
	inputs,
	view,
	refuse,
	outputs: [shown], // Program.make reads the events off `cmds`
});
```

## What was picked

Shape 2, values, with six changes (owner, 2026-11-08):

1. **`Fact` becomes `Event`.** The industry's word, as in event sourcing. The glossary row is
   renamed in the same pull request; older notes still say fact.
2. **`personOnly: true` says person-only,** on an input and on an event. Only `true` is allowed;
   left out means anyone may send it or cause it. `who: "person"` goes.
3. **An input is plain data:** its name, fields and words. It names no events it may cause.
4. **Each event brings its own write Cmd** (`answered.write`). Libfabrika makes it; no program
   writes a write Cmd by hand. The machine lists it in `cmds` and calls it in `update` with the
   input's Msg and the event. A person-only input's Msg is branded `FromPerson` in its type
   (Effect's `Schema.brand`), and a person-only event's write takes only a Msg with that brand, so
   tsc lets only a person-only input's Msg into a person-only event's write. The program keeps no
   events list: `Program.make` reads the events off the machine's `cmds`.
5. **Two answers per event write** (`answered_ok`, `answered_err`; eight for the ticket program)
   are accepted for now as a tea problem. Nobody works around them.
6. **The event knows its stream.** `Event.make` takes it once, and a write stays two arguments:

   ```ts
   const answered = Event.make(Answered, {
   	personOnly: true,
   	stream: (e) => ticketStream(e.ticket),
   });
   answered.write(msg, Answered.make(msg)); // no stream here
   ```

   Why: one place picks the stream, so two writes cannot send one event kind to two different
   streams. The doubt, kept: an event kind that has to go to several streams would favor a third
   argument, `answered.write(msg, stream, event)`. None is known yet; the first one reopens this.

**tea's one-argument call.** tea reads a Cmd's types off a one-argument call (`CmdOf`, `Settled`),
so an event's write also has one, and it runs as the plain Cmd. It takes only a sealed write,
which only the two-argument call makes, so no step writes through it by mistake.

## The probe

Experiment 235's `mistakes.ts` proves each claim with `@ts-expect-error`, and its script steps all
three shapes the same after the change.

| Mistake | Stopped by |
|---|---|
| A plain input's Msg into `answered.write` | tsc: the Msg lacks `FromPerson` |
| A hand-made Msg into `answered.write` | tsc: an object literal has no brand |
| A typo in an update key, `coment` or `answerd_ok` | tsc: tea checks the keys against the Msgs |
| An event write not listed in `cmds` | tsc: tea types a step's Cmds from the list |
| A write Cmd called with a write of its own | tsc: it takes only a sealed write |
| `personOnly: false`, or a `boolean` in a variable | tsc: only `true` is a way to write it |
| A made write's spread, a person-only event put in, through the one-argument call | Compiles, and the Cmd is made. The signer refuses it at run time (`person_only`) |

A TypeScript brand stops a mistake, not a forger. The signer stays the real check.

## Why

Today's `Program.make` (PR 522) spreads a program over about ten places and links them by names that
must match: a Msg's `type` and an input's key, a fact's `_tag` and a `writes` key, a Cmd named exactly
`write` that each program declares again, and two `personOnly` flags kept in step by hand. Five parts
must be written even when empty (`state`, `refuse`, `outputs`, `writes`, `wake`), and the declared
output has no way to be sent. Experiment 235 wrote the real ticket program three ways and made each
named mistake on purpose: in today's shape, a plain input writing a person-only fact compiles and is
refused only when the write runs, after the step was saved.

Shape 3, one record per input (Redux Toolkit's `createSlice`, XState's `setup`), reads better at a
glance. It was not picked: a typo in an input's name compiles as a rename, and a step has two forms
across the codebase, its `{model, cmds}` and tea's tuple.

The pick keeps everything settled: the door's checks, `refuse` before update on fresh inputs only,
writes caused by an input's `parent`, saved state with a version and named upgrades, a JSON view,
`wake`, init's Cmds once per process start (decided, built in ticket 292; the merged stepper drops
them today), and the Cmd list the runner reads at runtime. tea does not change.

## What it decides

- **Inputs are values, never keys matched to Msg types.** The Msg is built from the inputs, so a Msg
  no client can send cannot be written.
- **`personOnly: true` is the one way to say person-only,** on the input and on the event, and tsc
  stops a plain input's step from writing a person-only event.
- **Each event's write Cmd is made by libfabrika.** No program names a write Cmd, its input or the
  runner's refusals.
- **The events are the event writes in `cmds`.** No second list to keep in step.
- **An event says its stream once,** in `Event.make`. A step never names a stream.
- **An output is a value picked from the model and sent when it changes** (C8, "a source sends after
  each change"). tsc checks the value against the output's schema; `null` means nothing to send. It
  is never a Cmd, so "output" and "Cmd" keep one meaning each.
- **"Input" means a write.** A read port gets its own word, picked with the first program that needs
  one.
- **Every empty part is left out.** An optional list holds at least one item. A program needs at
  least one input, since its Msg is built from them. The saved version is one more than the number
  of upgrades, never written by hand.
- **`refuse` is optional.** Left out, nothing is refused.
- **`Program.make` only.** `makeEffect` goes; the loader's check is the Effect.

## Which version

- **`next/`:** this note. Libfabrika gets the new `Program.make`, `Input`, `Event` and `Output`, and
  each event's write Cmd. The runner learns to run an event's write Cmd as a write and to send
  outputs. `next/programs/counter` moves to the new shape in the same pull request, with its laws.
- **Today's version:** not changed.

## What it walks back, by name

- [Tier 1's P11](../plan/tier-1-detail.md#programs-as-p11-built-it) and its plan's item 9: `inputs`,
  `outputs` and `writes` required, `{}` for none. Now left out when empty, and `writes` is read off
  `cmds`.
- P11's one `write` Cmd that every program declares: now each event brings its own.
- [tea-program](./tea-program.md) (today's version, proposed): "outputs are events". Now an output
  is a selector of the model, sent on change, and "event" means a ledger entry.
- P11's `Input` union of `read` and `write` ports: reads leave `inputs`.
- [Elm first](./elm-first.md): "`Program` has a required `refuse`". Now it is left out when a program
  refuses nothing.
- [Schema classes](./schema-classes-not-of-helpers.md) give data both `make` and `makeEffect`.
  `Program` drops `makeEffect` by the one-way rule: a program is built once, at load, where the
  loader already runs as an Effect. Data keeps the pair.
- The word fact, in [data first](./data-first-markdown-is-a-view.md) and the notes after it: the
  same thing is now an event. The prose sweep is ticket 303.

## What it costs

One pull request, ticket 302: the new `Program.make` and its values in libfabrika with type tests, the runner
change, the counter moved. Sure about the rule and the pick: the owner set both. Sure the
person-only check types cleanly: the probe compiles, about 90%; the doubt is how the brand reads in
a tsc error to someone who did not write it.

## What it cannot tell us

How the shape feels over many programs; how a program with Subs, read ports or `wake` reads;
whether every output can be a model selector; whether eight answer cells for four events wear on a
bigger program before tea fixes it. The experiment lists the rest.
