import {defineMachine} from "@demlik/tea";
import {Effect, Queue, Stream} from "effect";
import type {Keep} from "../program/program.ts";

// The values a stage is told and has not finished, kept: the rule that what
// must outlive a restart lives in a machine, for the work a stage was told.
//
//   main: ({inputs, keep}) => workQueue(keep, inputs.ticket, (ticket) => buildOne(ticket), (ticket) => keep.forget("build", idOf(ticket)))
//
// A value told is put on the queue, and kept, before the next one is read.
// The queue is worked one value at a time, in the order told. A value leaves
// the queue only once its work has ended, and is kept gone before `after`
// runs. So a start after a kill finds every value told and not finished, the
// one it was working on first, and works them, with or without its input:
// a job whose input was closed carries on all the same.
//
// A value told again while it is on the queue is the same piece of work: it
// is not queued twice, and its work runs once. Told after its work ended, it
// is new work.
//
// Elm's answer: the work waiting is part of the model, and `init` gets it
// back. The input is only where values come from.

/** The values told and not finished, in the order told. The first is the one being worked. */
export interface Waiting {
	readonly items: readonly string[];
}

type QueueMsg =
	| {readonly type: "told"; readonly item: string}
	| {readonly type: "done"; readonly item: string};

export const queue = defineMachine({
	types: {model: {} as Waiting, msg: {} as QueueMsg, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {items: []}, []],
	update: {
		told: (s, m) => [s.items.includes(m.item) ? s : {items: [...s.items, m.item]}, []],
		done: (s, m) => [{items: s.items.filter((item) => item !== m.item)}, []],
	},
});

type Queued = {readonly queue: typeof queue};

/** The one queue of a run: there is one per program, under this id. */
const KEY = {id: "queue", until: "forgotten"} as const;

/**
 * Work each value of `told` through the run's kept queue (see the top of this
 * file), and end once `told` has ended and the queue is empty. `work`: one
 * value's work, to its end. `after`: what to drop once the value has left
 * the queue; a crash before it leaves only what `after` drops behind.
 */
export const workQueue = <E1, R1, E2, R2>(
	keep: Pick<Keep<Queued>, "run">,
	told: Stream.Stream<string>,
	work: (item: string) => Effect.Effect<void, E1, R1>,
	after: (item: string) => Effect.Effect<void, E2, R2>,
) =>
	Effect.gen(function* () {
		const waiting = yield* keep.run("queue", KEY, {ctx: undefined}, () => null, {
			name: "queue",
			steps: {},
			tags: (s) => ({waiting: s.items.length}),
		});
		// A nudge to the worker: a value was queued, or the input ended. Extra nudges are harmless.
		const nudge = yield* Queue.unbounded<void>();
		let reading = true;
		const read = told.pipe(
			Stream.runForEach((item) =>
				waiting.dispatch({type: "told", item}).pipe(Effect.andThen(Queue.offer(nudge, undefined))),
			),
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
					yield* after(first);
				} else if (reading) yield* Queue.take(nudge);
				else return;
			}
		});
		yield* Effect.all([read, worker], {concurrency: "unbounded", discard: true});
	}).pipe(Effect.scoped);

/** What is on the run's queue now, read from the storage: what a `left` step asks before `main` has run it. */
export const waitingOf = (keep: Pick<Keep<Queued>, "find">) =>
	keep.find("queue", KEY.id).pipe(Effect.map((kept) => kept?.items ?? []));
