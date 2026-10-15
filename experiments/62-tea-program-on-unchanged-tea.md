# 62. Can a program layer sit on unchanged @demlik/tea?

```ts
// A program: a tea machine with typed inputs and outputs, each with a description.
const ship = defineProgram({
  name: "ship",
  description: "Puts one pull request at a time in the merge queue and says how it went.",
  inputs: { hand: input(PR, "A pull request to put in the merge queue.") },
  outputs: [announced],                 // one-way, like an Elm outgoing port
  types: { model: {} as Ship, msg: {} as ShipMsg, sub: {} as QueueSub },
  cmds: [enqueue, deliver],             // deliver must arrive: its handler calls tell
  init, update, subs,
});

connect(operatorRun, handoff, shipRun, "hand");  // wiring is plain host code, plus a fit check
tell(shipRun, "hand", { pr: "#7", head: "abc1234" });
// -> "queued" | "stopped" | "bad_shape" | "no_cell", at once, never waits
```

The question: a host (Tuval is a host that will build on this) wants to start
programs, wire one program's output to another's input, and hand a program a
value. Can a layer for that sit between tea and the host, on
`@demlik/tea` 0.20.0 as published, with no change to tea? The one part
already known to need tea's help is a `tell` that never waits. A fix for that
is approved and tracked on its own. So the real question is whether anything
else needs tea to change.

The code is in [`src/program/`](../src/program/), with its tests beside it,
so typecheck and lint cover it. Nothing in `@demlik/tea` was changed.

**Answer, in two parts.**

- **(a) The tell that never waits: yes, with one hole.** On both engines,
  `tell` answers all four words at once. But it answers `queued` for a run that
  tea stopped by itself, because tea gives no public way to ask "is this run
  still open?". The workaround is not safe, and was not polished.
- **(b) Everything else: no tea change needed.** `defineProgram`, typed inputs
  and outputs, the four words, wiring, the fit check, a value that must arrive,
  both engines and replay all sit on tea's public API. What hurt was typing, not
  missing features. About 85% sure: three small programs is not a real host.

## (a) How `tell` gets each word without waiting

`tell` asks in this order, and stops at the first no:

```ts
type Word = "queued" | "stopped" | "bad_shape" | "no_cell";

tell(run, "hand", payload):
  1. the input's shape says no          -> "bad_shape"   (checked here, before tea)
  2. this layer's stopped flag is set   -> "stopped"
  3. acceptedTypes(machine, state now)
     has no "hand"                      -> "no_cell"
  4. put the Msg on the run's line      -> "queued"
```

| Engine | How the Msg goes on the line | At once? |
|---|---|---|
| Promise | `runtime.dispatchOnce(msg)`, not awaited. It queues before it returns. | yes |
| Effect | `Effect.runFork(runtime.dispatchOnce(msg))`. The fiber starts before `runFork` returns. | yes |

`queued` really means "on the line": a Msg told just before `stop()` is still
folded. A refusal that comes after `queued` lands in the run's `late` list.

What tea would have to give, smallest first:

- **The hole.** The stopped flag belongs to this layer. It is set by the host's
  `stop()` and by the Effect scope closing. It misses a run tea halts on its own:
  a reducer that throws, or a Sub that fails. Tea does check its gate at once,
  inside `enqueueDispatch`, but only tells you through a rejected Promise later.
  The Promise engine's stopped error is not exported either, so a late refusal
  there reads `refused`, not `stopped`.
  Tea would need either a sync `offer(msg)` on the run's line that returns the
  word, or a public `status()` plus an exported stopped error.
- **The `no_cell` race.** `no_cell` is judged on the state now. A Msg ahead on
  the line can change the state first, and then tell said `queued` for a Msg that
  finds no cell. The real answer comes late. Tea's rule that an input declared in
  a port has a cell in every state removes this. So would `offer` checking the
  cell at the moment the Msg goes in.
- Tea's own `tell` in `@demlik/tea/effect` waits until the run is idle, and
  drops a refusal without a word. It is not used here.

## (b) What the author writes, and what is worked out

The author writes the program's own Msgs only. For ship that is the merge
queue's Sub Msg, `ship_queue`. The rest comes from the declarations:

```ts
// worked out from `inputs`: one Msg per input
{ type: "hand"; payload: { pr: string; head: string } }
// worked out from `cmds`: the settled Msgs, as in defineMachine
{ type: "ship_deliver_ok"; ... } | { type: "ship_deliver_err"; ... } | ...
// worked out from `outputs`: one Cmd per output, with no _ok or _err
{ type: "ship_announced"; payload: Outcome }
```

