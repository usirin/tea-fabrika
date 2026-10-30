import {defineMachine} from "@demlik/tea";
import {defineProgram, end, input, kind, output} from "@kampus/fabrika";
import {Effect, Schema} from "effect";

// A program with a window, the smallest: it counts presses of +1 until done, and says the
// count. Its view is the count; its window (./window.tsx) draws it and sends the presses. No
// React here: a host that runs it with no window, such as tsh in a terminal, never loads any.
//
//   tsh> counter            in the fabrika app, its window takes over; +1, +1, done:
//   2                       what it sends, and tsh is back
//
//   viewOf(counter).of({n: 2})   {n: 2}

/** A press on the counter's window. */
export const Press = Schema.Literals(["plus", "done"]);
export type Press = typeof Press.Type;

/** What its window shows: the count so far. */
export const Shown = Schema.Struct({n: Schema.Int});
export type Shown = typeof Shown.Type;

const count = defineMachine({
	types: {model: {} as Shown, msg: {} as {readonly type: "plus"}, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {n: 0}, []],
	update: {plus: (s) => [{n: s.n + 1}, []]},
});

export const counter = defineProgram({
	name: "counter",
	description: "Counts presses of +1 until done, and says the count. It has a window.",
	inputs: {press: input(Press, "A press: plus counts one, done ends it.")},
	outputs: {n: output(Schema.Int, "The count, once done.")},
	machines: {
		count: kind({
			machine: count,
			state: Shown,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "count", steps: {}}),
			status: (s) => `${s.n} so far`,
		}),
	},
	view: {machine: "count", data: Shown, of: (s) => ({n: s.n})},
	main: ({serve, send, machines}) =>
		Effect.gen(function* () {
			const counted = yield* machines.count.get("count").start();
			yield* serve({
				press: (press) =>
					press === "plus" ? counted.dispatch({type: "plus"}).pipe(Effect.orDie) : end,
			});
			yield* send("n", counted.getState().n);
		}).pipe(Effect.scoped),
});
