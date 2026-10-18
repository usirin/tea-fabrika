# 75. Machine refs: what the durable-entity systems do, and the shape it points to

Design only. No code changed. The build is experiment 75b, after 73 lands.

```ts
// Today: inside main, a program runs a kept machine through `keep`.
const runtime = yield* keep.run(
  "ship",
  {id, until: "forgotten"},
  {ctx: undefined, interpret, subscribe: shipSubscribe, terminal: isOver},
  (kept) => (kept === null || kept.phase === "idle" ? {type: "start", pr} : {type: "resume"}),
  shipDrawing(prName(pr), pr),
);

// Proposed (sketch): the kind says how its machine runs, once, on defineProgram.
// main gets a ref by id and sends the start Msg. A ref that finds work kept resumes it.
const runtime = yield* machines.ship.get(id).start({type: "start", pr});
```

## The answer first

The question: is `keep` (with `keep.run`, `keep.kept`, `keep.find`, `left` and
`first`) the shape that systems built for long-lived, saved entities use?

Mostly no. Six systems and Effect's own cluster and workflow modules agree on
three things that we do differently:

1. **A kind, then an id.** You get a ref to one instance by its kind and its id.
   Getting the ref does nothing. The instance starts on its first message.
2. **The kind says how it runs, once.** Its handlers are registered with the
   kind, not handed in at every call.
3. **The caller never says "resume".** The runtime loads what was saved, and the
   instance itself reacts to being loaded. The caller only sends its message.

They split on one thing: who carries on unfinished work after a crash when no
caller comes. Temporal and Restate do it on their own. Akka, Orleans, Durable
Objects and Dapr do it only when the instance asked for it: a remembered
entity, a reminder, an alarm.

The proposal keeps everything that already holds up (the fence, the held
Listens, one record per run) and changes the surface: per-kind declarations
on `defineProgram`, `machines.<kind>.get(id)` in `main`, the resume Msg
declared on the kind, `until` gone, and `left` reduced to a checked `parent`.
Confidence in the proposal as a whole: 65%. The doubts are listed at the end,
with what 75b must run to settle them.

## What the hypothesis said, and what held

| Claim | Held? | Where it holds, where it fails |
|---|---|---|
| A namespace per kind, then an id | Yes, in all six | DO `env.X.idFromName(name)` + `get(id)`; Akka `entityRefFor(TypeKey, id)`; Orleans `GetGrain<T>(key)`; Restate `ctx.objectClient(obj, key)`; Temporal `getHandle(workflowId)`; Dapr `ActorProxyBuilder(...).build(new ActorId(id))`. Effect: `Entity.make("Type", rpcs)` and `client(entityId)`. |
| No word for "saved" in addressing | Yes, in all six | The saving word lives in the state layer only: Orleans `IPersistentState`, Akka `PersistenceId`, the product name "Durable". Never in the call that finds an instance. |
| No run-vs-find split; the system activates by itself | Half | Holds for actors: DO, Akka, Orleans, Dapr and Restate virtual objects have no create call; the first message meets empty state. Fails for workflows: Temporal splits `start` from `getHandle`, and starting an id that is running fails by default (`WorkflowExecutionAlreadyStartedError`). Restate workflows also split `run` (once per id) from `workflowAttach`. |
| Unfinished work resumes with nobody calling | Split | Temporal and Restate: always, by replay. Akka: only with `rememberEntities`. DO, Orleans, Dapr: only through an alarm or reminder the instance set itself. Dapr never resumes a half-done turn. |

So the hypothesis was right on addressing and naming, and too strong on the
last two rows. "Load or start, all by itself" is the actor half of the field.
The workflow half keeps "start" and "attach" apart, and makes the clash a
policy choice.

## The prior art, piece by piece

Every claim below is from the official docs, fetched on 2026-10-17.

### Cloudflare Durable Objects

