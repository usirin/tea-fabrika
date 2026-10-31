# 164: One mailbox and a handler table, as a typed spike

Date: 2026-10-28. No model, no network, no key, $0.

## What happened next

- **Shape B was adopted on 2026-10-30** and built into the runtime in
  https://github.com/usirin/tea-fabrika/pull/195. Every run now has one
  mailbox in `begin` in `packages/fabrika/src/program/program.ts`, served in
  the order told. The note is
  [`tea-program.md`](../docs/direction/tea-program.md).
- **Control inputs got their own small bound.** An input declared with
  `{control: true}` has a fixed bound of 16 values not yet handled, apart
  from the run's one bound, and its handler must be a `fork`. That is the
  fix sketched below, but as one fixed number keyed by `control: true`, not
  a `forkedCapacity` each program sets.
- **The Ctrl-C hole is closed and tested.**
  `packages/fabrika/src/shell/ctrl-c.test.ts`: with 999 lines behind a slow
  line in tsh, Ctrl-C is queued and the job ends 130. With the mailbox full,
  1,000 waiting and the next line refused `MailboxFull`, Ctrl-C is still
  taken.
- **The doubt below is settled.** Akka's control-aware mailbox and Erlang's
  priority messages (EEP 76) let urgent messages go first, but they share the
  mailbox's bound. So the separate bound is our own rule, as guessed. The
  closest precedent is the terminal, where Ctrl-C skips the input buffer.
- **One guess here did not carry over.** "The value in hand counts against
  the bound" (in (c)) is **wrong** for the real mailbox: it counts values not
  yet taken, as experiment 79 did.
- **What this spike could not tell us, #195 tested:** pipes, a pipe's
  outbox, `ack: "manual"` through a pipe, a restored run with a closed input,
  and acp (it needed no fork).
- **This file is now a record.** The spike code left the packages: no
  `@kampus/fabrika/spike/serve` export, no package file. `serve.ts`, and the
  asks and ship copies, are in [`164-program-serve-spike/`](./164-program-serve-spike/),
  importing packages by name. They no longer run on main: the spike read its
  hidden input as a stream from the kit, and since #195 the kit hands
  `serve` instead. The tsh copy and the four test files used package internals no
  package name reaches, so they were dropped; they are in this experiment's
  first commit, `e01837e`, in https://github.com/usirin/tea-fabrika/pull/166. The flood
  script now floods the real mailbox alone. Run on 2026-10-30, 1,000,000
  tells gave `{queued: 1000, MailboxFull: 999000}` and the heap shrank by
  4.1 MB, the same numbers #195 got from experiment 79's script.

## The answer first

Shape B works, with one catch that needs a fix before it is adopted.

- **The order bug goes away.** A value told to input A, then one to input B,
  is handled A then B. On today's merge it was not, in 409 of 1,000 random
  runs. On the one mailbox it broke in 0 of 1,300.
- **The types infer.** Each handler's value comes from its input's schema.
  A missing handler, an extra name, a wrong value type and a bad `until` are
  all compile errors. The table's errors and services add up into `serve`'s
  type. This was the study's first doubt; it is settled.
- **The catch: the shared bound can starve Ctrl-C.** With "told and not yet
  handled" counted over the whole run, 999 lines waiting behind a slow line
  fill tsh's mailbox, and the Ctrl-C after them is refused `MailboxFull`.
  Today's tsh, with its own line for `signal`, still takes it. The study said
  this rule fixes the tsh trap. That was **wrong**, or at least only half
  right: it fixes the stall, and opens a refusal.
- **Ship's `forget` needs no fork.** The study forked it. That was **wrong**:
  its handler only waits on puts, never on a merge, and forking it would let a
  forget pass an ask told before it under the same id.

```ts
// The whole idea, from packages/fabrika/src/program/spike-serve.ts.
const echo = Program.make("echo", {
	description: "Says back each number.",
	inputs: {n: Program.input(Schema.Int, "A number."), quit: Program.input(Schema.Null, "Stop.")},
	outputs: {said: output(Schema.Int, "The same number.")},
	main: ({serve, send}) => serve({n: (n) => send("said", n), quit: () => Program.end}),
});
yield* Program.tell(run, "n", 1);       // "queued"; fails MailboxFull past the program's capacity
yield* Program.tell(run, "quit", null); // handled after 1, never before it
```

Lean: adopt shape B, with a separate small bound for forked inputs. Why: it
fixes order for every program in one place and the types hold. Cost: a few
days, listed below. Confidence 75%, up from the study's 70%: the type doubt
is gone, the bound has a known hole.

