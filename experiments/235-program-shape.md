---
date: "2026-11-08"
scripts: "`235-program-shape.ts`, `235-program-shape/` (three shape files, two libraries, `mistakes.ts`, `tsconfig.json`), `results/235-program-shape.json`"
summary: "`next/`, reading, not a measurement. The real ticket program written three ways: today's `Program.make` (PR 522), values (Elm ports, Effect `Rpc.make`), and one record per input (`createSlice`, XState `setup`). All three type-check, and the merged `stepper` steps them the same: 8 of 8 steps, ports, fact policies and outputs match. Of the owner's named mistakes, today's shape compiles a plain input writing a person-only fact (the signer refuses it at run time) and a wrong saved version; both new shapes stop them at compile time, and the record shape compiles an input-name typo as a rename. Lean: the values shape, about 65%. Picked by the owner on 2026-11-08, with six changes (`Event`, `personOnly: true`, plain inputs, a write Cmd per event listed in `cmds`, two answers per event accepted, the event knows its stream); the probe shows a plain input's Msg into a person-only event's write fails tsc, cleanly, as do an update-key typo and an event write not in `cmds`. No model, $0."
---

# 235. Which shape should Program.make take, so a program reads at a glance and the wrong thing does not compile?

**Answer.** Two new shapes beat today's on every property we judged, and both meet the rule "one
thing means one thing, one way to do each job" better. Shape 2 (inputs, facts and outputs are
values; the Msg is built from the inputs) keeps tea and Elm exactly as they are. Shape 3 (one record
per input, holding its whole story) reads best and gates person-only writes per step, but builds the
machine for you and gives a step a second return form. Lean: shape 2, about 65%. The doubt is
shape 3's reading. That is the owner's call, on the files.

**Picked (owner, 2026-11-08, after a walk of each part).** Shape 2, with six changes:
`Fact` becomes `Event`; `personOnly: true` is the one way to say person-only, on an input and on
an event; an input is plain data and names no events; each event brings its own write Cmd
(`answered.write`), which the machine lists in `cmds` and calls in `update`, and from which
`Program.make` reads the events; and the two answers per event write (eight cells for the ticket)
are accepted for now as a tea problem. Last, the event knows its stream, so a write stays
`answered.write(msg, Answered.make(msg))`. The probe below shows the changes type cleanly. The decided
note is [a program's shape](../docs/direction/program-shape.md). The shape 2 files now hold the
decided shape; the judgment table keeps shape 2 as it was proposed.

This is reading, not a measurement. One script checks that all three shapes step the same, and one
file checks which mistakes compile. `next/` only.

```ts
// The whole difference, for one input, `answer` (a person only), as
// proposed before the pick.
// Shape 1, today: four places, linked by matching strings.
// in Msg:
Schema.Struct({type: Schema.Literal("answer"), parent, ...Answer.fields})
// in update:
answer: (m, msg) => [
	{...m, saving: m.saving + 1},
	[caused(msg, Answered.make(...))],
]
// in inputs:
answer: {description: "...", personOnly: true}
// in writes:
answered: {schema: Answered, personOnly: true}
// Shape 2, values: one value, used by reference.
const answer = Input.make("answer", {
	fields: Answer.fields,
	description: "...",
	who: "person",
	causes: [answered],
});
answer: (m, msg) => [
	{...m, saving: m.saving + 1},
	[answer.write(msg, stream(msg.ticket), Answered.make(...))],
]
// Shape 3, records: one block.
answer: input({
	fields: Answer.fields,
	description: "...",
	who: "person",
	refuse: notShown,
	update: (m, msg, write) => ({
		model: {...m, saving: m.saving + 1},
		cmds: [write(stream(msg.ticket), Answered.make(...))],
	}),
}),
```

## The files

Open these. Each type-checks as written (`tsc -p experiments/235-program-shape`, clean).

- [`shape-1-today.ts`](./235-program-shape/shape-1-today.ts): today's `Program.make`, as merged in
  PR 522. Each place where one part points at another only by a matching name is marked `LINK`.
- [`shape-2-values.ts`](./235-program-shape/shape-2-values.ts), with its library
  [`shape-2-lib.ts`](./235-program-shape/shape-2-lib.ts).
- [`shape-3-records.ts`](./235-program-shape/shape-3-records.ts), with its library
  [`shape-3-lib.ts`](./235-program-shape/shape-3-lib.ts).
- [`ticket-data.ts`](./235-program-shape/ticket-data.ts): the schemas all three share (the model,
  the facts, the `ticket_read` Cmd). No program part lives there.
- [`lib-common.ts`](./235-program-shape/lib-common.ts): what shapes 2 and 3 share. Both compile down
  to the declaration the merged `stepper` already loads, so neither needs the runner to change in
  order to step.
- [`mistakes.ts`](./235-program-shape/mistakes.ts): each mistake the owner named, made on purpose in
  each shape. `@ts-expect-error` marks one tsc stops; tsc fails the file if it compiles after all.
- [`235-program-shape.ts`](./235-program-shape.ts) and its answers,
  [`results/235-program-shape.json`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/235-program-shape.json).

The job is today's `programs/ticket` (show a ticket, comment, answer a person only, close, reopen,
refuse a write to a ticket never shown, send the shown ticket down a pipe), rethought for `next/`:
there is no `main`, the page comes from one `ticket_read` Cmd, and each write is the runner's
`write` Cmd. Today's `quit` input is left out: in `next/` a window closes a process.