- **Address.** `env.NS.idFromName(name)`, `newUniqueId()`, `idFromString(hex)`,
  then `get(id)` gives a stub; `getByName(name)` does both. "Creating an ID for
  a Durable Object does not create the Durable Object"
  ([namespace](https://developers.cloudflare.com/durable-objects/api/namespace/)).
  "Simply creating the Durable Object Stub does not send a request"
  ([lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)).
- **Load.** The constructor runs on the first request of each activation. State
  is read inside `ctx.blockConcurrencyWhile(...)`, which holds every other event
  until it is done ([state](https://developers.cloudflare.com/durable-objects/api/state/)).
  This is our latch from experiment 72, built into the platform.
- **First time or back.** Not told apart. The object checks whether its
  storage is empty.
- **No caller.** `ctx.storage.setAlarm(ms)` and an `alarm()` handler. One alarm
  per object, at least once, retried up to 6 times. An alarm wakes an object
  that is not loaded ([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)).
- **Remove.** `ctx.storage.deleteAll()`. "A Durable Object fully ceases to exist
  if, when it shuts down, its storage is empty"
  ([storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)).
- **Two at once.** One instance per id worldwide; both callers reach it, no
  error. A stale instance that touches storage "will receive an exception"
  ([known issues](https://developers.cloudflare.com/durable-objects/platform/known-issues/)).
  That is our `Stale`.

### Akka Cluster Sharding with Akka Persistence

- **Address.** `EntityTypeKey[Cmd]("Counter")`, registered once with
  `ClusterSharding(system).init(Entity(TypeKey)(ctx => behavior))`, then
  `sharding.entityRefFor(TypeKey, "counter-1")`. Entities are made "when needed"
  on the first message ([sharding](https://doc.akka.io/libraries/akka-core/current/typed/cluster-sharding.html),
  [concepts](https://doc.akka.io/libraries/akka-core/current/typed/cluster-sharding-concepts.html)).
- **Load.** `EventSourcedBehavior(persistenceId, emptyState, commandHandler,
  eventHandler)`. On start it replays the snapshot and events. Commands that
  arrive meanwhile are stashed
  ([persistence](https://doc.akka.io/libraries/akka-core/current/typed/persistence.html)).
- **First time or back.** One path. `emptyState` is the first state. "The actor
  will always receive a RecoveryCompleted signal, even if there are no events in
  the journal." The entity reacts to its own recovery there. The caller has no
  create call and no resume call.
- **No caller.** `rememberEntities`: "automatically restarts entities after a
  rebalance or entity crash". It is set per entity type. It turns off automatic
  passivation and has a start/stop cost.
- **Remove.** `Passivate` stops it in memory. Deleting its events is a separate,
  offline tool (`EventSourcedCleanup.deleteAllEvents`), and "the actor with that
  persistence id must not be running"
  ([cleanup](https://doc.akka.io/api/akka-persistence-r2dbc/1.2.6/akka/persistence/r2dbc/cleanup/javadsl/EventSourcedCleanup.html)).
- **Two at once.** One entity per id in the cluster, one message at a time.
  Two writers would interleave events, so a split-brain resolver keeps a single
  writer ([split brain](https://doc.akka.io/libraries/akka-core/current/split-brain-resolver.html)).

### Microsoft Orleans

- **Address.** `grainFactory.GetGrain<IFoo>(key)`. The identity is `type/key`.
  The reference "remains valid even after a complete system restart"
  ([identity](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-identity),
  [references](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-references)).
  "An actor cannot be explicitly created nor destroyed"
  ([overview](https://learn.microsoft.com/en-us/dotnet/orleans/overview)).
- **Load.** `[PersistentState] IPersistentState<T>` is read before
  `OnActivateAsync` runs ([persistence](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-persistence/),
  [lifecycle](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-lifecycle)).
- **First time or back.** `RecordExists` on the state tells the grain. The
  caller still has one call.
- **No caller.** `RegisterOrUpdateReminder(name, due, period)` with
  `IRemindable.ReceiveReminder`. Kept across a full restart; a reminder
  activates a grain that is not loaded
  ([reminders](https://learn.microsoft.com/en-us/dotnet/orleans/grains/timers-and-reminders)).
- **Remove.** `ClearStateAsync()`, `UnregisterReminder`, `DeactivateOnIdle()`.
- **Two at once.** "At most one activation of a grain exists at any point in
  time." The default directory allows a rare duplicate during cluster trouble,
  and the storage ETag makes the stale writer fail with
  `InconsistentStateException` ([directory](https://learn.microsoft.com/en-us/dotnet/orleans/host/grain-directory)).
  Again, our `Stale`.

### Restate

- **Address.** `ctx.objectClient(counter, "Mary").add(1)`;
  `ctx.workflowClient(signup, "wf-id").run(req)`. The client is a proxy until a
  method is called ([communication](https://docs.restate.dev/develop/ts/service-communication)).
- **Load.** "The Restate Server stores all state and execution history,
  delivering them with each request" ([key concepts](https://docs.restate.dev/foundations/key-concepts)).
- **First time or back.** Virtual object: no create; `ctx.get(key)` returns
  `null` the first time ([state](https://docs.restate.dev/develop/ts/state)).
  Workflow: `run` "runs exactly once per workflow execution", and resubmitting
  "will fail with 'Previously accepted'"; the caller then uses
  `workflowAttach()` or `workflowOutput()`
  ([services](https://docs.restate.dev/develop/ts/services),
  [clients](https://docs.restate.dev/services/invocation/clients/typescript-sdk)).
- **No caller.** The server retries and "replays the journal, skipping completed
  steps".
- **Remove.** `ctx.clear(key)`, `ctx.clearAll()`. Object state is kept "retained
  indefinitely" until cleared. Workflow state is dropped after
  `workflowRetention`, 24 hours by default
  ([configuration](https://docs.restate.dev/services/configuration)).
- **Two at once.** "At most one handler with write access can run at a time per
  object key", queued, no error ([services](https://docs.restate.dev/concepts/services)).

### Temporal

- **Address.** Namespace and Workflow Id. `client.workflow.getHandle(id)` does
  not check the id; a missing run shows up later as `WorkflowNotFoundError`
  ([client](https://typescript.temporal.io/api/classes/client.WorkflowClient)).
- **Load.** No saved blob. A worker replays the event history through the
  workflow code ([event history](https://docs.temporal.io/encyclopedia/event-history)).
- **First time or back.** The caller picks: `start` or `getHandle`. Starting an
  id that is running is a policy: `WorkflowIdConflictPolicy` `FAIL` (the
  default), `USE_EXISTING`, `TERMINATE_EXISTING`. A closed id has a second
  policy, `WorkflowIdReusePolicy`
  ([ids](https://docs.temporal.io/workflow-execution/workflowid-runid),
  [enums](https://typescript.temporal.io/api/namespaces/common)).
- **No caller.** A dead worker's task times out and another worker replays and
  carries on. Activities already done are not run again.
- **Remove.** Closed runs are kept for the namespace's retention period, then
  dropped ([retention](https://docs.temporal.io/temporal-service/temporal-server#retention-period)).
- **Two at once.** One open run per id. `signalWithStart` starts it or signals
  the one running.

### Dapr actors

- **Address.** Actor type and actor id;
  `new ActorProxyBuilder(Impl, client).build(new ActorId("a"))` only makes a
  proxy ([js actors](https://docs.dapr.io/developing-applications/sdks/js/js-actors/)).
- **Load.** "Automatically activates an actor the first time it receives a
  request", then `onActivate()`. "They do not need to be explicitly created or
  destroyed" ([overview](https://docs.dapr.io/developing-applications/building-blocks/actors/actors-overview/)).
- **No caller.** Reminders persist and wake the actor; timers do not. A
  half-done turn is not replayed
  ([timers and reminders](https://docs.dapr.io/developing-applications/building-blocks/actors/actors-timers-reminders/)).
- **Two at once.** Turn-based: the second caller waits on a lock.

### Effect, in our own `node_modules` (4.0.0)

- `effect/cluster/Entity.ts`: `Entity.make("Counter", [rpcs])`, registered with
  `toLayer`, called with `const client = yield* Counter.client;
  client("id").Increment()`. The Akka shape, in Effect.
- `effect/workflow/Workflow.ts`: `Workflow.make({name, payload, success, error,
  idempotencyKey})`. The execution id is a hash of the name and
  `idempotencyKey(payload)`, so `execute` of the same key reaches the same
  execution. `poll`, `interrupt` and `resume` take that id. The Restate workflow
  shape, in Effect.
- `effect/RcMap.ts`: a map of resources by key, "lazily acquired on the first
  call to `get` and released when the last reference is released". That is
  "one live instance per id, shared by every caller", as a library primitive.

We do not adopt `effect/cluster` or `effect/workflow`: both bring sharding, an
RPC layer and their own storage, and tea-program's machines are tea machines on
the run's own fenced storage. We take their shape and their names, and RcMap
as the one primitive that fits as is.

### Elm

- `init : flags -> ( model, Cmd msg )`. Flags are the only input at start, and
  the guide's own use for them is loading a cached state from local storage;
  saving goes out through a port
  ([flags](https://guide.elm-lang.org/interop/flags.html),
  [ports](https://guide.elm-lang.org/interop/ports.html)).
- What carries over: the saved state comes in first, and nothing reaches
  `update` before `init` returns. That is 72's latch, and it stays. The kind's
  `recovered` (below) is the branch `init` makes on its flags.
- What Elm does not answer: many instances by id. An Elm program is one
  instance, and the page picks which saved blob to hand it. Addressing comes
  from the actor systems, not from Elm. Elm's own way to have many children
  is to hold them in the parent's model; tea-program chose one store per
  machine run instead (see `docs/direction/tea-program.md`), and this design
  does not reopen that.

## How our needs map onto it

| Our piece today | Closest prior art | Verdict |
|---|---|---|
| `keep.run(name, key, options, first, drawing)` | `entityRefFor(TypeKey, id)`, `GetGrain<T>(id)`, `objectClient(obj, key)` | Split it: options and drawing go to the kind, once; the call keeps the id and the start Msg. |
| `first(kept)` picks start or resume | Akka `RecoveryCompleted`, Orleans `OnActivateAsync`, Restate workflow `run` once per id | Split it: the kind declares its resume Msg; the caller sends only its start Msg, which goes only to a run that never began. |
| `left` function steps | Temporal/Restate replay; Akka `rememberEntities` | Drop them. Work resumes when its parent reaches it again, and the parent is kept. |
| `left: {by: "loop"}` | Temporal parent and child workflows | Keep it as `parent`, and check it. |
| `until: "forgotten"` or `until: isOver` | Restate object state "retained indefinitely" until `clearAll`; Orleans `ClearStateAsync` | Drop `until`. Every run is kept until cleared, and every run has a named id and a parent that clears it. |
| "same id twice at once dies" | One activation per id, callers share it (all six); Temporal `FAIL` is the one exception | Share it: a second `start` attaches. |
| `Stale` fencing | DO's storage exception, Orleans `InconsistentStateException` | Keep as is. It is already the field's answer. |
| `keep.kept`, `keep.find` | Temporal `list`, `describe` / `query` | Keep, renamed `list` and `read`, for hosts and tidy-ups. Not for driving work. |
| 73's one status line per copy | Akka shard region state, Orleans active-grain listing | A field on the kind; the live copies are the RcMap's keys. |
| `Drawing` per call | none; tracing is outside these APIs | A field on the kind, built from the id, the kept state and the start Msg. One open question. |

### Where each real stage lands

- **build per ticket and round.** Id `build/<ticket>/1`, or operate's
  `loop/<ticket>/<round>/build`. Parent: `main` (through the queue) in build,
  `loop` in operate. The start Msg carries the ask, the settings and the
  builder's session name, as today.
- **operate.** `queue` and `loop/<ticket>` have parent `main`. `build`,
  `review` and `ship` have parent `loop`: the loop's Act is sent again on
  resume, with the same intent as id, and `start` on that id resumes the stage
  or answers its kept end.
- **ship.** An ask keeps its asker's id and is cleared by the `forget` input.
  A bare `pr` gets a named id from the queue, cleared by the queue once its
  outcome is sent. Today's `find`-then-answer branch goes: `start` on a run
  that is over sends nothing and `done()` answers the kept end at once (this
  already holds, from 74).
- **review per pull request.** Today a fresh random id kept `until: isOver`.
  On the queue it gets a named id, so a crash after `over` no longer loses the
  verdict (72, hole 4): the queue reaches it again and `done()` answers.

## The proposed API (sketch)

### Declared once, on `defineProgram`

```ts
// Sketch. One entry per machine: Akka's Entity(TypeKey)(behavior), Restate's
// restate.object({name, handlers}), Effect's Entity.make(type, rpcs).toLayer(...).
export interface Kind<S, M extends {type: string}, C extends Cmd, U extends Sub, Ctx, K> {
  readonly machine: Machine<S, M, C, U, Ctx>;
  /** Who starts its runs again after a crash: `main`, or another machine of the
   *  program. Temporal's parent workflow. Checked when main ends (below). */
  readonly parent: "main" | K;
  /** tea's own run options, less the store. Built from the kit, so a cell can
   *  `send` or reach another kind. */
  readonly options: (kit: Kit) => KeptOptions<S, M, C, U, Ctx>;
  /** The Msg a run found part way gets first, before any Listen opens. Akka's
   *  RecoveryCompleted; Elm's init branching on its flags. `null`: it never
   *  began, so the caller's start Msg goes instead. Left out: always `null`. */
  readonly recovered?: (kept: S) => M | null;
  /** How its trace draws one run (experiment 70). */
  readonly drawing: (run: {id: string; kept: S | null; start: M | null}) => Drawing<S, C, U>;
  /** One line per live copy (experiment 73). */
  readonly status?: (state: S) => string;
}
```

```ts
// Sketch: the ship program's one kind.
machines: {
  queue: {machine: queue, parent: "main", options: () => ({ctx: undefined}), drawing: queueDrawing},
  ship: {
    machine: ship,
    parent: "main",
    options: () => ({
      ctx: undefined,
      interpret: {...shipReadInterpret, ...shipWriteInterpret()},
      subscribe: shipSubscribe,
      terminal: isOver,
    }),
    recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
    drawing: ({kept, start}) => {
      const pr = kept?.phase === "idle" || kept === null ? start?.pr ?? "" : kept.pr;
      return shipDrawing(prName(pr), pr);
    },
  },
},
```

### Used in `main`

```ts
// Sketch. `machines.<kind>` is what `keep` was. Names from prior art:
// get (DO, Orleans GetGrain, Temporal getHandle), start (Temporal, Restate
// workflow submit), clear (Restate clearAll, Orleans ClearStateAsync),
// list (Temporal list), read (Temporal describe).
interface Machines<S, M> {
  get(id: string): Ref<S, M>;                                      // does nothing yet
  readonly list: Effect<readonly {id: string; state: S}[], StorageFailed>;
}
interface Ref<S, M> {
  readonly id: string;
  /** Loads the kept state, sends `recovered` or this Msg, opens the Listens,
   *  and answers the one live copy. A copy already live under this id is
   *  shared, not started twice (RcMap). A run kept over gets no Msg. */
  start(msg?: M): Effect<KeptRuntime<M, S>, KeptFailed, Scope>;
  readonly read: Effect<S | null, StorageFailed>;
  readonly clear: Effect<void, StorageFailed>;
}
```

```ts
// Sketch: ship's main, on the kept queue. Today's find-then-answer branch is gone.
main: ({flags, inputs, send, machines}) =>
  workQueue(machines.queue, told(inputs), (t) =>
    Effect.gen(function* () {
      const end = yield* (yield* machines.ship.get(t.id).start({type: "start", pr: t.pr})).done();
      yield* send("outcome", {pr: t.pr, outcome: end.outcome, name: nameOf(end.outcome)});
      if (t.asked) yield* send("answer", {id: t.id, pr: t.pr, outcome: end.outcome, name: nameOf(end.outcome)});
    }).pipe(Effect.scoped),
    (t) => (t.asked ? Effect.void : machines.ship.get(t.id).clear),  // an ask waits for its `forget`
  ),
```

```ts
// Sketch: build's whole buildToTheEnd. It takes one kind, not a Pick of a Keep
// map, so 72's variance workaround goes too.
export const buildToTheEnd = (id: string, ask: BuildAsk, settings: Settings, build: Machines<Build, BuildMsg>) =>
  Effect.gen(function* () {
    const session = yield* sessionNamed(id);
    const end = yield* (yield* build.get(id).start({type: "start", ask, settings, session})).done();
    if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
    return end;
  }).pipe(Effect.scoped);
```

```ts
// Sketch: operate's left table becomes parents. No function steps.
machines: {
  queue:  {machine: queue,  parent: "main", ...},
  loop:   {machine: loop,   parent: "main", options: ({send, machines}) => ({ctx: undefined, interpret: loopInterpret(send, machines), terminal: isOver}), ...},
  build:  {machine: build,  parent: "loop", ...},
  review: {machine: review, parent: "loop", ...},
  ship:   {machine: ship,   parent: "loop", ...},
},
```

### What tea-program does at each step

1. **`get(id)`** builds a ref. No read, no boot, no span. (All six.)
2. **`start(msg)`** looks the id up in the program's live table (an Effect
   `RcMap` keyed by kind and id). Live: it shares that copy and drops `msg`.
   Not live: it reads the kept state, boots the machine with Listens and timers
   held (72), and sends one Msg to quiescence: `recovered(kept)` if that is not
   `null`, else `msg`. Then it opens the Listens. A run kept over gets nothing.
   The copy lives while any caller holds it.
3. **The parent check.** tea-program notes every id a `start` reached. When
   `main` returns, it lists each kind's kept runs. A run that is not over,
   that `recovered` says had begun, and that no `start` reached, fails the run:
   `build ended with build/<ticket>/1 unfinished: its parent main never
   started it again`. A run that never began (`recovered` gives `null`) is
   cleared quietly, as today's left steps do by hand.
4. **The queue clears behind itself.** Today the queue drops an item, then runs
   `after`. A crash between the two leaves a finished run nobody clears, and
   build's and operate's left steps carry code for exactly that. Instead, the
   queue's model holds `clearing` items: `done` moves an item there, the work
   after it runs, and a second Msg drops it. At start, the queue runs the
   clear for anything still in `clearing`. Elm's answer from 74: what must
   outlive a restart lives in the model.

### What stays exactly as it is

- The storage: one record per run, the index of machine runs, two slots and a
  checksum, the fence and `Stale`. Prior art fences the same way.
- The held Listens until the first Msg settles (72).
- One trace per kept run across restarts (70).
- `tell`, `pipe`, `call`, inputs and outputs, the run handle.

## What it removes

Counts are estimates from reading the code; 75b measures them.

| Removed | Where | About |
|---|---|---|
| `Left`, `LeftOf`, `Step`, `stepsOf`, `Leaving`, the left checks, the `carried` loop | `src/program/program.ts` | 90 lines |
| `Until`, `KeptRun.until`, the `until` index field | `program.ts`, `storage.ts` | 20 lines |
| `first` at every call; options and drawing at every call | build, review, ship, operate (loop and three stages), queue, tally: 8 call sites | 100 lines, against 5 kind entries of 10 to 15 lines |
| Function `left` steps, `waitingOf`, the pre-queue branches | build, operate, ship, review programs | 45 lines |
| ship's `find`-then-answer path | `src/stages/ship/program.ts` | 10 lines |
| `Pick<Keep<BuildMachines>, "run">` | `src/stages/build/program.ts` | the workaround, and 72 finding 4 with it |

Concepts gone: `keep`, `first`, `until`, function `left` steps, and "the same
id twice at once dies". Concepts renamed to prior-art names: `{by}` to
`parent`, `find` to `read`, `kept` to `list`, `forget` to `clear` (ship's
`forget` input keeps its name: it is ship's own word to its askers). New:
`recovered` on the kind, and the live table.

## What it could break, and the new problems it brings

1. **A second `start` with another Msg is dropped quietly.** That is Restate's
   attach and Temporal's `USE_EXISTING`, but Temporal's default is `FAIL` for
   this reason: two callers who each think they own an id is a bug. Lean:
   share, and mark the dropped Msg as a span event, since the copy that runs
   writes once either way. Doubt: a real bug of that kind would only show in a
   trace.
2. **The parent check fires only when `main` returns.** A `main` that never
   ends (a desktop host that keeps feeding it) never checks. 74 rec 4 hit the
   same wall. It is still better than today, where `{by}` is never checked.
3. **Per-kind options can need per-call values.** The drawing is the real case:
   operate names a stage's span `round 2`, and review's and ship's start Msgs
   carry no round. Either operate's drawing reads the round from the id it
   picked (`loop/<ticket>/<round>/review`), or `start` takes a drawing that
   overrides the kind's. See the open questions.
4. **Types may go in a circle.** The loop's `options` take the kit, whose
   `machines` include the loop. TypeScript may need the kit typed by hand there.
5. **ship and review must move onto the kept queue first.** That is 74 rec 2,
   with its doubt about ship's `forget` order. Without it, `until` cannot go
   and review keeps a function step.
6. **A copy now lives while any caller holds it.** A stuck second holder keeps
   it alive. Stopping the run still closes every scope, so a kill or a Ctrl-C
   is unchanged.
7. **Kept runs in old storages carry `until` in the index.** Read it and ignore
   it. Only local runs and test storages hold any.
8. **Three things are called `machines`**: the declarations, `main`'s refs, and
   the run handle's views. They are one kind seen from three sides, as Akka's
   entity type is, but a reader may trip on it.
9. **No hook for odd recovery.** A program that needs custom carry-on code (a
   migration of old kept runs) writes it at the top of `main`, before the
   queue starts. That is plain code, but nothing makes a program write it.

## Two shapes considered and not proposed

- **Restart every unfinished run on its own, like Temporal and Restate**
  (`rememberEntities` for every kind). It needs no parents. Not proposed,
  60/40: ship must run one pull request at a time (two enqueues on one base
  race), and a run's outputs (`outcome`, `verdict`, `ended`) are sent by the
  code that waited on it. A run carried on by tea-program alone would finish
  its writes and say nothing, unless each kind also had an "on end" step: a
  second place to say what `main` already says. What would change the lean: a
  program whose work has no parent and no output.
- **No start-once rule: every Msg goes, and each machine ignores a `start` it
  does not need**, as an Akka command handler would. Not proposed (80%): it
  moves one guard into every machine's `update`, where tea-program can hold it
  once.

A third, cheapest option is to rename `keep` to `machines` and change nothing
else. It answers the naming question and none of the shape.

## Recommendations

1. **Declare each machine's run once, on `defineProgram`** (85%). Why: all six
   systems and Effect's `Entity` register behavior with the kind, and today the
   same ship handlers are written in two programs and eight call sites hand in
   options. Cost: one larger entry per machine; folds 73's `status` into it.
2. **Split `first` into the kind's `recovered` and the caller's start Msg**
   (80%). Why: no system lets the caller say "resume"; Akka and Orleans let the
   instance react to its own load. Every `first` in the code is the same
   `kept === null || idle ? start : resume`. Cost: tea-program's rule "the
   start Msg goes only to a run that never began" must be learned once.
3. **Share a live copy instead of dying on the same id twice** (70%). Why: every
   actor system does, and RcMap gives it. Doubt: Temporal's `FAIL` default
   exists to catch real bugs; item 1 of the problems.
4. **Turn `left` into a checked `parent`, and drop function steps** (60%). Why:
   prior art resumes work through whoever addresses it, and our function steps
   are mostly migration and tidy-up code the queue can hold. Doubt: it depends
   on ship and review moving onto the queue, and the check's moment (main's
   end) is late. What settles it: 75b's stranded test and ship's kill test.
5. **Drop `until`; clear by the parent** (60%). Why: Orleans, DO and Restate
   objects keep state until it is cleared; we already reject retention by
   time. Doubt: the same queue move as rec 4.
6. **Do not adopt `effect/cluster` or `effect/workflow`** (75%). Why: they bring
   sharding, RPC and their own storage for a one-process program. Take their
   names and RcMap.

## What 75b must test

The user's job first, then the mechanism.

1. **Kill and attach, three copies, the real `bin/tsh`.** `src/tsh/kill.test.ts`
   passes unchanged on the new API: three tickets, `close %1 ticket`, `kill -9`
   mid the second and mid the third, `attach %1` bare. Each ticket copied,
   pushed and opened once; tickets 2 and 3 keep their conversation.
2. **The same for ship and review**, now on the queue: three pull requests,
   input closed, killed twice. Ship: each enqueued once, each `outcome` said
   once across the lives. Review: each verdict said once, including a run
   killed after `over` and before its verdict (72 hole 4 closed).
3. **operate, three tickets, cut mid review and again mid ship** (program
   test). Every loop ends, no stage writes twice, storage is empty after.
4. **74's bug is loud.** The old build (`main` reads its input, no queue) with
   `parent: "main"`: the run ends `failed` and names `build/<ticket>/1`. tsh
   prints it. Before 74 it ended silently.
5. **Two starts of one id at once** share one copy: one builder start, one
   push, both get the same end. The dropped Msg shows as a span event.
6. **72's race tests stay green**: the `recovered` Msg settles before any
   Listen opens.
7. **Compile errors**: no `parent`; a `parent` naming no machine; a start Msg of
   another machine; a `store` in options.
8. **73's status lines**, if 73 has merged: three live review copies show three
   lines by id, and again after a kill and attach.
9. **Count** the lines and exported names removed, against the table above.

## Open questions

1. Operate's span names: read the round from the id, or let `start` take a
   drawing? Lean: from the id, since operate picks the id (55%).
2. Second `start` with another Msg: share and mark it, or fail like Temporal?
   Lean: share (65%).
3. Fold 73's `status` table into the kind entry, or leave it beside
   `machines`? Lean: fold, once 73 has landed (70%).

## What this cannot tell us

- No code ran. Every line count is an estimate.
- Whether the parent check is precise enough on a `main` that runs for days.
- Whether TypeScript infers the kind entries without hand-written types.
- Whether ship's `forget` keeps its order on the queue (74's open doubt).
- The prior-art reading is from docs, not from running the six systems.