## What was built

The spike sat beside the API of its day. Nothing old was removed. The paths
below are where it sat then; the second column says where each file is now.

| File, as built | What it is, and where it is now |
|---|---|
| `packages/fabrika/src/program/spike-serve.ts` | `Program.make`, `input`, `serve`, `fork`, `end`, `MailboxFull`, `start`, `tell`, `offer`, `call`. Was exported as `@kampus/fabrika/spike/serve`. Now `164-program-serve-spike/serve.ts`. |
| `packages/pipeline/src/asks/spike-serve.ts` | asks, as a copy, served. Now `164-program-serve-spike/asks.ts`. |
| `packages/pipeline/src/stages/ship/spike-serve.ts` | ship, as a copy, served. Now `164-program-serve-spike/ship.ts`. |
| `packages/fabrika/src/shell/spike-tsh.ts` | tsh's `main`, as a copy, with `signal` forked. Dropped, with the four `spike-*.test.ts` files: see "What happened next". |
| `experiments/164-program-serve-spike.ts` | Experiment 79's flood on both runtimes. Now on the real mailbox alone. |

How the spike runs, so the numbers can be weighed:

- It rides on today's runtime. A served program is a `defineProgram` with one
  hidden input, `letters`. Every value and every close goes on it, in the
  order told.
- A token queue, sized to the capacity, is the bound. A tell takes a token;
  a handler that ends gives it back.
- `serve` keeps pulling the mailbox. A forked value goes to a `FiberSet` at
  once. Every other value goes on one lane, in order.
- A close is a mark on the mailbox. It waits behind offers still waiting for
  room.
- Not built: a close kept on the run's record, pipes into an input, a pipe's
  outbox.

```ts
// The types, as they are in the spike.
export type Serve<I extends Inputs> = <H extends Handlers<I>>(
	handlers: H & {readonly [K in Exclude<keyof H, keyof I>]: never},
	options?: {readonly until?: ReadonlyArray<keyof I & string>},
) => Effect.Effect<void, ErrorOf<H>, ServicesOf<H>>;

export const fork: <A, E, R>(handler: (value: A) => Effect.Effect<unknown, E, R>) => Forked<A, E, R>;
export const end: Effect.Effect<End>;
export class MailboxFull extends Schema.TaggedError<MailboxFull>()("MailboxFull", {
	input: Schema.String,
	capacity: Schema.Number,
}) {}
```

## asks, before and after

Before: seven fact inputs merged, then merged again with `answer`, then one
loop that splits on `item.on`.

```ts
// packages/pipeline/src/asks/program.ts, today (shortened).
const told = Stream.mergeAll(
	[
		inputs.planned.pipe(Stream.map(factOf), Stream.filter((f): f is Fact => f !== null)),
		inputs.ruling.pipe(Stream.map((r): Fact => ({type: "ruling_needed", ...r}))),
		// ...five more
	].map((facts) => facts.pipe(Stream.map((fact): Told => ({on: "fact", fact})))),
	{concurrency: "unbounded"},
).pipe(Stream.merge(inputs.answer.pipe(Stream.map((answer): Told => ({on: "answer", answer})))));
yield* told.pipe(
	Stream.runForEach((item) =>
		Effect.gen(function* () {
			if (item.on === "fact") { /* keep, say, ship */ }
			/* check the answer, keep, settle */
		}),
	),
);
```

After: setup is the same. Two plain functions, and one handler per input.

```ts
// packages/pipeline/src/asks/spike-serve.ts.
yield* serve({
	planned: (p) => fact(factOf(p)),
	revised: (r) => fact({type: "planned", plan: r.plan, tickets: [ticketOf(r.plan)], data: r.data, problems: []}),
	reviewed: (r) => fact({type: "reviewed", ...r}),
	ruling: (r) => fact({type: "ruling_needed", ...r}),
	answer,
	build: (b) => fact({type: "built", ...b, holds: flags.holds}),
	cleared: (c) => fact({type: "cleared", ...c}),
	raise: (r) => fact({type: "check_raised", ...r}),
});
```

What changed on the same tells (`packages/pipeline/src/asks/spike-serve.test.ts`):

| Told | Today | Served |
|---|---|---|
| A ruling, then its answer at once | The answer read first: refused "no ask has this id", ledger `[ruling_needed]` | Settled, ledger `[ruling_needed, answered]` |
| Six plans, then four rulings | Asks kept as plan, ruling, plan, ruling, plan, ruling, plan, ruling, plan, plan | Six plans, then four rulings |

The file shrank from 272 to 176 lines, most of it the `Told` union and the
merge.