- **An output** is a plain Cmd. Its handler belongs to the layer: it checks the
  shape, then puts the value on a tea Port (`definePort`, `emitPort`,
  `subscribePort`). Any number of listeners hear it, none is fine, nothing comes
  back. A value that fails its own output shape is dropped and noted.
- **A value that must arrive** is the program's own `Cmd.define` Cmd
  (`ship_deliver`). The host's handler calls `tell` and answers `ok "queued"` or
  `err stopped | bad_shape | no_cell`. So ship learns, in its own update, what
  became of each delivery.
- **A shape only checks.** A schema that turns one type into another does not
  compile. One that converts inside a single type (a trim, say) is refused when
  made. The value passed on is the value that came in.
- **Fit** compares the two JSON Schemas, with descriptions and titles taken out.
  It is exact: more fields does not fit, fewer does not fit. A shape with no
  JSON Schema answers `cannot_tell`.
- **The listing** prints each input and output: name, direction, description,
  JSON Schema.

## The fixtures

Three programs: `operator` hands pull requests to `ship` one at a time, `ship`
delivers each outcome back to the operator, and announces it to any `log`.
Each row ran on both engines.

| Case | Result |
|---|---|
| 5 pull requests, 3 rounds running; #2 conflicts, #4 is thrown out of the queue; two logs | pass: every outcome reaches the operator and both logs |
| The same with no log at all | pass |
| Operator stopped before the delivery: ship's `deliver` comes back `err "stopped"`, the logs still hear it, a later tell says `stopped` | pass |
| `bad_shape`: the payload never reaches the run | pass |
| `no_cell`: idle operator, busy ship, finished operator | pass |
| Answers at once, before the fold, in order | pass |
| A Msg told just before `stop()` is folded | pass |
| Replay gives the same state, and checks no shape | pass |
| Two programs telling each other from inside Cmd handlers, at the same time | pass on both engines, nothing locks up |
| Control: the same crossing, with a dispatch that waits for the fold | locks up, as expected |
| Known gap: `no_cell` race | written as a test: second tell says `queued`, a late `no_cell` follows |
| Known gap: a run tea halted itself (reducer throws) | written as a test: tell still says `queued` |

35 tests in `src/program/`. Whole repo: 50 files, 1113 tests, all pass.

## What fit cannot see

Fit is only as good as the JSON Schema Effect writes. In Effect 4.0.0:

```ts
Schema.Struct({ pr: Schema.String.check(Schema.isPattern(/^#\d+$/)) })
// JSON Schema: {"type":"object","properties":{"pr":{"type":"string"}},"required":["pr"],"additionalProperties":false}
//              the pattern is gone

Schema.String.check(Schema.isMinLength(5))
// JSON Schema: {"type":"string","minLength":3}
//              the check refuses "abc"; the JSON Schema lets it in
```

Re-checked on 2026-10-15 with a small script, both through `jsonSchema` in
`src/schema.ts` and through Effect's own `Schema.toJsonSchemaDocument`. Same
answer. `isMinLength(n)` writes `n - 1` for 2 and 3 and `3` for 5; `isMaxLength`
is right. So an output with no pattern, wired to an input that has one, gets
`fits`, and every value then comes back `bad_shape` at tell time. Tested as
such. This is about Effect, not tea.

## What else hurt

None of these needs tea to change. Each is a cost of building on it.

- **Outputs sent from `init` on the Effect engine.** A Cmd handler there gets no
  ctx, so no `ctx.emit`. The output handler reaches the run through a slot that
  is filled once `run` hands back the handle. An output sent from `init` may
  find the slot empty. No program here sends one, and it is not tested.
- **Port names are global.** `definePort` names are unique per process, so
  output names are too.
- **Loosely typed insides.** Tea's `update` type depends on the state type, and
  its overloads take the Cmd union from `cmds` alone. A wrapper that adds its
  own Cmds cannot hand a typed spec to `defineMachine`. So `defineProgram` has a
  typed signature over an `any` body, and `run.ts` uses `Machine<any, ...>`
  inside. Programs themselves are fully typed.
- **Transitions form only.** The reducer form has a cell in every state, so
  `no_cell` would never fire.
- `Schema.toStandardSchemaV1`, which `defineCmd` calls, adds `~standard` to the
  Effect schema it is given. So "is this a Standard Schema?" has to be asked as
  "is this not an Effect schema?".

What was exactly right: the port family. Fan-out, zero listeners is fine, a
listener that throws hurts no one, nothing comes back. That is Elm's outgoing
port with no glue.

## What this cannot tell us

- Three small programs in tests. No real host, no real queue, no load.
- Whether hosts will want a limit on how much waits on a line. This layer has
  none, on purpose.
- Whether exact fit is too strict once real programs are wired by people.
- Whether `offer` in tea closes the hole fully: it has not been built.
