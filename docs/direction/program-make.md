# A program is one typed Program.make

**Decided by the owner, 2026-11-07.** Written here on 2026-11-08, late: the decision lived only in
chat for a day, and Tier 1's P11 was built without it. `next/` only.

Its decided rules are in: [0256](../../.decisions/0256-a-program-is-one-program-make.md).

**Changed 2026-11-08 by the owner: the shape below gets rethought.** Too many parts are linked
only by matching names (an input's key to a Msg, an output to a Cmd), and an empty field is still
required. A study writes the real ticket program in three shapes, and the owner picks one. The
pick follows [one meaning, one way](./one-meaning-one-way.md). Changing the shape after it merged
is fine: that is what tiers are for. Until the pick, the sketch below is what main builds.

```ts
// next/programs/counter/src/counter.ts: a sketch of the decided shape.
import {Machine} from "@demlik/tea/effect";
import {Program} from "@kampus/libfabrika";
import {Schema} from "effect";

// The machine is its own value: a parent can hold it and step it, and laws fold it.
export const counterMachine = Machine.make({
	model: Schema.Struct({count: Schema.Int}),
	msg: Schema.Union([
		Schema.Struct({type: Schema.Literal("inc")}),
		Schema.Struct({type: Schema.Literal("dec")}),
		Schema.Struct({type: Schema.Literal("reset")}),
	]),
	cmds: [],
	init: (loaded) => [loaded ?? {count: 0}, []],
	update: {
		inc: (s) => [{count: s.count + 1}, []],
		dec: (s) => [{count: s.count - 1}, []],
		reset: () => [{count: 0}, []],
	},
});

// The program: the machine, plus what only a program has. Every type comes from the machine.
export const counter = Program.make({
	name: "counter",
	machine: counterMachine,
	view: (m) => ({count: m.count}), // a wrong field here fails tsc, not a run
	inputs: {inc: "Add one", dec: "Take one away", reset: "Back to zero"}, // a key that is no Msg fails tsc
});
```

## What it decides

- **One constructor, `Program.make`, in Effect's own `X.make` style.** No `defineProgram` and no
  other `defineX` (the owner dropped those on 2026-10-23 and 2026-10-28). No plain object literal.
- **The machine is its own `Machine.make` value,** exported beside the program. A parent steps a
  child machine as Elm does, and tests run laws on `counterMachine` or `counter.machine`.
- **Nothing is written twice.** TypeScript infers the model, the Msg and the view from the machine.
  The runner reads the model and Msg schemas off the machine, so a program never passes them again.
  tea 0.25.0's `Machine.make` keeps no schemas on the machine it returns; we patch it locally and
  asked upstream ([demlik#897](https://github.com/kamp-us/demlik/issues/897)).
- **The view is a function of the model,** `view: (m) => ...`, with its type inferred, so a window
  gets typed props from the program (the GUI note's `WindowProps<typeof Desk>`).
- **The `Program` Schema stays, as the load-time check `Program.make` runs.** A declaration that is
  broken still fails when it loads ([tier-1-detail.md](../plan/tier-1-detail.md)); the Schema is no
  longer the shape a person writes.
- **More fields come with the rows that need them:** `location`, `prefix`, `index`, `find` and
  `commands` (program and picker guidelines) join when their Tier builds them.

## Which version

- **`next/`:** this note. Main's P11 shipped `Program` as only a Schema over `unknown` and the
  counter as a plain object; a pull request before P14 moves both to `Program.make`.
- **Today's version:** keeps `defineProgram` until that code goes.

## What it cannot tell us

How the exact generic signature reads until it is written and type-tested; the plan for that pull
request decides it, with type tests that a wrong view, input or refusal fails to compile.