## What is settled, and what each shape must keep

Read before writing: [Program.make](../.decisions/0256-a-program-is-one-program-make.md) (decided 2026-11-07),
[init's Cmds](../docs/direction/init-runs-once-per-process.md) (decided 2026-11-08),
[saved state](../docs/direction/saved-state.md) S3, [Elm first](../docs/direction/elm-first.md),
[no Promises](../docs/direction/no-promises.md),
[schema classes](../docs/direction/schema-classes-not-of-helpers.md),
[industry names](../docs/direction/use-the-industrys-names.md),
[where each piece lives](../docs/direction/where-each-piece-lives.md),
[program guidelines](../docs/direction/program-guidelines.md) (G6, C8),
[tea-program](../docs/direction/tea-program.md) (today's version, proposed) and
[Tier 1's P11 as built](../docs/plan/tier-1-detail.md#programs-as-p11-built-it).

Every shape keeps these, and all three do, except where a line says it is not built yet:

- **The door's checks.** An input has a port; a person-only port needs a person; the door stamps
  `parent` and refuses an input that brings its own; `refuse` runs on fresh inputs only, before
  update, never on a fold.
- **Writes with their causing input.** A write is the runner's `write` Cmd, `caused` by an input's
  `parent` or `own`. The signer refuses a person-only fact unless the input that caused it was a
  person-only port and a person sent it (`next/packages/libfabrika/src/coordination/session-manager.ts`,
  `SavedInput.sign`).
- **Saved state** with a version and a chain of named upgrades (S3, branch A).
- **A view as JSON,** a function of the model, typed from it.
- **`wake`,** a time or none.
- **init's Cmds once per process start.** Decided, not built yet: the merged stepper drops the Cmds
  init returns (`next/packages/libfabrika/src/app/program.ts`, `stepper`'s `init`), and ticket 292
  builds it. Each shape's init returns its Cmds, so none stands in that build's way; no shape adds a
  separate setup hook.
- **The Cmd list at runtime.** The runner needs each Cmd's schemas to check a Cmd's input, check a
  saved answer, and encode a handler's answer. See "Why `cmds` is listed" below.
- **The machine stays a tea machine** a parent can step and laws can fold
  ([Program.make](../.decisions/0256-a-program-is-one-program-make.md)).

## The known way

- **Elm.** `element : { init : flags -> ( model, Cmd msg ), view : model -> Html msg, update : msg
  -> model -> ( model, Cmd msg ), subscriptions : model -> Sub msg } -> Program flags model msg`
  ([Browser.elm, 1.0.2](https://raw.githubusercontent.com/elm/browser/1.0.2/src/Browser.elm)). Ports
  are values declared once: `port sendMessage : String -> Cmd msg` and `port messageReceiver :
  (String -> msg) -> Sub msg` ([ports](https://guide.elm-lang.org/interop/ports.html)). An empty
  part is still written: `Sub.none`, "Tell the runtime that there are no subscriptions"
  ([Sub.elm](https://raw.githubusercontent.com/elm/core/1.0.5/src/Platform/Sub.elm)). Elm's return
  is the tuple, and `Cmd.none` is written every time.
- **Erlang `gen_server`.** Callbacks a module does not need are left out: `handle_info` "is
  optional, so callback modules need not export it", and so are `handle_continue` and
  `code_change` ([gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)). A call
  answers `{reply,Reply,NewState}`, a tuple.
- **XState v5.** `setup({...})` fixes "types and sources for your machines" before
  `createMachine`, so "named sources are guaranteed to exist" ([setup](https://stately.ai/docs/setup)).
- **Redux Toolkit.** `createSlice` "automatically generates action creators and action types that
  correspond to the reducers and state" ([createSlice](https://redux.js.org/toolkit/api/createSlice)):
  the reducer's key is the action's name, written once.
- **Effect 4.1.1, as installed.** `Rpc.make("Increment", {payload: {amount: Schema.Int}, success:
  Schema.Int})` makes one typed value per message, and `Entity.make("Counter", [Increment,
  GetCount])` groups them by reference (`effect/ai-docs/src/80_cluster/10_entities.ts`). An Entity is
  the closest thing in Effect to our process: a durable, addressed actor. Effect 4 has no
  `Schema.TaggedRequest`.
- **tea 0.25.0, as installed.** `Machine.make({model, msg, cmds, init, update})`; a step returns
  `readonly [S, readonly C[]]`; `cmds` is required, `[]` for none. Our local patch keeps `model` and
  `msg` on the machine, typed `Schema.Schema<S>` and `Schema.Schema<M>`
  ([demlik#897](https://github.com/kamp-us/demlik/issues/897)).

Shape 2 is Elm's ports and Effect's `Rpc.make`. Shape 3 is `createSlice` and XState's `setup`.

## Why `cmds` is listed, and why the tuple

A Cmd value is plain data, `{type: "ticket_read", ticket: 7}`, because the runner saves it as JSON on
the ledger before it runs and folds its answer back after a restart. Plain data cannot carry its
schemas, so the list is the only place the runner finds them: tea types the `ticket_read_ok` and
`ticket_read_err` Msgs from it, and the runner checks the Cmd's input, checks a saved answer by the
`ok` schema, and encodes a handler's answer through it. Elm needs no list because its Cmds are opaque
values inside one running program, which never saves them. So the list stays in every shape. Shape 2
lists the runner's `write` Cmd once in the library, so no program writes its name again; shape 3 also
lists each Cmd's two answers beside each other.

The tuple is Elm's `(model, Cmd msg)`. Shape 2 keeps it. Shape 3 returns `{model, cmds}` from a
program's steps and turns it into tea's tuple underneath, which is its second way to write a step
(below).

## What the run showed

`235-program-shape.ts` loads each shape's declaration into the merged `stepper`, boots it, steps
five fresh inputs (show 7, comment on 7, close 3, answer on 7, a Msg named `nope`) and folds two saved
answers (`ticket_read_ok`, `write_err`). All 8 steps match as JSON across the three shapes, and so do
the ports (only `answer` is person-only), the fact policies (only `answered`), the outputs (`ticket`)
and the version (1). `close 3` is refused `not_shown` in all three, and `nope` is `bad_msg`.

## The probe (after the pick)

The decided changes, written into `shape-2-lib.ts` and `shape-2-values.ts` and checked in
`mistakes.ts` with `@ts-expect-error`:

```ts
const answered = Event.make(Answered, {stream: onTicket, personOnly: true});
const answer = Input.make("answer", {fields, description, personOnly: true});
// (i) a plain input's Msg into a person-only event's write
answered.write(commentMsg, anAnswer); // tsc: no `FromPerson` brand
answered.write(answerMsg, anAnswer); // compiles
```

- **(i) A plain input's Msg into `answered.write` fails tsc,** cleanly, with no cast. A person-only
  input's Msg schema is branded with Effect's own `Schema.brand("FromPerson")`, so its Msg type
  carries the brand into its update cell; a person-only event's write takes only a Msg with it. A
  hand-made object, and the `comment` cell inside a real `Machine.make`, fail the same way.
- **(ii) A typo in an update key fails,** `coment` and `answerd_ok` alike: tea checks the keys
  against the Msg types, its Cmd answers included.
- **(iii) An event write not in `cmds` fails:** tea types a step's Cmds from the list, so an event
  write is checked like any other Cmd.
- `personOnly: false` does not compile, on an input or an event, and neither does a `boolean` held
  in a variable: the plain case takes no `personOnly` key at all.
- **Still compiles:** spreading a write that a plain event's write made, putting `answered` in it,
  and handing it to `answered.write`'s one-argument call (part 9). tea reads a Cmd's types off
  that call, so it stays; it runs as the plain Cmd, and a run of part 9 makes the Cmd as written.
  A brand stops a mistake, not a forger, and the signer refuses it at run time (`person_only`).
  Review 3 found that the first version of this call crashed instead; it now reaches the signer.

The write's call takes `(msg, event)` and no stream, as the owner's sketch does. An event says
its stream once, `Event.make(Answered, {personOnly: true, stream: onTicket})`, and the owner
decided it that way on 2026-11-08: one place picks the stream, so two writes cannot send one event
kind to two streams. The doubt stays: an event kind that needs several streams would favor a third
argument. Each event's write Cmd is named by the event's `_tag`, so the stepper sees `{type: "answered", stream, write}`. The merged runner performs
only `{type: "write"}`; the runner reading event writes off `cmds` is the build ticket. The script
maps shape 2's event writes to `write` before it compares, and folds `commented_err` where the
others fold `write_err`. With that, all 8 steps, the ports and the event policies still match.

## The judgment

As proposed, before the pick. Judged by properties, never by size. "Stops" means tsc stops it, from `mistakes.ts`.

| Property | Shape 1: today | Shape 2: values | Shape 3: records |
|---|---|---|---|
| A typo in an input's name | tsc stops it (key must be a Msg type) | No key to mistype; tea checks the update keys | **Compiles:** the key is the name, so a typo renames the input; the door then refuses the real name |
| A Msg no client can send | Compiles; dead code the door never reaches | Cannot be written: the Msg is the inputs | Cannot be written |
| A Cmd not in the list | tsc stops it | tsc stops it | tsc stops it |
| A plain input writes a person-only fact | **Compiles;** refused by the signer when the write runs, after the step was saved | tsc stops the mistake where the input is made and where it writes; an input's writer takes only its own Msg; the write Cmd takes only a write a writer made (a type-only brand). A step that spreads a made write and swaps its fact still compiles: a brand stops a mistake, not a forger, and the signer refuses it at run time | tsc stops the mistake at the write, with the same brand and the same limit |
| The output | Declared; nothing can send it | A value picked from the model, checked against its schema by tsc; `null` means nothing to send; sent when it changes | Same, written in place |
| A saved version that does not match its upgrades | Compiles, and loads: `v: 2` with no upgrades boots fresh, then a saved model at version 1 fails later as `ProgramDown saved_state` (`app/state.ts`, `Saved.upgrade`) | Cannot be written: the version is one more than the upgrades | Same |
| Empty parts written | `state`, `refuse`, `outputs`, `writes`, `wake`: all required | None for optional parts; an optional list takes at least one item. `inputs` must name at least one input, so a program with none cannot be written | None: `inputs`, `facts`, `cmds`, `answers`, `outputs`, `wake`, `state` are left out when empty, and `facts: []` or `outputs: {}` does not compile. Each step's `cmds: []` is still written |
| One input's whole story lives in | 4 places, linked by names | 3: its value, its place in the group, its update cell | 1 block, plus its fact in `over` |
| Two ways to do one job (the owner's rule) | Input as a string or an object; `make` or `makeEffect`; a read input made a different way from a write input; person-only said twice, on the input and on the fact | None found. One value is handed to two places (the input group, to the machine's `msg` and the program's `inputs`) | A step returns `{model, cmds}` in a program and `[model, cmds]` in a plain tea machine |
| One word, two meanings | "input" is a write port and a read port. (If outputs were later sent by a Cmd named after each, a Cmd would also be an output; nothing decided says so, and nothing is built) | None found | "answer" is a Cmd's result and the ticket's `answer` input; `over` is a new word |
| How it fails | 3 of the named mistakes at load or run time | All at compile time | All at compile time but the typo, which a client finds |
| Walks back | Nothing | Outputs and `writes` stop being required (P11: "required, `{}` for none"); `refuse` becomes optional (Elm first: "a required `refuse`"); outputs become model selectors, not events (tea-program, today's version; C8 already says "a source sends after each change"); read ports leave `inputs`; `makeEffect` goes, against the `make` and `makeEffect` pair that schema classes set for data | All of shape 2's, plus "the machine is its own `Machine.make` value" (Program.make, decided): `Program.make` builds it |
| Needs a tea change | No | No. Two hand-offs of one value, `inputs` to the machine and the program, would merge into one if tea's `Machine.make` kept the schema's own type (an addition to the demlik#897 patch) | No |
| Needs a runner change | Outputs cannot be sent in any shape yet | The runner sends an output when its selected value changes | Same |

**The rule in each new shape.** Shape 2 meets it with one maker per kind of thing (`Input.make`,
`Fact.make`, `Output.make`, `Program.make`), each optional part written only as its non-default
value (`who: "person"`, never `who: "anyone"`; `causes` only with a fact in it), the version derived
from the upgrades, outputs that are never Cmds, and a write Cmd no step can call except through
its input's own writer. Its one wrinkle is not two ways but one value
given twice: the input group goes to the machine's `msg` and to the program's `inputs`, and the load
checks they are the same object. Shape 3 meets it inside a program, but not across the codebase:
tea's machines step with a tuple, a program's steps with a record, so one job has two forms. It
cannot meet it there without changing tea's return, which Elm does not do.

## Lean

**Shape 2, about 65%.** Why: it removes every name link the owner named except tea's own update
keys, which tsc already checks; it makes the person-only mistake and the dead Msg impossible; it
keeps tea, the tuple and the machine as its own value, so it walks back the least; and it is Elm's
own answer, ports as values. What it costs: an `Input.make` per input before the machine, the update
cell still apart from its input, and `inputs` handed to two places.

**The doubt.** Shape 3 reads best: one block per input is what "a program at a glance" asks for, and
its person-only gate sits on the step itself. If the owner reads the files and shape 3 feels right,
the second return form and the built machine are the price, and both are honest prices. What would
settle it: the owner reading the two files side by side, and then a second, bigger program (the
tracker, with Subs and internal state) written both ways.

## What it cannot tell us

- How either shape feels to write. These files were written once, by one agent, for one program.
- How a program with Subs, read ports or `wake` reads. The ticket uses none of them; shape 3's
  library has `wake`, shape 2 would still need a `timer` Msg named by hand to wake.
- Whether outputs as model selectors fit every program. An output that is a pure event, with no
  state behind it, would have to live in the model first. None is known; ship's `outcome` per pull
  request is the case to check.
- Whether `Program.over` is the right word. XState says `setup`, which here already means init's
  work, so it was not used.
- The libraries are sketches, tested only by the script and `mistakes.ts`. Each has casts, each
  marked where it stands: shape 3's built update table and init, its input brand, and the type of
  the machine it builds (one `oxlint-disable` with its reason). A parent stepping shape 3's machine
  with `applyCell` compiles (`mistakes.ts`, part 8), but no parent was written.
- How an event written `own`, caused by no input, is written in the decided shape. An event's write
  takes an input's Msg; the ticket writes none `own`, so the probe did not need one.
- How the `FromPerson` brand reads in a tsc error to someone who did not write the library. The
  messages name `Cause<true>` and the missing brand; a type test in the build should show one.
- Nothing ran on the runner or on workerd; only the stepper.
