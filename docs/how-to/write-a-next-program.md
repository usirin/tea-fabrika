# Write a program for `next/`

For anyone writing a program for `next/`, the new version of fabrika. **Every claim here is about
`next/`** and was read from main's source, cited as `path:line`. The two tutorials in
[`docs/tutorials/`](../tutorials/) teach today's version (`@kampus/fabrika-old`), not this one.

A program is a pure tea machine plus what it declares: its saved state, its view, when it refuses an
input, who may send each input, and when it wants to wake. It gets no clock, key, ledger or service
([Program.ts:1-3](../../next/packages/libfabrika/src/runtime/Program.ts)). The runner does the rest.

## The whole program, as a sketch

A checklist: items you can add, rename, check and remove
([0125](../../.decisions/0125-the-example-program-is-a-checklist.md)). **This is a sketch.** The
checklist is not built yet. Every name in it exists on main, in the shape `Program.make` has
today.

```ts
// A sketch, not built yet: the checklist in main's Program.make shape.
import { Machine } from "@demlik/tea/effect";
import { Input, Program, type Refusal } from "@kampus/libfabrika";
import { Schema } from "effect";

const Item = Schema.Struct({
  name: Schema.NonEmptyString,
  checked: Schema.Boolean,
  due: Schema.NullOr(Schema.Number), // milliseconds since the Unix epoch, picked by the person
  late: Schema.Boolean,
});
const Model = Schema.Struct({ items: Schema.Array(Item) });
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("add"), name: Schema.NonEmptyString, due: Schema.NullOr(Schema.Number) }),
  Schema.Struct({ type: Schema.Literal("rename"), name: Schema.NonEmptyString, to: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal("check"), name: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal("remove"), name: Schema.NonEmptyString }),
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number }), // only the runner sends this
]);
type Msg = typeof Msg.Type;

const late = (s: Model, at: number): Model => ({
  items: s.items.map((i) => (!i.checked && i.due !== null && i.due <= at ? { ...i, late: true } : i)),
});

export const checklistMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? { items: [] }, []],
  update: {
    add: (s, m) => [{ items: [...s.items, { name: m.name, checked: false, due: m.due, late: false }] }, []],
    rename: (s, m) => [{ items: s.items.map((i) => (i.name === m.name ? { ...i, name: m.to } : i)) }, []],
    check: (s, m) => [{ items: s.items.map((i) => (i.name === m.name ? { ...i, checked: true } : i)) }, []],
    remove: (s, m) => [{ items: s.items.filter((i) => i.name !== m.name) }, []],
    timer: (s, m) => [late(s, m.at), []],
  },
});

const has = (s: Model, name: string) => s.items.some((i) => i.name === name);

const refuse = (s: Model, m: Msg): Refusal | null => {
  if (m.type === "add") {
    return has(s, m.name) ? { reason: "taken" } : null;
  }

  if (m.type === "rename") {
    return !has(s, m.name) ? { reason: "missing" } : has(s, m.to) ? { reason: "taken" } : null;
  }

  if (m.type === "check" || m.type === "remove") {
    return has(s, m.name) ? null : { reason: "missing" };
  }

  return null;
};

// The next time an unchecked item falls due, or null for no alarm.
const wake = (s: Model): number | null => {
  const dues = s.items.flatMap((i) => (!i.checked && !i.late && i.due !== null ? [i.due] : []));
  return dues.length === 0 ? null : Math.min(...dues);
};

export const checklist = Program.make({
  name: "fabrika/checklist",
  machine: checklistMachine,
  state: { v: 1, upgrades: [] },
  view: (s) => ({ items: s.items.map((i) => ({ name: i.name, checked: i.checked, late: i.late })) }),
  refuse,
  inputs: {
    add: { description: "Add an item by a new name", personOnly: true },
    rename: { description: "Give an item a new name", personOnly: true },
    remove: { description: "Remove an item", personOnly: true },
    check: "Check the item called `name`", // a person or an agent may send this one
    left: Input.cases.read.make({
      schema: Schema.Struct({}),
      description: "How many items are left",
      answer: (view: { readonly items: ReadonlyArray<{ readonly checked: boolean }> }) =>
        view.items.filter((i) => !i.checked).length,
    }),
  },
  outputs: { done: Schema.Struct({ items: Schema.Int }) }, // declared; nothing sends it yet
  writes: {},
  wake,
});
```

The counter in `next/programs/counter` is the one built program on main. Copy its
`package.json`, and add one row for your folder to the root `boundary-rules.json`, as the counter
has (`"next/programs/counter": "next-program"`), or `pnpm lint` fails.

## What each field of `Program.make` is

The fields come from `Spec` ([Program.ts:198-210](../../next/packages/libfabrika/src/runtime/Program.ts)).

