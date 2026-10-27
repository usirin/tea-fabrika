import {defineMachine} from "@demlik/tea";
import {type Delivery, kind, type RefsOf} from "@kampus/fabrika";
import {Effect, Queue, Schema, Stream} from "effect";
import {queueLine} from "./status.ts";

// The values a stage is told and has not finished, kept: the rule that what
// must outlive a restart lives in a machine, for the work a stage was told.
//
//   inputs: {ticket: input(Ticket, "...", {ack: "manual"})},   // a kept queue reads only an input that acks
//   machines: {queue: queueKind, build: buildKind},
//   main: ({inputs, machines}) =>
//     workQueue(machines.queue, inputs.ticket, (ticket) => buildOne(ticket), (ticket) => machines.build.get(idOf(ticket)).clear)
//
// A value told is put on the queue, and kept, before the next one is read.
// It is acked right then, once kept: from there the queue holds it, so the
// pipe that sent it may drop it (an ack means saved, not done). A value a
// host told has nobody waiting on its ack. The queue is worked one value at a time, in the order told. A value leaves
// the queue only once its work has ended, and `after` (dropping what its work
// kept) is kept as owed until it has run. So a start after a kill finds every
// value told and not finished, the one it was working on first, and works
// them, with or without its input: a job whose input was closed carries on
// all the same. A kill after the work and before `after` leaves `after` owed:
// the next start runs it first, so what the work kept is never left behind.
//
// A value told again while it is on the queue is the same piece of work: it
// is not queued twice, and its work runs once. Told after its work ended, it
// is new work.
//
// Elm's answer: the work waiting is part of the model, and `init` gets it
// back. The input is only where values come from.

/**
 * The values told and not finished, in the order told. The first is the one
 * being worked. The queue's state, and the schema it is kept and read back
 * through. A queue kept before `clearing` was there reads with none owed.
 */
export const Waiting = Schema.Struct({
	items: Schema.Array(Schema.String),
	/** Worked, and still to be tidied after (`after`). */
	clearing: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
});
export type Waiting = typeof Waiting.Type;

type QueueMsg =
	| {readonly type: "told"; readonly item: string}
	| {readonly type: "done"; readonly item: string}
	| {readonly type: "cleared"; readonly item: string}
	| {readonly type: "dropped"; readonly item: string};

export const queue = defineMachine({
	types: {model: {} as Waiting, msg: {} as QueueMsg, ctx: undefined},
	cmds: [],
	// A queue kept before `clearing` was there has nothing owed.
	init: (loaded) => [{items: loaded?.items ?? [], clearing: loaded?.clearing ?? []}, []],
	update: {
		told: (s, m) => [s.items.includes(m.item) ? s : {...s, items: [...s.items, m.item]}, []],
		done: (s, m) => [
			{
				items: s.items.filter((item) => item !== m.item),
				clearing: s.clearing.includes(m.item) ? s.clearing : [...s.clearing, m.item],
			},
			[],
		],
		cleared: (s, m) => [{...s, clearing: s.clearing.filter((item) => item !== m.item)}, []],
		// Off the queue, unworked, by `drop`: never the one being worked.
		dropped: (s, m) => [
			s.items[0] === m.item ? s : {...s, items: s.items.filter((item) => item !== m.item)},
			[],
		],
	},
});

/**
 * The queue as a kind: one per run, started by `main`. It has no `recovered`:
 * its work is carried on by `workQueue` itself, every start.
 */
export const queueKind = kind({
	machine: queue,
	state: Waiting,
	parent: "main",
	options: () => ({ctx: undefined}),
	drawing: () => ({name: "queue", steps: {}, tags: (s) => ({waiting: s.items.length})}),
	// `#2 now, 1 waiting`.
	status: queueLine,
});

/** The one queue of a run: there is one per program, under this id. */
const ID = "queue";

/**
 * Work each value of `told` through the run's kept queue (see the top of this
 * file), and end once `told` has ended and the queue is empty, with the
 * queue dropped from storage. `told`: a `manual` input's deliveries, each
 * acked once the queue has kept it. Only deliveries: an input a kept queue
 * reads must be declared `{ack: "manual"}`, so a pipe into it keeps each
 * value until the queue has it, and forgetting that does not compile.
 * `work`: one value's work, to its end. `after`: what to drop once the value
 * has left the queue; run again at the next start when a kill cut it off.
 */
export const workQueue = <E1, R1, E2, R2>(
	queues: RefsOf<typeof queueKind>,
	told: Stream.Stream<Delivery<string>>,
	work: (item: string) => Effect.Effect<void, E1, R1>,
	after: (item: string) => Effect.Effect<void, E2, R2>,
) =>
	Effect.gen(function* () {
		const waiting = yield* queues.get(ID).start();
		const tidy = (item: string) =>
			after(item).pipe(Effect.andThen(waiting.dispatch({type: "cleared", item})));
		// What a killed start owed first.
		for (const item of waiting.getState().clearing) yield* tidy(item);
		// A nudge to the worker: a value was queued, or the input ended. Extra nudges are harmless.
		const nudge = yield* Queue.unbounded<void>();
		let reading = true;
		const read = told.pipe(
			Stream.runForEach(({value, ack}) => {
				// `dispatch` returns once the new state is saved: only then is the value the queue's.
				return waiting
					.dispatch({type: "told", item: value})
					.pipe(Effect.andThen(ack), Effect.andThen(Queue.offer(nudge, undefined)));
			}),
			Effect.ensuring(
				Effect.sync(() => {
					reading = false;
				}).pipe(Effect.andThen(Queue.offer(nudge, undefined))),
			),
		);
		const worker = Effect.gen(function* () {
			while (true) {
				const [first] = waiting.getState().items;
				if (first !== undefined) {
					yield* work(first);
					yield* waiting.dispatch({type: "done", item: first});
					yield* tidy(first);
				} else if (reading) yield* Queue.take(nudge);
				else return;
			}
		});
		yield* Effect.all([read, worker], {concurrency: "unbounded", discard: true});
	}).pipe(
		Effect.scoped,
		// Told to its end, and every value worked: nothing is left to keep. Dropped once the live
		// queue has closed, so no save of its comes after.
		Effect.andThen(queues.get(ID).clear),
	);

/**
 * Take each value `matches` picks off the queue, before what its work kept is
 * dropped: a value waiting is dropped unworked, and the one being worked is
 * waited for. So no work starts again on what was dropped under it. It shares
 * the one live queue `workQueue` works (a ref's `start` with no Msg).
 */
export const drop = (queues: RefsOf<typeof queueKind>, matches: (item: string) => boolean) =>
	Effect.gen(function* () {
		const waiting = yield* queues.get(ID).start();
		for (const item of waiting.getState().items.filter(matches))
			yield* waiting.dispatch({type: "dropped", item});
		yield* Effect.callback<void>((resume) => {
			const gone = () => {
				if (!waiting.getState().items.some(matches)) resume(Effect.void);
			};
			const off = waiting.subscribe(gone);
			gone();
			return Effect.sync(off);
		});
	}).pipe(Effect.scoped);
