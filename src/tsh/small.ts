import {defineMachine} from "@demlik/tea";
import {Duration, Effect, Layer, Schema, Stream} from "effect";
import {type Entry, listed} from "../program/listed.ts";
import {defineProgram, kind} from "../program/program.ts";
import {flag, input, output} from "../program/shape.ts";

// Small programs to use from tsh, the way `echo`, `seq`, `sleep`, `true` and
// `false` come with a Unix shell. Each is a whole tea program: a name, a
// description, typed flags, inputs and outputs, and `main`. They ask for no
// service.
//
//   seq --to 3 | double        2, 4, 6
//   say --text hi | upper      HI
//   sleep --ms 60000           until Ctrl-C
//   tally &                    a kept running total: tell it add=2, add=3, it says 5
//
// `seq | upper` is refused before it runs: seq sends integers, and upper
// takes text.

/** Finite and Int, not Number: Effect 4.0.0 writes Number's JSON Schema as a number or the strings "NaN", "Infinity". */
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const say = defineProgram({
	name: "say",
	description: "Says a text once, and ends. tsh's echo.",
	flags: {text: flag(Schema.String, "What to say.")},
	inputs: {},
	outputs: {said: output(Schema.String, "The text, once.")},
	main: ({flags, send}) => send("said", flags.text),
});

export const seq = defineProgram({
	name: "seq",
	description: "Counts from 1 up to a number, one value at a time, and ends.",
	flags: {to: flag(Count, "The last number it sends.")},
	inputs: {},
	outputs: {n: output(Schema.Int, "Each number, in order.")},
	main: ({flags, send}) =>
		Effect.forEach(
			Array.from({length: flags.to}, (_, i) => i + 1),
			(n) => send("n", n),
			{concurrency: 1, discard: true},
		),
});

export const double = defineProgram({
	name: "double",
	description: "Doubles each number it is told, and ends when its input closes.",
	inputs: {n: input(Schema.Int, "A number to double.")},
	outputs: {n: output(Schema.Int, "The number, doubled.")},
	main: ({inputs, send}) => inputs.n.pipe(Stream.runForEach((n) => send("n", n * 2))),
});

export const upper = defineProgram({
	name: "upper",
	description: "Says each text it is told in capital letters, and ends when its input closes.",
	inputs: {text: input(Schema.String, "A text.")},
	outputs: {text: output(Schema.String, "The text in capital letters.")},
	main: ({inputs, send}) =>
		inputs.text.pipe(Stream.runForEach((text) => send("text", text.toUpperCase()))),
});

export const sleep = defineProgram({
	name: "sleep",
	description: "Waits, then ends. Stopped before then, it ends stopped.",
	flags: {ms: flag(Count, "How long to wait, in milliseconds.")},
	inputs: {},
	outputs: {},
	main: ({flags}) => Effect.sleep(Duration.millis(flags.ms)),
});

export const yes = defineProgram({
	name: "true",
	description: "Ends at once, and well: exit status 0.",
	inputs: {},
	outputs: {},
	main: () => Effect.void,
});

export const no = defineProgram({
	name: "false",
	description: "Ends at once, and fails: exit status 1.",
	inputs: {},
	outputs: {},
	main: () => Effect.fail({_tag: "said_no" as const, message: "false always fails"}),
});

/** The running total of `tally`, kept in the run's storage. */
const count = defineMachine({
	types: {
		model: {} as {readonly total: number},
		msg: {} as {readonly type: "add"; readonly n: number},
		ctx: undefined,
	},
	cmds: [],
	init: (loaded) => [loaded ?? {total: 0}, []],
	update: {add: (s, m) => [{total: s.total + m.n}, []]},
});

export const tally = defineProgram({
	name: "tally",
	description:
		"Keeps a running total of the numbers it is told, and says it after each one. The total is kept: started again under the same run id, it goes on from it.",
	inputs: {add: input(Schema.Int, "A number to add.")},
	outputs: {total: output(Schema.Int, "The total, after each number.")},
	// The one total is never over, and has no unfinished work: main starts it again under its id,
	// first thing, at every start.
	machines: {
		count: kind({
			machine: count,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "count", steps: {}}),
			status: (s) => `total ${s.total}`,
		}),
	},
	main: ({inputs, send, machines}) =>
		Effect.gen(function* () {
			// Kept for as long as the run is: the total is the run's, and it is never over. Nothing goes
			// first: the total stands as it was kept, or at 0.
			const counter = yield* machines.count.get("total").start();
			yield* inputs.add.pipe(
				Stream.runForEach((n) =>
					counter.dispatch({type: "add", n}).pipe(
						Effect.orDie,
						Effect.andThen(() => send("total", counter.getState().total)),
					),
				),
			);
		}).pipe(Effect.scoped),
});

/** The small programs, listed: none asks for a service. */
export const SMALL: readonly Entry[] = [
	listed(say, Layer.empty),
	listed(seq, Layer.empty),
	listed(double, Layer.empty),
	listed(upper, Layer.empty),
	listed(sleep, Layer.empty),
	listed(yes, Layer.empty),
	listed(no, Layer.empty),
	listed(tally, Layer.empty),
];