## ship, before and after

Before: `pr` and `ask` merged with `pr` as the lifeline, and `forget` raced
beside the queue.

```ts
// packages/pipeline/src/stages/ship/program.ts, today (shortened).
const told = Stream.merge(
	inputs.pr.pipe(Stream.map(({value, ack}) => ({value: itemOfPr(value), ack}))),
	inputs.ask.pipe(Stream.map(({id, pr}) => ({value: {id, pr, kept: true}, ack: Effect.void}))),
	{haltStrategy: "left"},
);
const working = workQueue(machines.queue, told.pipe(Stream.map(asText)), shipItem, tidyItem);
const forgotten = inputs.forget.pipe(Stream.runForEach(forgetOne));
return working.pipe(Effect.raceFirst(forgotten.pipe(Effect.andThen(Effect.never))));
```

After: the kept queue's worker starts in setup. `pr` and `ask` only put an
item on it. `forget` runs in order, not forked.

```ts
// packages/pipeline/src/stages/ship/spike-serve.ts (shortened).
const queue = yield* startQueue(machines.queue, shipItem, tidyItem);
yield* serve(
	{
		pr: ({value, ack}) => queue.told({value: textOf(itemOfPr(value)), ack}),
		ask: ({id, pr}) => queue.told({value: textOf({id, pr, kept: true}), ack: Effect.void}),
		// In order: after an ask told before it, never before.
		forget: ({id}) => drop(machines.queue, keptUnder(id)).pipe(
			Effect.andThen(machines.ship.get(id).clear),
			Effect.andThen(send("forgot", {id})),
		),
	},
	{until: ["pr"]},
);
yield* queue.drained; // what was told before `pr` closed still ships
```

`startQueue` is `workQueue` split in two: `told` hands one value and returns
once the kept queue has it, `drained` ends the line and waits for the worker.

What changed (`packages/pipeline/src/stages/ship/spike-serve.test.ts`):

| Told | Today | Served |
|---|---|---|
| PR 1, PR 2, then an ask for PR 3, before ship reads | Shipped 1, 3, 2 | Shipped 1, 2, 3 |
| A forget while PR 7 sits in the merge queue for good | (not run) | `forgot` said at once, PR 7 still `queued` |
| PR 1, an ask for PR 2, then `pr` closes | Both ship, run ends | The same |

The last row is the lifeline. `until: ["pr"]` read as clearly as
`haltStrategy: "left"`, and in ship and tsh it said the same thing. That was
the study's third doubt; for these two programs it is settled.

## tsh, one line

```ts
// packages/fabrika/src/shell/spike-tsh.ts. Today `signal` is read by its own forked loop.
serve(
	{line: runOneLine, signal: Program.fork((s) => PubSub.publish(signals, s))},
	{until: ["line"]},
);
```

## The four tests

### (a) Order

A property test with fast-check (`spike-serve.test.ts`). A random script of
tells to two inputs, some before `main` reads; then compare what was handled
with what was told.

| Runs | Scripts that mixed both inputs | Out of order, today's merge | Out of order, served |
|---|---|---|---|
| 10 seeds of 100 | 907 | 409 | 0 |
| `fc.assert`, 300 runs | | | 0 |

The smallest failing script: tell `a`, `a`, `b` before `main` reads. Today's
merge hands them over as 0, 2, 1. Served: 0, 1, 2.

### (b) A fork is not blocked

- A forked `signal` is handled while a slow `line` runs. Not forked, the same
  signal waits until the line ends.
- A forked handler that fails fails the run.
- **But:** capacity 4 with 4 lines piled up: the signal fails `MailboxFull`.
  `queues()` reads `{length: 4, waiting: 0, by: {line: 4}}`. Today's shape
  answers `queued`.
- The same on real tsh (`spike-tsh.test.ts`): Ctrl-C stops a foreground `win`
  with status 130. With 998 lines piled behind it, Ctrl-C is still queued.
  With 999, it is refused. Today's tsh with 999 lines: queued, status 130.

### (c) Experiment 79's flood laws on one mailbox

From `experiments/164-program-serve-spike.ts`, a run that never reads, tells
split over two inputs:

| Told | Today | Served | Heap grew, today / served |
|---|---|---|---|
| 100,000 | 2,000 queued, 98,000 `Full` | 1,000 queued, 99,000 `MailboxFull` | 1.0 MB / 0.8 MB |
| 1,000,000 | 2,000 queued, 998,000 `Full` | 1,000 queued, 999,000 `MailboxFull` | -3.8 MB / 0.7 MB |