| Field | What it holds |
|---|---|
| `name` | The program's name, not empty ([Program.ts:130](../../next/packages/libfabrika/src/runtime/Program.ts)). The app lists programs as `pack/program`, so the shipped ones are `fabrika/...` ([table.ts:5-7](../../next/apps/fabrika/src/table.ts)) |
| `maxDeliveries` | Optional. How many times one letter is tried before it is dead. Left out, the wiring's limit, else 3 ([Program.ts:131-132](../../next/packages/libfabrika/src/runtime/Program.ts)) |
| `machine` | A tea machine from `Machine.make`, with its `model` and `msg` schemas. Its Msg `type`s are the input names ([Program.ts:248-252](../../next/packages/libfabrika/src/runtime/Program.ts)) |
| `state` | `v`, the saved model's version, and `upgrades`, one named function per version step (`name`, `from`, `run`). The model's schema comes from the machine ([Program.ts:48-61](../../next/packages/libfabrika/src/runtime/Program.ts), [276](../../next/packages/libfabrika/src/runtime/Program.ts)) |
| `view` | A function from the model to plain JSON. This is what a client sees ([Program.ts:204](../../next/packages/libfabrika/src/runtime/Program.ts)) |
| `refuse` | Says no to a fresh input, or `null` for yes. See below |
| `inputs` | One entry per Msg a client may send. A string: anyone may send it. `{ description, personOnly: true }`: only a person. `Input.cases.read.make(...)`: a read port, answered from the view ([Program.ts:255-261](../../next/packages/libfabrika/src/runtime/Program.ts), [282-288](../../next/packages/libfabrika/src/runtime/Program.ts)) |
| `outputs` | Named schemas of what the program puts out ([Program.ts:142](../../next/packages/libfabrika/src/runtime/Program.ts)) |
| `writes` | The ledger events the program may write, each with its schema and whether only a person's input may cause it ([Program.ts:124-127](../../next/packages/libfabrika/src/runtime/Program.ts)) |
| `wake` | When the program wants a `timer` Msg, or `null`. See below |

`Program.make` checks all of this when it runs, and throws if a field is wrong
([Program.ts:305-321](../../next/packages/libfabrika/src/runtime/Program.ts)). `Program.makeEffect`
does the same and fails as an Effect instead ([Program.ts:323-339](../../next/packages/libfabrika/src/runtime/Program.ts)).

## The runner saves the model for you

```ts
// What the runner saves after each turn (Runner.ts:782-786). You write none of it.
{ saved: { v: 1, build: "<build>", model: { items: [/* ... */] }, after: 12 }, turn: null, cmds: [] }
```

- After it folds the letters of a turn, the runner saves the model, the version and how far into
  the inbox it got ([Runner.ts:937](../../next/packages/libfabrika/src/runtime/Runner.ts)).
- On a restart it loads that row, climbs it through your `upgrades`, and hands the model to your
  `init` as `loaded` ([Runner.ts:741-742](../../next/packages/libfabrika/src/runtime/Runner.ts),
  [State.ts:32-96](../../next/packages/libfabrika/src/runtime/State.ts)). On the very first start
  `loaded` is `null` ([Program.ts:559-562](../../next/packages/libfabrika/src/runtime/Program.ts)).
  So `init: (loaded) => [loaded ?? { items: [] }, []]` is all a program writes.
- The model must encode to JSON with its schema. If it does not, the step fails as `ProgramDown`
  ([Program.ts:533-547](../../next/packages/libfabrika/src/runtime/Program.ts)).
- To change the model's shape, raise `state.v` and add an upgrade from the old number. A gap, a
  repeated `from` or a bad result stops the load and keeps the old bytes
  ([State.ts:26-31](../../next/packages/libfabrika/src/runtime/State.ts)).

## `wake`: when the program wants a timer

```ts
wake: (model) => 1767225600000, // a time in milliseconds since the Unix epoch, or null
// ...and when it is due, the runner mails the program's own inbox:
{ type: "timer", at: 1767225600000 }
```

- The runner calls `wake` after every start, step and fold, on the new model
  ([Program.ts:535](../../next/packages/libfabrika/src/runtime/Program.ts)).
- The unit is milliseconds since the Unix epoch. The runner takes the earliest of your time and its
  own retry times, which it reads from Effect's `Clock.currentTimeMillis`, and sets the alarm to it
  ([Runner.ts:300-319](../../next/packages/libfabrika/src/runtime/Runner.ts),
  [Runner.ts:486-487](../../next/packages/libfabrika/src/runtime/Runner.ts)).
- The clock is the platform's, not the sender's. On Cloudflare the time is saved and set as the
  object's alarm, and a time in the past rings at once
  ([cloudflare/runtime.ts:821-827](../../next/packages/libfabrika/src/cloudflare/runtime.ts)).
- When the alarm rings, the runner checks that your wake is due, then sends `{ type: "timer", at }`
  to the process's own inbox ([Runner.ts:1411-1430](../../next/packages/libfabrika/src/runtime/Runner.ts)).
  So your Msg schema needs a `timer` case with `at`, and your `update` a `timer` handler.
- No client can send a `timer`. A fresh one is refused
  ([Program.ts:494-498](../../next/packages/libfabrika/src/runtime/Program.ts)).
