---
state: "decided 2026-11-02"
summary: "`next/`. Anything that replaces a tea machine is banned: no Effect `Workflow` for agent turns or anything else, no replay engine, no actor runtime that holds a machine's state. Effect stays as the engine under tea's Cmds, as services, and as ideas copied from cluster (dedup by request id). Cluster may come back later, with a written reason. From experiment 174."
---

# tea is the engine

`next/`. Decided by the owner on 2026-11-02. From [experiment 174](../../experiments/174-effect-on-cloudflare.md).

Its decided rules are in: [0254](../../.decisions/0254-tea-is-the-one-engine.md).

```ts
// A sketch. An agent turn is a tea machine. It steps; Effect runs only inside its Cmds.
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";

const Ask = Schema.Struct({turn: Schema.String, prompt: Schema.String});
const runAgent = Cmd.make("agent_run", {input: Ask, ok: Draft, err: ["stuck", "over_budget"]});
const askPerson = Cmd.make("person_ask", {input: Ask, ok: Answer, err: ["unknown"]});

const Turn = Schema.TaggedUnion({
	drafting: {turn: Schema.String},
	asking: {turn: Schema.String, draft: Draft},
	done: {turn: Schema.String, answer: Answer},
});

const update = (m: typeof Turn.Type, msg: Msg) =>
	msg.type === "drafted"
		? [Turn.cases.asking.make({turn: m.turn, draft: msg.draft}), [askPerson({turn: m.turn, prompt: msg.draft.text})]]
	: msg.type === "answered" ? Turn.cases.done.make({turn: m.turn, answer: msg.answer})
	: m;
// One value: drafting -> agent_run's ok -> asking -> person_ask's ok -> done.
// The object sleeps between steps. What it wakes to is the ledger's facts, folded through `update`.
```

## What was decided

- **tea is the one engine that holds state that moves.** A turn, a lane, a lease, a program: each
  is a tea machine that steps on Msgs. What survives a sleep or a kill is its facts in the ledger,
  folded through the same `update`.
- **Nothing replaces a tea machine.** If a library would hold the state a machine should hold, or
  decide the next step itself, it does not come in. That holds for agent turns and for anything
  else.
- **Effect's cluster may come later, not now.** Coming back to it needs a written reason, as a note
  here, with what it would undo.

## What it bans

- **Effect's `Workflow`**, with its `Activity`, `DurableClock` and `DurableDeferred`, and any
  `WorkflowEngine`, ours or Alchemy's. A workflow replays Effect code against its own saved
  results. That is a second durable model beside tea's.
- **Any replay engine** that re-runs code to rebuild where it was, outside a tea fold.
- **Any actor runtime** that keeps an actor's state for us: Effect's cluster `Entity` and
  `Sharding`, or an outside one.

## What stays allowed

- **Effect as the engine under tea's Cmds.** tea's Effect engine (`@demlik/tea/effect`) runs every
  Cmd and Sub. A Cmd may be any Effect, as long as it is one bounded job and its answer comes back
  as a Msg.
- **Effect services and Layers.** `Ledger`, `LeaseManager`, an agent's harness, the clock. They are
  how a Cmd reaches the world, and how a test swaps the world out.
- **Effect's modules that hold no state of ours:** Schema, RPC frames, SQL clients, `Base64Url`,
  Stream inside one Cmd.
- **Ideas taken from cluster and Workflow, written as tea.** Dedup by request id (from cluster's
  `SqlMessageStorage`), a message kept before it is delivered (from its `MessageStorage`, already
  in [tea-program](./tea-program.md)), at-least-once with a dead letter (from `PersistedQueue`).
  We copy the idea. The state stays in a machine.

## Why

- **tea is the Elm architecture we own.** One `update`, typed Msgs, Cmds out. Every change has a
  name, a law can check it, and a replay folds Msgs and re-runs code only
  ([saved state](./saved-state.md), S6).
- **Two durable models side by side break the Elm answer.** Experiment 174 ran a whole agent turn
  on Effect's `Workflow` and an alarm engine, and it worked. But a turn would then live in
  Workflow's tables and replay, and the lane around it would live in tea's facts and fold. Two
  places hold "where are we", with two upgrade stories and two ways to fail. [Elm first](./elm-first.md)
  asks for a parent written by hand that steps its children. A workflow is a child that steps
  itself.
- **Cluster stops an object from sleeping.** In experiment 174, cluster ran in one Durable Object
  but needed its polling loops. With them tuned away, the first call timed out at 20 s.
  Cloudflare's docs say timers keep an object in memory, and an object that cannot sleep costs
  money on the cloud.

**Cost:** a durable agent turn is ours to write as a machine. Experiment 174 guessed 300 to 560
lines for an engine; a machine on tea's facts should need less, since the fold and the record
already exist. That is a guess, not a measure.

## What it changes

- Experiment 174's lean "Workflow for Tier 5, 65%" and its "boldest honest design" are overruled.
  The write-up keeps them, marked.
- [Build on Effect](./build-on-effect.md) says to use Effect's own modules where they exist. This
  note is its one exception: a module that would replace a tea machine.
- Nothing settled before contradicts this. [A local-first sync engine](./a-local-first-sync-engine.md)
  already found Effect's event log and cluster do not fit the ledger.
  [tea-program](./tea-program.md) copies cluster's ideas, not its code. [Saved state](./saved-state.md)
  replays tea's Msgs, not a workflow.

## What would change it

A real job that a tea machine cannot hold without a pile of glue, seen on a real ticket, or
Effect's cluster able to sleep on a Durable Object with no polling. Either goes here as a written
reason first.