Laws that hold, each a test in `spike-serve.test.ts`:

- A full mailbox fails a tell at once, and memory stays flat.
- 3,000 offers to a late reader arrive once each, in order.
- `call` with 3,000 values hears every one.
- A waiting offer answers `stopped` when the run stops and `queued` when its
  input closes. A tell after the close answers `closed`.
- `queues()` counts writers waiting for room.
- A program capacity of 16: the 17th tell fails `MailboxFull`, naming the
  input it was told to.
- An uncaught `MailboxFull` shows in the caller's type.
- Capacity 0, 2.5, -1 and NaN are refused.
- Unread values are counted per input at the end.

What changes:

- The bound is per run, not per input. Two inputs share 1,000; today they get
  1,000 each. This reverses the 2026-10-19 capacity item in
  [`tea-program.md`](../docs/direction/tea-program.md).
- The value in hand counts against the bound. Today it has left the queue.
  (**Wrong** for what was built: the real mailbox counts values not yet
  taken, so a full mailbox is 1,000 waiting plus one in hand.)
- A pile behind a slow handler fills the bound for every input. That is the
  tsh refusal in (b).
- Experiment 79's pipe law was not ported: the spike has no pipes.

### (d) Types

Type tests in `spike-serve.test.ts`, each `@ts-expect-error` checked to fire
for the reason meant:

| Case | Result |
|---|---|
| Value of a plain input | `number`, from `Schema.Int` |
| Value of a `manual` input | `Delivery<string>` |
| Value inside `Program.fork` | `{id: string}` |
| Errors and services of the table | `Boom` and `Clock2`, in `serve`'s type |
| An input with no handler | Error: not assignable to `Handlers<...>` |
| A name that is no input | Error: not assignable to `never` |
| A handler for the wrong type | Error: `(n: string) => ...` not assignable to `Handler<number>` |
| `until` with a name that is no input | Error: `"nope"` not assignable to `"n" \| "quit"` |

## What adopting it would cost

Recounted on main at `a5542a3`:

- The runtime: the mailbox moves into `begin` in `program.ts`, with `queues`,
  unread counts and closes kept on the run's record. Plus `serve`, `fork`,
  `end`. The spike's 523 lines are the size, but the real one replaces the
  hidden input.
- 26 program files read `inputs.<name>` today, about 47 uses; 39 more in
  tests.
- `workQueue` splits into start, `told` and `drained` for its 4 callers:
  build, review, operate, ship.
- `Full` becomes `MailboxFull`: 10 `catchTag("Full")` sites in code (the
  study said 9).
- `queues()` per input becomes one line with a count per input. One real
  reader: `shell/copies.ts`.
- Experiment 79's tests are restated for one mailbox. The spike's tests are
  most of that.
- New: a bound for forked inputs (next section).

A few days, most of it tests. The study's estimate holds.

## The fix the spike points at

Sketch, not built here: forked inputs get their own small bound, so a pile of
slow work can never refuse a Ctrl-C or a cancel. (Built in #195 as a fixed
bound of 16 for inputs declared `{control: true}`, not as `forkedCapacity`.)

```ts
// Sketch. Each forked input counts against its own bound, not the shared one.
Program.make("tsh", {capacity: 1000, forkedCapacity: 16, ...});
// 999 lines piled up: tell(run, "signal", "interrupt") answers "queued".
// 17 signals not yet handled: the 17th fails MailboxFull({input: "signal", capacity: 16}).
```

Why: Ctrl-C, `cancel` and `refuse` are the inputs a person needs most when
the run is busy. Cost: one more number per program and one more law.
Confidence 70% that this is the right shape. Doubt: Effect's cluster has one
bound per entity and no such split, so this is our own rule. What would settle
it: check how Akka and Erlang keep system messages apart from a full mailbox.

## Confidence

75% that shape B is the right next step. The types and the order are proven
here. The doubt is the bound: the spike shows a real hole, and its fix is a
sketch.

## What this cannot tell us

- The spike rides on today's runtime through a hidden input. The real change
  lives in `begin`, and its own bugs are not tested here.
- Pipes and a pipe's outbox were not built, so experiment 79's pipe law and
  `ack: "manual"` through a pipe are untested.
- A close is not kept on the run's record. A restored run with a closed input
  is untested.
- acp, the third side lane, was not ported. It has three forked inputs and a
  turn worker in setup.
- Today's wrong orders depend on the scheduler. The 409 of 1,000 and the
  1, 3, 2 in ship are what this laptop gave; another may give more or fewer.
  The served order does not depend on it.
- The heap numbers are from one run each and are noise at this size.