- After a `timer`, return a later time or `null`. The runner sets the alarm to whatever `wake`
  returns, so a time that is still due rings again. The checklist marks the item `late`, and
  `wake` skips late items.

## `refuse`: saying no to an input

```ts
refuse: (model, msg) => ({ reason: "taken" }), // or null to take the input
// What the sender gets back (Runner.ts:79-83):
{ _tag: "refused", reason: "taken" }
```

- A refusal is `{ reason, now?, most? }`: a reason, plus two optional numbers that explain it, such
  as a count and its limit ([Program.ts:40-46](../../next/packages/libfabrika/src/runtime/Program.ts)).
  `reason` is any string you pick. Nothing lists them for you, so name them in your program.
- `refuse` sees the model before the step and the fresh Msg. It runs only for a fresh input. A
  saved input is folded as it was taken and never refused again
  ([Program.ts:390-393](../../next/packages/libfabrika/src/runtime/Program.ts),
  [564-602](../../next/packages/libfabrika/src/runtime/Program.ts)).
- The reason goes back to the sender, in the `refused` answer. The input is not added to the inbox,
  and the model does not change. The runner saves the answer first, so a retry of the same input
  gets the same refusal ([Runner.ts:1561-1581](../../next/packages/libfabrika/src/runtime/Runner.ts)).
- If `refuse` throws or returns a bad value, the step fails as `ProgramDown`, not as a refusal
  ([Program.ts:572-576](../../next/packages/libfabrika/src/runtime/Program.ts)).

## `personOnly`: inputs only a person may send

```ts
add: { description: "Add an item by a new name", personOnly: true },
// An agent sends { type: "add", name: "milk", due: null } and gets back, today:
{ _tag: "refused", reason: "bad_msg" }
```

- The runner takes a `personOnly` input only when the sender is a person
  (`input.envelope.by._tag === "person"`), and refuses it from anyone else
  ([Runner.ts:1507-1511](../../next/packages/libfabrika/src/runtime/Runner.ts)).
- **Today that refusal says `bad_msg`.** That is the same reason as an unknown Msg, a Msg the schema
  does not take, an input name you did not declare, or a Msg that carries a parent
  ([Runner.ts:1494-1518](../../next/packages/libfabrika/src/runtime/Runner.ts),
  [Program.ts:568-570](../../next/packages/libfabrika/src/runtime/Program.ts)). So an agent cannot
  tell "you may not" from "I do not know this". Decision
  [0125](../../.decisions/0125-the-example-program-is-a-checklist.md) gives this refusal a reason of
  its own. Until it lands, check a refused input by sending it as a person in a test.
- `personOnly` on a `writes` event is a second rule: an event only a person's input may cause. The
  runner refuses a program's own write of one with `person_only`
  ([Runner.ts:1066-1069](../../next/packages/libfabrika/src/runtime/Runner.ts)).

## Test it

The counter's laws are the pattern: `next/programs/counter/src/program.laws.test.ts` checks the
machine with `propertyInvariant` from `@demlik/tea/pbt` and `syncTest` from
`@kampus/libfabrika/testing`. Its `runner.laws.test.ts` proves the state survives a restart, but it
wires the runner's services by hand. A test kit for authors that does that in one call is to be
planned with the pack work ([0125](../../.decisions/0125-the-example-program-is-a-checklist.md)).

## What is not there yet

| You want to | Today | Where it is planned |
|---|---|---|
| Load a program the app does not list | The list is one row in the app's source, `next/apps/fabrika/src/table.ts` ([table.ts:6-8](../../next/apps/fabrika/src/table.ts)) | The program list as a setting, then a repo's own pack listed by path ([the plan](../plan/tier-1.md), [0069](../../.decisions/0069-choices-are-settings.md), [0084](../../.decisions/0084-own-pack-listed-by-path.md)) |
| Give it a window | No program has one. The build looks for a `./window` export in the program's package ([node/build/build.ts:56](../../next/packages/libfabrika/src/node/build/build.ts)), but nothing public says what that module exports | The first window, in a browser tab ([the plan](../plan/tier-1.md)) |
| Let an agent call it | The runner knows an agent sender, but `next/` has no door an agent can dial | Agents through MCP ([the plan](../plan/tier-1.md)) |
| Answer a read port | Declared and checked; nothing in `next/` calls one yet | With the window and the agent's door |
| Send an output to another program | Declared only; the runner sends no outputs yet | Pipes are decided in [0109](../../.decisions/0109-a-pipe-is-saved-program-mail.md), not built |
| Build in the shape that will last | `Program.make` above is today's shape | A new shape is decided in [program-shape](../direction/program-shape.md), not built. Expect to rewrite the declaration when it lands |

## What this page cannot tell you

- The checklist is a sketch. It has not been typechecked or run. Its plan will build it and may
  change it.
- Line numbers are main's on 2026-11-11. When this page and the source disagree, the source wins.
